import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";

// ---------- Read aloud ----------
export function say(text: string, onDone?: () => void) {
  void Speech.stop();
  Speech.speak(text, { language: "en-US", rate: 0.95, onDone, onStopped: onDone, onError: onDone });
}
export function hush() {
  void Speech.stop();
}

// ---------- Haptics ----------
let hapticsOn = true;
export function setHaptics(on: boolean) {
  hapticsOn = on;
}
export const buzz = {
  tap: () => hapticsOn && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  good: () => hapticsOn && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  nope: () => hapticsOn && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};

// ---------- Gentle reminders (local notifications work in Expo Go) ----------
let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {}
}

ensureHandler();

export async function canNotify(): Promise<boolean> {
  try {
    ensureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function remind(title: string, body: string, at: number): Promise<string | undefined> {
  if (at <= Date.now() + 5000) return undefined;
  if (!(await canNotify())) return undefined;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
  } catch {
    return undefined;
  }
}

/** A notification right now (used when a new Bee conversation is ready to practise). */
export async function notifyNow(title: string, body: string, data?: Record<string, string>) {
  if (!(await canNotify())) return;
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body, ...(data ? { data } : {}) }, trigger: null });
  } catch {}
}

type TapResponse = { notification: { date: number; request: { identifier: string; content: { data?: Record<string, unknown> | null } } } };
const handledTaps = new Set<string>();

/**
 * Calls back with the notification's data when the user taps one, including the tap that opened
 * the app from closed (if it was in the last 10 minutes). Each tap is handled once. Returns an unsubscribe.
 */
export function onNotificationTap(cb: (data: Record<string, unknown>) => void): () => void {
  const handle = (r: TapResponse | null | undefined) => {
    if (!r) return;
    const id = r.notification.request.identifier;
    if (handledTaps.has(id)) return;
    handledTaps.add(id);
    cb((r.notification.request.content.data ?? {}) as Record<string, unknown>);
  };
  try {
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r && Date.now() - r.notification.date < 10 * 60_000) handle(r);
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

export async function cancelAllReminders() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}

export async function cancelReminder(id?: string) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}
