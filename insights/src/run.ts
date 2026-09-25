/**
 * Runs the whole pipeline over the dataset's findings and shapes what survives into the
 * files the API and site read. A finding is proposed, checked, tested across places and
 * argued against one after another; nothing about a hypothesis's fate is final until the
 * whole run's link tests have been judged together, since a link's p-value is only
 * meaningful against the batch it was corrected within. `pipeline` does the run and returns
 * it as data; `publishable` shapes a finished run into the files a later task writes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Data } from "./data.ts";
import { loadData } from "./data.ts";
import { detect, type Finding, type Kind } from "./detect.ts";
import { falsify, falsifierModel } from "./falsify.ts";
import { judgeLinks, runLink, type LinkOutcome, type LinkTest } from "./links.ts";
import { claudeTransport, hash, makeRunner, ollamaTransport, type Runner } from "./model.ts";
import { propose, type Candidate } from "./propose.ts";
import { breakdown, findingLine } from "./text.ts";
import { evaluate, type Check, type Outcome } from "./vocabulary.ts";
import type { Level } from "./fields.ts";

export interface Hypothesis {
  claim: { en: string; fr: string };
  link: { en: string; fr: string };
  premise: { en: string; fr: string };
  evidence: { kind: "data"; check: Check; numbers: Record<string, number> };
  linkTest: (LinkTest & { verdict: "consistent" | "not consistent" | "refused"; p: number; effect: number; placeboEffects: number[] }) | null;
  support: number;
  stage: "published" | "check" | "link" | "falsify" | "safety"; // where it stopped, or published
  reason: string | null;
}

export interface Item {
  finding: Finding;
  line: { en: string; fr: string };
  breakdown: ReturnType<typeof breakdown>;
  entropy: number;
  hypotheses: Hypothesis[];
  skipped: string | null;
}

export interface RunFile {
  startedAt: string;
  datasetVersion: string;
  models: { propose: string; falsify: string };
  stageVersions: Record<string, string>;
  items: Item[];
}

/** Bumped by hand when a prompt's parsing or merging changes, not when its wording does: the cache key already carries the prompt's own hash. */
const STAGE_VERSIONS: Record<string, string> = { propose: "1", falsify: "1" };

const LINK_NOT_CONSISTENT_REASON = "the link wasn't consistent across places";

function buildHypothesis(
  candidate: Candidate,
  outcome: Outcome,
  stage: Hypothesis["stage"],
  reason: string | null,
  linkTest: Hypothesis["linkTest"],
): Hypothesis {
  return {
    claim: candidate.claim,
    link: candidate.link,
    premise: candidate.premise,
    evidence: { kind: "data", check: candidate.test, numbers: outcome.numbers },
    linkTest,
    support: candidate.support,
    stage,
    reason,
  };
}

/** A link test's own fields, sorted: unlike a `Check`'s signature, none of them are floats that need rounding. */
function linkSignature(test: LinkTest): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(test).sort()) sorted[key] = (test as Record<string, unknown>)[key];
  return JSON.stringify(sorted);
}

/** A link test's seed, from the finding it belongs to and its own signature, so a re-run picks the same placebos. */
function linkSeed(findingId: string, test: LinkTest): number {
  return parseInt(hash(`${findingId}:${linkSignature(test)}`).slice(0, 8), 16);
}

/** A candidate still alive after `falsify`, waiting on a link verdict the whole run decides together. */
interface Pending {
  order: number;
  candidate: Candidate;
  outcome: Outcome;
  linkOutcomeIndex: number | null;
}

/**
 * Runs `detect`, then proposes, checks, link-tests and argues against every finding's
 * candidates in turn. Every link test in the run is collected as it comes up and judged
 * once, together, after the last finding, since `judgeLinks`'s correction only means
 * anything read across the whole batch; a hypothesis's stage and any link verdict are
 * settled only once that judgement is in.
 */
export async function pipeline(
  data: Data,
  options: { limit?: number; only?: string[]; run: Runner; falsifier: Runner; proposer: string; falsifierModel: string },
): Promise<RunFile> {
  const startedAt = new Date().toISOString();
  let findings = detect(data);
  if (options.only) findings = findings.filter((f) => options.only!.includes(f.code));
  if (options.limit != null) findings = findings.slice(0, options.limit);

  const items: Item[] = [];
  const decidedByItem: { order: number; hypothesis: Hypothesis }[][] = [];
  const pendingByItem: Pending[][] = [];
  const linkOutcomes: LinkOutcome[] = [];

  for (const finding of findings) {
    const line = findingLine(finding, data);
    const breakdownRows = breakdown(finding, data);

    if (finding.kind === "artefact") {
      items.push({ finding, line, breakdown: breakdownRows, entropy: 0, hypotheses: [], skipped: null });
      decidedByItem.push([]);
      pendingByItem.push([]);
      continue;
    }

    // Everything propose.ts, vocabulary.ts, links.ts and falsify.ts do here is written to
    // never throw on a bad model reply; this is one more net under that, so a bug in any
    // of them skips one finding with the error recorded, rather than losing the run.
    try {
      const proposal = await propose(finding, data, options.run, options.proposer);
      const decided: { order: number; hypothesis: Hypothesis }[] = [];
      const pending: Pending[] = [];

      for (const [order, candidate] of proposal.candidates.entries()) {
        const outcome = evaluate(candidate.test, finding, data);
        if (outcome.status !== "passed") {
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, "check", outcome.reason ?? "the test failed", null) });
          continue;
        }

        let linkOutcomeIndex: number | null = null;
        if (candidate.linkTest) {
          linkOutcomeIndex = linkOutcomes.length;
          linkOutcomes.push(runLink(candidate.linkTest, data, linkSeed(finding.id, candidate.linkTest)));
        }

        const verdict = await falsify(candidate, finding, data, options.falsifier, options.falsifierModel);
        if (!verdict.survived) {
          // A killed-by-refusal verdict never carries a counter-test; only a counter-test
          // that came out true does, which is what "falsify" means here.
          const stage = verdict.counter ? "falsify" : "safety";
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, stage, verdict.reason, null) });
          continue;
        }

        pending.push({ order, candidate, outcome, linkOutcomeIndex });
      }

      items.push({ finding, line, breakdown: breakdownRows, entropy: proposal.entropy, hypotheses: [], skipped: proposal.skipped ?? null });
      decidedByItem.push(decided);
      pendingByItem.push(pending);
    } catch (error) {
      items.push({
        finding,
        line,
        breakdown: breakdownRows,
        entropy: 0,
        hypotheses: [],
        skipped: error instanceof Error ? error.message : String(error),
      });
      decidedByItem.push([]);
      pendingByItem.push([]);
    }
  }

  const verdicts = judgeLinks(linkOutcomes);

  for (let i = 0; i < items.length; i++) {
    const decided = decidedByItem[i]!;
    const eligible: { order: number; candidate: Candidate; outcome: Outcome; linkTest: Hypothesis["linkTest"] }[] = [];

    for (const entry of pendingByItem[i]!) {
      if (entry.linkOutcomeIndex == null) {
        eligible.push({ order: entry.order, candidate: entry.candidate, outcome: entry.outcome, linkTest: null });
        continue;
      }
      const outcome = linkOutcomes[entry.linkOutcomeIndex]!;
      const verdict = verdicts[entry.linkOutcomeIndex]!;
      const linkTest = { ...entry.candidate.linkTest!, verdict, p: outcome.p, effect: outcome.effect, placeboEffects: outcome.placeboEffects };
      if (verdict === "not consistent") {
        decided.push({ order: entry.order, hypothesis: buildHypothesis(entry.candidate, entry.outcome, "link", LINK_NOT_CONSISTENT_REASON, linkTest) });
      } else {
        eligible.push({ order: entry.order, candidate: entry.candidate, outcome: entry.outcome, linkTest });
      }
    }

    // Every survivor is published here; `publishable()` is what caps what a unit's file
    // shows to the 3 with the highest support.
    for (const e of eligible) {
      decided.push({ order: e.order, hypothesis: buildHypothesis(e.candidate, e.outcome, "published", null, e.linkTest) });
    }

    items[i]!.hypotheses = decided.sort((a, b) => a.order - b.order).map((d) => d.hypothesis);
  }

  return {
    startedAt,
    datasetVersion: data.version,
    models: { propose: options.proposer, falsify: options.falsifierModel },
    stageVersions: STAGE_VERSIONS,
    items,
  };
}

const COLLECTION: Record<Level, string> = {
  region: "regions",
  province: "provinces",
  commune: "communes",
  arrondissement: "arrondissements",
};

interface UnitFile {
  code: string;
  level: Level;
  name: { fr: string; ar: string | null };
  datasetVersion: string;
  checkedAt: string;
  findings: {
    id: string;
    kind: Kind;
    measure: string;
    line: { en: string; fr: string };
    breakdown: ReturnType<typeof breakdown>;
    hypotheses: Hypothesis[];
  }[];
}

/** A unit's file shows at most this many hypotheses per finding, the ones with the highest support. */
const PUBLISHED_CAP = 3;

/**
 * Shapes a finished run into the files `data/v1/insights/` holds: one per unit that has an
 * artefact finding or a finding with at least one published hypothesis, and an index over
 * all of them. `data` defaults to a fresh load for a caller that doesn't have one on hand;
 * a caller that does (the CLI, a test) passes its own rather than paying for a second load.
 * A finding whose unit isn't in `data` is left out rather than failing the whole run.
 */
export function publishable(file: RunFile, data: Data = loadData()): Map<string, object> {
  const checkedAt = file.startedAt.slice(0, 10);

  const units = new Map<string, UnitFile>();
  for (const item of file.items) {
    const published = item.hypotheses.filter((h) => h.stage === "published").slice(0, PUBLISHED_CAP);
    if (item.finding.kind !== "artefact" && published.length === 0) continue;

    const code = item.finding.code;
    let unitFile = units.get(code);
    if (!unitFile) {
      const unit = data.units.get(code);
      if (!unit) continue;
      unitFile = {
        code,
        level: item.finding.level,
        name: unit.name,
        datasetVersion: file.datasetVersion,
        checkedAt,
        findings: [],
      };
      units.set(code, unitFile);
    }
    unitFile.findings.push({
      id: item.finding.id,
      kind: item.finding.kind,
      measure: item.finding.measure,
      line: item.line,
      breakdown: item.breakdown,
      hypotheses: published,
    });
  }

  const out = new Map<string, object>();
  for (const unitFile of units.values()) out.set(`${COLLECTION[unitFile.level]}/${unitFile.code}.json`, unitFile);
  out.set(
    "index.json",
    [...units.values()].map((u) => ({ code: u.code, level: u.level, findings: u.findings.length })),
  );
  return out;
}

async function main(): Promise<void> {
  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error("pnpm insights needs INSIGHTS_LIVE=1: it would spend real calls against a subscription");
  }

  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limit = option("limit") ? Number(option("limit")) : undefined;
  const only = option("only")?.split(",");

  const data = loadData();
  const proposer = "sonnet";
  const falsifierChoice = falsifierModel(process.env, proposer);
  const cacheDir = ".cache/insights/cache";
  const cacheOptions = { cacheDir, datasetVersion: data.version, stageVersions: STAGE_VERSIONS };
  const run = makeRunner(claudeTransport(), cacheOptions);
  const falsifierTransport = falsifierChoice.transport === "ollama" ? ollamaTransport() : claudeTransport();
  const falsifier = makeRunner(falsifierTransport, cacheOptions);

  const file = await pipeline(data, { limit, only, run, falsifier, proposer, falsifierModel: falsifierChoice.model });

  const runsDir = ".cache/insights/runs";
  await mkdir(runsDir, { recursive: true });
  const body = JSON.stringify(file, null, 2);
  await writeFile(join(runsDir, `${file.startedAt}.json`), body);
  await writeFile(join(runsDir, "latest.json"), body);

  let candidates = 0;
  let published = 0;
  const stopped = new Map<string, number>();
  for (const item of file.items) {
    for (const h of item.hypotheses) {
      candidates++;
      if (h.stage === "published") published++;
      else stopped.set(h.stage, (stopped.get(h.stage) ?? 0) + 1);
    }
  }
  console.log(`findings: ${file.items.length}`);
  console.log(`candidates: ${candidates}`);
  console.log(`published: ${published}`);
  for (const [stage, count] of stopped) console.log(`${stage}: ${count}`);
}

// Runs the pipeline when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
