/**
 * `pnpm insights`: detect's standout figures, filtered, each with its line and the context
 * around it, written to `data/v1/insights/`. Every word published is a fixed template and
 * every number comes from the censuses, so nothing here calls a model or the network, and
 * the same dataset always gives the same files.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { contextOf, type Context } from "./context.ts";
import { loadData, type Data } from "./data.ts";
import { detect, type Finding, type Kind } from "./detect.ts";
import { dropped, isSampled, type Dropped } from "./filter.ts";
import { readLocal } from "./model.ts";
import { localWarning, refusal, termsPattern } from "./safety.ts";
import { breakdown, findingLine, type Words } from "./text.ts";

/** One standout figure, as a commune's file publishes it. */
export interface Published {
  id: string;
  kind: Exclude<Kind, "artefact">;
  measure: string;
  value: number; // the 2024 value, or the change in points for a change
  reference: number; // what detect set it against: the communes' mean, its province's figure, or 0 for a change
  score: number;
  direction: "high" | "low";
  /** True when the figure comes from the long questionnaire's sample, in a commune of 2,000 households or more. */
  sampled: boolean;
  line: Words;
  breakdown: ReturnType<typeof breakdown>;
  context: Context;
}

export interface CommuneFile {
  code: string;
  level: "commune";
  name: { fr: string; ar: string | null };
  datasetVersion: string;
  findings: Published[];
}

export interface Counts {
  detected: number;
  dropped: Record<Dropped | "safety", number>;
  published: number;
  communes: number;
}

/** Whether anything a figure's record says in words breaks the policy: its line, and the labels of the parts it's made of. */
function refused(line: Published["line"], parts: Published["breakdown"], terms: RegExp | null): boolean {
  const texts = [line.en, line.fr, line.ar, ...(parts ?? []).flatMap((p) => [p.label.en, p.label.fr, p.label.ar])];
  return texts.some((text) => refusal(text, terms) !== null);
}

/**
 * Detects, filters and gives each figure left its line and context, then shapes them into
 * the files `data/v1/insights/` holds: one per commune with a figure, and an index. A figure
 * the safety policy refuses is dropped before any context is worked out, so no other
 * figure's context points at it.
 */
export function pipeline(data: Data, terms: RegExp | null): { files: Map<string, unknown>; counts: Counts } {
  const findings = detect(data);
  const counts: Counts = {
    detected: findings.length,
    dropped: { artefact: 0, "not a commune": 0, "sex share": 0, flagged: 0, "small base": 0, "local service": 0, "special population": 0, safety: 0 },
    published: 0,
    communes: 0,
  };

  const kept: { finding: Finding; line: Published["line"]; parts: Published["breakdown"] }[] = [];
  for (const finding of findings) {
    const why = dropped(finding, data);
    if (why) {
      counts.dropped[why]++;
      continue;
    }
    const line = findingLine(finding, data);
    const parts = breakdown(finding, data);
    if (refused(line, parts, terms)) {
      counts.dropped.safety++;
      continue;
    }
    kept.push({ finding, line, parts });
  }

  const byCode = new Map<string, CommuneFile>();
  const all = kept.map((k) => k.finding);
  for (const { finding, line, parts } of kept) {
    const unit = data.units.get(finding.code)!;
    const file = byCode.get(finding.code) ?? { code: unit.code, level: "commune", name: unit.name, datasetVersion: data.version, findings: [] };
    byCode.set(finding.code, file);
    file.findings.push({
      id: finding.id,
      kind: finding.kind as Published["kind"],
      measure: finding.measure,
      value: finding.value,
      reference: finding.reference,
      score: finding.score,
      direction: finding.direction,
      sampled: isSampled(finding, data),
      line,
      breakdown: parts,
      context: contextOf(finding, all, data),
    });
  }

  const communes = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  const files = new Map<string, unknown>();
  for (const c of communes) files.set(`communes/${c.code}.json`, c);
  files.set("index.json", communes.map((c) => ({ code: c.code, level: c.level, findings: c.findings.length })));
  counts.published = kept.length;
  counts.communes = communes.length;
  return { files, counts };
}

/** What a run says in the terminal: what it found, what it dropped and why, and what it published. */
export function summary(counts: Counts): string[] {
  return [
    `detected: ${counts.detected}`,
    ...Object.entries(counts.dropped).map(([why, n]) => `dropped, ${why}: ${n}`),
    `published: ${counts.published} figures, ${counts.communes} communes`,
  ];
}

/**
 * Clears everything under `outDir` but `README.md`, then writes each file as compact JSON
 * with a trailing newline. `outDir` is created first, so a first run doesn't need it to exist.
 */
export async function write(outDir: string, files: Map<string, unknown>): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const entry of await readdir(outDir)) {
    if (entry === "README.md") continue;
    await rm(join(outDir, entry), { recursive: true, force: true });
  }
  for (const [path, body] of files) {
    const dest = join(outDir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, `${JSON.stringify(body)}\n`);
  }
}

const OUT_DIR = "data/v1/insights";

async function main(): Promise<void> {
  const local = readLocal(process.env);
  const warning = localWarning(local);
  if (warning) console.error(warning);
  const { files, counts } = pipeline(loadData(), termsPattern(local?.terms ?? []));
  await write(OUT_DIR, files);
  for (const line of summary(counts)) console.log(line);
}

// Runs the pipeline when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
