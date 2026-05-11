import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SESSION_TS = resolve(here, "../../src/lib/auth/session.ts");

// The proxy at src/proxy.ts (Next 16's renamed middleware) imports
// `verifySession` and `SESSION_COOKIE_NAME` from this module. The
// middleware/proxy runtime cannot load `next/headers` at module-load
// time — a top-level `import { cookies } from "next/headers"` here
// crashes the proxy on cold start and turns every matched route into
// a 500 with empty function logs. `getOwnerSession()` must use a
// dynamic `await import("next/headers")` inside the function body so
// resolution is deferred to call time (server-component / route-handler
// scope, where `next/headers` works).
//
// This test guards against re-introducing the top-level import.

describe("src/lib/auth/session.ts middleware safety", () => {
  it("does not import next/headers at the top level", () => {
    const source = readFileSync(SESSION_TS, "utf8");
    const offenders: string[] = [];
    for (const [i, line] of source.split("\n").entries()) {
      // Match static `import ... from "next/headers"`. Dynamic
      // `await import("next/headers")` is allowed because it sits
      // inside a function body and resolves lazily.
      if (/^\s*import\b.*\bfrom\s+["']next\/headers["']/.test(line)) {
        offenders.push(`line ${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
