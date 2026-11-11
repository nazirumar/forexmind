import { Calculator } from "lucide-react";
import { Placeholder } from "@/components/layout/placeholder";

export const metadata = { title: "Risk Calculator - ForexMind" };

export default function RiskCalculatorPage() {
  return (
    <Placeholder
      title="Risk Calculator"
      description="Compute position size, pip value, risk-reward and break-even win rate from your account balance, pair, entry, SL and TP."
      icon={<Calculator className="h-5 w-5" />}
      phase="Phase 3"
    />
  );
}
