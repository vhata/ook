import Link from "next/link";

// Small "ook." wordmark linked to the home page. Replaces the
// "← back" link that used to sit in the top-left of every secondary
// page — that lied a bit, since browser back already handles "where I
// came from" and the link in the corner was always hardcoded to "/".
//
// Now the corner is the home affordance plain and explicit. The big
// wordmark on the home page itself stays untouched.

export function HomeMark() {
  return (
    <Link
      href="/"
      className="border-rule text-ink-soft hover:text-ink hover:border-ink mb-9 inline-flex items-baseline rounded-full border px-3 py-1.5 font-serif text-[15px] leading-none font-medium tracking-[-0.018em] whitespace-nowrap"
      aria-label="Home"
    >
      ook<span className="text-accent">.</span>
    </Link>
  );
}
