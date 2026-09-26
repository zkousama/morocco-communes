/**
 * Stage A: each of the pilot's 4 proposer setups (`PROPOSERS`) is asked the pipeline's own
 * proposer question on the same findings, `SAMPLES` samples each, exactly as `propose()` does
 * for the full pipeline. Every candidate keeps which proposer and finding it came from, which
 * samples proposed it, propose's own rank for it (support, then first proposed), its own data
 * test's outcome and, only when that test passed and its link test is about the finding
 * (`aboutThisFinding`), a link verdict, judged with `judgeLinks` across that proposer's own
 * candidates only, never mixed with another proposer's.
 *
 * A halt is shared across every proposer and finding, the pilot's own version of `run.ts`'s
 * `stopAfterFailures`: a fatal error, a `LimitError` (`withRetries` has already waited that
 * one out), or `STOP_AFTER_FAILURES` failures in a row sets it, and once set every later call
 * fails at once without touching the real transport again. After each proposer's own
 * `mapPool` finishes, `runStageA` checks the halt and throws with its reason if it's set, so
 * this never returns a partial result: the answers already cached stay there for a resumed
 * run to reuse. A stage this size runs unattended for hours, so it has to stop clearly rather
 * than write a complete-looking file over a run that never really finished.
 *
 * Resuming must not re-ask a question the model already answered, even one that came back
 * unusable: `propose()`'s own `accept` keeps `makeRunner` from caching an answer it can't
 * read, which is right for the full pipeline (a fresh run gets another try) but wrong for a
 * fixed, reproducible pilot sample. Stage A's own wrapper strips `accept` before the call
 * reaches the cache, so every answer, good or bad, is cached once and replayed identically on
 * a re-run, rather than asked again and possibly answered differently the second time.
 *
 * Proposers run one after another, each over its findings `options.concurrency` at a time
 * through `mapPool`, which hands results back in finding order regardless of when they
 * finish. The candidates collected across findings and proposers are sorted again at the end
 * (proposer order, then finding order, then propose's own rank), a documented guarantee of
 * the output rather than something left to how today's loops happen to build it.
 */
import type { Data } from "../data.ts";
import type { Finding } from "../detect.ts";
import { addUsage, classify, LimitError, messageOf, NO_USAGE, type Runner, type Usage } from "../model.ts";
import { mapPool } from "../pool.ts";
import { propose, type Candidate, type Proposal } from "../propose.ts";
import { judgeLinks, runLink } from "../links.ts";
import { aboutThisFinding, linkSeed, STOP_AFTER_FAILURES, type LinkResult } from "../run.ts";
import { evaluate, type Outcome } from "../vocabulary.ts";
import { candidateIdOf } from "./sample.ts";
import { PILOT_SEED, PROPOSERS, type PilotRole } from "./setups.ts";

export interface StageACandidate {
  candidateId: string;
  proposer: string;
  findingId: string;
  candidate: Candidate;
  sampleIndexes: number[]; // which of the samples proposed it
  rank: number; // its index in propose()'s own order for this finding: support, then first proposed
  outcome: Outcome;
  passed: boolean; // the data test
  link: LinkResult | null;
}

export interface StageAProposer {
  id: string;
  role: PilotRole;
  replies: Proposal["replies"]; // every sample's reply, across every finding this proposer saw
  unusable: Record<string, number>; // samples that gave no valid hypothesis at all, by finding id
  failed: number; // calls that threw, summed across findings
  safetyDrops: Record<string, number>; // hypotheses the safety check dropped, by category, summed across findings
  entropy: Record<string, number>; // this proposer's semantic entropy on each finding, keyed by finding id
  usage: Usage; // every call's tokens and cost, summed
  ms: number; // every call's time, summed
  answered: string[]; // every resolved model id (`reply.model`) a reply came back with, sorted and distinct
}

export interface StageA {
  seed: number;
  findingIds: string[];
  proposers: StageAProposer[];
  candidates: StageACandidate[];
}

/** One finding's share of one proposer's run, kept whole so it can be combined in finding order once `mapPool` is done. */
interface FindingResult {
  replies: Proposal["replies"];
  unusable: number;
  refusals: Record<string, number>;
  entropy: number;
  candidates: StageACandidate[];
}

/**
 * Runs every proposer in `PROPOSERS` on the same `findings`, one proposer after another,
 * each finding's own 5 calls made through `runners.get(role.id)`. `options.onCandidates`,
 * when given, is called once a finding is done for a proposer, with how many candidates it
 * gave, so a caller can print progress without this function knowing how to print anything.
 *
 * Throws when a proposer is missing from `runners` (checked before the first call, so a
 * missing setup is never discovered only after the ones before it in `PROPOSERS` have
 * already spent real calls) or when the shared halt trips (see the file's own comment).
 */
export async function runStageA(
  data: Data,
  findings: Finding[],
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null; onCandidates?: (proposer: string, findingId: string, count: number) => void },
): Promise<StageA> {
  const missing = PROPOSERS.filter((p) => !runners.has(p.id)).map((p) => p.id);
  if (missing.length > 0) {
    throw new Error(`runStageA: no runner for proposer${missing.length > 1 ? "s" : ""} ${missing.map((id) => `"${id}"`).join(", ")}`);
  }

  const findingById = new Map(findings.map((f) => [f.id, f]));
  const proposers: StageAProposer[] = [];
  const candidates: StageACandidate[] = [];

  // Shared across every proposer and finding: a subscription's own limit, or a missing
  // binary, means nothing later stands a better chance either.
  const halt: { reason: string | null } = { reason: null };
  let inARow = 0;

  for (const role of PROPOSERS) {
    const runner = runners.get(role.id)!;

    const spent = { usage: NO_USAGE, ms: 0 };
    let failed = 0;
    const tracked: Runner = async (call) => {
      if (halt.reason) throw new Error(halt.reason);
      try {
        // Stripped of `accept`, so an answer that comes back unusable is still cached and
        // replayed exactly on a resumed run, rather than asked again every time.
        const reply = await runner({ ...call, accept: undefined });
        spent.usage = addUsage(spent.usage, reply.usage);
        spent.ms += reply.ms;
        inARow = 0;
        return reply;
      } catch (error) {
        failed++;
        if (classify(error) === "fatal") {
          halt.reason = `a proposer call failed: ${messageOf(error)}`;
        } else if (error instanceof LimitError) {
          halt.reason = `a proposer's usage limit didn't reset in time: ${messageOf(error)}`;
        } else {
          inARow++;
          if (inARow >= STOP_AFTER_FAILURES) {
            halt.reason = `${STOP_AFTER_FAILURES} proposer calls in a row failed, the last with: ${messageOf(error)}`;
          }
        }
        throw error;
      }
    };

    const oneFinding = async (finding: Finding): Promise<FindingResult> => {
      const proposal = await propose(finding, data, tracked, role, options.terms);
      const findingCandidates: StageACandidate[] = proposal.candidates.map((candidate, rank) => {
        const candidateId = candidateIdOf(finding.id, role.id, candidate.test);
        const outcome = evaluate(candidate.test, finding, data);
        return {
          candidateId,
          proposer: role.id,
          findingId: finding.id,
          candidate,
          sampleIndexes: candidate.samples,
          rank,
          outcome,
          passed: outcome.status === "passed",
          link: null,
        };
      });
      options.onCandidates?.(role.id, finding.id, findingCandidates.length);
      return {
        replies: proposal.replies,
        unusable: proposal.unusable,
        refusals: proposal.refusals,
        entropy: proposal.entropy,
        candidates: findingCandidates,
      };
    };

    const results = await mapPool(findings, options.concurrency, oneFinding);
    // Nothing partial is ever returned: the answers already cached stay there for a resumed
    // run to pick straight back up from.
    if (halt.reason) throw new Error(halt.reason);

    const replies: Proposal["replies"] = [];
    const safetyDrops: Record<string, number> = {};
    const entropy: Record<string, number> = {};
    const unusable: Record<string, number> = {};
    const proposerCandidates: StageACandidate[] = [];
    for (const [index, result] of results.entries()) {
      const finding = findings[index]!;
      replies.push(...result.replies);
      unusable[finding.id] = result.unusable;
      for (const [category, count] of Object.entries(result.refusals)) {
        safetyDrops[category] = (safetyDrops[category] ?? 0) + count;
      }
      entropy[finding.id] = result.entropy;
      proposerCandidates.push(...result.candidates);
    }

    // Link tests, judged together across this proposer's own candidates only, and only for
    // a candidate whose data test passed and whose link test is about the finding: exactly
    // what the full pipeline requires before a link test is ever run at all.
    const eligible = proposerCandidates.filter((c) => {
      const linkTest = c.candidate.linkTest;
      return c.passed && linkTest !== null && aboutThisFinding(linkTest, c.candidate.test, findingById.get(c.findingId)!);
    });
    // Shared with the full pipeline's own seed, keyed on the finding and the link test alone
    // (never the proposer), so the same link test gets the same placebos whichever proposer
    // offered it.
    const outcomes = eligible.map((c) => runLink(c.candidate.linkTest!, data, linkSeed(c.findingId, c.candidate.linkTest!)));
    const verdicts = judgeLinks(outcomes);
    eligible.forEach((c, i) => {
      const outcome = outcomes[i]!;
      const verdict = verdicts[i]!;
      c.link = {
        ...c.candidate.linkTest!,
        verdict,
        p: outcome.p,
        effect: outcome.effect,
        size: outcome.size,
        placeboEffects: outcome.placeboEffects,
        ...(outcome.refused ? { reason: outcome.refused } : {}),
      };
    });

    candidates.push(...proposerCandidates);
    proposers.push({
      id: role.id,
      role,
      replies,
      unusable,
      failed,
      safetyDrops,
      entropy,
      usage: spent.usage,
      ms: spent.ms,
      answered: [...new Set(replies.map((r) => r.model))].sort(),
    });
  }

  // Already produced in this order by construction (proposers run one after another, and
  // `mapPool` hands each proposer's results back in finding order, propose's own candidate
  // order preserved within them); sorted again here so that stays a documented guarantee of
  // the output, not an accident of how it happens to be built today.
  const proposerOrder = new Map(PROPOSERS.map((p, i) => [p.id, i]));
  const findingOrder = new Map(findings.map((f, i) => [f.id, i]));
  candidates.sort(
    (a, b) =>
      proposerOrder.get(a.proposer)! - proposerOrder.get(b.proposer)! ||
      findingOrder.get(a.findingId)! - findingOrder.get(b.findingId)! ||
      a.rank - b.rank,
  );

  return { seed: PILOT_SEED, findingIds: findings.map((f) => f.id), proposers, candidates };
}
