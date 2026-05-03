import type { Book } from "@/lib/types";

type Props = {
  src: string | null;
  title: string;
  width: number | string;
  height: number | string;
  hatched?: boolean;
  rounded?: number;
};

export function Cover({ src, title, width, height, hatched, rounded = 2 }: Props) {
  return (
    <div
      className="bg-surface-mute relative shrink-0 overflow-hidden shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
      style={{ width, height, borderRadius: rounded }}
    >
      {src ? (
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${src})` }}
        />
      ) : (
        <div
          className="bg-surface-mute text-ink-soft flex h-full w-full items-end p-2 font-mono text-[9px] leading-tight"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 6px, var(--rule) 6px 7px)",
          }}
        >
          {title}
        </div>
      )}
      {hatched && (
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 4px, rgba(255,255,255,0.08) 4px 5px)",
          }}
        />
      )}
    </div>
  );
}

export function bookCover(book: Pick<Book, "cover">): string | null {
  return book.cover ?? null;
}
