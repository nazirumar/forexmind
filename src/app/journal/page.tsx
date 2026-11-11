import { BookOpen } from "lucide-react";
import { Placeholder } from "@/components/layout/placeholder";

export const metadata = { title: "Trade Journal - ForexMind" };

export default function JournalPage() {
  return (
    <Placeholder
      title="Trade Journal"
      description="Log trades, review stats (win rate, profit factor, equity curve) and surface behavioral patterns."
      icon={<BookOpen className="h-5 w-5" />}
      phase="Phase 5"
    />
  );
}
