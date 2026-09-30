import { describe, expect, it, vi } from 'vitest';
import { buildApiServer, deterministicScenarioEngine } from './server.js';
import { createDemoGateway } from './demo-server.js';
import { createMemoryRepository } from './memory-repository.js';
import { createFixtureInstructionExtractor } from './extraction.js';
import { type FetchImplementation, createSupabaseSessionVerifier } from './auth.js';
const owner='70000000-0000-4000-8000-000000000001',other='70000000-0000-4000-8000-000000000002';
const session={accessToken:'opaque-access',refreshToken:'opaque-refresh',expiresAt:2000000000,learnerId:owner};
function server(){const bee=createDemoGateway([]),repository=createMemoryRepository();const spies={bee:vi.spyOn(bee,'listConversations'),health:vi.spyOn(bee,'health'),repo:vi.spyOn(repository,'listSavedSources')};return {spies,api:buildApiServer({beeGateway:bee,repository,extractor:createFixtureInstructionExtractor(),scenarioEngine:deterministicScenarioEngine,ownerId:owner,sessionVerifier:{async verify(token){return {learnerId:token==='owner'?owner:other,access:'all'};}},authBroker:{async signIn(){return session;},async refresh(){return session;},async signOut(){}}})};}
describe('live auth boundary',()=>{
 it('offers exact bounded sign-in/refresh and uncached credentials',async()=>{const {api}=server();try{for(const [url,payload] of [['sign-in',{email:'learner@example.invalid',password:'fictional'}],['refresh',{refreshToken:'fictional'}]] as const){const r=await api.inject({method:'POST',url:`/api/auth/${url}`,payload});expect(r.statusCode).toBe(200);expect(r.json()).toEqual(session);expect(r.headers['cache-control']).toBe('no-store');}const bad=await api.inject({method:'POST',url:'/api/auth/sign-in',payload:{email:'learner@example.invalid',password:'x',ownerId:owner}});expect(bad.statusCode).toBe(422);const big=await api.inject({method:'POST',url:'/api/auth/sign-in',payload:{email:'learner@example.invalid',password:'x'.repeat(21000)}});expect(big.statusCode).toBe(422);}finally{await api.close();}});
 it('blocks verified non-owner before Bee/repository and keeps health dependency-free',async()=>{const {api,spies}=server();try{for(const url of ['/api/bee/conversations?sourceKind=bee','/api/source-conversations?sourceKind=bee']){const r=await api.inject({method:'GET',url,headers:{authorization:'Bearer other'}});expect(r.statusCode).toBe(403);}expect((await api.inject('/health')).statusCode).toBe(200);Object.values(spies).forEach(spy=>expect(spy).not.toHaveBeenCalled());}finally{await api.close();}});
 it('uses genuine opted-in development loopback Auth without rewriting protocols',async()=>{const request=vi.fn<FetchImplementation>(async()=>new Response(JSON.stringify({id:owner}),{headers:{'content-type':'application/json'}}));const verifier=createSupabaseSessionVerifier({supabaseUrl:'http://127.0.0.1:55321',anonKey:'fictional',allowLocalHttp:true,nodeEnv:'development',fetchImplementation:request});expect((await verifier.verify('fictional')).learnerId).toBe(owner);expect(String(request.mock.calls[0]![0])).toBe('http://127.0.0.1:55321/auth/v1/user');});
});

it('bounds hostile Auth streams and verifies UUID independently of token response claims',async()=>{
 const {createSupabaseAuthBroker}=await import('./auth.js');let calls=0;
 const broker=createSupabaseAuthBroker({supabaseUrl:'https://fictional.supabase.co',anonKey:'fictional',ownerId:owner,fetchImplementation:async(_input,init)=>{expect(init?.redirect).toBe('error');calls++;return new Response(JSON.stringify(calls===1?{access_token:'fictional',refresh_token:'fictional',expires_in:3600,user:{id:owner}}:{id:other,user_metadata:{ownerId:owner},email:'owner@example.invalid'}),{headers:{'content-type':'application/json'}});}});
 await expect(broker.signIn({email:'owner@example.invalid',password:'fictional'})).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(calls).toBe(2);
 const tooLarge=createSupabaseSessionVerifier({supabaseUrl:'https://fictional.supabase.co',anonKey:'fictional',fetchImplementation:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));controller.close();}}),{headers:{'content-type':'application/json'}})});
 await expect(tooLarge.verify('fictional')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('enforces an absolute Auth deadline even when a transport/stream does not settle',async()=>{
 const verifier=createSupabaseSessionVerifier({supabaseUrl:'https://fictional.supabase.co',anonKey:'fictional',timeoutMs:10,fetchImplementation:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})});
 await expect(verifier.verify('fictional')).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('never accepts login credentials or refresh tokens in URL query parameters',async()=>{const {api}=server();try{const response=await api.inject({method:'POST',url:'/api/auth/sign-in?email=fictional%40example.invalid&password=fictional',headers:{authorization:'Bearer owner'},payload:{}});expect(response.statusCode).toBe(422);}finally{await api.close();}});
