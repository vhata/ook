// Subtle paper-aging filter for finished-book covers. Bounded so even
// ancient books stay legible. Computed by the parent server component
// (which has access to "now"); passed down as a CSS filter string.
//
// Returns null when no filter should apply: missing finish date,
// unparseable date, or freshly-finished (under six months — let the
// covers look new for a beat). The CSS layer treats null as omitted.

export function foxingFor(finished: string | null, todayMs: number): string | null {
  if (!finished) return null;
  const finishedMs = Date.parse(`${finished}T12:00:00Z`);
  if (!Number.isFinite(finishedMs)) return null;
  const yearsAgo = (todayMs - finishedMs) / (365.25 * 86400000);
  if (yearsAgo < 0.5) return null;
  // Tuned by eye against the rust accent. Cap at sepia(0.32) — past
  // ten years anything more starts looking like a filter rather than
  // weathering.
  const sepia = Math.min(0.32, (yearsAgo - 0.5) * 0.04);
  const contrast = Math.max(0.92, 1 - yearsAgo * 0.008);
  return `sepia(${sepia.toFixed(3)}) contrast(${contrast.toFixed(3)})`;
}
