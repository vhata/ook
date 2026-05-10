import { describe, expect, it } from "vitest";
import robots from "../../src/app/robots";

describe("robots.txt", () => {
  it("disallows operator and noindex surfaces, allows everything else", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules!];
    const rule = rules[0]!;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow!];
    // Operator-only and noindex surfaces. Belt-and-braces — pages also carry
    // per-page robots:noindex metadata.
    expect(disallow).toContain("/admin");
    expect(disallow).toContain("/now");
    expect(disallow).toContain("/vault-health");
    expect(disallow).toContain("/schema");
    expect(disallow).toContain("/api/");
  });

  it("advertises the sitemap", () => {
    const r = robots();
    expect(typeof r.sitemap).toBe("string");
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
