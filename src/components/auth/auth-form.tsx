"use client";

/**
 * Shared email+password auth form for /login and /signup.
 *
 * Validation: zod client-side (instant feedback) - the server does not
 * trust this anyway, Supabase enforces its own rules.
 *
 * Error handling: friendly messages for the common Supabase auth
 * errors ("Invalid login credentials", rate limits, etc.), plus a
 * clear notice when Supabase itself is not configured (e.g. preview
 * environments without real env vars).
 *
 * Signup behavior: if email confirmation is ON in the Supabase
 * dashboard, signUp() returns no session and we show a
 * "check your email" state instead of redirecting.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { TrendingDown, Loader2, MailCheck, AlertTriangle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters."),
});

type FieldErrors = Partial<Record<"email" | "password", string>>;

/** Translate raw Supabase auth errors into friendly copy. */
function friendlyAuthError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes("invalid login credentials")) {
    return "Incorrect email or password. Please try again.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email first. Check your inbox for the confirmation link.";
  }
  if (msg.includes("user already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (msg.includes("password should be at least")) {
    return "Password is too short. It must be at least 8 characters.";
  }
  if (msg.includes("unable to validate email") || msg.includes("invalid email")) {
    return "That email address doesn't look valid.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "Network error - couldn't reach the authentication service. Check your connection.";
  }
  return raw || "Something went wrong. Please try again.";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // e.g. "check your email"
  const [submitting, setSubmitting] = useState(false);

  const configured = isSupabaseConfigured();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) {
      setFormError(
        "Supabase is not configured in this environment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
      );
      return;
    }

    setFormError(null);
    setInfo(null);

    // Client-side validation with zod.
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) {
          setFormError(friendlyAuthError(error.message));
          return;
        }
        // Success -> go to dashboard. Full refresh so server
        // components pick up the new session cookie.
        window.location.href = "/";
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) {
          setFormError(friendlyAuthError(error.message));
          return;
        }
        if (!data.session) {
          // Email confirmation is enabled - no session yet.
          setInfo(
            "Account created! Check your email for a confirmation link, then sign in.",
          );
          setPassword("");
        } else {
          // Confirmation disabled - session granted immediately.
          window.location.href = "/";
        }
      }
    } catch (err) {
      setFormError(
        err instanceof Error
          ? friendlyAuthError(err.message)
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      {/* Brand */}
      <div className="flex items-center gap-2 mb-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingDown className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">
            {isLogin ? "Sign in to ForexMind" : "Create your ForexMind account"}
          </h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {isLogin
              ? "Welcome back - your journal awaits."
              : "Track trades, review stats, check ideas."}
          </p>
        </div>
      </div>

      {/* "Check your email" success state (signup + confirmation ON) */}
      {info ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200"
        >
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>{info}</p>
            <p className="text-xs opacity-80">
              Didn&apos;t get it? Check spam, or wait a minute and sign up
              again.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center text-xs font-medium underline underline-offset-2 hover:opacity-90"
            >
              Go to sign in
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {/* Supabase not configured notice */}
          {!configured && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Preview environment: Supabase is not configured, so sign-in is
                disabled here. Set real values in <code>.env.local</code> to
                enable it.
              </span>
            </div>
          )}

          {/* Server / auth error */}
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              disabled={submitting}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-destructive">
                {fieldErrors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={isLogin ? "Your password" : "At least 8 characters"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              disabled={submitting}
            />
            {fieldErrors.password && (
              <p id="password-error" className="text-xs text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Submit */}
          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
            aria-label={isLogin ? "Sign in" : "Create account"}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {isLogin ? "Signing in..." : "Creating account..."}
              </>
            ) : isLogin ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </Button>

          {/* Mode switch */}
          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                No account yet?{" "}
                <Link
                  href="/signup"
                  className="font-medium text-foreground underline underline-offset-2 hover:opacity-90"
                >
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-medium text-foreground underline underline-offset-2 hover:opacity-90"
                >
                  Sign in
                </Link>
              </>
            )}
          </p>
        </form>
      )}
    </div>
  );
}
