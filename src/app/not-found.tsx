/**
 * 404 page - shown when no route matches.
 *
 * Stays inside the root layout so the disclaimer + dark theme still
 * render. Includes a back-to-dashboard CTA so the user doesn't get
 * stranded.
 */
import Link from "next/link";
import { TrendingDown, Compass, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4 py-10">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <TrendingDown className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Compass className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm">Page not found</span>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          404
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or may have
          moved. Head back to the dashboard to continue.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Dashboard
        </Link>
      </div>
      <p className="mt-12 text-[11px] leading-relaxed text-muted-foreground">
        Not financial advice. Trading forex involves substantial risk of loss.
      </p>
    </div>
  );
}
