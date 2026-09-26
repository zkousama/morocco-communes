/**
 * The pilot's seeded samples: the 16 findings both stages share, the pool a proposer's
 * passing candidates draw into, the reasons the owner rates blind, and the candidates
 * where the adversary runs disagree. Every draw here is seeded (mulberry32, via `rng`),
 * over a copy sorted into a fixed order first, so the result depends only on the set
 * that's drawn from and the seed, never on the order its caller happened to hand it in.
 */
import { createHash } from "node:crypto";
import type { Finding, Kind } from "../detect.ts";
import { rng } from "../stats.ts";
import type { Check } from "../vocabulary.ts";
import { signature } from "../vocabulary.ts";
import { FINDINGS_BY_KIND } from "./setups.ts";

/** Fisher-Yates, in place, over whatever array is handed in; callers pass a copy. */
function shuffle<T>(values: T[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const vi = values[i]!;
    values[i] = values[j]!;
    values[j] = vi;
  }
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A candidate's id: the first 12 hex characters of sha256 of what makes it that candidate. */
export function candidateIdOf(findingId: string, proposerId: string, test: Check): string {
  return createHash("sha256")
    .update(`${findingId}:${proposerId}:${signature(test)}`)
    .digest("hex")
    .slice(0, 12);
}

const SAMPLED_KINDS = Object.keys(FINDINGS_BY_KIND) as (keyof typeof FINDINGS_BY_KIND)[];

/** `SAMPLED_KINDS`, largest quota first, for the province backstop below. */
const KINDS_LARGEST_FIRST = [...SAMPLED_KINDS].sort((a, b) => FINDINGS_BY_KIND[b] - FINDINGS_BY_KIND[a]);

/**
 * The 16 findings both pilot stages share: `FINDINGS_BY_KIND`'s counts of extremes,
 * changes and gaps, artefacts excluded, drawn from a fresh shuffle of each kind (one
 * continuous seeded stream across the 3 shuffles, so the whole draw is reproducible from
 * `seed` alone). Each kind's findings are sorted by id before the shuffle, so the draw
 * depends only on `seed` and which findings `detect` returned, never on the order it
 * returned them in. A kind with fewer non-artefact findings than its count throws rather
 * than silently returning fewer: a shrunken sample is a different pilot, not this one.
 *
 * If the draw lands no province among the 16, the largest kind that still has an unpicked
 * province swaps its last-picked *commune* finding for that province (today's data only
 * ever puts a province among the changes, but the search doesn't assume that); a kind
 * whose picks hold no commune to swap out throws rather than silently keeping a sample
 * with no province in it.
 */
export function sampleFindings(findings: Finding[], seed: number): Finding[] {
  const random = rng(seed);

  const pools = new Map<Kind, Finding[]>();
  const picked = new Map<Kind, Finding[]>();
  for (const kind of SAMPLED_KINDS) {
    const pool = findings.filter((f) => f.kind === kind).sort((a, b) => byString(a.id, b.id));
    shuffle(pool, random);
    const count = FINDINGS_BY_KIND[kind];
    if (pool.length < count) {
      throw new Error(`sampleFindings: only ${pool.length} non-artefact "${kind}" findings, need ${count}`);
    }
    pools.set(kind, pool);
    picked.set(kind, pool.slice(0, count));
  }

  const hasProvince = SAMPLED_KINDS.some((kind) => picked.get(kind)!.some((f) => f.level === "province"));
  if (!hasProvince) {
    const swapKind = KINDS_LARGEST_FIRST.find((kind) => pools.get(kind)!.some((f) => f.level === "province"));
    if (!swapKind) throw new Error("sampleFindings: no province-level finding is available in any kind");
    const province = pools.get(swapKind)!.find((f) => f.level === "province")!;
    const kindPicked = picked.get(swapKind)!;
    const swapIndex = kindPicked.map((f) => f.level).lastIndexOf("commune");
    if (swapIndex === -1) {
      throw new Error(`sampleFindings: "${swapKind}"'s picks hold no commune finding to swap for its province`);
    }
    kindPicked[swapIndex] = province;
  }

  return SAMPLED_KINDS.flatMap((kind) => picked.get(kind)!);
}

export interface PoolEntry {
  candidateId: string;
  proposer: string;
  findingId: string;
}

/**
 * Up to `perProposer` passing candidates per proposer, seeded, from whichever proposer
 * setups appear in `candidates`. Proposers are visited in id order, and each proposer's
 * passing candidates are sorted by `candidateId` before the shuffle, so the result depends
 * only on the set of candidates handed in, never on their order. A proposer with fewer
 * passing candidates than `perProposer` contributes all of them.
 */
export function samplePool<T extends { candidateId: string; proposer: string; findingId: string; passed: boolean }>(
  candidates: T[],
  perProposer: number,
  seed: number,
): PoolEntry[] {
  const random = rng(seed);
  const byProposer = new Map<string, T[]>();
  for (const c of candidates) {
    if (!c.passed) continue;
    const list = byProposer.get(c.proposer) ?? [];
    list.push(c);
    byProposer.set(c.proposer, list);
  }

  const out: PoolEntry[] = [];
  for (const proposer of [...byProposer.keys()].sort(byString)) {
    const pool = byProposer.get(proposer)!.sort((a, b) => byString(a.candidateId, b.candidateId));
    shuffle(pool, random);
    for (const c of pool.slice(0, perProposer)) {
      out.push({ candidateId: c.candidateId, proposer: c.proposer, findingId: c.findingId });
    }
  }
  return out;
}

/**
 * One passing candidate's id per finding per proposer, for `perProposer` findings drawn at
 * random from `findingIds` with the seed, the same `perProposer` findings for every
 * proposer. Proposers are visited in id order; for each proposer and finding, one of that
 * pair's passing candidates is drawn at random (never just the first or the most-repeated
 * one, which would bias whatever the rating measures), from candidates sorted by
 * `candidateId` first, so the result depends only on the set of candidates and finding ids
 * handed in, never on their order. A proposer with no passing candidate for a drawn finding
 * simply contributes nothing for it, so a proposer's share can come in under `perProposer`.
 */
export function sampleRated<T extends { candidateId: string; proposer: string; findingId: string; passed: boolean }>(
  candidates: T[],
  findingIds: string[],
  perProposer: number,
  seed: number,
): string[] {
  const random = rng(seed);
  const shuffledFindings = [...findingIds].sort(byString);
  shuffle(shuffledFindings, random);
  const chosenFindings = shuffledFindings.slice(0, perProposer);

  const proposers = [...new Set(candidates.map((c) => c.proposer))].sort(byString);
  const byProposerFinding = new Map<string, T[]>();
  for (const c of candidates) {
    if (!c.passed) continue;
    const key = `${c.proposer}:${c.findingId}`;
    const list = byProposerFinding.get(key) ?? [];
    list.push(c);
    byProposerFinding.set(key, list);
  }
  for (const list of byProposerFinding.values()) list.sort((a, b) => byString(a.candidateId, b.candidateId));

  const out: string[] = [];
  for (const proposer of proposers) {
    for (const findingId of chosenFindings) {
      const options = byProposerFinding.get(`${proposer}:${findingId}`);
      if (!options || options.length === 0) continue;
      const drawn = options[Math.floor(random() * options.length)]!;
      out.push(drawn.candidateId);
    }
  }
  return out;
}

/**
 * Every candidate id where the adversary runs don't all agree, grouped by the sorted set
 * of runs whose verdict broke it, and drawn from in a fixed order (candidate ids sorted,
 * then group keys sorted) before any shuffle, so the result depends only on the set of
 * verdicts handed in, never on `verdicts`' own iteration order.
 *
 * `verdicts` maps a candidate id to a map of run id to whether that run's counter-test
 * broke the candidate (`true`) or the candidate survived it (`false`). A run whose answer
 * was unusable is left out of that candidate's map entirely, never coded as `false`, which
 * would invent a disagreement that isn't one; a candidate any run stopped for safety is
 * left out of `verdicts` altogether.
 *
 * A candidate where every included run agrees isn't a disagreement. At or under `cap`,
 * every disagreement is returned; above it, a seeded round-robin takes from each group in
 * turn, so the sample spreads across the different ways the runs split rather than
 * favouring whichever group happens to be biggest.
 */
export function sampleDisagreements(verdicts: Map<string, Map<string, boolean>>, cap: number, seed: number): string[] {
  const groups = new Map<string, string[]>();
  for (const candidateId of [...verdicts.keys()].sort(byString)) {
    const byRun = verdicts.get(candidateId)!;
    const values = [...byRun.values()];
    if (values.length === 0 || values.every((v) => v === values[0])) continue; // every run agrees: not a disagreement
    const brokeBy = [...byRun.entries()]
      .filter(([, broke]) => broke)
      .map(([run]) => run)
      .sort(byString);
    const key = JSON.stringify(brokeBy);
    const list = groups.get(key) ?? [];
    list.push(candidateId);
    groups.set(key, list);
  }

  const sortedKeys = [...groups.keys()].sort(byString);
  const all = sortedKeys.flatMap((key) => groups.get(key)!);
  if (all.length <= cap) return all;

  const random = rng(seed);
  const shuffledGroups = sortedKeys.map((key) => {
    const copy = [...groups.get(key)!]; // already sorted by candidateId, built from the sorted keys above
    shuffle(copy, random);
    return copy;
  });
  shuffle(shuffledGroups, random);

  const out: string[] = [];
  for (let round = 0; out.length < cap; round++) {
    const before = out.length;
    for (const group of shuffledGroups) {
      if (round >= group.length) continue;
      out.push(group[round]!);
      if (out.length === cap) break;
    }
    if (out.length === before) break; // every group exhausted: nothing more to add
  }
  return out;
}
