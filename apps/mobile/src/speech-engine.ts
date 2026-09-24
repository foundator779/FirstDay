import type { VoiceEngine } from "./voice-session";

let draining: Promise<void> = Promise.resolve();

export async function loadSpeechEngine(): Promise<VoiceEngine> {
  // Lazy loading lets Expo Go and browsers without recognition retain text input.
  await draining;
  const { ExpoSpeechRecognitionModule: speech } = await import("expo-speech-recognition");
  let subscriptions: { remove(): void }[] = [];
  return {
    available: () => speech.isRecognitionAvailable(),
    permission: async () => (await speech.requestPermissionsAsync()).granted,
    start(events) {
      subscriptions = [
        speech.addListener("result", (event) => events.result(event.results[0]?.transcript ?? "")),
        speech.addListener("end", events.end),
        speech.addListener("error", (event) => events.error(event.error)),
      ];
      speech.start({ lang: "en-US", interimResults: true, continuous: false, maxAlternatives: 1, recordingOptions: { persist: false } });
    },
    stop: () => speech.stop(),
    cancel() {
      draining = new Promise<void>((resolve) => {
        const subscription = speech.addListener("end", () => { clearTimeout(timer); subscription.remove(); resolve(); });
        const timer = setTimeout(() => { subscription.remove(); resolve(); }, 2000);
        try { speech.abort(); } catch { clearTimeout(timer); subscription.remove(); resolve(); }
      });
    },
    dispose: () => { subscriptions.forEach((item) => item.remove()); subscriptions = []; },
  };
}
