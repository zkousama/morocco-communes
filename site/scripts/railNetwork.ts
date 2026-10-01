/**
 * Which of OpenStreetMap's railway ways the commuting map draws. A way joins another when
 * they share a node, the way OpenStreetMap joins tracks, so tracks that merely run close
 * stay apart. A group of joined ways shorter than the bar for its kind is dropped: an
 * unnamed 1.2 km track inside a quarry near Imi-Mqourn is no line anyone commutes on.
 */

export interface OsmNode {
  id: number;
  lng: number;
  lat: number;
}

export interface OsmWay {
  id: number;
  kind: "rail" | "tram";
  nodes: OsmNode[];
}

const RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle length of a way, in kilometres. */
export function lengthKm(way: OsmWay): number {
  let km = 0;
  for (let i = 1; i < way.nodes.length; i++) {
    const a = way.nodes[i - 1]!;
    const b = way.nodes[i]!;
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    km += 2 * RADIUS_KM * Math.asin(Math.sqrt(h));
  }
  return km;
}

/** The ways in groups that share nodes, in the order their first way came. */
export function connected(ways: OsmWay[]): OsmWay[][] {
  const parent = ways.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const owner = new Map<number, number>();
  ways.forEach((way, i) => {
    for (const node of way.nodes) {
      const j = owner.get(node.id);
      if (j === undefined) owner.set(node.id, i);
      else parent[root(i)] = root(j);
    }
  });
  const groups = new Map<number, OsmWay[]>();
  ways.forEach((way, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(way);
  });
  return [...groups.values()];
}

export interface Dropped {
  kind: "rail" | "tram";
  km: number;
  ways: number[];
  at: { lng: number; lat: number };
}

/** The ways in groups at least `bars[kind]` km long, and what was left out. */
export function networkOf(ways: OsmWay[], bars: { rail: number; tram: number }): { kept: OsmWay[]; dropped: Dropped[] } {
  const kept: OsmWay[] = [];
  const dropped: Dropped[] = [];
  for (const kind of ["rail", "tram"] as const) {
    for (const group of connected(ways.filter((w) => w.kind === kind))) {
      const km = group.reduce((sum, way) => sum + lengthKm(way), 0);
      if (km >= bars[kind]) kept.push(...group);
      else dropped.push({ kind, km, ways: group.map((w) => w.id), at: group[0]!.nodes[0]! });
    }
  }
  return { kept, dropped };
}
