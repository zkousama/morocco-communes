/**
 * Corrupts a check 5 ways, so scoring can measure how often `evaluate` still catches a
 * wrong claim: moving the subject off `self`, swapping the year a comparable field is
 * read in, flipping the comparison's direction, moving a literal number, and pointing the
 * check at a field from a different topic. A kind fires only where the check has
 * something of that shape to corrupt - a check with no literal number gets no `number`
 * mutant, a field that isn't comparable no `year` one. Every random pick comes from
 * `rng(seed)`, so the same check and seed always make the same mutants.
 */
import type { Data } from "./data.ts";
import { field, FIELDS } from "./fields.ts";
import { rng } from "./stats.ts";
import type { Check, Subject, Year } from "./vocabulary.ts";

export type Mutation = "unit" | "year" | "direction" | "number" | "field";

interface Mutant {
  kind: Mutation;
  check: Check;
}

/** A random commune's code, standing in for `self`: a different shape from `{unit:"self"}` whatever it picks. */
function randomCommune(data: Data, random: () => number): Subject {
  const communes = data.byLevel.get("commune") ?? [];
  const pick = communes[Math.floor(random() * communes.length)]!;
  return { unit: "code", code: pick.code };
}

const swapYear = (year: Year): Year => (year === 2024 ? 2014 : 2024);

function flipCompareOp(op: Extract<Check, { check: "compare" }>["op"]): typeof op {
  const flipped = { ">": "<", "<": ">", ">=": "<=", "<=": ">=" } as const;
  return flipped[op];
}

function flipChangeOp(op: Extract<Check, { check: "change" }>["op"]): typeof op {
  return op === ">" ? "<" : ">";
}

const flipPosition = (position: "top" | "bottom"): "top" | "bottom" => (position === "top" ? "bottom" : "top");

/** A random field whose topic differs from `path`'s own, so the corruption can't land back on a sibling reading the same thing. */
function randomOtherField(path: string, random: () => number): string | null {
  const current = field(path);
  if (!current) return null;
  const others = FIELDS.filter((f) => f.topic !== current.topic);
  if (others.length === 0) return null;
  return others[Math.floor(random() * others.length)]!.path;
}

/** Halved and shifted by 20 points, minus whichever of those lands back on the original value. */
function numberMutants(value: number): number[] {
  return [value / 2, value + 20].filter((v) => v !== value);
}

function compareMutations(check: Extract<Check, { check: "compare" }>, data: Data, random: () => number): Mutant[] {
  const out: Mutant[] = [];

  if (check.left.of.unit === "self") {
    out.push({ kind: "unit", check: { ...check, left: { ...check.left, of: randomCommune(data, random) } } });
  }
  if ("of" in check.right && check.right.of.unit === "self") {
    out.push({ kind: "unit", check: { ...check, right: { ...check.right, of: randomCommune(data, random) } } });
  }

  if (field(check.left.field)?.comparable) {
    out.push({ kind: "year", check: { ...check, left: { ...check.left, year: swapYear(check.left.year) } } });
  }
  if ("of" in check.right && field(check.right.field)?.comparable) {
    out.push({ kind: "year", check: { ...check, right: { ...check.right, year: swapYear(check.right.year) } } });
  }

  out.push({ kind: "direction", check: { ...check, op: flipCompareOp(check.op) } });

  // Only the right side can be a bare literal; the left is always a reference.
  if ("value" in check.right) {
    for (const value of numberMutants(check.right.value)) out.push({ kind: "number", check: { ...check, right: { value } } });
  }

  const leftField = randomOtherField(check.left.field, random);
  if (leftField) out.push({ kind: "field", check: { ...check, left: { ...check.left, field: leftField } } });
  if ("of" in check.right) {
    const rightField = randomOtherField(check.right.field, random);
    if (rightField) out.push({ kind: "field", check: { ...check, right: { ...check.right, field: rightField } } });
  }

  return out;
}

function changeMutations(check: Extract<Check, { check: "change" }>, data: Data, random: () => number): Mutant[] {
  const out: Mutant[] = [];

  if (check.of.unit === "self") out.push({ kind: "unit", check: { ...check, of: randomCommune(data, random) } });
  // No year mutant: a change always reads both censuses, so there's no year field to swap.
  out.push({ kind: "direction", check: { ...check, op: flipChangeOp(check.op) } });
  for (const value of numberMutants(check.value)) out.push({ kind: "number", check: { ...check, value } });
  const otherField = randomOtherField(check.field, random);
  if (otherField) out.push({ kind: "field", check: { ...check, field: otherField } });

  return out;
}

function rankMutations(check: Extract<Check, { check: "rank" }>, data: Data, random: () => number): Mutant[] {
  const out: Mutant[] = [];

  if (check.of.unit === "self") out.push({ kind: "unit", check: { ...check, of: randomCommune(data, random) } });
  if (field(check.field)?.comparable) out.push({ kind: "year", check: { ...check, year: swapYear(check.year) } });
  // A rank has no op to flip, but "top" versus "bottom" is its direction: flipping it is
  // the same corruption as flipping > and < elsewhere.
  out.push({ kind: "direction", check: { ...check, position: flipPosition(check.position) } });
  // No number mutant: share is a 0-0.5 fraction, not a points value in the field's own unit.
  const otherField = randomOtherField(check.field, random);
  if (otherField) out.push({ kind: "field", check: { ...check, field: otherField } });

  return out;
}

/** Drops a mutant whose check is identical to one already kept - `numberMutants` can hand back the same value twice (halving -40 and shifting it by 20 both land on -20). */
function dedupe(mutants: Mutant[]): Mutant[] {
  const seen = new Set<string>();
  const out: Mutant[] = [];
  for (const m of mutants) {
    const key = JSON.stringify(m.check);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function mutations(check: Check, data: Data, seed: number): Mutant[] {
  const random = rng(seed);
  if (check.check === "compare") return dedupe(compareMutations(check, data, random));
  if (check.check === "change") return dedupe(changeMutations(check, data, random));
  return dedupe(rankMutations(check, data, random));
}
