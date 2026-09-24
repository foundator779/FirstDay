# Figma reference assets

Exact SVG exports from the user-supplied [medical app UI kit](https://www.figma.com/design/r77BdScud0c2zezb2VVvSQ?node-id=37-626).

- navigation.svg: 67:539 (Home navigation glyph group)
- search.svg: 67:499
- settings.svg: 67:535
- notification.svg: 67:527
- back.svg: 67:1464 (Message back arrow)

`src/figma-icons.ts` embeds these exact SVG exports for React Native SVG. The app
clips the exported navigation strip into the original four icons and recolors
their original fills. Regenerate the embedded strings if the source SVGs change.
Medical portraits and text are replaced by FirstDay's existing character art and
actual training content. League Spartan is bundled via the Google Fonts package,
which includes its font license. No expiring asset URL is required at runtime.
