/**
 * A second, different model tries to break a candidate hypothesis whose premise already
 * passed its data test. It sees the same finding and figures the proposer saw, and the
 * candidate itself, and writes a counter-test in the same vocabulary: one that would come
 * out true if the premise were wrong. A counter-test that comes out true kills the
 * candidate; one that fails or is refused, or an answer with no counter-test, leaves it
 * alive, since the adversary only removes, never adds. An adversary that never answers,
 * or answers in a shape that can't be read, hasn't argued at all, so the candidate stops
 * there rather than pass for free. `refusal` runs again on the candidate's own text as a
 * last check, and so does the adversary's own call that the hypothesis shouldn't be
 * argued with at all.
 */
import { z } from "zod";
import type { Data } from "./data.ts";
import type { Finding } from "./detect.ts";
import { hash, type Runner } from "./model.ts";
import { catalogue, context, unfence, type Candidate } from "./propose.ts";
import { refusal } from "./safety.ts";
import { CHECK_GRAMMAR, checkSchema, evaluate, signature, type Check, type Outcome } from "./vocabulary.ts";

export interface Verdict {
  survived: boolean;
  stage: "falsify" | "safety" | null; // where a killed candidate stopped: a counter-test or no usable answer, or a refusal
  counter: Check | null;
  counterOutcome: Outcome | null;
  reason: string;
  model: string | null; // the id that answered; null when the call failed
}

export const NO_ANSWER = "the adversary didn't answer";
export const UNREADABLE = "the adversary's answer couldn't be read";

const SYSTEM = `You're checking a hypothesis someone else wrote about why a figure from Morocco's 2024 census stands out. Try to break it.

The hypothesis has a premise, already checked by a data test that came out true, and a claim and a link explaining why the premise would cause the figure. Your job is the premise: write a counter-test, in the same vocabulary as the one that checked it, that would come out true if the premise didn't really explain the figure. A test showing a place the premise says should score high actually scores low breaks it. So does a neighbour with the same premise and none of the figure's outcome. If you can't write one that would settle anything, answer with "counter": null and say why.

For example, a hypothesis claims a commune's low fertility comes from more people having higher education, with a premise the test checked as "this commune's share of people with higher education is above 5%". A counter-test could compare the country's own share of higher education against the same threshold: if most of Morocco clears it too, the premise doesn't pick this commune out from anywhere else, so the counter-test passing would break the hypothesis.

DATA TESTS

A counter-test is one of 3 checks.

${CHECK_GRAMMAR}

The request's "offLimits" fields are the finding's own measure and its siblings: a counter-test that names one is refused, same as it would have been for the original test.

WHAT YOU MAY NOT ARGUE WITH

Some hypotheses shouldn't be countered at all. If the hypothesis names an individual, an ethnic or religious group, or blames a political actor, don't write a counter-test: set "refuse" to "individuals", "groups" or "political" and leave "counter" as null.

ANSWER

Answer with JSON only, nothing before or after it:
{"counter": <data test or null>, "reason": "...", "refuse": "individuals" | "groups" | "political"}
Leave "refuse" out unless it applies.

THE REQUEST

A request is a JSON object with the same shape the hypothesis's own data test was checked against: "finding", "measure" and "kind" (its field and whether it's extreme, change or gap), "offLimits", "unit", "parent" and "figures", followed by "hypothesis": the claim, link, premise and data test you're trying to break.

FIELDS

path | what it measures | unit | 2014 if the 2014 census asked it the same way
${catalogue}`;

/** Folded into a run's id, as the proposer's is. */
export const PROMPT_HASH = hash(SYSTEM);

const replySchema = z.object({
  counter: checkSchema.nullable(),
  reason: z.string().trim().min(1),
  refuse: z.enum(["individuals", "groups", "political"]).optional(),
});

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

/**
 * Asks the adversary to break `candidate`, evaluates its counter-test against the same
 * finding, and applies `refusal` to the candidate's own text as a last check. Never throws:
 * a call that fails stops the candidate with `NO_ANSWER` and no model, and a reply that
 * can't be parsed or validated stops it with `UNREADABLE`, and is never cached.
 */
export async function falsify(candidate: Candidate, finding: Finding, data: Data, run: Runner, model: string): Promise<Verdict> {
  const key = `${finding.id}:${signature(candidate.test)}`;
  const hypothesis = { claim: candidate.claim, link: candidate.link, premise: candidate.premise, test: candidate.test };
  const prompt = `${context(finding, data).slice(0, -1)},"hypothesis":${JSON.stringify(hypothesis)}}`;

  let reply: Awaited<ReturnType<Runner>>;
  try {
    reply = await run({ model, system: SYSTEM, prompt, stage: "falsify", key, accept: (text) => readReply(text) !== null });
  } catch {
    return { survived: false, stage: "falsify", counter: null, counterOutcome: null, reason: NO_ANSWER, model: null };
  }

  const answered = reply.model;
  const parsed = readReply(reply.text);
  let verdict: Verdict;
  if (!parsed) {
    verdict = { survived: false, stage: "falsify", counter: null, counterOutcome: null, reason: UNREADABLE, model: answered };
  } else if (parsed.refuse) {
    verdict = { survived: false, stage: "safety", counter: null, counterOutcome: null, reason: `refused: ${parsed.refuse}`, model: answered };
  } else if (!parsed.counter) {
    verdict = { survived: true, stage: null, counter: null, counterOutcome: null, reason: parsed.reason, model: answered };
  } else {
    const outcome = evaluate(parsed.counter, finding, data);
    if (outcome.status === "passed") {
      verdict = { survived: false, stage: "falsify", counter: parsed.counter, counterOutcome: outcome, reason: parsed.reason, model: answered };
    } else if (outcome.status === "refused") {
      verdict = { survived: true, stage: null, counter: parsed.counter, counterOutcome: outcome, reason: `the counter-test was refused: ${outcome.reason}`, model: answered };
    } else {
      verdict = { survived: true, stage: null, counter: parsed.counter, counterOutcome: outcome, reason: parsed.reason, model: answered };
    }
  }

  if (verdict.survived) {
    const rule = refusedCandidate(candidate);
    if (rule) return { survived: false, stage: "safety", counter: null, counterOutcome: null, reason: `refused: ${rule}`, model: answered };
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
