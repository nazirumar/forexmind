import { ShieldCheck } from "lucide-react";
import { Placeholder } from "@/components/layout/placeholder";

export const metadata = { title: "Trade Checker - ForexMind" };

export default function CheckerPage() {
  return (
    <Placeholder
      title="Trade Checker"
      description="Submit a trade idea and let the AI act as a strict risk manager: checks it against your own rules, flags violations, never says 'take this trade'."
      icon={<ShieldCheck className="h-5 w-5" />}
      phase="Phase 8"
    />
  );
}
