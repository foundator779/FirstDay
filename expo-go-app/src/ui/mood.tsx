import { Pressable, Text, View } from "react-native";
import { buzz } from "../device";
import { MOOD_LABELS } from "../logic/patterns";
import type { MoodEntry } from "../logic/types";
import { colors, fonts } from "./theme";

/** "How did today feel?" in one tap: five circles from Rough to Great. The chosen one is black. */
export function MoodPicker({ value, onPick }: { value?: number; onPick: (score: MoodEntry["score"]) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6 }}>
      {MOOD_LABELS.map((label, i) => {
        const score = (i + 1) as MoodEntry["score"];
        const on = value === score;
        return (
          <Pressable
            key={label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            onPress={() => {
              buzz.tap();
              onPick(score);
            }}
            style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? colors.ink : colors.card,
                borderWidth: 2,
                borderStyle: on ? "solid" : "dotted",
                borderColor: on ? colors.ink : colors.faint,
              }}
            >
              {/* More filled = better day: a dot that grows with the score. */}
              <View style={{ width: 6 + i * 6, height: 6 + i * 6, borderRadius: 20, backgroundColor: on ? colors.onHighlight : colors.ink }} />
            </View>
            <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: on ? colors.ink : colors.pencil }}>
              {label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
