import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors } from "./theme";

export type IconName =
  | "plus" | "back" | "close" | "speaker" | "check" | "bee" | "sliders" | "bulb" | "play" | "timer" | "pencil"
  | "trash" | "star" | "chevron" | "home" | "list" | "chat" | "cap" | "mic" | "moon" | "split" | "refresh" | "link" | "undo" | "brain";

/** Hand-drawn doodle icons: slightly uneven strokes, round caps, no fill. */
const PATHS: Record<IconName, string[]> = {
  plus: ["M12.2 4.4c-.3 5 .3 10.1-.1 15.3", "M4.5 12.3c5-.5 10 .3 15.1-.2"],
  back: ["M14.8 5.2 8.1 12.1l6.9 6.6", "M8.6 12.2c3.7.2 7.6-.2 11.2.1"],
  close: ["M6.2 6.1c3.9 3.8 7.8 7.9 11.7 11.8", "M17.8 6.3C14 10 10 13.9 6.1 17.7"],
  speaker: ["M4.2 9.6h3.4l4.6-4v13l-4.6-4H4.2z", "M15.6 9.1c1.3 1.7 1.2 4.3-.1 5.9", "M18.3 6.6c2.6 3.1 2.5 7.9-.1 10.9"],
  check: ["M4.8 12.9c1.5 1.4 2.9 2.8 4.4 4.3 3.2-3.6 6.5-7.2 9.9-10.8"],
  bee: ["M9.6 10c-2.6-4.2-6.8-2.5-4.6.6 1 1.3 3 1.2 4.7-.4", "M14 9.9c1-4.6 5.6-4.1 4.7-.9-.6 1.8-2.8 2-4.6 1", "M10.2 10.6v7.2", "M13.6 10.4v7.5", "M18.3 14.2l2.4.2"],
  sliders: ["M4 7.2c5.3-.2 10.6.2 16 0", "M4.1 12.4c5.3.1 10.6-.1 15.8.1", "M3.9 17.6c5.4-.2 10.7.1 16.1-.1"],
  bulb: ["M9.2 17.6h5.8", "M10.1 20.4h4", "M12 3.6c-3.6 0-6 2.6-6 5.8 0 2.3 1.4 3.5 2.6 4.8.5.6.7 1.4.7 2.2h5.4c0-.8.2-1.6.7-2.2 1.2-1.3 2.6-2.5 2.6-4.8 0-3.2-2.4-5.8-6-5.8z"],
  play: ["M8.1 5.4c-.2 4.4.1 8.8 0 13.2 3.6-2.1 7.2-4.3 10.6-6.6C15.2 9.7 11.7 7.5 8.1 5.4z"],
  timer: ["M12 13.2V9.6", "M9.8 3.6h4.4", "M18 7.2l1.3-1.3"],
  pencil: ["M4.6 19.4l1-4.3L15.9 4.8l3.3 3.3L8.9 18.4z", "M13.9 6.9l3.2 3.2"],
  trash: ["M5 7.1c4.7-.2 9.3.1 14 0", "M9.5 7V4.6h5V7", "M7.1 7.3l1 12.8h7.8l1-12.9"],
  star: ["M12 3.6l2 5.5 5.8.3-4.6 3.6 1.6 5.6L12 15.3l-4.8 3.3 1.6-5.6-4.6-3.6 5.8-.3z"],
  chevron: ["M9.6 5.4c2.2 2.3 4.4 4.5 6.5 6.7-2.1 2.1-4.3 4.2-6.5 6.4"],
  home: ["M4.3 11.2 12 4.6l7.7 6.6", "M6.4 9.6v9.9h11.2V9.5", "M10.3 19.4v-5h3.4v5"],
  list: ["M9 7c3.7-.1 7.4.1 11 0", "M9 12.1c3.7.1 7.3-.1 11 .1", "M9 17.2c3.6-.1 7.3.1 11-.1", "M4.6 6.9h.6", "M4.6 12.1h.6", "M4.6 17.2h.6"],
  chat: ["M4.4 6.6c0-1.3 1-2.2 2.3-2.2h10.6c1.3 0 2.3 1 2.3 2.2v7c0 1.3-1 2.2-2.3 2.2H10l-4.3 3.8v-3.8h-.9c-1.3 0-2.3-1-2.3-2.2z"],
  cap: ["M2.8 9.4 12 5.2l9.2 4.2-9.2 4.3z", "M6.6 11.4v4.2c3.3 2.6 7.5 2.6 10.8 0v-4.2", "M20.8 9.6v5"],
  mic: ["M12 3.8c-1.6 0-2.7 1.2-2.7 2.7v5.2c0 1.5 1.1 2.7 2.7 2.7s2.7-1.2 2.7-2.7V6.5c0-1.5-1.1-2.7-2.7-2.7z", "M6.2 11.2c0 3.3 2.6 5.8 5.8 5.8s5.8-2.5 5.8-5.8", "M12 17.2v3.3"],
  moon: ["M19.2 14.6A7.6 7.6 0 0 1 9.4 4.8a7.6 7.6 0 1 0 9.8 9.8z"],
  split: ["M5 5.6h5.6", "M5 12.1h9.5", "M5 18.4h13.8"],
  refresh: ["M19 8.2a7.5 7.5 0 1 0 .8 6", "M19.5 3.9v4.5H15"],
  link: ["M10.3 13.7a3.6 3.6 0 0 0 5.1.1l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3", "M13.7 10.3a3.6 3.6 0 0 0-5.1-.1l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3"],
  undo: ["M9.2 5.3 4.8 9.6l4.4 4.2", "M5.1 9.6h9.1c3 0 5.1 2.2 5.1 4.9s-2.1 4.9-5.1 4.9H11"],
  brain: ["M9.2 4.6c-2.2 0-3.6 1.6-3.4 3.4-1.7.6-2.4 2.5-1.5 4-1 1.6-.2 3.8 1.7 4.2.2 2 2.1 3.3 4 2.6l.2-14.2z", "M14.8 4.6c2.2 0 3.6 1.6 3.4 3.4 1.7.6 2.4 2.5 1.5 4 1 1.6.2 3.8-1.7 4.2-.2 2-2.1 3.3-4 2.6l-.2-14.2z"],
};

export function Icon({ name, size = 26, color = colors.ink, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "timer" && <Circle cx={12} cy={13.4} r={7.1} stroke={color} strokeWidth={strokeWidth} />}
      {name === "bee" && <Ellipse cx={12.4} cy={14.1} rx={6.1} ry={4.4} stroke={color} strokeWidth={strokeWidth} />}
      {name === "bee" && <Circle cx={5.4} cy={14.4} r={1.6} stroke={color} strokeWidth={strokeWidth} />}
      {PATHS[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {name === "sliders" && <Circle cx={8.5} cy={7.2} r={1.9} fill={colors.paper} stroke={color} strokeWidth={strokeWidth} />}
      {name === "sliders" && <Circle cx={15.2} cy={12.4} r={1.9} fill={colors.paper} stroke={color} strokeWidth={strokeWidth} />}
      {name === "sliders" && <Circle cx={10.6} cy={17.6} r={1.9} fill={colors.paper} stroke={color} strokeWidth={strokeWidth} />}
    </Svg>
  );
}
