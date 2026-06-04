/**
 * FNV-1a 32-bit hash — deterministic, no dependencies.
 * Used to generate stable Action ids from sorted source_event_ids.
 * Same input always produces same output, making localStorage persistence safe.
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // unsigned 32-bit multiply
  }
  return hash;
}

/**
 * Derive a stable id string from a list of source event ids.
 * Sorting ensures the order of ids doesn't affect the result.
 */
export function stableId(sourceIds: string[]): string {
  const key = [...sourceIds].sort().join("|");
  const hash = fnv1a32(key);
  return hash.toString(16).padStart(8, "0");
}
