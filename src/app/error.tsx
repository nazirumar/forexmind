"use client";

/**
 * Root error.tsx - shown when a Server Component at the root level
 * throws (above the (app) / (auth) route groups). This boundary
 * DOES keep the root <html><body> shell intact, so it can render
 * Tailwind classes + globals.css.
 */
import { useEffect } from "react";
import { AlertTriangle, RotateCw, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4 py-10">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingDown className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Your data is safe - please try again.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            error id: {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={reset}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1">Try again</span>
          </Button>
          <Button asChild variant="outline">
            <a href="/">Back to Dashboard</a>
          </Button>
        </div>
        <p className="mt-10 text-[11px] leading-relaxed text-muted-foreground">
          Not financial advice. Trading forex involves substantial risk of
          loss.
        </p>
      </div>
    </div>
  );
}
