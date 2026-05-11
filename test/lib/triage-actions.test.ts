import { describe, expect, it } from "vitest";
import {
  buildEntryPatches,
  buildTriageBatch,
  renderBullet,
  sanitiseSlug,
} from "../../src/lib/triage/actions";

const entry = {
  title: "The Anomaly",
  author: "Hervé Le Tellier",
  why: "Plane lands twice (via friend recommendation)",
  added: null,
};

describe("renderBullet", () => {
  it("emits **Title** — Author. _why_ when all three fields are set", () => {
    expect(renderBullet(entry)).toBe(
      "**The Anomaly** — Hervé Le Tellier. _Plane lands twice (via friend recommendation)_",
    );
  });

  it("drops author and why when absent", () => {
    expect(renderBullet({ title: "Foo", author: null, why: null, added: null })).toBe("**Foo**");
  });

  it("includes author but skips why when only why is absent", () => {
    expect(renderBullet({ title: "Foo", author: "Author", why: null, added: null })).toBe(
      "**Foo** — Author.",
    );
  });
});

describe("sanitiseSlug", () => {
  it("preserves the title verbatim when no FS-hostile chars are present", () => {
    expect(sanitiseSlug("The Anomaly")).toBe("The Anomaly");
  });

  it("strips slashes, colons, quotes, and pipes", () => {
    expect(sanitiseSlug('Title: with "punc" / and \\ stuff')).toBe(
      "Title with punc  and  stuff".replace(/\s+/g, " "),
    );
  });
});

describe("buildEntryPatches — promote-tbr", () => {
  it("removes from triage.md and appends to a dated From Triage pile in tbr.md", () => {
    const patches = buildEntryPatches("Maybe", entry, "promote-tbr", "2026-05-10");
    expect(patches).toHaveLength(2);
    expect(patches[0]).toEqual({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Maybe",
      bullet: "**The Anomaly** — Hervé Le Tellier. _Plane lands twice (via friend recommendation)_",
    });
    expect(patches[1]).toEqual({
      kind: "append-bullet",
      path: "_meta/tbr.md",
      section: "From Triage (2026-05-10)",
      bullet: "**The Anomaly** — Hervé Le Tellier. _Plane lands twice (via friend recommendation)_",
    });
  });
});

describe("buildEntryPatches — start-reading", () => {
  it("removes from triage.md and mints a vault directory with status=reading and today's started", () => {
    const patches = buildEntryPatches("Maybe", entry, "start-reading", "2026-05-10");
    expect(patches).toHaveLength(2);
    expect(patches[0].kind).toBe("remove-bullet");
    expect(patches[1].kind).toBe("create-file");
    if (patches[1].kind !== "create-file") throw new Error("type narrowing");
    expect(patches[1].path).toBe("The Anomaly/The Anomaly.md");
    expect(patches[1].content).toContain("title: The Anomaly");
    expect(patches[1].content).toContain("authors: [Hervé Le Tellier]");
    expect(patches[1].content).toContain("status: reading");
    expect(patches[1].content).toContain('started: "2026-05-10"');
    expect(patches[1].content).toContain("finished: null");
    expect(patches[1].content).toContain("source: triage");
  });
});

describe("buildEntryPatches — mark-finished", () => {
  it("removes from triage.md and mints a vault directory with status=finished and today's finished", () => {
    const patches = buildEntryPatches("Maybe", entry, "mark-finished", "2026-05-10");
    expect(patches[1].kind).toBe("create-file");
    if (patches[1].kind !== "create-file") throw new Error("type narrowing");
    expect(patches[1].content).toContain("status: finished");
    expect(patches[1].content).toContain("started: null");
    expect(patches[1].content).toContain('finished: "2026-05-10"');
  });
});

describe("buildTriageBatch", () => {
  it("composes multiple entries into one flat meta_patches list", () => {
    const body = buildTriageBatch(
      [
        { pile: "Maybe", entry },
        {
          pile: "Lightbringer",
          entry: { title: "Black Prism", author: "Brent Weeks", why: null, added: null },
        },
      ],
      "promote-tbr",
      "2026-05-10",
    );
    expect(body.patches).toEqual([]);
    // Two entries × 2 patches each = 4.
    expect(body.meta_patches).toHaveLength(4);
    expect(body.message).toBe("Triage: 2 promoted to TBR");
  });

  it("throws when given an empty selection", () => {
    expect(() => buildTriageBatch([], "promote-tbr", "2026-05-10")).toThrow(/at least one/);
  });
});
