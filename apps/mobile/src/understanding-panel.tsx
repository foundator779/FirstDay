import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { UnderstandingCheck, UnderstandingBundle, SourceEvidence, InstructionCard, SourceConversation, OpenQuestion, UpdateUnderstandingRequest } from "@firstday/contracts";
import { understandingClarificationQuestion, understandingPrompt, understandingActiveAction } from "@firstday/scenario-engine";
import { Action, EvidenceNotes, ui } from "./learner-panels";
import { VoiceRehearsal } from "./voice-rehearsal";
import type { PracticeClient } from "./synthetic-client";
import { hasUnderstandingClient } from "./understanding-client";
import { useDraftStorage } from "./draft-context";
import type { UnderstandingDraftContext } from "./draft-store";
import { recoverUnderstandingDraft, submitUnderstandingDraft, UnderstandingDraftWriteError } from "./understanding-drafts";

export function UnderstandingComparison({check,evidence,busy,onContext,onConfirm,onDispute,onReopen}:{check:UnderstandingCheck;evidence:SourceEvidence[];busy:boolean;onContext(index:number,value:boolean|null):void;onConfirm():void;onDispute():void;onReopen():void}) {
  const selectedException=check.instruction.exceptions[check.initialComparison.exceptionIndex ?? 0];
  const temporal=/new reservations/i.test(check.instruction.expectedAction)&&!!selectedException&&/reservations already made/i.test(selectedException);
  return <View style={ui.paper}>
    <Text style={ui.blueLabel}>Your intended action, beside the source</Text>
    <Text selectable style={ui.inkBody}>{check.explanation}</Text><Text style={ui.meta}>Action being compared: {check.initialComparison.answerQuote}</Text>
    <Text style={ui.meta}>Your words · {check.inputMode === "voice" ? "spoken and reviewed" : "typed"}. This explanation has no grade.</Text>
    <View style={ui.divider}><Text style={ui.label}>Confirmed action</Text><Text selectable style={ui.body}>{check.instruction.expectedAction}</Text></View>
    {check.instruction.exceptions.length>0 && <><Text style={ui.label}>Possible mismatch to clarify</Text><Text style={ui.body}>{temporal ? `Your planned action “${check.initialComparison.answerQuote}” may need to change depending on whether the reservation was already made. The confirmed action is “${check.instruction.expectedAction}”; the source exception is “${selectedException}”. We need that context before comparing your action.` : "Your intended action may need to change if a source exception applies. Check each condition before comparing it."}</Text></>}
    {check.instruction.exceptions.map((exception,index)=><View key={index} style={ui.divider}>
      <Text selectable style={ui.inkBody}>{exception}</Text>
      <Text style={ui.blueLabel}>{understandingClarificationQuestion(check.instruction,index)}</Text>
      <Text style={ui.meta}>{check.applicability[index]===null?"Context is unknown. Rehearsal is paused.":check.applicability[index]?"You said this exception applies.":"You said this exception does not apply."}</Text>
      {check.status!=="disputed"&&<View style={ui.gap}>{([{label:"Yes, this exception applies",value:true},{label:"No, it does not apply",value:false},{label:"I don’t know yet",value:null}] as const).map(choice=><Action key={choice.label} secondary disabled={busy} label={choice.label} onPress={()=>onContext(index,choice.value)} />)}</View>}
    </View>)}
    <EvidenceNotes items={evidence}/>
    {check.status==="readyForConfirmation"&&<><Text style={ui.body}>Use the context you supplied for rehearsal? This confirms your situation; the original source stays unchanged.</Text><Action disabled={busy} label="Use this context for rehearsal" onPress={onConfirm}/></>}
    {check.status==="disputed"?<><Text accessibilityRole="alert" style={ui.body}>Grading this instruction is paused. Review the original source or request a correction. Creating another check does not clear this dispute.</Text><Action secondary disabled={busy} label="Reopen after reviewing the source" onPress={onReopen}/></>:<Action secondary disabled={busy} label="The source or interpretation needs review" onPress={onDispute}/>}
  </View>;
}

let sequence=0;
// These public request IDs only deduplicate retries; they confer no authorization.
export function understandingRequestId():string {
  const random=()=>Math.floor(Math.random()*0x10000).toString(16).padStart(4,"0");
  const time=(Date.now()+sequence++).toString(16).padStart(12,"0").slice(-12);
  return `${random()}${random()}-${random()}-4${random().slice(1)}-a${random().slice(1)}-${time}`;
}

type UnderstandingAction<T=UpdateUnderstandingRequest>=T extends UpdateUnderstandingRequest?Omit<T,"checkId"|"expectedVersion">:never;
const EMPTY_QUESTIONS:OpenQuestion[]=[];
type Props={client:PracticeClient;source:SourceConversation;instructions:InstructionCard[];instructionRevision:string;isVisible:boolean;aiMode:"offline"|"bedrock";onExit():void;onCorrect?():void;onQuestionSaved?(question:OpenQuestion):void;questions?:OpenQuestion[]};
export function UnderstandingPanel({client,source,instructions,instructionRevision,isVisible,aiMode,onExit,onCorrect,onQuestionSaved,questions=EMPTY_QUESTIONS}:Props){
  const draftStorage=useDraftStorage();
  const [selectedId,setSelectedId]=useState(instructions[0]?.id??"");
  const [items,setItems]=useState<UnderstandingBundle[]>([]);
  const [current,setCurrent]=useState<UnderstandingBundle|null>(null);
  const [answer,setAnswer]=useState("");const [mode,setMode]=useState<"text"|"voice">("text");
  const [privateQuestions,setPrivateQuestions]=useState(questions);
  const [resolutions,setResolutions]=useState<Record<string,string>>({});
  const [sourceReview,setSourceReview]=useState(false);
  const [question,setQuestion]=useState("");const [message,setMessage]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[voiceBusy,setVoiceBusy]=useState(false),[loaded,setLoaded]=useState(false),[draftReady,setDraftReady]=useState(false);
  const [error,setError]=useState<string|null>(null);const lock=useRef(false),requestId=useRef(understandingRequestId()),active=useRef(true);
  const instruction=instructions.find(r=>r.id===selectedId),check=current?.check;
  const phase=check?.status==="readyToRehearse"?"rehearsal":"explanation";
  const context:UnderstandingDraftContext|null=instruction?{kind:"understanding",learnerId:source.learnerId,sourceConversationId:source.id,instructionId:instruction.id,sourceRevision:source.sourceRevision,instructionRevision,phase,...(check&&phase==="rehearsal"?{checkId:check.id}:{})}:null;
  const contextKey=JSON.stringify(context);
  useEffect(()=>{setPrivateQuestions(questions);},[questions]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{let cancelled=false;setLoaded(false);if(!hasUnderstandingClient(client))return;void client.listUnderstanding(source.id).then(result=>{if(cancelled)return;setItems(result.items);const latest=result.items.at(-1);if(latest){setSelectedId(latest.check.instruction.id);setCurrent(latest);}setLoaded(true);}).catch(()=>{if(!cancelled)setError("Saved understanding checks could not be loaded. Return to training and retry before continuing.");});return()=>{cancelled=true;};},[client,source.id]);
  useEffect(()=>{let cancelled=false;setDraftReady(false);setAnswer("");setMode("text");if(!loaded||contextKey==="null")return;const identity=JSON.parse(contextKey) as UnderstandingDraftContext;void recoverUnderstandingDraft({context:identity,bundles:items,store:draftStorage,id:understandingRequestId}).then(recovered=>{if(cancelled)return;requestId.current=recovered.requestId;if(recovered.committed){setCurrent(recovered.committed);setMessage(recovered.clearFailed?"Your answer was already saved. Clear local drafts in About to remove the device copy.":"Your answer was already saved. Its record was restored without submitting it again.");}else if(recovered.draft){setAnswer(recovered.draft.text);setMode(recovered.draft.inputMode);setMessage("Your unsubmitted explanation and retry identity were restored from this device.");}}).catch(()=>{if(!cancelled)setMessage("The local draft could not be restored. You can type a new explanation.");}).finally(()=>{if(!cancelled)setDraftReady(true);});return()=>{cancelled=true;};},[contextKey,loaded,items]);
  if(!hasUnderstandingClient(client))return <View style={ui.paper}><Text style={ui.body}>Understanding checks need the current FirstDay connection.</Text><Action label="Back to practice" onPress={onExit}/></View>;
  const connected=client;
  async function run(operation:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError(null);try{await operation();}catch(error){if(active.current)setError(error instanceof UnderstandingDraftWriteError?"Your answer could not be saved on this device, so it was not sent. Retry or clear local drafts in About.":"This step could not finish. Your saved check is retained. Reload it before retrying if another session changed it.");}finally{lock.current=false;if(active.current)setBusy(false);}}
  function accept(bundle:UnderstandingBundle){if(!active.current)return;setCurrent(bundle);setItems(previous=>[...previous.filter(v=>v.check.id!==bundle.check.id),bundle]);}
  function edit(text:string,inputMode:"text"|"voice"){if(lock.current)return;setAnswer(text);setMode(inputMode);if(text!==answer||inputMode!==mode)requestId.current=understandingRequestId();if(context)void draftStorage.save(context,text,inputMode,requestId.current).catch(()=>{if(active.current)setMessage("Your words are here, but the device draft could not be saved.");});}
  async function update(input:UnderstandingAction){if(!check)return;accept(await connected.updateUnderstanding({...input,checkId:check.id,expectedVersion:check.version}));}
  async function submit(){
    if(!instruction||!context||!answer.trim()||!draftReady||voiceBusy||(check&&check.status!=="readyToRehearse"))return;
    const text=answer.trim(),inputMode=mode,pendingId=requestId.current;
    const result=await submitUnderstandingDraft({context,text,inputMode,requestId:pendingId,store:draftStorage,submit:()=>check?
      connected.updateUnderstanding({action:"rehearse",requestId:pendingId,responseText:text,inputMode,checkId:check.id,expectedVersion:check.version}):
      connected.createUnderstanding({instructionId:instruction.id,sourceRevision:instruction.sourceRevision,instructionRevision,explanation:text,inputMode,requestId:pendingId})});
    accept(result);
    await draftStorage.save(context,"","text").catch(()=>{if(active.current)setMessage("Submitted, but the device draft could not be cleared. Clear local drafts in About.");});
    if(active.current){setAnswer("");requestId.current=understandingRequestId();}
  }
  async function saveQuestion(){if(!check||!question.trim())return;if(check.status!=="disputed")await update({action:"dispute"});const result=await client.createOpenQuestion({sourceConversationId:source.id,sourceRevision:source.sourceRevision,instructionId:check.instruction.id,question:question.trim(),sourceEvidence:check.instruction.sourceEvidence,shareConsent:false});setPrivateQuestions(previous=>[...previous.filter(q=>q.id!==result.openQuestion.id),result.openQuestion]);onQuestionSaved?.(result.openQuestion);setMessage("Private trainer question saved. Nothing was sent to anyone. Your understanding check is retained for source review.");setQuestion("");}
  async function closeQuestion(question:OpenQuestion,status:"resolved"|"dismissed"){
    const resolution=resolutions[question.id]?.trim();if(!resolution||!client.updateOpenQuestion)return;
    const result=await client.updateOpenQuestion({openQuestionId:question.id,sourceRevision:question.sourceRevision,status,resolution,shareConsent:false});
    setPrivateQuestions(previous=>previous.map(q=>q.id===result.openQuestion.id?result.openQuestion:q));onQuestionSaved?.(result.openQuestion);setMessage("Your private clarification was saved. Original source policy is unchanged. Reopen the disputed check and supply its context before rehearsing.");
  }
  return <View style={ui.section}>
    <Text accessibilityRole="header" style={ui.title}>Check what you understood</Text>
    <Text style={ui.body}>Explain what you would do. Compare it with the source, clarify the situation, then rehearse the distinction.</Text>
    <Text style={ui.meta}>{aiMode==="offline"?"Fictional preview · conservative comparison, no mastery score. Connected checks can be reopened; offline example progress is temporary.":"Source-backed Nova comparison · no mastery score."}</Text>
    {loaded&&<View style={ui.gap}>{instructions.map(rule=><Action key={rule.id} secondary disabled={busy||voiceBusy} label={`${selectedId===rule.id?"Selected: ":""}${rule.situation}`} onPress={()=>{setSelectedId(rule.id);setCurrent(items.filter(v=>v.check.instruction.id===rule.id).at(-1)??null);setMessage(null);}}/>)}</View>}
    {!!items.length&&<View style={ui.paper}><Text style={ui.label}>Saved explanation checks</Text>{items.map(item=><Action key={item.check.id} secondary disabled={busy||voiceBusy} label={`${item.check.status==="disputed"?"Needs source review":"Reopen check"}: ${item.check.explanation.slice(0,80)}`} onPress={()=>{setCurrent(item);setSelectedId(item.check.instruction.id);}}/>)}</View>}
    {current&&<UnderstandingComparison check={current.check} evidence={current.sourceEvidence} busy={busy||voiceBusy} onContext={(index,value)=>void run(async()=>{const applicability=[...current.check.applicability];applicability[index]=value;await update({action:"clarify",applicability});})} onConfirm={()=>void run(()=>update({action:"confirmInterpretation"}))} onDispute={()=>void run(()=>update({action:"dispute"}))} onReopen={()=>void run(()=>update({action:"reopen"}))}/>}
    {(!check||check.status==="readyToRehearse")&&loaded&&instruction&&<View style={ui.paper}>
      <Text style={ui.blueLabel}>{check?"Rehearse the distinction":"What would you do, and why?"}</Text>
      {check&&<><Text style={ui.body}>{understandingPrompt(check)}</Text><Text style={ui.label}>Action for the context you supplied</Text><Text style={ui.body}>{understandingActiveAction(check)}</Text><Text style={ui.meta}>Use this action for the situation you confirmed. The complete policy and source are available above.</Text></>}
      <VoiceRehearsal active={isVisible&&!busy&&draftReady} prompt={check?understandingPrompt(check)!:`${instruction.situation}. What would you do, and why?`} onTranscript={text=>edit(text,"voice")} onBusy={setVoiceBusy}/>
      <TextInput accessibilityLabel={check?"Focused rehearsal answer":"Your intended action and reason"} multiline maxLength={4000} editable={!busy&&!voiceBusy&&draftReady} value={answer} onChangeText={text=>edit(text,"text")} style={ui.input} placeholder="Explain the action in your own words"/>
      <Action disabled={busy||voiceBusy||!draftReady||!answer.trim()} label={check?"Compare my rehearsal with the source":"Compare my intended action"} onPress={()=>void run(submit)}/>
    </View>}
    {sourceReview&&current&&<View style={ui.paper}><Text style={ui.blueLabel}>Review the original source</Text><Text style={ui.body}>{source.title}</Text><Text style={ui.meta}>Source revision: {source.sourceRevision} · Instruction revision: {current.check.instructionRevision}</Text><EvidenceNotes items={current.sourceEvidence}/><Text style={ui.body}>These original quotes remain unchanged. If a quote or its interpretation is wrong, keep this instruction disputed until source correction review resolves it.</Text><Action secondary label="Return to the context check" onPress={()=>setSourceReview(false)}/></View>}
    {check&&privateQuestions.filter(q=>q.instructionId===check.instruction.id).map(q=><View key={q.id} style={ui.paper}><Text style={ui.blueLabel}>Private trainer question · {q.status}</Text><Text selectable style={ui.body}>{q.question}</Text>{q.resolution&&<Text style={ui.body}>Saved clarification: {q.resolution}</Text>}{q.status==="open"&&client.updateOpenQuestion&&<><Text style={ui.meta}>After reviewing the source or getting clarification, record what you learned. This note does not become a new policy or alter source evidence.</Text><TextInput accessibilityLabel={`Clarification for ${q.question}`} multiline maxLength={4000} style={ui.input} value={resolutions[q.id]??""} onChangeText={text=>setResolutions(old=>({...old,[q.id]:text}))}/><Action disabled={busy||voiceBusy||!resolutions[q.id]?.trim()} label="Save clarification and resolve question" onPress={()=>void run(()=>closeQuestion(q,"resolved"))}/><Action secondary disabled={busy||voiceBusy||!resolutions[q.id]?.trim()} label="Dismiss question after source review" onPress={()=>void run(()=>closeQuestion(q,"dismissed"))}/></>}</View>)}
    {!!check?.responses.length&&<View style={ui.paper}><Text style={ui.blueLabel}>Your rehearsal history</Text>{check.responses.map(response=><View key={response.requestId} style={ui.divider}><Text selectable style={ui.inkBody}>{response.responseText}</Text><Text style={ui.body}>{response.feedback}</Text><Text style={ui.meta}>{response.inputMode} · {response.comparison} · {response.createdAt}</Text>{check.instruction.exceptions.map((e,i)=><Text key={i} style={ui.meta}>{response.applicability[i]?"Applied":"Did not apply"}: {e}</Text>)}</View>)}</View>}
    {check&&<View style={ui.paper}><Text style={ui.blueLabel}>Still uncertain? Ask privately.</Text><TextInput accessibilityLabel="Private question for your trainer" multiline maxLength={4000} value={question} onChangeText={setQuestion} style={ui.input} placeholder="What context or source meaning should your trainer clarify?"/><Action secondary disabled={busy||voiceBusy||!question.trim()} label="Save private trainer question" onPress={()=>void run(saveQuestion)}/><Action secondary disabled={busy||voiceBusy} label={onCorrect?"Review source correction":"Review original source"} onPress={onCorrect??(()=>setSourceReview(true))}/></View>}
    {message&&<Text accessibilityLiveRegion="polite" style={ui.meta}>{message}</Text>}{error&&<><Text accessibilityRole="alert" style={ui.error}>{error}</Text><Action secondary disabled={busy||voiceBusy} label="Reload saved checks" onPress={()=>void run(async()=>{const session=await client.getSourceSession(source.id);setPrivateQuestions(session.extraction?.openQuestions??[]);const result=await connected.listUnderstanding(source.id);setItems(result.items);setCurrent(result.items.find(v=>v.check.id===check?.id)??result.items.at(-1)??null);setLoaded(true);})}/></>}
    <Action secondary disabled={busy||voiceBusy} label="Back to practice" onPress={onExit}/>
  </View>;
}
