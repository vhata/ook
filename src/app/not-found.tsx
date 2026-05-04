import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto max-w-2xl px-6 py-24 sm:py-32">
        <div className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            404
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Not on this shelf.</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Nothing here. Probably a typo, or the book hasn&rsquo;t been added to the vault yet.
          </p>
          <Link
            href="/"
            className="inline-block text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← back home
          </Link>
        </div>
      </main>
    </div>
  );
}
