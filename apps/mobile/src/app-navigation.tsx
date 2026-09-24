import { Pressable, StyleSheet, Text, View } from "react-native";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import { NavigationIcon } from "./design-assets";

export type AppTab = "home" | "practice" | "questions" | "about";
const tabs = [
  { id: "home", label: "Training", icon: 0 }, { id: "questions", label: "Questions", icon: 1 },
  { id: "about", label: "About", icon: 2 }, { id: "practice", label: "Practice", icon: 3 },
] as const;
export function BottomNavigation({ value, onChange }: { value: AppTab; onChange(tab: AppTab): void }) {
  return <View style={styles.dock}><View accessibilityRole="tablist" style={styles.bar}>{tabs.map((tab) => <Pressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label} aria-selected={value === tab.id} accessibilityState={{ selected: value === tab.id }} onPress={() => onChange(tab.id)} style={[styles.tab, value === tab.id && styles.selected]}>
    <NavigationIcon index={tab.icon} /><Text style={styles.label}>{tab.label}</Text>
  </Pressable>)}</View></View>;
}
const styles = StyleSheet.create({
  dock: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 12, backgroundColor: "white", width: "100%", maxWidth: 520, alignSelf: "center" },
  bar: { borderRadius: 30, padding: 5, backgroundColor: theme.colors.action, flexDirection: "row", alignItems: "center" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 52, gap: 3, borderRadius: 25 }, selected: { backgroundColor: "#1045CE" },
  label: { fontFamily: theme.type.utility, fontSize: 12, color: "white" },
});
