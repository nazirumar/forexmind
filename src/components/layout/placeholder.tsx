/**
 * Placeholder used by tool pages that are not yet implemented in the
 * current build phase. Shows a clear "coming in phase X" message and
 * a back-to-dashboard link, instead of a confusing blank page.
 */
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ArrowLeft, Hammer } from "lucide-react";

type PlaceholderProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  phase?: string;
};

export function Placeholder({ title, description, icon, phase }: PlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} icon={icon} />
      <div className="mt-10 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Hammer className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-medium">Coming soon</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {phase
            ? `This tool ships in ${phase}. The scaffold, navigation and shared libraries are ready now.`
            : `This tool is part of an upcoming build phase.`}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Dashboard
        </Link>
      </div>
    </>
  );
}
