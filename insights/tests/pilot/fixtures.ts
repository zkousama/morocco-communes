/**
 * Deterministic pilot fixtures shared by rate.ts and analyse.ts tests: a fake StageA and a
 * fake StageB built on the real pool it draws (`samplePool`).
 *
 * StageA: 4 proposers x 16 findings, deterministic claim/link/premise text ("claim 7",
 * "claim 7 fr", ...). Most findings get 3 candidates, but every other one gets 5, so ranks 3
 * and 4 exist for a rank-based measure to read. Within a finding and proposer, `support`
 * decreases with `rank` (rank 0 the most supported), the way `propose()`'s own merge always
 * orders them. `sampleIndexes` varies which sample first proposed a candidate (not always
 * sample 0), so a samples-found-so-far curve has something to rise across. `link` (the
 * judged link test) is only ever set on a candidate whose data test passed, and always
 * carries the same `LinkTest` its own `candidate.linkTest` proposed, the invariant stage A
 * itself keeps; a link test cycles through none, consistent, not consistent and refused.
 * Some data tests are refused (a tautology, an unknown field) or fail because the figure was
 * missing, rather than only ever a plain pass or fail. Every proposer's `replies` and
 * `answered` are consistent with each other. Every finding id is synthetic (`f0`..`f15`),
 * never a real census finding, so a test can shuffle, filter and hash this data without ever
 * touching the real dataset.
 *
 * StageB: 5 runs of made-up verdicts over that pool, disagreeing on about a third of it. A
 * term match and an unusable answer each land on a candidate that otherwise disagrees. A
 * couple of candidates get a safety stop. Some disagreeing candidates carry several distinct
 * counter-tests across the runs that broke them, others share just the one. Every pool
 * candidate ranked below the top 3 within its finding gets broken by A1 at least once, so a
 * rank-based measure has real breaks outside the top 3 to count, not just an empty set.
 *
 * Ratings: a finished rating of `ratingPlan(a, b, PILOT_SEED)`, every item answered: yes on
 * 7 reasons in 10 (no on 2, a skip on the last), sound on every other disagreement, each
 * counter-test judged in turn, and every drift item answered as its original was, bar one.
 */
import { NO_USAGE, type Usage } from "../../src/model.ts";
import type { LinkTest } from "../../src/links.ts";
import { ratingPlan, type Ratings } from "../../src/pilot/rate.ts";
import { candidateIdOf, samplePool } from "../../src/pilot/sample.ts";
import { ADVERSARIES, MAX_SAMPLES, PILOT_SEED, POOL_PER_PROPOSER, PROPOSERS } from "../../src/pilot/setups.ts";
import type { StageA, StageACandidate, StageAProposer, StageB, StageBVerdict } from "../../src/pilot/stages.ts";
import type { LinkResult } from "../../src/run.ts";
import type { Check, Outcome } from "../../src/vocabulary.ts";

const FINDINGS_PER_PROPOSER = 16;

/** Every other finding gets 5 candidates (so ranks 3 and 4 exist); the rest get 3. */
function candidateCountFor(fi: number): number {
  return fi % 2 === 0 ? 5 : 3;
}

/** A distinct, deterministic data test for candidate `n`: only its threshold varies. */
function testFor(n: number): Check {
  return { check: "compare", left: { of: { unit: "self" }, field: "measure", year: 2024 }, op: ">", right: { value: n } };
}

/** The link test a candidate proposes, or null: cycles through none and one spec. Set on `candidate.linkTest` regardless of whether the data test passed, the way a real proposal would be. */
function linkSpecFor(n: number): LinkTest | null {
  if (n % 4 === 0) return null;
  return { link: "together", x: "measure", y: "other", year: 2024, level: "commune", direction: "positive" };
}

/** The judged verdict for `spec`, cycling consistent, not consistent and refused. */
function linkResultFor(n: number, spec: LinkTest): LinkResult {
  switch (n % 4) {
    case 1:
      return { ...spec, verdict: "consistent", p: 0.01, effect: 0.5, size: 0.5, placeboEffects: [0.1, 0.05, 0.02] };
    case 2:
      return { ...spec, verdict: "not consistent", p: 0.4, effect: 0.05, size: 0.05, placeboEffects: [0.1, 0.05, 0.02] };
    default:
      return { ...spec, verdict: "refused", p: 1, effect: 0, size: 0, placeboEffects: [], reason: "not about this figure" };
  }
}

/**
 * A data test's outcome for candidate `n`: mostly passed, but every 9th cycles through a
 * refused tautology, a refused unknown field and a failure with a missing figure, so those
 * counts (and reasons) are never just zero.
 */
function outcomeFor(n: number): Outcome {
  if (n % 9 !== 0) return { status: "passed", numbers: { value: n } };
  const variant = (n / 9) % 3;
  if (variant === 0) return { status: "refused", reason: "tautology", numbers: {} };
  if (variant === 1) return { status: "refused", reason: "unknown field", numbers: {} };
  return { status: "failed", reason: "missing", numbers: {} };
}

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
    const replies: { model: string; promptHash: string }[] = [];
    let n = 0; // a continuous per-proposer counter, since findings no longer share one fixed candidate count

    for (const [fi, findingId] of findingIds.entries()) {
      entropy[findingId] = ((fi + roleIndex) % 4) / 3;
      unusable[findingId] = fi % 3 === 0 ? 1 : 0;
      for (let s = 0; s < MAX_SAMPLES; s++) replies.push({ model: role.model, promptHash: `hash-${role.id}-${findingId}-${s}` });

      const count = candidateCountFor(fi);
      const baseSupport = Math.min(MAX_SAMPLES, count + (fi % 3)); // enough room for `count` distinct descending values
      for (let k = 0; k < count; k++) {
        const test = testFor(n);
        const outcome = outcomeFor(n);
        const passed = outcome.status === "passed";
        const support = baseSupport - k; // rank 0 (k=0) is always the most supported
        // The first sample to propose this candidate isn't always sample 0, so a
        // samples-found-so-far curve has something to rise across rather than start at 1.0.
        const start = Math.min(n % 3, MAX_SAMPLES - support);
        const sampleIndexes = Array.from({ length: support }, (_, idx) => start + idx);
        const linkSpec = linkSpecFor(n);
        candidates.push({
          candidateId: candidateIdOf(findingId, role.id, test),
          proposer: role.id,
          findingId,
          candidate: {
            claim: { en: `claim ${n}`, fr: `claim ${n} fr` },
            link: { en: `link ${n}`, fr: `link ${n} fr` },
            premise: { en: `premise ${n}`, fr: `premise ${n} fr` },
            test,
            linkTest: linkSpec,
            artefact: false,
            support,
            samples: sampleIndexes,
          },
          sampleIndexes,
          rank: k,
          outcome,
          passed,
          // Stage A only ever judges and keeps a link result for a candidate whose data
          // test passed, and it's always the same spec `candidate.linkTest` proposed.
          link: passed && linkSpec ? linkResultFor(n, linkSpec) : null,
        });
        n++;
      }
    }

    proposers.push({
      id: role.id,
      role,
      replies,
      unusable,
      failed: roleIndex,
      safetyDrops: { blame: roleIndex % 2 },
      entropy,
      usage,
      ms: 2_000 * (roleIndex + 1),
      waitedMs: 100 * roleIndex,
      answered: [...new Set(replies.map((r) => r.model))].sort(),
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

function verdictFor(run: string, roleIndex: number, candidateId: string, i: number, rank: number): StageBVerdict {
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

  // A candidate ranked below the top 3 within its finding always gets broken by A1 at
  // least, regardless of the usual pattern below: without this, whether rule 6 (attacking
  // only the shown reasons) has any break outside the top 3 to count would be down to
  // chance, depending on which candidates `samplePool`'s own seeded draw happens to keep.
  if (rank >= 3 && run === "A1") {
    return {
      ...base,
      survived: false,
      stage: "falsify",
      category: null,
      unusable: null,
      counter: testFor(3000 + i),
      counterOutcome: { status: "passed", numbers: { value: i } },
      reason: "the counter-test came out true",
    };
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
 * verdict), some disagreeing candidates carry several distinct counter-tests across the runs
 * that broke them, and every candidate ranked below the top 3 gets broken by A1 at least.
 */
export function fakeStageB(a: StageA): StageB {
  const pool = samplePool(a.candidates, POOL_PER_PROPOSER, PILOT_SEED);
  const rankById = new Map(a.candidates.map((c) => [c.candidateId, c.rank]));
  const verdicts: StageBVerdict[] = [];
  for (const [roleIndex, role] of ADVERSARIES.entries()) {
    for (const [i, entry] of pool.entries()) {
      verdicts.push(verdictFor(role.id, roleIndex, entry.candidateId, i, rankById.get(entry.candidateId) ?? 0));
    }
  }
  const termMatches = pool.map((entry, i) => ({ candidateId: entry.candidateId, termMatch: i === TERM_MATCH_INDEX }));
  return { pool, verdicts, termMatches };
}

const ANSWERED_AT = "2026-09-26T00:00:00.000Z";
const flip = (answer: "yes" | "no"): "yes" | "no" => (answer === "yes" ? "no" : "yes");

/**
 * A finished rating over `ratingPlan(a, b, PILOT_SEED)`: every item answered, in plan order.
 * Reasons go yes, yes, ..., no, no, skip in tens (7 yes in 10); disagreements alternate
 * sound and unsound, their counter-tests cycling yes, no and skip; every drift item repeats
 * its original's answer except the first whose original wasn't a skip, which flips it.
 */
export function fakeRatings(a: StageA, b: StageB): Ratings {
  const items = ratingPlan(a, b, PILOT_SEED);
  const answers: Ratings["answers"] = [];
  const answerOf = new Map<string, "yes" | "no" | "skip">();
  let reasons = 0;
  let disagreements = 0;
  let flipped = false;
  for (const item of items) {
    if (item.kind === "reason") {
      const i = reasons++;
      const answer = i % 10 < 7 ? "yes" : i % 10 < 9 ? "no" : "skip";
      answers.push({ itemId: item.itemId, answer, at: ANSWERED_AT });
      answerOf.set(item.itemId, answer);
    } else if (item.kind === "disagreement") {
      const i = disagreements++;
      const answer = i % 2 === 0 ? "yes" : "no";
      const cycle = ["yes", "no", "skip"] as const;
      const counters = Object.fromEntries(item.counterIds.map((id, k) => [id, cycle[(i + k) % 3]!]));
      answers.push({ itemId: item.itemId, answer, counters, at: ANSWERED_AT });
      answerOf.set(item.itemId, answer);
    } else {
      const original = answerOf.get(item.of)!;
      const flipHere = !flipped && original !== "skip";
      if (flipHere) flipped = true;
      answers.push({ itemId: item.itemId, answer: flipHere ? flip(original) : original, at: ANSWERED_AT });
    }
  }
  return { items, answers };
}
