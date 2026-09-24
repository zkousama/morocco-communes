/**
 * The vocabulary a data test is written in, and the arithmetic that decides one. `evaluate`
 * reads a check's subject off the same data the pipeline built, using only `field` and
 * `familyOf` to know what's askable. A check that can't be read at all — an unknown field,
 * a unit that isn't there, a year the census never asked, or a field too close to the
 * finding's own measure to prove anything — is refused. A check that can be read but whose
 * figure is missing fails outright; nothing here lets a null pass by looking like a pass.
 */
import { z } from "zod";
import type { Data, Unit } from "./data.ts";
import { field, familyOf } from "./fields.ts";
import type { Finding } from "./detect.ts";

export type Year = 2014 | 2024;

export type Subject =
  | { unit: "self" }
  | { unit: "parent" }
  | { unit: "country" }
  | { unit: "neighbours"; stat: "median" }
  | { unit: "code"; code: string };

export interface Ref {
  of: Subject;
  field: string;
  year: Year;
}

export type Check =
  | { check: "compare"; left: Ref; op: ">" | "<" | ">=" | "<="; right: Ref | { value: number } }
  | { check: "change"; of: Subject; field: string; op: ">" | "<"; value: number }
  | {
      check: "rank";
      of: Subject;
      field: string;
      year: Year;
      within: "province" | "region" | "country";
      position: "top" | "bottom";
      share: number;
    };

const yearSchema = z.union([z.literal(2014), z.literal(2024)]);

const subjectSchema: z.ZodType<Subject> = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("self") }),
  z.object({ unit: z.literal("parent") }),
  z.object({ unit: z.literal("country") }),
  z.object({ unit: z.literal("neighbours"), stat: z.literal("median") }),
  z.object({ unit: z.literal("code"), code: z.string() }),
]);

const refSchema: z.ZodType<Ref> = z.object({ of: subjectSchema, field: z.string(), year: yearSchema });

export const checkSchema: z.ZodType<Check> = z.discriminatedUnion("check", [
  z.object({
    check: z.literal("compare"),
    left: refSchema,
    op: z.enum([">", "<", ">=", "<="]),
    right: z.union([refSchema, z.object({ value: z.number() })]),
  }),
  z.object({
    check: z.literal("change"),
    of: subjectSchema,
    field: z.string(),
    op: z.enum([">", "<"]),
    value: z.number(),
  }),
  z.object({
    check: z.literal("rank"),
    of: subjectSchema,
    field: z.string(),
    year: yearSchema,
    within: z.enum(["province", "region", "country"]),
    position: z.enum(["top", "bottom"]),
    share: z.number().min(0).max(0.5),
  }),
]);

export interface Outcome {
  status: "passed" | "failed" | "refused";
  reason?: string;
  numbers: Record<string, number>;
}

const OPS = {
  ">": (a: number, b: number) => a > b,
  "<": (a: number, b: number) => a < b,
  ">=": (a: number, b: number) => a >= b,
  "<=": (a: number, b: number) => a <= b,
} as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Whether a field can be read at all for this finding: known to the catalogue, not in the
 * finding's own family (`familyOf`, so a test can't prove a measure with itself or a
 * sibling share), and, when the year 2014 is asked, one the 2014 census asked the same way.
 */
function fieldProblem(path: string, requireComparable: boolean, finding: Finding): string | null {
  const f = field(path);
  if (!f) return "unknown field";
  if (familyOf(finding.measure).has(path)) return "tautology";
  if (requireComparable && !f.comparable) return "not comparable";
  return null;
}

/** A subject that resolves to one unit: everything but `neighbours`, which reads a median instead. */
function resolveUnit(subject: Subject, finding: Finding, data: Data): { unit: Unit } | { reason: string } {
  if (subject.unit === "self") {
    const unit = data.units.get(finding.code);
    return unit ? { unit } : { reason: "unknown unit" };
  }
  if (subject.unit === "country") return { unit: data.country };
  if (subject.unit === "code") {
    const unit = data.units.get(subject.code);
    return unit ? { unit } : { reason: "unknown unit" };
  }
  if (subject.unit === "parent") {
    const self = data.units.get(finding.code);
    if (!self?.parent) return { reason: "no parent" };
    const parent = data.units.get(self.parent);
    return parent ? { unit: parent } : { reason: "unknown unit" };
  }
  return { reason: "unknown unit" }; // "neighbours": callers read it themselves, this is never reached
}

type Read = { kind: "ok"; value: number } | { kind: "refused"; reason: string } | { kind: "missing" };

/** One `Ref`'s value: the finding's own measure rules and 2014-comparability apply first. */
function readRef(ref: Ref, finding: Finding, data: Data): Read {
  const problem = fieldProblem(ref.field, ref.year === 2014, finding);
  if (problem) return { kind: "refused", reason: problem };

  const yearKey = ref.year === 2014 ? "y2014" : "y2024";

  if (ref.of.unit === "neighbours") {
    const self = data.units.get(finding.code);
    if (!self) return { kind: "refused", reason: "unknown unit" };
    const values = self.neighbours
      .map((code) => data.units.get(code)?.figures[yearKey][ref.field])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length < 2) return { kind: "refused", reason: "too few neighbours" };
    return { kind: "ok", value: median(values) };
  }

  const resolved = resolveUnit(ref.of, finding, data);
  if ("reason" in resolved) return { kind: "refused", reason: resolved.reason };
  const value = resolved.unit.figures[yearKey][ref.field];
  if (value == null || !Number.isFinite(value)) return { kind: "missing" };
  return { kind: "ok", value };
}

function evaluateCompare(check: Extract<Check, { check: "compare" }>, finding: Finding, data: Data): Outcome {
  const left = readRef(check.left, finding, data);
  const right: Read = "value" in check.right ? { kind: "ok", value: check.right.value } : readRef(check.right, finding, data);

  if (left.kind === "refused") return { status: "refused", reason: left.reason, numbers: {} };
  if (right.kind === "refused") return { status: "refused", reason: right.reason, numbers: {} };

  const numbers: Record<string, number> = {};
  if (left.kind === "ok") numbers.left = left.value;
  if (right.kind === "ok") numbers.right = right.value;

  if (left.kind === "missing" || right.kind === "missing") return { status: "failed", reason: "missing", numbers };

  const passed = OPS[check.op](left.value, right.value);
  return { status: passed ? "passed" : "failed", numbers };
}

function evaluateChange(check: Extract<Check, { check: "change" }>, finding: Finding, data: Data): Outcome {
  // A change always reads both censuses, so the field has to be one the 2014 census asked
  // the same way, exactly as a bare `year: 2014` Ref would require.
  const problem = fieldProblem(check.field, true, finding);
  if (problem) return { status: "refused", reason: problem, numbers: {} };

  if (check.of.unit === "neighbours") {
    const self = data.units.get(finding.code);
    if (!self) return { status: "refused", reason: "unknown unit", numbers: {} };
    const pairs = self.neighbours
      .map((code) => data.units.get(code))
      .filter((u): u is Unit => u !== undefined)
      .map((u) => ({ v2014: u.figures.y2014[check.field], v2024: u.figures.y2024[check.field] }))
      .filter(
        (p): p is { v2014: number; v2024: number } =>
          p.v2014 != null && p.v2024 != null && Number.isFinite(p.v2014) && Number.isFinite(p.v2024),
      );
    if (pairs.length < 2) return { status: "refused", reason: "too few neighbours", numbers: {} };
    const numbers = {
      y2014: median(pairs.map((p) => p.v2014)),
      y2024: median(pairs.map((p) => p.v2024)),
      change: median(pairs.map((p) => p.v2024 - p.v2014)),
    };
    const passed = OPS[check.op](numbers.change, check.value);
    return { status: passed ? "passed" : "failed", numbers };
  }

  const resolved = resolveUnit(check.of, finding, data);
  if ("reason" in resolved) return { status: "refused", reason: resolved.reason, numbers: {} };
  const v2014 = resolved.unit.figures.y2014[check.field];
  const v2024 = resolved.unit.figures.y2024[check.field];
  const numbers: Record<string, number> = {};
  if (v2014 != null && Number.isFinite(v2014)) numbers.y2014 = v2014;
  if (v2024 != null && Number.isFinite(v2024)) numbers.y2024 = v2024;
  if (numbers.y2014 === undefined || numbers.y2024 === undefined) return { status: "failed", reason: "missing", numbers };

  const change = numbers.y2024 - numbers.y2014;
  const withChange = { ...numbers, change };
  const passed = OPS[check.op](change, check.value);
  return { status: passed ? "passed" : "failed", numbers: withChange };
}

/** The named ancestor of `unit`, walking up `parent`; null when the chain never reaches that level. */
function ancestorAt(unit: Unit, level: "province" | "region", data: Data): string | null {
  let current: Unit | undefined = unit;
  while (current?.parent) {
    const parent = data.units.get(current.parent);
    if (!parent) return null;
    if (parent.level === level) return parent.code;
    current = parent;
  }
  return null;
}

function evaluateRank(check: Extract<Check, { check: "rank" }>, finding: Finding, data: Data): Outcome {
  const problem = fieldProblem(check.field, check.year === 2014, finding);
  if (problem) return { status: "refused", reason: problem, numbers: {} };

  // A neighbours or country subject has no single peer group of its own level; "within
  // country" already covers ranking a unit against every unit of its level.
  if (check.of.unit === "neighbours" || check.of.unit === "country") {
    return { status: "refused", reason: "wrong subject", numbers: {} };
  }

  const resolved = resolveUnit(check.of, finding, data);
  if ("reason" in resolved) return { status: "refused", reason: resolved.reason, numbers: {} };
  const subject = resolved.unit;

  let peers: Unit[];
  if (check.within === "country") {
    peers = data.byLevel.get(subject.level) ?? [];
  } else {
    const within = check.within;
    const area = ancestorAt(subject, within, data);
    if (!area) return { status: "refused", reason: "outside the area", numbers: {} };
    peers = (data.byLevel.get(subject.level) ?? []).filter((u) => ancestorAt(u, within, data) === area);
  }

  const yearKey = check.year === 2014 ? "y2014" : "y2024";
  const subjectValue = subject.figures[yearKey][check.field];
  if (subjectValue == null || !Number.isFinite(subjectValue)) return { status: "failed", reason: "missing", numbers: {} };

  const values = peers.map((u) => u.figures[yearKey][check.field]).filter((v): v is number => v != null && Number.isFinite(v));
  const of = values.length;
  const rank = 1 + values.filter((v) => v > subjectValue).length; // rank 1 is the highest value
  const numbers = { value: subjectValue, rank, of };

  const cutoff = Math.max(1, Math.ceil(check.share * of));
  const passed = check.position === "top" ? rank <= cutoff : rank > of - cutoff;
  return { status: passed ? "passed" : "failed", numbers };
}

export function evaluate(check: Check, finding: Finding, data: Data): Outcome {
  if (check.check === "compare") return evaluateCompare(check, finding, data);
  if (check.check === "change") return evaluateChange(check, finding, data);
  return evaluateRank(check, finding, data);
}

/**
 * Every number in a check, rounded to 1 decimal, with keys sorted at every level. `share`
 * is rounded to 2: it lives in [0, 0.5], where a 1-decimal round would make 0.05 and 0.1
 * (or 0.01 and 0.04) sign the same, and a rank's share is the whole test.
 */
function canonical(value: unknown, key?: string): unknown {
  if (typeof value === "number") {
    const decimals = key === "share" ? 2 : 1;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
  if (Array.isArray(value)) return value.map((v) => canonical(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = canonical((value as Record<string, unknown>)[k], k);
    return out;
  }
  return value;
}

export function signature(check: Check): string {
  return JSON.stringify(canonical(check));
}
