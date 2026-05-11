import { describe, expect, it } from "vitest";
import {
  applyMetaPatch,
  appendBulletToSection,
  removeBulletFromSection,
} from "../../src/lib/mcp/meta-patch";

describe("removeBulletFromSection", () => {
  const file = `# Triage

## Maybe

- **Foo** — Foo Author.
- **Bar** — Bar Author. _heard about it_
- **Baz** — Baz Author.

## Lightbringer

- **Black Prism** — Brent Weeks.
`;

  it("removes the named bullet and leaves the rest of the section intact", () => {
    const after = removeBulletFromSection(file, "Maybe", "**Bar** — Bar Author. _heard about it_");
    expect(after).toContain("- **Foo** — Foo Author.");
    expect(after).toContain("- **Baz** — Baz Author.");
    expect(after).not.toContain("**Bar**");
    // Other section untouched.
    expect(after).toContain("- **Black Prism** — Brent Weeks.");
  });

  it("throws when the section is missing", () => {
    expect(() => removeBulletFromSection(file, "Nope", "**Foo** — Foo Author.")).toThrow(
      /section not found/,
    );
  });

  it("throws when the bullet is missing", () => {
    expect(() => removeBulletFromSection(file, "Maybe", "**Qux**")).toThrow(
      /bullet not found under "Maybe"/,
    );
  });
});

describe("appendBulletToSection", () => {
  it("appends to an existing section under the last bullet", () => {
    const file = `## Wanted

- **A** — Foo.
- **B** — Bar.
`;
    const after = appendBulletToSection(file, "Wanted", "**C** — Baz.");
    const lines = after.split("\n");
    const c = lines.findIndex((l) => l.includes("**C**"));
    const b = lines.findIndex((l) => l.includes("**B**"));
    expect(c).toBe(b + 1);
  });

  it("creates a new section at end of file when the heading is absent", () => {
    const file = `## Wanted

- **A** — Foo.
`;
    const after = appendBulletToSection(file, "From Triage (2026-05-10)", "**C** — Baz.");
    expect(after).toContain("## From Triage (2026-05-10)");
    expect(after).toContain("- **C** — Baz.");
  });

  it("handles an empty file by minting the heading and bullet", () => {
    const after = appendBulletToSection("", "From Triage (2026-05-10)", "**C** — Baz.");
    expect(after).toContain("## From Triage (2026-05-10)");
    expect(after).toContain("- **C** — Baz.");
  });
});

describe("applyMetaPatch", () => {
  it("create-file refuses when the file already exists", () => {
    expect(() =>
      applyMetaPatch("old", { kind: "create-file", path: "x/x.md", content: "new" }),
    ).toThrow(/already exists/);
  });

  it("create-file produces content with a trailing newline", () => {
    const r = applyMetaPatch(null, { kind: "create-file", path: "x/x.md", content: "hello" });
    expect(r.after.endsWith("\n")).toBe(true);
  });

  it("remove-bullet errors when the file is missing", () => {
    expect(() =>
      applyMetaPatch(null, {
        kind: "remove-bullet",
        path: "_meta/triage.md",
        section: "Maybe",
        bullet: "**x**",
      }),
    ).toThrow(/not found/);
  });

  it("append-bullet on a missing file errors", () => {
    expect(() =>
      applyMetaPatch(null, {
        kind: "append-bullet",
        path: "_meta/tbr.md",
        section: "Wanted",
        bullet: "**x**",
      }),
    ).toThrow(/not found/);
  });
});
