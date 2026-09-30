import {spawn} from 'node:child_process';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {parseEnv} from 'node:util';
import {createServer} from 'node:net';
import {setTimeout} from 'node:timers/promises';
import process from 'node:process';
import {readApiRuntimeConfig} from '../services/api/src/config.ts';
import {readBridgeRuntimeConfig} from '../services/bee-bridge/src/index.ts';
import {expoEnvironment,bridgeEnvironment,validateLiveLauncher} from './launcher-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),children=[];let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
function launch(entry,args,env,cwd=root){const child=spawn(process.execPath,[...entry,...args],{cwd,env,stdio:'inherit',windowsHide:true});children.push(child);child.once('error',()=>{process.stderr.write('A live process could not start.\n');process.exitCode=1;stop();});child.once('exit',code=>{if(!stopping){process.exitCode=code??1;stop();}});return child;}
async function available(port){await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve()));});}
try{
  const arg=process.argv.find(value=>value.startsWith('--env-file='));
  const path=arg?arg.slice('--env-file='.length):fileURLToPath(new URL('../.env',import.meta.url));
  if(existsSync(path)&&(statSync(path).mode&0o077)!==0)throw new Error();
  const local=existsSync(path)?parseEnv(readFileSync(path,'utf8')):{};
  const environment={...process.env,...local};
  if(environment.FIRSTDAY_DATA_MODE!=='live'||environment.FIRSTDAY_STORAGE_MODE!=='supabase'||environment.FIRSTDAY_AI_PROVIDER!=='bedrock')throw new Error();
  const expoPort=Number(environment.FIRSTDAY_EXPO_PORT??'8087');
  const apiEnvironment={...environment,FIRSTDAY_API_ALLOWED_ORIGINS:`http://localhost:${expoPort},http://127.0.0.1:${expoPort}`};
  const config=readApiRuntimeConfig(apiEnvironment),bridge=readBridgeRuntimeConfig(environment);
  const origin=validateLiveLauncher({apiPort:config.port,bridgePort:bridge.port,expoPort,origin:environment.FIRSTDAY_MOBILE_API_URL??'',loopback:environment.NODE_ENV==='development'&&environment.FIRSTDAY_ALLOW_LOOPBACK_API_HTTP==='1'});
  const publicEnv=expoEnvironment(environment,{EXPO_PUBLIC_FIRSTDAY_DATA_MODE:'bee',EXPO_PUBLIC_FIRSTDAY_AI_MODE:'bedrock',EXPO_PUBLIC_FIRSTDAY_API_URL:origin,...(origin.startsWith('http:')?{EXPO_PUBLIC_FIRSTDAY_ALLOW_LOOPBACK_HTTP:'1'}:{})});
  await Promise.all([config.port,bridge.port,expoPort].map(available));
  if(process.argv.includes('--check'))process.stdout.write('Live configuration and loopback ports are valid.\n');
  else{
    launch(['--conditions=development','--import','tsx','services/bee-bridge/src/index.ts'],[],bridgeEnvironment(environment));
    const apiEnv={...apiEnvironment};for(const key of Object.keys(apiEnv))if(key.startsWith('EXPO_PUBLIC_')||key.startsWith('BEE_'))delete apiEnv[key];
    launch(['--conditions=development','--import','tsx','services/api/src/index.ts'],[],apiEnv);
    let ready=false;for(let attempt=0;attempt<40&&!stopping;attempt++){try{const r=await globalThis.fetch(`http://127.0.0.1:${config.port}/health`,{redirect:'error',signal:globalThis.AbortSignal.timeout(1000)});ready=r.ok;}catch{/* Startup remains bounded. */}if(ready)break;await setTimeout(250);}
    if(!ready)throw new Error();
    launch([fileURLToPath(new URL('../node_modules/expo/bin/cli',import.meta.url))],['start','--web','--localhost','--port',String(expoPort)],publicEnv,fileURLToPath(new URL('../apps/mobile/',import.meta.url)));
  }
}catch{process.stderr.write('Live startup failed. Check the private environment, owner, HTTPS connection and free local ports.\n');process.exitCode=1;stop();}
