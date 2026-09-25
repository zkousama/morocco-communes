/**
 * The figures worth a second look: communes at the extreme end of a measure, units whose
 * measure moved a lot since 2014, communes and provinces far from their parent's figure,
 * and the slow-moving swings that look more like a data artefact than a real change.
 * Later tasks explain a finding; this one only decides it exists.
 */
import { createHash } from "node:crypto";
import type { Data, Unit } from "./data.ts";
import { FIELDS, type Field, type Level } from "./fields.ts";

export type Kind = "extreme" | "change" | "gap" | "artefact";

export interface Finding {
  id: string; // first 12 hex characters of sha256(`${code}|${measure}|${kind}`)
  code: string;
  level: Level;
  measure: string;
  kind: Kind;
  value: number; // the 2024 value, or the change in points for a change
  reference: number; // the level's mean, the parent's value, or 0 for a change
  score: number; // |z|
  direction: "high" | "low";
}

// Exported for the site's methods page, which states each of them.
export const DEFAULT_CAP = 300;
export const DEFAULT_PER_UNIT = 3;
export const Z_THRESHOLD = 3;
export const EXTREME_POPULATION_FLOOR = 5000;
export const EXTREME_TAIL_SHARE = 0.01;
export const CHANGE_MIN_LEVEL_SIZE = 10;
export const GAP_MIN_GROUP_SIZE = 8;
export const ARTEFACT_POPULATION_CHANGE_CEILING = 0.1;

const LEVELS: Level[] = ["region", "province", "commune", "arrondissement"];

function findingId(code: string, measure: string, kind: Kind): string {
  return createHash("sha256").update(`${code}|${measure}|${kind}`).digest("hex").slice(0, 12);
}

const directionOf = (diff: number): "high" | "low" => (diff > 0 ? "high" : "low");

/** A group's mean and standard deviation, skipping non-finite values. Null when the group is empty or has no spread. */
function stats(values: number[]): { mean: number; sd: number } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length;
  const variance = finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / finite.length;
  const sd = Math.sqrt(variance);
  return sd === 0 ? null : { mean, sd };
}

/**
 * Communes with 2024 population of 5,000 or more, at the top or bottom 1% of a field by
 * value. Scored against the mean and standard deviation of that same eligible group.
 */
function detectExtremes(data: Data): Finding[] {
  const eligible = (data.byLevel.get("commune") ?? []).filter((u) => u.population.y2024 >= EXTREME_POPULATION_FLOOR);
  const out: Finding[] = [];

  for (const f of FIELDS) {
    const withValue = eligible
      .map((u) => ({ u, value: u.figures.y2024[f.path] }))
      .filter((x): x is { u: Unit; value: number } => x.value != null && Number.isFinite(x.value));
    const s = stats(withValue.map((x) => x.value));
    if (!s) continue;

    const sorted = [...withValue].sort((a, b) => a.value - b.value);
    const tail = Math.max(1, Math.round(sorted.length * EXTREME_TAIL_SHARE));
    const picked = new Set<string>();
    for (const { u, value } of [...sorted.slice(0, tail), ...sorted.slice(-tail)]) {
      if (picked.has(u.code)) continue;
      picked.add(u.code);
      out.push({
        id: findingId(u.code, f.path, "extreme"),
        code: u.code,
        level: u.level,
        measure: f.path,
        kind: "extreme",
        value,
        reference: s.mean,
        score: Math.abs(value - s.mean) / s.sd,
        direction: value >= s.mean ? "high" : "low",
      });
    }
  }
  return out;
}

/**
 * Whether a change finding on a slow field is more likely a data artefact than a real
 * shift: the unit's population barely moved, and no neighbour moved the same measure the
 * same way by at least half as much.
 */
function isArtefact(unit: Unit, field: Field, change: number, data: Data): boolean {
  if (!field.slow) return false;
  const pop2014 = unit.population.y2014;
  if (pop2014 == null || pop2014 === 0) return false;
  const populationChange = Math.abs(unit.population.y2024 - pop2014) / pop2014;
  if (populationChange >= ARTEFACT_POPULATION_CHANGE_CEILING) return false;

  const halfMagnitude = Math.abs(change) / 2;
  const corroborated = unit.neighbours.some((code) => {
    const neighbour = data.units.get(code);
    const nv2024 = neighbour?.figures.y2024[field.path];
    const nv2014 = neighbour?.figures.y2014[field.path];
    if (nv2024 == null || nv2014 == null || !Number.isFinite(nv2024) || !Number.isFinite(nv2014)) return false;
    const neighbourChange = nv2024 - nv2014;
    return Math.sign(neighbourChange) === Math.sign(change) && Math.abs(neighbourChange) >= halfMagnitude;
  });
  return !corroborated;
}

/**
 * Comparable fields, every level with 10 or more units: a unit whose measure moved with
 * |z| >= 3 against its level's own change distribution. A crosswalk-matched commune is
 * left out, since its 2014 figure isn't its own boundary's. A slow field's lone,
 * uncorroborated swing on a population that barely moved becomes an artefact instead.
 */
function detectChanges(data: Data): Finding[] {
  const out: Finding[] = [];

  for (const level of LEVELS) {
    const units = data.byLevel.get(level) ?? [];
    if (units.length < CHANGE_MIN_LEVEL_SIZE) continue;

    for (const f of FIELDS) {
      if (!f.comparable) continue;
      const changes = units
        .filter((u) => u.basis !== "crosswalk")
        .map((u) => {
          const v2024 = u.figures.y2024[f.path];
          const v2014 = u.figures.y2014[f.path];
          if (v2024 == null || v2014 == null || !Number.isFinite(v2024) || !Number.isFinite(v2014)) return null;
          return { u, change: v2024 - v2014 };
        })
        .filter((x): x is { u: Unit; change: number } => x !== null);

      const s = stats(changes.map((c) => c.change));
      if (!s) continue;

      for (const { u, change } of changes) {
        const z = (change - s.mean) / s.sd;
        if (Math.abs(z) < Z_THRESHOLD) continue;
        const kind: Kind = isArtefact(u, f, change, data) ? "artefact" : "change";
        out.push({
          id: findingId(u.code, f.path, kind),
          code: u.code,
          level: u.level,
          measure: f.path,
          kind,
          value: change,
          reference: 0,
          score: Math.abs(z),
          direction: directionOf(change),
        });
      }
    }
  }
  return out;
}

/**
 * A commune against its province, a province against its région: the difference from the
 * parent's own value, among parents with 8 or more children, scored against that group's
 * own mean and standard deviation of the difference.
 */
function detectGaps(data: Data): Finding[] {
  const out: Finding[] = [];

  for (const childLevel of ["commune", "province"] as const) {
    const children = data.byLevel.get(childLevel) ?? [];
    const byParent = new Map<string, Unit[]>();
    for (const u of children) {
      if (!u.parent) continue;
      const group = byParent.get(u.parent);
      if (group) group.push(u);
      else byParent.set(u.parent, [u]);
    }

    for (const [parentCode, group] of byParent) {
      if (group.length < GAP_MIN_GROUP_SIZE) continue;
      const parent = data.units.get(parentCode);
      if (!parent) continue;

      for (const f of FIELDS) {
        const parentValue = parent.figures.y2024[f.path];
        if (parentValue == null || !Number.isFinite(parentValue)) continue;

        const diffs = group
          .map((u) => {
            const value = u.figures.y2024[f.path];
            if (value == null || !Number.isFinite(value)) return null;
            return { u, value, diff: value - parentValue };
          })
          .filter((x): x is { u: Unit; value: number; diff: number } => x !== null);

        const s = stats(diffs.map((d) => d.diff));
        if (!s) continue;

        for (const { u, value, diff } of diffs) {
          const z = (diff - s.mean) / s.sd;
          if (Math.abs(z) < Z_THRESHOLD) continue;
          out.push({
            id: findingId(u.code, f.path, "gap"),
            code: u.code,
            level: u.level,
            measure: f.path,
            kind: "gap",
            value,
            reference: parentValue,
            score: Math.abs(z),
            direction: directionOf(diff),
          });
        }
      }
    }
  }
  return out;
}

/** Every census, housing and economy field's stand-out findings, ranked and trimmed. */
export function detect(data: Data, options?: { cap?: number; perUnit?: number }): Finding[] {
  const cap = options?.cap ?? DEFAULT_CAP;
  const perUnit = options?.perUnit ?? DEFAULT_PER_UNIT;

  const findings = [...detectExtremes(data), ...detectChanges(data), ...detectGaps(data)];
  findings.sort((a, b) => b.score - a.score);

  const perUnitCount = new Map<string, number>();
  const result: Finding[] = [];
  for (const f of findings) {
    const count = perUnitCount.get(f.code) ?? 0;
    if (count >= perUnit) continue;
    perUnitCount.set(f.code, count + 1);
    result.push(f);
    if (result.length >= cap) break;
  }
  return result;
}
