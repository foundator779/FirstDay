import { Image, View } from "react-native";
import { firstDayTheme as theme } from "@firstday/firstday-ui";
import cast from "../assets/firstday-cast.png";
import { SvgXml } from "react-native-svg";
import { figmaIcons } from "./figma-icons";

export function Portrait({ person = "maya", size = 54 }: { person?: "maya" | "rowan"; size?: number }) {
  const scale = size / 64;
  return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: theme.colors.surface }}>
    <Image source={cast} accessibilityLabel={person === "maya" ? "Maya, training guide" : "Rowan, practice partner"} style={{ position: "absolute", width: 166 * scale, height: 140 * scale, top: -5 * scale, left: (person === "maya" ? -8 : -94) * scale }} />
  </View>;
}
function colored(xml: string, color: string) {
  return xml.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,8}|black|white)"/g, '$1="' + color + '"');
}
export function DesignIcon({ name, color = theme.colors.action, size = 22 }: { name: Exclude<keyof typeof figmaIcons, "navigation">; color?: string; size?: number }) {
  return <View accessible={false} style={{ width: size, height: size, justifyContent: "center", alignItems: "center", ...(name === "back" ? { transform: [{ rotate: "-90deg" }] } : {}) }}><SvgXml xml={colored(figmaIcons[name], color)} width={size} height={name === "back" ? size * 0.6 : size} /></View>;
}
/** Exact exported Figma icon strip, clipped to its four original glyphs. */
export function NavigationIcon({ index }: { index: 0 | 1 | 2 | 3 }) {
  return <View accessible={false} style={{ width: 27, height: 26, overflow: "hidden" }}><View style={{ position: "absolute", width: 244, height: 24, left: -[0, 76, 152, 222][index]!, top: 0 }}><SvgXml xml={colored(figmaIcons.navigation, "white")} width={244} height={24} /></View></View>;
}
