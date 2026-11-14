import { BarChart3 } from "lucide-react";

/**
 * Shared empty / signed-out / error state for /analytics. Kept as a
 * separate component so the page stays readable.
 */
export function SignInPrompt({ error }: { error?: string }) {
  return (
    <div className="card-surface border-dashed p-10 text-center">
      <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <h1 className="mt-3 text-base font-semibold">
        {error ? "Analytics unavailable" : "Sign in to see your analytics"}
      </h1>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {error ??
          "Performance breakdown is per-user: it slices your private journal by session, strategy, pair and emotion."}
      </p>
    </div>
  );
}
