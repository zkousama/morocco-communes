/**
 * The checklist the pilot's rating asks, shared word for word by the owner's spot-check
 * (`spot.ts`) and the jury's own instructions (`jury.ts`), so a person and a model work from
 * the same definitions. 3 checks on a reason, each yes, no or unsure; for a counter-test, one
 * question, whether it breaks the reason. A reason is sound when the checks come out no, yes
 * and no, the preregistration's second amendment's own rule.
 */

export type Tri = "yes" | "no" | "unsure";

export const TRI: readonly Tri[] = ["yes", "no", "unsure"];

/** The 3 checks, in the order they're asked, by the key a reply names each one with. */
export const CHECKS = ["claimBeyondPremise", "linkExplainsFinding", "ignoresObviousAlternative"] as const;

export type CheckName = (typeof CHECKS)[number];

/** What agreement is reported on: each check, the verdict read off the 3 checks, and `breaks`. */
export const MEASURES = [...CHECKS, "sound", "breaks"] as const;

export type Measure = (typeof MEASURES)[number];

/** Each check's own question, as the guide and the spot-check both ask it. */
export const QUESTIONS: Record<CheckName, string> = {
  claimBeyondPremise: "Does the claim say more than the premise and its numbers show?",
  linkExplainsFinding: "Does the link explain the figure that stands out, rather than something else?",
  ignoresObviousAlternative: "Is there an obvious other explanation the reason ignores?",
};

/** The counter-test's question, with the one-line meaning of "break". */
export const BREAKS_QUESTION = "Does the counter-test break the reason: if its result is true, does the reason fall apart?";

/** One set of answers to an item: the 3 checks, and, for a disagreement, `breaks` for each counter-test by its id. */
export interface ChecklistAnswer {
  claimBeyondPremise: Tri;
  linkExplainsFinding: Tri;
  ignoresObviousAlternative: Tri;
  counters?: Record<string, Tri>;
}

/** What the 3 checks say about the reason: sound on no, yes and no; unsure when any one is unsure; unsound otherwise. */
export function verdictOf(checks: Pick<ChecklistAnswer, CheckName>): "sound" | "unsound" | "unsure" {
  if (CHECKS.some((check) => checks[check] === "unsure")) return "unsure";
  const sound = checks.claimBeyondPremise === "no" && checks.linkExplainsFinding === "yes" && checks.ignoresObviousAlternative === "no";
  return sound ? "sound" : "unsound";
}

/** How to read an item and answer it: printed for the owner before the first item and on `?`, and part of the jury's instructions verbatim. */
export const CHECKLIST_GUIDE = [
  "How to read an item: [the finding], because [the claim]; we know [the premise], checked against the census; [the link] is how it leads to the finding.",
  "",
  "For the reason, answer 3 checks with yes, no or unsure:",
  `1. ${QUESTIONS.claimBeyondPremise} Compare the claim's words with the premise's, and watch for a motive, a cause or a time the premise doesn't give.`,
  `2. ${QUESTIONS.linkExplainsFinding} Ask yourself: if the link is true, would you expect this exact figure?`,
  `3. ${QUESTIONS.ignoresObviousAlternative} Give a moment to the most obvious other explanation, and see whether the reason rules it out.`,
  "",
  `For each counter-test, answer with yes, no or unsure. ${BREAKS_QUESTION} It breaks the reason when its result shows the reason can't be what's driving the figure, for example when places that share the premise don't share the outcome.`,
  "",
  "Answer unsure only when you're genuinely torn.",
].join("\n");
