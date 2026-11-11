"use client";

/**
 * AI Journal Review panel.
 *
 * Triggered by the "AI Review" button on the journal page. Calls
 * POST /api/journal/review, which:
 *  - Fetches the user's N most recent closed trades (server-side)
 *  - Computes the analytics summary
 *  - Sends trades + analytics to Groq with the journal-review system
 *    prompt (advisory only, JSON output, no "you should" commands)
 *  - Parses the JSON verdict with zod
 *  - Saves to ai_analyses (type="journal_review")
 *
 * This component renders:
 *  - A summary paragraph (the model's most striking observation)
 *  - A list of patterns (strengths / weaknesses / neutral observations)
 *  - Reflection questions (open-ended, NOT commands)
 *  - Risk reminders
 *  - "Based on N closed trades" + analysis_id footer
 *
 * No streaming: the review is a one-shot JSON response, and a single
 * complete render reads better than token-by-token for a structured
 * analysis document.
 */
import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, RefreshCw, CheckCircle2, XCircle, Info, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  patternTypeMeta,
  type ReviewResponse,
} from "@/lib/journal/schema";
import { cn } from "@/lib/utils";

type Props = {
  /** Closed trade count - the button is disabled below 5. */
  closedCount: number;
};

const COLOR_CLASSES: Record<
  "emerald" | "rose" | "slate",
  { text: string; bg: string; border: string; chip: string }
> = {
  emerald: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    chip: "bg-emerald-600 text-white",
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

export function JournalReviewPanel({ closedCount }: Props) {
  const [response, setResponse] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReview = closedCount >= 5;

  const runReview = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/journal/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to run a journal review.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
        }
        return;
      }
      const data: ReviewResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error - please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">AI Journal Review</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={runReview}
            disabled={loading || !canReview}
            aria-label="Run AI journal review"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="ml-1">Analyzing...</span>
              </>
            ) : response ? (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Re-run review</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Run review</span>
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {canReview
            ? `Surfaces patterns from your last ${Math.min(closedCount, 20)} closed trades: best/worst pairs, sessions, weekdays, streaks, plan discipline. Advisory only - never a trade recommendation.`
            : `Reviews unlock at 5 closed trades. You have ${closedCount} so far.`}
        </p>
      </CardHeader>

      <CardContent>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive mb-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {!response && !error && !loading && (
          <p className="text-sm text-muted-foreground">
            Click <strong>Run review</strong> to surface patterns in your trading:
            which pairs you trade well, which sessions work, whether you&apos;re
            overtrading or revenge-trading, and how your plan discipline holds up.
            The review never says &quot;you should&quot; or recommends trades -
            it surfaces observations and reflection questions.
          </p>
        )}

        {loading && (
          <div className="space-y-3 animate-pulse" aria-label="Review loading">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
            <div className="mt-3 h-3 w-1/3 rounded bg-muted/70" />
            <div className="h-3 w-full rounded bg-muted/70" />
            <div className="h-3 w-3/4 rounded bg-muted/70" />
          </div>
        )}

        {response && !loading && (
          <ReviewContent response={response} />
        )}
      </CardContent>
    </Card>
  );
}

function ReviewContent({ response }: { response: ReviewResponse }) {
  const v = response.verdict;
  const enough = response.has_enough_data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="outline"
          className={
            v.verdict === "ok_to_proceed"
              ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
              : "border-amber-500/40 text-amber-500 bg-amber-500/10"
          }
        >
          {v.verdict === "ok_to_proceed" ? "Patterns surfaced" : "Needs more data"}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          Based on {response.analyzed_count} closed trade{response.analyzed_count === 1 ? "" : "s"}
          {!enough && " (below the 5-trade threshold)"}
        </span>
      </div>

      {/* Summary */}
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
          Summary
        </h4>
        <p className="text-sm leading-relaxed">{v.summary}</p>
      </div>

      {/* Patterns */}
      {v.patterns.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Patterns ({v.patterns.length})
          </h4>
          <ul className="space-y-2">
            {v.patterns.map((p, i) => {
              const meta = patternTypeMeta(p.type);
              const c = COLOR_CLASSES[meta.color];
              const Icon =
                meta.icon === "check"
                  ? CheckCircle2
                  : meta.icon === "alert"
                    ? XCircle
                    : Info;
              return (
                <li
                  key={i}
                  className={cn("rounded-md border p-3", c.border, c.bg)}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", c.text)} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium">{p.title}</span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] font-mono py-0 shrink-0", c.text, c.border)}
                        >
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {p.detail}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Reflection questions */}
      {v.questions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
            Questions to reflect on
          </h4>
          <ul className="space-y-1.5">
            {v.questions.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-foreground/90"
              >
                <span className="text-muted-foreground mt-0.5 shrink-0">?</span>
                <span className="leading-relaxed">{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reminders */}
      {v.reminders.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-amber-500 mb-1">
            Risk reminders
          </h4>
          <ul className="space-y-1">
            {v.reminders.map((r, i) => (
              <li key={i} className="text-xs leading-relaxed text-foreground/80">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Saved indicator */}
      {response.analysis_id && (
        <p className="text-[10px] text-muted-foreground">
          Review saved to your history (id: {response.analysis_id.slice(0, 8)}…).
          Advisory only - never a trade recommendation.
        </p>
      )}
    </div>
  );
}
