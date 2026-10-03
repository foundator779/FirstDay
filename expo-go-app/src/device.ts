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

export async function cancelReminder(id?: string) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}
