import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors the `@/*` path mapping in tsconfig.json so component tests can
// transitively import modules that use the alias (DeepNotes → @/components/Spoiler,
// @/lib/markdown, etc.). The Next.js dev/build pipelines resolve `@` automatically;
// vitest needs the explicit hint.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
