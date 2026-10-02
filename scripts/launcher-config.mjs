import {URL} from 'node:url';
const denied=/^(AWS_|BEDROCK_|SUPABASE_|FIRSTDAY_|BEE_|EXPO_PUBLIC_)/u;
const publicKeys=new Set(['EXPO_PUBLIC_FIRSTDAY_DATA_MODE','EXPO_PUBLIC_FIRSTDAY_AI_MODE','EXPO_PUBLIC_FIRSTDAY_API_MODE','EXPO_PUBLIC_FIRSTDAY_API_URL','EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN','EXPO_PUBLIC_FIRSTDAY_ALLOW_LOOPBACK_HTTP']);
export function expoEnvironment(inherited,values){
  const clean=Object.fromEntries(Object.entries(inherited).filter(([key,value])=>!denied.test(key)&&typeof value==='string'));
  for(const [key,value] of Object.entries(values)){if(!publicKeys.has(key)||typeof value!=='string')throw new Error('Invalid public configuration.');clean[key]=value;}
  if(clean.EXPO_PUBLIC_FIRSTDAY_DATA_MODE==='bee'&&clean.EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN!==undefined)throw new Error('Live sign-in is required.');
  return {...clean,EXPO_NO_DOTENV:'1'};
}
const runtimeKeys=new Set(['PATH','HOME','TMPDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','WINDIR','LANG','LC_ALL']);
export function bridgeEnvironment(inherited){return Object.fromEntries(Object.entries(inherited).filter(([key,value])=>typeof value==='string'&&(runtimeKeys.has(key)||key.startsWith('LC_')||key.startsWith('BEE_')||['FIRSTDAY_BEE_BRIDGE_TOKEN','FIRSTDAY_BEE_BRIDGE_PORT'].includes(key))));}
export function validateLiveLauncher({apiPort,bridgePort,expoPort,origin,loopback=false}){
  const ports=[apiPort,bridgePort,expoPort];if(ports.some(p=>!Number.isInteger(p)||p<1||p>65535)||new Set(ports).size!==3)throw new Error('Invalid local ports.');
  const url=new URL(origin);if((origin!==url.origin&&origin!==`${url.origin}/`)||url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||loopback&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Invalid mobile API origin.');
  if(url.protocol==='http:'&&url.port!==String(apiPort))throw new Error('Loopback API port mismatch.');return url.origin;
}
