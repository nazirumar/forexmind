import type { Metadata } from "next";
import { RiskCalculatorClient } from "@/components/risk/risk-calculator-client";

export const metadata: Metadata = { title: "Risk Calculator - ForexMind" };

export default function RiskCalculatorPage() {
  return <RiskCalculatorClient />;
}
