-- ============================================================
-- ForexMind risk-management + psychology + exposure migration
--
-- Additive: uses `add column if not exists` so it is safe to run on
-- a database that already has the base schema (supabase/schema.sql).
-- Run in the Supabase SQL editor once.
--
-- Adds to public.trades:
--  - risk_amount     : planned risk in account currency ($)
--  - risk_pct        : risk as % of account balance (1.0 = 1%)
--  - account_balance : balance at trade-open time (for R-equity curve)
--  - r_multiple      : realized R = pnl / risk_amount (computed app-side)
--  - timeframe       : chart timeframe (M1..W1)
--  - mistake_type    : self-tagged execution mistake
--  - screenshot_url  : before chart screenshot (Supabase Storage)
--  - screenshot_after_url : after chart screenshot
--
-- Also creates the `trade-screenshots` Storage bucket + RLS policies.
-- ============================================================

-- ---------------- risk / psychology columns ----------------
alter table public.trades
  add column if not exists risk_amount numeric;
alter table public.trades
  add column if not exists risk_pct numeric
    check (risk_pct is null or (risk_pct >= 0 and risk_pct <= 100));
alter table public.trades
  add column if not exists account_balance numeric
    check (account_balance is null or account_balance >= 0);
alter table public.trades
  add column if not exists r_multiple numeric;
alter table public.trades
  add column if not exists timeframe text
    check (timeframe is null or timeframe in
      ('M1','M5','M15','M30','H1','H4','D1','W1'));
alter table public.trades
  add column if not exists mistake_type text
    check (mistake_type is null or mistake_type in
      ('none','moved_stop','oversized','chased_entry',
       'early_exit','late_entry','revenge','no_stop'));
alter table public.trades
  add column if not exists screenshot_url text;
alter table public.trades
  add column if not exists screenshot_after_url text;

comment on column public.trades.risk_amount is
  'Planned risk in account currency if SL is hit. NULL when not recorded.';
comment on column public.trades.r_multiple is
  'Realized R-multiple = pnl / risk_amount. Computed app-side on close. NULL when risk_amount unknown.';

-- Index for the risk-report's "closed trades with r_multiple" query.
create index if not exists trades_user_risk_closed_idx
  on public.trades (user_id, closed_at desc)
  where r_multiple is not null;

-- ---------------- Storage bucket: trade-screenshots ----------------
-- One bucket per user is impractical; we use a single public bucket
-- and enforce isolation via Storage RLS policies keyed on the path
-- prefix `user_id/...`. The browser client uploads to a path that
-- starts with its own auth.uid() so the policy matches.
insert into storage.buckets (id, name, public)
  values ('trade-screenshots', 'trade-screenshots', true)
  on conflict (id) do nothing;

-- SELECT: anyone can read (public bucket) - screenshots are referenced
-- by URL in the journal; keeping them public avoids signed-URL churn.
-- (They contain chart screenshots, not PII.)
drop policy if exists "screenshots_public_read" on storage.objects;
create policy "screenshots_public_read"
  on storage.objects for select
  using (bucket_id = 'trade-screenshots');

-- INSERT: a user can only upload into a path starting with their uid.
drop policy if exists "screenshots_insert_own" on storage.objects;
create policy "screenshots_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE / DELETE: only the owner of the path prefix.
drop policy if exists "screenshots_update_own" on storage.objects;
create policy "screenshots_update_own"
  on storage.objects for update
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "screenshots_delete_own" on storage.objects;
create policy "screenshots_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
