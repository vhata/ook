/** Today's date as YYYY-MM-DD in the runtime's local time zone (not UTC). */
export function todayLocal(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert any ISO-8601 timestamp (with or without `Z` / offset) to a
 * YYYY-MM-DD date string in the runtime's local time zone. A session
 * that starts at 23:30 UTC attributes to the operator's local calendar
 * day rather than splitting across the UTC boundary — same shape as
 * `todayLocal` and consistent with the rest of the date handling in the
 * project. Returns `null` when the input is not a parseable timestamp.
 */
export function isoToLocalDate(iso) {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return todayLocal(new Date(t));
}
