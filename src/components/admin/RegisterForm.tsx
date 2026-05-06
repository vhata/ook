"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

type Props = {
  isFirstTime: boolean;
};

// First-time claim or "add another authenticator" flow. The flow:
//   1. POST /api/auth/register/options → server returns
//      {challengeId, options, isFirstTime, needsBackupCodeOnVerify}.
//   2. browser-side: startRegistration(options) → user OS prompt →
//      registration response.
//   3. POST /api/auth/register/verify with {challengeId, response, label}.
//   4. On success: server set the session cookie. Reload to advance the
//      page state. If the response includes a backupCode, surface it
//      ONCE for the user to copy.

export default function RegisterForm({ isFirstTime }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCode, setBackupCode] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const optsRes = await fetch("/api/auth/register/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!optsRes.ok) {
        throw new Error(`options: ${optsRes.status} ${(await optsRes.json()).error}`);
      }
      const { challengeId, options } = await optsRes.json();

      const reg = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId,
          response: reg,
          label: label.trim() || undefined,
        }),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(`verify: ${data.error ?? verifyRes.status} ${data.detail ?? ""}`);
      }
      const data = await verifyRes.json();
      if (data.backupCode) {
        setBackupCode(data.backupCode);
        // Don't reload until the user copies the code.
      } else {
        location.reload();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (backupCode) {
    return (
      <section className="border-accent bg-accent-soft space-y-4 rounded border-l-2 p-6">
        <h2 className="font-serif text-ink m-0 text-[22px] font-medium tracking-[-0.012em]">
          Save your backup code.
        </h2>
        <p className="text-[14px] leading-[1.5]">
          This is the only way to recover access if you lose every registered device. Copy it into
          1Password, write it on paper, do whatever feels safe — but capture it now. We will not
          show it again.
        </p>
        <pre className="border-rule bg-bg overflow-x-auto rounded border p-4 font-mono text-[14px] tracking-[0.04em]">
          {backupCode}
        </pre>
        <button
          type="button"
          onClick={() => location.reload()}
          className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em]"
        >
          I saved it — continue
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <label className="text-ink-soft block text-[11px] tracking-[0.14em] uppercase">
        Label (optional)
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="MacBook Touch ID"
          className="border-rule bg-surface mt-2 block w-full rounded border px-3 py-2 text-[15px] normal-case tracking-normal text-(--ink)"
          disabled={busy}
        />
      </label>

      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="border-accent text-accent hover:bg-accent-soft inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm tracking-[0.06em] disabled:opacity-60"
      >
        {busy ? "..." : isFirstTime ? "Register first passkey" : "Add another passkey"}
      </button>

      {error && (
        <div className="border-accent bg-accent-soft text-ink rounded border-l-2 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}
    </section>
  );
}
