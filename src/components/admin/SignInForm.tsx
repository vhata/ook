"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";

export default function SignInForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/login/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!optsRes.ok) {
        const data = await optsRes.json();
        throw new Error(`options: ${data.error ?? optsRes.status}`);
      }
      const { challengeId, options } = await optsRes.json();

      const auth = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, response: auth }),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(`verify: ${data.error ?? verifyRes.status} ${data.detail ?? ""}`);
      }
      location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-60"
      >
        {busy ? "..." : "Sign in with passkey"}
      </button>

      {error && (
        <div className="border-accent bg-accent-soft text-ink rounded border-l-2 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}
    </section>
  );
}
