"use client";

/**
 * Weekly Digest panel - shown in the journal page.
 *
 * A button generates a digest for the last 7 days. The response
 * includes the deterministic patterns (always shown) + the AI's
 * summary / insights / question (when Groq is configured).
 */
import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertTriangle, Lightbulb, HelpCircle, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DigestResponse } from "@/lib/journal/schema";

export function WeeklyDigestPanel() {
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<DigestResponse | null>(null);
  /** True when the digest came from the scheduled sweep, not a click. */
  const [scheduled, setScheduled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read-back: surface the latest SAVED digest on load. This is how
  // scheduled reviews (run by /api/cron/weekly-review) reach you —
  // they're generated while you're away and shown here automatically.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/journal/digest");
        if (!res.ok) return;
        const body = (await res.json()) as { digest: DigestResponse | null };
        if (!cancelled && body.digest) {
          setDigest(body.digest);
          setScheduled(true);
        }
      } catch {
        // Silent: the panel stays empty, the button still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/journal/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data: DigestResponse = await res.json();
      setDigest(data);
      setScheduled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate digest.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Weekly digest
          </CardTitle>
          <Button size="sm" onClick={() => void generate()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {digest ? "Regenerate" : "Generate"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Analyzes your last 7 days. Patterns are computed deterministically;
          the AI synthesizes them into a summary.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {digest && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              {scheduled && (
                <Badge className="bg-primary/15 text-primary">
                  <CalendarClock className="mr-1 h-3 w-3" />
                  Scheduled review
                </Badge>
              )}
              <Badge variant="outline">
                {new Date(digest.window_start).toLocaleDateString()} -{" "}
                {new Date(digest.window_end).toLocaleDateString()}
              </Badge>
              <Badge variant="outline">{digest.analyzed_count} trades</Badge>
              {!digest.has_enough_data && (
                <Badge className="bg-amber-500 text-black">
                  Fewer than 3 trades - limited
                </Badge>
              )}
            </div>

            {digest.summary && (
              <div className="text-sm leading-relaxed">{digest.summary}</div>
            )}

            {digest.insights.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Insights
                </div>
                {digest.insights.map((insight, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5 text-xs"
                  >
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    {insight}
                  </div>
                ))}
              </div>
            )}

            {digest.question && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
                <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{digest.question}</span>
              </div>
            )}

            {digest.patterns.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Detected patterns ({digest.patterns.length})
                </summary>
                <ul className="mt-2 space-y-1 pl-2 text-xs text-muted-foreground">
                  {digest.patterns.map((p, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                      {p.statement}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {!digest && !error && !loading && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No review yet. Click Generate, or wait for the scheduled weekly
            review to appear here automatically.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
