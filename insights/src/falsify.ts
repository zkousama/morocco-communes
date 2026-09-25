/**
 * A second, different model tries to break a candidate hypothesis whose premise already
 * passed its data test. It sees the same finding and figures the proposer saw, and the
 * candidate itself, and writes a counter-test in the same vocabulary: one that would come
 * out true if the premise were wrong. A counter-test that comes out true kills the
 * candidate; one that fails, is refused, or never gets written leaves it alive, since the
 * adversary only removes, never adds. `refusal` runs again on the candidate's own text as
 * a last check, and so does the adversary's own call that the hypothesis shouldn't be
 * argued with at all.
 */
import { z } from "zod";
import type { Data } from "./data.ts";
import type { Finding } from "./detect.ts";
import type { Runner } from "./model.ts";
import { catalogue, context, type Candidate } from "./propose.ts";
import { refusal } from "./safety.ts";
import { checkSchema, evaluate, signature, type Check, type Outcome } from "./vocabulary.ts";

export interface Verdict {
  survived: boolean;
  counter: Check | null;
  counterOutcome: Outcome | null;
  reason: string;
  model: string;
}

const SYSTEM = `You're checking a hypothesis someone else wrote about why a figure from Morocco's 2024 census stands out. Try to break it.

The hypothesis has a premise, already checked by a data test that came out true, and a claim and a link explaining why the premise would cause the figure. Your job is the premise: write a counter-test, in the same vocabulary as the one that checked it, that would come out true if the premise didn't really explain the figure. A test showing a place the premise says should score high actually scores low breaks it. So does a neighbour with the same premise and none of the figure's outcome. If you can't write one that would settle anything, answer with "counter": null and say why.

For example, a hypothesis claims a commune's low fertility comes from more people having higher education, with a premise the test checked as "this commune's share of people with higher education is above 5%". A counter-test could compare the country's own share of higher education against the same threshold: if most of Morocco clears it too, the premise doesn't pick this commune out from anywhere else, so the counter-test passing would break the hypothesis.

DATA TESTS

A reference names one figure: {"of": <subject>, "field": <path>, "year": 2024 or 2014}.
A subject is one of:
{"unit":"self"}  the unit the finding is about
{"unit":"parent"}  its province for a commune, its région for a province
{"unit":"country"}  Morocco as a whole
{"unit":"neighbours","stat":"median"}  the median of its neighbours: the communes next to a commune, the other units under the same parent otherwise
{"unit":"code","code":"04.421.01.0"}  any unit, by its code

A counter-test is one of 3 checks.

compare: one figure against another, or against a number. "op" is ">", "<", ">=" or "<="; "right" can be {"value": 20} in place of a reference.
{"check":"compare","left":{"of":{"unit":"self"},"field":"education.higher","year":2024},"op":">","right":{"of":{"unit":"country"},"field":"education.higher","year":2024}}

change: how far a figure moved from 2014 to 2024, in the field's own unit, so percentage points for a percent. "op" is ">" or "<".
{"check":"change","of":{"unit":"neighbours","stat":"median"},"field":"dwellingType.apartment","op":">","value":5}

rank: where a unit's figure sits among the units of its level in an area. "within" is "province", "region" or "country"; "position" is "top" or "bottom"; "share" runs from 0 to 0.5, so 0.1 is the top or bottom 10%. The subject is "self", "parent" or a code.
{"check":"rank","of":{"unit":"self"},"field":"commute.privateCar","year":2024,"within":"province","position":"top","share":0.1}

A 2014 figure, and so any change test, only exists for a field marked 2014 in the list at the end. The request's "offLimits" fields are the finding's own measure and its siblings: a counter-test that names one is refused, same as it would have been for the original test.

WHAT YOU MAY NOT ARGUE WITH

Some hypotheses shouldn't be countered at all. If the hypothesis names an individual, an ethnic or religious group, or blames a political actor, don't write a counter-test: set "refuse" to "individuals", "groups" or "political" and leave "counter" as null.

ANSWER

Answer with JSON only, nothing before or after it:
{"counter": <data test or null>, "reason": "...", "refuse": "individuals" | "groups" | "political"}
Leave "refuse" out unless it applies.

THE REQUEST

A request is a JSON object with the same shape the hypothesis's own data test was checked against: "finding", "offLimits", "unit", "parent" and "figures", followed by "hypothesis": the claim, link, premise and data test you're trying to break.

FIELDS

path | what it measures | unit | 2014 if the 2014 census asked it the same way
${catalogue}`;

const replySchema = z.object({
  counter: checkSchema.nullable(),
  reason: z.string().trim().min(1),
  refuse: z.enum(["individuals", "groups", "political"]).optional(),
});

/** A model often fences JSON in a code block despite being asked not to; the fence isn't part of the answer. */
const unfence = (text: string): string =>
  text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

/** A reply's parsed verdict fields, or null when the text isn't valid JSON in the expected shape. */
function readReply(text: string): z.infer<typeof replySchema> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    return null;
  }
  const result = replySchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** The first rule any of the candidate's 6 texts breaks, or null. */
function refusedCandidate(candidate: Candidate): ReturnType<typeof refusal> {
  for (const text of [candidate.claim, candidate.link, candidate.premise].flatMap((t) => [t.en, t.fr])) {
    const rule = refusal(text);
    if (rule) return rule;
  }
  return null;
}

const ALIVE_NO_COUNTER: Omit<Verdict, "model"> = { survived: true, counter: null, counterOutcome: null, reason: "no counter-test" };

/**
 * Asks the adversary to break `candidate`, evaluates its counter-test against the same
 * finding, and applies `refusal` to the candidate's own text as a last check. Never throws:
 * a call that fails, or a reply that can't be parsed or validated, leaves the candidate
 * alive, since the adversary only ever removes a candidate, never adds one.
 */
export async function falsify(candidate: Candidate, finding: Finding, data: Data, run: Runner, model: string): Promise<Verdict> {
  const key = `${finding.id}:${signature(candidate.test)}`;
  const hypothesis = { claim: candidate.claim, link: candidate.link, premise: candidate.premise, test: candidate.test };
  const prompt = `${context(finding, data).slice(0, -1)},"hypothesis":${JSON.stringify(hypothesis)}}`;

  let verdict: Verdict;
  try {
    const reply = await run({ model, system: SYSTEM, prompt, stage: "falsify", key });
    const parsed = readReply(reply.text);
    if (!parsed) {
      verdict = { ...ALIVE_NO_COUNTER, model: reply.model };
    } else if (parsed.refuse) {
      verdict = { survived: false, counter: null, counterOutcome: null, reason: `refused: ${parsed.refuse}`, model: reply.model };
    } else if (!parsed.counter) {
      verdict = { survived: true, counter: null, counterOutcome: null, reason: parsed.reason, model: reply.model };
    } else {
      const outcome = evaluate(parsed.counter, finding, data);
      if (outcome.status === "passed") {
        verdict = { survived: false, counter: parsed.counter, counterOutcome: outcome, reason: parsed.reason, model: reply.model };
      } else if (outcome.status === "refused") {
        verdict = { survived: true, counter: parsed.counter, counterOutcome: outcome, reason: `the counter-test was refused: ${outcome.reason}`, model: reply.model };
      } else {
        verdict = { survived: true, counter: parsed.counter, counterOutcome: outcome, reason: parsed.reason, model: reply.model };
      }
    }
  } catch {
    verdict = { ...ALIVE_NO_COUNTER, model };
  }

  if (verdict.survived) {
    const rule = refusedCandidate(candidate);
    if (rule) return { survived: false, counter: null, counterOutcome: null, reason: `refused: ${rule}`, model: verdict.model };
  }
  return verdict;
}

/**
 * The model that argues against `proposer`'s hypotheses: `INSIGHTS_FALSIFIER` as
 * "ollama:<model>" or "claude:<model>" when one is set up, split at its first colon; an
 * unrecognised prefix is ignored. Otherwise Claude's "opus" answers a "sonnet" proposer,
 * and "sonnet" answers any other proposer, so the 2 are always different models.
 */
export function falsifierModel(env: NodeJS.ProcessEnv, proposer: string): { transport: "claude" | "ollama"; model: string } {
  const raw = env.INSIGHTS_FALSIFIER;
  if (raw) {
    const at = raw.indexOf(":");
    if (at > 0) {
      const prefix = raw.slice(0, at);
      const model = raw.slice(at + 1);
      if (prefix === "ollama" || prefix === "claude") return { transport: prefix, model };
    }
  }
  return proposer === "sonnet" ? { transport: "claude", model: "opus" } : { transport: "claude", model: "sonnet" };
}
