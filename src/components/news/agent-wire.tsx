"use client";

/**
 * AgentWire - the AI-curated news panel on the Market News page.
 *
 * Fetches GET /api/news/curated (scraped RSS + AI agent curation,
 * cached 15 min server-side) and renders curated cards:
 *   - weight badge (forex relevance 0-10)
 *   - source + time-ago + category chip
 *   - AI summary (neutral, one sentence) + original headline
 *   - currency badges + link to the article
 *
 * Advisory-only: the panel footer states summaries are informational,
 * never trade advice. Degrades silently: hidden on 401 (anonymous) or
 * when the endpoint fails, so the regular headline list remains the
 * primary surface.
 */
import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw, ExternalLink, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo, type CuratedNewsItem, type CuratedNewsResponse } from "@/lib/news/schema";
import { cn } from "@/lib/utils";

/** Category -> short human label. */
function categoryLabel(c: string): string {
  switch (c) {
    case "monetary-policy":
      return "Monetary policy";
    case "data":
      return "Economic data";
    case "geopolitics":
      return "Geopolitics";
    case "analysis":
      return "Analysis";
    default:
      return "Markets";
  }
}

export function AgentWire() {
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<CuratedNewsResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setRefreshing(true);
    try {
      const res = await fetch(force ? "/api/news/curated?force=1" : "/api/news/curated");
      if (!res.ok) {
        // 401 (anonymous) / 502 / 503 -> panel hides itself.
        setFailed(true);
        return;
      }
      const json: CuratedNewsResponse = await res.json();
      setData(json);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!loaded && !failed) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Scraping feeds and curating with the AI agent…
        </CardContent>
      </Card>
    );
  }

  if (failed || !data) return null;

  const items = data.items ?? [];

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">AI agent wire</h2>
              <p className="text-xs text-muted-foreground">
                Scraped from public forex feeds, curated by the agent
                {data.updated_at ? ` · updated ${timeAgo(data.updated_at)}` : ""}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1">Rec scrape</span>
          </Button>
        </div>

        {data.note && (
          <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-200">
            {data.note}
          </p>
        )}

        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            The agent judged none of the current headlines relevant to forex. Try a re-scrape shortly.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.slice(0, 12).map((item: CuratedNewsItem) => (
              <li
                key={item.id}
                className="rounded-md border px-3 py-2 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-4 px-1.5 text-[10px]",
                          item.weight >= 7 && "border-primary/50 text-primary",
                        )}
                        title="Forex relevance assigned by the AI agent"
                      >
                        {item.weight}/10
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {item.source} · {timeAgo(item.published_at)} · {categoryLabel(item.category)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{item.ai_summary}</p>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.headline}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                  </div>
                  {item.related?.length > 0 && (
                    <div className="flex shrink-0 gap-1">
                      {item.related.slice(0, 3).map((c) => (
                        <Badge key={c} variant="secondary" className="text-[10px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] text-muted-foreground">
          Summaries are informational only - the agent describes what sources report, never trade
          advice or price predictions.
        </p>
      </CardContent>
    </Card>
  );
}
