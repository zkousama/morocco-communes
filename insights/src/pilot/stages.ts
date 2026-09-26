/**
 * Stage A: each of the pilot's 4 proposer setups (`PROPOSERS`) is asked the pipeline's own
 * proposer question on the same findings, `SAMPLES` samples each, exactly as `propose()` does
 * for the full pipeline. Every candidate keeps which proposer and finding it came from, which
 * samples proposed it, its own data test's outcome and, only when that test passed and its
 * link test is about the finding (`aboutThisFinding`), a link verdict, judged with
 * `judgeLinks` across that proposer's own candidates only, never mixed with another
 * proposer's.
 *
 * Proposers run one after another, each over its findings `options.concurrency` at a time
 * through `mapPool`, which hands results back in finding order regardless of when they
 * finish. The candidates collected across findings and proposers are still sorted again at
 * the end (proposer order, then finding order, then candidate id), so the file this produces
 * never depends on how the concurrent calls happened to complete.
 */
import type { Data } from "../data.ts";
import type { Finding } from "../detect.ts";
import { addUsage, hash, NO_USAGE, type Runner, type Usage } from "../model.ts";
import { mapPool } from "../pool.ts";
import { propose, type Candidate, type Proposal } from "../propose.ts";
import { judgeLinks, runLink } from "../links.ts";
import { aboutThisFinding, type LinkResult } from "../run.ts";
import { evaluate, type Outcome } from "../vocabulary.ts";
import { candidateIdOf } from "./sample.ts";
import { PILOT_SEED, PROPOSERS, type PilotRole } from "./setups.ts";

export interface StageACandidate {
  candidateId: string;
  proposer: string;
  findingId: string;
  candidate: Candidate;
  sampleIndexes: number[]; // which of the samples proposed it
  outcome: Outcome;
  passed: boolean; // the data test
  link: LinkResult | null;
}

export interface StageAProposer {
  id: string;
  role: PilotRole;
  replies: Proposal["replies"]; // every sample's reply, across every finding this proposer saw
  unusable: number; // samples that gave no valid hypothesis at all, summed across findings
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

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
 */
export async function runStageA(
  data: Data,
  findings: Finding[],
  runners: Map<string, Runner>,
  options: { concurrency: number; terms: RegExp | null; onCandidates?: (proposer: string, findingId: string, count: number) => void },
): Promise<StageA> {
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const proposers: StageAProposer[] = [];
  const candidates: StageACandidate[] = [];

  for (const role of PROPOSERS) {
    const runner = runners.get(role.id);
    if (!runner) throw new Error(`runStageA: no runner for proposer "${role.id}"`);

    const spent = { usage: NO_USAGE, ms: 0 };
    const tracked: Runner = async (call) => {
      const reply = await runner(call);
      spent.usage = addUsage(spent.usage, reply.usage);
      spent.ms += reply.ms;
      return reply;
    };

    const oneFinding = async (finding: Finding): Promise<FindingResult> => {
      const proposal = await propose(finding, data, tracked, role, options.terms);
      const findingCandidates: StageACandidate[] = proposal.candidates.map((candidate) => {
        const candidateId = candidateIdOf(finding.id, role.id, candidate.test);
        const outcome = evaluate(candidate.test, finding, data);
        return {
          candidateId,
          proposer: role.id,
          findingId: finding.id,
          candidate,
          sampleIndexes: candidate.samples,
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

    const replies: Proposal["replies"] = [];
    const safetyDrops: Record<string, number> = {};
    const entropy: Record<string, number> = {};
    let unusable = 0;
    const proposerCandidates: StageACandidate[] = [];
    for (const [index, result] of results.entries()) {
      const finding = findings[index]!;
      replies.push(...result.replies);
      unusable += result.unusable;
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
    // Seeded off the candidate's own id, so a re-run of the same finding, proposer and test
    // picks the same placebos, without reaching into links.ts's or run.ts's own private seed.
    const outcomes = eligible.map((c) => runLink(c.candidate.linkTest!, data, parseInt(hash(c.candidateId).slice(0, 8), 16)));
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
      safetyDrops,
      entropy,
      usage: spent.usage,
      ms: spent.ms,
      answered: [...new Set(replies.map((r) => r.model))].sort(),
    });
  }

  // The output must not depend on completion order: sorted by proposer order, then finding
  // order, then candidate id, so it reads the same at any concurrency.
  const proposerOrder = new Map(PROPOSERS.map((p, i) => [p.id, i]));
  const findingOrder = new Map(findings.map((f, i) => [f.id, i]));
  candidates.sort(
    (a, b) =>
      proposerOrder.get(a.proposer)! - proposerOrder.get(b.proposer)! ||
      findingOrder.get(a.findingId)! - findingOrder.get(b.findingId)! ||
      byString(a.candidateId, b.candidateId),
  );

  return { seed: PILOT_SEED, findingIds: findings.map((f) => f.id), proposers, candidates };
}
