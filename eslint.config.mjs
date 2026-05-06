import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// Render code never writes to the vault. ARCHITECTURE.md "Vault is read-only
// from this project" is encoded here so the discipline can't drift. Scoped to
// src/** — scripts/ (the prebuild SSH-key writer) and test/ are out of scope.
const FS_WRITE_METHODS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "mkdir",
  "mkdirSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "truncate",
  "truncateSync",
];

const restrictedFsImport = {
  importNames: FS_WRITE_METHODS,
  message:
    "Vault is read-only from src/. Use only fs read APIs (readFile, readdir, stat). See ARCHITECTURE.md.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Catches `fs.writeFile(...)`, `fsp.writeFile(...)`, etc. — any
          // member-call where the property is a write method. Doesn't see
          // through aliases of individual methods, so the import-time rule
          // below covers `import { writeFile } from "fs"`.
          selector: `CallExpression > MemberExpression[property.name=/^(${FS_WRITE_METHODS.join("|")})$/]`,
          message:
            "Vault is read-only from src/. Use only fs read APIs (readFile, readdir, stat). See ARCHITECTURE.md.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", ...restrictedFsImport },
            { name: "node:fs", ...restrictedFsImport },
            { name: "fs/promises", ...restrictedFsImport },
            { name: "node:fs/promises", ...restrictedFsImport },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
