import Link from "next/link";
import { getOwnerSession } from "@/lib/auth/session";

// Owner-only chrome rendered into the global Controls bar. Server
// component — reads the session cookie on the request and renders
// nothing for anonymous viewers. The public site is unchanged for
// everyone except the operator.
//
// Visual register: a small "admin" pill (paper-and-ink palette, same
// rounded-full + border-rule shape as the rest of the Controls bar),
// a quiet "/admin" link back to the console, and a sign-out form.
// Sign-out is a plain HTML form posting to /api/auth/logout so it
// works without any client JS — the bar itself is a client component
// but the operator's escape hatch shouldn't depend on hydration. The
// route clears the session cookie and returns 200 JSON; the browser
// navigates back to the current page on form submit and the absent
// cookie hides this whole component on the next render.

export default async function AdminControls() {
  const session = await getOwnerSession();
  if (!session) return null;

  return (
    <span className="border-rule text-ink-soft flex items-center gap-1.5 rounded-full border bg-bg pl-2.5 sm:gap-2 sm:pl-3">
      <span
        className="text-ink-soft tracking-[0.14em] uppercase text-[10px]"
        title="Signed in as the owner — inline admin affordances are visible across the site."
      >
        admin
      </span>
      <Link
        href="/admin"
        className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
      >
        /admin
      </Link>
      <form action="/api/auth/logout" method="post" className="m-0 inline-flex">
        <button
          type="submit"
          className="border-rule text-ink-soft hover:border-accent hover:text-accent rounded-full border px-2.5 py-1 whitespace-nowrap sm:px-3"
          title="Sign out and return to the anonymous public view"
        >
          sign out
        </button>
      </form>
    </span>
  );
}
