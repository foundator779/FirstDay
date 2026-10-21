import { Redirect, router } from "expo-router";
import { Text, View } from "react-native";
import { useSignedIn } from "../src/accountRoot";
import { Icon, type IconName } from "../src/ui/icons";
import { AppMark } from "../src/ui/mark";
import { Btn, Screen, Txt } from "../src/ui/kit";
import { EdgeOverlay, edge } from "../src/ui/edge";
import { colors, fonts } from "../src/ui/theme";

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "bee", label: "Bee hears" },
  { icon: "cap", label: "Practise" },
  { icon: "refresh", label: "Stay current" },
];

/** First screen for anyone signed out: what the app is, then create an account or sign in. */
export default function Landing() {
  const signedIn = useSignedIn();
  if (signedIn) return <Redirect href="/" />;

  return (
    <Screen
      footer={
        <>
          <Btn kind="primary" icon="plus" label="Create account" onPress={() => router.push("/account?start=signUp")} />
          <Btn label="Sign in" onPress={() => router.push("/account?start=signIn")} />
          <Txt v="tiny" dim center>
            Free. What you capture is saved on this phone.
          </Txt>
        </>
      }
    >
      <View style={{ alignItems: "center", gap: 16, paddingTop: 28 }}>
        <View style={{ width: 168, height: 168, borderRadius: 84, ...edge("dotted", colors.faint, 2), alignItems: "center", justifyContent: "center" }}>
          <EdgeOverlay kind="dotted" color={colors.faint} width={2} radius={84} />
          <AppMark size={112} />
        </View>
        <View style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 }}>
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, letterSpacing: 1.4, color: colors.onHighlight }}>FIRSTDAY GO</Text>
        </View>
        <Txt v="hero" center>
          Ready for your next shift.
        </Txt>
        <Txt dim center>
          Bee hears your trainer. FirstDay Go turns what they said into practice, one step at a time, and keeps you up to date when a step changes.
        </Txt>
      </View>

      <View style={{ flexDirection: "row", gap: 10, paddingTop: 8 }}>
        {FEATURES.map((f) => (
          <View
            key={f.label}
            style={{ flex: 1, height: 84, borderRadius: 18, ...edge("dotted", colors.faint, 2), alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <EdgeOverlay kind="dotted" color={colors.faint} width={2} radius={18} />
            <Icon name={f.icon} size={24} />
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.9, color: colors.ink }}>{f.label.toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
