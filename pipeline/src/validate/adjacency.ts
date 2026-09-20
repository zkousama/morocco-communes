import type { Border } from "../build/adjacency.ts";

/**
 * What a map of borders has to satisfy. Two of these would catch a bug in the walk
 * itself, and the third is about the country: every commune touches another one, and
 * following borders from any commune reaches all of them, because Morocco's communes
 * cover one connected stretch of land. A commune with no boundary is left out of both,
 * since it has nothing to border with.
 */
export function checkAdjacency(
  borders: Border[],
  /** The communes that have a boundary, by dotted code. */
  mapped: Set<string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const graph = new Map<string, string[]>();

  for (const { a, b, km } of borders) {
    if (a === b) problems.push(`${a} borders itself`);
    if (a >= b) problems.push(`${a} and ${b} are not in code order, so the pair could be listed twice`);
    if (!mapped.has(a) || !mapped.has(b)) problems.push(`${a} and ${b} border, and one of them has no boundary`);
    if (km <= 0) problems.push(`${a} and ${b} share a border of ${km} km`);
    const key = `${a}|${b}`;
    if (seen.has(key)) problems.push(`${a} and ${b} are listed twice`);
    seen.add(key);
    graph.set(a, [...(graph.get(a) ?? []), b]);
    graph.set(b, [...(graph.get(b) ?? []), a]);
  }

  const alone = [...mapped].filter((code) => !graph.has(code));
  if (alone.length > 0) problems.push(`${alone.length} commune(s) border nothing: ${alone.slice(0, 5).join(", ")}`);

  // One walk from one commune, which has to reach every other.
  const first = [...mapped].sort()[0];
  if (first !== undefined && graph.has(first)) {
    const reached = new Set([first]);
    const queue = [first];
    while (queue.length > 0) {
      for (const next of graph.get(queue.pop()!) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    const missed = [...mapped].filter((code) => !reached.has(code));
    if (missed.length > 0) {
      problems.push(`walking the borders from ${first} reaches ${reached.size} communes, leaving ${missed.length}: ${missed.slice(0, 5).join(", ")}`);
    }
  }

  return problems;
}
