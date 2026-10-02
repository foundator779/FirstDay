import {learnerCredentialsSchema,signInRequestSchema,refreshSessionRequestSchema,signOutResponseSchema} from '@firstday/contracts';
import {FirstDayClientError,type FetchImplementation} from './api';
import type {LearnerAuth} from './session-controller';
export function liveApiOrigin(value:string,allowLoopbackHttp=false):string{
  try{const url=new URL(value);if((value===url.origin||value===`${url.origin}/`)&&!url.username&&!url.password&&(url.protocol==='https:'||allowLoopbackHttp&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return url.origin;}catch{/* Safe configuration failure. */}
  throw new FirstDayClientError('INVALID_STATE','Configure a trusted HTTPS API origin to sign in.');
}
export function createLearnerAuth({baseUrl,allowLoopbackHttp=false,fetchImplementation=fetch}:{baseUrl:string;allowLoopbackHttp?:boolean;fetchImplementation?:FetchImplementation}):LearnerAuth{
  const origin=liveApiOrigin(baseUrl,allowLoopbackHttp);
  async function request(path:string,body:object,token?:string){
    try{const response=await fetchImplementation(`${origin}/api/auth/${path}`,{method:'POST',redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',accept:'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});if(!response.ok)throw new Error();return await response.json() as unknown;}
    catch{throw new FirstDayClientError('UNAUTHENTICATED','Sign-in or server sign-out could not be confirmed.');}
  }
  return {async signIn(input){return learnerCredentialsSchema.parse(await request('sign-in',signInRequestSchema.parse(input)));},async refresh(refreshToken){return learnerCredentialsSchema.parse(await request('refresh',refreshSessionRequestSchema.parse({refreshToken})));},async signOut(token){signOutResponseSchema.parse(await request('sign-out',{},token));}};
}
