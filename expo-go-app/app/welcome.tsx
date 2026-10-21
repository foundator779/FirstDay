import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { say } from "../src/device";
import { useStore } from "../src/store";
import { Icon, type IconName } from "../src/ui/icons";
import { Btn, Dots, IconBtn, Screen, Txt } from "../src/ui/kit";
import { EdgeOverlay, edge } from "../src/ui/edge";
import { colors } from "../src/ui/theme";

// First run: one idea per screen, short lines, always skippable.
const PAGES: { icon: IconName; title: string; lines: string[] }[] = [
  {
    icon: "star",
    title: "Hi. Let's get you ready for your next shift.",
    lines: ["New job, twenty new procedures. You don't have to hold them all in your head.", "FirstDay Go shows you one next thing at a time."],
  },
  {
    icon: "bee",
    title: "Bee hears your trainer.",
    lines: [
      "Wear your Bee while someone shows you how things work (with their OK). Or tap the big + and type or paste it.",
      "I find each step, next to their exact words. You check them.",
    ],
  },
  {
    icon: "cap",
    title: "Practise. Stay current.",
    lines: [
      "Short role-play rounds. No grades. No streaks to lose.",
      "If your trainer changes a step later, you get a Change Drill: old vs. new, then the new way. Vague things become questions to ask.",
    ],
  },
];

export default function Welcome() {
  const { actions } = useStore();
  const [i, setI] = useState(0);
  const page = PAGES[i]!;
  const last = i === PAGES.length - 1;

  const done = () => {
    actions.finishOnboarding();
    router.replace("/");
  };

  return (
    <Screen
      footer={
        <>
          <Btn kind="primary" icon={last ? "check" : "chevron"} label={last ? "Let's go" : "Next"} onPress={() => (last ? done() : setI(i + 1))} />
          {!last && <Btn kind="quiet" label="Skip" onPress={() => done()} />}
        </>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View style={{ flex: 1 }}>
          <Dots total={PAGES.length} done={i} current={i} />
        </View>
        <IconBtn name="speaker" label="Read this aloud" onPress={() => say(`${page.title} ${page.lines.join(" ")}`)} />
      </View>
      <View style={{ gap: 18, paddingTop: 36 }}>
        <View style={{ alignSelf: "center", width: 168, height: 168, borderRadius: 84, ...edge("dotted", colors.faint, 2), alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
          <EdgeOverlay kind="dotted" color={colors.faint} width={2} radius={84} />
          <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: colors.wash, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}>
              <Icon name={page.icon} size={40} strokeWidth={2.2} color={colors.onHighlight} />
            </View>
          </View>
        </View>
        <Txt v="hero">{page.title}</Txt>
        {page.lines.map((l) => (
          <Txt key={l}>{l}</Txt>
        ))}
      </View>
    </Screen>
  );
}
