import {useMemo,useState,useSyncExternalStore} from 'react';
import {Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {createSessionController} from './session-controller';
import {createLearnerAuth} from './auth-client';
import {createFirstDayApiClient} from './api';
import {draftStorage} from './draft-storage';
import {DraftStorageContext} from './draft-context';
import {Action,ui} from './learner-panels';
import {KeyboardAwareScrollView} from './keyboard-scroll';
import type {PracticeClient} from './synthetic-client';
const API_URL=process.env.EXPO_PUBLIC_FIRSTDAY_API_URL??'';
const LOOPBACK=process.env.EXPO_PUBLIC_FIRSTDAY_ALLOW_LOOPBACK_HTTP==='1';
export function SignInForm({busy,error,onSubmit}:{busy:boolean;error:string|null;onSubmit(input:{email:string;password:string}):Promise<void>}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  function submit(){if(busy)return;const input={email:email.trim(),password};setPassword('');void onSubmit(input).catch(()=>{});}
  return <SafeAreaView style={{flex:1}}><KeyboardAwareScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={{padding:24,flexGrow:1,justifyContent:'center'}}><View style={[ui.paper,{maxWidth:520,width:'100%',alignSelf:'center'}]}><Text style={ui.blueLabel}>Your Bee training</Text><Text accessibilityRole='header' style={ui.label}>Sign in to FirstDay</Text><Text style={ui.body}>Use the learner account connected to this private Bee bridge. Signing out clears local answer drafts.</Text><Text style={ui.label}>Email</Text><TextInput accessibilityLabel='Learner email' autoCapitalize='none' autoCorrect={false} keyboardType='email-address' autoComplete='off' textContentType='none' maxLength={254} editable={!busy} style={ui.input} value={email} onChangeText={setEmail}/><Text style={ui.label}>Password</Text><TextInput accessibilityLabel='Learner password' secureTextEntry autoCapitalize='none' autoCorrect={false} autoComplete='off' textContentType='none' maxLength={1024} editable={!busy} style={ui.input} value={password} onChangeText={setPassword} onSubmitEditing={submit}/>{error&&<Text accessibilityRole='alert' style={ui.error}>{error}</Text>}<Action label={busy?'Signing in…':'Sign in'} disabled={busy||!email.trim()||!password} onPress={submit}/></View></KeyboardAwareScrollView></SafeAreaView>;
}
export function LiveSessionScreen({renderLearner}:{renderLearner(client:PracticeClient):React.ReactNode}){
  const controller=useMemo(()=>{try{return createSessionController({auth:createLearnerAuth({baseUrl:API_URL,allowLoopbackHttp:LOOPBACK}),clearDrafts:()=>draftStorage.clearAll()});}catch{return null;}},[]);
  return controller?<LiveSession controller={controller} renderLearner={renderLearner}/>:<SignInForm busy={false} error='Configure a trusted HTTPS API connection. A physical phone requires private HTTPS.' onSubmit={async()=>{}}/>;
}
function LiveSession({controller,renderLearner}:{controller:ReturnType<typeof createSessionController>;renderLearner(client:PracticeClient):React.ReactNode}){
  const snapshot=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const bound=useMemo(()=>{
    if(!snapshot.learnerId)return null;const generation=snapshot.generation,assert=()=>controller.assertCurrent(generation);
    return {client:createFirstDayApiClient({baseUrl:API_URL,live:true,allowLoopbackHttp:LOOPBACK,getSessionToken:()=>controller.accessToken(generation),assertSession:assert,onAuthFailure:()=>controller.authFailure(generation)}),drafts:draftStorage.lease(()=>{try{assert();return true;}catch{return false;}})};
  },[controller,snapshot.generation,snapshot.learnerId]);
  if(!bound||snapshot.phase!=='signedIn')return <SignInForm busy={snapshot.phase==='clearing'||snapshot.phase==='signingIn'} error={snapshot.error} onSubmit={controller.signIn}/>;
  return <DraftStorageContext.Provider key={snapshot.generation} value={bound.drafts}><View style={{flex:1}}><SafeAreaView edges={['top']} style={{paddingHorizontal:20,flexShrink:0}}><Action secondary maxFontSizeMultiplier={1.3} label='Sign out and clear device drafts' onPress={()=>void controller.signOut().catch(()=>{})}/></SafeAreaView>{renderLearner(bound.client)}</View></DraftStorageContext.Provider>;
}
