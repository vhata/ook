// Public-facing canonical URL. Used to build absolute links in feeds and
// metadata where a relative URL won't do (RSS readers, Open Graph, etc.).
// Configurable via OOK_SITE_URL for local previews / staging; falls back to
// the production URL.
export const SITE_URL = (process.env.OOK_SITE_URL ?? "https://b-ook.vercel.app").replace(/\/$/, "");

export const SITE_AUTHOR = "Jonathan Hitchcock";
