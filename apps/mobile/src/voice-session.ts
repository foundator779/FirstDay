export type VoiceState = { phase: "idle" | "requesting" | "listening" | "stopping"; preview: string; message: string };
export type VoiceEvents = { result(text: string): void; end(): void; error(code: string): void };
export interface VoiceEngine {
  available(): boolean;
  permission(): Promise<boolean>;
  start(events: VoiceEvents): void;
  stop(): void;
  cancel(): void;
  dispose(): void;
}

/** Keeps OS callbacks from changing a draft after navigation or cancellation. */
export class VoiceSession {
  state: VoiceState = { phase: "idle", preview: "", message: "" };
  private generation = 0;
  private engine: VoiceEngine | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private load: () => Promise<VoiceEngine>, private changed: (state: VoiceState) => void, private accept: (text: string) => void) {}
  private update(value: Partial<VoiceState>) { this.state = { ...this.state, ...value }; this.changed(this.state); }
  private release() { clearTimeout(this.timer); this.engine?.dispose(); this.engine = undefined; }
  cancel(message = "") {
    this.generation++;
    const engine = this.engine;
    this.release(); engine?.cancel();
    this.update({ phase: "idle", preview: "", message });
  }
  async start() {
    if (this.state.phase !== "idle") return;
    const generation = ++this.generation;
    this.update({ phase: "requesting", preview: "", message: "Opening microphone…" });
    try {
      const engine = await this.load();
      if (generation !== this.generation) { engine.dispose(); return; }
      this.engine = engine;
      if (!engine.available()) { this.cancel("Speaking isn’t available here. You can type your answer below."); return; }
      const granted = await engine.permission();
      if (generation !== this.generation) return;
      if (!granted) { this.cancel("Microphone or speech permission was denied. Enable it in Settings, or type below."); return; }
      let transcript = "";
      const current = () => generation === this.generation;
      this.update({ phase: "listening", message: "Listening… Speak your response, then tap Stop. Up to 60 seconds." });
      this.timer = setTimeout(() => this.stop(), 60_000);
      engine.start({
        result: (text) => { if (current()) { transcript = text.slice(0, 4000); this.update({ preview: transcript }); } },
        end: () => {
          if (!current()) return;
          this.generation++; this.release();
          if (transcript.trim()) this.accept(transcript.trim());
          this.update({ phase: "idle", preview: "", message: transcript.trim() ? "Review what we heard. Edit if needed, then check your answer." : "No speech was heard. Try again or type below. Your previous answer is unchanged." });
        },
        error: (code) => {
          if (!current()) return;
          this.cancel(code === "not-allowed" ? "Microphone or speech permission was denied. Enable it in Settings, or type below." : "We couldn’t finish that recording. Your previous answer is unchanged. Try again or type below.");
        },
      });
    } catch { if (generation === this.generation) this.cancel("Speaking isn’t available here. You can type your answer below."); }
  }
  stop() {
    if (this.state.phase !== "listening") return;
    clearTimeout(this.timer);
    this.update({ phase: "stopping", message: "Finishing your transcript…" });
    this.timer = setTimeout(() => this.cancel("The recording didn’t finish. Your previous answer is unchanged. Try again or type below."), 5000);
    try { this.engine?.stop(); } catch { this.cancel("The recording didn’t finish. You can type below."); }
  }
}
