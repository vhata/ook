// Small line-art SVG of a book toppled face-down with pages fluttering.
// Used by both the root and per-book 404 pages. Stroke colour follows
// the parent's `currentColor` so it inherits theme + opacity classes.
export default function DroppedBook({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Inverted-V book silhouette: cover ridge along the top, pages
          spreading to either side. */}
      <path d="M 30 90 L 100 50 L 170 90" />
      {/* Slim cover flaps so it reads as a book, not a tent. */}
      <path d="M 30 90 L 30 96" />
      <path d="M 170 90 L 170 96" />
      {/* Page flutter strokes — softer weight, low opacity. */}
      <g strokeWidth={1} opacity={0.45}>
        <line x1="58" y1="80" x2="78" y2="68" />
        <line x1="68" y1="86" x2="84" y2="78" />
        <line x1="122" y1="68" x2="142" y2="80" />
        <line x1="116" y1="78" x2="132" y2="86" />
      </g>
      {/* Suggested floor — barely there. */}
      <line
        x1="20"
        y1="102"
        x2="180"
        y2="102"
        strokeWidth={1}
        strokeDasharray="2 5"
        opacity={0.3}
      />
    </svg>
  );
}
