# Verseodin Trial — Sheersh Saxena

## Setup

Standard scaffold setup. No changes to seed scripts or config.

```bash
git clone <repo-url>
cd verseodin-trial-2026
npm install
npm run seed      # generates public/visits.json + public/monitoring-events.json
npm run dev       # http://localhost:3000
```

> **Note:** On Windows, `tsx` may not be on PATH — `npm run seed` will still work via `npx tsx` which the scaffold uses internally. If it fails, run `npx tsx scripts/seed-visits.ts` and `npx tsx scripts/seed-monitoring.ts` directly.

Routes:
- `/` — index with links to both features
- `/traffic` — AI Traffic Dashboard (Feature 1)
- `/actions` — Action Centre (Feature 2)

---

## What I Built

### Feature 1 — AI Traffic Dashboard (`/traffic`)

Working end-to-end:
- Stacked bar chart: 90 bars (one per day), each stacked by bot, ordered largest-to-smallest so color bands are stable across the timeline.
- **Clickable legend** with toggle: clicking a bot pill hides its series, chart restacks, y-axis rescales. Disabled items show reduced opacity. Toggling all items off shows an inline "All bots hidden" message.
- **Date-range filter**: `7d / 30d / 90d` buttons in the header (default 90d). Slices the pre-built matrix — no raw re-scan.
- **Top Pages** (8 rows): monospace path, right-aligned count, background-fill bar proportional to count vs max.
- **Top Crawlers** (8 rows): colored initial circle (not brand logos), display name + parent, count, background-fill bar.
- **Custom tooltip**: date label, per-bot counts (zero-count bots omitted), bold Total line.
- **Loading skeleton** matching loaded layout shape (legend row + chart area + 2 table panels).
- **Error state** with Retry button. **Empty state** with guidance copy. **All-hidden state** with inline note.
- **Header summary**: `{total} visits from {botCount} bots across {pageCount} pages, last {N} days`.
- **Stretch Goals**:
  - **Date-range filter**: `7d / 30d / 90d` buttons slice the matrix without re-scanning rows.
  - **Web Worker**: Offloaded the initial 100k-row aggregation to a Web Worker (`aggregation.worker.ts`) to ensure zero main-thread blocking on load.
  - **Mobile layout**: `overflow-x-auto` around chart for `<640px` viewports.

### Feature 2 — Action Centre (`/actions`)

Working end-to-end:
- **`deriveActions()`** in `lib/deriveActions.ts`: fully table-driven — `DERIVATION_RULES` array + one generic `runRule()` executor. Adding a 5th event type is one object appended to the array; no new functions, no new switch cases.
- **Stable ids**: FNV-1a hash of sorted `source_event_ids` — deterministic across runs, localStorage merge survives re-seeding.
- **Plan banner** (topmost), page H1 + subtitle, filter row (severity + type dropdowns), section header with `Promptwatch` copy (handles 0/1 grammar), tab strip.
- **Accept / Dismiss**: moves card between tabs instantly, counters update in same render, no toast.
- **localStorage persistence** under `actionCentre.v1`. On reload: derive → merge persisted statuses → write back. Filters reset to All/All.
- **Hydration gate**: card list only renders after `hydrated = true`, preventing empty-then-populated flash.
- **Composable filters**: severity AND type apply together; both tab counts reflect filtered set.
- **Empty states**: "No actions match these filters" + Clear filters vs "All caught up" vs "Nothing here yet".
- **Storage-unavailable fallback**: inline warning, in-memory state continues.
- **Stretch Goals**: All three optional stretch goals for Feature 2 are implemented:
  - **Card source link**: clickable `ExternalLink` icon on cards with `source_url`.
  - **Undo**: inline "Action accepted/dismissed" state with 5-second `Undo` button.
  - **Bulk dismiss**: "Dismiss all Low" button in filter row when low severity items exist.

#### Derivation rules — one paragraph per event type

**`reddit_competitor_mention` → `reddit` type.** Clustered by subreddit (threads in the same community roll up into one "Engage in r/X" action). The representative is the highest-upvote thread. Severity thresholds: `upvotes ≥ 500 OR comment_count ≥ 100` = high; `≥ 100 OR ≥ 30` = medium; otherwise low. Rationale: high-upvote threads are indexed by AI crawlers and cited more frequently; the 500-upvote threshold correlates roughly with "front page of subreddit" reach.

**`article_published_with_competitors` → `outreach` type.** Clustered by article URL (same article appearing multiple times in the seed is deduplicated). Severity by `estimated_monthly_traffic`: `≥ 20,000` = high; `≥ 5,000` = medium; otherwise low. Rationale: traffic is the proxy for how often AI models will have ingested this article; high-traffic articles that cite competitors are the highest-leverage outreach targets.

**`citation_missed` → `content` type.** Clustered by exact prompt string — all events for the same prompt roll up into one "Publish a gap article" action with every `source_event_id` listed. Cluster severity: `≥ 4 events` = high; `≥ 2` = medium; otherwise low. Rationale: repeated misses on the same prompt across multiple engines signal a genuine content gap, not noise. The cluster count is the natural severity signal — one miss might be a fluke, four means the model has no good source for you on this topic.

**`competitor_cited_instead` → `outreach` (article/youtube) or `reddit` (reddit source_type).** Clustered by `competitor_brand` — all citations of the same competitor, regardless of source type, roll up into one action showing the most prominent instance (lowest `position`). Severity: `position === 1 AND source_type === "article"` = high; `position ≤ 2` = medium; otherwise low. Rationale: position 1 in an article is the citation a model is most likely to reproduce; reddit and youtube citations at position 3+ are signal but lower urgency.


---

## What I Cut and Why

**Per-bot sparklines (Feature 1)**: explicitly out of scope.

**Top Pages date-range filter (Feature 1)**: `pageTotals` always reflects the full 90d range even when 7d/30d is selected. The matrix only tracks bot counts per day, not page counts per day. Fixing this would require storing a second `day × page` matrix — tripling memory. For a dashboard MVP, showing total page popularity alongside the filtered chart is an acceptable tradeoff. Noted in `aggregateVisits.ts` inline.

**Unit tests**: skipped due to time. The critical logic (aggregation, derivation, filter composition) is in pure functions that would be straightforward to test with Jest.

---

## AI Tool Usage

Built with **Antigravity (Google DeepMind)** as the primary coding assistant.

- **Where it helped**: scaffolding all the boilerplate (file structure, type wiring, Recharts setup, Tailwind class composition), generating the FNV-1a hash implementation, and drafting the table-driven derivation rules structure.
- **What I reviewed line-by-line**: the performance-critical path in `aggregateVisits.ts` (single-pass loop, zeroCounts factory), the derivation rules and severity thresholds in `deriveActions.ts`, the hydration merge logic in `ActionCentre.tsx`, and the localStorage read/write/fallback paths.
- **What I rewrote**: the initial chart tooltip was using Recharts' `<Legend>` component — replaced with a custom legend strip for the pill + toggle UX required by spec. The `sliceByDays` function's handling of `pageTotals` (full-range vs sliced) was a judgment call I made explicitly rather than accepting the generated code.
- **Trusted without deep review**: Tailwind class strings, lucide-react icon imports, Next.js metadata API usage.

---

## What I'd Do in Week 2

1. **Page-level date filtering (Feature 1)**: store a `day × page` sparse matrix to make Top Pages reflect the selected date range. Current tradeoff (full-range page totals) is acceptable for MVP but misleading if a page spiked specifically in the 7d window.
2. **Pagination / virtual list for Action Centre**: with 200 events producing ~150 raw action cards before clustering, the grid is fine. At 2000 events it would need windowing.
3. **Unit tests for pure functions**: `aggregateVisits`, `deriveActions`, and the localStorage merge logic are the three highest-value test targets. A test that seeds 10 known visits and asserts the matrix shape would catch regressions in the perf-critical path.
4. **Severity threshold tuning**: the current thresholds (upvotes ≥ 500 = high, etc.) are defensible guesses. In a real product, they'd be tuned against user behavior data — which cards actually get accepted vs dismissed.
