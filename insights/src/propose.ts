/**
 * Asks a language model why a figure stands out: 2 to 4 hypotheses, each a claim, a premise
 * a data test checks, and a link a link test may check across places. The same question is
 * asked 5 times; the answers are merged by what their data tests check, and how much the 5
 * disagree is kept as the finding's semantic entropy. A reply that can't be read, a call
 * that fails, a hypothesis in the wrong shape or one the word list refuses is dropped, and
 * a finding left with nothing says why rather than stopping the run.
 */
import { z } from "zod";
import type { Data, Unit } from "./data.ts";
import type { Finding } from "./detect.ts";
import { familyOf, FIELDS } from "./fields.ts";
import { linkSchema, type LinkTest } from "./links.ts";
import type { Runner } from "./model.ts";
import { refusal } from "./safety.ts";
import { findingLine, subjectOf } from "./text.ts";
import { checkSchema, signature, type Check } from "./vocabulary.ts";

export interface Candidate {
  claim: { en: string; fr: string };
  link: { en: string; fr: string };
  premise: { en: string; fr: string };
  test: Check;
  linkTest: LinkTest | null;
  artefact: boolean; // the model's own call: the hypothesis is that the figure is a data artefact
  support: number; // how many of the 5 samples proposed this test
}

export interface Proposal {
  finding: Finding;
  candidates: Candidate[];
  entropy: number;
  skipped?: string;
  replies: { model: string; promptHash: string }[];
}

export const SAMPLES = 5;

/** Reused by the adversary (`falsify.ts`), so it argues over the same fields it's checking. */
export const catalogue = FIELDS.map((f) => {
  const what = subjectOf(f.path);
  const described = what ? what.en.charAt(0).toUpperCase() + what.en.slice(1) : f.label.en;
  return `${f.path} | ${described} | ${f.unit}${f.comparable ? " | 2014" : ""}`;
}).join("\n");

const SYSTEM = `Each request is one figure from Morocco's 2024 census that stands out: a commune at the extreme end of a measure, a unit whose figure moved much more or much less since the 2014 census than others of its level, or a commune or province far from its parent's figure. Propose 2 to 4 hypotheses for why the figure is what it is.

A hypothesis has 3 parts, and the page shows each one on its own.
- The claim names the possible reason in a few words, such as "Families moving out to new suburbs".
- The premise is a fact about the place that a data test checks against the census, such as "The neighbouring communes have far more new flats than the province". The page shows it as checked, with the figures the test read.
- The link is why the premise would explain the figure. The census can't prove it. Where a link test fits, give one and the page shows the link as tested for consistency across places; otherwise it shows the link as proposed.

Pick premises the figures you're sent support, and write each data test so it comes out true when its premise is true. A premise whose test fails is dropped. Give each hypothesis a different data test.

DATA TESTS

A reference names one figure: {"of": <subject>, "field": <path>, "year": 2024 or 2014}.
A subject is one of:
{"unit":"self"}  the unit the figure is about
{"unit":"parent"}  its province for a commune, its région for a province
{"unit":"country"}  Morocco as a whole
{"unit":"neighbours","stat":"median"}  the median of its neighbours: the communes next to a commune, the other units under the same parent otherwise
{"unit":"code","code":"04.421.01.0"}  any unit, by its code

A data test is one of 3 checks.

compare: one figure against another, or against a number. "op" is ">", "<", ">=" or "<="; "right" can be {"value": 20} in place of a reference.
{"check":"compare","left":{"of":{"unit":"self"},"field":"education.higher","year":2024},"op":">","right":{"of":{"unit":"country"},"field":"education.higher","year":2024}}

change: how far a figure moved from 2014 to 2024, in the field's own unit, so percentage points for a percent. "op" is ">" or "<".
{"check":"change","of":{"unit":"neighbours","stat":"median"},"field":"dwellingType.apartment","op":">","value":5}

rank: where a unit's figure sits among the units of its level in an area. "within" is "province", "region" or "country"; "position" is "top" or "bottom"; "share" runs from 0 to 0.5, so 0.1 is the top or bottom 10%. The subject is "self", "parent" or a code.
{"check":"rank","of":{"unit":"self"},"field":"commute.privateCar","year":2024,"within":"province","position":"top","share":0.1}

A 2014 figure, and so any change test, only exists for a field marked 2014 in the list at the end. A test naming a field or a unit that doesn't exist is refused.

The figure's own field can't appear in a data test, and nor can a field that's part of the same whole, such as another age band when the figure is an age band. Each request lists these as "offLimits". A test that uses one is refused, and its hypothesis with it: a premise has to be a different fact from the figure it explains.

LINK TESTS

together: whether 2 fields go together across every unit of a level. "year" is 2024, or "change" to pair each unit's change since 2014 (both fields need 2014). "direction" is "positive" or "negative".
{"link":"together","x":"education.higher","y":"fertility.totalFertilityRate","year":2024,"level":"commune","direction":"negative"}

peers: within each région, whether the units above the median on the premise's field show a higher or lower outcome than those below it. It reads 2024 figures. "direction" is "higher" or "lower".
{"link":"peers","premise":"education.higher","outcome":"fertility.totalFertilityRate","level":"commune","direction":"lower"}

Put the premise's field in "x" or "premise", and the figure's own field in "y" or "outcome". Each link test is run again on unrelated fields as placebos, so a link that only reflects how urban a place is won't pass. Use null when no link test fits.

DATA ARTEFACTS

For a change since 2014, one hypothesis can be that the figure is an error, or a change in how the census asked, rather than a real change. Set "artefact": true on it. It still needs a premise and a data test, such as a related language rising by as much as this one fell.

WHAT HYPOTHESES MAY SAY

Hypotheses are about places and figures. Leave out:
- individuals: names, and officials picked out by title, such as a mayor or a governor;
- ethnic or religious groups, and words for people by origin or status such as Berbers, Arabs, sub-Saharans, migrants or refugees. Languages are fine to name as languages;
- blame on a political actor, such as the government, a ministry, a party or the makhzen, and talk of corruption.
A word check drops any hypothesis that mentions these, in either language. Write about people moving as families, households or young people moving, and about public spending as the roads, schools or housing that were built.

WRITING

Readers see the claim, the premise and the link as written, in English and in French.
- The claim is a few words with no full stop. The premise and the link are one sentence each.
- Write the premise as a plain fact about the place, with the figures its test reads. Write the link as a reason the premise would explain the figure, never as proof.
- English: British spelling, contractions where they read naturally (it's, doesn't, they've), digits for numbers from 2 up with "one" as a word, and no em dashes.
- French: write it as a French writer would, rather than translating the English sentence. Decimal comma, a space before %, no em dashes.
- Use plain words. Say what a thing is, rather than listing what it isn't, and leave out "not X but Y" constructions and closing sayings.

ANSWER

Answer with JSON only, nothing before or after it:
{"hypotheses":[{"claim":{"en":"...","fr":"..."},"premise":{"en":"...","fr":"..."},"link":{"en":"...","fr":"..."},"test":<data test>,"linkTest":<link test or null>,"artefact":false}]}

THE REQUEST

A request is a JSON object:
- "finding": the figure, in words; "measure" is its field and "kind" is extreme, change or gap.
- "offLimits": the fields no data test may use.
- "unit": the unit's name, level, code and population in 2014 and 2024; "parent": its province or région.
- "figures": every field with a figure, as [unit 2024, unit 2014, parent 2024, neighbours' median 2024, Morocco 2024]. null is a figure that doesn't exist; 2014 is null for a field the 2014 census didn't ask the same way.

Fields under housing. describe a unit's urban dwellings, lived in or not; a unit with no urban area has none. Fields under economy. come from the mapping of establishments made alongside the census, which leaves farming out.

FIELDS

path | what it measures | unit | 2014 if the 2014 census asked it the same way
${catalogue}`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** To the precision the census publishes: one decimal, and 2 for births per woman. */
const round = (v: number | null | undefined, unit: string): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const factor = unit === "births per woman" ? 100 : 10;
  return Math.round(v * factor) / factor;
};

/** The median of the neighbours' 2024 figures, with at least 2 of them, as a data test would read it. */
function neighboursMedian(units: Unit[], path: string): number | null {
  const values = units.map((u) => u.figures.y2024[path]).filter((v): v is number => v != null && Number.isFinite(v));
  return values.length >= 2 ? median(values) : null;
}

export function context(finding: Finding, data: Data): string {
  const unit = data.units.get(finding.code);
  const parent = unit?.parent ? data.units.get(unit.parent) : undefined;
  const neighbours = (unit?.neighbours ?? []).map((code) => data.units.get(code)).filter((u): u is Unit => u !== undefined);

  const rows: string[] = [];
  for (const f of FIELDS) {
    const row = [
      unit?.figures.y2024[f.path],
      unit?.figures.y2014[f.path],
      parent?.figures.y2024[f.path],
      neighboursMedian(neighbours, f.path),
      data.country.figures.y2024[f.path],
    ].map((v) => round(v, f.unit));
    if (row.some((v) => v !== null)) rows.push(`${JSON.stringify(f.path)}:${JSON.stringify(row)}`);
  }

  const head = {
    finding: findingLine(finding, data).en,
    measure: finding.measure,
    kind: finding.kind,
    offLimits: [...familyOf(finding.measure)],
    unit: unit
      ? { name: unit.name.fr, level: unit.level, code: unit.code, population: { 2014: unit.population.y2014, 2024: unit.population.y2024 } }
      : { code: finding.code, level: finding.level },
    parent: parent ? { name: parent.name.fr, level: parent.level, code: parent.code } : null,
  };
  // One field to a line, so a person reading the cache can find one.
  return `${JSON.stringify(head).slice(0, -1)},"figures":{\n${rows.join(",\n")}\n}}`;
}

const words = z.object({ en: z.string().trim().min(1), fr: z.string().trim().min(1) });

const hypothesisSchema = z.object({
  claim: words,
  link: words,
  premise: words,
  test: checkSchema,
  linkTest: linkSchema.nullish(),
  artefact: z.boolean().optional(),
});

type Hypothesis = Omit<Candidate, "support">;

/** A model often fences JSON in a code block despite being asked not to; the fence isn't part of the answer. */
const unfence = (text: string): string =>
  text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

/** A reply's valid hypotheses, or why there are none. */
function readReply(text: string): { hypotheses: Hypothesis[]; problem: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    return { hypotheses: [], problem: `not JSON: ${text.trim().slice(0, 80)}` };
  }
  const list = (parsed as { hypotheses?: unknown } | null)?.hypotheses;
  if (!Array.isArray(list)) return { hypotheses: [], problem: "no hypotheses list" };
  if (list.length === 0) return { hypotheses: [], problem: "an empty hypotheses list" };

  const hypotheses: Hypothesis[] = [];
  for (const item of list) {
    const result = hypothesisSchema.safeParse(item);
    if (!result.success) continue;
    const h = result.data;
    hypotheses.push({ claim: h.claim, link: h.link, premise: h.premise, test: h.test, linkTest: h.linkTest ?? null, artefact: h.artefact ?? false });
  }
  return { hypotheses, problem: hypotheses.length === 0 ? `no hypothesis in the expected shape, of ${list.length}` : null };
}

/** The first rule any of a hypothesis's 6 texts breaks, or null. */
function refused(h: Hypothesis): ReturnType<typeof refusal> {
  for (const text of [h.claim, h.link, h.premise].flatMap((t) => [t.en, t.fr])) {
    const rule = refusal(text);
    if (rule) return rule;
  }
  return null;
}

/**
 * Each distinct test signature is one cluster of meaning; the entropy is taken over how
 * often each cluster turns up across the samples, a sample counting a cluster once however
 * many times it repeats it. 0 when every sample proposed the same tests.
 */
export function semanticEntropy(signaturesPerSample: string[][]): number {
  const counts = new Map<string, number>();
  for (const sample of signaturesPerSample) for (const s of new Set(sample)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  let sum = 0;
  for (const n of counts.values()) sum += (n / total) * Math.log(n / total);
  return sum === 0 ? 0 : -sum;
}

export async function propose(finding: Finding, data: Data, run: Runner, model = "sonnet"): Promise<Proposal> {
  const prompt = context(finding, data);
  const replies: Proposal["replies"] = [];
  const samples: Hypothesis[][] = [];
  let lastError: string | null = null;
  let lastProblem: string | null = null;

  // One after another: 5 at once for every finding would be a burst on a subscription's limits.
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const reply = await run({ model, system: SYSTEM, prompt, stage: "propose", key: `${finding.id}:${i}` });
      replies.push({ model: reply.model, promptHash: reply.promptHash });
      const { hypotheses, problem } = readReply(reply.text);
      if (problem) lastProblem = problem;
      samples.push(hypotheses);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      samples.push([]);
    }
  }

  const entropy = semanticEntropy(samples.map((sample) => sample.map((h) => signature(h.test))));

  if (samples.every((sample) => sample.length === 0)) {
    const skipped = lastError
      ? `no usable answer in ${SAMPLES} samples; the last call failed: ${lastError}`
      : `no usable answer in ${SAMPLES} samples; the last came back with ${lastProblem}`;
    return { finding, candidates: [], entropy, skipped, replies };
  }

  // Merged by what the test checks: the first sample to propose a test gives its wording,
  // and every sample that proposed it counts once towards its support.
  const merged = new Map<string, { hypothesis: Hypothesis; support: number; order: number }>();
  for (const sample of samples) {
    for (const s of new Set(sample.map((h) => signature(h.test)))) {
      const entry = merged.get(s);
      if (entry) entry.support++;
      else merged.set(s, { hypothesis: sample.find((h) => signature(h.test) === s)!, support: 1, order: merged.size });
    }
  }

  const refusals: string[] = [];
  const candidates: Candidate[] = [];
  for (const { hypothesis, support } of [...merged.values()].sort((a, b) => b.support - a.support || a.order - b.order)) {
    const rule = refused(hypothesis);
    if (rule) refusals.push(rule);
    else candidates.push({ ...hypothesis, support });
  }

  if (candidates.length === 0) {
    return { finding, candidates, entropy, skipped: `every hypothesis was refused: ${[...new Set(refusals)].join(", ")}`, replies };
  }
  return { finding, candidates, entropy, replies };
}
