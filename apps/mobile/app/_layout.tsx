import { firstDayTheme } from "@firstday/firstday-ui";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts, LeagueSpartan_400Regular, LeagueSpartan_500Medium, LeagueSpartan_600SemiBold } from "@expo-google-fonts/league-spartan";
import { KeyboardProvider } from "../src/keyboard-scroll";
import { ActivityIndicator, View } from "react-native";

export default function RootLayout() {
  const [loaded, error] = useFonts({ LeagueSpartan_400Regular, LeagueSpartan_500Medium, LeagueSpartan_600SemiBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: "white", justifyContent: "center" }}><ActivityIndicator accessibilityLabel="Loading FirstDay" color={firstDayTheme.colors.action} /></View>;
  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: firstDayTheme.colors.canvas },
          headerBackTitle: "Back",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: firstDayTheme.colors.canvas },
          headerTintColor: firstDayTheme.colors.ink,
          headerTitleStyle: { fontFamily: firstDayTheme.type.display, fontWeight: "600" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: "FirstDay" }} />
      </Stack>
    </KeyboardProvider>
  );
}
