/**
 * Server-only data-access for the Trade Plan Coach.
 *
 *  - savePlan(): write a plan + its rule results + AI observations.
 *  - listPlans(): get the user's recent plans (newest first).
 *  - getPlan(): get a single plan by id.
 *  - updatePlanStatus(): change a plan's status (and optionally link a trade).
 *
 * All require an authenticated session. RLS scopes every query to the
 * calling user.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserOrThrow } from "@/lib/auth";
import type { ResolvedPlan } from "@/lib/plan/rules";
import type {
  PlanListItem,
  PlanVerdict,
  RuleResult,
} from "@/lib/plan/schema";

// ---------------------------------------------------------------------------
// Row shapes from Supabase
// ---------------------------------------------------------------------------

/** Raw row as returned by Supabase from trade_plans. */
export interface PlanRow {
  id: string;
  user_id: string;
  pair: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  account_balance: number | null;
  risk_pct: number | null;
  lot_size: number | null;
  notes: string | null;
  rule_results: RuleResult[] | unknown;
  ai_observations: string[] | null;
  verdict: PlanVerdict;
  status: "planned" | "taken" | "skipped" | "expired";
  trade_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// savePlan
// ---------------------------------------------------------------------------

/**
 * Insert a new trade_plan row. Returns the row id, or null if the
 * insert failed (the user still gets their evaluation either way;
 * a save failure is non-fatal — same pattern as the checker).
 */
export async function savePlan(args: {
  plan: ResolvedPlan;
  verdict: PlanVerdict;
  rules: RuleResult[];
  aiObservations: string[] | null;
}): Promise<string | null> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trade_plans")
    .insert({
      user_id: user.id,
      pair: args.plan.pair,
      direction: args.plan.direction,
      entry_price: args.plan.entry_price,
      stop_loss: args.plan.stop_loss,
      take_profit: args.plan.take_profit,
      account_balance: args.plan.account_balance,
      risk_pct: args.plan.risk_pct,
      lot_size: args.plan.lot_size,
      notes: args.plan.notes,
      rule_results: args.rules,
      ai_observations: args.aiObservations,
      verdict: args.verdict,
      status: "planned",
    })
    .select("id")
    .single();

  if (error) {
    console.warn(
      "[plan] savePlan failed for user",
      user.id,
      ":",
      error.message,
    );
    return null;
  }
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// listPlans
// ---------------------------------------------------------------------------

/**
 * Get the user's N most recent plans. Returns [] on failure.
 *
 * We don't trust the JSON column types from Supabase — we coerce
 * rule_results + ai_observations defensively before parsing into
 * PlanListItem.
 */
export async function listPlans(limit = 20): Promise<PlanListItem[]> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trade_plans")
    .select(
      "id, pair, direction, entry_price, stop_loss, take_profit, " +
        "verdict, status, trade_id, created_at, rule_results, notes",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error || !data) {
    console.warn(
      "[plan] listPlans failed for user",
      user.id,
      ":",
      error?.message,
    );
    return [];
  }
  return (data as unknown as PlanRow[])
    .map(parseListItem)
    .filter((p): p is PlanListItem => p !== null);
}

function parseListItem(row: PlanRow): PlanListItem | null {
  try {
    const rules = Array.isArray(row.rule_results)
      ? (row.rule_results as RuleResult[])
      : [];
    const failedRules = rules.filter(
      (r) => !r.passed && r.severity === "high",
    ).length;

    const notes = (row.notes ?? "").trim();
    const summary =
      notes.length > 0
        ? notes.length > 100
          ? notes.slice(0, 100) + "..."
          : notes
        : `${row.pair} ${row.direction} @ ${row.entry_price}`;

    return {
      id: row.id,
      pair: row.pair,
      direction: row.direction,
      entry_price: row.entry_price,
      stop_loss: row.stop_loss,
      take_profit: row.take_profit,
      verdict: row.verdict,
      status: row.status,
      trade_id: row.trade_id,
      created_at: row.created_at,
      failed_rules: failedRules,
      summary,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// getPlan
// ---------------------------------------------------------------------------

/**
 * Get a single plan by id. Returns the full row, or null if not found
 * (RLS guarantees we only see the calling user's rows).
 */
export async function getPlan(id: string): Promise<PlanRow | null> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trade_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    console.warn("[plan] getPlan failed:", error?.message);
    return null;
  }
  return data as unknown as PlanRow;
}

// ---------------------------------------------------------------------------
// updatePlanStatus
// ---------------------------------------------------------------------------

export interface PlanStatusUpdate {
  status?: "planned" | "taken" | "skipped" | "expired";
  trade_id?: string | null;
}

/**
 * Update a plan's status. Used when the user marks a plan as
 * "taken" (optionally linking the resulting trade_id), "skipped",
 * or "expired".
 *
 * Returns the updated row, or null on failure / not-found.
 */
export async function updatePlanStatus(
  id: string,
  update: PlanStatusUpdate,
): Promise<PlanRow | null> {
  const user = await getUserOrThrow();
  const supabase = await createSupabaseServerClient();

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (update.status != null) patch.status = update.status;
  if (update.trade_id !== undefined) patch.trade_id = update.trade_id;

  const { data, error } = await supabase
    .from("trade_plans")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    console.warn("[plan] updatePlanStatus failed:", error?.message);
    return null;
  }
  return data as unknown as PlanRow;
}
