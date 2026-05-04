import { getFeedItems } from "@/lib/feed";
import { SITE_AUTHOR, SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getFeedItems(SITE_URL);

  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: "ook — finished books",
    description: "What I've read, in the order I finished it.",
    home_page_url: `${SITE_URL}/`,
    feed_url: `${SITE_URL}/feed.json`,
    authors: [{ name: SITE_AUTHOR }],
    language: "en",
    items: items.map((item) => ({
      id: item.url,
      url: item.url,
      title: item.title,
      content_text: item.summary,
      summary: item.summary,
      date_published: item.publishedAt,
      image: item.book.cover ?? undefined,
      tags: item.book.tags.length > 0 ? item.book.tags : undefined,
    })),
  };

  return Response.json(feed, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
