import { createContext, useContext } from "react";

/** Colourless palette: white paper, black ink, a few greys. Black marks what's selected or next. */
export const colors = {
  paper: "#FFFFFF",
  card: "#FFFFFF",
  ink: "#161616",
  pencil: "#6B6B6B",
  faint: "#C4C4C4",
  line: "#E6E6E6",
  wash: "#F3F3F3",
  bar: "#F1F1F1",
  /** Selected or primary surfaces. */
  highlight: "#161616",
  onHighlight: "#FFFFFF",
  onHighlightDim: "#B9B9B9",
  /** Soft emphasis: a quiet grey panel. */
  highlightSoft: "#EDEDED",
};

export const fonts = {
  body: "AtkinsonHyperlegible_400Regular",
  bodyBold: "AtkinsonHyperlegible_700Bold",
};

export function sizes(big: boolean) {
  const k = big ? 1.18 : 1;
  return {
    hero: Math.round(30 * k),
    title: Math.round(26 * k),
    h2: Math.round(20 * k),
    body: Math.round(17 * k),
    small: Math.round(15 * k),
    tiny: Math.round(13 * k),
  };
}

export const space = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };

/** True inside a black surface, so text and icons flip to white. */
export const OnDark = createContext(false);
export const useOnDark = () => useContext(OnDark);
