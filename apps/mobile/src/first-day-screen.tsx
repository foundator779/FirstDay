import {CorrectionPanel,CorrectionReview} from './corrections-panel';
import {hasCorrectionClient} from './corrections-client';
import {correctionWithholds} from '@firstday/scenario-engine';
import type {SourceCorrection} from '@firstday/contracts';
import type { CreateOpenQuestionRequestInput, SourceKind, SourceSessionResponse, UpdateInstructionRequestInput } from "@firstday/contracts";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { FirstDayClientError, createFirstDayApiClient } from "./api";
import { createSyntheticFirstDayClient, type PracticeClient } from "./synthetic-client";
import { KeyboardAwareScrollView } from "./keyboard-scroll";
import { PracticePanel } from "./practice-panel";
import { initialFirstDayState, reduceFirstDayState } from "./state";
import { ConversationPicker, TranscriptCheck, RuleCheck, Action, TrainerQuestions, ui } from "./learner-panels";
import { BottomNavigation, type AppTab } from "./app-navigation";
import { Portrait, DesignIcon } from "./design-assets";
import { SavedTraining } from "./saved-training";
import { restorePractice } from "./session-recovery";
import { useDraftStorage } from "./draft-context";
import {LiveSessionScreen} from "./live-session-screen";
import { SourcePermission } from "./source-permission";
const DATA_MODE = process.env.EXPO_PUBLIC_FIRSTDAY_DATA_MODE === "bee" ? "bee" : "fixture";
const BEDROCK_MODE = process.env.EXPO_PUBLIC_FIRSTDAY_AI_MODE === "bedrock";
const REMOTE_FIXTURE_MODE = BEDROCK_MODE || process.env.EXPO_PUBLIC_FIRSTDAY_API_MODE === "remote";
const API_URL = process.env.EXPO_PUBLIC_FIRSTDAY_API_URL ?? "http://127.0.0.1:3000";
const FIXTURE_SESSION_TOKEN = process.env.EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN ?? "firstday-public-fixture-session";
function friendlyError(error: unknown): string {
  if (error instanceof FirstDayClientError) {
    if (error.code === "NETWORK_ERROR") return "FirstDay couldn't reach the API. Check the connection, then try again.";
    if (error.code === "INTERNAL_ERROR") return "The AI couldn't complete this step. Your progress hasn't changed. Please try again.";
    return error.message;
  }
  return "This step didn't finish. Please try again.";
}
export function FirstDayScreen() {
  return DATA_MODE==='bee'?<LiveSessionScreen renderLearner={client=><LearnerScreen liveClient={client}/>}/>:<LearnerScreen/>;
}
function LearnerScreen({liveClient}:{liveClient?:PracticeClient}) {
  const draftStorage=useDraftStorage();
  const [state, dispatch] = useReducer(reduceFirstDayState, initialFirstDayState);
  const [busyInstructionId, setBusyInstructionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [correctionActive,setCorrectionActive]=useState(false);
  const [corrections,setCorrections]=useState<SourceCorrection[]>([]);
  const [correctionsLoaded,setCorrectionsLoaded]=useState(false);
  const [practiceActive, setPracticeActive] = useState(false);
  const [tab, setTab] = useState<AppTab>("home");
  const [demoSession, setDemoSession] = useState(0);
  const [restoredSession, setRestoredSession] = useState<SourceSessionResponse | undefined>(undefined);
  const [resumeSequence, setResumeSequence] = useState(0);
  const request = useRef<AbortController | null>(null);
  const currentSourceId = useRef<string | undefined>(undefined);
  currentSourceId.current = state.review.sourceConversation?.id;
  const remoteClient = useMemo<PracticeClient>(
    () => liveClient??createFirstDayApiClient({ baseUrl: API_URL, sessionToken: FIXTURE_SESSION_TOKEN }),
    [liveClient],
  );
  const fixtureClient = useMemo<PracticeClient>(() => {
    // A new session intentionally clears all synthetic imports and practice progress.
    void demoSession;
    return REMOTE_FIXTURE_MODE ? remoteClient : createSyntheticFirstDayClient();
  }, [demoSession, remoteClient]);

  const loadPicker = useCallback(
    async (sourceKind: SourceKind) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setRestoredSession(undefined);
      dispatch({ type: "picker/loadStarted", sourceKind });
      const client = sourceKind === "fixture" ? fixtureClient : remoteClient;
      try {
        const health = await client.health(controller.signal);
        const page =
          sourceKind === "bee" && !liveClient && health.beeBridge !== "authenticated"
            ? { items: [], nextCursor: null }
            : await client.listConversations({ sourceKind, limit: 20 }, controller.signal);
        if (!controller.signal.aborted) {
          dispatch({
            type: "picker/loadSucceeded",
            health,
            conversations: page.items,
            authenticatedList: sourceKind === "bee" && liveClient !== undefined,
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({ type: "picker/loadFailed", message: friendlyError(error) });
        }
      }
    },
    [fixtureClient, remoteClient,liveClient],
  );


  useEffect(() => {
    void loadPicker(DATA_MODE);
    return () => request.current?.abort();
  }, [loadPicker]);

  const activeClient =
    state.preview.source?.sourceKind === "fixture" || state.picker.sourceKind === "fixture"
      ? fixtureClient
      : remoteClient;

  useEffect(()=>{let cancelled=false;const selected=state.review.sourceConversation;setCorrections([]);setCorrectionsLoaded(!selected||!hasCorrectionClient(activeClient));if(selected&&hasCorrectionClient(activeClient))void activeClient.listCorrections(selected.id).then(result=>{if(!cancelled){setCorrections(result.items);setCorrectionsLoaded(true);}}).catch(()=>{if(!cancelled)setActionError('Saved source correction gates could not be loaded. Reopen this training before preparing practice.');});return()=>{cancelled=true;};},[activeClient,state.review.sourceConversation?.id,resumeSequence]);
  const withheldIds=correctionsLoaded?corrections.filter(correctionWithholds).flatMap(c=>c.effects.instructionIds):state.review.extraction?.items.map(i=>i.id)??[];
  async function finishCorrections(){const current=state.review.sourceConversation;if(!current)return;try{const session=await activeClient.getSourceSession(current.id);restoreSession(session);setCorrectionActive(false);}catch(error){setActionError(friendlyError(error));}}

  const openTranscript = useCallback(async () => {
    const selected = state.picker.conversations.find(
      ({ id }) => id === state.picker.selectedConversationId,
    );
    if (selected === undefined) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setActionError(null);
    dispatch({ type: "preview/loadStarted" });
    try {
      const { conversation: source } = await (
        selected.sourceKind === "fixture" ? fixtureClient : remoteClient
      ).getConversation(
        { beeSourceId: selected.id, sourceKind: selected.sourceKind },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        dispatch({ type: "preview/loadSucceeded", source });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "preview/loadFailed", message: friendlyError(error) });
      }
    }
  }, [fixtureClient, remoteClient, state.picker.conversations, state.picker.selectedConversationId]);

  const extractInstructions = useCallback(async () => {
    const source = state.preview.source;
    if (source === null || !state.preview.consentConfirmed) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setActionError(null);
    dispatch({ type: "review/extractionStarted" });
    try {
      const client = source.sourceKind === "fixture" ? fixtureClient : remoteClient;
      const { sourceConversation } = await client.importConversation(
        {
          beeSourceId: source.id,
          sourceKind: source.sourceKind,
          sourceRevision: source.revision,
          consent: { confirmed: true },
        },
        controller.signal,
      );
      const saved = await client.getSourceSession(sourceConversation.id, controller.signal);
      if (saved.extraction) {
        if (!controller.signal.aborted) restoreSession(saved);
        return;
      }
      const extraction = await client.extractInstructions(
        {
          sourceConversationId: sourceConversation.id,
          sourceRevision: sourceConversation.sourceRevision,
          excludedRanges: state.preview.excludedRanges,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        dispatch({
          type: "review/extractionSucceeded",
          sourceConversation,
          extraction,
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "review/extractionFailed", message: friendlyError(error) });
      }
    }
  }, [fixtureClient, remoteClient, state.preview]);

  const updateInstruction = useCallback(
    async (input: UpdateInstructionRequestInput) => {
      if (busyInstructionId !== null) return;
      setBusyInstructionId(input.instructionId);
      setActionError(null);
      try {
        const { instruction } = await activeClient.updateInstruction(input);
        dispatch({ type: "review/instructionUpdated", instruction });
      } catch (error) {
        setActionError(friendlyError(error));
        throw error;
      } finally {
        setBusyInstructionId(null);
      }
    },
    [activeClient, busyInstructionId],
  );

  const createOpenQuestion = useCallback(
    async (input: CreateOpenQuestionRequestInput) => {
      if (busyInstructionId !== null) return;
      setBusyInstructionId(input.instructionId ?? "question");
      setActionError(null);
      try {
        const { openQuestion } = await activeClient.createOpenQuestion(input);
        dispatch({ type: "review/questionCreated", openQuestion });
      } catch (error) {
        setActionError(friendlyError(error));
        throw error;
      } finally {
        setBusyInstructionId(null);
      }
    },
    [activeClient, busyInstructionId],
  );

  const chooseAnotherSource = useCallback(() => {
    request.current?.abort();
    setActionError(null);
    setBusyInstructionId(null);
    setPracticeActive(false);
    setRestoredSession(undefined);
    setTab("home");
    setCorrectionActive(false);dispatch({ type: "preview/back" });
  }, []);

  function restoreSession(session: SourceSessionResponse) {
    request.current?.abort();
    setCorrectionActive(false);setRestoredSession(session); setResumeSequence((value) => value + 1);
    setPracticeActive(restorePractice(session) !== null); setActionError(null); setBusyInstructionId(null);
    dispatch({ type: "session/restored", session }); setTab("practice");
  }

  async function clearDrafts(reset = false) {
    try {
      await draftStorage.clearAll(); setActionError(null);
      if (reset) { chooseAnotherSource(); setDemoSession((value) => value + 1); }
    } catch { setActionError("Local drafts couldn’t be cleared. Please try again."); }
  }

  const scroll = useRef<ScrollView>(null);
  const confirmedCount = state.review.extraction?.items.filter((r) => r.status === "confirmed").length ?? 0;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [state.stage, practiceActive, confirmedCount, tab]);
  const step = practiceActive ? 3 : { picker: 0, transcript: 1, review: 2 }[state.stage];
  const extraction = state.review.extraction;
  const activeSource = state.review.sourceConversation ?? state.preview.source;
  const stageName = practiceActive ? "Your practice" : state.stage === "transcript" ? "Review transcript" : "Your instructions";
  return <SafeAreaView style={styles.screen} edges={liveClient ? ["bottom"] : ["top", "bottom"]}>
    <View style={styles.screen}>
      <View style={styles.header}>
        {tab === "home" ? <><Portrait size={44} /><View style={styles.greeting}><Text maxFontSizeMultiplier={1.3} style={styles.welcome}>Hi, welcome to</Text><Text maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.wordmark}>FirstDay</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open trainer questions" onPress={() => setTab("questions")} style={styles.iconButton}><DesignIcon name="notification" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="About FirstDay" onPress={() => setTab("about")} style={styles.iconButton}><DesignIcon name="settings" /></Pressable></> : <><Pressable accessibilityRole="button" accessibilityLabel="Back to training home" onPress={() => setTab("home")} style={styles.back}><DesignIcon name="back" size={20} /></Pressable><Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.pageTitle}>{tab === "practice" ? stageName : tab === "questions" ? "Trainer questions" : "About FirstDay"}</Text><View style={styles.back} /></>}
      </View>
      <KeyboardAwareScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {tab === "home" && <>
            {actionError && <Text accessibilityRole="alert" style={ui.error}>{actionError}</Text>}
            <Text style={styles.mode}>{state.picker.sourceKind === "fixture" ? BEDROCK_MODE ? "Fictional examples · Nova Pro feedback" : "Fictional examples · offline preview" : "Your Bee training"}</Text>
            {state.stage !== "picker" ? <View style={ui.section}><View style={ui.paper}><Portrait size={70} /><Text style={ui.blueLabel}>Your training is in progress</Text><Text style={ui.label}>{activeSource?.title ?? "Training conversation"}</Text><Text style={ui.body}>Pick up where you left off. Your current answers and review stay here while you switch tabs.</Text><Action label={practiceActive ? "Continue my practice" : "Continue reviewing"} onPress={() => setTab("practice")} /></View><Action secondary label="Choose a different conversation" onPress={chooseAnotherSource} /></View> : <ConversationPicker state={state.picker} onLoad={(kind) => void loadPicker(kind)} onSelect={(id) => dispatch({ type: "picker/conversationSelected", conversationId: id })} onContinue={() => { setTab("practice"); void openTranscript(); }} />}{state.stage === "picker" && <SavedTraining key={state.picker.sourceKind + ":" + demoSession} client={state.picker.sourceKind === "fixture" ? fixtureClient : remoteClient} sourceKind={state.picker.sourceKind} onRestore={restoreSession} />}
          </>}
          <View style={tab === "practice" ? undefined : { display: "none" }} accessibilityElementsHidden={tab !== "practice"} importantForAccessibility={tab === "practice" ? "auto" : "no-hide-descendants"}>
            {state.stage === "picker" ? <View style={ui.paper}><Text style={ui.blueLabel}>Your next shift starts with training.</Text><Text style={ui.body}>Choose a conversation and confirm its instructions before you start a rehearsal.</Text><Action label="Choose my training" onPress={() => setTab("home")} /></View> : <>
              <View accessibilityLabel={"Step " + (step + 1) + " of 4"} style={styles.steps}>{["Training", "Transcript", "Instructions", "Practice"].map((label, index) => <View key={label} style={styles.step}><View style={[styles.stepDot, index <= step && styles.stepDotActive]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.stepNumber, index <= step && { color: "white" }]}>{index + 1}</Text></View><Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.stepText, index === step && { color: theme.colors.action }]}>{label}</Text></View>)}</View>
              {state.stage === "transcript" && <TranscriptCheck preview={state.preview} review={state.review} aiMode={BEDROCK_MODE} onBack={chooseAnotherSource} onRetry={() => void openTranscript()} onToggle={(utterance) => dispatch({ type: "preview/utteranceToggled", utterance })} onConsent={(confirmed) => dispatch({ type: "preview/consentChanged", confirmed })} onExtract={() => void extractInstructions()} />}
              {state.stage==='review'&&state.review.sourceConversation&&hasCorrectionClient(activeClient)&&!correctionActive&&<Action secondary label='Evening review · correct a source uncertainty' onPress={()=>{setCorrectionActive(true);scroll.current?.scrollTo({y:0,animated:false});}}/>}
              {correctionActive&&state.review.sourceConversation&&<CorrectionPanel client={activeClient} source={state.review.sourceConversation} isVisible={tab==='practice'} onExit={()=>void finishCorrections()}/>}
              {!correctionActive&&corrections.filter(c=>!['preview','skipped','undone','superseded'].includes(c.status)).map(c=><CorrectionReview key={c.id} correction={c}/>)}
              {state.stage === "review" && !correctionActive && !practiceActive && <RuleCheck withheldInstructionIds={withheldIds} review={state.review} busy={busyInstructionId !== null} error={actionError} onBack={chooseAnotherSource} onUpdate={updateInstruction} onQuestion={createOpenQuestion} />}
              {state.stage === "review" && extraction && state.review.sourceConversation && !correctionActive && <View style={{ marginTop: practiceActive ? 0 : 24 }}><PracticePanel withheldInstructionIds={withheldIds} onCorrect={()=>{setCorrectionActive(true);scroll.current?.scrollTo({y:0,animated:false});}} onQuestionSaved={openQuestion=>dispatch({type:"review/questionCreated",openQuestion})} isVisible={tab === "practice"} restoredSession={restoredSession} key={demoSession + ":" + resumeSequence + ":" + state.review.sourceConversation.id} client={activeClient} aiMode={BEDROCK_MODE ? "bedrock" : "offline"} extraction={extraction} source={state.review.sourceConversation} onActiveChange={(active) => { setPracticeActive(active); if (active) setTab("practice"); }} onStepChange={() => scroll.current?.scrollTo({ y: 0, animated: false })} onExit={chooseAnotherSource} /></View>}
            </>}
          </View>
          {tab === "questions" && <View style={ui.section}><Text style={ui.body}>Questions from your training stay private. Nothing is sent to your trainer.</Text>{extraction?.openQuestions.length ? <TrainerQuestions questions={extraction.openQuestions} evidence={extraction.sourceEvidence} /> : <View style={ui.paper}><Text style={ui.blueLabel}>No open questions yet</Text><Text style={ui.body}>Unclear guidance appears here after review. You can also save your own question beside any instruction.</Text></View>}<Action label={state.stage === "picker" ? "Choose training" : "Return to my training"} onPress={() => setTab(state.stage === "picker" ? "home" : "practice")} /></View>}
          {tab === "about" && <View style={ui.section}><View style={styles.aboutIdentity}><Portrait size={86} /><Text style={ui.title}>A little practice for your first day.</Text><Text style={ui.body}>FirstDay turns training conversations into situations you can rehearse, with the source always attached.</Text></View><View style={ui.paper}><Text style={ui.blueLabel}>Your current experience</Text><Text style={ui.body}>{BEDROCK_MODE ? "Amazon Nova Pro on Bedrock checks your answers against confirmed training." : "The offline preview checks your answer against the exact action wording."}</Text><Text style={ui.meta}>Examples are fictional. Real Bee recording is a separate connection.</Text></View><View style={ui.paper}><Text style={ui.blueLabel}>You control the source</Text><Text style={ui.body}>Review the transcript, leave out private passages, and confirm each instruction. Tentative guidance stays a question.</Text><Text style={ui.meta}>Offline example progress is temporary. Connected training can be reopened from Resume saved training. Unsubmitted answer drafts stay on this device until submitted or cleared.</Text></View>{state.review.sourceConversation && <SourcePermission key={state.review.sourceConversation.id} client={activeClient} source={state.review.sourceConversation} onRevoked={(message) => { if (currentSourceId.current === state.review.sourceConversation?.id) { chooseAnotherSource(); void loadPicker(state.picker.sourceKind); } setActionError(message); }} />}<Action secondary label="Clear local answer drafts" onPress={() => void clearDrafts()} />{actionError && <Text accessibilityRole="alert" style={ui.error}>{actionError}</Text>}<Action label="Back to my training" onPress={() => setTab("home")} /></View>}
          <Text style={styles.footerText}>{state.picker.sourceKind === "fixture" ? "Fictional training. Real practice." : "Your training, with the source attached."}</Text>
          {!BEDROCK_MODE && state.picker.sourceKind === "fixture" && tab === "about" && <Action secondary label="Reset offline example" onPress={() => void clearDrafts(true)} />}
        </View>
      </KeyboardAwareScrollView>
      <BottomNavigation value={tab} onChange={setTab} />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.canvas }, content: { flexGrow: 1, paddingBottom: 12 }, page: { width: "100%", maxWidth: 520, paddingHorizontal: 24, alignSelf: "center" },
  header: { width: "100%", maxWidth: 520, alignSelf: "center", minHeight: 90, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 10 }, greeting: { flex: 1, minWidth: 0, gap: 3 }, welcome: { fontFamily: theme.type.body, fontSize: 14, color: theme.colors.action }, wordmark: { fontFamily: theme.type.display, fontSize: 23, color: theme.colors.ink }, iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pageTitle: { flex: 1, textAlign: "center", color: theme.colors.action, fontFamily: theme.type.display, fontSize: 24 }, mode: { fontFamily: theme.type.body, fontSize: 13, color: theme.colors.tertiaryInk, marginBottom: 16 },
  steps: { flexDirection: "row", gap: 8, paddingBottom: 26 }, step: { flex: 1, alignItems: "center", gap: 8 }, stepDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, justifyContent: "center", alignItems: "center" }, stepDotActive: { backgroundColor: theme.colors.action }, stepNumber: { fontFamily: theme.type.utility, fontSize: 16, color: theme.colors.action }, stepText: { alignSelf: "stretch", textAlign: "center", fontFamily: theme.type.body, fontSize: 12, color: theme.colors.tertiaryInk },
  aboutIdentity: { alignItems: "center", gap: 15, paddingVertical: 15 }, footerText: { fontFamily: theme.type.body, paddingVertical: 24, textAlign: "center", fontSize: 13, color: theme.colors.tertiaryInk },
});
