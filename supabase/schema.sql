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
