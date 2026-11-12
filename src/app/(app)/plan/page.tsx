import { PlanCoachClient } from "@/components/plan/plan-coach-client";
import { NewsRiskBanner } from "@/components/calendar/news-risk-banner";

export const metadata = { title: "Trade Plan Coach - ForexMind" };

export default function PlanPage() {
  return (
    <>
      <NewsRiskBanner />
      <PlanCoachClient />
    </>
  );
}
