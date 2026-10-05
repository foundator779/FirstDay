import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line } from "react-native-svg";
import { buzz } from "../device";
import { markWords } from "../logic/training";
import { useStore } from "../store";
import { Icon, type IconName } from "./icons";
import { colors, fonts, OnDark, sizes, space, useOnDark } from "./theme";

export function useUI() {
  const { state } = useStore();
  return { s: sizes(state.settings.bigText), settings: state.settings };
}

// ---------- surfaces ----------

type SketchProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  stroke?: string;
  radius?: number;
  /** Kept so older call sites still compile; cards are no longer drawn by hand. */
  seed?: number | string;
  /** The main card on a screen: solid black edge. */
  shadow?: boolean;
  /** A side note: dashed grey edge. */
  dashed?: boolean;
  strokeWidth?: number;
};

/**
 * A card. White cards get a dotted grey edge, the main card a solid black one,
 * grey cards no edge. A black card flips the text and icons inside it to white.
 */
export function Sketch({ children, style, fill = colors.card, stroke, radius = 20, shadow, dashed, strokeWidth }: SketchProps) {
  const dark = fill === colors.ink;
  const white = fill === colors.card || fill === colors.paper;
  let edge: ViewStyle = {};
  if (dark) edge = {};
  else if (shadow) edge = { borderWidth: strokeWidth ?? 2, borderColor: stroke ?? colors.ink, borderStyle: "solid" };
  else if (dashed) edge = { borderWidth: strokeWidth ?? 1.5, borderColor: stroke ?? colors.pencil, borderStyle: "dashed" };
  else if (white) edge = { borderWidth: strokeWidth ?? 2, borderColor: stroke ?? colors.faint, borderStyle: "dotted" };
  else if (stroke) edge = { borderWidth: strokeWidth ?? 1.5, borderColor: stroke, borderStyle: "solid" };
  return (
    <OnDark.Provider value={dark}>
      <View style={[{ backgroundColor: fill, borderRadius: radius }, edge, style]}>{children}</View>
    </OnDark.Provider>
  );
}

/** Same as Sketch, by its plainer name. */
export const Card = Sketch;

/** A dotted rule under a section title. */
export function Divider({ color = colors.faint }: { color?: string }) {
  const [w, setW] = useState(0);
  return (
    <View
      style={{ height: 4, alignSelf: "stretch" }}
      onLayout={(e) => {
        const width = Math.round(e.nativeEvent.layout.width);
        if (width !== w) setW(width);
      }}
    >
      {w > 4 && (
        <Svg width={w} height={4} pointerEvents="none">
          <Line x1={2} y1={2} x2={w - 2} y2={2} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray="0.01 5" />
        </Svg>
      )}
    </View>
  );
}

/** The black capsule title at the top of a screen. */
export function Pill({ text }: { text: string }) {
  const { s } = useUI();
  return (
    <View style={{ backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, maxWidth: "100%" }}>
      <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ fontFamily: fonts.bodyBold, fontSize: s.small - 1, letterSpacing: 1.4, color: colors.onHighlight }}>
        {text.toUpperCase()}
      </Text>
    </View>
  );
}

// ---------- text ----------

type TxtProps = {
  children?: ReactNode;
  v?: "hero" | "title" | "h2" | "body" | "small" | "tiny";
  bold?: boolean;
  dim?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export function Txt({ children, v = "body", bold, dim, center, style, numberOfLines }: TxtProps) {
  const { s } = useUI();
  const dark = useOnDark();
  const heading = v === "hero" || v === "title" || v === "h2";
  const size = s[v];
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={1.6}
      style={[
        {
          fontFamily: heading || bold ? fonts.bodyBold : fonts.body,
          fontSize: size,
          lineHeight: Math.round(size * (heading ? 1.22 : 1.45)),
          letterSpacing: heading ? -0.3 : 0,
          color: dark ? (dim ? colors.onHighlightDim : colors.onHighlight) : dim ? colors.pencil : colors.ink,
          textAlign: center ? "center" : "left",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Text with key words set bold on a grey band, so the one thing to remember jumps out. */
export function Marked({ text, keywords, v = "body", bold }: { text: string; keywords: string[]; v?: TxtProps["v"]; bold?: boolean }) {
  return (
    <Txt v={v} bold={bold}>
      {markWords(text, keywords).map((part, i) =>
        part.mark ? (
          <Text key={i} style={{ fontFamily: fonts.bodyBold, backgroundColor: colors.highlightSoft }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Txt>
  );
}

// ---------- buttons ----------

type BtnProps = {
  label: string;
  onPress: () => void;
  kind?: "primary" | "plain" | "quiet";
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
  hint?: string;
  align?: "center" | "left";
  style?: StyleProp<ViewStyle>;
};

export function Btn({ label, onPress, kind = "plain", icon, disabled, small, hint, align = "center", style }: BtnProps) {
  const { s } = useUI();
  const dark = useOnDark();
  if (kind === "quiet") {
    const c = dark ? colors.onHighlightDim : colors.pencil;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={hint}
        disabled={disabled}
        onPress={() => {
          buzz.tap();
          onPress();
        }}
        hitSlop={10}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, opacity: disabled ? 0.4 : pressed ? 0.5 : 1, alignSelf: align === "center" ? "center" : "flex-start" }, style]}
      >
        {icon && <Icon name={icon} size={18} color={c} />}
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: s.small, color: c, textDecorationLine: "underline" }}>{label}</Text>
      </Pressable>
    );
  }
  const primary = kind === "primary";
  // On a black card the primary button turns white, and plain buttons get a white edge.
  const bg = primary ? (dark ? colors.paper : colors.ink) : dark ? "transparent" : colors.card;
  const fg = primary ? (dark ? colors.ink : colors.onHighlight) : dark ? colors.onHighlight : colors.ink;
  const edge: ViewStyle = primary ? {} : { borderWidth: 1.5, borderColor: dark ? colors.onHighlight : colors.ink };
  const fs = align === "left" ? s.body : small ? s.small + 1 : s.body + 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        buzz.tap();
        onPress();
      }}
      style={[{ opacity: disabled ? 0.4 : 1 }, style]}
    >
      {({ pressed }) => (
        <View
          style={[
            {
              minHeight: small ? 44 : 56,
              paddingHorizontal: small ? 14 : 20,
              paddingVertical: small ? 8 : 14,
              borderRadius: small ? 14 : 18,
              backgroundColor: bg,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: align === "center" ? "center" : "flex-start",
              gap: 10,
              opacity: pressed ? 0.78 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
            edge,
          ]}
        >
          {icon && <Icon name={icon} size={small ? 18 : 21} color={fg} strokeWidth={2.1} />}
          <Text
            style={{
              flexShrink: 1,
              fontFamily: align === "left" ? fonts.body : fonts.bodyBold,
              fontSize: fs,
              lineHeight: Math.round(fs * 1.3),
              color: fg,
              textAlign: align,
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** A round icon button with a dotted ring, like the header buttons. `bare` drops the ring. */
export function IconBtn({ name, label, onPress, badge, bare }: { name: IconName; label: string; onPress: () => void; badge?: number; bare?: boolean }) {
  const dark = useOnDark();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      hitSlop={8}
      onPress={() => {
        buzz.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
        ...(bare ? {} : { borderWidth: 2, borderStyle: "dotted" as const, borderColor: dark ? colors.onHighlightDim : colors.faint }),
      })}
    >
      <Icon name={name} size={22} />
      {!!badge && (
        <View style={styles.badge}>
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11, color: colors.onHighlight }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { s } = useUI();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={() => {
        buzz.tap();
        onPress();
      }}
    >
      {({ pressed }) => (
        <View
          style={{
            paddingHorizontal: 16,
            minHeight: 44,
            justifyContent: "center",
            borderRadius: 22,
            backgroundColor: on ? colors.ink : colors.card,
            borderWidth: 2,
            borderStyle: on ? "solid" : "dotted",
            borderColor: on ? colors.ink : colors.faint,
            opacity: pressed ? 0.7 : 1,
          }}
        >
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: s.small, color: on ? colors.onHighlight : colors.ink }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Box({ on }: { on: boolean }) {
  // On a black row the ticked box is white with a black tick.
  const dark = useOnDark();
  const edge = dark ? colors.onHighlight : colors.ink;
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: edge,
        backgroundColor: on ? edge : dark ? "transparent" : colors.card,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Icon name="check" size={20} strokeWidth={2.8} color={dark ? colors.ink : colors.onHighlight} />}
    </View>
  );
}

export function CheckBox({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        if (!on) buzz.good();
        else buzz.tap();
        onPress();
      }}
    >
      <Box on={on} />
    </Pressable>
  );
}

export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => {
        buzz.tap();
        onChange(!on);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 }}
    >
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint && <Txt v="small" dim>{hint}</Txt>}
      </View>
      <View
        style={{
          width: 52,
          height: 32,
          borderRadius: 16,
          padding: 3,
          borderWidth: 1.5,
          borderColor: on ? colors.ink : colors.faint,
          backgroundColor: on ? colors.ink : colors.wash,
          alignItems: on ? "flex-end" : "flex-start",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.paper, borderWidth: on ? 0 : 1.5, borderColor: colors.pencil, alignItems: "center", justifyContent: "center" }}>
          {on && <Icon name="check" size={14} strokeWidth={3} color={colors.ink} />}
        </View>
      </View>
    </Pressable>
  );
}

// ---------- layout ----------

export function Screen({ children, scroll = true, footer, pad = true }: { children: ReactNode; scroll?: boolean; footer?: ReactNode; pad?: boolean }) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: pad ? space.md + 4 : 0, paddingBottom: 40, gap: space.md }}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: pad ? space.md + 4 : 0, gap: space.md }}>{children}</View>
  );
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top }}>
      <View style={{ flex: 1 }}>{body}</View>
      {footer && <View style={{ paddingHorizontal: space.md + 4, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), gap: space.sm, backgroundColor: colors.paper }}>{footer}</View>}
    </KeyboardAvoidingView>
  );
}

type Progress = { total: number; done: number; current?: number };

/**
 * Screen header: a round button on each side and the black title capsule in the middle.
 * `sub` is a small centred line under it (the date on Today); `progress` a segmented bar.
 */
export function TopBar({ title, onBack, close, left, right, sub, progress }: { title?: string; onBack?: () => void; close?: boolean; left?: ReactNode; right?: ReactNode; sub?: string; progress?: Progress }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 48, gap: 8 }}>
        <View style={{ minWidth: 44, alignItems: "flex-start" }}>
          {onBack ? <IconBtn name={close ? "close" : "back"} label={close ? "Close" : "Back"} onPress={onBack} /> : left}
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>{title ? <Pill text={title} /> : null}</View>
        <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
      </View>
      {sub ? (
        <Txt v="small" dim center>
          {sub}
        </Txt>
      ) : null}
      {progress && progress.total > 0 ? <Dots {...progress} /> : null}
    </View>
  );
}

/** Segmented progress bar: black for done, outlined for the current one, grey for the rest. */
export function Dots({ total, done, current, stretch = true }: Progress & { stretch?: boolean }) {
  const dark = useOnDark();
  const on = dark ? colors.onHighlight : colors.ink;
  if (total <= 0) return null;
  const label = `${Math.min(done, total)} of ${total} done`;
  if (total > 24) {
    return (
      <View accessibilityLabel={label} style={{ height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: on, overflow: "hidden", alignSelf: stretch ? "stretch" : "flex-start", width: stretch ? undefined : 180 }}>
        <View style={{ width: `${Math.round((Math.min(done, total) / total) * 100)}%`, height: "100%", backgroundColor: on }} />
      </View>
    );
  }
  return (
    <View accessibilityLabel={label} style={{ flexDirection: "row", gap: 4, alignItems: "center", alignSelf: stretch ? "stretch" : "flex-start" }}>
      {Array.from({ length: total }, (_, i) => {
        const isDone = i < done;
        const isCurrent = i === current && !isDone;
        return (
          <View
            key={i}
            style={[
              { height: 10, borderRadius: 3, borderWidth: 1.5, borderColor: isDone || isCurrent ? on : colors.faint, backgroundColor: isDone ? on : "transparent" },
              stretch ? { flex: 1 } : { width: 18 },
            ]}
          />
        );
      })}
    </View>
  );
}

/** The exact source line, always visible next to anything derived from it. */
export function Quote({ who, text }: { who?: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.ink }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="tiny" dim bold style={{ letterSpacing: 0.8 }}>
          {who ? `${who.toUpperCase()} SAID` : "FROM THE CONVERSATION"}
        </Txt>
        <Txt v="small" style={{ fontStyle: "italic" }}>
          “{text}”
        </Txt>
      </View>
    </View>
  );
}

/** Small caps label. With `line`, a section title with a dotted rule under it. */
export function Label({ children, line }: { children: string; line?: boolean }) {
  if (!line) {
    return (
      <Txt v="tiny" dim bold style={{ letterSpacing: 1.2 }}>
        {children.toUpperCase()}
      </Txt>
    );
  }
  return (
    <View style={{ gap: 6, paddingTop: 4 }}>
      <Txt v="tiny" bold style={{ letterSpacing: 1.3 }}>
        {children.toUpperCase()}
      </Txt>
      <Divider />
    </View>
  );
}

/** A number in a dotted circle with a tiny caption, for at-a-glance counts. */
export function Stat({ value, label }: { value: string | number; label: string }) {
  const { s } = useUI();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <View style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 2, borderStyle: "dotted", borderColor: colors.faint, alignItems: "center", justifyContent: "center" }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.bodyBold, fontSize: s.h2 + 2, color: colors.ink }}>
          {value}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.pencil, textAlign: "center" }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function Empty({ icon = "star", text }: { icon?: IconName; text: string }) {
  return (
    <View style={{ alignItems: "center", gap: 12, paddingVertical: 28 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderStyle: "dotted", borderColor: colors.faint, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={34} color={colors.pencil} strokeWidth={1.7} />
      </View>
      <Txt dim center>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
