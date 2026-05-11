// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildBody } from "../../src/components/PausedCardActions";

describe("PausedCardActions.buildBody", () => {
  it("pick-up stages a last_progress=today patch", () => {
    const body = buildBody("piranesi", "Piranesi", "pick-up");
    expect(body.patches).toHaveLength(1);
    const patch = body.patches[0] as {
      slug: string;
      frontmatter_changes: Record<string, unknown>;
      commit_message: string;
    };
    expect(patch.slug).toBe("piranesi");
    expect(patch.frontmatter_changes).toHaveProperty("last_progress");
    expect(patch.frontmatter_changes.last_progress).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(patch.commit_message).toContain("piranesi");
    expect(body.message).toContain("picked back up");
  });

  it("move-to-shelf stages a status=abandoned patch", () => {
    const body = buildBody("dune", "Dune", "move-to-shelf");
    expect(body.patches).toHaveLength(1);
    const patch = body.patches[0] as {
      slug: string;
      frontmatter_changes: Record<string, unknown>;
    };
    expect(patch.slug).toBe("dune");
    expect(patch.frontmatter_changes.status).toBe("abandoned");
    expect(body.message).toContain("Dune");
    expect(body.message).toContain("moved to shelf");
  });
});
