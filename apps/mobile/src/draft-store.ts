import { z } from "zod";
import { correctionAnnotationSchema,updateCorrectionRequestSchema,createTranscriptHash, uuidSchema, sourceRevisionSchema, instructionRevisionSchema } from "@firstday/contracts";

export const draftContextSchema = z.object({ learnerId: uuidSchema, sourceConversationId: uuidSchema, practiceSetId: uuidSchema, scenarioId: uuidSchema, sourceRevision: sourceRevisionSchema, instructionRevision: instructionRevisionSchema }).strict();
export type DraftContext = z.infer<typeof draftContextSchema>;
export const understandingDraftContextSchema=z.object({kind:z.literal("understanding"),learnerId:uuidSchema,sourceConversationId:uuidSchema,instructionId:uuidSchema,sourceRevision:sourceRevisionSchema,instructionRevision:instructionRevisionSchema,phase:z.enum(["explanation","rehearsal"]),checkId:uuidSchema.optional()}).strict();
export type UnderstandingDraftContext=z.infer<typeof understandingDraftContextSchema>;
export const correctionDraftContextSchema=z.object({kind:z.literal('correction'),learnerId:uuidSchema,sourceConversationId:uuidSchema,sourceRevision:sourceRevisionSchema,instructionRevision:instructionRevisionSchema,slot:z.number().int().min(0).max(2)}).strict();
export type CorrectionDraftContext=z.infer<typeof correctionDraftContextSchema>;
export const correctionDraftMetadataSchema=z.object({requestId:uuidSchema,after:z.union([correctionAnnotationSchema,z.object({type:z.literal('attribution'),speakerName:z.string().max(500),speakerRole:z.string().max(500),preparation:z.enum(['retain','withhold'])}).strict(),z.object({type:z.literal('transcription'),correctedText:z.string().max(4000)}).strict(),z.object({type:z.literal('newRule'),changeId:z.string().max(36),laterSourceConversationId:z.string().max(36),laterSourceRevision:z.string().max(500)}).strict()]),instructionId:uuidSchema.optional(),evidenceIds:z.array(z.string().regex(/^evd_[a-f0-9]{64}$/)).max(100),status:z.enum(['pending','skipped']),previewId:uuidSchema.optional(),mutation:updateCorrectionRequestSchema.optional(),revisesId:uuidSchema.optional()}).strict();
export type CorrectionDraftMetadata=z.infer<typeof correctionDraftMetadataSchema>;
type AnyDraftContext=DraftContext|UnderstandingDraftContext|CorrectionDraftContext;
const anyContextSchema=z.union([draftContextSchema,understandingDraftContextSchema,correctionDraftContextSchema]);
const fields={text:z.string().max(4000),inputMode:z.enum(["text","voice"]),updatedAt:z.string().datetime()};
const understandingDraftSchema=understandingDraftContextSchema.extend({...fields,requestId:uuidSchema.optional()}).strict();
const correctionDraftSchema=correctionDraftContextSchema.extend({...fields,...correctionDraftMetadataSchema.shape}).strict();
export type CorrectionDraft=z.infer<typeof correctionDraftSchema>;
const draftSchema=z.union([draftContextSchema.extend(fields).strict(),understandingDraftSchema,correctionDraftSchema]);
const payloadSchema = z.object({ format: z.literal(1), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), drafts: z.array(draftSchema).max(20) }).strict();
const envelopeSchema = z.object({ payload: payloadSchema, checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Payload = z.infer<typeof payloadSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type UnderstandingDraft=z.infer<typeof understandingDraftSchema>;
export type DraftSlots = { read(slot: 0 | 1): Promise<string | null>; write(slot: 0 | 1, value: string): Promise<void>; remove(slot: 0 | 1): Promise<void> };
const identity = (context: AnyDraftContext) => JSON.stringify("kind" in context && context.kind==="correction"?correctionDraftContextSchema.parse({kind:context.kind,learnerId:context.learnerId,sourceConversationId:context.sourceConversationId,sourceRevision:context.sourceRevision,instructionRevision:context.instructionRevision,slot:context.slot}):"kind" in context ? understandingDraftContextSchema.parse({kind:context.kind,learnerId:context.learnerId,sourceConversationId:context.sourceConversationId,instructionId:context.instructionId,sourceRevision:context.sourceRevision,instructionRevision:context.instructionRevision,phase:context.phase,...(context.checkId?{checkId:context.checkId}:{})}) : draftContextSchema.parse({ learnerId: context.learnerId, sourceConversationId: context.sourceConversationId, practiceSetId: context.practiceSetId, scenarioId: context.scenarioId, sourceRevision: context.sourceRevision, instructionRevision: context.instructionRevision }));

/** Correction retry identities are retained until explicitly resolved/cleared. */
function boundedDrafts(drafts:Draft[]):Draft[] {
  const protectedDrafts=drafts.filter(d=>'kind' in d&&d.kind==='correction');
  if(protectedDrafts.length>20)throw new Error('Clear a saved correction before adding another device item.');
  const ordinary=drafts.filter(d=>!('kind' in d&&d.kind==='correction'));
  const capacity=20-protectedDrafts.length;
  if(capacity===0&&ordinary.length)throw new Error('Clear a saved correction before saving another device draft.');
  return [...protectedDrafts,...ordinary.slice(-capacity)];
}

export function createDraftStore(slots: DraftSlots, now = () => new Date().toISOString()) {
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation); tail = result.catch(() => {}); return result;
  }
  async function current() {
    const values = await Promise.all([slots.read(0), slots.read(1)]);
    const valid = values.flatMap((raw, slot) => {
      if (raw === null) return [];
      try {
        if (raw.length > 500_000) return [];
        const parsed = envelopeSchema.parse(JSON.parse(raw));
        if (createTranscriptHash(JSON.stringify(parsed.payload)) !== parsed.checksum) return [];
        if (new Set(parsed.payload.drafts.map(identity)).size !== parsed.payload.drafts.length) return [];
        return [{ slot: slot as 0 | 1, payload: parsed.payload }];
      } catch { return []; }
    }).sort((a, b) => b.payload.generation - a.payload.generation);
    if (!valid.length && values.some((v) => v !== null)) throw new Error("Saved drafts are damaged. Clear local drafts before saving again.");
    return valid[0] ?? { slot: 1 as const, payload: { format: 1 as const, generation: 0, drafts: [] } };
  }
  async function write(payload: Payload, slot: 0 | 1) {
    const value = JSON.stringify({ payload: payloadSchema.parse(payload), checksum: createTranscriptHash(JSON.stringify(payload)) });
    await slots.write(slot, value);
    if (await slots.read(slot) !== value) throw new Error("Draft could not be saved.");
  }
  const store = {
    load(context: AnyDraftContext) { return serialized(async () => {
      const saved = await current();
      return saved.payload.drafts.find((draft) => identity(draft) === identity(context)) ?? null;
    }); },
    loadCorrections(learnerId:string){return serialized(async()=>{uuidSchema.parse(learnerId);return (await current()).payload.drafts.filter((d):d is CorrectionDraft=>'kind' in d&&d.kind==='correction'&&d.learnerId===learnerId);});},
    reserveCorrection(context:CorrectionDraftContext,text:string,inputMode:'text'|'voice',metadata:CorrectionDraftMetadata,replacesRequestId?:string){return serialized(async()=>{
      const desired=correctionDraftContextSchema.parse(context),saved=await current(),owned=saved.payload.drafts.filter((d):d is CorrectionDraft=>'kind' in d&&d.kind==='correction'&&d.learnerId===desired.learnerId);
      const existing=owned.find(d=>d.requestId===metadata.requestId||replacesRequestId!==undefined&&(d.requestId===replacesRequestId||metadata.revisesId!==undefined&&d.revisesId===metadata.revisesId));
      if(existing&&(existing.sourceConversationId!==desired.sourceConversationId||existing.sourceRevision!==desired.sourceRevision||existing.instructionRevision!==desired.instructionRevision||existing.instructionId!==metadata.instructionId||JSON.stringify(existing.evidenceIds)!==JSON.stringify(metadata.evidenceIds)||existing.requestId!==metadata.requestId&&existing.previewId!==metadata.revisesId&&existing.revisesId!==metadata.revisesId))throw new Error('Saved correction identity does not match this review.');
      if(existing&&replacesRequestId&&existing.requestId!==metadata.requestId&&existing.requestId!==replacesRequestId)return existing;
      if(existing?.requestId===metadata.requestId&&(existing.text!==text.trim()||existing.inputMode!==inputMode||JSON.stringify(existing.after)!==JSON.stringify(metadata.after)))throw new Error('Saved correction UUID belongs to different content.');
      if(!existing&&owned.length>=3)throw new Error('Resolve or clear a saved uncertainty before reviewing another correction.');
      const selected=existing?.slot??[0,1,2].find(slot=>!owned.some(d=>d.slot===slot));if(selected===undefined)throw new Error('No free correction slot.');
      const oldMutation=existing?.requestId===metadata.requestId?existing.mutation:undefined,mutation=metadata.mutation&&oldMutation?.correctionId===metadata.mutation.correctionId&&oldMutation.action===metadata.mutation.action?oldMutation:metadata.mutation??oldMutation;
      const draft=correctionDraftSchema.parse({...desired,slot:selected,text:text.trim(),inputMode,updatedAt:now(),...metadata,...(mutation?{mutation}:{})}),remaining=saved.payload.drafts.filter(d=>!existing||identity(d)!==identity(existing));
      await write({format:1,generation:saved.payload.generation+1,drafts:boundedDrafts([...remaining,draft])},saved.slot===0?1:0);return draft;
    });},
    attachCorrectionPreview(context:CorrectionDraftContext,requestId:string,previewId:string){return serialized(async()=>{
      uuidSchema.parse(requestId);uuidSchema.parse(previewId);const saved=await current(),draft=saved.payload.drafts.find(d=>identity(d)===identity(context));if(!draft||!('kind' in draft)||draft.kind!=='correction'||draft.requestId!==requestId)throw new Error('Preview no longer matches the selected device item.');
      await write({...saved.payload,generation:saved.payload.generation+1,drafts:saved.payload.drafts.map(d=>d===draft?{...draft,previewId}:d)},saved.slot===0?1:0);
    });},
    clearCorrection(context:CorrectionDraftContext,requestId:string){return serialized(async()=>{
      uuidSchema.parse(requestId);const saved=await current(),draft=saved.payload.drafts.find(d=>identity(d)===identity(context));if(!draft)return;if(!('kind' in draft)||draft.kind!=='correction'||draft.requestId!==requestId)throw new Error('A different saved uncertainty cannot be cleared.');
      const payload={...saved.payload,generation:saved.payload.generation+1,drafts:saved.payload.drafts.filter(d=>d!==draft)};await write(payload,saved.slot===0?1:0);await write(payload,saved.slot);
    });},
    saveCorrection(context:CorrectionDraftContext,text:string,inputMode:'text'|'voice',metadata:CorrectionDraftMetadata){return serialized(async()=>{
      const draft=correctionDraftSchema.parse({...correctionDraftContextSchema.parse(context),...correctionDraftMetadataSchema.parse(metadata),text,inputMode,updatedAt:now()});
      const saved=await current(),remaining=saved.payload.drafts.filter(d=>identity(d)!==identity(draft));
      if(text&&remaining.filter(d=>'kind' in d&&d.kind==='correction'&&d.learnerId===context.learnerId).length>=3)throw new Error('An evening review holds up to three uncertainties. Resolve or clear an existing item first.');
      const payload:Payload={format:1,generation:saved.payload.generation+1,drafts:boundedDrafts([...remaining,...(text?[draft]:[])])};
      await write(payload,saved.slot===0?1:0);if(!text)await write(payload,saved.slot);
    });},
    save(context: AnyDraftContext, text: string, inputMode: "text" | "voice", requestId?:string) { return serialized(async () => {
      if("kind" in context&&context.kind==="correction")throw new Error("Use the correction draft metadata writer.");
      if(requestId!==undefined&&!("kind" in context))throw new Error("Request IDs belong to understanding drafts.");
      const draft = draftSchema.parse({ ...anyContextSchema.parse(context), text, inputMode, updatedAt: now(),...(requestId!==undefined?{requestId}:{}) });
      const saved = await current();
      const remaining = saved.payload.drafts.filter((item) => identity(item) !== identity(draft));
      const drafts = boundedDrafts([...remaining, ...(text ? [draft] : [])]);
      const payload: Payload = { format: 1, generation: saved.payload.generation + 1, drafts };
      await write(payload, saved.slot === 0 ? 1 : 0);
      if (!text) await write(payload, saved.slot);
    }); },
    clearOwner(learnerId: string) { return serialized(async () => {
      uuidSchema.parse(learnerId);
      const saved = await current();
      const payload: Payload = { ...saved.payload, generation: saved.payload.generation + 1, drafts: saved.payload.drafts.filter((d) => d.learnerId !== learnerId) };
      await write(payload, saved.slot === 0 ? 1 : 0);
      await write(payload, saved.slot);
    }); },
    clearAll() { return serialized(async () => {
      const results = await Promise.allSettled([slots.remove(0), slots.remove(1)]);
      if (results.some((r) => r.status === "rejected")) throw new Error("Some local drafts could not be cleared.");
    }); },
  };
  return {...store,lease(isCurrent:()=>boolean){
    return new Proxy(store,{get(target,key,receiver){const operation=Reflect.get(target,key,receiver) as unknown;if(typeof operation!=='function')return operation;return async(...args:unknown[])=>{if(!isCurrent())throw new Error('Session ended.');const result=await Reflect.apply(operation,target,args) as unknown;if(!isCurrent())throw new Error('Session ended.');return result;};}});
  }};
}
