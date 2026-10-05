import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { say } from "../src/device";
import { useStore } from "../src/store";
import { Icon, type IconName } from "../src/ui/icons";
import { Btn, Dots, IconBtn, Screen, Txt } from "../src/ui/kit";
import { colors } from "../src/ui/theme";

// First run: one idea per screen, short lines, always skippable.
const PAGES: { icon: IconName; title: string; lines: string[] }[] = [
  {
    icon: "star",
    title: "Hi. One thing at a time.",
    lines: ["FirstDay Go catches what people tell you.", "Then it shows you only the next thing to do."],
  },
  {
    icon: "plus",
    title: "Capture anything.",
    lines: ["Tap the big + and talk, type, or bring in a Bee conversation.", "Messy is fine. I'll find the to-dos and things to remember."],
  },
  {
    icon: "cap",
    title: "Practise your new job.",
    lines: [
      "When a trainer explains how things work, I find each step with their exact words.",
      "You check them, then practise in short rounds. No grades. No streaks to lose.",
    ],
  },
];

export default function Welcome() {
  const { actions } = useStore();
  const [i, setI] = useState(0);
  const page = PAGES[i]!;
  const last = i === PAGES.length - 1;

  const done = (then?: "/account") => {
    actions.finishOnboarding();
    router.replace("/");
    if (then) router.push(then);
  };

  return (
    <Screen
      footer={
        <>
          <Btn kind="primary" icon={last ? "check" : "chevron"} label={last ? "Let's go" : "Next"} onPress={() => (last ? done() : setI(i + 1))} />
          {last ? (
            <Btn kind="quiet" label="Sign in for smarter reading (optional)" onPress={() => done("/account")} />
          ) : (
            <Btn kind="quiet" label="Skip" onPress={() => done()} />
          )}
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
        <View style={{ alignSelf: "center", width: 168, height: 168, borderRadius: 84, borderWidth: 2, borderStyle: "dotted", borderColor: colors.faint, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
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
