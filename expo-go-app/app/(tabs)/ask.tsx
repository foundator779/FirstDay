import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { say } from "../../src/device";
import { useStore } from "../../src/store";
import { Icon } from "../../src/ui/icons";
import { Btn, IconBtn, Sketch, Txt, useUI } from "../../src/ui/kit";
import { colors, fonts } from "../../src/ui/theme";

const STARTERS = ["What should I do next?", "What did I talk about today?", "What do you remember about me?"];

export default function Ask() {
  const { state, actions } = useStore();
  const { s } = useUI();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const memories = state.memories.filter((m) => !m.suggested).length;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    await actions.ask(q);
    setBusy(false);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const titleFor = (id: string) =>
    state.conversations.find((c) => c.id === id)?.title ?? state.memories.find((m) => m.id === id)?.text ?? state.todos.find((t) => t.id === id)?.text ?? state.packs.find((p) => p.id === id)?.title;
  const open = (id: string) => {
    if (state.conversations.some((c) => c.id === id)) router.push(`/convo/${id}`);
    else if (state.todos.some((t) => t.id === id)) router.push(`/focus/${id}`);
    else if (state.memories.some((m) => m.id === id)) router.push("/memories");
    else if (state.packs.some((p) => p.id === id)) router.push(`/pack/${id}`);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 16 }}>
        <Txt v="title" style={{ flex: 1 }}>
          Ask
        </Txt>
        {state.chat.length > 0 && <IconBtn name="trash" label="Clear chat" onPress={actions.clearChat} />}
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 24 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Btn small icon="brain" label={`What I remember about you (${memories})`} onPress={() => router.push("/memories")} />
        {state.chat.length === 0 && (
          <View style={{ gap: 10, paddingTop: 8 }}>
            <Txt dim>Ask about your conversations, to-dos, memories or work rules. Try:</Txt>
            {STARTERS.map((q) => (
              <Btn key={q} label={q} small align="left" onPress={() => void send(q)} />
            ))}
            {!state.brain?.ai && (
              <Txt v="small" dim>
                Answers come from simple search on your phone. Connect the brain in Settings for smarter answers.
              </Txt>
            )}
          </View>
        )}
        {state.chat.map((m) =>
          m.role === "me" ? (
            <View key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
              <Sketch seed={m.id} fill={colors.highlightSoft} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
                <Txt>{m.text}</Txt>
              </Sketch>
            </View>
          ) : (
            <View key={m.id} style={{ alignSelf: "flex-start", maxWidth: "92%", gap: 6 }}>
              <Sketch seed={m.id} style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }}>
                <Txt>{m.text}</Txt>
                <Pressable accessibilityRole="button" accessibilityLabel="Read answer aloud" onPress={() => say(m.text)} hitSlop={8} style={{ alignSelf: "flex-start" }}>
                  <Icon name="speaker" size={22} color={colors.pencil} />
                </Pressable>
              </Sketch>
              {(m.sources ?? []).slice(0, 3).map((id) => {
                const t = titleFor(id);
                return t ? (
                  <Pressable key={id} accessibilityRole="link" onPress={() => open(id)}>
                    <Txt v="small" dim style={{ textDecorationLine: "underline" }} numberOfLines={1}>
                      ↳ {t}
                    </Txt>
                  </Pressable>
                ) : null;
              })}
            </View>
          ),
        )}
        {busy && <ActivityIndicator color={colors.ink} style={{ alignSelf: "flex-start" }} />}
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <Sketch seed="ask-input" style={{ flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 6, minHeight: 56 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send(draft)}
            placeholder="Ask anything… (tap 🎤 on the keyboard to talk)"
            placeholderTextColor={colors.pencil}
            returnKeyType="send"
            accessibilityLabel="Question"
            style={{ flex: 1, fontFamily: fonts.body, fontSize: s.body, color: colors.ink, paddingVertical: 10 }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => void send(draft)} hitSlop={8} style={{ padding: 8 }}>
            <Icon name="play" size={24} />
          </Pressable>
        </Sketch>
      </View>
    </KeyboardAvoidingView>
  );
}
