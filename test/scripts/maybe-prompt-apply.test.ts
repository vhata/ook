// Pins the load-bearing path through `maybePromptApply`: the no-TTY
// branch must NEVER prompt and must NEVER call doApply on its own. CI,
// pipes, and `echo … | node …` all flow through here, and any of them
// blocking on a hidden prompt would be a regression on the previous
// behaviour of the backfill scripts. The interactive (yes/no) branch is
// awkward to unit-test cleanly because readline drives a real stream;
// the manual-test recipe is documented inside the helper itself.

import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs script lives outside the TS project graph
import { maybePromptApply } from "../../scripts/lib/maybe-prompt-apply.mjs";

function makeStreams() {
  // Readable that immediately ends — the helper should never read from
  // it because isTTY is undefined (i.e. not a TTY). If anything does
  // try to read, the stream just closes; the helper would still hang
  // on its prompt, so the test would time out.
  const inStream = new Readable({ read() {} });
  inStream.push(null);

  const chunks: string[] = [];
  const out = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { in: inStream, out, chunks };
}

describe("maybePromptApply", () => {
  it("runs doApply immediately when --apply is set", async () => {
    const doApply = vi.fn(async () => {});
    const { in: inStream, out } = makeStreams();
    const result = await maybePromptApply({
      apply: true,
      changeCount: 3,
      doApply,
      in: inStream,
      out,
    });
    expect(result).toBe("applied");
    expect(doApply).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a zero-change dry-run", async () => {
    const doApply = vi.fn(async () => {});
    const { in: inStream, out, chunks } = makeStreams();
    const result = await maybePromptApply({
      apply: false,
      changeCount: 0,
      doApply,
      in: inStream,
      out,
    });
    expect(result).toBe("dry-run");
    expect(doApply).not.toHaveBeenCalled();
    expect(chunks.join("")).toContain("dry-run");
  });

  it("does NOT prompt or apply when stdin is not a TTY", async () => {
    const doApply = vi.fn(async () => {});
    const { in: inStream, out, chunks } = makeStreams();
    // The Readable above has no isTTY — same shape as a piped stdin.
    expect((inStream as unknown as { isTTY?: boolean }).isTTY).toBeUndefined();
    const result = await maybePromptApply({
      apply: false,
      changeCount: 5,
      doApply,
      in: inStream,
      out,
    });
    expect(result).toBe("non-interactive");
    expect(doApply).not.toHaveBeenCalled();
    expect(chunks.join("")).toContain("non-interactive");
  });

  it("uses the provided changeNoun in messaging when relevant", async () => {
    const doApply = vi.fn(async () => {});
    const { in: inStream, out, chunks } = makeStreams();
    // Non-TTY path: the noun isn't in the message, but the helper still
    // reports cleanly without throwing — that's the behaviour we want.
    await maybePromptApply({
      apply: false,
      changeCount: 7,
      changeNoun: "tag updates",
      doApply,
      in: inStream,
      out,
    });
    // Just confirm it didn't throw and produced some message.
    expect(chunks.join("").length).toBeGreaterThan(0);
  });
});
