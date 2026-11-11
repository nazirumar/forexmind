import { Newspaper } from "lucide-react";
import { Placeholder } from "@/components/layout/placeholder";

export const metadata = { title: "Market News - ForexMind" };

export default function NewsPage() {
  return (
    <Placeholder
      title="Market News"
      description="Forex headlines from Finnhub, an economic calendar, and an AI market brief that summarizes drivers and risks for your watchlist."
      icon={<Newspaper className="h-5 w-5" />}
      phase="Phase 7"
    />
  );
}
