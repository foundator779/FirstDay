import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { conversationsByTraining, foundLine } from "../src/logic/conversations";
import { friendlyDay } from "../src/logic/dates";
import { useStore } from "../src/store";
import { Icon } from "../src/ui/icons";
import { Empty, Label, Screen, Sketch, TopBar, Txt } from "../src/ui/kit";
import { colors } from "../src/ui/theme";

/**
 * Every conversation you brought in, so "what exactly did they say?" is always two taps away.
 * Grouped by the training it became; saved on this phone only, until you delete it.
 */
export default function Conversations() {
  const { state } = useStore();
  const groups = conversationsByTraining(state);
  const now = Date.now();

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Conversations" />
      <Txt v="small" dim>
        Word for word, saved on this phone only. Only the ones you said yes to.
      </Txt>
      {groups.length === 0 ? (
        <Empty icon="mic" text="Conversations you bring in from Bee, paste or say are kept here." />
      ) : (
        groups.map((g) => (
          <View key={g.packId ?? "other"} style={{ gap: 8 }}>
            <Label line>{g.title}</Label>
            {g.rows.map((r) => (
              <Pressable key={r.convo.id} accessibilityRole="button" accessibilityLabel={`${r.convo.title}, ${foundLine(r)}`} onPress={() => router.push(`/convo/${r.convo.id}`)}>
                <Sketch seed={r.convo.id} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt numberOfLines={2}>{r.convo.title}</Txt>
                    <Txt v="small" dim>
                      {friendlyDay(r.convo.at, now)}
                      {r.convo.source === "bee" ? " · from Bee" : ""} · {foundLine(r)}
                    </Txt>
                  </View>
                  <Icon name="chevron" size={20} color={colors.pencil} />
                </Sketch>
              </Pressable>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
