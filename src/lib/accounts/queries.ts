/**
 * Account queries (server-only).
 *
 * Multi-account support, feature 4. Key behaviors:
 *
 *  - Lazy default: `ensureDefaultAccount()` creates a "Main account"
 *    for any user who doesn't have one and backfills their unassigned
 *    trades to it. Called from listAccounts and the trade-create
 *    paths, so every pre-multi-account user is migrated on first touch
 *    with no one-off script.
 *  - Selection: the chosen account lives in the `forexmind_account`
 *    cookie (set by POST /api/accounts/select). `getSelectedAccountId`
 *    reads it, verifies ownership, and returns null (= all accounts)
 *    when absent/invalid. Trade queries filter on it when set.
 *
 * Every query is scoped by userId — never trust the cookie's account
 * id without re-checking ownership.
 */
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  accountCreateSchema,
  accountRowSchema,
  DEFAULT_ACCOUNT_NAME,
  type AccountRow,
} from "@/lib/accounts/schema";

/** Cookie that stores the selected account id ("all accounts" when absent). */
export const ACCOUNT_COOKIE = "forexmind_account";

export class AccountError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountError";
    this.status = status;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Ensure the user has at least one account; create "Main account" and
 * backfill their unassigned trades otherwise. Idempotent and safe to
 * call on every request (one cheap findMany when settled).
 */
export async function ensureDefaultAccount(userId: string) {
  const existing = await db.account.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const created = await db.account.create({
    data: { userId, name: DEFAULT_ACCOUNT_NAME, kind: "live" },
  });
  // Backfill: every trade created before multi-account support has
  // accountId = null. Assign them to the new default account.
  await db.trade.updateMany({
    where: { userId, accountId: null },
    data: { accountId: created.id },
  });
  return created;
}

function toAccountRow(
  a: { id: string; userId: string; name: string; kind: string; createdAt: Date },
  tradeCount: number,
): AccountRow {
  return accountRowSchema.parse({
    id: a.id,
    user_id: a.userId,
    name: a.name,
    kind: a.kind as AccountRow["kind"],
    trade_count: tradeCount,
    created_at: a.createdAt.toISOString(),
  });
}

/** List the user's accounts (oldest first), ensuring the default exists. */
export async function listAccounts(userId: string): Promise<AccountRow[]> {
  try {
    await ensureDefaultAccount(userId);
    const rows = await db.account.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { trades: true } } },
    });
    return rows.map((r) => toAccountRow(r, r._count.trades));
  } catch (err) {
    throw new AccountError(500, `Failed to list accounts: ${errMessage(err)}`);
  }
}

/** Create an additional account for the user. Input is validated here. */
export async function createAccount(userId: string, input: unknown): Promise<AccountRow> {
  const parsed = accountCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new AccountError(400, parsed.error.issues[0]?.message ?? "Invalid account.");
  }
  try {
    const created = await db.account.create({
      data: { userId, name: parsed.data.name, kind: parsed.data.kind },
    });
    return toAccountRow(created, 0);
  } catch (err) {
    // P2002 = unique violation on (userId, name).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw new AccountError(409, "You already have an account with that name.");
    }
    throw new AccountError(500, `Failed to create account: ${errMessage(err)}`);
  }
}

/**
 * Delete an account. Rejected when it still has trades — move or
 * delete those first. The default account can be deleted too (a new
 * one is re-created lazily), as long as it's empty.
 */
export async function deleteAccount(userId: string, id: string): Promise<void> {
  try {
    const owned = await db.account.findFirst({ where: { id, userId } });
    if (!owned) throw new AccountError(404, "Account not found.");

    const tradeCount = await db.trade.count({ where: { accountId: id, userId } });
    if (tradeCount > 0) {
      throw new AccountError(
        409,
        `This account still has ${tradeCount} trade${tradeCount === 1 ? "" : "s"}. Delete or move them first.`,
      );
    }

    await db.account.delete({ where: { id } });
  } catch (err) {
    if (err instanceof AccountError) throw err;
    throw new AccountError(500, `Failed to delete account: ${errMessage(err)}`);
  }
}

/**
 * The account id the user has selected (cookie), verified against the
 * DB. Returns null when:
 *  - no cookie is set (view = all accounts), or
 *  - the cookie points at a deleted/foreign account.
 *
 * Callers must treat null as "no account filter".
 */
export async function getSelectedAccountId(userId: string): Promise<string | null> {
  try {
    const store = await cookies();
    const id = store.get(ACCOUNT_COOKIE)?.value;
    if (!id) return null;
    const owned = await db.account.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    return owned?.id ?? null;
  } catch {
    // No request scope (e.g. a background job) or a cookie read
    // failure -> fall back to unfiltered.
    return null;
  }
}

/**
 * The account id new trades should be stamped with: the selected
 * account, or the user's default account when "all accounts" is
 * active. Never null for a valid user.
 */
export async function resolveTradeAccountId(userId: string): Promise<string> {
  const selected = await getSelectedAccountId(userId);
  if (selected) return selected;
  const def = await ensureDefaultAccount(userId);
  return def.id;
}
