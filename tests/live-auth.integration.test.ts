import {readFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
import {beeSourceSchema,learnerCredentialsSchema} from '@firstday/contracts';
import bookshop from '../fixtures/transcripts/bookshop-onboarding.json' with {type:'json'};
import {createProductionApiServer,readApiRuntimeConfig} from '../services/api/src/index.js';
import {initialFirstDayState,reduceFirstDayState} from '../apps/mobile/src/state.js';
import {createSessionController} from '../apps/mobile/src/session-controller.js';
import {createLearnerAuth} from '../apps/mobile/src/auth-client.js';
import {createDraftStore} from '../apps/mobile/src/draft-store.js';
import {createFirstDayApiClient} from '../apps/mobile/src/api.js';
import type {BeeGateway} from '../services/api/src/bee-gateway.js';
const path=process.env['FIRSTDAY_TEST_SUPABASE_STATUS_FILE'];
const settings=path?z.object({API_URL:z.literal('http://127.0.0.1:55321'),ANON_KEY:z.string(),SERVICE_ROLE_KEY:z.string(),JWT_SECRET:z.string()}).parse(JSON.parse(readFileSync(path,'utf8'))):undefined;
it.skipIf(!settings)('uses actual local GoTrue broker and durable PostgREST across restart; denies every non-owner operation before source/model/storage',async()=>{
 const s=settings!,accounts:string[]=[];
 async function admin(path:string,body?:object,method='POST'){return fetch(`${s.API_URL}/auth/v1/admin/${path}`,{method,redirect:'error',headers:{apikey:s.SERVICE_ROLE_KEY,authorization:`Bearer ${s.SERVICE_ROLE_KEY}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
 async function account(){const email=`firstday-connect-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID(),response=await admin('users',{email,password,email_confirm:true});expect(response.ok).toBe(true);const {id}=z.object({id:z.string().uuid()}).parse(await response.json());accounts.push(id);return {id,email,password};}
 const owner=await account(),other=await account();
 const source=beeSourceSchema.parse({...bookshop,sourceKind:'bee',id:`fictional-connect-${randomUUID()}`});
 const gateway:BeeGateway={health:vi.fn(async()=>({authenticated:true})),listConversations:vi.fn(async()=>({items:[{id:source.id,title:source.title,sourceKind:source.sourceKind,startedAt:source.startedAt,status:source.status,revision:source.revision}],nextCursor:null})),getConversation:vi.fn(async()=>({conversation:source}))};
 const accesses:string[]=[];
 const config=readApiRuntimeConfig({NODE_ENV:'development',FIRSTDAY_DATA_MODE:'live',FIRSTDAY_STORAGE_MODE:'supabase',FIRSTDAY_AI_PROVIDER:'bedrock',AWS_BEARER_TOKEN_BEDROCK:'ABSKfictional',FIRSTDAY_BEE_OWNER_ID:owner.id,FIRSTDAY_BEE_BRIDGE_TOKEN:'fictional-bridge-token-at-least-thirty-two-characters',SUPABASE_URL:s.API_URL,SUPABASE_ANON_KEY:s.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:s.SERVICE_ROLE_KEY,FIRSTDAY_ALLOW_LOCAL_SUPABASE_HTTP:'1'});
 const start=()=>createProductionApiServer(config,{beeGateway:gateway,bedrockFetchImplementation:async()=>{throw new Error('No actual provider call is allowed in this test');},fetchImplementation(input,init){accesses.push(new URL(String(input)).pathname);return fetch(input,init);}});
 let api=start();
 async function call(url:string,payload?:object,token?:string,method=payload?'POST':'GET'){return api.inject({url,method:method as 'GET'|'POST'|'PATCH',...(payload?{payload}:{}),...(token?{headers:{authorization:`Bearer ${token}`}}:{})});}
 try{
  const login=await call('/api/auth/sign-in',{email:owner.email,password:owner.password});expect(login.statusCode).toBe(200);const credentials=learnerCredentialsSchema.parse(login.json());expect(credentials.learnerId).toBe(owner.id);expect(login.headers['cache-control']).toBe('no-store');
  const rejected=await call('/api/auth/sign-in',{email:other.email,password:other.password});expect(rejected.statusCode).toBe(401);expect(Object.keys(rejected.json())).toEqual(['error']);
  const otherLogin=await fetch(`${s.API_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:s.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email:other.email,password:other.password})});const otherTokens=z.object({access_token:z.string(),refresh_token:z.string()}).parse(await otherLogin.json());
  expect((await call('/api/auth/refresh',{refreshToken:otherTokens.refresh_token})).statusCode).toBe(401);
  const refresh=await call('/api/auth/refresh',{refreshToken:credentials.refreshToken});expect(refresh.statusCode).toBe(200);const refreshed=learnerCredentialsSchema.parse(refresh.json());
  const imported=await call('/api/imports',{beeSourceId:source.id,sourceKind:'bee',sourceRevision:source.revision,consent:{confirmed:true}},refreshed.accessToken);expect(imported.statusCode).toBe(201);const id=z.object({sourceConversation:z.object({id:z.string().uuid()})}).parse(imported.json()).sourceConversation.id;
  await api.close();api=start();
  const restored=await call(`/api/source-conversations/${id}/session`,undefined,refreshed.accessToken);expect(restored.statusCode).toBe(200);expect(restored.json().source.transcript).toBe(source.transcript);
  const uu=randomUUID(),routes:[string,string,object|undefined][]=[['GET','/api/bee/conversations?sourceKind=bee',undefined],['GET',`/api/bee/conversations/${source.id}?sourceKind=bee`,undefined],['POST','/api/imports',{}],['GET','/api/source-conversations?sourceKind=bee',undefined],['GET',`/api/source-conversations/${id}/session`,undefined],['POST',`/api/source-conversations/${id}/extract`,{}],['PATCH',`/api/instructions/${uu}`,{}],['POST','/api/practice-sets',{}],['GET',`/api/practice-sets/${uu}`,undefined],['POST',`/api/scenarios/${uu}/attempts`,{}],['POST','/api/source-corrections/preview',{}],['PATCH',`/api/source-corrections/${uu}`,{}],['GET',`/api/source-conversations/${id}/corrections`,undefined],['POST','/api/understanding-checks',{}],['PATCH',`/api/understanding-checks/${uu}`,{}],['GET',`/api/source-conversations/${id}/understanding-checks?historical=true`,undefined],['POST',`/api/source-conversations/${id}/compare`,{}],['POST',`/api/changes/${uu}/confirm`,{}],['POST',`/api/source-conversations/${id}/consent/revoke`,{}],['POST','/api/open-questions',{}],['PATCH',`/api/open-questions/${uu}`,{}]];
  accesses.length=0;vi.mocked(gateway.getConversation).mockClear();vi.mocked(gateway.listConversations).mockClear();
  for(const [method,url,body] of routes)expect((await call(url,body,otherTokens.access_token,method)).statusCode).toBe(403);
  expect(accesses).toHaveLength(routes.length);expect(accesses.every(p=>p==='/auth/v1/user')).toBe(true);expect(gateway.getConversation).not.toHaveBeenCalled();expect(gateway.listConversations).not.toHaveBeenCalled();expect(gateway.health).not.toHaveBeenCalled();
  const [header,payload]=refreshed.accessToken.split('.'),claims=JSON.parse(Buffer.from(payload!,'base64url').toString()) as Record<string,unknown>;claims['exp']=Math.floor(Date.now()/1000)-100;const expiredPayload=Buffer.from(JSON.stringify(claims)).toString('base64url'),message=`${header}.${expiredPayload}`,expired=`${message}.${createHmac('sha256',s.JWT_SECRET).update(message).digest('base64url')}`;
  for(const token of ['malformed',expired])expect((await call('/api/source-conversations?sourceKind=bee',undefined,token)).statusCode).toBe(401);
  expect((await call('/api/auth/refresh',{refreshToken:'malformed'})).statusCode).toBe(401);
  expect((await call('/api/auth/sign-out',{},refreshed.accessToken)).statusCode).toBe(200);
  expect((await call('/api/auth/refresh',{refreshToken:refreshed.refreshToken})).statusCode).toBe(401);

  const values:[string|null,string|null]=[null,null],drafts=createDraftStore({async read(slot){return values[slot];},async write(slot,value){values[slot]=value;},async remove(slot){values[slot]=null;}});
  let releaseRefresh!:()=>void,refreshArrived!:()=>void,expiresAt=0,fakeNow=Date.now();
  const heldRefresh=new Promise<void>(resolve=>{releaseRefresh=resolve;}),arrived=new Promise<void>(resolve=>{refreshArrived=resolve;});
  const broker=createLearnerAuth({baseUrl:'http://127.0.0.1:3000',allowLoopbackHttp:true,async fetchImplementation(input,init){const path=new URL(input).pathname;const response=await api.inject({method:'POST',url:path,headers:init?.headers as Record<string,string>,payload:init?.body as string});if(path==='/api/auth/refresh'){refreshArrived();await heldRefresh;}return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});}});
  const controller=createSessionController({auth:{...broker,async signIn(input){const signed=await broker.signIn(input);expiresAt=signed.expiresAt;return signed;}},clearDrafts:()=>drafts.clearAll(),now:()=>fakeNow});
  await controller.signIn({email:owner.email,password:owner.password});const gen=controller.snapshot().generation,lease=drafts.lease(()=>{try{controller.assertCurrent(gen);return true;}catch{return false;}}),context={kind:'understanding' as const,learnerId:owner.id,sourceConversationId:id,instructionId:randomUUID(),sourceRevision:source.revision,instructionRevision:'fictional-r1',phase:'explanation' as const};
  await lease.save(context,'fictional old learner answer','text',randomUUID());fakeNow=expiresAt*1000-1000;
  const refreshOne=controller.accessToken(gen),refreshTwo=controller.accessToken(gen),rejectedOne=expect(refreshOne).rejects.toThrow(),rejectedTwo=expect(refreshTwo).rejects.toThrow();await arrived;
  await controller.signOut();expect(controller.snapshot().learnerId).toBeNull();expect(values).toEqual([null,null]);releaseRefresh();await rejectedOne;await rejectedTwo;
  await expect(lease.save(context,'late answer','text')).rejects.toThrow();expect(values).toEqual([null,null]);
  fakeNow=Date.now();await expect(controller.signIn({email:other.email,password:other.password})).rejects.toThrow();expect(controller.snapshot().learnerId).toBeNull();await controller.signIn({email:owner.email,password:owner.password});
  const active=controller.snapshot().generation,liveClient=createFirstDayApiClient({baseUrl:'http://127.0.0.1:3000',live:true,allowLoopbackHttp:true,getSessionToken:()=>controller.accessToken(active),assertSession:()=>controller.assertCurrent(active),onAuthFailure:()=>controller.authFailure(active),async fetchImplementation(input,init){const url=new URL(input),response=await api.inject({method:init?.method as 'GET'|'POST'|'PATCH',url:url.pathname+url.search,headers:init?.headers as Record<string,string>,...(init?.body?{payload:init.body as string}:{})});return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});}});
  expect((await liveClient.getSourceSession(id)).sourceConversation.learnerId).toBe(owner.id);
  const health=await liveClient.health();expect(health.beeBridge).toBe('unavailable');
  const listed=await liveClient.listConversations({sourceKind:'bee'});
  const picker=reduceFirstDayState(initialFirstDayState,{type:'picker/loadSucceeded',health,conversations:listed.items,authenticatedList:true});
  expect(picker.picker).toMatchObject({phase:'ready',authenticatedList:true,bridgeStatus:'unavailable'});expect(picker.picker.conversations.map(item=>item.id)).toEqual([source.id]);
  await controller.signOut();await expect(liveClient.getSourceSession(id)).rejects.toThrow();
  // GoTrue may continue accepting the old access JWT until expiry; no immediate invalidation claim.
 }finally{await api.close();for(const id of accounts){const response=await admin(`users/${id}`,undefined,'DELETE');expect(response.ok).toBe(true);}}
});
