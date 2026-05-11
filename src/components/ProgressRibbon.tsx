// Bookmark-ribbon indicator for currently-reading cards. Renders a
// thin accent-coloured silk-ribbon hanging from the top edge of the
// card; the ribbon's length is `percent%` of the card's height, with
// a small V-notch at the tip. Hidden entirely when `percent` is null —
// most books won't have a parseable progress string and the ribbon
// only fires when `parseProgress` succeeds.
//
// Server component; no interactivity. The parent must be
// `position: relative` for the absolute positioning to anchor to it.
// All Currently-Reading card variants on the home page set that
// already.

export function ProgressRibbon({ percent }: { percent: number | null }) {
  if (percent === null || percent <= 0) return null;
  // Clamp at a sensible upper bound so a "100% through" book still
  // shows a recognisably ribbon-shaped element rather than running
  // off the bottom edge.
  const clipped = Math.min(percent, 100);
  return (
    <svg
      aria-hidden="true"
      className="text-accent absolute top-0 right-6 pointer-events-none"
      style={{ height: `${clipped}%`, width: 8 }}
      preserveAspectRatio="none"
      viewBox="0 0 8 100"
    >
      <polygon points="0,0 8,0 8,92 4,100 0,92" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
