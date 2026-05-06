// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { appendLogEntry, createBook, upsertLogEntry } from "../../src/lib/mcp/extra-tools";
import { reindex } from "../../src/lib/store/index-vault";
import { MemoryStore, setStore } from "../../src/lib/store";

const FIXTURE_SRC = path.resolve(__dirname, "..", "fixtures", "vault");

let workingVault: string;

beforeEach(() => {
  workingVault = mkdtempSync(path.join(tmpdir(), "ook-extra-tools-"));
  cpSync(FIXTURE_SRC, workingVault, { recursive: true });
  vi.stubEnv("BOOKS_DIR", workingVault);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
  rmSync(workingVault, { recursive: true, force: true });
});

describe("createBook", () => {
  it("writes <Slug>/<Slug>.md with the provided frontmatter", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await createBook({
      slug: "Piranesi",
      title: "Piranesi",
      authors: ["Susanna Clarke"],
      status: "reading",
      started: "2026-05-05",
      commit_message: "Start Piranesi",
    });
    const filePath = path.join(workingVault, "Piranesi", "Piranesi.md");
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf8");
    const fm = yaml.load(raw.split("---")[1]) as Record<string, unknown>;
    expect(fm.title).toBe("Piranesi");
    expect(fm.authors).toEqual(["Susanna Clarke"]);
    expect(fm.status).toBe("reading");
    expect(fm.started).toBe("2026-05-05");
  });

  it("seeds the store record so list_books can return the new slug", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await createBook({
      slug: "Piranesi",
      title: "Piranesi",
      authors: ["Susanna Clarke"],
      status: "tbr",
      commit_message: "Start Piranesi",
    });
    const slugs = await store.smembers("books:index");
    expect(slugs).toContain("Piranesi");
    const stored = await store.get<{ title: string }>("book:Piranesi");
    expect(stored?.title).toBe("Piranesi");
  });

  it("refuses to overwrite an existing book", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      createBook({
        slug: "TestBook",
        title: "Test",
        authors: ["x"],
        status: "tbr",
        commit_message: "x",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an invalid slug", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await expect(
      createBook({
        slug: "../bad",
        title: "x",
        authors: ["y"],
        status: "tbr",
        commit_message: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("upsertLogEntry — pure helper", () => {
  it("creates a fresh file when existing is empty", () => {
    const out = upsertLogEntry({
      existing: "",
      date: "2026-05-05",
      kind: "Note",
      body: "First entry.",
    });
    expect(out).toContain("## 2026-05-05");
    expect(out).toContain("- **Note** — First entry.");
  });

  it("inserts under an existing date heading", () => {
    const existing = "## 2026-05-05\n\n- **Note** — older.\n";
    const out = upsertLogEntry({
      existing,
      date: "2026-05-05",
      kind: "Tbr",
      body: "newer",
    });
    expect(out).toContain("- **Note** — older");
    expect(out).toContain("- **Tbr** — newer");
    // The new bullet should land after the existing one.
    expect(out.indexOf("older")).toBeLessThan(out.indexOf("newer"));
  });

  it("inserts new date in descending order", () => {
    const existing = "## 2026-05-05\n\n- **Note** — old day.\n";
    const out = upsertLogEntry({
      existing,
      date: "2026-05-10",
      kind: "Note",
      body: "new day",
    });
    // 2026-05-10 should appear above 2026-05-05.
    expect(out.indexOf("2026-05-10")).toBeLessThan(out.indexOf("2026-05-05"));
  });

  it("appends old date below newer existing date", () => {
    const existing = "## 2026-05-10\n\n- **Note** — newer.\n";
    const out = upsertLogEntry({
      existing,
      date: "2026-05-05",
      kind: "Note",
      body: "older",
    });
    expect(out.indexOf("2026-05-10")).toBeLessThan(out.indexOf("2026-05-05"));
  });
});

describe("appendLogEntry — end-to-end", () => {
  it("writes a new bullet to _meta/log.md", async () => {
    const store = new MemoryStore();
    setStore(store);
    await reindex(store);
    await appendLogEntry({
      date: "2026-05-05",
      kind: "Note",
      body: "Quick thought.",
      commit_message: "Log thought",
    });
    const onDisk = readFileSync(path.join(workingVault, "_meta", "log.md"), "utf8");
    expect(onDisk).toContain("## 2026-05-05");
    expect(onDisk).toContain("- **Note** — Quick thought.");
  });
});
