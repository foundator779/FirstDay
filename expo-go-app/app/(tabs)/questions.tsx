import { router } from "expo-router";
import { useState } from "react";
import { Share, View } from "react-native";
import { say } from "../../src/device";
import { openQuestions } from "../../src/logic/questions";
import type { TrainerQuestion } from "../../src/logic/types";
import { useStore } from "../../src/store";
import { Btn, Empty, IconBtn, Label, Quote, Screen, Sketch, TopBar, Txt } from "../../src/ui/kit";
import { colors } from "../../src/ui/theme";

/**
 * Questions for your trainer: the things that were said vaguely ("maybe allow another day").
 * FirstDay never turns them into rules, so you ask instead of guessing on shift.
 */
export default function Questions() {
  const { state, actions } = useStore();
  const [showAsked, setShowAsked] = useState(false);
  const open = openQuestions(state);
  const asked = state.questions.filter((q) => q.askedAt).sort((a, b) => (b.askedAt ?? 0) - (a.askedAt ?? 0));
  const packOf = (q: TrainerQuestion) => state.packs.find((p) => p.id === q.packId);

  const shareAll = () => {
    const lines = open.map((q, i) => `${i + 1}. ${q.text}`);
    void Share.share({ message: `Questions for my trainer:\n${lines.join("\n")}` }).catch(() => {});
  };

  return (
    <Screen>
      <TopBar
        title="Questions"
        right={open.length > 0 ? <IconBtn name="speaker" label="Read them aloud" onPress={() => say(open.map((q) => q.text).join(". "))} /> : undefined}
      />
      <Txt dim center>
        Things your trainer said vaguely. I never turn these into rules. Ask them before your shift, so you don't have to guess.
      </Txt>

      {open.length === 0 ? (
        <Empty icon="check" text={state.questions.length ? "Nothing left to ask. Nice." : "No questions yet. When a trainer says “maybe” or “usually”, the question shows up here."} />
      ) : (
        <>
          {open.map((q) => {
            const pack = packOf(q);
            return (
              <Sketch key={q.id} seed={q.id} style={{ padding: 16, gap: 10 }}>
                {pack && (
                  <Txt v="tiny" dim bold style={{ letterSpacing: 1 }}>
                    {pack.title.toUpperCase()}
                  </Txt>
                )}
                <Txt v="h2">{q.text}</Txt>
                {q.quote && <Quote who={pack?.trainer} text={q.quote} />}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Btn small style={{ flex: 1 }} icon="check" label="I asked" onPress={() => actions.markAsked(q.id)} />
                  <Btn small style={{ flex: 1 }} icon="mic" label="Got the answer" onPress={() => router.push("/capture")} hint="Capture the answer so it becomes a step" />
                </View>
              </Sketch>
            );
          })}
          <Sketch seed="answer-tip" dashed fill={colors.wash} style={{ padding: 14 }}>
            <Txt v="small">
              When your trainer answers, wear your Bee (or tap Capture and type it). Their answer becomes a step you can practise, with their exact words.
            </Txt>
          </Sketch>
          <Btn kind="quiet" icon="link" label="Send this list to myself" onPress={shareAll} />
        </>
      )}

      {asked.length > 0 && (
        <View style={{ gap: 8 }}>
          <Btn kind="quiet" align="left" label={showAsked ? "Hide what I already asked" : `Already asked (${asked.length})`} onPress={() => setShowAsked(!showAsked)} />
          {showAsked && (
            <>
              <Label line>Already asked</Label>
              {asked.map((q) => (
                <Sketch key={q.id} seed={q.id} fill={colors.wash} style={{ padding: 12, gap: 6 }}>
                  <Txt v="small" dim>
                    {q.text}
                  </Txt>
                  <Btn kind="quiet" align="left" icon="undo" label="Still need to ask" onPress={() => actions.markAsked(q.id, false)} />
                </Sketch>
              ))}
            </>
          )}
        </View>
      )}
    </Screen>
  );
}
