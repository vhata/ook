import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getTriage } from "../../src/lib/books";

const FIXTURE_VAULT = path.resolve(__dirname, "..", "fixtures", "vault");

beforeEach(() => {
  vi.stubEnv("BOOKS_DIR", FIXTURE_VAULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTriage", () => {
  it("parses _meta/triage.md into the same shape as TBR", async () => {
    const triage = await getTriage();
    expect(triage).not.toBeNull();
    expect(triage?.title).toBe("Triage");
    expect(triage?.piles.map((p) => p.name)).toEqual(["Fiction", "Non-fiction", "Imperial Radch"]);
    const fiction = triage?.piles.find((p) => p.name === "Fiction");
    expect(fiction?.entries).toHaveLength(1);
    expect(fiction?.entries[0]).toMatchObject({
      title: "The Anomaly",
      author: "Hervé Le Tellier",
    });
    expect(fiction?.entries[0].why).toContain("Plane lands twice");
  });

  it("preserves the raw bullet text for round-trip writes", async () => {
    // The remove-bullet patch matches verbatim against the source
    // markdown, so the parser must carry the original bullet shape
    // through to the entry. This is the regression guard for the
    // `**Title** #N — Author.` shape that the field-reconstruction
    // path can't rebuild correctly.
    const triage = await getTriage();
    const radch = triage?.piles.find((p) => p.name === "Imperial Radch");
    expect(radch?.entries[0].raw).toBe("**Ancillary Justice** #1 — Ann Leckie.");
    expect(radch?.entries[1].raw).toBe("**Ancillary Sword** #2 — Ann Leckie.");
  });
});
