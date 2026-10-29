/**
 * Douar points from the purchased file, joined to our communes.
 *
 * The file names each point in French and names its commune, with no HCP code. The commune
 * name is the 2014 one, sometimes with a word glued on (AbdallahEl) or a municipal tag
 * (Aoulouz (Mun.)), and a few names belong to more than one commune. A point is kept when
 * one commune of that name has it inside its box. The caller can say which commune's
 * boundary actually holds it, for the names that two boxes both cover.
 */
import { normalise } from "./normalise.ts";

export interface NamedCommune {
  code: string;
  name: string;
  /** West, south, east, north, as the commune file writes it. */
  bbox: readonly [number, number, number, number];
}

export interface CommuneIndex {
  byName: Map<string, string[]>;
  bySquash: Map<string, string[]>;
  bbox: Map<string, readonly [number, number, number, number]>;
}

/**
 * A point this far outside the box, in degrees, can still be the commune's. The box is the
 * boundary's own edge, and a douar on that edge falls just past it.
 */
const BOX_PAD = 0.02;

const fold = (label: string) => normalise(label).replace(/ mun$/, "");

/** Spaces and the article El gone, so a glued or a missing El still meets. */
const squash = (name: string) => name.replace(/\b(?:el|al)\b/g, "").replace(/ /g, "");

/**
 * AbdallahEl is Abdallah El. The article has to close a word of some length, so a name
 * that merely ends in those letters is left.
 */
const splitEl = (label: string) => label.replace(/(\p{L}{4,})el\b/giu, "$1 el");

export function indexCommunes(communes: readonly NamedCommune[]): CommuneIndex {
  const byName = new Map<string, string[]>();
  const bySquash = new Map<string, string[]>();
  const bbox = new Map<string, readonly [number, number, number, number]>();
  for (const commune of communes) {
    const name = fold(commune.name);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), commune.code]);
    const flat = squash(name);
    bySquash.set(flat, [...(bySquash.get(flat) ?? []), commune.code]);
    bbox.set(commune.code, commune.bbox);
  }
  return { byName, bySquash, bbox };
}

const holds = (box: readonly [number, number, number, number], point: { lat: number; lng: number }) => {
  const [west, south, east, north] = box;
  return point.lng >= west - BOX_PAD && point.lng <= east + BOX_PAD && point.lat >= south - BOX_PAD && point.lat <= north + BOX_PAD;
};

const codesOf = (index: CommuneIndex, label: string): string[] => {
  for (const form of [label, splitEl(label)]) {
    const name = fold(form);
    const exact = name ? index.byName.get(name) : undefined;
    if (exact) return exact;
  }
  const flat = squash(fold(splitEl(label)));
  const loose = flat ? index.bySquash.get(flat) : undefined;
  return loose?.length === 1 ? loose : [];
};

/**
 * The commune a purchased point is matched in. The boundary wins, because the file's commune
 * name is the 2014 one and often isn't the commune the douar belongs to now. The file's name
 * is only a fallback where the point falls in no boundary.
 */
export function placedCommune(named: string | null, boundary: string | null): string | null {
  return boundary ?? named;
}

/**
 * The commune this label names, where the point sits in its box. `contains` decides between
 * communes of the same name whose boxes both hold the point: the one whose boundary does.
 */
export function communeFor(
  index: CommuneIndex,
  label: string,
  point: { lat: number; lng: number },
  contains?: (code: string) => boolean,
): string | null {
  const inside = codesOf(index, label).filter((code) => {
    const box = index.bbox.get(code);
    return box ? holds(box, point) : false;
  });
  if (inside.length === 1) return inside[0]!;
  if (!contains) return null;
  const held = inside.filter(contains);
  return held.length === 1 ? held[0]! : null;
}

/** The purchased file writes every name in capitals; the other sources don't, and the page follows them. */
export function placeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}
