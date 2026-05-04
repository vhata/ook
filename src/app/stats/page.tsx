import { redirect } from "next/navigation";
import { getStatsYears } from "@/lib/books";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Stats",
};

// Index `/stats` lands the visitor on the most-recent year that has any
// reading activity. If no books have ever been read, fall back to the
// current calendar year so the empty-state page still renders something.
export default async function StatsIndex() {
  const years = await getStatsYears();
  const target = years[0] ?? new Date().getFullYear();
  redirect(`/stats/${target}`);
}
