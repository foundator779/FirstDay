import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors, useOnDark } from "./theme";

export type IconName =
  | "plus" | "back" | "close" | "speaker" | "check" | "bee" | "sliders" | "bulb" | "play" | "timer" | "pencil"
  | "trash" | "star" | "chevron" | "home" | "list" | "chat" | "cap" | "mic" | "moon" | "split" | "refresh" | "link" | "undo" | "brain"
  | "menu";

/** Clean line icons on a 24 grid: even strokes, round caps, no fill. */
const PATHS: Record<IconName, string[]> = {
  plus: ["M12 5v14", "M5 12h14"],
  back: ["M19 12H5.5", "M11 18l-6-6 6-6"],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  speaker: ["M11 5 6.5 9H3.5v6h3l4.5 4V5z", "M15.5 9a4.2 4.2 0 0 1 0 6", "M18.5 6a8.5 8.5 0 0 1 0 12"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  bee: ["M7.7 13.1h8.6", "M7.9 16.4h8.2", "M11 9.3C10 6.2 6.3 5 5.2 6.8c-1 1.7 1.8 3.4 5.2 3", "M13 9.3c1-3.1 4.7-4.3 5.8-2.5 1 1.7-1.8 3.4-5.2 3"],
  sliders: ["M4 7h16", "M4 12h16", "M4 17h16"],
  bulb: ["M9.5 18h5", "M10.5 21h3", "M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"],
  play: ["M8 5.5v13l10.5-6.5L8 5.5z"],
  timer: ["M12 13.5V10", "M10 2.5h4", "M18.3 6.7l1.4-1.4"],
  pencil: ["M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z", "M13.5 7l3.5 3.5"],
  trash: ["M4 7h16", "M9.5 7V4.5h5V7", "M6.5 7l1 13h9l1-13", "M10 11v5.5", "M14 11v5.5"],
  star: ["M12 3.5l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.8l-5.3 2.9 1.2-5.9-4.5-4.1 6-.7z"],
  chevron: ["M9 5.5l6.5 6.5L9 18.5"],
  home: ["M4 11 12 4l8 7", "M6 9.5V20h12V9.5", "M10 20v-5.5h4V20"],
  list: ["M9 7h11", "M9 12h11", "M9 17h11", "M4.5 7h.01", "M4.5 12h.01", "M4.5 17h.01"],
  chat: ["M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"],
  cap: ["M2.5 9.5 12 5l9.5 4.5L12 14z", "M6.5 11.5V16c3.3 2.5 7.7 2.5 11 0v-4.5", "M21.5 9.5v5"],
  mic: ["M12 3.5a2.75 2.75 0 0 0-2.75 2.75v5.5a2.75 2.75 0 0 0 5.5 0v-5.5A2.75 2.75 0 0 0 12 3.5z", "M6 11.5a6 6 0 0 0 12 0", "M12 17.5v3"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
  split: ["M5 6h6", "M5 12h10", "M5 18h14"],
  refresh: ["M19.6 9A8 8 0 1 0 20 14", "M20 4.5V9h-4.5"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"],
  undo: ["M9 5 4.5 9.5 9 14", "M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3.5"],
  brain: ["M12 5.5v13", "M12 5.5A3 3 0 0 0 6.5 7a3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5.5 1.5", "M12 5.5A3 3 0 0 1 17.5 7a3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5.5 1.5"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
};

export function Icon({ name, size = 26, color, strokeWidth = 1.9 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const dark = useOnDark();
  const c = color ?? (dark ? colors.onHighlight : colors.ink);
  const knob = dark ? colors.ink : colors.paper;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "timer" && <Circle cx={12} cy={13.5} r={7.5} stroke={c} strokeWidth={strokeWidth} />}
      {name === "bee" && <Ellipse cx={12} cy={14.5} rx={4.5} ry={5.5} stroke={c} strokeWidth={strokeWidth} />}
      {PATHS[name].map((d, i) => (
        <Path key={i} d={d} stroke={c} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {name === "sliders" && <Circle cx={9} cy={7} r={2.1} fill={knob} stroke={c} strokeWidth={strokeWidth} />}
      {name === "sliders" && <Circle cx={15.5} cy={12} r={2.1} fill={knob} stroke={c} strokeWidth={strokeWidth} />}
      {name === "sliders" && <Circle cx={8} cy={17} r={2.1} fill={knob} stroke={c} strokeWidth={strokeWidth} />}
    </Svg>
  );
}
