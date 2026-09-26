import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { sampleFindings } from "../../src/pilot/sample.ts";
import {
  A5_MAX_HOURS,
  ADVERSARIES,
  BOOTSTRAP_ROUNDS,
  CONFIDENCE,
  DISAGREEMENT_CAP,
  DRIFT_ITEMS,
  FINDINGS_BY_KIND,
  FULL_RUN_ADVERSARY_CALLS,
  HIGH_EFFORT_RIGHT_SHARE,
  KAPPA_MARGIN,
  MAX_SAMPLES,
  MIN_SAMPLES,
  PILOT_SEED,
  POOL_PER_PROPOSER,
  PROPOSER_MARGIN,
  PROPOSERS,
  RATED_PER_PROPOSER,
  SAMPLES_SHARE,
  SELF_PREFERENCE_GAP,
  SHOWN_BREAKS_SHARE,
  SHOWN_TOP_N,
} from "../../src/pilot/setups.ts";

const text = readFileSync("insights/pilot/preregistration.md", "utf8");
const TOTAL_FINDINGS = FINDINGS_BY_KIND.extreme + FINDINGS_BY_KIND.change + FINDINGS_BY_KIND.gap;

describe("the sampled findings it lists", () => {
  it("are exactly what sampleFindings(detect(loadData()), PILOT_SEED) returns today", () => {
    const chosen = sampleFindings(detect(loadData()), PILOT_SEED);

    const section = /## Sampled findings\n([\s\S]*?)\n## /.exec(text)?.[1];
    expect(section, "the 'Sampled findings' section").toBeDefined();
    const rows = section!
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("---"))
      .slice(1) // the header row
      .map((line) => line.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0))
      .map(([kind, code, measure, id]) => ({
        kind,
        code: code?.replace(/`/g, ""),
        measure: measure?.replace(/`/g, ""),
        id: id?.replace(/`/g, ""),
      }));

    expect(rows).toEqual(chosen.map((f) => ({ kind: f.kind, code: f.code, measure: f.measure, id: f.id })));
  });
});

/**
 * Every number `preregistration.md` states, checked against the exported constants it has
 * to come from, the same idea as the methods page's own digit test
 * (`site/tests/insights.test.ts`): strip what's allowed, then nothing with a digit may be
 * left. Tables are data, not prose (the setups and the findings list above are checked in
 * their own right), so they're stripped whole, along with the ordered list's own numbering.
 * Setup and run ids (P1, A3, ...), rule references ("rule 4") and the census year are
 * identifiers, not measures, and are stripped too; the seed is excluded by name, as asked.
 */
describe("the numbers it states", () => {
  const pct = (share: number) => Math.round(share * 100);
  // The 2 "about" figures under "What this pilot can tell apart" are a plain normal
  // approximation (z = 1.96 for a 95% interval) on RATED_PER_PROPOSER ratings at the
  // worst-case p = 0.5, rounded to the nearest 5 since both are stated as "about":
  // a single setup's own interval, and the gap 2 setups' rates need before it's not noise.
  const z = 1.96;
  const nearest5 = (value: number) => Math.round(value / 5) * 5;
  const singleIntervalPoints = nearest5(z * Math.sqrt(0.25 / RATED_PER_PROPOSER) * 100);
  const clearGapPoints = nearest5(z * Math.sqrt(0.5 / RATED_PER_PROPOSER) * 100);

  const pinned = [
    "Haiku 4.5",
    "Sonnet 5",
    "Opus 5.5",
    "Gemini 3.8 Flash",
    `${PROPOSERS.length} proposer setups`,
    `${MAX_SAMPLES} samples each`,
    `${ADVERSARIES.length} adversary runs`,
    "running the same model twice",
    `${FINDINGS_BY_KIND.extreme} extremes, ${FINDINGS_BY_KIND.change} changes and ${FINDINGS_BY_KIND.gap} gaps`,
    `${POOL_PER_PROPOSER} passing candidates`,
    `fewer than ${POOL_PER_PROPOSER} candidates`,
    `up to ${POOL_PER_PROPOSER * PROPOSERS.length} in`,
    `${pct(CONFIDENCE)}%`,
    `${BOOTSTRAP_ROUNDS.toLocaleString("en-US")} times`,
    `${RATED_PER_PROPOSER} rated reasons`,
    `${MAX_SAMPLES} proposer samples`,
    "5 samples",
    "the first 2 samples",
    "the first 3 samples",
    "the first 4 samples",
    `${pct(PROPOSER_MARGIN)} points`,
    `${KAPPA_MARGIN}`,
    `${Math.round(HIGH_EFFORT_RIGHT_SHARE * 3)} times in 3`,
    `${FULL_RUN_ADVERSARY_CALLS.toLocaleString("en-US")} calls`,
    `${A5_MAX_HOURS} hours`,
    `${pct(SELF_PREFERENCE_GAP)} points`,
    `${MIN_SAMPLES} to ${MAX_SAMPLES}`,
    `${pct(SAMPLES_SHARE)}%`,
    `${pct(SHOWN_BREAKS_SHARE)}%`,
    `${SHOWN_TOP_N} reasons`,
    `${RATED_PER_PROPOSER * PROPOSERS.length} reasons`,
    `${RATED_PER_PROPOSER} per proposer setup`,
    `${RATED_PER_PROPOSER} of the ${TOTAL_FINDINGS} findings`,
    `the same ${RATED_PER_PROPOSER} findings`,
    `${TOTAL_FINDINGS} findings`,
    `capped at ${DISAGREEMENT_CAP}`,
    `${DRIFT_ITEMS} items`,
    `${RATED_PER_PROPOSER} ratings`,
    `${singleIntervalPoints} points`,
    `${clearGapPoints} points`,
  ];

  it("reads the pilot's real resolution off RATED_PER_PROPOSER, at a 95% z of 1.96", () => {
    expect(singleIntervalPoints).toBe(25);
    expect(clearGapPoints).toBe(35);
  });

  it("leaves no other number typed into the file", () => {
    let prose = text;
    prose = prose.replace(/^\s*\|.*$/gm, " "); // every markdown table: data, checked elsewhere
    prose = prose.replace(/^\s*\d+\.\s+/gm, ""); // the decision rules' own "1.".."6."
    prose = prose.replace(/[ \t\r\n]+/g, " "); // so a phrase split across a wrapped line still matches
    prose = prose.replace(/\b(?:P[1-4]|A[1-5])\b/g, " "); // setup and run ids
    prose = prose.replace(/\brule\s[1-6]\b/gi, " "); // "rule 4", not a measure
    prose = prose.replace(/\b2024\b/g, " "); // the census year
    prose = prose.replace(new RegExp(`\\b${PILOT_SEED}\\b`, "g"), " "); // the seed, excluded by name

    for (const phrase of pinned) prose = prose.split(phrase).join(" ");

    expect(prose.match(/.{0,30}\d.{0,30}/g)).toBeNull();
  });
});
