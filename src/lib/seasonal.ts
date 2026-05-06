// Seasonal accent palette drift. The accent colour shifts gently
// across the year — rust in winter, ochre in spring, slate in summer,
// forest in autumn. Paper-and-ink stays constant; only `--accent` and
// `--accent-soft` move.
//
// Northern-hemisphere seasons used since the user is South Africa-born
// living in the U.S.-ish — switch to southern by inverting the month
// → season map if the palette ever feels off-rhythm. Keeping it simple
// for v1; revisit if the user prefers their actual hemisphere.

export type SeasonPalette = {
  name: "winter" | "spring" | "summer" | "autumn";
  light: { accent: string; accentSoft: string };
  dark: { accent: string; accentSoft: string };
};

// Tuned by eye against the existing #a3402a rust. Each season keeps
// the same rough saturation/brightness so the visual register stays
// stable; only the hue migrates.
const PALETTES: Record<SeasonPalette["name"], SeasonPalette> = {
  winter: {
    name: "winter",
    light: { accent: "#a3402a", accentSoft: "#a3402a1a" }, // rust (default)
    dark: { accent: "#d97757", accentSoft: "#d9775733" },
  },
  spring: {
    name: "spring",
    light: { accent: "#a37b2a", accentSoft: "#a37b2a1a" }, // ochre
    dark: { accent: "#d9b057", accentSoft: "#d9b05733" },
  },
  summer: {
    name: "summer",
    light: { accent: "#3a6a7e", accentSoft: "#3a6a7e1a" }, // slate-blue
    dark: { accent: "#7da6b8", accentSoft: "#7da6b833" },
  },
  autumn: {
    name: "autumn",
    light: { accent: "#3f6b3a", accentSoft: "#3f6b3a1a" }, // forest
    dark: { accent: "#7faa75", accentSoft: "#7faa7533" },
  },
};

export function seasonForMonth(monthZeroIndexed: number): SeasonPalette["name"] {
  // Northern-hemisphere meteorological seasons.
  // Dec/Jan/Feb = winter, Mar/Apr/May = spring, Jun/Jul/Aug = summer,
  // Sep/Oct/Nov = autumn.
  if (monthZeroIndexed === 11 || monthZeroIndexed <= 1) return "winter";
  if (monthZeroIndexed <= 4) return "spring";
  if (monthZeroIndexed <= 7) return "summer";
  return "autumn";
}

export function seasonalPalette(today: Date = new Date()): SeasonPalette {
  return PALETTES[seasonForMonth(today.getUTCMonth())];
}

// Inline-style block for the document head: overrides --accent +
// --accent-soft for both light and dark schemes via CSS custom-prop
// cascade. Returned as a CSS string (no `<style>` tags) so the caller
// can wrap it however the framework expects (Next 16's <style> in JSX
// is fine).
export function seasonalCss(palette: SeasonPalette): string {
  return `
:root {
  --accent: ${palette.light.accent};
  --accent-soft: ${palette.light.accentSoft};
}
.dark {
  --accent: ${palette.dark.accent};
  --accent-soft: ${palette.dark.accentSoft};
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent: ${palette.dark.accent};
    --accent-soft: ${palette.dark.accentSoft};
  }
}
`.trim();
}
