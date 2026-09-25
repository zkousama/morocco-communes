/**
 * Runs the whole pipeline over the dataset's findings and shapes what survives into the
 * files the API and site read. A finding is proposed, checked, tested across places and
 * argued against one after another; nothing about a hypothesis's fate is final until the
 * whole run's link tests have been judged together, since a link's p-value is only
 * meaningful against the batch it was corrected within. `pipeline` does the run and returns
 * it as data; `publishable` shapes a finished run into the files a later task writes.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { read, sinceDate } from "../../site/scripts/attention.ts";
import type { Data } from "./data.ts";
import { loadData } from "./data.ts";
import { detect, type Finding, type Kind } from "./detect.ts";
import { falsify, falsifierModel } from "./falsify.ts";
import { judgeLinks, runLink, type LinkOutcome, type LinkTest } from "./links.ts";
import { claudeTransport, hash, makeRunner, ollamaTransport, type Runner } from "./model.ts";
import { propose, type Candidate } from "./propose.ts";
import { guard, METRICS_PATH, type Metrics } from "./score.ts";
import { breakdown, findingLine } from "./text.ts";
import { newIds, traceparent, exportSpans, type Span } from "./trace.ts";
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
 * Orders findings by what people open: the page views their unit had in the last 30 days,
 * most first, then by score, so a batch that can't run everything spends its calls on the
 * places people actually look at. A unit with no rows in `views` counts as 0.
 */
export function orderByDemand<T extends { code: string; score: number }>(findings: T[], views: Map<string, number>): T[] {
  return [...findings].sort((a, b) => (views.get(b.code) ?? 0) - (views.get(a.code) ?? 0) || b.score - a.score);
}

/** A candidate's link test is refused before it's ever run, "not about this figure", unless its own outcome is the finding's own measure, read at the finding's own level: pairing 2 fields neither of which is the figure itself would test nothing about why the figure is what it is. */
function aboutThisFinding(test: LinkTest, finding: Finding): boolean {
  const outcomeField = test.link === "together" ? test.y : test.outcome;
  return outcomeField === finding.measure && test.level === finding.level;
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
      const findingProposeId = newSpanId();
      const proposeCallStart = Date.now();
      const tracedRun: Runner = (call) => options.run({ ...call, traceparent: traceparent(traceId, findingProposeId) });
      const proposal = await propose(finding, data, tracedRun, options.proposer);
      const proposeCallEnd = Date.now();
      spans.push({
        traceId, spanId: findingProposeId, parentSpanId: proposeStageId, name: "propose",
        start: proposeCallStart, end: proposeCallEnd, attributes: { finding: finding.id },
      });
      proposeStage.record(proposeCallStart, proposeCallEnd);

      const decided: { order: number; hypothesis: Hypothesis }[] = [];
      const pending: Pending[] = [];

      const findingFalsifyId = newSpanId();
      const findingFalsify = spanAccumulator();
      const tracedFalsifier: Runner = (call) => options.falsifier({ ...call, traceparent: traceparent(traceId, findingFalsifyId) });

      for (const [order, candidate] of proposal.candidates.entries()) {
        const checkStart = Date.now();
        const outcome = evaluate(candidate.test, finding, data);
        checkSpan.record(checkStart, Date.now());
        if (outcome.status !== "passed") {
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, "check", outcome.reason ?? "the test failed", null) });
          continue;
        }

        let linkOutcomeIndex: number | null = null;
        if (candidate.linkTest && aboutThisFinding(candidate.linkTest, finding)) {
          const linkStart = Date.now();
          linkOutcomeIndex = linkOutcomes.length;
          linkOutcomes.push(runLink(candidate.linkTest, data, linkSeed(finding.id, candidate.linkTest)));
          linksSpan.record(linkStart, Date.now());
        }

        const falsifyStart = Date.now();
        const verdict = await falsify(candidate, finding, data, tracedFalsifier, options.falsifierModel);
        findingFalsify.record(falsifyStart, Date.now());
        if (!verdict.survived) {
          // A killed-by-refusal verdict never carries a counter-test; only a counter-test
          // that came out true does, which is what "falsify" means here.
          const stage = verdict.counter ? "falsify" : "safety";
          decided.push({ order, hypothesis: buildHypothesis(candidate, outcome, stage, verdict.reason, null) });
          continue;
        }

        pending.push({ order, candidate, outcome, linkOutcomeIndex });
      }

      if (findingFalsify.started()) {
        spans.push({ traceId, spanId: findingFalsifyId, parentSpanId: falsifyStageId, name: "falsify", attributes: { finding: finding.id }, ...findingFalsify.range() });
        falsifyStage.record(findingFalsify.range().start, findingFalsify.range().end);
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

  const linksJudgeStart = Date.now();
  const verdicts = judgeLinks(linkOutcomes);
  linksSpan.record(linksJudgeStart, Date.now());

  if (checkSpan.started()) spans.push({ traceId, spanId: newSpanId(), name: "check", attributes: {}, ...checkSpan.range() });
  spans.push({ traceId, spanId: newSpanId(), name: "links", attributes: { tests: linkOutcomes.length }, ...linksSpan.range() });
  if (proposeStage.started()) spans.push({ traceId, spanId: proposeStageId, name: "propose", attributes: {}, ...proposeStage.range() });
  if (falsifyStage.started()) spans.push({ traceId, spanId: falsifyStageId, name: "falsify", attributes: {}, ...falsifyStage.range() });

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
    spans,
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
export const PUBLISHED_CAP = 3;

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

/**
 * The one place a finished run reaches `data/v1/insights/`: refuses through `guard` (a
 * null `metrics` counts as no graded set) and, only once it passes, clears everything
 * under `outDir` but `README.md` and writes each file as compact JSON with a trailing
 * newline. `outDir` is created first, so a first-ever publish doesn't need it to exist.
 */
export async function publishIfAllowed(options: {
  outDir: string;
  metrics: Metrics | null;
  baseline: Metrics | null;
  files: Map<string, unknown>;
}): Promise<{ written: boolean; reasons: string[] }> {
  if (!options.metrics) return { written: false, reasons: ["no graded set yet: run pnpm insights:grade"] };

  const result = guard(options.metrics, options.baseline);
  if (!result.ok) return { written: false, reasons: result.reasons };

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

  return { written: true, reasons: [] };
}

const RUN_PATH = join(".cache", "insights", "runs", "latest.json");
const OUT_DIR = "data/v1/insights";

/** The last committed `insights/metrics.json`, or null when there isn't one, git can't be read, or it doesn't parse. */
function readBaselineMetrics(): Metrics | null {
  const result = spawnSync("git", ["show", "HEAD:insights/metrics.json"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout) as Metrics;
  } catch {
    return null;
  }
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

  const baseline = readBaselineMetrics();
  const files = publishable(latest);

  const { traceId, spanId } = newIds();
  const start = Date.now();
  const result = await publishIfAllowed({ outDir: OUT_DIR, metrics, baseline, files });
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
