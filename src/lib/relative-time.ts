// Single-precision relative-time formatter. Returns one of:
//
//   "just now"     — under 60 seconds
//   "5 min ago"    — under an hour
//   "2 hr ago"     — under a day
//   "yesterday"    — exactly one day
//   "3 days ago"   — under 30 days
//   "2026-04-12"   — older; absolute date is more useful at this range
//
// Forward-in-time inputs (an `iso` later than `now`) round to "just now".
// `now` is injectable so tests don't depend on wall-clock timing.

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toISOString().slice(0, 10);
}
