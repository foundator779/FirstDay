import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { hashString } from "../logic/text";
import { sketchPath } from "./kit";
import { colors } from "./theme";

export type Character = { name: string; role: string; hair: string; extra?: string; mouth: string };

/** Original doodle role-play characters. */
export const CAST: Character[] = [
  { name: "Rowan", role: "customer", hair: "M18 24c1-8 8-13 15-12 3-4 10-3 12 1 4 1 6 5 5 10", mouth: "M26 42c3 3 9 3 12 0" },
  { name: "Jules", role: "customer", hair: "M17 27c2-9 9-14 17-13 8 0 13 6 13 13", extra: "M22 32a4 4 0 1 0 8 0a4 4 0 1 0-8 0M34 32a4 4 0 1 0 8 0a4 4 0 1 0-8 0M30 32h4", mouth: "M27 43h10" },
  { name: "Ana", role: "guest", hair: "M18 26c3-8 9-12 15-12s12 4 14 12M30 8a5 5 0 1 0 6 0", mouth: "M26 41c3 4 9 4 12 0" },
  { name: "Theo", role: "visitor", hair: "M19 22l4-6 4 5 4-6 4 5 4-6 4 6 3 2", mouth: "M27 42c2-2 8-2 10 0" },
];

export function characterFor(id: string): Character {
  return CAST[hashString(id) % CAST.length]!;
}

export function Face({ who, size = 64 }: { who: Character; size?: number }) {
  const head = sketchPath(52, 52, hashString(who.name), 26, 1.2, 2);
  return (
    <View accessibilityLabel={`${who.name}, the ${who.role}`} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path d={head} transform="translate(6 8)" fill={colors.card} stroke={colors.ink} strokeWidth={2} />
        <Path d={who.hair} stroke={colors.ink} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {who.extra ? (
          <Path d={who.extra} stroke={colors.ink} strokeWidth={1.8} fill="none" />
        ) : (
          <>
            <Circle cx={26} cy={33} r={1.9} fill={colors.ink} />
            <Circle cx={38} cy={33} r={1.9} fill={colors.ink} />
          </>
        )}
        {who.extra && (
          <>
            <Circle cx={26} cy={32} r={1.4} fill={colors.ink} />
            <Circle cx={38} cy={32} r={1.4} fill={colors.ink} />
          </>
        )}
        <Path d={who.mouth} stroke={colors.ink} strokeWidth={2} fill="none" strokeLinecap="round" />
      </Svg>
    </View>
  );
}
