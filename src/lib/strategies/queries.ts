/**
 * Strategy library queries (server-only).
 *
 * Every query is scoped by userId. Key behaviors:
 *
 *  - Lazy backfill: `ensureStrategyLibrary()` promotes every distinct
 *    trade.strategy text value that has no linked Strategy row into a
 *    library row (so pre-strategy-library users and trades migrate on
 *    first touch, no one-off script).
 *  - resolveStrategyForText(): the trade-create path calls this with
 *    whatever the user typed. It finds (case-insensitive) or creates
 *    the library row and returns its id — this is what keeps the
 *    relation dynamic instead of asking users to pre-register names.
 */
import { db } from "@/lib/db";
import {
  strategyCreateSchema,
  strategyUpdateSchema,
  type StrategyRow,
} from "@/lib/strategies/schema";

export class StrategyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StrategyError";
    this.status = status;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Promote every distinct trade.strategy text value into a Strategy
 * row and link its trades. Idempotent: cheap when settled (one
 * findMany for orphans). Called by listStrategies() so the library
 * modal always shows the user's full history vocabulary.
 */
export async function ensureStrategyLibrary(userId: string): Promise<void> {
  // Trades whose text value has no strategyId link.
  const orphaned = await db.trade.findMany({
    where: { userId, strategy: { not: null }, strategyId: null },
    select: { strategy: true },
    distinct: ["strategy"],
  });

  for (const { strategy } of orphaned) {
    if (!strategy) continue;
    const name = strategy.trim();
    if (name === "") continue;
    const row = await db.strategy.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name },
      update: {},
      select: { id: true },
    });
    await db.trade.updateMany({
      where: { userId, strategy: { equals: name, mode: "insensitive" }, strategyId: null },
      data: { strategyId: row.id },
    });
  }
}

function toStrategyRow(
  s: { id: string; userId: string; name: string; description: string | null; createdAt: Date },
  tradeCount: number,
): StrategyRow {
  return {
    id: s.id,
    user_id: s.userId,
    name: s.name,
    description: s.description,
    trade_count: tradeCount,
    created_at: s.createdAt.toISOString(),
  };
}

/** List the user's strategies (name asc), backfilling legacy text first. */
export async function listStrategies(userId: string): Promise<StrategyRow[]> {
  try {
    await ensureStrategyLibrary(userId);
    const rows = await db.strategy.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      include: { _count: { select: { trades: true } } },
    });
    return rows.map((r) => toStrategyRow(r, r._count.trades));
  } catch (err) {
    throw new StrategyError(500, `Failed to list strategies: ${errMessage(err)}`);
  }
}

/** Create a library entry. 409 when the name already exists. */
export async function createStrategy(
  userId: string,
  input: unknown,
): Promise<StrategyRow> {
  const parsed = strategyCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new StrategyError(400, parsed.error.issues[0]?.message ?? "Invalid strategy.");
  }
  try {
    const created = await db.strategy.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      },
    });
    // Link any trades already logged with this exact name.
    await db.trade.updateMany({
      where: { userId, strategy: { equals: created.name, mode: "insensitive" }, strategyId: null },
      data: { strategyId: created.id },
    });
    const count = await db.trade.count({ where: { strategyId: created.id, userId } });
    return toStrategyRow(created, count);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new StrategyError(409, "You already have a strategy with that name.");
    }
    throw new StrategyError(500, `Failed to create strategy: ${errMessage(err)}`);
  }
}

/** Rename / re-describe a strategy. Trades keep their link via FK. */
export async function updateStrategy(
  userId: string,
  id: string,
  input: unknown,
): Promise<StrategyRow> {
  const parsed = strategyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new StrategyError(400, parsed.error.issues[0]?.message ?? "Invalid strategy.");
  }
  try {
    const owned = await db.strategy.findFirst({ where: { id, userId } });
    if (!owned) throw new StrategyError(404, "Strategy not found.");

    const updated = await db.strategy.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description ?? null }
          : {}),
      },
    });

    // Keep the denormalized text column in sync on linked trades so
    // text-based analytics match the renamed library entry.
    if (parsed.data.name !== undefined) {
      await db.trade.updateMany({
        where: { strategyId: id, userId },
        data: { strategy: parsed.data.name },
      });
    }

    const count = await db.trade.count({ where: { strategyId: id, userId } });
    return toStrategyRow(updated, count);
  } catch (err) {
    if (err instanceof StrategyError) throw err;
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new StrategyError(409, "You already have a strategy with that name.");
    }
    throw new StrategyError(500, `Failed to update strategy: ${errMessage(err)}`);
  }
}

/**
 * Delete a library entry. Trades unlink (strategyId -> null via
 * SetNull) but KEEP their text value, so analytics history survives.
 */
export async function deleteStrategy(userId: string, id: string): Promise<void> {
  try {
    const res = await db.strategy.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new StrategyError(404, "Strategy not found.");
  } catch (err) {
    if (err instanceof StrategyError) throw err;
    throw new StrategyError(500, `Failed to delete strategy: ${errMessage(err)}`);
  }
}

/**
 * Resolve a free-typed strategy name to a library row id (the trade
 * create/update path). Creates the row when the name is new — the
 * library grows as the user journals. Returns null for empty text.
 */
export async function resolveStrategyForText(
  userId: string,
  text: string | null | undefined,
): Promise<string | null> {
  const name = text?.trim();
  if (!name) return null;
  try {
    const existing = await db.strategy.findFirst({
      where: { userId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await db.strategy.create({ data: { userId, name }, select: { id: true } });
    return created.id;
  } catch (err) {
    // P2002 = a concurrent create won the unique race; re-read.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const existing = await db.strategy.findFirst({
        where: { userId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      return existing?.id ?? null;
    }
    console.warn("[strategies] resolveStrategyForText failed:", errMessage(err));
    return null; // Non-fatal: the trade keeps its text, no link.
  }
}
