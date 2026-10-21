import { Redirect, Tabs, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSignedIn } from "../../src/accountRoot";
import { buzz } from "../../src/device";
import { openQuestions } from "../../src/logic/questions";
import { moreCounts } from "../../src/logic/today";
import { useStore } from "../../src/store";
import { Icon, type IconName } from "../../src/ui/icons";
import { EdgeOverlay, edge } from "../../src/ui/edge";
import { colors, fonts } from "../../src/ui/theme";

// One job: be ready for your next shift. Bee-style extras (to-dos, Ask, memories, patterns) live under More.
const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: "index", label: "Today", icon: "home" },
  { name: "train", label: "Train", icon: "cap" },
  { name: "questions", label: "Questions", icon: "chat" },
  { name: "more", label: "More", icon: "menu" },
];

type BarProps = { state: { index: number; routes: { name: string; key: string }[] }; navigation: { navigate: (name: string) => void } };

function Bar({ state, navigation }: BarProps) {
  const insets = useSafeAreaInsets();
  const { state: app } = useStore();
  const badges: Record<string, number> = { questions: openQuestions(app).length, more: moreCounts(app).toSort };
  const current = state.routes[state.index]?.name;
  const tile = (on: boolean, dark?: boolean) => ({
    height: 58,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 3,
    backgroundColor: dark ? colors.ink : colors.card,
    ...(on || dark ? { borderWidth: 2, borderStyle: "solid" as const, borderColor: colors.ink } : edge("dotted", colors.faint, 2)),
    paddingHorizontal: 2,
    overflow: "hidden" as const,
  });
  const caption = (text: string, color: string) => (
    <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: fonts.bodyBold, fontSize: 8.5, letterSpacing: 0.2, color, maxWidth: "100%" }}>
      {text.toUpperCase()}
    </Text>
  );
  const tab = (t: (typeof TABS)[number]) => {
    const on = current === t.name;
    return (
      <Pressable
        key={t.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={badges[t.name] ? `${t.label}, ${badges[t.name]} waiting` : t.label}
        onPress={() => {
          buzz.tap();
          navigation.navigate(t.name);
        }}
        style={{ flex: 1 }}
      >
        {({ pressed }) => (
          <View style={[tile(on), { opacity: pressed ? 0.6 : 1 }]}>
            {!on && <EdgeOverlay kind="dotted" color={colors.faint} width={2} radius={16} />}
            <Icon name={t.icon} size={22} strokeWidth={on ? 2.2 : 1.9} color={on ? colors.ink : colors.pencil} />
            {caption(t.label, on ? colors.ink : colors.pencil)}
            {!!badges[t.name] && (
              <View style={{ position: "absolute", top: 5, right: 8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
                <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: fonts.bodyBold, fontSize: 10, color: colors.onHighlight }}>
                  {badges[t.name]! > 9 ? "9+" : badges[t.name]}
                </Text>
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom - 8, 10),
        backgroundColor: colors.bar,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
    >
      {TABS.slice(0, 2).map(tab)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Capture: talk, type, or bring in a Bee conversation"
        onPress={() => {
          buzz.tap();
          router.push("/capture");
        }}
        style={{ flex: 1 }}
      >
        {({ pressed }) => (
          <View style={[tile(false, true), { opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="plus" size={24} strokeWidth={2.6} color={colors.onHighlight} />
            {caption("Capture", colors.onHighlight)}
          </View>
        )}
      </Pressable>
      {TABS.slice(2).map(tab)}
    </View>
  );
}

export default function TabsLayout() {
  // Nothing in the app shows until you're signed in: the landing page offers sign in or create account.
  const signedIn = useSignedIn();
  if (!signedIn) return <Redirect href="/landing" />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Bar {...(props as unknown as BarProps)} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
