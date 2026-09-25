/**
 * Runs the whole pipeline over the dataset's findings and shapes what survives into the
 * files the API and site read. A finding is proposed, checked, tested across places and
 * argued against one after another; nothing about a hypothesis's fate is final until the
 * whole run's link tests have been judged together, since a link's p-value is only
 * meaningful against the batch it was corrected within. `pipeline` does the run and returns
 * it as data; `publishable` shapes a finished run into the files a later task writes.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { read, sinceDate } from "../../site/scripts/attention.ts";
import type { Data } from "./data.ts";
import { loadData } from "./data.ts";
import { detect, type Finding, type Kind } from "./detect.ts";
import { falsify, falsifierModel, NO_ANSWER, PROMPT_HASH as FALSIFY_PROMPT_HASH, UNREADABLE } from "./falsify.ts";
import { judgeLinks, runLink, type LinkOutcome, type LinkTest } from "./links.ts";
import { claudeTransport, hash, makeRunner, ollamaTransport, type Runner } from "./model.ts";
import { propose, PROMPT_HASH as PROPOSE_PROMPT_HASH, type Candidate, type Proposal } from "./propose.ts";
import { guard, METRICS_PATH, type Metrics } from "./score.ts";
import { breakdown, findingLine } from "./text.ts";
import { newIds, traceparent, exportSpans, type Span } from "./trace.ts";
import { evaluate, fieldsRead, type Check, type Outcome } from "./vocabulary.ts";
import { familyOf, type Level } from "./fields.ts";

/** A link test as it was judged: `reason` says why a refused one couldn't be run. */
export type LinkResult = LinkTest & {
  verdict: "consistent" | "not consistent" | "refused";
  p: number;
  effect: number;
  placeboEffects: number[];
  reason?: string;
};

export interface Hypothesis {
  claim: { en: string; fr: string };
  link: { en: string; fr: string };
  premise: { en: string; fr: string };
  evidence: { kind: "data"; check: Check; numbers: Record<string, number> };
  linkTest: LinkResult | null;
  support: number;
  stage: "published" | "check" | "link" | "falsify" | "safety"; // where it stopped, or published
  reason: string | null;
  adversary: { model: string; reason: string } | null; // the model that argued against it and what it said; null when none did
}

export interface Item {
  finding: Finding;
  line: { en: string; fr: string };
  breakdown: ReturnType<typeof breakdown>;
  entropy: number;
  replies: Proposal["replies"]; // the model and prompt behind each of the proposal's samples
  hypotheses: Hypothesis[];
  skipped: string | null;
}

export interface RunFile {
  runId: string;
  startedAt: string;
  partial: boolean; // true when --limit or --only left findings out, or the run stopped early
  stopped: string | null; // why the run stopped before its last finding, when it did
  datasetVersion: string;
  models: { propose: string; falsify: string; answered: string[] }; // the aliases asked for, and every id that answered
  stageVersions: Record<string, string>;
  items: Item[];
  spans: Span[];
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
  adversary: Hypothesis["adversary"] = null,
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
    adversary,
  };
}

/**
 * A short id for a run, from everything that decides what it could produce: when it
 * started, both prompts, the stage versions, the dataset and the models asked for. Grades
 * and metrics carry it, so a graded set is only ever read against the run it was drawn from.
 */
function runIdOf(startedAt: string, datasetVersion: string, models: { propose: string; falsify: string }): string {
  return hash(JSON.stringify([startedAt, [PROPOSE_PROMPT_HASH, FALSIFY_PROMPT_HASH], STAGE_VERSIONS, datasetVersion, models])).slice(0, 12);
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
  linkRefused: string | null; // why its link test was never run, when it has one
  adversary: Hypothesis["adversary"];
}

/**
 * Orders findings by what people open: the page views their unit had in the last 30 days,
 * most first, then by score, so a batch that can't run everything spends its calls on the
 * places people actually look at. A unit with no rows in `views` counts as 0.
 */
export function orderByDemand<T extends { code: string; score: number }>(findings: T[], views: Map<string, number>): T[] {
  return [...findings].sort((a, b) => (views.get(b.code) ?? 0) - (views.get(a.code) ?? 0) || b.score - a.score);
}

const NOT_ABOUT_THIS_FIGURE = "not about this figure";

/**
 * Whether a candidate's link test is about the figure it's meant to explain, and so worth
 * running at all; one that isn't is refused, "not about this figure". Its outcome has to be
 * the finding's own measure, read at the finding's own level. Its premise has to be a field
 * the candidate's own data test reads, so the link tested is the one the checked premise
 * stands on, and outside the measure's family, since a figure paired with itself or with
 * another part of the same whole goes with it by construction. A change finding's
 * `together` test has to pair changes too: a 2024 pattern says nothing about why a figure
 * moved.
 */
export function aboutThisFinding(test: LinkTest, check: Check, finding: Finding): boolean {
  const [premise, outcome] = test.link === "together" ? [test.x, test.y] : [test.premise, test.outcome];
  if (outcome !== finding.measure || test.level !== finding.level) return false;
  if (!fieldsRead(check).includes(premise) || familyOf(finding.measure).has(premise)) return false;
  if (finding.kind === "change" && test.link === "together" && test.year !== "change") return false;
  return true;
}

/** How many calls in a row may fail before a run stops: past a subscription's limit, every call fails the same way. */
export const STOP_AFTER_FAILURES = 3;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * `run`, counting the calls that fail in a row. The one that makes `STOP_AFTER_FAILURES`
 * sets `halt.reason`, and from then on nothing is called at all, by this runner or any
 * other sharing the same `halt`: each call fails straight away with that reason instead.
 */
function stopAfterFailures(run: Runner, who: string, halt: { reason: string | null }): Runner {
  let inARow = 0;
  return async (call) => {
    if (halt.reason) throw new Error(halt.reason);
    try {
      const reply = await run(call);
      inARow = 0;
      return reply;
    } catch (error) {
      inARow++;
      if (inARow >= STOP_AFTER_FAILURES) halt.reason = `${STOP_AFTER_FAILURES} ${who} calls in a row failed, the last with: ${messageOf(error)}`;
      throw error;
    }
  };
}

/** The earliest start and latest end passed to `record`, for a span with no one call of its own to wrap; `started` says whether anything ever was. */
function spanAccumulator() {
  let start: number | null = null;
  let end = 0;
  return {
    record(t0: number, t1: number): void {
      if (start === null) start = t0;
      end = t1;
    },
    started: (): boolean => start !== null,
    range: (): { start: number; end: number } => ({ start: start ?? 0, end }),
  };
}

/**
 * Runs `detect`, then proposes, checks, link-tests and argues against every finding's
 * candidates in turn. Every link test in the run is collected as it comes up and judged
 * once, together, after the last finding, since `judgeLinks`'s correction only means
 * anything read across the whole batch; a hypothesis's stage and any link verdict are
 * settled only once that judgement is in.
 *
 * Traces itself as it goes: a span per stage, and one per finding under `propose` and
 * `falsify`, since those are the stages a `claude -p` call happens in. `options.views`, when
 * given, reorders the findings by demand before any of it runs. Nothing here sends a span
 * anywhere; that's `exportSpans`'s job, left to the caller.
 *
 * When `STOP_AFTER_FAILURES` proposer or adversary calls fail in a row, the run stops: the
 * finding it was on is kept as skipped, the rest are left out, and the file says why in
 * `stopped`.
 */
export async function pipeline(
  data: Data,
  options: {
    limit?: number;
    only?: string[];
    run: Runner;
    falsifier: Runner;
    proposer: string;
    falsifierModel: string;
    views?: Map<string, number>;
  },
): Promise<RunFile> {
  const startedAt = new Date().toISOString();
  const models = { propose: options.proposer, falsify: options.falsifierModel };
  const answered = new Set<string>();
  const halt: { reason: string | null } = { reason: null };
  const proposer = stopAfterFailures(options.run, "proposer", halt);
  const adversary = stopAfterFailures(options.falsifier, "adversary", halt);
  const { traceId } = newIds();
  const spans: Span[] = [];
  const newSpanId = () => newIds().spanId;

  const detectSpanId = newSpanId();
  const detectStart = Date.now();
  let findings = detect(data);
  if (options.only) findings = findings.filter((f) => options.only!.includes(f.code));
  if (options.views) findings = orderByDemand(findings, options.views);
  if (options.limit != null) findings = findings.slice(0, options.limit);
  spans.push({ traceId, spanId: detectSpanId, name: "detect", start: detectStart, end: Date.now(), attributes: { findings: findings.length } });

  const items: Item[] = [];
  const decidedByItem: { order: number; hypothesis: Hypothesis }[][] = [];
  const pendingByItem: Pending[][] = [];
  const linkOutcomes: LinkOutcome[] = [];

  const proposeStageId = newSpanId();
  const falsifyStageId = newSpanId();
  const proposeStage = spanAccumulator();
  const falsifyStage = spanAccumulator();
  const checkSpan = spanAccumulator();
  const linksSpan = spanAccumulator();

  for (const finding of findings) {
    const line = findingLine(finding, data);
    const breakdownRows = breakdown(finding, data);
    const stoppedHere = (): void => {
      items.push({ finding, line, breakdown: breakdownRows, entropy: 0, replies: [], hypotheses: [], skipped: `the run stopped: ${halt.reason}` });
      decidedByItem.push([]);
      pendingByItem.push([]);
    };

    if (finding.kind === "artefact") {
      items.push({ finding, line, breakdown: breakdownRows, entropy: 0, replies: [], hypotheses: [], skipped: null });
      decidedByItem.push([]);
      pendingByItem.push([]);
      continue;
    }

    // Everything propose.ts, vocabulary.ts, links.ts and falsify.ts do here is written to
    // never throw on a bad model reply; this is one more net under that, so a bug in any
    // of them skips one finding with the error recorded, rather than losing the run.
    try {
      const findingProposeId = newSpanId();
      const proposeCallStart = Date.now();
      const tracedRun: Runner = (call) => proposer({ ...call, traceparent: traceparent(traceId, findingProposeId) });
      const proposal = await propose(finding, data, tracedRun, options.proposer);
      const proposeCallEnd = Date.now();
      for (const reply of proposal.replies) answered.add(reply.model);
      if (halt.reason) {
        stoppedHere();
        break;
      }
      spans.push({
        traceId, spanId: findingProposeId, parentSpanId: proposeStageId, name: "propose",
        start: proposeCallStart, end: proposeCallEnd, attributes: { finding: finding.id },
      });
      proposeStage.record(proposeCallStart, proposeCallEnd);

      const decided: { order: number; hypothesis: Hypothesis }[] = [];
      const pending: Pending[] = [];

      const findingFalsifyId = newSpanId();
      const findingFalsify = spanAccumulator();
      const tracedFalsifier: Runner = (call) => adversary({ ...call, traceparent: traceparent(traceId, findingFalsifyId) });

      for (const [order, candidate] of proposal.candidates.entries()) {
        if (halt.reason) break;
        const checkStart = Date.now();
        const outcome = evaluate(candidate.test, finding, data);
        checkSpan.record(checkStart, Date.now());
        if (outcome.status !== "passed") {
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, "check", outcome.reason ?? "the test failed", null) });
          continue;
        }

        let linkOutcomeIndex: number | null = null;
        let linkRefused: string | null = null;
        if (candidate.linkTest && aboutThisFinding(candidate.linkTest, candidate.test, finding)) {
          const linkStart = Date.now();
          linkOutcomeIndex = linkOutcomes.length;
          linkOutcomes.push(runLink(candidate.linkTest, data, linkSeed(finding.id, candidate.linkTest)));
          linksSpan.record(linkStart, Date.now());
        } else if (candidate.linkTest) {
          linkRefused = NOT_ABOUT_THIS_FIGURE;
        }

        const falsifyStart = Date.now();
        const verdict = await falsify(candidate, finding, data, tracedFalsifier, options.falsifierModel);
        findingFalsify.record(falsifyStart, Date.now());
        if (verdict.model) answered.add(verdict.model);
        const argued = verdict.model ? { model: verdict.model, reason: verdict.reason } : null;
        if (!verdict.survived) {
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, verdict.stage ?? "falsify", verdict.reason, null, argued) });
          continue;
        }

        pending.push({ order, candidate, outcome, linkOutcomeIndex, linkRefused, adversary: argued });
      }

      if (halt.reason) {
        stoppedHere();
        break;
      }

      if (findingFalsify.started()) {
        spans.push({ traceId, spanId: findingFalsifyId, parentSpanId: falsifyStageId, name: "falsify", attributes: { finding: finding.id }, ...findingFalsify.range() });
        falsifyStage.record(findingFalsify.range().start, findingFalsify.range().end);
      }

      items.push({ finding, line, breakdown: breakdownRows, entropy: proposal.entropy, replies: proposal.replies, hypotheses: [], skipped: proposal.skipped ?? null });
      decidedByItem.push(decided);
      pendingByItem.push(pending);
    } catch (error) {
      items.push({
        finding,
        line,
        breakdown: breakdownRows,
        entropy: 0,
        replies: [],
        hypotheses: [],
        skipped: error instanceof Error ? error.message : String(error),
      });
      decidedByItem.push([]);
      pendingByItem.push([]);
    }
  }

  const linksJudgeStart = Date.now();
  const verdicts = judgeLinks(linkOutcomes);
  linksSpan.record(linksJudgeStart, Date.now());

  if (checkSpan.started()) spans.push({ traceId, spanId: newSpanId(), name: "check", attributes: {}, ...checkSpan.range() });
  spans.push({ traceId, spanId: newSpanId(), name: "links", attributes: { tests: linkOutcomes.length }, ...linksSpan.range() });
  if (proposeStage.started()) spans.push({ traceId, spanId: proposeStageId, name: "propose", attributes: {}, ...proposeStage.range() });
  if (falsifyStage.started()) spans.push({ traceId, spanId: falsifyStageId, name: "falsify", attributes: {}, ...falsifyStage.range() });

  for (let i = 0; i < items.length; i++) {
    const decided = decidedByItem[i]!;
    const eligible: { order: number; candidate: Candidate; outcome: Outcome; linkTest: Hypothesis["linkTest"]; adversary: Hypothesis["adversary"] }[] = [];

    for (const entry of pendingByItem[i]!) {
      if (entry.linkOutcomeIndex == null) {
        // Refused before it ran: kept on the hypothesis, so the run file says why its link
        // is shown as proposed only.
        const linkTest: LinkResult | null = entry.linkRefused
          ? { ...entry.candidate.linkTest!, verdict: "refused", p: 1, effect: 0, placeboEffects: [], reason: entry.linkRefused }
          : null;
        eligible.push({ order: entry.order, candidate: entry.candidate, outcome: entry.outcome, linkTest, adversary: entry.adversary });
        continue;
      }
      const outcome = linkOutcomes[entry.linkOutcomeIndex]!;
      const verdict = verdicts[entry.linkOutcomeIndex]!;
      const linkTest: LinkResult = {
        ...entry.candidate.linkTest!,
        verdict,
        p: outcome.p,
        effect: outcome.effect,
        placeboEffects: outcome.placeboEffects,
        ...(outcome.refused ? { reason: outcome.refused } : {}),
      };
      if (verdict === "not consistent") {
        decided.push({ order: entry.order, hypothesis: buildHypothesis(entry.candidate, entry.outcome, "link", LINK_NOT_CONSISTENT_REASON, linkTest, entry.adversary) });
      } else {
        eligible.push({ order: entry.order, candidate: entry.candidate, outcome: entry.outcome, linkTest, adversary: entry.adversary });
      }
    }

    // Every survivor is published here; `publishable()` is what caps what a unit's file
    // shows to the 3 with the highest support.
    for (const e of eligible) {
      decided.push({ order: e.order, hypothesis: buildHypothesis(e.candidate, e.outcome, "published", null, e.linkTest, e.adversary) });
    }

    items[i]!.hypotheses = decided.sort((a, b) => a.order - b.order).map((d) => d.hypothesis);
  }

  return {
    runId: runIdOf(startedAt, data.version, models),
    startedAt,
    partial: options.limit != null || options.only != null || halt.reason != null,
    stopped: halt.reason,
    datasetVersion: data.version,
    models: { ...models, answered: [...answered].sort() },
    stageVersions: STAGE_VERSIONS,
    items,
    spans,
  };
}

/**
 * What a finished run says in the terminal: its id, how many findings and candidates it
 * saw, how many were published and where the rest stopped, how many the adversary never
 * gave a usable answer on, and why the run stopped early, when it did.
 */
export function summary(file: RunFile): string[] {
  let candidates = 0;
  let published = 0;
  let adversaryFailures = 0;
  const stopped = new Map<string, number>();
  for (const item of file.items) {
    for (const h of item.hypotheses) {
      candidates++;
      if (h.stage === "published") published++;
      else stopped.set(h.stage, (stopped.get(h.stage) ?? 0) + 1);
      if (h.reason === NO_ANSWER || h.reason === UNREADABLE) adversaryFailures++;
    }
  }
  const lines = [
    `run: ${file.runId}${file.partial ? ", partial" : ""}`,
    `findings: ${file.items.length}`,
    `candidates: ${candidates}`,
    `published: ${published}`,
    ...[...stopped].map(([stage, count]) => `${stage}: ${count}`),
    `adversary failures: ${adversaryFailures}`,
  ];
  if (file.stopped) lines.push(`stopped early: ${file.stopped}`);
  return lines;
}

const COLLECTION: Record<Level, string> = {
  region: "regions",
  province: "provinces",
  commune: "communes",
  arrondissement: "arrondissements",
};

/**
 * A hypothesis as a unit's file publishes it. The adversary's record stays in the run file:
 * its reason is the adversary's own English, which no word list has read, and its model is
 * an id the public text never names.
 */
export type PublishedHypothesis = Omit<Hypothesis, "adversary">;

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
    hypotheses: PublishedHypothesis[];
  }[];
}

/** A unit's file shows at most this many hypotheses per finding, the ones with the highest support. */
export const PUBLISHED_CAP = 3;

/** The published hypotheses a page shows for one finding: the `PUBLISHED_CAP` with the most support, the run's own order breaking a tie. */
export function shown(hypotheses: Hypothesis[]): Hypothesis[] {
  return hypotheses
    .filter((h) => h.stage === "published")
    .sort((a, b) => b.support - a.support)
    .slice(0, PUBLISHED_CAP);
}

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
    const published = shown(item.hypotheses);
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
      hypotheses: published.map(({ adversary: _, ...rest }) => rest),
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

/**
 * The one place a finished run reaches `data/v1/insights/`. Refuses a partial run, grades
 * made on another run (or none at all: a null `metrics`), and anything `guard` refuses.
 * Only once all of that passes does it clear everything under `outDir` but `README.md`,
 * write each file as compact JSON with a trailing newline, and record at `publishedPath`
 * the run it published and the metrics it passed with, the baseline the next publish is
 * held to. `outDir` is created first, so a first-ever publish doesn't need it to exist.
 */
export async function publishIfAllowed(options: {
  outDir: string;
  publishedPath: string;
  run: { runId: string; partial: boolean; stopped?: string | null };
  metrics: Metrics | null;
  baseline: Metrics | null;
  files: Map<string, unknown>;
}): Promise<{ written: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (options.run.stopped) reasons.push(`the latest run stopped early (${options.run.stopped}): run pnpm insights again`);
  else if (options.run.partial) reasons.push("the latest run left findings out with --limit or --only: run pnpm insights on all of them first");
  if (!options.metrics) {
    reasons.push("no graded set yet: run pnpm insights:grade");
  } else if (options.metrics.runId !== options.run.runId) {
    reasons.push(`the grades are for run ${options.metrics.runId}, and the latest run is ${options.run.runId}: grade it and run pnpm insights:score first`);
  } else {
    reasons.push(...guard(options.metrics, options.baseline).reasons);
  }
  if (reasons.length > 0) return { written: false, reasons };

  await mkdir(options.outDir, { recursive: true });
  for (const entry of await readdir(options.outDir)) {
    if (entry === "README.md") continue;
    await rm(join(options.outDir, entry), { recursive: true, force: true });
  }
  for (const [path, body] of options.files) {
    const dest = join(options.outDir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, `${JSON.stringify(body)}\n`);
  }
  const record = { runId: options.run.runId, publishedAt: new Date().toISOString(), metrics: options.metrics };
  await writeFile(options.publishedPath, `${JSON.stringify(record, null, 2)}\n`);

  return { written: true, reasons: [] };
}

const RUN_PATH = join(".cache", "insights", "runs", "latest.json");
const OUT_DIR = "data/v1/insights";
/** Written on every publish and committed with it: the run that's live and the numbers it passed with. */
export const PUBLISHED_PATH = "insights/published.json";

/**
 * The metrics the last published run passed with, which the guard holds a new run to; null
 * before anything's been published. A record that's there but can't be read throws, so a
 * broken baseline stops a publish rather than quietly letting a worse run through.
 */
export async function readBaseline(path: string): Promise<Metrics | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
  const record = JSON.parse(raw) as { metrics?: Metrics } | null;
  if (!record?.metrics) throw new Error(`${path} has no metrics in it`);
  return record.metrics;
}

/** `pnpm insights --publish`: publishes the latest run file as it stands, without running the pipeline or calling a model. */
async function runPublish(): Promise<void> {
  let latest: RunFile;
  try {
    latest = JSON.parse(await readFile(RUN_PATH, "utf8")) as RunFile;
  } catch {
    console.log("no run yet: run `pnpm insights` first");
    process.exitCode = 1;
    return;
  }

  let metrics: Metrics | null;
  try {
    metrics = JSON.parse(await readFile(METRICS_PATH, "utf8")) as Metrics;
  } catch {
    metrics = null;
  }

  let baseline: Metrics | null;
  try {
    baseline = await readBaseline(PUBLISHED_PATH);
  } catch (error) {
    console.log(`couldn't read ${PUBLISHED_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  const files = publishable(latest);

  const { traceId, spanId } = newIds();
  const start = Date.now();
  const result = await publishIfAllowed({ outDir: OUT_DIR, publishedPath: PUBLISHED_PATH, run: latest, metrics, baseline, files });
  const span: Span = { traceId, spanId, name: "publish", start, end: Date.now(), attributes: { files: files.size, written: String(result.written) } };
  await exportSpans([span], process.env);

  if (!result.written) {
    for (const reason of result.reasons) console.log(reason);
    process.exitCode = 1;
    return;
  }
  console.log(`published ${files.size} files`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--publish")) {
    await runPublish();
    return;
  }

  if (process.env.INSIGHTS_LIVE !== "1") {
    throw new Error("pnpm insights needs INSIGHTS_LIVE=1: it would spend real calls against a subscription");
  }

  const option = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limit = option("limit") ? Number(option("limit")) : undefined;
  const only = option("only")?.split(",");

  // Reuses the site's own demand log reader: the same "remote" opt-in, under its own name
  // here, so a run never queries the owner's database unless it's asked to twice over.
  let views: Map<string, number> | undefined;
  if (args.includes("--demand")) {
    const env = { ATTENTION: process.env.INSIGHTS_DEMAND === "remote" ? "remote" : undefined };
    const rows = read(sinceDate(), env);
    views = new Map(rows.map((r) => [r.code, r.n]));
  }

  const data = loadData();
  const proposer = "sonnet";
  const falsifierChoice = falsifierModel(process.env, proposer);
  const cacheDir = ".cache/insights/cache";
  const cacheOptions = { cacheDir, datasetVersion: data.version, stageVersions: STAGE_VERSIONS };
  const run = makeRunner(claudeTransport(), cacheOptions);
  const falsifierTransport = falsifierChoice.transport === "ollama" ? ollamaTransport() : claudeTransport();
  const falsifier = makeRunner(falsifierTransport, cacheOptions);

  const file = await pipeline(data, { limit, only, run, falsifier, proposer, falsifierModel: falsifierChoice.model, views });
  await exportSpans(file.spans, process.env);

  const runsDir = ".cache/insights/runs";
  await mkdir(runsDir, { recursive: true });
  const body = JSON.stringify(file, null, 2);
  await writeFile(join(runsDir, `${file.startedAt}.json`), body);
  await writeFile(join(runsDir, "latest.json"), body);

  for (const line of summary(file)) console.log(line);
  if (file.stopped) process.exitCode = 1;
}

// Runs the pipeline when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
