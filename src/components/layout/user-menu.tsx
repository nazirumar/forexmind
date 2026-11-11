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
        if (active) setEmail(data.user?.email ?? null);
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

  return (
    <div className={cn("flex items-center justify-between gap-2 min-w-0", className)}>
      <span
        className="truncate text-xs text-muted-foreground"
        title={email}
        aria-label={`Signed in as ${email}`}
      >
        {email}
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
