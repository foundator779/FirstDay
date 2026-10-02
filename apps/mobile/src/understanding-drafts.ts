import type { UnderstandingBundle } from "@firstday/contracts";
import type { createDraftStore, UnderstandingDraft, UnderstandingDraftContext } from "./draft-store";

type Store=Pick<ReturnType<typeof createDraftStore>,"load"|"save">;

export class UnderstandingDraftWriteError extends Error {
  override readonly name="UnderstandingDraftWriteError";
}

export async function recoverUnderstandingDraft(input:{context:UnderstandingDraftContext;bundles:UnderstandingBundle[];store:Store;id():string}):Promise<{draft:UnderstandingDraft|null;requestId:string;committed?:UnderstandingBundle;clearFailed?:boolean}> {
  const saved=await input.store.load(input.context);
  if(!saved||!("kind" in saved)||saved.kind!=="understanding")return {draft:null,requestId:input.id()};
  const requestId=saved.requestId??input.id();
  const candidates=input.bundles.filter(({check})=>check.instruction.id===input.context.instructionId&&check.instruction.sourceConversationId===input.context.sourceConversationId&&check.instruction.sourceRevision===input.context.sourceRevision&&check.instructionRevision===input.context.instructionRevision);
  const committed=candidates.find(({check})=>input.context.phase==="explanation"?
    check.requestId===requestId&&check.explanation===saved.text.trim()&&check.inputMode===saved.inputMode:
    check.id===input.context.checkId&&check.responses.some(response=>response.requestId===requestId&&response.responseText===saved.text.trim()&&response.inputMode===saved.inputMode));
  if(committed){
    let clearFailed=false;
    try{await input.store.save(input.context,"","text");}catch{clearFailed=true;}
    return {draft:null,requestId:input.id(),committed,clearFailed};
  }
  return {draft:{...saved,requestId},requestId};
}

export async function submitUnderstandingDraft<T>(input:{context:UnderstandingDraftContext;text:string;inputMode:"text"|"voice";requestId:string;store:Store;submit():Promise<T>}):Promise<T> {
  try{await input.store.save(input.context,input.text.trim(),input.inputMode,input.requestId);}
  catch{throw new UnderstandingDraftWriteError("The answer and its retry identity could not be saved.");}
  return input.submit();
}
