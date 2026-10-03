import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
import { PatrickHand_400Regular } from "@expo-google-fonts/patrick-hand";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { StoreProvider } from "../src/store";
import { colors } from "../src/ui/theme";

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.ink} accessibilityLabel="Loading" />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ PatrickHand_400Regular, AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });
  if (!loaded && !error) return <Loading />;
  return (
    <StoreProvider fallback={<Loading />}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: "fade" }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="capture" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="session/[packId]" options={{ gestureEnabled: false }} />
      </Stack>
    </StoreProvider>
  );
}
