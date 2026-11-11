"use client";

/**
 * AI Market Brief panel.
 *
 * - "Generate brief" button calls POST /api/news/brief with the
 *   currently-loaded headlines + the user's watchlist.
 * - Renders the markdown response with react-markdown (same renderer
 *   as the chat surface for visual consistency).
 * - Surfaces auth/key errors inline with retry.
 * - No streaming: the brief is short and a single complete response
 *   reads better than token-by-token for a structured document.
 */
import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import type { NewsItem } from "@/lib/news/schema";

type Props = {
  headlines: NewsItem[];
  watchlist: string[];
};

export function MarketBrief({ headlines, watchlist }: Props) {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      // Cap at 15 most-recent headlines to keep the prompt bounded.
      const payload = {
        headlines: headlines.slice(0, 15).map((h) => ({
          source: h.source,
          headline: h.headline,
          summary: h.summary ?? "",
          published_at: h.published_at,
          url: h.url,
        })),
        watchlist,
      };
      const res = await fetch("/api/news/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to generate a market brief.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as { brief: string };
      setBrief(data.brief);
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
            <CardTitle className="text-base">AI Market Brief</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={generate}
            disabled={loading || headlines.length === 0}
            aria-label="Generate market brief"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="ml-1">Generating...</span>
              </>
            ) : brief ? (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Regenerate</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Generate brief</span>
              </>
            )}
          </Button>
        </div>
        {watchlist.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            <span className="text-[11px] text-muted-foreground">Watchlist:</span>
            {watchlist.map((c) => (
              <Badge key={c} variant="secondary" className="text-[10px] py-0 px-1.5">
                {c}
              </Badge>
            ))}
          </div>
        )}
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

        {!brief && !error && !loading && (
          <p className="text-sm text-muted-foreground">
            Click <strong>Generate brief</strong> to summarize the headlines
            below into a structured market brief with drivers and risks. The
            brief is advisory only and never predicts prices.
          </p>
        )}

        {loading && (
          <div className="space-y-2 animate-pulse" aria-label="Brief loading">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="mt-3 h-3 w-1/2 rounded bg-muted/70" />
            <div className="h-3 w-full rounded bg-muted/70" />
            <div className="h-3 w-3/4 rounded bg-muted/70" />
          </div>
        )}

        {brief && !loading && (
          <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>
                ),
                h2: ({ children }) => (
                  <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>
                ),
                h3: ({ children }) => (
                  <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="mb-2 leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>
                ),
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">{children}</strong>
                ),
              }}
            >
              {brief}
            </ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
