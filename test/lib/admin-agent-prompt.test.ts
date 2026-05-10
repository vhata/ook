import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { FINISH_FLOW_INSTRUCTION_MARKER } from "../../src/lib/admin/agent";

// Pin the finish-flow instruction block in the admin agent's system
// prompt. The block is load-bearing for the pullquote+rating gate at
// status: finished — it lives in natural language (the tool layer
// doesn't enforce the gate, the agent does), so a future refactor of
// agent.ts that strips the block would silently regress the feature.
//
// This is a string-pinning test, not a behavioural one. Behavioural
// coverage of the gate would need a mock Anthropic transport, which
// is documented as a gap in the FEATURES.md entry. For now: pin the
// presence and the key concepts so the instruction can't drift away.
//
// MANUAL VERIFICATION RECIPE (until a transport mock lands):
//   1. npm run dev
//   2. Open /admin, sign in via passkey.
//   3. Type "I just finished <some-book>" with no rating/pullquote.
//   4. Agent should NOT propose_patch; it should ask the pullquote
//      and rating questions in plain text.
//   5. Answer both. Agent should propose a single patch bundling
//      status: finished + pullquote + rating.
//   6. Confirm — one commit lands on vhata/books.

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = join(HERE, "../../src/lib/admin/agent.ts");

describe("admin agent — finish-flow system-prompt pin", () => {
  const source = readFileSync(AGENT_PATH, "utf8");

  it("exports the marker constant", () => {
    expect(FINISH_FLOW_INSTRUCTION_MARKER).toBe("Finish-flow rule (load-bearing):");
  });

  it("includes the finish-flow rule header in the system prompt", () => {
    expect(source).toContain(FINISH_FLOW_INSTRUCTION_MARKER);
  });

  it("instructs the agent to ask for a pullquote and rating", () => {
    // Lower-case the source to make the pin tolerant of small wording
    // tweaks while still catching deletion of the rule.
    const lc = source.toLowerCase();
    expect(lc).toContain("pullquote");
    expect(lc).toContain("rating");
    // The gate must be tied to status: finished, not just any status.
    expect(lc).toMatch(/status:?\s*finished/);
  });

  it("instructs the agent to bundle status + pullquote + rating into ONE propose_patch", () => {
    const lc = source.toLowerCase();
    expect(lc).toMatch(/bundle.*one|one .*propose_patch|single propose_patch|one commit/);
  });

  it("acknowledges the operator's explicit-override path", () => {
    // The user has explicitly said the gate is default-on but not
    // absolute — pin that the prompt names that override path.
    const lc = source.toLowerCase();
    expect(lc).toContain("override");
  });

  it("instructs the agent to drop the commit if the user refuses both questions", () => {
    const lc = source.toLowerCase();
    expect(lc).toMatch(/do not commit|status flip is lost|the user chose this trade/);
  });
});
