import Link from "next/link";
import { authConfig } from "@/lib/auth/config";
import { loadCredentials } from "@/lib/auth/credentials";
import { getOwnerSession } from "@/lib/auth/session";
import { buildSeedPrompt } from "@/lib/admin/seed-prompt";
import RegisterForm from "@/components/admin/RegisterForm";
import SignInForm from "@/components/admin/SignInForm";
import AdminConsole from "@/components/admin/AdminConsole";

// /admin — the write surface. Three states:
//   1. No credentials registered → first-time-claim flow (RegisterForm).
//   2. Credentials registered, no valid session → sign-in (SignInForm).
//   3. Valid session → admin console.

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin", robots: "noindex,nofollow" };

type SearchParams = Promise<{ focus?: string; intent?: string }>;

export default async function AdminPage({ searchParams }: { searchParams?: SearchParams }) {
  const cfg = authConfig();
  const credentials = await loadCredentials();
  const session = await getOwnerSession();
  const sp = searchParams ? await searchParams : {};
  const seedPrompt = session ? buildSeedPrompt(sp.focus, sp.intent) : "";

  const isFirstTime = credentials.length === 0;
  const showAuthMisconfig = !cfg.sessionSecret;

  return (
    <main className="mx-auto box-border w-full max-w-[700px] px-6 py-12 sm:px-10 sm:pt-10 sm:pb-20">
      <Link
        href="/"
        className="border-rule text-ink-soft hover:text-ink mb-9 inline-block rounded-full border px-3 py-1.5 text-xs whitespace-nowrap"
      >
        ← back
      </Link>

      <header className="border-rule mb-11 border-b pb-6">
        <div className="text-ink-soft mb-3 text-[11px] tracking-[0.18em] uppercase">Admin</div>
        <h1 className="font-serif m-0 text-[44px] leading-none font-medium tracking-[-0.025em] sm:text-[56px]">
          {session ? "Edit the vault." : isFirstTime ? "Claim this site." : "Sign in."}
        </h1>
        <p className="font-serif text-ink-soft mt-3 max-w-[560px] text-[17px] italic">
          {session
            ? "Type a free-text update; the agent stages a patch; you confirm before commit."
            : isFirstTime
              ? "Register a passkey to claim ownership. Once registered, only this passkey (or its pair) can sign in."
              : "Authenticate with the registered passkey."}
        </p>
      </header>

      {showAuthMisconfig && (
        <div className="border-accent bg-accent-soft mb-8 rounded border-l-2 px-5 py-4 text-[14px] leading-[1.5]">
          <strong>Auth not configured.</strong> Set{" "}
          <code className="font-mono text-[13px]">OOK_AUTH_SESSION_SECRET</code> on the server (32+
          random bytes — generate with{" "}
          <code className="font-mono text-[13px]">openssl rand -hex 32</code>) before claiming.
        </div>
      )}

      {!showAuthMisconfig && !session && isFirstTime && <RegisterForm isFirstTime={true} />}
      {!showAuthMisconfig && !session && !isFirstTime && <SignInForm />}
      {session && <AdminConsole initialText={seedPrompt} />}
    </main>
  );
}
