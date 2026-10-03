/** Colourless, hand-drawn palette: paper, pencil and one highlighter. */
export const colors = {
  paper: "#FBFAF6",
  card: "#FFFFFF",
  ink: "#1E1E1E",
  pencil: "#6B6B6B",
  faint: "#D8D5CC",
  wash: "#F2F0EA",
  highlight: "#FFE45C",
  highlightSoft: "#FFF3B0",
};

export const fonts = {
  hand: "PatrickHand_400Regular",
  body: "AtkinsonHyperlegible_400Regular",
  bodyBold: "AtkinsonHyperlegible_700Bold",
};

export function sizes(big: boolean) {
  const k = big ? 1.18 : 1;
  return {
    hero: Math.round(36 * k),
    title: Math.round(30 * k),
    h2: Math.round(24 * k),
    body: Math.round(18 * k),
    small: Math.round(15 * k),
    tiny: Math.round(13 * k),
  };
}

export const space = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };
