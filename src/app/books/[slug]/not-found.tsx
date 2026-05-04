import Link from "next/link";
import DroppedBook from "@/components/DroppedBook";

export default function BookNotFound() {
  return (
    <main className="mx-auto box-border w-full max-w-[640px] px-6 py-20 text-center sm:py-28">
      <DroppedBook className="text-ink-soft mx-auto mb-10 w-44 sm:w-56" />
      <p className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">404</p>
      <h1 className="font-serif text-ink m-0 text-[44px] leading-tight font-medium tracking-[-0.025em] sm:text-[56px]">
        Not on this shelf.
      </h1>
      <p className="font-serif text-ink-soft mt-4 text-[16px] italic">
        No book by that slug. Probably a typo, or it isn&rsquo;t in the vault yet.
      </p>
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mt-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back home
      </Link>
    </main>
  );
}
