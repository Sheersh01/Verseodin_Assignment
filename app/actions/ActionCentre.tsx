"use client";

/**
 * ActionCentre.tsx
 *
 * Triage queue: MonitoringEvent[] → deriveActions() → Action cards
 *
 * State design:
 *   - Single `actions` array is the source of truth.
 *   - `filteredActive` / `filteredDismissed` are derived in useMemo.
 *   - Accept/Dismiss mutates the `actions` array and writes to localStorage.
 *   - On load: derive from events, merge persisted statuses, write back.
 *   - Hydration gated: card list doesn't render until `hydrated` is true.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  MessageSquare,
  Mail,
  FileText,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import type { MonitoringEvent, Action, ActionType, Severity, Status } from "@/lib/types";
import { deriveActions } from "@/lib/deriveActions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STORAGE_KEY = "actionCentre.v1";

const TYPE_LABELS: Record<ActionType, string> = {
  reddit: "Reddit",
  outreach: "Outreach",
  content: "Content",
};

const TYPE_ICONS: Record<ActionType, React.ReactNode> = {
  reddit: <MessageSquare className="h-3.5 w-3.5" />,
  outreach: <Mail className="h-3.5 w-3.5" />,
  content: <FileText className="h-3.5 w-3.5" />,
};

const SEVERITY_CONFIG: Record<Severity, { label: string; classes: string }> = {
  high: { label: "High", classes: "bg-red-100 text-red-700" },
  medium: { label: "Medium", classes: "bg-amber-100 text-amber-700" },
  low: { label: "Low", classes: "bg-gray-100 text-gray-600" },
};

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------
type PersistedState = Record<string, Status>; // id → status

function readStorage(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function writeStorage(actions: Action[]): boolean {
  try {
    const state: PersistedState = {};
    for (const a of actions) state[a.id] = a.status;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Relative date label
// ---------------------------------------------------------------------------
function relativeDate(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "today";
  if (diffDays < 2) return "yesterday";
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlanBanner() {
  return (
    <div className="border-b border-gray-200 bg-gray-50 px-6 py-2.5">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between">
        <p className="text-xs text-gray-600">
          You&apos;re on the{" "}
          <span className="font-medium text-gray-800">Explore plan</span>{" "}
          — tracking 10 prompts with ChatGPT only
        </p>
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          See plans
        </button>
      </div>
    </div>
  );
}

interface ActionCardProps {
  action: Action;
  onAccept?: () => void;
  onDismiss?: () => void;
  showStatus?: Status;
}

function ActionCard({ action, onAccept, onDismiss, showStatus }: ActionCardProps) {
  const sev = SEVERITY_CONFIG[action.severity];

  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white p-4">
      {/* Top row: type chip + severity badge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
          {TYPE_ICONS[action.type]}
          {TYPE_LABELS[action.type]}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sev.classes}`}>
          {sev.label}
        </span>
      </div>

      {/* Title + optional source link */}
      <div className="flex items-start gap-1.5">
        <h3 className="line-clamp-3 flex-1 text-sm font-semibold text-gray-900 leading-snug">
          {action.title}
        </h3>
        {action.source_url && (
          <a
            href={action.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
            aria-label="Open source"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Description */}
      <p className="mt-1.5 line-clamp-3 flex-1 text-xs text-gray-500 leading-relaxed">
        {action.description}
      </p>

      {/* Bottom row */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{relativeDate(action.created_at)}</span>

        {showStatus ? (
          // Dismissed tab: show status pill instead of action buttons
          showStatus === "accepted" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              ✓ Accepted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
              ✕ Dismissed
            </span>
          )
        ) : (
          // Active tab: Accept + Dismiss buttons
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 transition-colors"
            >
              Accept
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="min-h-[220px] animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ActionCentre() {
  const [actions, setActions] = useState<Action[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [activeTab, setActiveTab] = useState<"active" | "dismissed">("active");
  const [severityFilter, setSeverityFilter] = useState<"all" | Severity>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ActionType>("all");
  const [lastAction, setLastAction] = useState<{ id: string; text: string; timer: NodeJS.Timeout } | null>(null);

  // Load + derive + merge on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/monitoring-events.json");
        if (!res.ok) throw new Error("fetch failed");
        const events: MonitoringEvent[] = await res.json();
        if (cancelled) return;

        const starter = deriveActions(events);

        // Merge persisted statuses
        const persisted = readStorage();
        const merged = starter.map((a) => ({
          ...a,
          status: persisted?.[a.id] ?? a.status,
        }));

        setActions(merged);

        // Write merged state back
        const ok = writeStorage(merged);
        setStorageOk(ok);
      } catch {
        if (!cancelled) {
          // Still hydrate with empty state rather than crashing
          setActions([]);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Persist on actions change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    const ok = writeStorage(actions);
    if (!ok) setStorageOk(false);
  }, [actions, hydrated]);

  // Derived: all action types present in dataset
  const availableTypes = useMemo<ActionType[]>(() => {
    const types = new Set(actions.map((a) => a.type));
    return (["reddit", "outreach", "content"] as ActionType[]).filter((t) => types.has(t));
  }, [actions]);

  // Apply filters
  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [actions, severityFilter, typeFilter]);

  const filteredActive = useMemo(() => filtered.filter((a) => a.status === "active"), [filtered]);
  const filteredDismissed = useMemo(
    () => filtered.filter((a) => a.status === "accepted" || a.status === "dismissed"),
    [filtered],
  );

  // Unfiltered active count for subtitle
  const activeCount = filteredActive.length;

  // Handle Accept / Dismiss
  const handleAccept = useCallback((id: string) => {
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "accepted" as Status } : a)),
    );
    setLastAction((prev) => {
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => setLastAction(null), 5000);
      return { id, text: "Action accepted", timer };
    });
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "dismissed" as Status } : a)),
    );
    setLastAction((prev) => {
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => setLastAction(null), 5000);
      return { id, text: "Action dismissed", timer };
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (!lastAction) return;
    setActions((prev) =>
      prev.map((a) => (a.id === lastAction.id ? { ...a, status: "active" as Status } : a)),
    );
    clearTimeout(lastAction.timer);
    setLastAction(null);
  }, [lastAction]);

  const handleBulkDismissLow = useCallback(() => {
    setActions((prev) =>
      prev.map((a) =>
        a.status === "active" && a.severity === "low" ? { ...a, status: "dismissed" as Status } : a
      )
    );
  }, []);

  const clearFilters = () => {
    setSeverityFilter("all");
    setTypeFilter("all");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const visibleCards = activeTab === "active" ? filteredActive : filteredDismissed;
  const totalActiveUnfiltered = actions.filter((a) => a.status === "active").length;
  const allDismissed = totalActiveUnfiltered === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <PlanBanner />

      <div className="mx-auto max-w-screen-xl px-6 py-8">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Actions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Prioritized recommendations to improve AI visibility, performance, and coverage.
          </p>
        </div>

        {/* Storage warning */}
        {!storageOk && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Couldn&apos;t save your changes — they won&apos;t persist if you reload.
          </div>
        )}

        {/* Filter row */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            {/* Bulk dismiss low-severity (stretch goal) */}
            {activeTab === "active" && actions.some((a) => a.status === "active" && a.severity === "low") && (
              <button
                type="button"
                onClick={handleBulkDismissLow}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                Dismiss all Low
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600" htmlFor="severity-filter">
              Severity
            </label>
            <div className="relative">
              <select
                id="severity-filter"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as "all" | Severity)}
                className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600" htmlFor="type-filter">
              Action type
            </label>
            <div className="relative">
              <select
                id="type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as "all" | ActionType)}
                className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
          </div>
        </div>

        {/* AI Suggestions header */}
        <div className="mt-6">
          <h2 className="text-base font-semibold text-gray-800">AI Suggestions</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Promptwatch detected{" "}
            <span className="font-medium text-gray-700">
              {activeCount} new {activeCount === 1 ? "action" : "actions"}
            </span>{" "}
            from your recent monitoring data.
          </p>
        </div>

        {/* Tab strip */}
        <div className="mt-4 flex gap-1 border-b border-gray-200">
          {(["active", "dismissed"] as const).map((tab) => {
            const count = tab === "active" ? filteredActive.length : filteredDismissed.length;
            return (
              <button
                key={tab}
                type="button"
                id={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`-mb-px rounded-t-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                  ${activeTab === tab
                    ? "border-b-2 border-gray-900 text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                  }`}
              >
                {tab === "active" ? "Active" : "Dismissed"} ({count})
              </button>
            );
          })}
        </div>

        {/* Card list */}
        <div className="mt-6">
          {/* Undo inline link (stretch goal) */}
          {lastAction && activeTab === "active" && (
            <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm animate-in fade-in slide-in-from-top-2">
              <span className="text-xs text-gray-600">{lastAction.text}.</span>
              <button
                type="button"
                onClick={handleUndo}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                Undo
              </button>
            </div>
          )}

          {!hydrated ? (
            // Loading skeleton — same grid shape as loaded state
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : visibleCards.length === 0 ? (
            // Empty states
            <div className="flex flex-col items-center justify-center py-20 text-center">
              {activeTab === "dismissed" ? (
                <p className="text-sm text-gray-500">Nothing here yet</p>
              ) : allDismissed ? (
                // All items accepted/dismissed — filters don't change this message
                <p className="text-sm text-gray-500">All caught up — no active actions</p>
              ) : (
                // Items exist but filters excluded them all
                <>
                  <p className="text-sm text-gray-700 font-medium">No actions match these filters</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-3 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleCards.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onAccept={activeTab === "active" ? () => handleAccept(action.id) : undefined}
                  onDismiss={activeTab === "active" ? () => handleDismiss(action.id) : undefined}
                  showStatus={activeTab === "dismissed" ? action.status : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
