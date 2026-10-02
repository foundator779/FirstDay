import { createTranscriptHash,sourceCorrectionSchema,type SourceCorrection,type PreviewCorrectionRequest,type UpdateCorrectionRequest,type InstructionCard,type ChangeProposal } from '@firstday/contracts';
export class CorrectionStateError extends Error { constructor(readonly code:'INVALID_STATE'|'REVISION_CONFLICT'){super(code);} }
const fail=(code:'INVALID_STATE'|'REVISION_CONFLICT'):never=>{throw new CorrectionStateError(code);};
export function correctionWithholds(correction:SourceCorrection):boolean {
  if(correction.status==='reopened')return true;
  return correction.status==='confirmed'&&correction.effects.withholdGrading;
}
export function correctionBlocks(corrections:readonly SourceCorrection[],instructionId:string):boolean{return corrections.some(c=>correctionWithholds(c)&&c.effects.instructionIds.includes(instructionId));}
export type CorrectionDependencies={instructions:InstructionCard[];practices:{id:string;status:string;instructionIds:string[]}[];attempts:{id:string;practiceSetId:string}[];checks:{id:string;version:number;instructionId:string}[];corrections:SourceCorrection[];change?:ChangeProposal|undefined};
export function correctionEffects(request:PreviewCorrectionRequest,dependencies:CorrectionDependencies){
  const annotation=request.after,ids=annotation.type==='newRule'&&dependencies.change?[request.target.instructionId,dependencies.change.replacementInstruction.id]:[request.target.instructionId];
  const affected=dependencies.practices.filter(p=>p.instructionIds.some(id=>ids.includes(id))).sort((a,b)=>a.id.localeCompare(b.id));
  const applicable=dependencies.corrections.filter(c=>c.effects.instructionIds.some(id=>ids.includes(id))&&!['preview','skipped'].includes(c.status)).sort((a,b)=>a.id.localeCompare(b.id));
  const withholdGrading=annotation.type==='transcription'||annotation.type==='interpretation'&&annotation.meaning!=='originalInstruction'||annotation.type==='attribution'&&annotation.preparation==='withhold';
  const generation=dependencies.corrections.filter(c=>c.request.target.sourceConversationId===request.target.sourceConversationId).reduce((sum,c)=>sum+c.reviewHistory.filter(e=>['confirm','undo','reopen','supersede'].includes(e.action)).length,0);
  const dependencyFingerprint=createTranscriptHash(JSON.stringify({instructions:dependencies.instructions.filter(i=>ids.includes(i.id)).sort((a,b)=>a.id.localeCompare(b.id)),practices:affected,attempts:dependencies.attempts.filter(a=>affected.some(p=>p.id===a.practiceSetId)).sort((a,b)=>a.id.localeCompare(b.id)),checks:dependencies.checks.filter(c=>ids.includes(c.instructionId)).sort((a,b)=>a.id.localeCompare(b.id)),corrections:applicable.map(c=>({id:c.id,version:c.version,status:c.status})),change:dependencies.change,generation}));
  return {instructionIds:ids,practiceSetIds:affected.filter(p=>p.status!=='stale').map(p=>p.id),withholdGrading,generation,dependencyFingerprint,consequence:annotation.type==='newRule'&&request.revisesId&&dependencies.change?.status==='confirmed'?'Revise this local review of the same confirmed canonical change. Keep its policy and history intact; create a fresh current drill only if all review gates are resolved.':annotation.type==='newRule'?'Confirm the selected source-backed canonical change and create its Change Drill. Earlier practice becomes historical.':withholdGrading?'Withhold this instruction from grading and new preparation. Affected practice becomes historical until source review resolves this annotation.':'Keep the original source-supported instruction available. This conversation-local annotation does not change trainer policy.'};
}
export function createCorrection(input:{id:string;learnerId:string;request:PreviewCorrectionRequest;dependencies:CorrectionDependencies;timestamp:string}):SourceCorrection {
  const {request}=input,a=request.after,original=request.target.instruction;
  const beforeMeaning=`${original.text}: ${original.expectedAction}`;
  const afterMeaning=a.type==='attribution'?`Speaker annotation: ${a.speakerName} (${a.speakerRole}); ${a.preparation} preparation for this source.`:a.type==='transcription'?`Learner-corrected wording: ${a.correctedText}. This recollection is disputed, ungraded policy.`:a.type==='interpretation'?`Learner interpretation: ${a.meaning}. Original source evidence remains intact.`:`Actual later rule: ${input.dependencies.change?.replacementInstruction.expectedAction??fail('INVALID_STATE')}.`;
  return sourceCorrectionSchema.parse({id:input.id,learnerId:input.learnerId,request,beforeMeaning,afterMeaning,effects:correctionEffects(request,input.dependencies),status:'preview',version:1,createdAt:input.timestamp,updatedAt:input.timestamp,reviewHistory:[{requestId:request.requestId,action:'preview',version:1,learnerId:input.learnerId,createdAt:input.timestamp}]});
}
export function updateCorrection(correction:SourceCorrection,request:UpdateCorrectionRequest,dependencies:CorrectionDependencies,timestamp:string):SourceCorrection {
  const receipt=correction.reviewHistory.find(e=>e.requestId===request.requestId);
  if(receipt){if(JSON.stringify(receipt.request)!==JSON.stringify(request))fail('REVISION_CONFLICT');return correction;}
  if(correction.version!==request.expectedVersion||correction.reviewHistory.length>=100)fail('REVISION_CONFLICT');
  let status=correction.status;
  if(request.action==='confirm'){
    if(!['preview','skipped'].includes(status))fail('INVALID_STATE');
    const effects=correctionEffects(correction.request,dependencies);
    if(effects.dependencyFingerprint!==correction.effects.dependencyFingerprint||request.dependencyFingerprint!==correction.effects.dependencyFingerprint)fail('REVISION_CONFLICT');
    if(dependencies.corrections.some(c=>c.id!==correction.id&&c.id!==correction.request.revisesId&&['confirmed','reopened'].includes(c.status)&&c.effects.instructionIds.some(id=>effects.instructionIds.includes(id))))fail('INVALID_STATE');
    status='confirmed';
  }else if(request.action==='skip'){
    if(!['preview','skipped','reopened'].includes(status))fail('INVALID_STATE');
    if(status!=='reopened')status='skipped';
  }else if(request.action==='reopen'){
    if(status!=='confirmed')fail('INVALID_STATE');status='reopened';
  }else{
    if(!['confirmed','reopened'].includes(status))fail('INVALID_STATE');status='undone';
  }
  const version=correction.version+1;
  return sourceCorrectionSchema.parse({...correction,status,version,updatedAt:timestamp,...(request.action==='confirm'?{confirmedBy:correction.learnerId,confirmedAt:timestamp}:{}),reviewHistory:[...correction.reviewHistory,{requestId:request.requestId,action:request.action,request,version,learnerId:correction.learnerId,createdAt:timestamp}]});
}

/** Application context only. These annotations never replace original evidence or policy. */
export type ApprovedCorrectionContext = {
  id: string;
  version: number;
  instructionId: string;
  sourceConversationId: string;
  sourceRevision: string;
  annotation: SourceCorrection['request']['after'];
};
export function correctionReviewContext(corrections: readonly SourceCorrection[], learnerId: string, targets: readonly Pick<InstructionCard,'id'|'sourceConversationId'|'sourceRevision'>[], changes: readonly ChangeProposal[]) {
  const originalTarget = (c: SourceCorrection) => targets.some(t => t.id === c.request.target.instructionId && t.sourceConversationId === c.request.target.sourceConversationId && t.sourceRevision === c.request.target.sourceRevision);
  const replacementTarget = (c: SourceCorrection) => {
    const a = c.request.after;
    if (a.type !== 'newRule') return false;
    const change = changes.find(change => change.id === a.changeId && change.status === 'confirmed' && change.previousInstructionId === c.request.target.instructionId && change.previousSourceRevision === c.request.target.sourceRevision);
    const replacement = change?.replacementInstruction;
    return !!replacement && replacement.sourceConversationId === a.laterSourceConversationId && replacement.sourceRevision === a.laterSourceRevision && c.effects.instructionIds.includes(replacement.id) && targets.some(t => t.id === replacement.id && t.sourceConversationId === replacement.sourceConversationId && t.sourceRevision === replacement.sourceRevision);
  };
  const applicable = corrections.filter(c => c.learnerId === learnerId && (originalTarget(c) || replacementTarget(c)) && !['preview','skipped'].includes(c.status)).sort((a,b)=>a.id.localeCompare(b.id));
  return {
    dependencyFingerprint: createTranscriptHash(JSON.stringify(applicable.map(c => ({id:c.id,version:c.version,status:c.status})))),
    approvedCorrections: applicable.filter(c => originalTarget(c) && c.status === 'confirmed' && !correctionWithholds(c)).map((c):ApprovedCorrectionContext => ({id:c.id,version:c.version,instructionId:c.request.target.instructionId,sourceConversationId:c.request.target.sourceConversationId,sourceRevision:c.request.target.sourceRevision,annotation:c.request.after})),
  };
}
/** Revising an already confirmed change updates local review wording only. */
export function isCanonicalCorrectionRevision(previous:SourceCorrection|undefined,request:PreviewCorrectionRequest):boolean {
  return !!previous && request.revisesId===previous.id && previous.request.after.type==='newRule' && request.after.type==='newRule' && JSON.stringify(previous.request.after)===JSON.stringify(request.after) && JSON.stringify(previous.request.target)===JSON.stringify(request.target);
}
