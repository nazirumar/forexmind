"use client";

/**
 * App-level error.tsx - shown when a Server Component or Route
 * Handler under (app) throws. Catches the error client-side and
 * renders a recovery UI with a "Try again" button (calls the
 * Next.js router's refresh() to re-attempt the failing segment).
 *
 * This is a *recoverable* error boundary - it does NOT catch errors
 * in the root layout.tsx (those need a separate global-error.tsx).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Log to the server-side console for observability. In production
    // you'd forward this to Sentry / Datadog / Vercel's logs.
    console.error("[app error boundary]", error);
  }, [error]);

  const retry = () => {
    reset();
    router.refresh();
  };

  return (
    <div className="py-12">
      <Card className="border-destructive/40 bg-card/60">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-medium">Something went wrong</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            We hit an unexpected error while loading this page. Your data is
            safe - try again, or navigate to another section.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">
              error id: {error.digest}
            </p>
          )}
          <div className="mt-6 flex gap-2">
            <Button onClick={retry} variant="default">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1">Try again</span>
            </Button>
            <Button asChild variant="outline">
              <a href="/">Back to Dashboard</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
