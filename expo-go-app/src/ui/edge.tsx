import { useState } from "react";
import { Platform, View, type ViewStyle } from "react-native";
import Svg, { Rect } from "react-native-svg";

/**
 * Dotted and dashed edges that look the same on iPhone and Android.
 *
 * iOS (and the web) draw `borderStyle: "dotted" | "dashed"` well, rounded corners included. Android draws them
 * unreliably on rounded views, so there the border stays (same size and layout) but turns transparent, and
 * <EdgeOverlay> draws the dots on top of it in SVG.
 */
const SVG_EDGES = Platform.OS === "android";

export type EdgeKind = "dotted" | "dashed";

/** Border props for a dotted or dashed edge. Spread into a style; pair with <EdgeOverlay> as the view's first child. */
export function edge(kind: EdgeKind, color: string, width: number): ViewStyle {
  return SVG_EDGES
    ? { borderWidth: width, borderColor: "transparent", borderStyle: "solid" }
    : { borderWidth: width, borderColor: color, borderStyle: kind };
}

/** Draws the edge in SVG on Android; renders nothing elsewhere. Put it first inside the view that uses edge(). */
export function EdgeOverlay({ kind, color, width, radius }: { kind: EdgeKind; color: string; width: number; radius: number }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  if (!SVG_EDGES) return null;
  const half = width / 2;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: -width, left: -width, right: -width, bottom: -width }}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (!box || Math.abs(box.w - w) > 0.5 || Math.abs(box.h - h) > 0.5) setBox({ w, h });
      }}
    >
      {box && box.w > width && box.h > width && (
        <Svg width={box.w} height={box.h}>
          <Rect
            x={half}
            y={half}
            width={box.w - width}
            height={box.h - width}
            rx={Math.max(0, Math.min(radius, box.w / 2, box.h / 2) - half)}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap={kind === "dotted" ? "round" : "butt"}
            strokeDasharray={kind === "dotted" ? `0.01 ${width * 2.4}` : `${width * 4} ${width * 3}`}
          />
        </Svg>
      )}
    </View>
  );
}
