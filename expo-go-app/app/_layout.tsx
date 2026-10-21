import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { useFonts } from "expo-font";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { onNotificationTap } from "../src/device";
import { AccountStore, useSignedIn } from "../src/accountRoot";
import { useStore } from "../src/store";
import { DialogHost } from "../src/ui/dialog";
import { colors } from "../src/ui/theme";

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.ink} accessibilityLabel="Loading" />
    </View>
  );
}

/** Tapping "New from Bee" opens that conversation's consent screen; a team update opens its training. */
function NotificationRouter() {
  const { state } = useStore();
  const signedIn = useSignedIn();
  const allowed = useRef(signedIn);
  allowed.current = signedIn;
  const inbox = useRef(state.bee.inbox);
  inbox.current = state.bee.inbox;
  useEffect(
    () =>
      onNotificationTap((data) => {
        if (!allowed.current) return;
        // "Your trainer changed a step": open that training, where the Change Drill waits.
        if (typeof data.packId === "string" && data.packId) {
          router.push(`/pack/${encodeURIComponent(data.packId)}`);
          return;
        }
        if (typeof data.beeId !== "string" || !data.beeId) return;
        const item = inbox.current.find((i) => i.id === data.beeId);
        router.push({ pathname: "/capture", params: { beeId: data.beeId, ...(item ? { beeTitle: item.title, beeAt: String(item.at) } : {}) } });
      }),
    [],
  );
  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });
  if (!loaded && !error) return <Loading />;
  return (
    <AccountStore fallback={<Loading />}>
      <StatusBar style="dark" />
      <NotificationRouter />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: "fade" }}>
        <Stack.Screen name="landing" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="capture" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="join" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="session/[packId]" options={{ gestureEnabled: false }} />
      </Stack>
      <DialogHost />
    </AccountStore>
  );
}
