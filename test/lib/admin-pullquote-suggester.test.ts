import { describe, expect, it } from "vitest";
import {
  parseQuotes,
  scoreCandidate,
  topCandidates,
} from "../../src/lib/admin/pullquote-suggester";

// Sample modelled on the real vault format:
//   # Quotes
//
//   > A complete first sentence ending with a period.
//
//   — Opening line
//
//   > Another quote with no attribution.
//
// Parser merges consecutive `> ` lines into one quote, attaches the
// `—`-prefixed line below as `source`, and ignores headings.

const SAMPLE = `# Quotes

> The Beauty of the House is immeasurable; its Kindness infinite.

— Opening line

> Admitting that there's something in the world that will never be fully understood is the opposite of science.

> tiny

> A multi-line
> blockquote that
> wraps across
> several lines but reads as one sentence with no terminal mark
`;

describe("parseQuotes", () => {
  it("extracts each blockquote as a separate candidate", () => {
    const out = parseQuotes(SAMPLE);
    expect(out).toHaveLength(4);
    expect(out[0].text).toBe("The Beauty of the House is immeasurable; its Kindness infinite.");
    expect(out[1].text).toContain("the opposite of science");
    expect(out[2].text).toBe("tiny");
  });

  it("attaches `—` attribution lines to the preceding quote", () => {
    const out = parseQuotes(SAMPLE);
    expect(out[0].source).toBe("Opening line");
    expect(out[1].source).toBeNull();
  });

  it("merges consecutive `> ` lines into a single paragraph", () => {
    const out = parseQuotes(SAMPLE);
    const multiline = out[3].text;
    expect(multiline).toContain("A multi-line blockquote");
    expect(multiline).toContain("several lines but reads as one sentence");
    // No newlines preserved in the merged text.
    expect(multiline).not.toContain("\n");
  });

  it("returns an empty array for body with no blockquotes", () => {
    expect(parseQuotes("just some prose, no quotes here")).toEqual([]);
  });

  it("ignores headings and other non-quote lines between quotes", () => {
    const body = `## Chapter 1

> Quote one.

## Chapter 5

> Quote two.`;
    const out = parseQuotes(body);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("Quote one.");
    expect(out[1].text).toBe("Quote two.");
  });
});

describe("scoreCandidate", () => {
  it("rejects too-short quotes (< 30 chars)", () => {
    expect(scoreCandidate("Tiny.", null)).toBe(0);
  });

  it("rejects too-long quotes (> 300 chars)", () => {
    expect(scoreCandidate("x".repeat(301), null)).toBe(0);
  });

  it("scores a clean ~120-char single sentence well", () => {
    const text =
      "A clean, complete sentence right around the sweet spot length, terminating cleanly.";
    expect(scoreCandidate(text, null)).toBeGreaterThan(60);
  });

  it("rewards attribution presence", () => {
    const text =
      "A clean, complete sentence right around the sweet spot length, terminating cleanly.";
    const withSource = scoreCandidate(text, "Ch. 5");
    const withoutSource = scoreCandidate(text, null);
    expect(withSource).toBeGreaterThan(withoutSource);
  });

  it("penalises multi-sentence quotes (no single-sentence bonus)", () => {
    const single = "A single complete sentence at the right length, no internal periods.";
    const multi = "A first sentence. And then another sentence right after.";
    // Tune the strings to roughly the same length; multi has internal "period + space + capital".
    expect(scoreCandidate(single, null)).toBeGreaterThan(scoreCandidate(multi, null));
  });

  it("rewards terminal punctuation", () => {
    const withPeriod = "A clean sentence ending in a period right at the sweet spot length here.";
    const withoutPeriod =
      "A clean sentence ending without any terminal mark right at the sweet spot here";
    expect(scoreCandidate(withPeriod, null)).toBeGreaterThan(scoreCandidate(withoutPeriod, null));
  });
});

describe("topCandidates", () => {
  it("returns up to N candidates ranked by score, ties broken by source order", () => {
    const out = topCandidates(SAMPLE, 3);
    expect(out.length).toBeLessThanOrEqual(3);
    // The "tiny" quote is below the 30-char floor — must not be in the top.
    expect(out.find((c) => c.text === "tiny")).toBeUndefined();
    // The longer "opposite of science" quote (closer to the 120-char sweet
    // spot) outscores the 63-char Beauty-of-the-House line even though the
    // latter has attribution — length carries the most weight in the rubric.
    expect(out[0].text).toContain("the opposite of science");
    // Beauty-of-the-House still surfaces in the top three thanks to its
    // attribution + single-sentence + terminal-punctuation bonuses.
    const beauty = out.find((c) => c.text.includes("Beauty of the House"));
    expect(beauty).toBeDefined();
    expect(beauty?.source).toBe("Opening line");
  });

  it("returns fewer than N when there aren't enough candidates", () => {
    const body = `> Only one decent-length sentence ending in a period here for testing.`;
    const out = topCandidates(body, 5);
    expect(out).toHaveLength(1);
  });

  it("returns an empty array when no quotes meet the length floor", () => {
    expect(topCandidates(`> Tiny.\n\n> Brief.`, 3)).toEqual([]);
  });

  it("emits stable output across re-runs", () => {
    const a = topCandidates(SAMPLE, 3);
    const b = topCandidates(SAMPLE, 3);
    expect(a).toEqual(b);
  });
});
