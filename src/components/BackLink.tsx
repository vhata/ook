import Link from "next/link";

// Top-of-page back-arrow to a parent index page. Sits next to
// `HomeMark` on inner routes like /tags/[tag] and /stats/[year] so a
// reader who landed on the page directly (e.g. shared link) has an
// obvious "up one level" affordance — not just "go home".
//
// Visual register: same pill-shaped chrome as `HomeMark`, slightly
// quieter (no accent dot, no serif wordmark) so the wordmark stays the
// primary corner affordance. Both belong to the "primary navigation"
// class the design notes call decorative; inline-prose links are
// styled subtler still.
//
// Margin matches `HomeMark`'s `mb-9` so the two pills collapse onto
// the same baseline when used together — both `inline-flex` items
// flow inline on wide screens and wrap on narrow.

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="border-rule text-ink-soft hover:text-ink hover:border-ink mb-9 ml-2 inline-flex items-baseline rounded-full border px-3 py-1.5 text-[13px] leading-none tracking-[-0.005em] whitespace-nowrap"
    >
      <span aria-hidden="true">←&nbsp;</span>
      {label}
    </Link>
  );
}
