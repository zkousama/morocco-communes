/**
 * The pilot's seeded samples: the 16 findings both stages share, the pool a proposer's
 * passing candidates draw into, the reasons the owner rates blind, and the candidates
 * where the adversary runs disagree. Every draw here is seeded (mulberry32, via `rng`),
 * so a re-run reproduces the same pilot from the same findings and candidates without
 * calling a model again.
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
 * `seed` alone). A kind with fewer non-artefact findings than its count throws rather than
 * silently returning fewer: a shrunken sample is a different pilot, not this one.
 *
 * If the draw lands no province among the 16, the largest kind that still has an unpicked
 * province swaps its last-picked finding for that province: today's data only ever puts a
 * province among the changes, but the search doesn't assume that.
 */
export function sampleFindings(findings: Finding[], seed: number): Finding[] {
  const random = rng(seed);

  const pools = new Map<Kind, Finding[]>();
  const picked = new Map<Kind, Finding[]>();
  for (const kind of SAMPLED_KINDS) {
    const pool = findings.filter((f) => f.kind === kind);
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
    kindPicked[kindPicked.length - 1] = province;
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
 * setups appear in `candidates`. A proposer with fewer passing candidates than
 * `perProposer` contributes all of them.
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
  for (const list of byProposer.values()) {
    const pool = [...list];
    shuffle(pool, random);
    for (const c of pool.slice(0, perProposer)) {
      out.push({ candidateId: c.candidateId, proposer: c.proposer, findingId: c.findingId });
    }
  }
  return out;
}

/**
 * One passing candidate's id per finding per proposer, for `perProposer` findings chosen
 * from `findingIds` with the seed. A proposer with no passing candidate for a chosen
 * finding simply contributes nothing for it, so a proposer's share can come in under
 * `perProposer`.
 */
export function sampleRated<T extends { candidateId: string; proposer: string; findingId: string; passed: boolean }>(
  candidates: T[],
  findingIds: string[],
  perProposer: number,
  seed: number,
): string[] {
  const random = rng(seed);
  const shuffledFindings = [...findingIds];
  shuffle(shuffledFindings, random);
  const chosenFindings = shuffledFindings.slice(0, perProposer);

  const proposers = [...new Set(candidates.map((c) => c.proposer))];
  const byProposerFinding = new Map<string, T[]>();
  for (const c of candidates) {
    if (!c.passed) continue;
    const key = `${c.proposer}:${c.findingId}`;
    const list = byProposerFinding.get(key) ?? [];
    list.push(c);
    byProposerFinding.set(key, list);
  }

  const out: string[] = [];
  for (const proposer of proposers) {
    for (const findingId of chosenFindings) {
      const options = byProposerFinding.get(`${proposer}:${findingId}`);
      if (!options || options.length === 0) continue;
      out.push(options[0]!.candidateId);
    }
  }
  return out;
}

/**
 * Every candidate id where the adversary runs don't all agree, grouped by the sorted set
 * of runs whose verdict broke it (`true`): a candidate 4 of 5 runs pass and one breaks
 * groups with every other candidate that same one run alone breaks, regardless of what the
 * other runs said. At or under `cap`, every disagreement is returned; above it, a seeded
 * round-robin takes from each group in turn, so the sample spreads across the different
 * ways the runs split rather than favouring whichever group happens to be biggest.
 */
export function sampleDisagreements(verdicts: Map<string, Map<string, boolean>>, cap: number, seed: number): string[] {
  const groups = new Map<string, string[]>();
  for (const [candidateId, byRun] of verdicts) {
    const values = [...byRun.values()];
    if (values.every((v) => v === values[0])) continue; // every run agrees: not a disagreement
    const brokeBy = [...byRun.entries()]
      .filter(([, broke]) => broke)
      .map(([run]) => run)
      .sort();
    const key = JSON.stringify(brokeBy);
    const list = groups.get(key) ?? [];
    list.push(candidateId);
    groups.set(key, list);
  }

  const all = [...groups.values()].flat();
  if (all.length <= cap) return all;

  const random = rng(seed);
  const shuffledGroups = [...groups.values()].map((list) => {
    const copy = [...list];
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
