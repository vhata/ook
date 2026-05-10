// Shared helper for the vault-backfill scripts. Each script computes its
// pending changes once, prints a dry-run summary, and calls this helper.
// In `--apply` mode the helper runs the writes straight through. In dry-run
// mode it checks whether stdin is a TTY: if so, and there are pending
// changes, it prompts `Apply these N changes? [y/N] ` and runs the writes
// on `y` / `yes`. Non-TTY stdin (CI, pipes, redirected input) skips the
// prompt and returns — the script behaves exactly as it did before this
// helper existed.
//
// The point: never throw away the work the dry-run already computed. Each
// script collects its writes as zero-argument closures during the
// derivation pass; the helper either fires them immediately (--apply),
// fires them after a yes (interactive), or drops them (non-interactive
// dry-run). The closures hold any in-memory state needed to write — for
// the network-bound scripts this means the API responses are reused
// rather than re-fetched.
//
// Manual-test recipe (the interactive path is awkward to unit-test):
//
//   node scripts/backfill-source.mjs                # (interactive) → prompts on changes
//   node scripts/backfill-source.mjs --apply        # writes without prompting
//   echo '' | node scripts/backfill-source.mjs      # no TTY → no prompt, exits
//   echo y | node scripts/backfill-source.mjs       # stdin not TTY → no prompt, exits
//
// Pinning that contract: the no-TTY path is the load-bearing one (CI must
// not hang). It's covered by `test/scripts/maybe-prompt-apply.test.ts`.

import readline from "node:readline";

/**
 * @param {object} opts
 * @param {boolean} opts.apply             - true iff `--apply` was passed
 * @param {number}  opts.changeCount       - number of pending writes
 * @param {string}  [opts.changeNoun="changes"] - word for the prompt ("see_also additions", "tag updates", …)
 * @param {() => Promise<void>} opts.doApply     - run the writes
 * @param {NodeJS.WritableStream} [opts.out]     - where to print prompt text (default process.stderr)
 * @param {NodeJS.ReadableStream} [opts.in]      - where to read the answer (default process.stdin)
 * @returns {Promise<"applied" | "dry-run" | "declined" | "non-interactive">}
 */
export async function maybePromptApply({
  apply,
  changeCount,
  changeNoun = "changes",
  doApply,
  out = process.stderr,
  in: inStream = process.stdin,
}) {
  if (apply) {
    await doApply();
    return "applied";
  }

  if (changeCount === 0) {
    // Nothing to do. Match the existing scripts' "(dry-run; rerun with
    // --apply to write)" hint so behaviour outside the prompt is identical.
    out.write("(dry-run; rerun with --apply to write)\n");
    return "dry-run";
  }

  // Crucial: never block when stdin isn't a terminal. CI, pipes, and
  // `echo … | node …` all flow through here, and any of them blocking
  // would be a regression on the previous shape.
  const isTty = Boolean(inStream && inStream.isTTY);
  if (!isTty) {
    out.write("(dry-run; rerun with --apply to write — non-interactive stdin, not prompting)\n");
    return "non-interactive";
  }

  const answer = await prompt(`Apply these ${changeCount} ${changeNoun}? [y/N] `, {
    in: inStream,
    out,
  });
  const yes = /^\s*y(es)?\s*$/i.test(answer ?? "");
  if (!yes) {
    out.write("declined; no changes written\n");
    return "declined";
  }

  await doApply();
  return "applied";
}

function prompt(question, { in: inStream, out }) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: inStream, output: out });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
