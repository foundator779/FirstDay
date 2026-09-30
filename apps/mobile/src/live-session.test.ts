import {expect,it,vi} from 'vitest';
import {type FetchImplementation,createFirstDayApiClient} from './api.js';
import {createDraftStore} from './draft-store.js';
const id='70000000-0000-4000-8000-000000000001';
it('uses RAM session provider and discards old request results without retry',async()=>{let current=true;let finish!:(value:Response)=>void;const transport=vi.fn<FetchImplementation>(()=>new Promise<Response>(resolve=>{finish=resolve;}));const api=createFirstDayApiClient({baseUrl:'https://firstday.example',getSessionToken:async()=>{if(!current)throw Error('Session ended');return 'ram-token';},assertSession:()=>{if(!current)throw Error('Session ended');},fetchImplementation:transport});const pending=api.listConversations({sourceKind:'bee'});await Promise.resolve();await Promise.resolve();expect(transport.mock.calls[0]![1]).toMatchObject({headers:{authorization:'Bearer ram-token'}});current=false;finish(new Response(JSON.stringify({items:[],nextCursor:null})));await expect(pending).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);await expect(api.listConversations({sourceKind:'bee'})).rejects.toThrow();expect(transport).toHaveBeenCalledTimes(1);});
it('provides draft leases that cannot write after invalidation, including delayed saves',async()=>{const values:[string|null,string|null]=[null,null];let current=true;const store=createDraftStore({async read(slot){return values[slot];},async write(slot,value){values[slot]=value;},async remove(slot){values[slot]=null;}});const scoped=store.lease(()=>current),context={kind:'understanding' as const,learnerId:id,sourceConversationId:id,instructionId:id,sourceRevision:'r1',instructionRevision:'r1',phase:'explanation' as const};await scoped.save(context,'fictional old words','text');current=false;await store.clearAll();await expect(scoped.save(context,'late words','text')).rejects.toThrow();expect(values).toEqual([null,null]);});
it.each(['http://192.168.1.2:3000','http://127.1:3000','https://firstday.example?secret=x','https://user:password@firstday.example'])('rejects unsafe live API origin %s',baseUrl=>{expect(()=>createFirstDayApiClient({baseUrl,live:true,getSessionToken:async()=> 'ram'})).toThrow();});

it('invalidates suspended understanding/correction saves before they can send and clears all queued writes',async()=>{
 const {submitUnderstandingDraft}=await import('./understanding-drafts.js'),{submitCorrectionDraft}=await import('./correction-drafts.js');
 const values:[string|null,string|null]=[null,null];let current=true,release!:(value:void)=>void,writes=0;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const store=createDraftStore({async read(slot){return values[slot];},async write(slot,value){writes++;if(writes===1)await gate;values[slot]=value;},async remove(slot){values[slot]=null;}}),lease=store.lease(()=>current),submit=vi.fn(async()=>({}));
 const context={kind:'understanding' as const,learnerId:id,sourceConversationId:id,instructionId:id,sourceRevision:'r1',instructionRevision:'r1',phase:'explanation' as const};
 const pending=submitUnderstandingDraft({store:lease,context,text:'prior draft',inputMode:'text',requestId:id,submit});const rejected=expect(pending).rejects.toThrow();await vi.waitFor(()=>expect(writes).toBe(1));
 current=false;const clearing=store.clearAll();release();await rejected;await clearing;
 expect(submit).not.toHaveBeenCalled();expect(values).toEqual([null,null]);
 await expect(submitCorrectionDraft({store:lease,context:{kind:'correction',learnerId:id,sourceConversationId:id,sourceRevision:'r1',instructionRevision:'r1',slot:0},text:'late correction',inputMode:'text',metadata:{requestId:id,after:{type:'interpretation',meaning:'uncertain'},evidenceIds:[],status:'pending'},submit})).rejects.toThrow();
 expect(values).toEqual([null,null]);expect(submit).not.toHaveBeenCalled();
});
