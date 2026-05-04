// Fetch the actual TTF bytes for a Google Font weight/style at OG-image
// generation time. Satori (used by `next/og` `ImageResponse`) accepts raw
// font data via the `fonts` option; using the same family as the live site
// keeps share-card typography aligned with the rendered pages.
//
// Static OG routes are cached by Next, so the fetch happens once per build.

type Style = "normal" | "italic";

async function fontUrl(family: string, weight: number, style: Style): Promise<string> {
  const styleParam = style === "italic" ? "ital,wght@1," : "wght@";
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${styleParam}${weight}&display=swap`;
  const css = await fetch(url, {
    // Google Fonts serves different files per UA — `Mozilla/5.0` gets us TTF
    // (preferred for Satori) instead of WOFF2.
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());
  const m = /url\((https:\/\/[^)]+\.(?:ttf|otf))\)/i.exec(css);
  if (!m) throw new Error(`Could not parse Google Fonts CSS for ${family} ${weight}${style}`);
  return m[1];
}

export async function loadFont(
  family: string,
  weight: number,
  style: Style = "normal",
): Promise<ArrayBuffer> {
  const u = await fontUrl(family, weight, style);
  return fetch(u).then((r) => r.arrayBuffer());
}
