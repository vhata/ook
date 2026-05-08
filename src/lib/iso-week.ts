// Returns the Monday-anchored week range containing the given ISO date.
// Sunday-anchoring is the locale-default in some countries but the
// reading log convention here uses Monday as the start (matches the
// existing heatmap on /stats/[year]). Pure function; useful in tests.

export function isoWeekRange(iso: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}
