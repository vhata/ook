import { redirect } from "next/navigation";
import { getAllBooks } from "@/lib/books";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Random",
};

// Picks a random finished book and redirects to its page. Falls back to
// the home page when nothing's finished yet — better than rendering an
// awkward placeholder for a route that's just supposed to dispatch.
export default async function RandomBook() {
  const books = await getAllBooks();
  const pool = books.filter((b) => b.status === "finished");
  if (pool.length === 0) redirect("/");
  const pick = pool[Math.floor(Math.random() * pool.length)];
  redirect(`/books/${encodeURIComponent(pick.slug)}`);
}
