import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceSession, type VoiceEngine, type VoiceEvents } from "./voice-session";

function setup() {
  let events: VoiceEvents;
  const engine: VoiceEngine = { available: () => true, permission: vi.fn(async () => true), start: vi.fn((value) => { events = value; }), stop: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
  const accept = vi.fn();
  const session = new VoiceSession(async () => engine, vi.fn(), accept);
  return { engine, accept, session, events: () => events };
}
afterEach(() => vi.useRealTimers());
describe("spoken practice lifecycle", () => {
  it("requires permission and stop/end before replacing the draft", async () => {
    const t = setup(); await t.session.start();
    t.events().result("record the kit number");
    expect(t.accept).not.toHaveBeenCalled();
    t.session.stop(); expect(t.engine.stop).toHaveBeenCalledOnce();
    expect(t.session.state.phase).toBe("stopping");
    t.events().result("record the kit number in the blue ledger"); t.events().end();
    expect(t.accept).toHaveBeenCalledExactlyOnceWith("record the kit number in the blue ledger");
    expect(t.session.state.phase).toBe("idle");
  });
  it("retains the draft after denied permission", async () => {
    const t = setup(); t.engine.permission = async () => false;
    await t.session.start();
    expect(t.engine.start).not.toHaveBeenCalled(); expect(t.accept).not.toHaveBeenCalled();
    expect(t.session.state.message).toContain("denied");
  });
  it("does not begin recording when navigation cancels a pending permission request", async () => {
    const t = setup(); let grant!: (value: boolean) => void;
    t.engine.permission = () => new Promise((resolve) => { grant = resolve; });
    const pending = t.session.start(); await Promise.resolve();
    t.session.cancel(); grant(true); await pending;
    expect(t.engine.start).not.toHaveBeenCalled();
  });
  it("ignores late callbacks from a canceled recording even after a new recording starts", async () => {
    const t = setup(); await t.session.start(); const old = t.events();
    old.result("old answer"); t.session.cancel(); await t.session.start();
    old.result("late answer"); old.end(); old.error("network");
    expect(t.session.state.phase).toBe("listening"); expect(t.accept).not.toHaveBeenCalled();
    t.events().result("new answer"); t.events().end();
    expect(t.accept).toHaveBeenCalledExactlyOnceWith("new answer");
  });
  it.each(["no-speech", "network", "audio-capture"])("preserves the draft on %s", async (code) => {
    const t = setup(); await t.session.start(); t.events().result("incomplete"); t.events().error(code); t.events().end();
    expect(t.accept).not.toHaveBeenCalled(); expect(t.session.state.phase).toBe("idle");
  });
  it("rejects empty speech", async () => {
    const t = setup(); await t.session.start(); t.events().result("  "); t.events().end();
    expect(t.accept).not.toHaveBeenCalled(); expect(t.session.state.message).toContain("No speech");
  });
  it("stops at 60 seconds and recovers if the speech service never finishes", async () => {
    vi.useFakeTimers(); const t = setup(); await t.session.start();
    vi.advanceTimersByTime(60_000); expect(t.engine.stop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000); expect(t.session.state.phase).toBe("idle");
    expect(t.accept).not.toHaveBeenCalled(); expect(t.engine.cancel).toHaveBeenCalledOnce();
  });
  it("handles unavailable recognition and missing native modules without breaking text practice", async () => {
    const t = setup(); t.engine.available = () => false; await t.session.start();
    expect(t.engine.start).not.toHaveBeenCalled(); expect(t.session.state.message).toContain("type");
    const session = new VoiceSession(async () => { throw new Error("no module"); }, vi.fn(), vi.fn());
    await session.start(); expect(session.state.phase).toBe("idle"); expect(session.state.message).toContain("type");
  });
});
