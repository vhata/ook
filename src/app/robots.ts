import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public-facing routes are indexable; operator-only surfaces are not.
// /vault-health and /schema already carry `metadata.robots = "noindex"`
// per-page; the explicit Disallow here is a belt-and-braces declaration
// for crawlers that respect robots.txt before metadata.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/vault-health", "/schema", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
