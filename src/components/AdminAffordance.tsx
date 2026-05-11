import Link from "next/link";

// One-line inline admin affordance — a "remove tag" or "edit →" link
// surfaced on public pages only when the viewer holds a valid owner
// session. Pure presentational; the caller does the auth check (via
// `getOwnerSession()`) once per page and passes `show={!!session}`
// down. Anonymous viewers receive nothing.
//
// Why caller-side auth rather than self-check: components rendered
// inside list maps stay synchronous, which keeps the existing render-
// based component tests (happy-dom, react-testing-library) able to
// walk the tree without an async-resolution runtime. The owner-only
// auth read still happens exactly once per request — at the page top.
//
// Visual register: a quiet, low-contrast pill that sits next to a row
// of content rather than competing with it. The intent is that the
// operator sees the affordance the moment they spot a mistake; an
// anonymous visitor never sees the chrome at all.
//
// Affordances are *links*, not write endpoints — every mutation still
// flows through /api/admin/agent and the diff-preview gate. The href
// shape that drives the agent seed is documented at the call site.

export default function AdminAffordance({
  show,
  href,
  label,
  title,
  className,
}: {
  show: boolean;
  href: string;
  label: string;
  title?: string;
  className?: string;
}) {
  if (!show) return null;

  const cls =
    className ??
    "border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase whitespace-nowrap";

  return (
    <Link href={href} title={title} className={cls} data-admin-affordance="true">
      {label}
    </Link>
  );
}
