"use client";

/**
 * Verdict panel - renders the structured AI verdict.
 *
 * The verdict is a rule-compliance verdict, NOT a trade
 * recommendation. We make that distinction visually explicit:
 *  - The verdict color (emerald/amber/rose) signals rule compliance.
 *  - The summary blurb always ends with "The decision is still yours."
 *
 * This component is also pure-presentational; the parent owns the
 * fetch state.
 */
import { AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  verdictMeta,
  severityMeta,
  type CheckVerdict,
  type Violation,
} from "@/lib/checker/schema";
import { cn } from "@/lib/utils";

type Props = {
  verdict: CheckVerdict;
  hasJournalContext: boolean;
  analysisId: string | null;
};

const COLOR_CLASSES: Record<
  "emerald" | "amber" | "rose" | "slate",
  { text: string; bg: string; border: string; chip: string }
> = {
  emerald: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    chip: "bg-emerald-600 text-white",
  },
  amber: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    chip: "bg-amber-500 text-black",
  },
  rose: {
    text: "text-rose-500",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    chip: "bg-rose-600 text-white",
  },
  slate: {
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
    chip: "bg-muted text-foreground",
  },
};

export function VerdictPanel({ verdict, hasJournalContext, analysisId }: Props) {
  const meta = verdictMeta(verdict.verdict);
  const c = COLOR_CLASSES[meta.color];

  return (
    <Card className={cn("border", c.border, c.bg)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {verdict.verdict === "ok_to_proceed" ? (
              <CheckCircle2 className={cn("h-5 w-5", c.text)} aria-hidden="true" />
            ) : verdict.verdict === "review" ? (
              <Info className={cn("h-5 w-5", c.text)} aria-hidden="true" />
            ) : (
              <XCircle className={cn("h-5 w-5", c.text)} aria-hidden="true" />
            )}
            <CardTitle className="text-base">{meta.label}</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                c.chip,
              )}
            >
              {verdict.verdict.replace(/_/g, " ").toUpperCase()}
            </span>
            {!hasJournalContext && (
              <span className="text-[10px] text-muted-foreground">
                weak journal context
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{meta.blurb}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary */}
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Summary
          </h4>
          <p className="text-sm leading-relaxed">{verdict.summary}</p>
        </div>

        {/* Violations */}
        {verdict.violations.length > 0 && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Rule violations ({verdict.violations.length})
            </h4>
            <ul className="space-y-2">
              {verdict.violations.map((v, i) => (
                <ViolationItem key={i} violation={v} />
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {verdict.warnings.length > 0 && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Warnings
            </h4>
            <ul className="space-y-1">
              {verdict.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Strengths */}
        {verdict.strengths.length > 0 && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Strengths
            </h4>
            <ul className="space-y-1">
              {verdict.strengths.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-emerald-300"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Reminders */}
        {verdict.reminders.length > 0 && (
          <div className={cn("rounded-md border p-3", c.border, c.bg)}>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Risk reminders
            </h4>
            <ul className="space-y-1">
              {verdict.reminders.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed text-foreground/80">
                  · {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Saved indicator */}
        {analysisId && (
          <p className="text-[10px] text-muted-foreground">
            Analysis saved to your history (id: {analysisId.slice(0, 8)}…).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ViolationItem({ violation }: { violation: Violation }) {
  const meta = severityMeta(violation.severity);
  const c = COLOR_CLASSES[meta.color];
  return (
    <li className={cn("rounded-md border p-2.5", c.border, c.bg)}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-medium">{violation.rule}</span>
        <Badge
          variant="outline"
          className={cn("text-[10px] font-mono py-0", c.text, c.border)}
        >
          {meta.label}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{violation.detail}</p>
    </li>
  );
}
