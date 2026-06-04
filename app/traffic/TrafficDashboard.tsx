"use client";

/**
 * TrafficDashboard.tsx
 *
 * Performance approach:
 *   1. Fetch + aggregateVisits() runs once after mount — single O(n) pass.
 *   2. Chart reads from the pre-built day×bot matrix.
 *   3. Legend toggle flips a Set<BotName> in state; Recharts hides/shows
 *      an already-computed Bar series — O(numDays × numBots ≈ 630).
 *   4. Date-range filter slices the matrix by index, also O(days).
 *   No raw row re-scanning happens after the initial aggregation.
 */

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AiVisit, BotName } from "@/lib/types";
import { BOT_NAMES } from "@/lib/types";
import { sliceByDays } from "@/lib/aggregateVisits";
import type { AggregatedVisitData } from "@/lib/aggregateVisits";
import { BOT_COLORS, BOT_META } from "@/lib/colorMap";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LoadState = "loading" | "error" | "empty" | "loaded";
type DateRange = 7 | 30 | 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTotal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatYAxis(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function ChartSkeleton() {
  return (
    <div className="min-h-[380px] animate-pulse rounded-lg bg-gray-100" />
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-gray-100" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || !label) return null;

  // label is the dateKey "YYYY-MM-DD"; convert to readable form
  const dateLabel = new Date(label + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const entries = payload.filter((p) => p.value > 0);
  const total = entries.reduce((s, p) => s + p.value, 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[180px]">
      <div className="font-semibold text-gray-800 mb-1.5">{dateLabel}</div>
      {entries.map((entry) => (
        <div key={entry.name} className="flex items-center gap-1.5 py-0.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-gray-600 flex-1">{entry.name}</span>
          <span className="font-medium text-gray-800 tabular-nums">{entry.value.toLocaleString()}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-gray-100 pt-1.5 font-semibold text-gray-800 flex justify-between">
        <span>Total</span>
        <span className="tabular-nums">{total.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend strip
// ---------------------------------------------------------------------------

interface LegendStripProps {
  botOrder: BotName[];
  hiddenBots: Set<BotName>;
  onToggle: (bot: BotName) => void;
}

function LegendStrip({ botOrder, hiddenBots, onToggle }: LegendStripProps) {
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {botOrder.map((bot) => {
        const isHidden = hiddenBots.has(bot);
        return (
          <button
            key={bot}
            type="button"
            onClick={() => onToggle(bot)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-opacity
              ${isHidden
                ? "border-gray-200 bg-white text-gray-400 opacity-40"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
              style={{ background: BOT_COLORS[bot] }}
            />
            {bot}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Pages panel
// ---------------------------------------------------------------------------

interface TopPagesProps {
  pageTotals: Record<string, number>;
}

function TopPages({ pageTotals }: TopPagesProps) {
  const rows = useMemo(() => {
    return Object.entries(pageTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [pageTotals]);

  const maxCount = rows[0]?.[1] ?? 1;

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No pages to show.</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map(([path, count]) => (
        <div key={path} className="relative overflow-hidden rounded px-3 py-2">
          {/* Background fill bar */}
          <div
            className="absolute inset-y-0 left-0 rounded bg-blue-50"
            style={{ width: `${(count / maxCount) * 100}%` }}
          />
          <div className="relative flex items-center justify-between gap-4">
            <span className="truncate font-mono text-xs text-gray-700" title={path}>
              {path}
            </span>
            <span className="flex-shrink-0 tabular-nums text-xs font-medium text-gray-600">
              {count.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Crawlers panel
// ---------------------------------------------------------------------------

interface TopCrawlersProps {
  botTotals: Record<BotName, number>;
  botOrder: BotName[];
}

function TopCrawlers({ botTotals, botOrder }: TopCrawlersProps) {
  const rows = botOrder.filter((b) => botTotals[b] > 0).slice(0, 8);
  const maxCount = botTotals[rows[0]] ?? 1;

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No crawlers to show.</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map((bot) => {
        const count = botTotals[bot];
        const meta = BOT_META[bot];
        return (
          <div key={bot} className="relative overflow-hidden rounded px-3 py-2">
            {/* Background fill bar */}
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${(count / maxCount) * 100}%`,
                background: BOT_COLORS[bot] + "18",
              }}
            />
            <div className="relative flex items-center gap-3">
              {/* Colored initial circle */}
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: BOT_COLORS[bot] }}
              >
                {meta.initial}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-gray-700">
                  {meta.displayName}{" "}
                  <span className="font-normal text-gray-400">({meta.parent})</span>
                </span>
              </div>
              <span className="flex-shrink-0 tabular-nums text-xs font-medium text-gray-600">
                {count.toLocaleString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function TrafficDashboard() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [fullData, setFullData] = useState<AggregatedVisitData | null>(null);
  const [hiddenBots, setHiddenBots] = useState<Set<BotName>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>(90);

  // Fetch + aggregate on mount (once)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/visits.json");
        if (!res.ok) throw new Error("fetch failed");
        const visits: AiVisit[] = await res.json();
        if (cancelled) return;
        if (visits.length === 0) {
          setLoadState("empty");
          return;
        }
        
        // 2. Offload initial aggregation to Web Worker (stretch goal)
        const worker = new Worker(new URL("../../lib/aggregation.worker.ts", import.meta.url));
        worker.postMessage(visits);
        
        worker.onmessage = (e) => {
          if (cancelled) {
            worker.terminate();
            return;
          }
          setFullData(e.data);
          setLoadState("loaded");
          worker.terminate();
        };
        
        worker.onerror = () => {
          if (!cancelled) setLoadState("error");
          worker.terminate();
        };
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Slice by date range — O(days), no raw re-scan
  const data = useMemo(() => {
    if (!fullData) return null;
    return sliceByDays(fullData, dateRange);
  }, [fullData, dateRange]);

  // Bot order: sorted by total descending (stable across all bars)
  const botOrder = useMemo<BotName[]>(() => {
    if (!data) return [];
    return [...BOT_NAMES].sort((a, b) => data.botTotals[b] - data.botTotals[a]);
  }, [data]);

  // X-axis tick interval
  const tickInterval = useMemo(() => {
    if (!data) return 6;
    return Math.max(1, Math.floor(data.matrix.length / 12));
  }, [data]);

  const toggleBot = useCallback((bot: BotName) => {
    setHiddenBots((prev) => {
      const next = new Set(prev);
      if (next.has(bot)) next.delete(bot);
      else next.add(bot);
      return next;
    });
  }, []);

  const allHidden = botOrder.length > 0 && hiddenBots.size === botOrder.length;

  // Retry handler
  function handleRetry() {
    setLoadState("loading");
    setFullData(null);
    // Re-trigger effect by key — simplest approach is a page reload signal
    window.location.reload();
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI Traffic</h1>
          {loadState === "loaded" && data ? (
            <p className="mt-0.5 text-sm text-gray-500">
              {formatTotal(data.summary.total)} visits from{" "}
              {data.summary.botCount} bots across{" "}
              {data.summary.pageCount} pages, last {dateRange} days
            </p>
          ) : (
        <p className="mt-0.5 text-sm text-gray-400">—</p>
          )}
        </div>
        {/* Date range filter */}
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          {([7, 30, 90] as DateRange[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDateRange(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors
                ${dateRange === d
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-700"
                }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart region — overflow-x:auto on <640px per spec */}
      <div className="overflow-x-auto sm:overflow-x-visible">
        <div
          style={{ minWidth: "480px" }}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          {loadState === "loading" ? (
            <>
              <div className="mb-4 flex gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-7 w-28 animate-pulse rounded-full bg-gray-100" />
                ))}
              </div>
              <ChartSkeleton />
            </>
          ) : loadState === "error" ? (
            <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50">
              <p className="text-sm font-medium text-gray-700">Couldn&apos;t load traffic data.</p>
              <p className="text-sm text-gray-500">Try refreshing the page.</p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-1 rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : loadState === "empty" ? (
            <div className="flex min-h-[380px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50">
              <p className="text-sm font-medium text-gray-700">No AI traffic yet.</p>
              <p className="text-sm text-gray-500">Once AI crawlers visit your site, you&apos;ll see them here.</p>
            </div>
          ) : (
            <>
              <LegendStrip botOrder={botOrder} hiddenBots={hiddenBots} onToggle={toggleBot} />
              {allHidden ? (
                <div className="flex min-h-[380px] max-h-[600px] items-center justify-center text-sm text-gray-500">
                  All bots hidden. Click a legend item to show data.
                </div>
              ) : (
                <div className="min-h-[380px] max-h-[600px]">
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart
                      data={data?.matrix ?? []}
                      margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
                      barCategoryGap="10%"
                    >
                      <XAxis
                        dataKey="dateKey"
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickLine={false}
                        axisLine={false}
                        interval={tickInterval}
                        tickFormatter={(v: string) => {
                          const d = new Date(v + "T00:00:00Z");
                          return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
                        }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatYAxis}
                        width={36}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f3f4f6" }} />
                      {/* Render bars in botOrder (largest total at bottom → first in stack) */}
                      {botOrder
                        .filter((bot) => !hiddenBots.has(bot))
                        .map((bot) => (
                          <Bar
                            key={bot}
                            dataKey={`counts.${bot}`}
                            name={bot}
                            stackId="stack"
                            fill={BOT_COLORS[bot]}
                            maxBarSize={24}
                            isAnimationActive={false}
                          />
                        ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Pages */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Top Pages</h2>
          {loadState === "loading" ? (
            <TableSkeleton />
          ) : (
            <TopPages pageTotals={data?.pageTotals ?? {}} />
          )}
        </div>

        {/* Top Crawlers */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Top Crawlers</h2>
          {loadState === "loading" ? (
            <TableSkeleton />
          ) : (
            <TopCrawlers botTotals={data?.botTotals ?? ({} as Record<BotName, number>)} botOrder={botOrder} />
          )}
        </div>
      </div>
    </div>
  );
}
