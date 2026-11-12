"use client";

/**
 * User email + sign-out control for the navigation.
 *
 * Reads the session with the browser Supabase client (no secrets).
 * Graceful states:
 *  - Supabase not configured (preview): renders nothing.
 *  - Signed out: renders a compact "Sign in" link (shouldn't happen
 *    behind the middleware guard, but harmless).
 *  - Signed in: shows the email (truncated) and a sign-out button.
 *
 * Sign-out clears the session and does a full navigation to /login so
 * every server component re-renders without the stale session.
 */
import { useEffect, useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UserMenu({ className }: { className?: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // Already "not ready" (initial state); render nothing below.
      return;
    }
    let active = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setEmail(data.user?.email ?? null);
        // Fetch the profile to show display_name when set (Phase 16).
        // Non-fatal: on failure we just show the email.
        return fetch("/api/profile")
          .then((r) => (r.ok ? r.json() : null))
          .then((profile) => {
            if (active && profile?.display_name) {
              setDisplayName(profile.display_name);
            }
          })
          .catch(() => {
            // Ignore - show email instead.
          });
      })
      .catch(() => {
        if (active) setEmail(null);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Not configured in this environment: hide entirely.
  if (!isSupabaseConfigured() || !ready) return null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      // Full reload so server components see the cleared session.
      window.location.href = "/login";
    } catch {
      setSigningOut(false);
    }
  };

  if (!email) {
    return (
      <a
        href="/login"
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        Sign in
      </a>
    );
  }

  // Show display_name when set; fall back to email. The title tooltip
  // always shows the email so the user can still see which account
  // they're on.
  const label = displayName ?? email ?? "";

  return (
    <div className={cn("flex items-center justify-between gap-2 min-w-0", className)}>
      <span
        className="truncate text-xs text-muted-foreground"
        title={email}
        aria-label={`Signed in as ${displayName ?? email}`}
      >
        {label}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={signOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="h-8 shrink-0 px-2 text-muted-foreground hover:text-foreground"
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="hidden lg:inline ml-1">Sign out</span>
      </Button>
    </div>
  );
}
