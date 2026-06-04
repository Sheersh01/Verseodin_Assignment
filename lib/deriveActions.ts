/**
 * deriveActions.ts
 *
 * Pure function: MonitoringEvent[] → Action[]
 *
 * Architecture: fully table-driven derivation.
 *
 * EXTENSIBILITY: Adding a 5th event type is ONE entry in DERIVATION_RULES.
 * No new functions, no new switch cases, no restructuring.
 * Each rule entry is a self-contained config object with:
 *   - eventType discriminant
 *   - cluster key function (what to group by → one Action per cluster)
 *   - severity function (per-event → severity, then cluster takes max)
 *   - title/description templates
 *   - ActionType mapping
 *   - representative picker (which cluster member to surface in copy)
 *
 * Severity: cluster severity = max severity across member events.
 *
 * Stable ids: FNV-1a hash of sorted source_event_ids (see lib/stableId.ts).
 * Same input events → same ids → localStorage merge survives re-runs.
 *
 * Output cap: 30 highest-severity actions (spec: 15–30).
 */
import type {
  MonitoringEvent,
  Action,
  ActionType,
  Severity,
  CitationMissedEvent,
  CompetitorCitedInsteadEvent,
  RedditCompetitorMentionEvent,
  ArticlePublishedWithCompetitorsEvent,
} from "@/lib/types";
import { stableId } from "@/lib/stableId";

// ---------------------------------------------------------------------------
// Severity helpers — isolated so thresholds are easy to tune
// ---------------------------------------------------------------------------

function redditSeverity(e: RedditCompetitorMentionEvent): Severity {
  if (e.upvotes >= 500 || e.comment_count >= 100) return "high";
  if (e.upvotes >= 100 || e.comment_count >= 30) return "medium";
  return "low";
}

function articleSeverity(e: ArticlePublishedWithCompetitorsEvent): Severity {
  if (e.estimated_monthly_traffic >= 20_000) return "high";
  if (e.estimated_monthly_traffic >= 5_000) return "medium";
  return "low";
}

function citationSeverity(clusterSize: number): Severity {
  if (clusterSize >= 4) return "high";
  if (clusterSize >= 2) return "medium";
  return "low";
}

function competitorCitedSeverity(e: CompetitorCitedInsteadEvent): Severity {
  if (e.position === 1 && e.source_type === "article") return "high";
  if (e.position <= 2) return "medium";
  return "low";
}

// Cluster severity = max severity across all member events
const SEVERITY_RANK: Record<Severity, number> = { high: 2, medium: 1, low: 0 };
function clusterMaxSeverity(severities: Severity[]): Severity {
  return severities.reduce<Severity>(
    (best, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[best] ? s : best),
    "low",
  );
}

// ---------------------------------------------------------------------------
// Rule table — each row is a complete, self-contained derivation config.
// Adding a 5th event type = adding one object to this array.
// ---------------------------------------------------------------------------

type AnyEvent = MonitoringEvent;

interface DerivationRule<T extends AnyEvent> {
  /** Discriminant — matched against event.event_type */
  eventType: T["event_type"];
  /**
   * Cluster key: events with the same key are merged into one Action.
   * Determines cardinality of output (one Action per unique key).
   */
  clusterKey: (e: T) => string;
  /** Per-event severity — cluster takes the max */
  severity: (e: T) => Severity;
  /** ActionType for the Action */
  actionType: (e: T) => ActionType;
  /** Title — receives the whole cluster and the representative event */
  title: (cluster: T[], rep: T) => string;
  /** Description — receives the whole cluster and the representative event */
  description: (cluster: T[], rep: T) => string;
  /**
   * Representative picker — which cluster member to feature in title/description.
   * Defaults to most recent if not specified.
   */
  representative?: (cluster: T[]) => T;
  /** Optional: override severity using the full cluster (ignores per-event severity) */
  clusterSeverity?: (cluster: T[]) => Severity;
  /** Optional: source URL from representative event */
  sourceUrl?: (rep: T) => string | undefined;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const REDDIT_RULE: DerivationRule<RedditCompetitorMentionEvent> = {
  eventType: "reddit_competitor_mention",
  // Cluster by subreddit — one "Engage in r/X" action per subreddit
  clusterKey: (e) => e.subreddit,
  severity: redditSeverity,
  actionType: () => "reddit",
  representative: (cluster) => cluster.reduce((a, b) => (a.upvotes >= b.upvotes ? a : b)),
  title: (cluster, rep) => {
    const competitors = [...new Set(cluster.flatMap((e) => e.competitors_mentioned))];
    const noun = cluster.length === 1 ? "thread" : `${cluster.length} threads`;
    return `Engage in ${rep.subreddit} — ${competitors.slice(0, 2).join(", ")}${competitors.length > 2 ? " + others" : ""} mentioned in ${noun}`;
  },
  description: (cluster, rep) => {
    const competitors = [...new Set(cluster.flatMap((e) => e.competitors_mentioned))];
    return (
      `The most active thread: "${rep.thread_title}" (${rep.upvotes.toLocaleString()} upvotes). ` +
      `${competitors.join(", ")} ${competitors.length > 1 ? "are" : "is"} being cited without you. ` +
      `Joining ${cluster.length > 1 ? "these conversations" : "this conversation"} can earn citations in AI answers sourcing Reddit.`
    );
  },
  sourceUrl: (rep) => rep.thread_url,
};

const ARTICLE_RULE: DerivationRule<ArticlePublishedWithCompetitorsEvent> = {
  eventType: "article_published_with_competitors",
  // Cluster by article URL — deduplicate same article appearing multiple times
  clusterKey: (e) => e.article_url,
  severity: articleSeverity,
  actionType: () => "outreach",
  representative: (cluster) =>
    cluster.reduce((a, b) =>
      a.estimated_monthly_traffic >= b.estimated_monthly_traffic ? a : b,
    ),
  title: (_, rep) => `Pitch ${rep.publication}: "${rep.article_title}"`,
  description: (cluster, rep) => {
    const competitors = [...new Set(cluster.flatMap((e) => e.competitors_cited))];
    return (
      `This article (~${rep.estimated_monthly_traffic.toLocaleString()} monthly visits) cites ${competitors.join(", ")} without mentioning you. ` +
      `Reach out to the author with a data point or case study to request inclusion.`
    );
  },
  sourceUrl: (rep) => rep.article_url,
};

const COMPETITOR_CITED_RULE: DerivationRule<CompetitorCitedInsteadEvent> = {
  eventType: "competitor_cited_instead",
  // Cluster by brand — one action per competitor (across all their source types)
  clusterKey: (e) => e.competitor_brand,
  severity: competitorCitedSeverity,
  actionType: (e) => (e.source_type === "reddit" ? "reddit" : "outreach"),
  representative: (cluster) =>
    cluster.reduce((a, b) => (a.position <= b.position ? a : b)),
  title: (cluster, rep) => {
    const countNote = cluster.length > 1 ? ` (${cluster.length} occurrences)` : "";
    return `${rep.competitor_brand} cited in ${rep.source_type}s${countNote}`;
  },
  description: (_, rep) =>
    `"${rep.source_title}" — ${rep.competitor_brand} appears at position #${rep.position}. ` +
    (rep.source_type === "article"
      ? "Pitch the author to include your product alongside them."
      : rep.source_type === "reddit"
        ? "Engage with these threads to add your perspective."
        : "Consider reaching out about similar content opportunities."),
  sourceUrl: (rep) => rep.source_url,
};

const CITATION_MISSED_RULE: DerivationRule<CitationMissedEvent> = {
  eventType: "citation_missed",
  // Cluster by exact prompt — one "publish a gap article" action per unique prompt
  clusterKey: (e) => e.prompt,
  severity: () => "low", // per-event severity unused — overridden by clusterSeverity below
  clusterSeverity: (cluster) => citationSeverity(cluster.length),
  actionType: () => "content",
  representative: (cluster) =>
    cluster.reduce((a, b) => (a.created_at > b.created_at ? a : b)),
  title: (cluster) => {
    const prompt = cluster[0].prompt;
    return cluster.length > 1
      ? `Publish a page answering "${prompt}" (${cluster.length} missed citations)`
      : `Publish content for "${prompt}"`;
  },
  description: (cluster) => {
    const competitors = [...new Set(cluster.flatMap((e) => e.competitor_brands))];
    const engines = [...new Set(cluster.map((e) => e.engine))];
    return (
      `${competitors.join(", ")} ${competitors.length > 1 ? "are" : "is"} cited for this prompt across ${engines.join(", ")}. ` +
      `Publishing a direct, authoritative answer improves your chance of appearing in AI responses for this query.`
    );
  },
};

/**
 * All derivation rules in one place.
 * To add a 5th event type: append one DerivationRule object here.
 */
const DERIVATION_RULES = [
  REDDIT_RULE,
  ARTICLE_RULE,
  COMPETITOR_CITED_RULE,
  CITATION_MISSED_RULE,
] as const;

// ---------------------------------------------------------------------------
// Generic cluster executor — runs the same logic for every rule
// ---------------------------------------------------------------------------

function runRule<T extends MonitoringEvent>(
  rule: DerivationRule<T>,
  events: T[],
): Action[] {
  // 1. Group events by cluster key
  const clusters = new Map<string, T[]>();
  for (const e of events) {
    const key = rule.clusterKey(e);
    const bucket = clusters.get(key) ?? [];
    bucket.push(e);
    clusters.set(key, bucket);
  }

  // 2. Emit one Action per cluster
  return [...clusters.entries()].map(([, cluster]) => {
    const rep = rule.representative ? rule.representative(cluster) : mostRecent(cluster);
    const memberSeverities = cluster.map(rule.severity);
    const severity = rule.clusterSeverity
      ? rule.clusterSeverity(cluster)
      : clusterMaxSeverity(memberSeverities);
    const sourceIds = cluster.map((e) => e.id);
    const mostRecentDate = mostRecent(cluster).created_at;

    return {
      id: stableId(sourceIds),
      type: rule.actionType(rep),
      severity,
      title: rule.title(cluster, rep),
      description: rule.description(cluster, rep),
      created_at: mostRecentDate,
      source_url: rule.sourceUrl?.(rep),
      source_event_ids: sourceIds,
      status: "active" as const,
    };
  });
}

function mostRecent<T extends { created_at: string }>(items: T[]): T {
  return items.reduce((a, b) => (a.created_at > b.created_at ? a : b));
}

// ---------------------------------------------------------------------------
// Main derivation function
// ---------------------------------------------------------------------------

export function deriveActions(events: MonitoringEvent[]): Action[] {
  // Partition events by type — one Map lookup per event
  const partitions = new Map<string, MonitoringEvent[]>();
  for (const e of events) {
    const bucket = partitions.get(e.event_type) ?? [];
    bucket.push(e);
    partitions.set(e.event_type, bucket);
  }

  // Run each rule against its partition and collect actions
  const actions: Action[] = [];
  for (const rule of DERIVATION_RULES) {
    const partition = (partitions.get(rule.eventType) ?? []) as Parameters<
      typeof runRule<MonitoringEvent>
    >[1];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actions.push(...runRule(rule as DerivationRule<any>, partition));
  }

  // Sort: high → medium → low, then most recent first within same severity
  const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => {
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sd !== 0) return sd;
    return b.created_at.localeCompare(a.created_at);
  });

  // Cap at 30 (spec: 15–30). Deterministic because sort is stable on same input.
  return actions.slice(0, 30);
}
