import { Tabs, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buzz } from "../../src/device";
import { useStore } from "../../src/store";
import { Icon, type IconName } from "../../src/ui/icons";
import { colors, fonts } from "../../src/ui/theme";

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: "index", label: "Today", icon: "home" },
  { name: "todos", label: "Do", icon: "list" },
  { name: "ask", label: "Ask", icon: "chat" },
  { name: "train", label: "Train", icon: "cap" },
];

type BarProps = { state: { index: number; routes: { name: string; key: string }[] }; navigation: { navigate: (name: string) => void } };

function Bar({ state, navigation }: BarProps) {
  const insets = useSafeAreaInsets();
  const { state: app } = useStore();
  const nowCount = app.todos.filter((t) => !t.suggested && t.bucket === "now").length;
  const current = state.routes[state.index]?.name;
  const tile = (on: boolean, dark?: boolean) => ({
    height: 58,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 3,
    backgroundColor: dark ? colors.ink : colors.card,
    borderWidth: 2,
    borderStyle: on || dark ? ("solid" as const) : ("dotted" as const),
    borderColor: on || dark ? colors.ink : colors.faint,
  });
  const caption = (text: string, color: string) => (
    <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8, color }}>
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
        accessibilityLabel={t.name === "todos" && nowCount ? `${t.label}, ${nowCount} for now` : t.label}
        onPress={() => {
          buzz.tap();
          navigation.navigate(t.name);
        }}
        style={{ flex: 1 }}
      >
        {({ pressed }) => (
          <View style={[tile(on), { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={t.icon} size={22} strokeWidth={on ? 2.2 : 1.9} color={on ? colors.ink : colors.pencil} />
            {caption(t.label, on ? colors.ink : colors.pencil)}
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
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Bar {...(props as unknown as BarProps)} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
