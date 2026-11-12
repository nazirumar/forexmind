"use client";

/**
 * Shared email+password auth form for /login and /signup.
 *
 * Posts to /api/auth/login or /api/auth/signup (Neon-backed session
 * auth). On success the server sets the httpOnly session cookie and
 * we hard-navigate to "/" so server components pick up the session.
 *
 * Validation: zod client-side (instant feedback); the server
 * re-validates and is the source of truth.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { TrendingDown, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters."),
});

type FieldErrors = Partial<Record<"email" | "password", string>>;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

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
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/signup";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }
      // Success -> full navigation so server components see the cookie.
      window.location.href = "/";
    } catch (err) {
      setFormError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error - please try again.",
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

      <form onSubmit={onSubmit} noValidate className="space-y-4">
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
    </div>
  );
}
