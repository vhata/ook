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

  it("replays the raw bullet text verbatim when present", () => {
    // The real parser sets `raw` from the source markdown. Replaying
    // it verbatim is what makes the remove-bullet round-trip work for
    // shapes the reconstruction can't reproduce (e.g. the `#N` series-
    // index prefix the parser folds into the author field).
    const rawShape = "**Ancillary Justice** #1 — Ann Leckie.";
    expect(
      renderBullet({
        title: "Ancillary Justice",
        author: "#1 — Ann Leckie",
        why: null,
        added: null,
        raw: rawShape,
      }),
    ).toBe(rawShape);
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
    const result = buildEntryPatches("Maybe", entry, "promote-tbr", "2026-05-10", false);
    expect(result.patches).toEqual([]);
    expect(result.metaPatches).toHaveLength(2);
    expect(result.metaPatches[0]).toEqual({
      kind: "remove-bullet",
      path: "_meta/triage.md",
      section: "Maybe",
      bullet: "**The Anomaly** — Hervé Le Tellier. _Plane lands twice (via friend recommendation)_",
    });
    expect(result.metaPatches[1]).toEqual({
      kind: "append-bullet",
      path: "_meta/tbr.md",
      section: "From Triage (2026-05-10)",
      bullet: "**The Anomaly** — Hervé Le Tellier. _Plane lands twice (via friend recommendation)_",
    });
  });

  it("ignores existsInVault — promote-tbr always just appends to the TBR pile", () => {
    const result = buildEntryPatches("Maybe", entry, "promote-tbr", "2026-05-10", true);
    expect(result.patches).toEqual([]);
    expect(result.metaPatches).toHaveLength(2);
  });
});

describe("buildEntryPatches — start-reading", () => {
  it("removes from triage.md and mints a vault directory when the slug is new", () => {
    const result = buildEntryPatches("Maybe", entry, "start-reading", "2026-05-10", false);
    expect(result.patches).toEqual([]);
    expect(result.metaPatches).toHaveLength(2);
    expect(result.metaPatches[0].kind).toBe("remove-bullet");
    const file = result.metaPatches[1];
    expect(file.kind).toBe("create-file");
    if (file.kind !== "create-file") throw new Error("type narrowing");
    expect(file.path).toBe("The Anomaly/The Anomaly.md");
    expect(file.content).toContain("title: The Anomaly");
    expect(file.content).toContain("authors: [Hervé Le Tellier]");
    expect(file.content).toContain("status: reading");
    expect(file.content).toContain('started: "2026-05-10"');
    expect(file.content).toContain("finished: null");
    expect(file.content).toContain("source: triage");
  });

  it("upserts an existing book's frontmatter when the slug already lives in the vault", () => {
    const result = buildEntryPatches("Maybe", entry, "start-reading", "2026-05-10", true);
    expect(result.metaPatches).toHaveLength(1);
    expect(result.metaPatches[0].kind).toBe("remove-bullet");
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toEqual({
      slug: "The Anomaly",
      frontmatter_changes: { status: "reading", started: "2026-05-10" },
      commit_message: "The Anomaly: started reading via triage",
    });
  });
});

describe("buildEntryPatches — mark-finished", () => {
  it("removes from triage.md and mints a vault directory when the slug is new", () => {
    const result = buildEntryPatches("Maybe", entry, "mark-finished", "2026-05-10", false);
    const file = result.metaPatches[1];
    expect(file.kind).toBe("create-file");
    if (file.kind !== "create-file") throw new Error("type narrowing");
    expect(file.content).toContain("status: finished");
    expect(file.content).toContain("started: null");
    expect(file.content).toContain('finished: "2026-05-10"');
  });

  it("upserts an existing book's frontmatter when the slug already lives in the vault", () => {
    const result = buildEntryPatches("Maybe", entry, "mark-finished", "2026-05-10", true);
    expect(result.metaPatches).toHaveLength(1);
    expect(result.metaPatches[0].kind).toBe("remove-bullet");
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toEqual({
      slug: "The Anomaly",
      frontmatter_changes: { status: "finished", finished: "2026-05-10" },
      commit_message: "The Anomaly: marked finished via triage",
    });
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

  it("routes mark-finished through book-patch when the slug exists in the vault", () => {
    const body = buildTriageBatch(
      [
        {
          pile: "Imperial Radch",
          entry: { title: "Ancillary Justice", author: "Ann Leckie", why: null, added: null },
        },
      ],
      "mark-finished",
      "2026-05-10",
      new Set(["Ancillary Justice"]),
    );
    expect(body.patches).toHaveLength(1);
    expect(body.patches[0].slug).toBe("Ancillary Justice");
    expect(body.patches[0].frontmatter_changes).toEqual({
      status: "finished",
      finished: "2026-05-10",
    });
    // Only the remove-bullet meta patch survives.
    expect(body.meta_patches).toHaveLength(1);
    expect(body.meta_patches[0].kind).toBe("remove-bullet");
  });

  it("throws when given an empty selection", () => {
    expect(() => buildTriageBatch([], "promote-tbr", "2026-05-10")).toThrow(/at least one/);
  });
});
