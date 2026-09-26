/**
 * Deterministic pilot fixtures shared by rate.ts and analyse.ts tests: a fake StageA (4
 * proposers x 16 findings x 3 candidates each, most passing, deterministic text, varied
 * `sampleIndexes`/`support` (rank-consistent: rank 0 always the most supported within its
 * finding and proposer), link tests (some consistent, some not, some refused, some none),
 * usage and entropy) and a fake StageB built on the real pool it draws (`samplePool`), with
 * 5 runs of made-up verdicts that disagree on about a third of the pool. A term match and an
 * unusable answer each land on a candidate that otherwise disagrees, a couple of candidates
 * get a safety stop, and some disagreeing candidates get several distinct counter-tests
 * across the runs that broke them (others share just the one). Every finding id is synthetic
 * (`f0`..`f15`), never a real census finding, so a test can shuffle, filter and hash this
 * data without ever touching the real dataset.
 */
import { NO_USAGE, type Usage } from "../../src/model.ts";
import { candidateIdOf, samplePool } from "../../src/pilot/sample.ts";
import { ADVERSARIES, PILOT_SEED, POOL_PER_PROPOSER, PROPOSERS } from "../../src/pilot/setups.ts";
import type { StageA, StageACandidate, StageAProposer, StageB, StageBVerdict } from "../../src/pilot/stages.ts";
import type { LinkResult } from "../../src/run.ts";
import type { Check, Outcome } from "../../src/vocabulary.ts";

const FINDINGS_PER_PROPOSER = 16;
const CANDIDATES_PER_FINDING = 3;

/** A distinct, deterministic data test for candidate `n`: only its threshold varies. */
function testFor(n: number): Check {
  return { check: "compare", left: { of: { unit: "self" }, field: "measure", year: 2024 }, op: ">", right: { value: n } };
}

/** Cycles through no link test, a consistent one, a not-consistent one, and a refused one. */
function linkTestFor(n: number): LinkResult | null {
  const base = { link: "together" as const, x: "measure", y: "other", year: 2024 as const, level: "commune" as const, direction: "positive" as const };
  switch (n % 4) {
    case 0:
      return null;
    case 1:
      return { ...base, verdict: "consistent", p: 0.01, effect: 0.5, size: 0.5, placeboEffects: [0.1, 0.05, 0.02] };
    case 2:
      return { ...base, verdict: "not consistent", p: 0.4, effect: 0.05, size: 0.05, placeboEffects: [0.1, 0.05, 0.02] };
    default:
      return { ...base, verdict: "refused", p: 1, effect: 0, size: 0, placeboEffects: [], reason: "not about this figure" };
  }
}

/**
 * 4 proposers x 16 findings x 3 candidates, deterministic claim/link/premise text ("claim
 * 7", "claim 7 fr", ...), most passing: only the first of every 9 (by finding and slot, the
 * same slots for every proposer) fails its data test. Within a finding and proposer, the 3
 * candidates' `support` decreases with `rank` (rank 0 the most supported), the way
 * `propose()`'s own merge always orders them, so a rank-based measure has something
 * consistent to read.
 */
export function fakeStageA(): StageA {
  const findingIds = Array.from({ length: FINDINGS_PER_PROPOSER }, (_, i) => `f${i}`);
  const candidates: StageACandidate[] = [];
  const proposers: StageAProposer[] = [];

  for (const [roleIndex, role] of PROPOSERS.entries()) {
    const usage: Usage = {
      input: 10_000 * (roleIndex + 1),
      output: 2_000 * (roleIndex + 1),
      cacheRead: 500 * (roleIndex + 1),
      cacheWrite: 100 * (roleIndex + 1),
      thinking: 0,
      costUsd: 0.5 * (roleIndex + 1),
    };
    const entropy: Record<string, number> = {};
    const unusable: Record<string, number> = {};

    for (const [fi, findingId] of findingIds.entries()) {
      entropy[findingId] = ((fi + roleIndex) % 4) / 3;
      unusable[findingId] = fi % 3 === 0 ? 1 : 0;
      const baseSupport = 3 + (fi % 3); // 3..5: the most-supported candidate at this finding
      for (let k = 0; k < CANDIDATES_PER_FINDING; k++) {
        const n = fi * CANDIDATES_PER_FINDING + k;
        const test = testFor(n);
        const passed = n % 9 !== 0;
        const support = baseSupport - k; // rank 0 (k=0) is always the most supported
        const outcome: Outcome = { status: passed ? "passed" : "failed", numbers: { value: n } };
        candidates.push({
          candidateId: candidateIdOf(findingId, role.id, test),
          proposer: role.id,
          findingId,
          candidate: {
            claim: { en: `claim ${n}`, fr: `claim ${n} fr` },
            link: { en: `link ${n}`, fr: `link ${n} fr` },
            premise: { en: `premise ${n}`, fr: `premise ${n} fr` },
            test,
            linkTest: null,
            artefact: false,
            support,
            samples: Array.from({ length: support }, (_, idx) => idx),
          },
          sampleIndexes: Array.from({ length: support }, (_, idx) => idx),
          rank: k,
          outcome,
          passed,
          link: linkTestFor(n),
        });
      }
    }

    proposers.push({
      id: role.id,
      role,
      replies: [],
      unusable,
      failed: roleIndex,
      safetyDrops: { blame: roleIndex % 2 },
      entropy,
      usage,
      ms: 2_000 * (roleIndex + 1),
      waitedMs: 100 * roleIndex,
      answered: [role.model],
    });
  }

  return { seed: PILOT_SEED, findingIds, proposers, candidates };
}

// A few pool indexes get a safety stop, and one each of a term match and an unusable
// answer land on a candidate that would otherwise be a genuine disagreement (index % 3 ===
// 0), so a test can see those exclusions actually remove a real disagreement rather than a
// candidate that was never going to be one anyway.
const SAFETY_STOPS: { index: number; run: string; category: string }[] = [
  { index: 3, run: "A3", category: "blame" },
  { index: 13, run: "A1", category: "individuals" },
];
const NO_ANSWER_INDEX = 9; // a disagreeing candidate (9 % 3 === 0): one run never answers
const NO_ANSWER_RUN = "A5";
const UNREADABLE_INDEX = 7; // pool index a run's answer can't be read
const UNREADABLE_RUN = "A2";
const TERM_MATCH_INDEX = 6; // a disagreeing candidate (6 % 3 === 0): the private terms would have caught it

function verdictFor(run: string, roleIndex: number, candidateId: string, i: number): StageBVerdict {
  const base = { run, candidateId, model: `model-${run}`, usage: NO_USAGE, ms: 5, waitedMs: 0 };

  const safety = SAFETY_STOPS.find((s) => s.index === i && s.run === run);
  if (safety) {
    return { ...base, survived: false, stage: "safety", category: safety.category, unusable: null, counter: null, counterOutcome: null, reason: `refused: ${safety.category}` };
  }
  if (i === NO_ANSWER_INDEX && run === NO_ANSWER_RUN) {
    return { ...base, survived: false, stage: "falsify", category: null, unusable: "no answer", counter: null, counterOutcome: null, reason: "the adversary didn't answer", model: null };
  }
  if (i === UNREADABLE_INDEX && run === UNREADABLE_RUN) {
    return { ...base, survived: false, stage: "falsify", category: null, unusable: "unreadable", counter: null, counterOutcome: null, reason: "the adversary's answer couldn't be read" };
  }

  // About a third of the pool splits between the 5 runs; the rest agree (every run
  // survives it), so `sampleDisagreements` finds real disagreements on roughly a third.
  const disagrees = i % 3 === 0;
  const broke = disagrees && (roleIndex + i) % 2 === 0;
  if (broke) {
    // Every other disagreeing candidate's breaking runs share one counter-test (so dedup
    // has something real to collapse); the others each get their own, by role, so an item
    // can carry several distinct counter-tests.
    const group = i / 3;
    const counter = group % 2 === 0 ? testFor(1000 + i) : testFor(2000 + i * 10 + roleIndex);
    return {
      ...base,
      survived: false,
      stage: "falsify",
      category: null,
      unusable: null,
      counter,
      counterOutcome: { status: "passed", numbers: { value: i } },
      reason: "the counter-test came out true",
    };
  }
  return { ...base, survived: true, stage: null, category: null, unusable: null, counter: null, counterOutcome: null, reason: "the counter-test failed or wasn't offered" };
}

/**
 * The real pool drawn from `a`'s passing candidates, and 5 runs of made-up verdicts over
 * it: about a third of the pool disagrees between runs, a couple of candidates get a safety
 * stop, one disagreeing candidate gets an unusable answer from one run, one disagreeing
 * candidate is flagged as a private term match (`termMatches`, independent of any run's own
 * verdict), and some disagreeing candidates carry several distinct counter-tests across the
 * runs that broke them.
 */
export function fakeStageB(a: StageA): StageB {
  const pool = samplePool(a.candidates, POOL_PER_PROPOSER, PILOT_SEED);
  const verdicts: StageBVerdict[] = [];
  for (const [roleIndex, role] of ADVERSARIES.entries()) {
    for (const [i, entry] of pool.entries()) {
      verdicts.push(verdictFor(role.id, roleIndex, entry.candidateId, i));
    }
  }
  const termMatches = pool.map((entry, i) => ({ candidateId: entry.candidateId, termMatch: i === TERM_MATCH_INDEX }));
  return { pool, verdicts, termMatches };
}
