import { escapeXml, getFeedItems } from "@/lib/feed";
import { SITE_AUTHOR, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const FEED_TITLE = "ook — finished books";
const FEED_SUBTITLE = "What I've read, in the order I finished it.";

export async function GET() {
  const items = await getFeedItems(SITE_URL);
  const updated = items[0]?.publishedAt ?? new Date().toISOString();

  const entries = items
    .map(
      (item) => `  <entry>
    <title>${escapeXml(item.title)}</title>
    <link href="${escapeXml(item.url)}"/>
    <id>${escapeXml(item.url)}</id>
    <updated>${escapeXml(item.publishedAt)}</updated>
    <summary>${escapeXml(item.summary)}</summary>
  </entry>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_SUBTITLE)}</subtitle>
  <link href="${SITE_URL}/"/>
  <link href="${SITE_URL}/feed.xml" rel="self"/>
  <updated>${escapeXml(updated)}</updated>
  <id>${SITE_URL}/</id>
  <author><name>${escapeXml(SITE_AUTHOR)}</name></author>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      // Short cache lets a reader poll without hammering us, but stays
      // responsive enough that a fresh finish appears within an hour.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
