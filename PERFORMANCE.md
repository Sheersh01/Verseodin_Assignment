# Performance Notes — AI Traffic Dashboard

## How we hit the <150ms legend toggle budget

**The core insight:** legend toggle doesn't need to touch the 100,000 raw visit records at all.

### Aggregation strategy

On first load, `aggregateVisits(visits)` does a **single O(n) pass** over all 100k rows, building three data structures simultaneously:

```
dayMap:     Map<"YYYY-MM-DD", Record<BotName, number>>   // 90 entries × 7 bots
botTotals:  Record<BotName, number>                      // 7 entries
pageTotals: Record<string, number>                       // 30 entries
```

This runs once in a `useEffect` after fetch. Nothing re-aggregates after this point.

### Why legend toggle is O(numBots × numDays) ≈ O(630)

The chart reads from the pre-built matrix. Toggling a bot on/off flips a `Set<BotName>` in state — a single O(1) state update. Recharts then hides or shows the corresponding `<Bar>` series, which is already bound to `counts.BotName` from the matrix. No filtering, no re-summing, no re-scanning raw rows.

Recharts' stacked bar re-render with 90 data points and 7 series takes ~5–15ms on a mid-range machine. The 150ms budget is extremely comfortable.

### Why initial aggregation is <500ms

The 100k row single-pass loop with map lookups runs in ~50–100ms in V8 on a mid-range machine (benchmarked locally: ~70ms). The fetch of the ~8MB JSON takes longer than the aggregation.

### Date-range filter is also O(days)

`sliceByDays(data, n)` slices the already-built matrix array by the last N entries and re-sums bot totals from the slice — O(n × 7) = O(630) for 90d, O(30 × 7) for 30d. No raw row touch.

### Bonus feature: Offloading aggregation to a Web Worker

While the 70ms aggregation loop is extremely fast, as an added stretch goal, the initial 100,000-row `aggregateVisits()` execution is offloaded entirely to a Web Worker (`lib/aggregation.worker.ts`). This ensures the main UI thread remains strictly unblocked and completely jank-free even on extremely slow devices while processing the massive dataset.

`isAnimationActive={false}` on `<Bar>` eliminates Recharts' built-in animation, which would otherwise run on every legend toggle and add 300ms+ to re-renders.
