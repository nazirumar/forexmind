-- ============================================================
-- ForexMind schema - run in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)
--
-- Idempotent-ish: tables are created if not exists; policies are
-- dropped and recreated so the script can be re-run safely.
-- ============================================================

-- ------------------------------------------------------------
-- Table: trades (user trade journal)
-- ------------------------------------------------------------
create table if not exists public.trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  pair          text not null,
  direction     text not null check (direction in ('buy', 'sell')),
  entry_price   numeric not null,
  exit_price    numeric,
  stop_loss     numeric not null,
  take_profit   numeric,
  lot_size      numeric not null,
  opened_at     timestamptz not null,
  closed_at     timestamptz,
  pnl           numeric,
  strategy      text,
  session       text check (session in ('asian', 'london', 'newyork', 'overlap')),
  emotion       text,
  followed_plan boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

comment on table public.trades is
  'ForexMind trade journal. One row per logged trade, scoped to a user via user_id.';

-- ------------------------------------------------------------
-- Table: ai_analyses (saved AI outputs)
-- ------------------------------------------------------------
create table if not exists public.ai_analyses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  type          text not null,
  input_summary text,
  output        text not null,
  created_at    timestamptz not null default now()
);

comment on table public.ai_analyses is
  'Saved AI analyses (journal analysis, market brief, trade check). `type` distinguishes them.';

-- ------------------------------------------------------------
-- Table: profiles (user preferences + trading defaults)
-- Phase 16: one row per user, keyed by user_id.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  display_name     text,
  default_balance  numeric,
  default_risk_pct numeric check (default_risk_pct is null or (default_risk_pct >= 0 and default_risk_pct <= 100)),
  preferred_session text check (preferred_session in ('asian', 'london', 'newyork', 'overlap')),
  default_pair     text,
  updated_at       timestamptz not null default now()
);

comment on table public.profiles is
  'ForexMind user profile: display name + default trading parameters. One row per user.';

-- Helpful indexes for the queries ForexMind runs (last N trades per user).
create index if not exists trades_user_created_idx
  on public.trades (user_id, created_at desc);

create index if not exists ai_analyses_user_type_created_idx
  on public.ai_analyses (user_id, type, created_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.trades      enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.profiles    enable row level security;

-- ---------------- trades policies ----------------
drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own"
  on public.trades for select
  using (auth.uid () = user_id);

drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own"
  on public.trades for insert
  with check (auth.uid () = user_id);

drop policy if exists "trades_update_own" on public.trades;
create policy "trades_update_own"
  on public.trades for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "trades_delete_own" on public.trades;
create policy "trades_delete_own"
  on public.trades for delete
  using (auth.uid () = user_id);

-- ---------------- ai_analyses policies ----------------
drop policy if exists "ai_analyses_select_own" on public.ai_analyses;
create policy "ai_analyses_select_own"
  on public.ai_analyses for select
  using (auth.uid () = user_id);

drop policy if exists "ai_analyses_insert_own" on public.ai_analyses;
create policy "ai_analyses_insert_own"
  on public.ai_analyses for insert
  with check (auth.uid () = user_id);

drop policy if exists "ai_analyses_update_own" on public.ai_analyses;
create policy "ai_analyses_update_own"
  on public.ai_analyses for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "ai_analyses_delete_own" on public.ai_analyses;
create policy "ai_analyses_delete_own"
  on public.ai_analyses for delete
  using (auth.uid () = user_id);

-- ---------------- profiles policies ----------------
-- A user can only read/update their own profile row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid () = user_id);

drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own"
  on public.profiles for insert
  with check (auth.uid () = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  using (auth.uid () = user_id);

-- ============================================================
-- Phase 17: trade_plans
-- ============================================================
-- Stores pre-trade plans evaluated by the AI Trade Plan Coach.
--
-- One row per pre-trade plan. The user submits a structured setup
-- (pair, direction, entry, SL, TP, optional account balance + risk %
-- + lot size + notes). The server runs DETERMINISTIC rule checks
-- (max risk %, min R:R, SL placement) using the user's profile
-- defaults, then asks Groq for 2-3 neutral observations. The
-- deterministic results + AI observations are stored together so
-- the user can revisit a plan later.
--
-- Status lifecycle:
--  - planned  : freshly saved, no decision made
--  - taken    : user logged a trade that matches this plan
--               (linked via trade_id)
--  - skipped  : user decided not to take it
--  - expired  : plan is older than 24h and was never resolved
--
-- RLS: a user can only see / mutate their own plans.
-- ------------------------------------------------------------

create table if not exists public.trade_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  pair            text not null,
  direction       text not null check (direction in ('buy', 'sell')),
  entry_price     numeric not null,
  stop_loss       numeric not null,
  take_profit     numeric,
  account_balance numeric,
  risk_pct        numeric,
  lot_size        numeric,
  notes           text,
  -- Deterministic rule results (JSON array of {rule, passed, detail})
  rule_results    jsonb not null default '[]'::jsonb,
  -- AI observations (JSON array of strings, or null if AI was skipped)
  ai_observations jsonb,
  -- Verdict derived from rule_results: "pass" | "fail" | "review"
  verdict         text not null check (verdict in ('pass', 'fail', 'review')),
  status          text not null default 'planned'
                  check (status in ('planned', 'taken', 'skipped', 'expired')),
  trade_id        uuid references public.trades (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.trade_plans is
  'ForexMind pre-trade plans. One row per evaluated setup. Deterministic rule results + AI observations are stored together for later review.';

create index if not exists trade_plans_user_created_idx
  on public.trade_plans (user_id, created_at desc);

create index if not exists trade_plans_user_status_idx
  on public.trade_plans (user_id, status, created_at desc);

-- ---------------- RLS ----------------
alter table public.trade_plans enable row level security;

drop policy if exists "trade_plans_select_own" on public.trade_plans;
create policy "trade_plans_select_own"
  on public.trade_plans for select
  using (auth.uid () = user_id);

drop policy if exists "trade_plans_insert_own" on public.trade_plans;
create policy "trade_plans_insert_own"
  on public.trade_plans for insert
  with check (auth.uid () = user_id);

drop policy if exists "trade_plans_update_own" on public.trade_plans;
create policy "trade_plans_update_own"
  on public.trade_plans for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "trade_plans_delete_own" on public.trade_plans;
create policy "trade_plans_delete_own"
  on public.trade_plans for delete
  using (auth.uid () = user_id);

-- ============================================================
-- Phase 18: trade tags + multi-filter analytics
-- ============================================================
-- Adds a `tags` array column to public.trades so users can label
-- each trade with arbitrary keywords (setup name, market condition,
-- mistake type, etc.). The tags power a new tag-breakdown analytics
-- card and a multi-filter bar in the journal UI.
--
-- Storage: text[] (Postgres native array). Empty array is the
-- default for rows created before this migration (the `COALESCE`
-- pattern in queries keeps older code working without a backfill).
--
-- Search: a GIN index on `tags` makes `tags ? 'foo'` (array contains)
-- cheap, which is what the /api/trades filter uses.
--
-- Constraints enforced in app code (zod), not at the DB level, to
-- keep the migration trivial:
--  - max 10 tags per trade
--  - max 30 chars per tag
--  - lowercased, trimmed, deduped
--  - allowed chars: letters, digits, dash, underscore (slug-style)
-- ============================================================

alter table public.trades
  add column if not exists tags text[] not null default '{}';

comment on column public.trades.tags is
  'User-defined labels for this trade (e.g. "breakout", "fomc", "revenge"). Empty array when untagged.';

-- GIN index for "array contains" lookups: WHERE tags ? 'breakout'.
-- `using gin` with the operator class `array_ops` (the default for
-- text[]) supports both `?` (contains-element) and `@>` (contains-array).
create index if not exists trades_tags_gin_idx
  on public.trades using gin (tags);

-- Also a composite index for the common "filter by tag, newest first"
-- journal query. The GIN above handles the tag predicate; this btree
-- handles the order-by-created_at within a user.
create index if not exists trades_user_tag_created_idx
  on public.trades (user_id, created_at desc) where array_length(tags, 1) is not null;

-- ============================================================
-- Phase 20: trading_goals
-- ============================================================
-- One row per user (upsert on first save). Stores the user's
-- self-imposed discipline rules. The pure rules engine in
-- src/lib/goals/rules.ts evaluates recent trades against these
-- goals and returns a list of violations (with dates), which the
-- /goals page surfaces as a "discipline report".
--
-- All fields are nullable so a user can enable only the rules they
-- care about. NULL means "this rule is not enforced".
-- ============================================================

create table if not exists public.trading_goals (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  max_trades_per_day   integer check (max_trades_per_day between 1 and 50),
  max_daily_loss_pct   numeric check (max_daily_loss_pct between 0 and 100),
  min_rr_target        numeric check (min_rr_target between 0 and 100),
  max_consecutive_losses integer check (max_consecutive_losses between 1 and 20),
  require_followed_plan boolean not null default false,
  updated_at           timestamptz not null default now()
);

comment on table public.trading_goals is
  'Per-user trading discipline goals. At most one row per user. NULL fields mean "rule not enforced".';

drop policy if exists "goals_select_own" on public.trading_goals;
create policy "goals_select_own"
  on public.trading_goals for select
  using (auth.uid () = user_id);

drop policy if exists "goals_upsert_own" on public.trading_goals;
create policy "goals_upsert_own"
  on public.trading_goals for insert
  with check (auth.uid () = user_id);

drop policy if exists "goals_update_own" on public.trading_goals;
create policy "goals_update_own"
  on public.trading_goals for update
  using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

drop policy if exists "goals_delete_own" on public.trading_goals;
create policy "goals_delete_own"
  on public.trading_goals for delete
  using (auth.uid () = user_id);

-- ============================================================
-- Phase 22: watchlist + price_alerts
-- ============================================================

create table if not exists public.watchlist (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  pair       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, pair)
);

comment on table public.watchlist is
  'Per-user watched pairs. One row per (user, pair). Drives the /watchlist page.';

create index if not exists watchlist_user_idx
  on public.watchlist (user_id, created_at desc);

create table if not exists public.price_alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  pair         text not null,
  -- "above": trigger when rate >= threshold
  -- "below": trigger when rate <= threshold
  direction    text not null check (direction in ('above', 'below')),
  threshold    numeric not null check (threshold > 0),
  active       boolean not null default true,
  triggered_at timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.price_alerts is
  'Per-user price alerts. direction "above" fires when rate >= threshold; "below" fires when rate <= threshold.';

create index if not exists price_alerts_user_active_idx
  on public.price_alerts (user_id, active);

create index if not exists price_alerts_pair_active_idx
  on public.price_alerts (pair, active);

-- RLS for watchlist
drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own"
  on public.watchlist for select using (auth.uid () = user_id);
drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own"
  on public.watchlist for insert with check (auth.uid () = user_id);
drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own"
  on public.watchlist for delete using (auth.uid () = user_id);

-- RLS for price_alerts
drop policy if exists "alerts_select_own" on public.price_alerts;
create policy "alerts_select_own"
  on public.price_alerts for select using (auth.uid () = user_id);
drop policy if exists "alerts_insert_own" on public.price_alerts;
create policy "alerts_insert_own"
  on public.price_alerts for insert with check (auth.uid () = user_id);
drop policy if exists "alerts_delete_own" on public.price_alerts;
create policy "alerts_delete_own"
  on public.price_alerts for delete using (auth.uid () = user_id);
drop policy if exists "alerts_update_own" on public.price_alerts;
create policy "alerts_update_own"
  on public.price_alerts for update
  using (auth.uid () = user_id) with check (auth.uid () = user_id);
