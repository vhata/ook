import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public-facing routes are indexable; operator-only surfaces are not.
// /vault-health, /schema, /admin, and /now already carry per-page
// noindex metadata; the explicit Disallow here is a belt-and-braces
// declaration for crawlers that respect robots.txt before page metadata.
// `/admin` covers the passkey-gated console at `/admin`, `/admin/audit`,
// and `/admin/backfill`. `/now` is the embeddable "right now" surface —
// it's meant to be iframed, not indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/now", "/vault-health", "/schema", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
