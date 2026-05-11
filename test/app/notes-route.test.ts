import { describe, expect, it } from "vitest";
import { assembleNotesBody } from "../../src/app/api/books/[slug]/notes/route";

// Tier-2 deep-notes assembly. The route folds the on-disk `progress.md`
// body into the payload under a `## Reading notes` heading so the
// reader's running notes lead the deep-notes payload. The renderer
// surface (the `DeepNotes` client component) is unchanged; this test
// pins the wire-format the route emits.

describe("assembleNotesBody", () => {
  it("returns only the reference-notes body when no progress is set", () => {
    expect(assembleNotesBody(null, "## Notes\n\nBody text.")).toBe("## Notes\n\nBody text.");
  });

  it("prepends a `## Reading notes` section when progress is present", () => {
    const out = assembleNotesBody("Halfway through, still hooked.", "## Notes\n\nBody text.");
    expect(out.startsWith("## Reading notes\n\nHalfway through, still hooked.")).toBe(true);
    expect(out).toContain("## Notes\n\nBody text.");
  });

  it("handles progress without a reference body (empty notes file)", () => {
    expect(assembleNotesBody("Just started, jotting first impressions.", "")).toBe(
      "## Reading notes\n\nJust started, jotting first impressions.",
    );
  });

  it("treats whitespace-only progress as absent", () => {
    expect(assembleNotesBody("   \n  ", "## Notes\n\nBody.")).toBe("## Notes\n\nBody.");
  });

  it("trims trailing whitespace on the reference body before composing", () => {
    // Keeps the join clean so the gap between progress and notes is
    // exactly one blank line regardless of trailing whitespace in the
    // source files.
    const out = assembleNotesBody("Notes so far.", "## Notes\n\nBody.   \n\n");
    expect(out).toBe("## Reading notes\n\nNotes so far.\n\n## Notes\n\nBody.");
  });
});
