/**
 * Deterministic pilot fixtures shared by rate.ts and analyse.ts tests: a fake StageA (4
 * proposers x 16 findings x 3 candidates each, most passing, deterministic text) and a fake
 * StageB built on the real pool it draws (`samplePool`), with 5 runs of made-up verdicts
 * that disagree on about a third of the pool, a few safety stops, some unusable answers and
 * one term match. Every finding id is synthetic (`f0`..`f15`), never a real census finding,
 * so a test can shuffle, filter and hash this data without ever touching the real dataset.
 */
import { NO_USAGE } from "../../src/model.ts";
import { candidateIdOf, samplePool } from "../../src/pilot/sample.ts";
import { ADVERSARIES, PILOT_SEED, POOL_PER_PROPOSER, PROPOSERS } from "../../src/pilot/setups.ts";
import type { StageA, StageACandidate, StageAProposer, StageB, StageBVerdict } from "../../src/pilot/stages.ts";
import type { Check, Outcome } from "../../src/vocabulary.ts";

const FINDINGS_PER_PROPOSER = 16;
const CANDIDATES_PER_FINDING = 3;

/** A distinct, deterministic data test for candidate `n`: only its threshold varies. */
function testFor(n: number): Check {
  return { check: "compare", left: { of: { unit: "self" }, field: "measure", year: 2024 }, op: ">", right: { value: n } };
}

/**
 * 4 proposers x 16 findings x 3 candidates, deterministic claim/link/premise text ("claim
 * 7", "claim 7 fr", ...), most passing: only the first of every 9 (by finding and slot,
 * the same slots for every proposer) fails its data test.
 */
export function fakeStageA(): StageA {
  const findingIds = Array.from({ length: FINDINGS_PER_PROPOSER }, (_, i) => `f${i}`);
  const candidates: StageACandidate[] = [];
  const proposers: StageAProposer[] = [];

  for (const role of PROPOSERS) {
    for (const [fi, findingId] of findingIds.entries()) {
      for (let k = 0; k < CANDIDATES_PER_FINDING; k++) {
        const n = fi * CANDIDATES_PER_FINDING + k;
        const test = testFor(n);
        const passed = n % 9 !== 0;
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
            support: 1,
            samples: [0],
          },
          sampleIndexes: [0],
          rank: k,
          outcome,
          passed,
          link: null,
        });
      }
    }
    proposers.push({
      id: role.id,
      role,
      replies: [],
      unusable: {},
      failed: 0,
      safetyDrops: {},
      entropy: {},
      usage: NO_USAGE,
      ms: 0,
      waitedMs: 0,
      answered: [role.model],
    });
  }

  return { seed: PILOT_SEED, findingIds, proposers, candidates };
}

// A few pool indexes get a safety stop or an unusable answer from one run, and one is
// flagged as a private term match: "a few"/"some", never just the one instance of each.
const SAFETY_STOPS: { index: number; run: string; category: string }[] = [
  { index: 3, run: "A3", category: "blame" },
  { index: 13, run: "A1", category: "individuals" },
];
const NO_ANSWER_INDEX = 5; // pool index a run never answers
const NO_ANSWER_RUN = "A5";
const UNREADABLE_INDEX = 7; // pool index a run's answer can't be read
const UNREADABLE_RUN = "A2";
const TERM_MATCH_INDEX = 2; // pool index the private terms would have caught

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
    const counter = testFor(1000 + i);
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
 * it: about a third of the pool disagrees between runs, a couple of candidates get a
 * safety stop, a couple get an unusable answer, and one candidate is flagged as a private
 * term match (`termMatches`), independent of any run's own verdict.
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
