import { createHash, timingSafeEqual } from "node:crypto";

import { authTokenSchema, learnerCredentialsSchema, signInRequestSchema, uuidSchema, type LearnerCredentials, type SignInRequest } from "@firstday/contracts";
import { z } from "zod";

import { ApiError } from "./errors.js";

const SESSION_TOKEN_MAX = 16 * 1024;

export type SessionAccess = "all" | "fixtureOnly";

export type LearnerSession = {
  learnerId: string;
  access: SessionAccess;
};

export interface SessionVerifier {
  verify(token: string): Promise<LearnerSession>;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function validateToken(token: unknown): asserts token is string {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > SESSION_TOKEN_MAX ||
    token.trim() !== token ||
    /\s/u.test(token)
  ) {
    throw new ApiError("UNAUTHENTICATED");
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function createFixtureSessionVerifier(input: {
  token: string;
  learnerId: string;
}): SessionVerifier {
  validateToken(input.token);
  const learnerId = uuidSchema.parse(input.learnerId);
  const expected = digest(input.token);
  return {
    async verify(token) {
      validateToken(token);
      const matches = timingSafeEqual(digest(token), expected);
      if (!matches) throw new ApiError("UNAUTHENTICATED");
      return { learnerId, access: "fixtureOnly" };
    },
  };
}

export type SupabaseConnection = {supabaseUrl:string;anonKey:string;allowLocalHttp?:boolean;nodeEnv?:string;fetchImplementation?:FetchImplementation;timeoutMs?:number};

/** Exact origins prevent URL normalization from admitting confusing loopback aliases. */
export function supabaseOrigin(value:string, allowLocalHttp=false, nodeEnv?:string):string {
  try {
    const url=new URL(value);
    if(value!==url.origin&&value!==`${url.origin}/`)throw new Error();
    if(url.username||url.password||url.search||url.hash)throw new Error();
    if(url.protocol==='https:')return url.origin;
    if(url.protocol==='http:'&&allowLocalHttp&&nodeEnv==='development'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return url.origin;
  }catch{/* Safe configuration failure. */}
  throw new ApiError('INVALID_STATE');
}

export async function boundedAuthJson(response:Response,signal?:AbortSignal):Promise<unknown>{
  if(!response.ok||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))throw new ApiError('UNAUTHENTICATED');
  const reader=response.body?.getReader();if(!reader)throw new ApiError('UNAUTHENTICATED');
  const cancel=()=>{void reader.cancel().catch(()=>undefined);};
  signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)throw new Error();chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}
  catch{await reader.cancel().catch(()=>undefined);throw new ApiError('UNAUTHENTICATED');}
  finally{signal?.removeEventListener("abort",cancel);reader.releaseLock();}
}

function authTransport(input:SupabaseConnection){
  const origin=supabaseOrigin(input.supabaseUrl,input.allowLocalHttp,input.nodeEnv);validateToken(input.anonKey);
  const timeout=input.timeoutMs??5000;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new ApiError('INVALID_STATE');
  const request=input.fetchImplementation??fetch;
  return async(path:string,token:string,body?:object,json=true):Promise<unknown>=>{
    const controller=new AbortController();let response:Response|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();void response?.body?.cancel().catch(()=>undefined);reject(new ApiError('UNAUTHENTICATED'));},timeout);});
    const operation=(async()=>{response=await request(`${origin}/auth/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:input.anonKey,authorization:`Bearer ${token}`,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:controller.signal});if(!response.ok)throw new ApiError('UNAUTHENTICATED');return json?boundedAuthJson(response,controller.signal):true;})();
    try{return await Promise.race([operation,deadline]);}
    catch{throw new ApiError('UNAUTHENTICATED');}
    finally{clearTimeout(timer);void response?.body?.cancel().catch(()=>undefined);}
  };
}

export function createSupabaseSessionVerifier(input:SupabaseConnection):SessionVerifier{
  const request=authTransport(input);
  return {async verify(token){validateToken(token);try{const body=await request('user',token);const learnerId=uuidSchema.parse(typeof body==='object'&&body!==null&&!Array.isArray(body)?(body as Record<string,unknown>)['id']:undefined);return {learnerId,access:'all'};}catch{throw new ApiError('UNAUTHENTICATED');}}};
}

export interface AuthBroker {
  signIn(input:SignInRequest):Promise<LearnerCredentials>;
  refresh(refreshToken:string):Promise<LearnerCredentials>;
  signOut(accessToken:string):Promise<void>;
}
export function createSupabaseAuthBroker(input:SupabaseConnection&{ownerId:string}):AuthBroker{
  const owner=uuidSchema.parse(input.ownerId),request=authTransport(input),verifier=createSupabaseSessionVerifier(input);
  async function exchange(path:string,body:object):Promise<LearnerCredentials>{
    try{
      const raw=await request(path,input.anonKey,body);
      const parsed=z.object({access_token:authTokenSchema,refresh_token:authTokenSchema,expires_in:z.number().int().positive().max(86400),expires_at:z.number().int().positive().optional()}).parse(raw);
      const verified=await verifier.verify(parsed.access_token);
      if(verified.learnerId!==owner)throw new Error();
      return learnerCredentialsSchema.parse({accessToken:parsed.access_token,refreshToken:parsed.refresh_token,expiresAt:parsed.expires_at??Math.floor(Date.now()/1000)+parsed.expires_in,learnerId:verified.learnerId});
    }catch{throw new ApiError('UNAUTHENTICATED');}
  }
  return {signIn(credentials){return exchange('token?grant_type=password',signInRequestSchema.parse(credentials));},refresh(token){validateToken(token);return exchange('token?grant_type=refresh_token',{refresh_token:token});},async signOut(token){validateToken(token);await request('logout?scope=local',token,{},false);}};
}
