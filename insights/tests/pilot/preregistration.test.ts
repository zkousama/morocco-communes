import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadData } from "../../src/data.ts";
import { detect } from "../../src/detect.ts";
import { sampleFindings } from "../../src/pilot/sample.ts";
import {
  A5_MAX_HOURS,
  ACTIVE_ADVERSARIES,
  ADVERSARIES,
  BOOTSTRAP_ROUNDS,
  CONFIDENCE,
  DISAGREEMENT_CAP,
  DRIFT_ITEMS,
  DROPPED_ADVERSARIES,
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
  PUBLISHED_CAP,
  RATED_PER_PROPOSER,
  SAMPLES_SHARE,
  SELF_PREFERENCE_GAP,
  SHOWN_BREAKS_SHARE,
} from "../../src/pilot/setups.ts";

const text = readFileSync("insights/pilot/preregistration.md", "utf8");
const TOTAL_FINDINGS = FINDINGS_BY_KIND.extreme + FINDINGS_BY_KIND.change + FINDINGS_BY_KIND.gap;

/** Where the dated amendments start: everything above it is the design as registered. */
const AMENDMENT = "\n## Amendment";

describe("the amendment", () => {
  const at = text.indexOf(AMENDMENT);
  const amendment = at < 0 ? "" : text.slice(at);

  it("comes after every registered section, dated in its heading", () => {
    expect(at, "an '## Amendment' heading").toBeGreaterThan(0);
    expect(amendment).toMatch(/^\n## Amendment, \d{1,2} [A-Z][a-z]+ \d{4}\n/);
    const headings = amendment.match(/^## .*$/gm) ?? [];
    expect(headings.every((h) => h.startsWith("## Amendment"))).toBe(true);
  });

  it("names A5 and its model, and says it's dropped", () => {
    expect(amendment).toContain("A5");
    expect(amendment).toContain("Gemini 3.8 Flash");
    expect(amendment).toContain("dropped");
  });

  it("drops exactly the runs the code drops, and the code runs the rest of the registered list", () => {
    expect(Object.keys(DROPPED_ADVERSARIES)).toEqual(["A5"]);
    for (const id of Object.keys(DROPPED_ADVERSARIES)) expect(amendment).toContain(id);
    expect(ACTIVE_ADVERSARIES).toEqual(ADVERSARIES.filter((r) => !Object.hasOwn(DROPPED_ADVERSARIES, r.id)));
    expect(ACTIVE_ADVERSARIES.map((r) => r.id)).toEqual(["A1", "A2", "A3", "A4"]);
  });
});

describe("the second amendment, on who rates", () => {
  const heading = "\n## Amendment, 26 September 2026: who rates\n";
  const at = text.indexOf(heading);
  const amendment = at < 0 ? "" : text.slice(at);

  it("comes after the first amendment", () => {
    expect(at, "its heading").toBeGreaterThan(text.indexOf(AMENDMENT));
  });

  it("names the 3 judges' models, and the one that can stand in for J2", () => {
    for (const model of ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/google/gemma-4-26b-a4b-it"]) {
      expect(amendment).toContain(model);
    }
    for (const id of ["J1", "J2", "J3"]) expect(amendment).toContain(`| ${id} |`);
  });

  it("says the rules read the jury alone, and records the discarded answers", () => {
    expect(amendment).toContain("The rules read the jury's answers alone.");
    expect(amendment).toContain("59 answers entered while trying out the rating tool were discarded before any analysis.");
  });

  it("says how the judges ran, and the free-tier guard", () => {
    expect(amendment).toContain("default reasoning and temperature 0");
    expect(amendment).toContain("9,000 neurons");
  });

  it("states the owner's spot-check: its sample and seed, that it came first, and that it's reported only", () => {
    expect(amendment).toContain("20 items");
    expect(amendment).toContain(String(PILOT_SEED));
    expect(amendment).toContain("before the jury ran");
    expect(amendment).toContain("reported only");
  });

  it("says what the owner could look up while answering, and that the judges look up nothing", () => {
    const flat = amendment.replace(/\s+/g, " "); // a phrase can wrap across a line
    expect(flat).toContain("look up a place or an event");
    expect(flat).toContain("from the item's text alone, with no search");
  });
});

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

/** Each pilot model's display name in the file's prose, keyed by the id `PilotRole.model` uses. */
const MODEL_DISPLAY: Record<string, string> = {
  haiku: "Haiku 4.5",
  sonnet: "Sonnet 5",
  opus: "Opus 5.5",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
};

/** A markdown table row keyed by its first cell, for every row whose first cell is a setup or run id. */
function idTableRows(source: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of source.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length >= 3 && /^[PA][1-5]$/.test(cells[0]!)) rows.set(cells[0]!, cells);
  }
  return rows;
}

describe("the setups tables", () => {
  const rows = idTableRows(text);

  it("has a row for every proposer and adversary, naming that setup's model and effort", () => {
    for (const role of [...PROPOSERS, ...ADVERSARIES]) {
      const row = rows.get(role.id);
      expect(row, `a table row for ${role.id}`).toBeDefined();
      const [, model, effort] = row!;
      expect(model, `${role.id}'s model cell`).toContain(MODEL_DISPLAY[role.model] ?? role.model);
      // Gemini takes no thinking setting at all, so its row says so in its own words rather
      // than "none", which reads as though an effort could have been asked for and wasn't.
      const wantEffort = role.transport === "gemini" ? "its own default" : (role.effort ?? "none");
      expect(effort, `${role.id}'s effort cell`).toContain(wantEffort);
    }
  });
});

/**
 * Every number `preregistration.md` states, checked against the exported constants it has
 * to come from, the same idea as the methods page's own digit test
 * (`site/tests/insights.test.ts`): strip what's allowed, then nothing with a digit may be
 * left. Tables are data, not prose (the sampled findings and the setups tables above are
 * checked in their own right), so every table is stripped whole, along with the ordered
 * decision-rules list's own numbering. Setup and run ids (P1, A3, ...), "rule N" references
 * and the census year are identifiers, not measures, and are stripped too; the seed is
 * excluded by name, as asked. Most of `pinned` below is built from a constant, but a few
 * entries are fixed text with nothing to trace to: the model display names ("Haiku 4.5" and
 * the rest, proper nouns rather than measures) and "2 setups" (a generic comparison between
 * a pair of things, not a count of anything the pilot defines).
 */
describe("the numbers it states", () => {
  const pct = (share: number) => Math.round(share * 100);

  // Rule 2's "n times in d" is read back off rule 2's own paragraph, not the first match
  // anywhere in the file, so a rewording that changes the fraction can't drift from
  // HIGH_EFFORT_RIGHT_SHARE unnoticed, and nothing outside rule 2 could match by accident.
  const rule2Text = /2\.\s+\*\*Adversary effort\.\*\*([\s\S]*?)\n3\.\s+\*\*Adversary model\.\*\*/.exec(text)?.[1] ?? "";
  const rightShareMatch = /(\d+) times in (\d+)/.exec(rule2Text);
  const rightSharePhrase = rightShareMatch?.[0] ?? "«rule 2's fraction not found»";

  // The 2 "about" figures under "What this pilot can tell apart" are a plain normal
  // approximation (z = 1.96 for a 95% interval) on RATED_PER_PROPOSER ratings at the
  // worst-case p = 0.5, rounded to the nearest 5 since both are stated as "about":
  // a single setup's own interval, and the gap 2 setups' rates need before it's not noise.
  const z = 1.96;
  const nearest5 = (value: number) => Math.round(value / 5) * 5;
  const singleIntervalPoints = nearest5(z * Math.sqrt(0.25 / RATED_PER_PROPOSER) * 100);
  const clearGapPoints = nearest5(z * Math.sqrt(0.5 / RATED_PER_PROPOSER) * 100);

  // "5 samples", "the first 2 samples" .. "the first (MAX_SAMPLES - 1) samples": built from
  // MAX_SAMPLES so a change to the pipeline's own sample count doesn't silently strand these.
  const sampleCheckpoints = Array.from({ length: MAX_SAMPLES - 1 }, (_, i) => `the first ${i + 2} samples`);

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
    `${MAX_SAMPLES} samples`,
    ...sampleCheckpoints,
    `${pct(PROPOSER_MARGIN)} points`,
    `${KAPPA_MARGIN}`,
    rightSharePhrase,
    `${FULL_RUN_ADVERSARY_CALLS.toLocaleString("en-US")} calls`,
    `${A5_MAX_HOURS} hours`,
    `${A5_MAX_HOURS}-hour`,
    `${pct(SELF_PREFERENCE_GAP)} points`,
    `${MIN_SAMPLES} to ${MAX_SAMPLES}`,
    `${pct(SAMPLES_SHARE)}%`,
    `${pct(SHOWN_BREAKS_SHARE)}%`,
    `${PUBLISHED_CAP} reasons`,
    `${RATED_PER_PROPOSER * PROPOSERS.length} reasons`,
    `${RATED_PER_PROPOSER} per proposer setup`,
    `${RATED_PER_PROPOSER} of the ${TOTAL_FINDINGS} findings`,
    `the same ${RATED_PER_PROPOSER} findings`,
    `${TOTAL_FINDINGS} findings`,
    `capped at ${DISAGREEMENT_CAP}`,
    `${DRIFT_ITEMS} items`,
    `${RATED_PER_PROPOSER} ratings`,
    `${singleIntervalPoints} points`,
    "2 setups",
    `${clearGapPoints} points`,
  ];

  it("pins rule 2's fraction to HIGH_EFFORT_RIGHT_SHARE", () => {
    expect(rightShareMatch, "a \"n times in d\" phrase in the file").not.toBeNull();
    const [, n, d] = rightShareMatch!;
    expect(Number(n) / Number(d)).toBe(HIGH_EFFORT_RIGHT_SHARE);
  });

  it("reads the pilot's real resolution off RATED_PER_PROPOSER, at a 95% z of 1.96", () => {
    expect(singleIntervalPoints).toBe(25);
    expect(clearGapPoints).toBe(35);
  });

  it("leaves no other number typed into the file", () => {
    // An amendment is a dated record of what happened, not a rule: its numbers (a quota, a
    // count of answers) trace to no constant, so the scan stops where the amendments start.
    const at = text.indexOf(AMENDMENT);
    let prose = at < 0 ? text : text.slice(0, at);
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
