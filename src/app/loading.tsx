/**
 * Root loading.tsx - shown on the very first paint of any route
 * that doesn't have a more specific loading boundary. Lightweight
 * (no AppShell chrome, because the root layout hasn't finished
 * mounting yet).
 */
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background text-foreground"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading ForexMind...
      </div>
    </div>
  );
}
