import { describe, expect, it } from "vitest";
import { buildSeedPrompt } from "../../src/lib/admin/seed-prompt";

describe("buildSeedPrompt", () => {
  it("returns an empty string when no focus is supplied", () => {
    expect(buildSeedPrompt()).toBe("");
    expect(buildSeedPrompt("")).toBe("");
  });

  it("seeds a bare 'Edit <slug>:' opener for a book focus without intent", () => {
    expect(buildSeedPrompt("book:piranesi")).toBe("Edit piranesi: ");
  });

  it("seeds a remove-from-series prompt when both focus and intent are supplied", () => {
    expect(buildSeedPrompt("book:piranesi", "remove-from-series:Discworld")).toBe(
      "Edit piranesi: remove 'Discworld' from the series field.",
    );
  });

  it("seeds a remove-tag prompt when both focus and intent are supplied", () => {
    expect(buildSeedPrompt("book:piranesi", "remove-tag:literary")).toBe(
      "Edit piranesi: remove the 'literary' tag.",
    );
  });

  it("URL-decodes both focus and intent values", () => {
    expect(buildSeedPrompt("book:the%20colour%20of%20magic", "remove-tag:science%20fiction")).toBe(
      "Edit the colour of magic: remove the 'science fiction' tag.",
    );
  });

  it("handles tag, series, and log focuses with a generic opener", () => {
    expect(buildSeedPrompt("tag:literary")).toBe("Edit the 'literary' tag: ");
    expect(buildSeedPrompt("series:Discworld")).toBe("Edit the 'Discworld' series: ");
    expect(buildSeedPrompt("log:2026-04-12:finished:piranesi")).toBe(
      "Edit log entry 2026-04-12:finished:piranesi: ",
    );
  });

  it("returns an empty string for unknown focus kinds", () => {
    expect(buildSeedPrompt("frog:kermit")).toBe("");
  });

  it("returns an empty string for malformed focus shapes", () => {
    expect(buildSeedPrompt("piranesi")).toBe("");
    expect(buildSeedPrompt(":piranesi")).toBe("");
    expect(buildSeedPrompt("book:")).toBe("");
  });

  it("falls through to the bare opener when intent is recognised but its detail is missing", () => {
    expect(buildSeedPrompt("book:piranesi", "remove-tag:")).toBe("Edit piranesi: ");
    expect(buildSeedPrompt("book:piranesi", "unknown-intent:foo")).toBe("Edit piranesi: ");
  });

  it("tolerates a malformed percent-encoded value rather than throwing", () => {
    // Trailing single % is invalid URI escape; safeDecode keeps the raw
    // value and the rest of the pipeline carries on.
    expect(buildSeedPrompt("book:bad%value")).toBe("Edit bad%value: ");
  });
});
