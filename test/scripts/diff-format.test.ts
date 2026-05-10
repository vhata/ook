// Pins the diff-format helper's TTY-vs-non-TTY behaviour. The shape of
// the output is load-bearing: backfill dry-runs emit `-` / `+` lines
// that should read as a unified diff. ANSI colour codes only show when
// stdout is a TTY — CI logs and redirected output must stay plain so
// downstream consumers (golden files, grep, pagers without `-R`) keep
// working.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import {
  formatAddition,
  formatBookHeader,
  formatContext,
  formatLineChange,
  formatLineInsertion,
  formatRemoval,
} from "../../scripts/lib/diff-format.mjs";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// The helpers read `process.stdout.isTTY` (and the FORCE_COLOR /
// NO_COLOR env vars) every call so tests can flip them between cases.
// Save originals and restore in afterEach so we don't poison sibling
// suites.
let originalIsTTY: boolean | undefined;
let originalForceColor: string | undefined;
let originalNoColor: string | undefined;

beforeEach(() => {
  originalIsTTY = process.stdout.isTTY;
  originalForceColor = process.env.FORCE_COLOR;
  originalNoColor = process.env.NO_COLOR;
  // Clear the env hooks so the isTTY flag is what's actually under
  // test in the basic suites below. Suites that exercise the env
  // overrides explicitly re-set them.
  delete process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
});

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: originalIsTTY,
  });
  if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = originalForceColor;
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

function setTTY(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}

describe("diff-format (TTY)", () => {
  beforeEach(() => setTTY(true));

  it("wraps removals in red", () => {
    expect(formatRemoval("tags: [scifi]")).toBe(`${RED}- tags: [scifi]${RESET}`);
  });

  it("wraps additions in green", () => {
    expect(formatAddition("tags: [scifi, novella]")).toBe(
      `${GREEN}+ tags: [scifi, novella]${RESET}`,
    );
  });

  it("wraps context lines in dim", () => {
    expect(formatContext("goodreads_id: 12345")).toBe(`${DIM}  goodreads_id: 12345${RESET}`);
  });

  it("formatLineChange pairs a red removal with a green addition", () => {
    expect(formatLineChange("tags: []", "tags: [novella, scifi]")).toBe(
      `${RED}- tags: []${RESET}\n${GREEN}+ tags: [novella, scifi]${RESET}`,
    );
  });

  it("formatLineInsertion with context emits dim hint above green addition", () => {
    expect(formatLineInsertion("source: goodreads", "(end of frontmatter)")).toBe(
      `${DIM}  (end of frontmatter)${RESET}\n${GREEN}+ source: goodreads${RESET}`,
    );
  });

  it("formatLineInsertion without context emits only the green addition", () => {
    expect(formatLineInsertion("source: goodreads")).toBe(`${GREEN}+ source: goodreads${RESET}`);
  });

  it("formatBookHeader is never coloured (it's a label, not a diff line)", () => {
    const header = formatBookHeader("All Systems Red");
    expect(header).toBe("→ All Systems Red");
    expect(header).not.toContain(RED);
    expect(header).not.toContain(GREEN);
    expect(header).not.toContain(DIM);
  });
});

describe("diff-format (non-TTY)", () => {
  beforeEach(() => setTTY(false));

  it("removals get a plain `- ` prefix, no ANSI", () => {
    const out = formatRemoval("tags: [scifi]");
    expect(out).toBe("- tags: [scifi]");
    expect(out).not.toContain("\x1b");
  });

  it("additions get a plain `+ ` prefix, no ANSI", () => {
    const out = formatAddition("tags: [scifi, novella]");
    expect(out).toBe("+ tags: [scifi, novella]");
    expect(out).not.toContain("\x1b");
  });

  it("context lines get a two-space prefix, no ANSI", () => {
    const out = formatContext("goodreads_id: 12345");
    expect(out).toBe("  goodreads_id: 12345");
    expect(out).not.toContain("\x1b");
  });

  it("formatLineChange pairs plain `-`/`+` lines", () => {
    expect(formatLineChange("tags: []", "tags: [novella, scifi]")).toBe(
      "- tags: []\n+ tags: [novella, scifi]",
    );
  });

  it("formatLineInsertion with context emits plain hint + plain addition", () => {
    expect(formatLineInsertion("source: goodreads", "(end of frontmatter)")).toBe(
      "  (end of frontmatter)\n+ source: goodreads",
    );
  });

  it("formatLineInsertion without context emits only a plain addition", () => {
    expect(formatLineInsertion("source: goodreads")).toBe("+ source: goodreads");
  });
});

describe("diff-format (undefined isTTY — same shape as a piped stdout)", () => {
  // The Node default for piped/redirected stdout is `undefined`, not
  // `false`. Belt-and-braces: confirm we treat it as not-a-TTY.
  beforeEach(() => setTTY(undefined as unknown as boolean));

  it("treats undefined isTTY as non-TTY", () => {
    expect(formatRemoval("a")).toBe("- a");
    expect(formatAddition("b")).toBe("+ b");
  });
});

describe("diff-format (FORCE_COLOR / NO_COLOR env overrides)", () => {
  it("FORCE_COLOR=1 enables ANSI even when stdout isn't a TTY", () => {
    setTTY(false);
    process.env.FORCE_COLOR = "1";
    expect(formatRemoval("x")).toBe(`${RED}- x${RESET}`);
  });

  it("FORCE_COLOR=0 disables ANSI even on a TTY", () => {
    setTTY(true);
    process.env.FORCE_COLOR = "0";
    expect(formatRemoval("x")).toBe("- x");
  });

  it("NO_COLOR set disables ANSI even on a TTY", () => {
    setTTY(true);
    process.env.NO_COLOR = "1";
    expect(formatAddition("y")).toBe("+ y");
  });

  it("FORCE_COLOR takes precedence over NO_COLOR", () => {
    setTTY(false);
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    expect(formatAddition("y")).toBe(`${GREEN}+ y${RESET}`);
  });
});
