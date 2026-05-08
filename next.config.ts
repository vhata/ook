import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include the cloned books vault in EVERY function bundle. The
  // prebuild chain (scripts/fetch-vault.mjs → scripts/build-index.mjs)
  // populates .vault/ with vhata/books contents plus an _index.json
  // before `next build` runs.
  //
  // The wildcard `*` key matches every route — when the corpus grew
  // past the original three explicit routes, missing pages started
  // 404'ing or returning empty data on Vercel because the function
  // didn't have the vault in its file-tracing scope.
  outputFileTracingIncludes: {
    "*": ["./.vault/**/*"],
  },
};

export default nextConfig;
