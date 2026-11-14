/**
 * /analytics - performance breakdown by dimension.
 *
 * Server Component: fetches the user's trades once (Prisma-backed,
 * scoped to the authenticated user), then hands them to the client
 * explorer which slices by session / strategy / pair / emotion /
 * mistake type with the pure breakdown() helper. No extra API call.
 */
import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { BreakdownClient } from "@/components/analytics/breakdown-client";
import { getUserOrNull } from "@/lib/auth";
import { fetchUserTrades } from "@/lib/trades/queries";
import type { TradeRow } from "@/lib/trades/schema";
import { SignInPrompt } from "@/components/analytics/sign-in-prompt";

export const metadata: Metadata = {
  title: "Analytics · ForexMind",
  description:
    "Break down your journal by session, strategy, pair, emotion and mistake type.",
};

export default async function AnalyticsPage() {
  const user = await getUserOrNull();
  if (!user) return <SignInPrompt />;

  let trades: TradeRow[] = [];
  try {
    trades = await fetchUserTrades({ limit: 200 });
  } catch (err) {
    console.warn("[analytics] trades query failed:", err);
    return <SignInPrompt error="Could not load your trades. Try refreshing." />;
  }

  if (trades.length === 0) {
    return (
      <div className="card-surface border-dashed p-10 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">No data to analyze yet</h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Log a few trades in the journal — with a session, strategy or
          emotion attached — and your performance breakdown will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Performance breakdown</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where your edge lives — and where it leaks. Sliced from your last{" "}
          {trades.length} journaled trades.
        </p>
      </div>
      <BreakdownClient trades={trades} />
    </div>
  );
}
