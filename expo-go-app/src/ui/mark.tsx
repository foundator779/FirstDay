import Svg, { Circle, Rect } from "react-native-svg";

/**
 * The FirstDay Go mark, same as the app icon: a field of dotted circles (everything on your plate)
 * with one solid dot in the middle (the one thing to do now).
 */
export function AppMark({ size = 96 }: { size?: number }) {
  const cells = [300, 512, 724];
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="FirstDay Go">
      <Rect width={1024} height={1024} rx={229} fill="#161616" />
      {cells.flatMap((x) =>
        cells.map((y) =>
          x === 512 && y === 512 ? (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={92} fill="#FFFFFF" />
          ) : (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={68} fill="none" stroke="#6E6E6E" strokeWidth={19} strokeLinecap="round" strokeDasharray="0.1 30.5" />
          ),
        ),
      )}
    </Svg>
  );
}
