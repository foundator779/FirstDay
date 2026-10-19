import { Alert, Platform } from "react-native";

/**
 * "Are you sure?" that works everywhere: a native alert on the phone, the browser's confirm on the web
 * (React Native Web's Alert does nothing, so destructive buttons would silently do nothing there).
 */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    const ask = (globalThis as { confirm?: (m: string) => boolean }).confirm;
    if (!ask || ask(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
