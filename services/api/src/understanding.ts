import type {ApprovedCorrectionContext} from '@firstday/scenario-engine';
import { z } from "zod";
import { understandingCheckSchema, type UnderstandingCheck, type UnderstandingResponse, type SourceEvidence, type InstructionCard } from "@firstday/contracts";
import { understandingPrompt, understandingActiveAction } from "@firstday/scenario-engine";
import { InvalidDependencyOutputError, ApiError } from "./errors.js";
export const understandingComparisonSchema = z.object({ comparison: z.enum(["consistent", "possibleMismatch", "uncertain"]), answerQuote: z.string().max(4000), sourceAction: z.string().min(1).max(86000) }).strict();
export type UnderstandingComparator = (input: { check: UnderstandingCheck; responseText: string; approvedCorrections?:readonly ApprovedCorrectionContext[] }) => Promise<z.infer<typeof understandingComparisonSchema>>;
export function resolvedUnderstandingAction(check: UnderstandingCheck): string {
  return [check.instruction.expectedAction,...check.instruction.exceptions.filter((_exception,index)=>check.applicability[index]===true).map(exception=>`Applicable source exception: ${exception}`)].join("\n");
}
export const offlineUnderstandingComparator: UnderstandingComparator = async ({check,responseText}) => {
  const sourceAction=resolvedUnderstandingAction(check);
  // Exact-copy detection is deliberately conservative; it is not semantic evaluation.
  const activeAction=understandingActiveAction(check);
  const consistent=activeAction!==null&&responseText.trim().toLowerCase()===activeAction.trim().toLowerCase();
  return {comparison:consistent?"consistent":"uncertain",answerQuote:consistent?responseText:"",sourceAction};
};
export async function compareUnderstandingResponse(check: UnderstandingCheck, response: {requestId:string;responseText:string;inputMode:"voice"|"text"}, timestamp: string, comparator: UnderstandingComparator, approvedCorrections:readonly ApprovedCorrectionContext[]=[]): Promise<UnderstandingCheck> {
  if (!understandingPrompt(check) || check.responses.length >= 20) throw new ApiError("INVALID_STATE");
  let comparison: z.infer<typeof understandingComparisonSchema>;
  try { comparison=understandingComparisonSchema.parse(await comparator({check:structuredClone(check),responseText:response.responseText,approvedCorrections})); }
  catch { throw new InvalidDependencyOutputError(); }
  if (comparison.sourceAction !== resolvedUnderstandingAction(check) || (comparison.comparison !== "uncertain" && (!comparison.answerQuote.trim() || !response.responseText.includes(comparison.answerQuote)))) throw new InvalidDependencyOutputError();
  const lead={consistent:"Your explanation appears consistent with the confirmed action for the context you supplied.",possibleMismatch:"Possible mismatch: compare the action in your explanation with the confirmed action for this context.",uncertain:"This comparison is uncertain. Review the source and explain the action again, or save a private trainer question."}[comparison.comparison];
  const saved:UnderstandingResponse={requestId:response.requestId,responseText:response.responseText,inputMode:response.inputMode,applicability:check.applicability.map(value=>{if(value===null)throw new ApiError("INVALID_STATE");return value;}),comparison:comparison.comparison,feedback:lead,createdAt:timestamp};
  return understandingCheckSchema.parse({...check,version:check.version+1,responses:[...check.responses,saved],updatedAt:timestamp});
}

export type UnderstandingInitialComparator = (input: {instruction: InstructionCard;sourceEvidence: SourceEvidence[];approvedCorrections?:readonly ApprovedCorrectionContext[];explanation:string})=>Promise<UnderstandingCheck["initialComparison"]>;
