// Pure helper: given a book's `quotes.md` body, return the top N
// candidates ranked by "would this read well as the per-book
// pullquote?". The /admin/backfill surface uses this to offer 3 picks
// for finished books that have a quotes.md but no pullquote set — one
// tap writes the chosen line to frontmatter.
//
// Scoring rubric (all heuristic, tuned for prose fiction):
//   - Length: target ~120 chars. Score curves down from there in
//     both directions. Below 30 or above 300 → effectively zero.
//   - Sentence-completeness: ends with `.`, `?`, `!` (or `"`/`"`
//     after one of those). Starts with a capital letter.
//   - Single sentence preferred (no semicolons mid-quote, no period
//     followed by more text).
//   - Bonus when an attribution line ("— Opening line", "— Ch. 5")
//     immediately follows in the source; we surface the attribution
//     too so the caller can write the `pullquote.source` field.
//
// quotes.md convention observed in the vault: `# Quotes` heading,
// then blockquote paragraphs separated by blank lines. Attribution
// lines (start with `—`) appear right after the quote they belong
// to. The parser is forgiving about whitespace and tolerates files
// that omit the heading.

export type PullquoteCandidate = {
  text: string;
  source: string | null;
  score: number;
};

// Parse out blockquote paragraphs from quotes.md content. Consecutive
// `> ` lines (with optional empty `>` separators inside the same
// quote) merge into one paragraph. Adjacent attribution lines (start
// with `—`) attach to the preceding quote as `source`.
export function parseQuotes(body: string): Array<{ text: string; source: string | null }> {
  const lines = body.split("\n");
  const out: Array<{ text: string; source: string | null }> = [];

  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push({ text, source: null });
    current = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith(">")) {
      const inner = line.replace(/^>\s?/, "").trim();
      if (inner.length === 0) {
        // Inner blank line inside a blockquote — collapse but keep
        // the quote open.
        continue;
      }
      current.push(inner);
      continue;
    }
    if (line.startsWith("—") || line.startsWith("--")) {
      // Attribution line. Attach to the most-recently-closed quote
      // if one is pending; otherwise discard.
      flush();
      const last = out[out.length - 1];
      if (last) {
        last.source = line.replace(/^[—-]+\s*/, "").trim() || null;
      }
      continue;
    }
    // Any other line (heading, prose, blank) closes the running quote.
    flush();
  }
  flush();
  return out;
}

// Score a candidate. Higher is better. Pure function over the text
// + source pair — same inputs, same output, so callers can fold it
// into rankings deterministically.
export function scoreCandidate(text: string, source: string | null): number {
  const len = text.length;
  if (len < 30 || len > 300) return 0;

  // Length curve: triangle peaked at 120, falls to 0 at the edges
  // (30 and 300). Max contribution 50.
  const lengthScore = len <= 120 ? ((len - 30) / 90) * 50 : Math.max(0, ((300 - len) / 180) * 50);

  // Sentence-completeness: starts capital, ends with terminal
  // punctuation (allowing one trailing quote char). +20 each.
  const startsCapital = /^[A-Z"'"„]/.test(text);
  const endsTerminal = /[.!?]["'""]?$/.test(text);
  const completeness = (startsCapital ? 20 : 0) + (endsTerminal ? 20 : 0);

  // Single-sentence bonus: no internal period followed by space + capital.
  // Multi-sentence quotes are fine but score lower than single-sentence ones.
  const internalSentences = (text.match(/[.!?]\s+[A-Z]/g) ?? []).length;
  const singleSentenceBonus = internalSentences === 0 ? 10 : 0;

  // Attribution bonus: a known source ("— Opening line", "Ch. 5")
  // signals the reader cared enough to label it. +10.
  const attributionBonus = source && source.length > 0 ? 10 : 0;

  return lengthScore + completeness + singleSentenceBonus + attributionBonus;
}

// Top-N candidates from a quotes.md body, sorted by score descending.
// Ties broken by source-of-occurrence (earlier quotes win) so the
// ranking is stable across re-runs for the same input.
export function topCandidates(body: string, n: number = 3): PullquoteCandidate[] {
  const parsed = parseQuotes(body);
  const scored: PullquoteCandidate[] = parsed.map((q, i) => ({
    text: q.text,
    source: q.source,
    score: scoreCandidate(q.text, q.source),
    // Carry the index for tie-breaking; not part of the output type.
    _idx: i,
  })) as unknown as PullquoteCandidate[];
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a as unknown as { _idx: number })._idx - (b as unknown as { _idx: number })._idx;
  });
  return scored
    .filter((c) => c.score > 0)
    .slice(0, n)
    .map((c) => ({ text: c.text, source: c.source, score: c.score }));
}
