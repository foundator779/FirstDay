import { Tabs, router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { buzz } from "../../src/device";
import { useStore } from "../../src/store";
import { Icon, type IconName } from "../../src/ui/icons";
import { Sketch } from "../../src/ui/kit";
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
        style={{ flex: 1, alignItems: "center", paddingVertical: 6, gap: 2 }}
      >
        <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, backgroundColor: on ? colors.highlight : "transparent" }}>
          <Icon name={t.icon} size={26} strokeWidth={on ? 2.4 : 1.8} color={on ? colors.ink : colors.pencil} />
        </View>
        <Text style={{ fontFamily: fonts.hand, fontSize: 16, color: on ? colors.ink : colors.pencil }}>{t.label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", paddingBottom: Math.max(insets.bottom - 6, 8), paddingTop: 6, backgroundColor: colors.paper, borderTopWidth: 1.5, borderTopColor: colors.faint }}>
      {TABS.slice(0, 2).map(tab)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Capture: talk, type, or bring in a Bee conversation"
        onPress={() => {
          buzz.tap();
          router.push("/capture");
        }}
        style={{ flex: 1, alignItems: "center", marginTop: -26 }}
      >
        {({ pressed }) => (
          <Sketch seed="capture" radius={34} shadow={!pressed} fill={colors.highlight} style={{ width: 66, height: 66, alignItems: "center", justifyContent: "center", transform: [{ translateY: pressed ? 3 : 0 }] }}>
            <Icon name="plus" size={34} strokeWidth={2.6} />
          </Sketch>
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
