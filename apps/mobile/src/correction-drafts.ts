import {previewCorrectionRequestSchema} from '@firstday/contracts';
import type {SourceCorrection,SourceSessionResponse,PreviewCorrectionRequest,UpdateCorrectionRequest} from '@firstday/contracts';
import type {CorrectionDraft,CorrectionDraftContext,CorrectionDraftMetadata,createDraftStore} from './draft-store';
type Store=Pick<ReturnType<typeof createDraftStore>,'load'|'saveCorrection'>;
export class CorrectionDraftWriteError extends Error {override readonly name='CorrectionDraftWriteError';}
export async function submitCorrectionDraft<T>(input:{store:Store;context:CorrectionDraftContext;text:string;inputMode:'voice'|'text';metadata:CorrectionDraftMetadata;submit():Promise<T>}):Promise<T>{
  try{await input.store.saveCorrection(input.context,input.text.trim(),input.inputMode,input.metadata);}catch{throw new CorrectionDraftWriteError('The correction and retry identity could not be saved on this device.');}
  return input.submit();
}
/** Only authenticated current source/correction reads can authorize restoring local metadata. */
export async function recoverCorrectionDraft(input:{store:Store;context:CorrectionDraftContext;session:SourceSessionResponse;corrections:SourceCorrection[]}):Promise<{draft:CorrectionDraft|null;receipt:SourceCorrection|null;mutationCommitted:boolean}>{
  const {sourceConversation:source,extraction}=input.session,c=input.context;
  if(source.learnerId!==c.learnerId||source.id!==c.sourceConversationId||source.sourceRevision!==c.sourceRevision||source.consentStatus!=='confirmed'||extraction?.instructionRevision!==c.instructionRevision)throw new Error('Source-bound draft cannot be restored.');
  const saved=await input.store.load(c);if(!saved||!('kind' in saved)||saved.kind!=='correction')return {draft:null,receipt:null,mutationCommitted:false};
  const receipt=input.corrections.find(r=>r.request.requestId===saved.requestId)??null;
  if(saved.instructionId){const instruction=extraction.items.find(i=>i.id===saved.instructionId);if(!instruction||JSON.stringify(instruction.sourceEvidence)!==JSON.stringify(saved.evidenceIds))throw new Error('Draft evidence selection changed.');}
  if(receipt&&(receipt.learnerId!==c.learnerId||receipt.request.target.sourceConversationId!==c.sourceConversationId||receipt.request.target.sourceRevision!==c.sourceRevision||receipt.request.target.instructionRevision!==c.instructionRevision||receipt.request.target.instructionId!==saved.instructionId||receipt.request.recognizedText!==saved.text.trim()||receipt.request.inputMode!==saved.inputMode||receipt.request.revisesId!==saved.revisesId||JSON.stringify(receipt.request.after)!==JSON.stringify(saved.after)))throw new Error('Saved correction receipt does not match this draft.');
  const event=saved.mutation?receipt?.reviewHistory.find(e=>e.requestId===saved.mutation!.requestId):undefined;
  if(event&&JSON.stringify(event.request)!==JSON.stringify(saved.mutation))throw new Error('Saved mutation UUID was used for different content.');
  return {draft:saved,receipt,mutationCommitted:!!event};
}

type ReviewStore=Pick<ReturnType<typeof createDraftStore>,'reserveCorrection'|'clearCorrection'|'attachCorrectionPreview'|'saveCorrection'|'load'>;
export async function submitCorrectionPreview(input:{store:ReviewStore;context:CorrectionDraftContext;request:PreviewCorrectionRequest;submit(request:PreviewCorrectionRequest):Promise<SourceCorrection>}):Promise<SourceCorrection>{
  const request=previewCorrectionRequestSchema.parse(input.request),context={...input.context};
  if(request.target.sourceConversationId!==context.sourceConversationId||request.target.sourceRevision!==context.sourceRevision||request.target.instructionRevision!==context.instructionRevision)throw new CorrectionDraftWriteError('Preview source does not match its device item.');
  const receipt=await submitCorrectionDraft({store:input.store,context,text:request.recognizedText,inputMode:request.inputMode,metadata:{requestId:request.requestId,after:request.after,instructionId:request.target.instructionId,evidenceIds:request.target.instruction.sourceEvidence,status:'pending',...(request.revisesId?{revisesId:request.revisesId}:{})},submit:()=>input.submit(request)});
  if(receipt.learnerId!==context.learnerId||receipt.request.requestId!==request.requestId||JSON.stringify(receipt.request)!==JSON.stringify(request))throw new Error('Preview receipt does not match the submitted correction.');
  await input.store.attachCorrectionPreview(context,request.requestId,receipt.id);return receipt;
}
export async function reserveCorrectionReview(input:{store:ReviewStore;context:CorrectionDraftContext;correction:SourceCorrection;revisedRequestId?:string}){
  const c=input.correction,t=c.request.target;if(c.learnerId!==input.context.learnerId||input.revisedRequestId&&c.status!=='reopened')throw new CorrectionDraftWriteError('Correction review is unavailable.');
  try{return await input.store.reserveCorrection({...input.context,sourceConversationId:t.sourceConversationId,sourceRevision:t.sourceRevision,instructionRevision:t.instructionRevision},c.request.recognizedText,c.request.inputMode,{requestId:input.revisedRequestId??c.request.requestId,after:c.request.after,instructionId:t.instructionId,evidenceIds:t.instruction.sourceEvidence,status:'pending',...(input.revisedRequestId?{revisesId:c.id}: {previewId:c.id,...(c.request.revisesId?{revisesId:c.request.revisesId}:{})})},input.revisedRequestId?c.request.requestId:undefined);}catch{throw new CorrectionDraftWriteError('No safe device slot is available for this correction.');}
}
export async function submitCorrectionLifecycle(input:{store:ReviewStore;context:CorrectionDraftContext;correction:SourceCorrection;action:UpdateCorrectionRequest['action'];id():string;submit(request:UpdateCorrectionRequest):Promise<SourceCorrection>}):Promise<{context:CorrectionDraftContext;receipt:SourceCorrection}>{
  const c=input.correction,t=c.request.target;if(c.learnerId!==input.context.learnerId)throw new CorrectionDraftWriteError('Wrong correction owner.');
  const mutation:UpdateCorrectionRequest={correctionId:c.id,requestId:input.id(),expectedVersion:c.version,action:input.action,...(input.action==='confirm'?{dependencyFingerprint:c.effects.dependencyFingerprint}:{})};let draft:CorrectionDraft;
  try{draft=await input.store.reserveCorrection({...input.context,sourceConversationId:t.sourceConversationId,sourceRevision:t.sourceRevision,instructionRevision:t.instructionRevision},c.request.recognizedText,c.request.inputMode,{requestId:c.request.requestId,after:c.request.after,instructionId:t.instructionId,evidenceIds:t.instruction.sourceEvidence,status:input.action==='skip'?'skipped':'pending',previewId:c.id,...(c.request.revisesId?{revisesId:c.request.revisesId}:{}),mutation});}catch{throw new CorrectionDraftWriteError('No safe device slot is available for this correction.');}
  const context:CorrectionDraftContext={kind:'correction',learnerId:draft.learnerId,sourceConversationId:draft.sourceConversationId,sourceRevision:draft.sourceRevision,instructionRevision:draft.instructionRevision,slot:draft.slot},receipt=await input.submit(draft.mutation!);
  if(receipt.id!==c.id||receipt.learnerId!==c.learnerId||JSON.stringify(receipt.request)!==JSON.stringify(c.request))throw new Error('Lifecycle receipt does not match its correction.');
  const event=receipt.reviewHistory.find(e=>e.requestId===draft.mutation!.requestId);if(!event||JSON.stringify(event.request)!==JSON.stringify(draft.mutation))throw new Error('Lifecycle receipt does not acknowledge the saved request UUID.');
  if(input.action==='confirm'||input.action==='undo')await input.store.clearCorrection(context,c.request.requestId);
  return {context,receipt};
}

/** Speech completion can arrive before the voice controller releases its busy UI. */
export function correctionEditAllowed(apiBusy:boolean,voiceBusy:boolean,inputMode:'voice'|'text'):boolean{return !apiBusy&&(inputMode==='voice'||!voiceBusy);}
