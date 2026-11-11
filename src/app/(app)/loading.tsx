/**
 * App-level loading.tsx - shown while a route under (app) is
 * compiling or fetching data for the first time. The spinner sits
 * inside the AppShell layout (sidebar + footer still visible) so the
 * chrome doesn't flash on navigation.
 */
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="flex items-center justify-center py-24 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
      Loading...
    </div>
  );
}
