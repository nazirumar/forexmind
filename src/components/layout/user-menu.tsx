"use client";

/**
 * User identity + sign-out control for the navigation.
 *
 * Reads the session via GET /api/auth/me (Neon-backed session auth,
 * no Supabase client). Graceful states:
 *  - Loading / unknown: renders nothing (avoid layout shift).
 *  - Signed out: a compact "Sign in" link.
 *  - Signed in: shows display_name (or email) + a sign-out button.
 *
 * Sign-out POSTs /api/auth/logout to clear the cookie, then
 * hard-navigates to /login so server components drop the session.
 */
import { useEffect, useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Me = { id: string; email: string; displayName?: string | null } | null;

export function UserMenu({ className }: { className?: string }) {
  const [me, setMe] = useState<Me>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        setMe(data?.user ?? null);
        if (data?.user) {
          // Best-effort: show display_name from profile when set.
          return fetch("/api/profile")
            .then((r) => (r.ok ? r.json() : null))
            .then((p) => active && p?.display_name && setProfileName(p.display_name))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setSigningOut(false);
    }
  };

  if (!me) {
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

  const label = profileName ?? me.displayName ?? me.email ?? "";

  return (
    <div className={cn("flex items-center justify-between gap-2 min-w-0", className)}>
      <span
        className="truncate text-xs text-muted-foreground"
        title={me.email}
        aria-label={`Signed in as ${profileName ?? me.displayName ?? me.email}`}
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
