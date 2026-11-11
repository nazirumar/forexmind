import type { Metadata } from "next";
import { Suspense } from "react";
import { RiskCalculatorClient } from "@/components/risk/risk-calculator-client";

export const metadata: Metadata = { title: "Risk Calculator - ForexMind" };

// Suspense boundary is required because RiskCalculatorClient uses
// useSearchParams() to read the ?pair= query param. Next.js 16 wraps
// useSearchParams in a Suspense boundary so the page can be statically
// rendered; without this wrapper the build fails with a clear error.
export default function RiskCalculatorPage() {
  return (
    <Suspense fallback={null}>
      <RiskCalculatorClient />
    </Suspense>
  );
}
