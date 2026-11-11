# Supabase setup for ForexMind

This walks you through creating the Supabase project, loading the
ForexMind schema, and configuring Auth so the app's email/password
sign-in, sign-up, and email-confirmation flow all work end to end.

The code in `src/` already references these env vars:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server-only, never shipped to the browser
```

---

## 1. Create the project

1. Go to <https://supabase.com> and sign in.
2. Click **New project**.
3. Pick an organization, then:
   - **Name**: `forexmind` (or anything you like).
   - **Database password**: generate a strong one and save it in a
     password manager. You do NOT need this password for ForexMind
     itself (the app uses the anon + service-role keys), but you need
     it to access the database directly.
   - **Region**: pick the one closest to most of your users
     (e.g. `Southeast Asia (Singapore)` for APAC, `East US` for NA).
   - **Plan**: Free is fine for development.
4. Click **Create new project** and wait ~2 minutes for it to provision.

---

## 2. Copy the three env vars into `.env.local`

In the Supabase dashboard, go to **Project Settings** (gear icon,
bottom-left) → **API**. You'll see three values. Paste them into
`.env.local` like this:

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...           # "anon public" key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...               # "service_role" key (KEEP SECRET)
```

- `NEXT_PUBLIC_*` values are safe to expose to the browser. Row Level
  Security (see step 4) is what actually protects the data.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must NEVER be referenced
  in a file with `"use client"` or in `next/headers`-only contexts that
  can leak to the client. ForexMind keeps it server-only in
  `src/lib/supabase/server.ts → createSupabaseAdminClient()`.

Restart `bun run dev` after editing `.env.local` so the new values
are picked up.

---

## 3. Load the schema (tables + RLS)

1. In the Supabase dashboard, click **SQL Editor** (left sidebar) →
   **New query**.
2. Open the file `supabase/schema.sql` from this repo, copy the entire
   contents, and paste it into the editor.
3. Click **Run** (Ctrl+Enter). You should see "Success. No rows
   returned."
4. Verify: open **Table Editor** → you should see two tables:
   `trades` and `ai_analyses`, both with the lock icon next to them
   (the lock means RLS is enabled).

The script is idempotent — you can re-run it safely; policies are
dropped and recreated.

---

## 4. Configure Auth

Go to **Authentication** (left sidebar, shield icon) → **Providers** →
**Email**.

### 4a. Email confirmation

You have two options. Pick ONE based on your stage:

- **Development / demo** — turn **OFF** "Confirm email". New sign-ups
  get a session immediately and land on the dashboard. Faster testing.
- **Production** — leave it **ON**. New sign-ups get a confirmation
  email; the link inside points back to your site's
  `/auth/callback` route, which exchanges the code for a session
  (see `src/app/auth/callback/route.ts`).

To toggle: Authentication → **Providers** → **Email** →
"Confirm email" switch. Save.

### 4b. Site URL

**Authentication** → **URL Configuration** → **Site URL**.

This is the URL Supabase redirects to when no explicit redirect is
attached to the auth call. Set it to where you actually run the app:

- Local dev: `http://localhost:3000`
- Production: `https://your-production-domain.com`

### 4c. Redirect URLs

Same screen, **Redirect URLs** section. Add EVERY URL that Supabase is
allowed to send the user back to after a confirmation / magic-link /
reset click. ForexMind uses `/auth/callback` for all of them, so add:

```
http://localhost:3000/auth/callback
https://your-production-domain.com/auth/callback
```

(Add both if you develop locally AND deploy somewhere.)

Click **Save**.

### 4d. (Optional) Email templates

Authentication → **Email Templates** → you can customize the subject
and body of the confirmation / reset / magic-link emails. ForexMind
doesn't depend on a specific template, but a friendlier subject line
helps deliverability.

### 4e. (Optional) Rate limits

Authentication → **Settings** → **Rate Limits**. The free tier defaults
are usually fine. If you get "rate limit exceeded" while testing,
slow down to ~1 sign-up per 30 seconds.

---

## 5. Verify the full flow

After `.env.local` is set and the dev server is restarted:

1. Visit `http://localhost:3000` — the middleware should now ACTIVELY
   redirect you to `/login` (because you're signed out).
2. Click **Sign up**, enter an email + password (8+ chars).
3. Behavior depends on 4a:
   - **Confirmation OFF**: you're redirected to the dashboard
     immediately. The sidebar shows your email and a **Sign out**
     button at the bottom.
   - **Confirmation ON**: you see "Check your email for a confirmation
     link." Click the link in the email → you land on
     `/auth/callback` → the code is exchanged → you're redirected to
     `/`.
4. Sign out → you're sent back to `/login`.

---

## 6. Verify RLS

The fastest sanity check that RLS is working:

1. Sign in as User A, insert a trade via the Trade Journal (Phase 5+)
   or via the SQL editor as User A's JWT.
2. Sign out, sign up as User B (different email).
3. User B opens the Trade Journal → must NOT see User A's trades.
4. In the SQL editor, run:

   ```sql
   select * from public.trades;
   ```

   as the `service_role` (top-right dropdown in SQL editor). You should
   see all rows from all users. Now switch the role to `anon` and
   re-run — you should see zero rows (anon has no rows because anon
   isn't logged in as any user).

---

## 7. Common gotchas

- **"Invalid login credentials" on signup that you know succeeded**:
  email confirmation is ON and you haven't clicked the link yet. Either
  click the link, or turn confirmation off (4a).
- **Confirmation link redirects to a 404**: the Redirect URLs list in
  4c doesn't include `http://localhost:3000/auth/callback`. Add it.
- **Middleware not redirecting**: you still have placeholder Supabase
  values in `.env.local`, so `isSupabaseConfigured()` returns false and
  the guard is skipped on purpose. Set real values (step 2) and restart
  the dev server.
- **`SUPABASE_SERVICE_ROLE_KEY is not set` error**: you imported
  `createSupabaseAdminClient` somewhere user-facing, OR the env var is
  empty. ForexMind's user code should never need the admin client.
