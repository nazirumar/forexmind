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
