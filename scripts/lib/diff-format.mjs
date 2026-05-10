// Shared formatter for the vault-backfill dry-run output. Each backfill
// script computes a changeset (per-book frontmatter line replacements
// or insertions) and prints a per-book block. When stdout is a TTY,
// these helpers wrap each line in ANSI red (removal) / green (addition)
// / dim (context) codes so the dry-run reads as a unified diff at a
// glance. When stdout is NOT a TTY — CI, redirected output, piped to a
// pager that doesn't render ANSI by default — the helpers emit plain
// `-` / `+` markers with no codes, so logs and golden-file tests stay
// stable.
//
// Why TTY-only colour: `less` won't render ANSI without `-R`; some CI
// log viewers garble it; and a non-coloured dry-run still has the
// `-`/`+` prefix carrying the same signal. Colour is presentation; the
// shape of the output is the source of truth.
//
// Manual-test recipe (the TTY-detection branch is awkward to fully
// unit-test through stdout itself):
//
//   node scripts/backfill-source.mjs                # TTY → colored
//   node scripts/backfill-source.mjs | cat          # piped → plain
//   node scripts/backfill-source.mjs | less -R      # pager → colored
//
// Pinned by `test/scripts/diff-format.test.ts`.

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Resolved every call (not at module load) so tests can flip
// `process.stdout.isTTY` (and the env overrides below) between cases
// without re-importing. Honours the de-facto standard `FORCE_COLOR`
// and `NO_COLOR` env vars so child processes (CI, the integration
// tests under `test/scripts/`) can opt into / out of ANSI codes
// without a real terminal.
//
//   FORCE_COLOR=0 / NO_COLOR=*  → no ANSI, even on a TTY
//   FORCE_COLOR=1+              → ANSI, even when stdout isn't a TTY
//   neither set                  → follow process.stdout.isTTY
function isColorEnabled() {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "") {
    // `FORCE_COLOR=0` is the conventional "off"; everything else is on.
    return force !== "0";
  }
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return Boolean(process.stdout && process.stdout.isTTY);
}

/**
 * A removed frontmatter line — the value as it stands in the vault today.
 * @param {string} line - the literal line content (without the `-` marker)
 * @returns {string}
 */
export function formatRemoval(line) {
  return isColorEnabled() ? `${RED}- ${line}${RESET}` : `- ${line}`;
}

/**
 * An added frontmatter line — the value the script proposes to write.
 * @param {string} line - the literal line content (without the `+` marker)
 * @returns {string}
 */
export function formatAddition(line) {
  return isColorEnabled() ? `${GREEN}+ ${line}${RESET}` : `+ ${line}`;
}

/**
 * A surrounding/context line — usually a hint about where in the
 * frontmatter the change lands. Two-space prefix matches unified-diff
 * convention.
 * @param {string} line
 * @returns {string}
 */
export function formatContext(line) {
  return isColorEnabled() ? `${DIM}  ${line}${RESET}` : `  ${line}`;
}

/**
 * Paired change: a frontmatter line that's being replaced. Renders as
 * a two-line block: red `-` (old) immediately followed by green `+`
 * (new).
 * @param {string} oldLine
 * @param {string} newLine
 * @returns {string} a `\n`-joined two-line block, no trailing newline
 */
export function formatLineChange(oldLine, newLine) {
  return `${formatRemoval(oldLine)}\n${formatAddition(newLine)}`;
}

/**
 * Pure insertion: a frontmatter field that doesn't exist yet. When a
 * `context` hint is supplied (typically the previous line in the file
 * — `goodreads_id`, the closing `---`, etc.) it renders as a dim
 * context line above the green `+`. Without context the block is just
 * the green `+`.
 * @param {string} newLine
 * @param {string} [context]
 * @returns {string}
 */
export function formatLineInsertion(newLine, context) {
  if (context) return `${formatContext(context)}\n${formatAddition(newLine)}`;
  return formatAddition(newLine);
}

/**
 * A small header introducing a per-book block. Renders as `→ <title>`
 * (or `→ <slug>` when no title is supplied). No ANSI styling — the
 * arrow + label is enough visual weight without colour fighting the
 * red/green lines below.
 * @param {string} title
 * @returns {string}
 */
export function formatBookHeader(title) {
  return `→ ${title}`;
}
