// Integration test: spawn `scripts/import-triage.mjs` against a
// fixture CSV that mixes three row shapes — explicit title, series-
// only, and author-only — and assert each shape lands in the right
// pile. The original bug was that title-less rows were silently
// dropped during the spreadsheet import; this pins the title-fallback
// chain (title → series → author) and the synthetic-pile routing
// (real titles keep their series pile; series-only rows land in
// "Whole series"; author-only rows land in "By author").

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/import-triage.mjs");

const CSV = `Author,Series,#,Title,Read,Why
Adrian Tchaikovsky,Children of Time,1,Children of Time,,one row with title
Adrian Tchaikovsky,Children of Time,2,Children of Ruin,,another with title
Paul Kearney,Monarchies of God,,,,series-only row
Robert Jackson Bennett,Foundryside,,,,another series-only
Tad Williams,"Memory, Sorrow, and Thorn",,,,series with comma in name
Becky Chambers,,,,,author-only row
Patrick Rothfuss,,,,,another author-only
,,,,,
N. K. Jemisin,Broken Earth,1,The Fifth Season,true,already finished
`;

describe("import-triage.mjs row-fallback behaviour", () => {
  let tmpDir: string;
  let csvPath: string;
  let vaultPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ook-import-triage-"));
    csvPath = path.join(tmpDir, "media-list.csv");
    vaultPath = path.join(tmpDir, "vault");
    writeFileSync(csvPath, CSV, "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preserves explicit-title, series-only, and author-only rows in distinct piles", () => {
    const result = spawnSync("node", [SCRIPT, csvPath, "--vault", vaultPath], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const stdout = result.stdout;
    const stderr = result.stderr;

    // Stats line: 2 title rows + 3 series rows + 2 author rows = 7
    // triage entries; 1 Read=true row promoted to vault; 1 fully-empty
    // row skipped.
    expect(stderr).toMatch(/7 triage entries/);
    expect(stderr).toMatch(/1 read → vault/);
    expect(stderr).toMatch(/1 skipped: no title/);

    // Real-title rows keep their Series-named pile.
    expect(stdout).toContain("## Children of Time");
    expect(stdout).toContain("- **Children of Time** #1 — Adrian Tchaikovsky.");
    expect(stdout).toContain("- **Children of Ruin** #2 — Adrian Tchaikovsky.");

    // Series-only rows fold into a single "Whole series" pile with
    // the series name as the bullet title.
    expect(stdout).toContain("## Whole series");
    expect(stdout).toContain("- **Monarchies of God** — Paul Kearney.");
    expect(stdout).toContain("- **Foundryside** — Robert Jackson Bennett.");
    expect(stdout).toContain("- **Memory, Sorrow, and Thorn** — Tad Williams.");

    // Author-only rows fold into a "By author" pile.
    expect(stdout).toContain("## By author");
    expect(stdout).toContain("- **Becky Chambers** — Becky Chambers.");
    expect(stdout).toContain("- **Patrick Rothfuss** — Patrick Rothfuss.");
  });
});
