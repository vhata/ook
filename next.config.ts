import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include the cloned books vault in the deployed function bundle.
  // The prebuild script (scripts/fetch-vault.mjs) populates .vault/ from
  // vhata/books before `next build` runs.
  outputFileTracingIncludes: {
    "/": ["./.vault/**/*"],
    "/books/[slug]": ["./.vault/**/*"],
    "/log": ["./.vault/**/*"],
  },
};

export default nextConfig;
