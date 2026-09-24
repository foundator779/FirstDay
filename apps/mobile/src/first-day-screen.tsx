import type { CreateOpenQuestionRequestInput, SourceKind, UpdateInstructionRequestInput } from "@firstday/contracts";
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
const DATA_MODE = process.env.EXPO_PUBLIC_FIRSTDAY_DATA_MODE === "bee" ? "bee" : "fixture";
const BEDROCK_MODE = process.env.EXPO_PUBLIC_FIRSTDAY_AI_MODE === "bedrock";
const API_URL = process.env.EXPO_PUBLIC_FIRSTDAY_API_URL ?? "http://127.0.0.1:3000";
const SESSION_TOKEN = process.env.EXPO_PUBLIC_FIRSTDAY_SESSION_TOKEN ?? "firstday-public-fixture-session";
function friendlyError(error: unknown): string {
  if (error instanceof FirstDayClientError) {
    if (error.code === "NETWORK_ERROR") return "FirstDay couldn't reach the API. Check the connection, then try again.";
    if (error.code === "INTERNAL_ERROR") return "The AI couldn't complete this step. Your progress hasn't changed. Please try again.";
    return error.message;
  }
  return "This step didn't finish. Please try again.";
}
export function FirstDayScreen() {
  const [state, dispatch] = useReducer(reduceFirstDayState, initialFirstDayState);
  const [busyInstructionId, setBusyInstructionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [practiceActive, setPracticeActive] = useState(false);
  const [tab, setTab] = useState<AppTab>("home");
  const [demoSession, setDemoSession] = useState(0);
  const request = useRef<AbortController | null>(null);
  const remoteClient = useMemo<PracticeClient>(
    () => createFirstDayApiClient({ baseUrl: API_URL, sessionToken: SESSION_TOKEN }),
    [],
  );
  const fixtureClient = useMemo<PracticeClient>(() => {
    // A new session intentionally clears all synthetic imports and practice progress.
    void demoSession;
    return BEDROCK_MODE ? remoteClient : createSyntheticFirstDayClient();
  }, [demoSession, remoteClient]);

  const loadPicker = useCallback(
    async (sourceKind: SourceKind) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      dispatch({ type: "picker/loadStarted", sourceKind });
      const client = sourceKind === "fixture" ? fixtureClient : remoteClient;
      try {
        const health = await client.health(controller.signal);
        const page =
          sourceKind === "bee" && health.beeBridge !== "authenticated"
            ? { items: [], nextCursor: null }
            : await client.listConversations({ sourceKind, limit: 20 }, controller.signal);
        if (!controller.signal.aborted) {
          dispatch({
            type: "picker/loadSucceeded",
            health,
            conversations: page.items,
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({ type: "picker/loadFailed", message: friendlyError(error) });
        }
      }
    },
    [fixtureClient, remoteClient],
  );


  useEffect(() => {
    void loadPicker(DATA_MODE);
    return () => request.current?.abort();
  }, [loadPicker]);

  const activeClient =
    state.preview.source?.sourceKind === "fixture" || state.picker.sourceKind === "fixture"
      ? fixtureClient
      : remoteClient;

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
    setTab("home");
    dispatch({ type: "preview/back" });
  }, []);

  const scroll = useRef<ScrollView>(null);
  const confirmedCount = state.review.extraction?.items.filter((r) => r.status === "confirmed").length ?? 0;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [state.stage, practiceActive, confirmedCount, tab]);
  const step = practiceActive ? 3 : { picker: 0, transcript: 1, review: 2 }[state.stage];
  const extraction = state.review.extraction;
  const activeSource = state.review.sourceConversation ?? state.preview.source;
  const stageName = practiceActive ? "Your practice" : state.stage === "transcript" ? "Review transcript" : "Your instructions";
  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <View style={styles.screen}>
      <View style={styles.header}>
        {tab === "home" ? <><Portrait size={44} /><View style={styles.greeting}><Text style={styles.welcome}>Hi, welcome to</Text><Text style={styles.wordmark}>FirstDay</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open trainer questions" onPress={() => setTab("questions")} style={styles.iconButton}><DesignIcon name="notification" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="About FirstDay" onPress={() => setTab("about")} style={styles.iconButton}><DesignIcon name="settings" /></Pressable></> : <><Pressable accessibilityRole="button" accessibilityLabel="Back to training home" onPress={() => setTab("home")} style={styles.back}><DesignIcon name="back" size={20} /></Pressable><Text accessibilityRole="header" style={styles.pageTitle}>{tab === "practice" ? stageName : tab === "questions" ? "Trainer questions" : "About FirstDay"}</Text><View style={styles.back} /></>}
      </View>
      <KeyboardAwareScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {tab === "home" && <>
            <Text style={styles.mode}>{state.picker.sourceKind === "fixture" ? BEDROCK_MODE ? "Fictional examples · Nova Pro feedback" : "Fictional examples · offline preview" : "Your Bee training"}</Text>
            {state.stage !== "picker" ? <View style={ui.section}><View style={ui.paper}><Portrait size={70} /><Text style={ui.blueLabel}>Your training is in progress</Text><Text style={ui.label}>{activeSource?.title ?? "Training conversation"}</Text><Text style={ui.body}>Pick up where you left off. Your current answers and review stay here while you switch tabs.</Text><Action label={practiceActive ? "Continue my practice" : "Continue reviewing"} onPress={() => setTab("practice")} /></View><Action secondary label="Choose a different conversation" onPress={chooseAnotherSource} /></View> : <ConversationPicker state={state.picker} onLoad={(kind) => void loadPicker(kind)} onSelect={(id) => dispatch({ type: "picker/conversationSelected", conversationId: id })} onContinue={() => { setTab("practice"); void openTranscript(); }} />}
          </>}
          <View style={tab === "practice" ? undefined : { display: "none" }} accessibilityElementsHidden={tab !== "practice"} importantForAccessibility={tab === "practice" ? "auto" : "no-hide-descendants"}>
            {state.stage === "picker" ? <View style={ui.paper}><Text style={ui.blueLabel}>Your next shift starts with training.</Text><Text style={ui.body}>Choose a conversation and confirm its instructions before you start a rehearsal.</Text><Action label="Choose my training" onPress={() => setTab("home")} /></View> : <>
              <View accessibilityLabel={"Step " + (step + 1) + " of 4"} style={styles.steps}>{["Training", "Transcript", "Instructions", "Practice"].map((label, index) => <View key={label} style={styles.step}><View style={[styles.stepDot, index <= step && styles.stepDotActive]}><Text style={[styles.stepNumber, index <= step && { color: "white" }]}>{index + 1}</Text></View><Text style={[styles.stepText, index === step && { color: theme.colors.action }]}>{label}</Text></View>)}</View>
              {state.stage === "transcript" && <TranscriptCheck preview={state.preview} review={state.review} aiMode={BEDROCK_MODE} onBack={chooseAnotherSource} onRetry={() => void openTranscript()} onToggle={(utterance) => dispatch({ type: "preview/utteranceToggled", utterance })} onConsent={(confirmed) => dispatch({ type: "preview/consentChanged", confirmed })} onExtract={() => void extractInstructions()} />}
              {state.stage === "review" && !practiceActive && <RuleCheck review={state.review} busy={busyInstructionId !== null} error={actionError} onBack={chooseAnotherSource} onUpdate={updateInstruction} onQuestion={createOpenQuestion} />}
              {state.stage === "review" && extraction && state.review.sourceConversation && <View style={{ marginTop: practiceActive ? 0 : 24 }}><PracticePanel isVisible={tab === "practice"} key={demoSession + ":" + state.review.sourceConversation.id} client={activeClient} aiMode={BEDROCK_MODE ? "bedrock" : "offline"} extraction={extraction} source={state.review.sourceConversation} onActiveChange={(active) => { setPracticeActive(active); if (active) setTab("practice"); }} onStepChange={() => scroll.current?.scrollTo({ y: 0, animated: false })} onExit={chooseAnotherSource} /></View>}
            </>}
          </View>
          {tab === "questions" && <View style={ui.section}><Text style={ui.body}>Questions from your training stay private. Nothing is sent to your trainer.</Text>{extraction?.openQuestions.length ? <TrainerQuestions questions={extraction.openQuestions} evidence={extraction.sourceEvidence} /> : <View style={ui.paper}><Text style={ui.blueLabel}>No open questions yet</Text><Text style={ui.body}>Unclear guidance appears here after review. You can also save your own question beside any instruction.</Text></View>}<Action label={state.stage === "picker" ? "Choose training" : "Return to my training"} onPress={() => setTab(state.stage === "picker" ? "home" : "practice")} /></View>}
          {tab === "about" && <View style={ui.section}><View style={styles.aboutIdentity}><Portrait size={86} /><Text style={ui.title}>A little practice for your first day.</Text><Text style={ui.body}>FirstDay turns training conversations into situations you can rehearse, with the source always attached.</Text></View><View style={ui.paper}><Text style={ui.blueLabel}>Your current experience</Text><Text style={ui.body}>{BEDROCK_MODE ? "Amazon Nova Pro on Bedrock checks your answers against confirmed training." : "The offline preview checks your answer against the exact action wording."}</Text><Text style={ui.meta}>Examples are fictional. Real Bee recording is a separate connection.</Text></View><View style={ui.paper}><Text style={ui.blueLabel}>You control the source</Text><Text style={ui.body}>Review the transcript, leave out private passages, and confirm each instruction. Tentative guidance stays a question.</Text><Text style={ui.meta}>Demo progress is temporary. Keep the app open during practice.</Text></View><Action label="Back to my training" onPress={() => setTab("home")} /></View>}
          <Text style={styles.footerText}>{state.picker.sourceKind === "fixture" ? "Fictional training. Real practice." : "Your training, with the source attached."}</Text>
          {!BEDROCK_MODE && state.picker.sourceKind === "fixture" && tab === "about" && <Action secondary label="Reset offline example" onPress={() => { chooseAnotherSource(); setDemoSession((value) => value + 1); }} />}
        </View>
      </KeyboardAwareScrollView>
      <BottomNavigation value={tab} onChange={setTab} />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.canvas }, content: { flexGrow: 1, paddingBottom: 12 }, page: { width: "100%", maxWidth: 520, paddingHorizontal: 24, alignSelf: "center" },
  header: { width: "100%", maxWidth: 520, alignSelf: "center", minHeight: 90, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", gap: 10 }, greeting: { flex: 1, gap: 3 }, welcome: { fontFamily: theme.type.body, fontSize: 14, color: theme.colors.action }, wordmark: { fontFamily: theme.type.display, fontSize: 23, color: theme.colors.ink }, iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }, back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pageTitle: { flex: 1, textAlign: "center", color: theme.colors.action, fontFamily: theme.type.display, fontSize: 24 }, mode: { fontFamily: theme.type.body, fontSize: 13, color: theme.colors.tertiaryInk, marginBottom: 16 },
  steps: { flexDirection: "row", gap: 8, paddingBottom: 26 }, step: { flex: 1, alignItems: "center", gap: 8 }, stepDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, justifyContent: "center", alignItems: "center" }, stepDotActive: { backgroundColor: theme.colors.action }, stepNumber: { fontFamily: theme.type.utility, fontSize: 16, color: theme.colors.action }, stepText: { fontFamily: theme.type.body, fontSize: 12, color: theme.colors.tertiaryInk },
  aboutIdentity: { alignItems: "center", gap: 15, paddingVertical: 15 }, footerText: { fontFamily: theme.type.body, paddingVertical: 24, textAlign: "center", fontSize: 13, color: theme.colors.tertiaryInk },
});
