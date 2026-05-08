import DroppedBook from "@/components/DroppedBook";
import { HomeMark } from "@/components/HomeMark";

export default function NotFound() {
  return (
    <main className="mx-auto box-border w-full max-w-[640px] px-6 py-20 text-center sm:py-28">
      <DroppedBook className="text-ink-soft mx-auto mb-10 w-44 sm:w-56" />
      <p className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">404</p>
      <h1 className="font-serif text-ink m-0 text-[44px] leading-tight font-medium tracking-[-0.025em] sm:text-[56px]">
        Not on this shelf.
      </h1>
      <p className="font-serif text-ink-soft mt-4 text-[16px] italic">
        Nothing here. Probably a typo, or it hasn&rsquo;t been added to the vault yet.
      </p>
      <div className="mt-9">
        <HomeMark />
      </div>
    </main>
  );
}
