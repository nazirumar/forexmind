/**
 * Server-only data-access for the Trade Plan Coach (Neon Postgres via Prisma).
 *
 *  - savePlan(): write a plan + its rule results + AI observations.
 *  - listPlans(): get the user's recent plans (newest first).
 *  - getPlan(): get a single plan by id.
 *  - updatePlanStatus(): change a plan's status (and optionally link a trade).
 *
 * All require an authenticated session. There is no RLS anymore (that
 * was a Supabase feature), so EVERY query explicitly filters by
 * userId. This is the new isolation boundary - never drop it.
 *
 * The rest of the app consumes the snake_case PlanRow shape; Prisma
 * generates camelCase fields + Date objects. `toPlanRow` maps between
 * them so callers don't change.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserOrThrow } from "@/lib/auth";
import type { ResolvedPlan } from "@/lib/plan/rules";
import type {
  PlanListItem,
  PlanVerdict,
  RuleResult,
} from "@/lib/plan/schema";

// ---------------------------------------------------------------------------
// Row shapes (snake_case, as consumed by the rest of the app)
// ---------------------------------------------------------------------------

/** Raw row shape returned by this module. Maps Prisma camelCase → snake_case
 *  with ISO strings for the DateTime columns. rule_results + ai_observations
 *  are Json columns in Prisma and pass through as-is. */
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

/**
 * Inferred Prisma TradePlan type. Using `ReturnType<typeof ...>` avoids
 * importing the model type from the (not-yet-re-exporting) db module,
 * so this file only depends on `db` itself.
 */
type PrismaTradePlan = Awaited<
  ReturnType<typeof db.tradePlan.findFirstOrThrow>
>;

/**
 * Map a Prisma TradePlan (camelCase + Date objects) to the snake_case
 * PlanRow shape the rest of the app expects (ISO strings for dates).
 *
 * Prisma stores `direction`, `verdict` and `status` as plain Strings (no
 * DB enums), so we narrow them back to their union types here. The
 * Json columns (ruleResults / aiObservations) pass through untouched.
 */
function toPlanRow(p: PrismaTradePlan): PlanRow {
  return {
    id: p.id,
    user_id: p.userId,
    pair: p.pair,
    direction: p.direction as "buy" | "sell",
    entry_price: p.entryPrice,
    stop_loss: p.stopLoss,
    take_profit: p.takeProfit,
    account_balance: p.accountBalance,
    risk_pct: p.riskPct,
    lot_size: p.lotSize,
    notes: p.notes,
    rule_results: p.ruleResults,
    ai_observations: (p.aiObservations as string[] | null) ?? null,
    verdict: p.verdict as PlanVerdict,
    status: p.status as "planned" | "taken" | "skipped" | "expired",
    trade_id: p.tradeId,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
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
  try {
    const created = await db.tradePlan.create({
      data: {
        userId: user.id,
        pair: args.plan.pair,
        direction: args.plan.direction,
        entryPrice: args.plan.entry_price,
        stopLoss: args.plan.stop_loss,
        takeProfit: args.plan.take_profit,
        accountBalance: args.plan.account_balance,
        riskPct: args.plan.risk_pct,
        lotSize: args.plan.lot_size,
        notes: args.plan.notes,
        ruleResults: args.rules,
        // Prisma's nullable Json column rejects a plain `null`; use
        // Prisma.DbNull to store SQL NULL (matches the old Supabase
        // behaviour of writing NULL when there are no observations).
        aiObservations:
          args.aiObservations === null ? Prisma.DbNull : args.aiObservations,
        verdict: args.verdict,
        status: "planned",
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    console.warn(
      "[plan] savePlan failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// listPlans
// ---------------------------------------------------------------------------

/**
 * Get the user's N most recent plans. Returns [] on failure.
 *
 * We select only the columns the list needs and map Prisma camelCase →
 * the snake_case shape parseListItem expects. rule_results is a Json
 * column; we coerce it defensively before parsing into PlanListItem.
 */
export async function listPlans(limit = 20): Promise<PlanListItem[]> {
  const user = await getUserOrThrow();
  try {
    const rows = await db.tradePlan.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, limit)),
      select: {
        id: true,
        pair: true,
        direction: true,
        entryPrice: true,
        stopLoss: true,
        takeProfit: true,
        verdict: true,
        status: true,
        tradeId: true,
        createdAt: true,
        ruleResults: true,
        notes: true,
      },
    });
    return rows
      .map((r) =>
        parseListItem({
          id: r.id,
          pair: r.pair,
          direction: r.direction as "buy" | "sell",
          entry_price: r.entryPrice,
          stop_loss: r.stopLoss,
          take_profit: r.takeProfit,
          verdict: r.verdict as PlanVerdict,
          status: r.status as "planned" | "taken" | "skipped" | "expired",
          trade_id: r.tradeId,
          created_at: r.createdAt.toISOString(),
          rule_results: r.ruleResults,
          notes: r.notes,
        }),
      )
      .filter((p): p is PlanListItem => p !== null);
  } catch (err) {
    console.warn(
      "[plan] listPlans failed for user",
      user.id,
      ":",
      errMessage(err),
    );
    return [];
  }
}

/**
 * Structural input for parseListItem — the subset of PlanRow that the
 * list view actually needs. PlanRow satisfies this structurally, so a
 * full PlanRow can be passed too, but listPlans only selects + maps
 * these fields.
 */
interface ListItemRow {
  id: string;
  pair: string;
  direction: "buy" | "sell";
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  verdict: PlanVerdict;
  status: "planned" | "taken" | "skipped" | "expired";
  trade_id: string | null;
  created_at: string;
  rule_results: RuleResult[] | unknown;
  notes: string | null;
}

function parseListItem(row: ListItemRow): PlanListItem | null {
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
 * (the userId filter guarantees isolation — a request for another
 * user's plan returns null without leaking existence).
 */
export async function getPlan(id: string): Promise<PlanRow | null> {
  const user = await getUserOrThrow();
  let plan: PrismaTradePlan | null;
  try {
    plan = await db.tradePlan.findFirst({ where: { id, userId: user.id } });
  } catch (err) {
    console.warn("[plan] getPlan failed:", errMessage(err));
    return null;
  }
  if (!plan) return null;
  return toPlanRow(plan);
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

  // Ownership check first (no RLS anymore): a request for another
  // user's plan returns null without leaking existence.
  let existing: PrismaTradePlan | null;
  try {
    existing = await db.tradePlan.findFirst({
      where: { id, userId: user.id },
    });
  } catch (err) {
    console.warn("[plan] updatePlanStatus failed:", errMessage(err));
    return null;
  }
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (update.status != null) data.status = update.status;
  if (update.trade_id !== undefined) data.tradeId = update.trade_id;

  // Nothing to update (the route handler validates non-empty, but be
  // safe): return the existing row as-is.
  if (Object.keys(data).length === 0) {
    return toPlanRow(existing);
  }

  try {
    // `updatedAt` is `@updatedAt` in Prisma — auto-managed on update.
    const updated = await db.tradePlan.update({ where: { id }, data });
    return toPlanRow(updated);
  } catch (err) {
    // P2025 = record not found (e.g. deleted between findFirst & update).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return null;
    }
    console.warn("[plan] updatePlanStatus failed:", errMessage(err));
    return null;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
