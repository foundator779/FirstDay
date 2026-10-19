/**
 * Terms of use shown when someone creates an account (they scroll to the end, then agree) and in Settings.
 * Plain language, short sections. Bump TERMS_VERSION when the meaning changes.
 */
import * as SecureStore from "expo-secure-store";

export const TERMS_VERSION = "2026-10-18";

export const TERMS: { heading: string; body: string }[] = [
  {
    heading: "1. About these terms",
    body: "These terms are an agreement between you and the FirstDay Go team. By creating an account you agree to them. If you don't agree, please don't create an account.",
  },
  {
    heading: "2. Who can use FirstDay Go",
    body: "You must be at least 13 years old. If you're under 18 (or the age of adulthood where you live), you need a parent's or guardian's permission.",
  },
  {
    heading: "3. What FirstDay Go is",
    body: "FirstDay Go helps you learn a new job: it turns what your trainer says into steps you check and practise. It's free, and it's a preview built for a hackathon. Features may change, pause or stop.",
  },
  {
    heading: "4. Your trainer comes first",
    body: "FirstDay Go uses speech recognition and AI, and both can mishear or misread. Always check steps with your trainer or employer, and follow their official instructions when they differ from the app. Don't rely on FirstDay Go for safety-critical, medical or legal decisions.",
  },
  {
    heading: "5. Recording other people",
    body: "If you record conversations (for example with Bee), you're responsible for getting the OK of everyone you record and for following recording laws and your workplace's rules. FirstDay Go reads a conversation only when you say yes.",
  },
  {
    heading: "6. Your account",
    body: "Use your own email and keep your password private. One person per account. If you think someone else is using your account, change your password and tell us.",
  },
  {
    heading: "7. Your data",
    body: "Your conversations, word-for-word transcripts, to-dos, memories and practice are saved on your phone, not in our cloud.\n\nWe keep your email and sign-in details (Amazon Cognito). When smarter reading is on, the text you capture is sent to Amazon Bedrock to be read and isn't stored by us. Trainings you share with a team are kept until you stop sharing them or delete your account. When you ask to join a team, that trainer sees your email and the name you give, never your answers. If you connect Bee without a computer, your Bee sign-in is kept encrypted and can only be unlocked with a key held on your phone.\n\nWe don't sell your data and don't use it for ads.",
  },
  {
    heading: "8. Your content",
    body: "What you capture is yours. You let us process it only to run the features you use, such as reading a capture or sending a training to your team. Don't add anything you aren't allowed to share, such as confidential information from your employer.",
  },
  {
    heading: "9. Fair use",
    body: "Don't use FirstDay Go to break the law, record people without permission, harass anyone, share other people's personal information without their OK, or attack, overload or get around the security of the service.",
  },
  {
    heading: "10. Other companies' products",
    body: "Bee, Apple Watch, Amazon Web Services, Amazon Bedrock and Expo belong to their makers, and their own terms apply to them. FirstDay Go isn't made or endorsed by Amazon, Bee or Apple.",
  },
  {
    heading: "11. Leaving",
    body: "You can delete your account any time in Settings → Account → Delete account. That removes your account and what we hold for it, such as shared trainings and app keys. Settings → Erase everything removes what's saved on your phone. We may suspend accounts that break these terms.",
  },
  {
    heading: "12. No guarantees",
    body: "FirstDay Go is provided \"as is\" and \"as available\", without warranties of any kind, to the extent the law allows. We don't promise it will be error-free or always available.",
  },
  {
    heading: "13. Limits on our responsibility",
    body: "To the extent the law allows, we aren't liable for indirect or consequential losses, or for mistakes made by relying on the app instead of your trainer. Our total liability is limited to the greater of what you paid us in the last 12 months or US$50. Some places don't allow these limits, so they may not apply to you.",
  },
  {
    heading: "14. Changes",
    body: "We may update these terms. If a change matters, we'll ask you to read and agree again in the app before you continue.",
  },
  {
    heading: "15. Contact",
    body: "Questions? Open an issue at github.com/foundator779/FirstDay.",
  },
];

const KEY = "firstday-go-terms-v1";

/** Remembers on this phone which version was accepted, by whom and when. */
export async function recordTermsAccepted(email: string) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ version: TERMS_VERSION, email: email.trim().toLowerCase(), at: Date.now() }));
  } catch {
    // Best effort: the agreement itself happened on screen.
  }
}
