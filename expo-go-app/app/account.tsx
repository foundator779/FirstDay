import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import {
  AuthError, PASSWORD_RULES, authConfigured, confirmSignUp, deleteAccount, forgotPassword, resendSignUpCode,
  resetPassword, signIn, signOut, signUp, useSession,
} from "../src/auth";
import { buzz } from "../src/device";
import { Icon } from "../src/ui/icons";
import { Btn, Label, Screen, Sketch, TopBar, Txt, useUI } from "../src/ui/kit";
import { colors, fonts } from "../src/ui/theme";

type Step = "signIn" | "signUp" | "confirm" | "forgot" | "reset";

/** One step per screen: sign in, create account, confirm email code, forgot / reset password. */
export default function Account() {
  const session = useSession();
  const { s } = useUI();
  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const go = (next: Step, message = "") => {
    setStep(next);
    setError("");
    setNote(message);
    setCode("");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      const err = e instanceof AuthError ? e : new AuthError("Error", "Something went wrong. Try again.");
      if (err.code === "UserNotConfirmedException") {
        try {
          await resendSignUpCode(email);
          setCooldown(30);
        } catch {}
        go("confirm", err.message);
      } else {
        setError(err.message);
        buzz.nope();
      }
    }
    setBusy(false);
  };

  const field = {
    fontFamily: fonts.body,
    fontSize: s.body + 1,
    color: colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 14,
  } as const;
  const rulesOk = PASSWORD_RULES.every((r) => r.test(password));
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const codeOk = /^\d{6}$/.test(code.trim());

  if (!authConfigured) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} title="Account" />
        <Sketch seed="no-auth" dashed fill={colors.wash} style={{ padding: 18, gap: 8 }}>
          <Txt>Accounts aren't switched on in this build yet.</Txt>
          <Txt v="small" dim>
            Add EXPO_PUBLIC_COGNITO_REGION and EXPO_PUBLIC_COGNITO_CLIENT_ID to expo-go-app/.env (see AUTH-SETUP.md), then restart Expo.
          </Txt>
        </Sketch>
        <Txt v="small" dim>
          The app works fully without an account.
        </Txt>
      </Screen>
    );
  }

  // ---------- signed in ----------
  if (session) {
    return (
      <Screen
        footer={
          <>
            <Btn label="Sign out" icon="back" onPress={() => void run(async () => { await signOut(); go("signIn"); })} />
            <Btn
              kind="quiet"
              icon="trash"
              label="Delete my account"
              onPress={() =>
                Alert.alert("Delete your account?", "This permanently deletes your account. What's saved on this phone stays.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => void run(async () => { await deleteAccount(); go("signIn", "Your account was deleted."); }) },
                ])
              }
            />
          </>
        }
      >
        <TopBar onBack={() => router.back()} title="Account" />
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 24 }}>
          <Icon name="check" size={52} strokeWidth={2.6} />
          <Txt v="title" center>
            You're signed in
          </Txt>
          <Txt dim center>
            {session.email}
          </Txt>
        </View>
        {!!error && <Txt>{error}</Txt>}
        {busy && <ActivityIndicator color={colors.ink} />}
      </Screen>
    );
  }

  const EmailField = (
    <Sketch seed="f-email" style={{ minHeight: 56, justifyContent: "center" }}>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        placeholderTextColor={colors.pencil}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        accessibilityLabel="Email"
        style={field}
      />
    </Sketch>
  );

  // A function returning an element (not a component), so the input keeps focus while typing.
  const passwordField = (isNew: boolean) => (
    <Sketch seed={isNew ? "f-newpass" : "f-pass"} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", paddingRight: 8 }}>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={isNew ? "New password" : "Password"}
        placeholderTextColor={colors.pencil}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={isNew ? "newPassword" : "password"}
        autoComplete={isNew ? "new-password" : "current-password"}
        accessibilityLabel={isNew ? "New password" : "Password"}
        style={[field, { flex: 1 }]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"} onPress={() => setShow(!show)} hitSlop={8} style={{ padding: 8 }}>
        <Txt v="small" bold dim>
          {show ? "Hide" : "Show"}
        </Txt>
      </Pressable>
    </Sketch>
  );

  const Rules = (
    <View style={{ gap: 4 }}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <View key={r.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {ok ? <Icon name="check" size={18} strokeWidth={2.6} /> : <View style={{ width: 18, alignItems: "center" }}><Txt v="small" dim>○</Txt></View>}
            <Txt v="small" dim={!ok}>
              {r.label}
            </Txt>
          </View>
        );
      })}
    </View>
  );

  const CodeField = (
    <Sketch seed="f-code" fill={colors.highlightSoft} style={{ minHeight: 64, justifyContent: "center" }}>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
        placeholderTextColor={colors.pencil}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        accessibilityLabel="6-digit code"
        style={{ fontFamily: fonts.bodyBold, fontSize: 32, letterSpacing: 10, textAlign: "center", color: colors.ink, paddingVertical: 8 }}
      />
    </Sketch>
  );

  const Resend = (send: () => Promise<void>) => (
    <Btn
      kind="quiet"
      label={cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
      disabled={cooldown > 0 || busy}
      onPress={() => void run(async () => { await send(); setCooldown(30); setNote("New code sent. Check your email (and spam)."); })}
    />
  );

  const Messages = (
    <>
      {!!note && (
        <Sketch seed="note" fill={colors.wash} style={{ padding: 12 }}>
          <Txt v="small">{note}</Txt>
        </Sketch>
      )}
      {!!error && (
        <Sketch seed="err" fill={colors.highlightSoft} style={{ padding: 12 }}>
          <Txt v="small" bold>
            {error}
          </Txt>
        </Sketch>
      )}
    </>
  );

  const primary = (label: string, enabled: boolean, fn: () => Promise<void>) =>
    busy ? <ActivityIndicator color={colors.ink} /> : <Btn kind="primary" label={label} disabled={!enabled} onPress={() => void run(fn)} />;

  // ---------- sign in ----------
  if (step === "signIn") {
    return (
      <Screen
        footer={
          <>
            {primary("Sign in", emailOk && password.length > 0, async () => {
              await signIn(email, password);
              buzz.good();
              setPassword("");
            })}
            <Btn kind="quiet" label="New here? Create an account" onPress={() => go("signUp")} />
          </>
        }
      >
        <TopBar onBack={() => router.back()} title="Sign in" />
        <Txt dim>Optional. It backs up your stuff and unlocks the smart helper.</Txt>
        <Label>Email</Label>
        {EmailField}
        <Label>Password</Label>
        {passwordField(false)}
        <Btn kind="quiet" align="left" label="Forgot password?" onPress={() => go("forgot")} />
        {Messages}
      </Screen>
    );
  }

  // ---------- create account ----------
  if (step === "signUp") {
    return (
      <Screen
        footer={
          <>
            {primary("Create account", emailOk && rulesOk, async () => {
              await signUp(email, password);
              setCooldown(30);
              go("confirm", `We sent a 6-digit code to ${email.trim()}.`);
            })}
            <Btn kind="quiet" label="I already have an account" onPress={() => go("signIn")} />
          </>
        }
      >
        <TopBar onBack={() => go("signIn")} title="Create account" />
        <Txt v="small" dim>
          Step 1 of 2
        </Txt>
        <Label>Email</Label>
        {EmailField}
        <Label>Password</Label>
        {passwordField(true)}
        {Rules}
        {Messages}
      </Screen>
    );
  }

  // ---------- confirm email ----------
  if (step === "confirm") {
    return (
      <Screen
        footer={primary("Confirm email", codeOk, async () => {
          await confirmSignUp(email, code);
          buzz.good();
          if (password) {
            await signIn(email, password);
            setPassword("");
          } else {
            go("signIn", "Email confirmed. Sign in to finish.");
          }
        })}
      >
        <TopBar onBack={() => go("signUp")} title="Check your email" />
        <Txt v="small" dim>
          Step 2 of 2
        </Txt>
        <Txt>Type the 6-digit code we emailed to {email.trim() || "you"}.</Txt>
        {CodeField}
        {Resend(() => resendSignUpCode(email))}
        {Messages}
      </Screen>
    );
  }

  // ---------- forgot password ----------
  if (step === "forgot") {
    return (
      <Screen
        footer={primary("Email me a code", emailOk, async () => {
          await forgotPassword(email);
          setCooldown(30);
          setPassword("");
          go("reset", `If there's an account for ${email.trim()}, a 6-digit code is on its way.`);
        })}
      >
        <TopBar onBack={() => go("signIn")} title="Reset password" />
        <Txt>No stress. We'll email you a code to set a new password.</Txt>
        <Label>Email</Label>
        {EmailField}
        {Messages}
      </Screen>
    );
  }

  // ---------- reset password ----------
  return (
    <Screen
      footer={primary("Set new password", codeOk && rulesOk, async () => {
        await resetPassword(email, code, password);
        buzz.good();
        await signIn(email, password);
        setPassword("");
      })}
    >
      <TopBar onBack={() => go("forgot")} title="New password" />
      <Label>Code from the email</Label>
      {CodeField}
      {Resend(() => forgotPassword(email))}
      <Label>New password</Label>
      {passwordField(true)}
      {Rules}
      {Messages}
    </Screen>
  );
}
