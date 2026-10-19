import { router } from "expo-router";
import { Screen, TopBar } from "../src/ui/kit";
import { TermsBody } from "../src/ui/TermsSheet";

/** The terms you agreed to when you created your account, to read again any time (Settings → Your data). */
export default function Terms() {
  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Terms of use" />
      <TermsBody />
    </Screen>
  );
}
