import { describe, expect, it } from "vitest";
import { assembleNotesBody } from "../../src/app/api/books/[slug]/notes/route";

// Tier-2 deep-notes assembly. The route folds the on-disk `summary.md`
// body into the payload under a `## Plot summary` heading so the full
// plot recap reads as one section among the deep notes. The renderer
// surface (the `DeepNotes` client component) is unchanged; this test
// pins the wire-format the route emits.

describe("assembleNotesBody", () => {
  it("returns only the reference-notes body when no summary is set", () => {
    expect(assembleNotesBody(null, "## Notes\n\nBody text.")).toBe("## Notes\n\nBody text.");
  });

  it("prepends a `## Plot summary` section when summary is present", () => {
    const out = assembleNotesBody("Plot recap with full spoilers.", "## Notes\n\nBody text.");
    expect(out.startsWith("## Plot summary\n\nPlot recap with full spoilers.")).toBe(true);
    expect(out).toContain("## Notes\n\nBody text.");
  });

  it("handles a summary without a reference body (empty notes file)", () => {
    expect(assembleNotesBody("Just a plot recap.", "")).toBe(
      "## Plot summary\n\nJust a plot recap.",
    );
  });

  it("treats whitespace-only summary as absent", () => {
    expect(assembleNotesBody("   \n  ", "## Notes\n\nBody.")).toBe("## Notes\n\nBody.");
  });

  it("trims trailing whitespace on the reference body before composing", () => {
    // Keeps the join clean so the gap between summary and notes is
    // exactly one blank line regardless of trailing whitespace in the
    // source files.
    const out = assembleNotesBody("Recap.", "## Notes\n\nBody.   \n\n");
    expect(out).toBe("## Plot summary\n\nRecap.\n\n## Notes\n\nBody.");
  });
});
