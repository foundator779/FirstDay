import { useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Text, View } from "react-native";
import * as Speech from "expo-speech";
import { Action, ui } from "./learner-panels";
import { VoiceSession, type VoiceState } from "./voice-session";
import { loadSpeechEngine } from "./speech-engine";

type Props = { active: boolean; prompt: string; onTranscript(text: string): void; onBusy(value: boolean): void };
export function VoiceRehearsal({ active, prompt, onTranscript, onBusy }: Props) {
  const callbacks = useRef({ onTranscript, onBusy });
  callbacks.current = { onTranscript, onBusy };
  const [state, setState] = useState<VoiceState>({ phase: "idle", preview: "", message: "" });
  const [speaking, setSpeaking] = useState(false);
  const audioGeneration = useRef(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new VoiceSession(loadSpeechEngine, (value) => { setState(value); callbacks.current.onBusy(value.phase !== "idle"); }, (text) => callbacks.current.onTranscript(text));
  const session = sessionRef.current;
  useEffect(() => {
    const stop = () => { audioGeneration.current++; session.cancel(); void Speech.stop().catch(() => {}); setSpeaking(false); };
    if (!active) stop();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "background" || (next === "inactive" && session.state.phase !== "requesting")) stop(); });
    return () => { subscription.remove(); stop(); };
  }, [active, prompt, session]);
  async function play() {
    const generation = ++audioGeneration.current;
    session.cancel();
    await Speech.stop();
    if (generation !== audioGeneration.current) return;
    if (speaking) { setSpeaking(false); return; }
    setSpeaking(true);
    const done = () => { if (generation === audioGeneration.current) setSpeaking(false); };
    Speech.speak(prompt, { language: "en-US", rate: 0.92, onDone: done, onStopped: done, onError: () => { if (generation !== audioGeneration.current) return; done(); setState((value) => ({ ...value, message: "Audio couldn’t play. You can read the situation above." })); } });
  }
  async function record() {
    const generation = ++audioGeneration.current;
    setSpeaking(false);
    await Speech.stop();
    if (generation !== audioGeneration.current) return;
    Keyboard.dismiss();
    await session.start();
  }
  const recording = state.phase !== "idle";
  return <View style={ui.gap}>
    <Action secondary label={speaking ? "Stop playback" : "Hear the situation"} disabled={!active || recording} onPress={() => void play().catch(() => setSpeaking(false))} />
    <Text style={ui.meta}>Rehearse aloud as if you were there. Your device’s speech service may process audio online. FirstDay keeps only the transcript when you submit.</Text>
    <Action secondary label={state.phase === "listening" ? "Stop speaking" : state.phase === "stopping" ? "Finishing transcript…" : state.phase === "requesting" ? "Opening microphone…" : "Start speaking"} disabled={!active || state.phase === "requesting" || state.phase === "stopping"} onPress={() => { if (recording) session.stop(); else void record().catch(() => session.cancel("Microphone couldn’t start. You can type below.")); }} />
    {recording && <Action secondary label="Cancel recording · use typing" onPress={() => session.cancel()} />}
    {!!state.message && <Text accessibilityLiveRegion="polite" style={ui.meta}>{state.message}</Text>}
    {!!state.preview && <Text style={ui.inkBody}>{state.preview}</Text>}
  </View>;
}
