import { useMemo, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Path } from "react-native-svg";
import { buzz } from "../device";
import { hashString, rng } from "../logic/text";
import { markWords } from "../logic/training";
import { useStore } from "../store";
import { Icon, type IconName } from "./icons";
import { colors, fonts, sizes, space } from "./theme";

export function useUI() {
  const { state } = useStore();
  return { s: sizes(state.settings.bigText), settings: state.settings };
}

// ---------- hand-drawn frame ----------

/** A rounded rectangle traced with a slightly shaky pencil. Deterministic per seed. */
export function sketchPath(w: number, h: number, seed: number, radius = 16, jitter = 1.3, inset = 2): string {
  const rand = rng(seed);
  const j = () => (rand() - 0.5) * 2 * jitter;
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const r = Math.max(2, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  const pts: [number, number][] = [];
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 34));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([ax + (bx - ax) * t + j(), ay + (by - ay) * t + j()]);
    }
  };
  const arc = (cx: number, cy: number, start: number) => {
    for (let k = 0; k <= 3; k++) {
      const a = ((start + k * 30) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a) + j() * 0.4, cy + r * Math.sin(a) + j() * 0.4]);
    }
  };
  edge(x0 + r, y0, x1 - r, y0);
  arc(x1 - r, y0 + r, -90);
  edge(x1, y0 + r, x1, y1 - r);
  arc(x1 - r, y1 - r, 0);
  edge(x1 - r, y1, x0 + r, y1);
  arc(x0 + r, y1 - r, 90);
  edge(x0, y1 - r, x0, y0 + r);
  arc(x0 + r, y0 + r, 180);
  const n = pts.length;
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1]!, pts[0]!);
  let d = `M${m0[0]!.toFixed(1)} ${m0[1]!.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % n]!);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0]!.toFixed(1)} ${m[1]!.toFixed(1)}`;
  }
  return `${d} Z`;
}

type SketchProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  stroke?: string;
  radius?: number;
  seed?: number | string;
  shadow?: boolean;
  dashed?: boolean;
  strokeWidth?: number;
};

export function Sketch({ children, style, fill = colors.card, stroke = colors.ink, radius = 18, seed = 1, shadow, dashed, strokeWidth = 2 }: SketchProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const n = typeof seed === "number" ? seed : hashString(seed);
  const paths = useMemo(() => {
    if (!size.w || !size.h) return null;
    return {
      main: sketchPath(size.w, size.h, n, radius),
      second: sketchPath(size.w, size.h, n + 977, radius, 1.6),
      shade: sketchPath(size.w, size.h, n + 31, radius, 1),
    };
  }, [size.w, size.h, n, radius]);
  return (
    <View
      style={style}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
      }}
    >
      {paths && (
        <Svg pointerEvents="none" width={size.w + 6} height={size.h + 6} style={styles.svg}>
          {shadow && (
            <G transform="translate(4 5)">
              <Path d={paths.shade} fill={colors.ink} />
            </G>
          )}
          <Path d={paths.main} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeDasharray={dashed ? "7 7" : undefined} />
          {!dashed && <Path d={paths.second} fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={1} />}
        </Svg>
      )}
      {children}
    </View>
  );
}

/** A wobbly highlighter swipe, used under a heading. */
export function Scribble({ width = 120, seed = 3 }: { width?: number; seed?: number }) {
  const rand = rng(seed);
  let d = `M2 ${6 + rand() * 2}`;
  for (let x = 14; x <= width; x += 14) d += ` Q${x - 7} ${2 + rand() * 8} ${x} ${5 + rand() * 3}`;
  return (
    <Svg width={width + 4} height={12} style={{ marginTop: -6 }}>
      <Path d={d} stroke={colors.highlight} strokeWidth={7} strokeLinecap="round" fill="none" opacity={0.9} />
    </Svg>
  );
}

// ---------- text ----------

type TxtProps = {
  children?: ReactNode;
  v?: "hero" | "title" | "h2" | "body" | "small" | "tiny";
  hand?: boolean;
  bold?: boolean;
  dim?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export function Txt({ children, v = "body", hand, bold, dim, center, style, numberOfLines }: TxtProps) {
  const { s } = useUI();
  const isHand = hand ?? (v === "hero" || v === "title" || v === "h2");
  const size = s[v];
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={1.6}
      style={[
        {
          fontFamily: isHand ? fonts.hand : bold ? fonts.bodyBold : fonts.body,
          fontSize: size,
          lineHeight: Math.round(size * (isHand ? 1.2 : 1.45)),
          color: dim ? colors.pencil : colors.ink,
          textAlign: center ? "center" : "left",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Text with key words swiped in highlighter, so the one thing to remember jumps out. */
export function Marked({ text, keywords, v = "body", bold }: { text: string; keywords: string[]; v?: TxtProps["v"]; bold?: boolean }) {
  return (
    <Txt v={v} bold={bold}>
      {markWords(text, keywords).map((part, i) =>
        part.mark ? (
          <Text key={i} style={{ backgroundColor: colors.highlight }}>
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
  if (kind === "quiet") {
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
        {icon && <Icon name={icon} size={20} color={colors.pencil} />}
        <Text style={{ fontFamily: fonts.bodyBold, fontSize: s.small, color: colors.pencil, textDecorationLine: "underline" }}>{label}</Text>
      </Pressable>
    );
  }
  const primary = kind === "primary";
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
        <Sketch
          seed={label}
          shadow={primary && !pressed}
          fill={primary ? colors.highlight : colors.card}
          radius={small ? 14 : 18}
          style={{
            minHeight: small ? 44 : 60,
            paddingHorizontal: small ? 14 : 20,
            paddingVertical: small ? 8 : 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: align === "center" ? "center" : "flex-start",
            gap: 10,
            transform: [{ translateX: pressed && primary ? 3 : 0 }, { translateY: pressed && primary ? 4 : 0 }],
          }}
        >
          {icon && <Icon name={icon} size={small ? 20 : 24} />}
          <Text
            style={{
              flexShrink: 1,
              fontFamily: align === "left" ? fonts.body : fonts.hand,
              fontSize: align === "left" ? s.body : small ? s.body + 2 : s.h2,
              lineHeight: Math.round((align === "left" ? s.body : small ? s.body + 2 : s.h2) * 1.3),
              color: colors.ink,
              textAlign: align,
            }}
          >
            {label}
          </Text>
        </Sketch>
      )}
    </Pressable>
  );
}

export function IconBtn({ name, label, onPress, badge }: { name: IconName; label: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        buzz.tap();
        onPress();
      }}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
    >
      <Icon name={name} size={28} />
      {!!badge && (
        <View style={styles.badge}>
          <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink }}>{badge > 9 ? "9+" : badge}</Text>
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
      <Sketch seed={`chip${label}`} radius={20} fill={on ? colors.highlight : colors.card} strokeWidth={on ? 2.2 : 1.5} style={{ paddingHorizontal: 16, paddingVertical: 8, minHeight: 44, justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.hand, fontSize: s.body + 1, color: colors.ink }}>{label}</Text>
      </Sketch>
    </Pressable>
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
      <Sketch seed={`box${label}`} radius={8} fill={on ? colors.highlight : colors.card} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
        {on && <Icon name="check" size={24} strokeWidth={2.6} />}
      </Sketch>
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
      <Sketch seed={`tg${label}`} radius={8} fill={on ? colors.highlight : colors.card} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
        {on && <Icon name="check" size={24} strokeWidth={2.6} />}
      </Sketch>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint && <Txt v="small" dim>{hint}</Txt>}
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

export function TopBar({ title, onBack, close, right }: { title?: string; onBack?: () => void; close?: boolean; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 48, gap: 6 }}>
      {onBack ? <IconBtn name={close ? "close" : "back"} label={close ? "Close" : "Back"} onPress={onBack} /> : <View style={{ width: 4 }} />}
      <View style={{ flex: 1 }}>{title ? <Txt v="h2" numberOfLines={1}>{title}</Txt> : null}</View>
      {right}
    </View>
  );
}

export function Dots({ total, done, current }: { total: number; done: number; current?: number }) {
  return (
    <View accessibilityLabel={`${done} of ${total} done`} style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {Array.from({ length: total }, (_, i) => (
        <Sketch
          key={i}
          seed={i + 40}
          radius={8}
          strokeWidth={1.6}
          fill={i < done ? colors.ink : i === current ? colors.highlight : colors.card}
          style={{ width: 16, height: 16 }}
        />
      ))}
    </View>
  );
}

/** The exact source line, always visible next to anything derived from it. */
export function Quote({ who, text }: { who?: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.ink, opacity: 0.6 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="tiny" dim bold>
          {who ? `${who.toUpperCase()} SAID` : "FROM THE CONVERSATION"}
        </Txt>
        <Txt v="small" style={{ fontStyle: "italic" }}>
          “{text}”
        </Txt>
      </View>
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return (
    <Txt v="tiny" dim bold style={{ letterSpacing: 1.2 }}>
      {children.toUpperCase()}
    </Txt>
  );
}

export function Empty({ icon = "star", text }: { icon?: IconName; text: string }) {
  return (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
      <Icon name={icon} size={44} color={colors.pencil} strokeWidth={1.6} />
      <Txt dim center>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { position: "absolute", left: 0, top: 0 },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.highlight,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
});
