import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FatalError, LimitError, makeRunner, NO_USAGE, type ModelCall, type ModelReply, type Runner, type Transport } from "../../src/model.ts";
import { agreementOf, analyse, unfinishedRating } from "../../src/pilot/analyse.ts";
import { CHECKLIST_GUIDE, type ChecklistAnswer, type Tri } from "../../src/pilot/checklist.ts";
import {
  CLOUDFLARE_DAILY_NEURONS,
  fileLedger,
  JUDGES,
  juryAndReport,
  JURY_SYSTEM,
  juryAgreement,
  juryPrompt,
  juryRefusal,
  majority,
  memoryLedger,
  missingJudgeKeys,
  parseJuryArgs,
  readJudgeReply,
  runJury,
  spotAgreement,
  toRatings,
  type AnswersByJudge,
  type JuryFile,
  type Provider,
} from "../../src/pilot/jury.ts";
import { SetupError } from "../../src/pilot/stages.ts";
import { counterText, ratingPlan, screen, type RatingItem, type Ratings, type UnitNamer } from "../../src/pilot/rate.ts";
import { ADVERSARIES, PILOT_SEED, PROPOSERS, SPOT_CHECK_ITEMS } from "../../src/pilot/setups.ts";
import { spotItems, type SpotCheck } from "../../src/pilot/spot.ts";
import { fakeStageA, fakeStageB } from "./fixtures.ts";

const a = fakeStageA();
const b = fakeStageB(a);
const plan = ratingPlan(a, b, PILOT_SEED);
const lines = new Map(a.findingIds.map((id) => [id, { en: `line ${id}`, fr: `ligne ${id} fr` }]));
const unitName: UnitNamer = (code) => `unit ${code}`;

type Asked = RatingItem & { kind: "reason" | "disagreement" };
const asked = plan.filter((i): i is Asked => i.kind !== "drift");
const reason = plan.find((i): i is RatingItem & { kind: "reason" } => i.kind === "reason")!;
const disagreement = plan.find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement" && i.counterIds.length > 1)!;
const drift = plan.find((i) => i.kind === "drift")!;

const SOUND = { claimBeyondPremise: "no", linkExplainsFinding: "yes", ignoresObviousAlternative: "no" } as const satisfies ChecklistAnswer;
const UNSOUND = { claimBeyondPremise: "yes", linkExplainsFinding: "yes", ignoresObviousAlternative: "no" } as const satisfies ChecklistAnswer;
const UNSURE = { claimBeyondPremise: "unsure", linkExplainsFinding: "unsure", ignoresObviousAlternative: "unsure" } as const satisfies ChecklistAnswer;
const breaks = (item: RatingItem & { kind: "disagreement" }, answer: Tri, overrides: Record<string, Tri> = {}): Record<string, Tri> => ({
  ...Object.fromEntries(item.counterIds.map((id) => [id, answer])),
  ...overrides,
});

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("the judges", () => {
  it("are the amendment's table, with J2's one stand-in", () => {
    expect(JUDGES).toEqual([
      { id: "J1", provider: "groq", model: "openai/gpt-oss-120b", family: "OpenAI" },
      {
        id: "J2",
        provider: "groq",
        model: "qwen/qwen3.8-27b",
        family: "Alibaba",
        fallback: { provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", family: "Google" },
      },
      { id: "J3", provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", family: "Meta" },
    ]);
  });

  it("names exactly the models the amendment names, and none the pilot's own setups use", () => {
    const text = readFileSync("insights/pilot/preregistration.md", "utf8");
    const amendment = text.slice(text.indexOf("\n## Amendment, 26 September 2026: who rates\n"));
    const pilotModels = new Set([...PROPOSERS, ...ADVERSARIES].map((r) => r.model));
    for (const judge of JUDGES) {
      for (const role of [judge, ...(judge.fallback ? [judge.fallback] : [])]) {
        expect(amendment).toContain(`\`${role.model}\``);
        expect(pilotModels.has(role.model)).toBe(false);
        expect(role.family).not.toMatch(/anthropic/i);
      }
    }
  });

  it("names the spot-check's size the code draws", () => {
    const text = readFileSync("insights/pilot/preregistration.md", "utf8").replace(/\s+/g, " ");
    expect(text).toContain(`the same questions on ${SPOT_CHECK_ITEMS} items`);
  });
});

describe("the jury's instructions", () => {
  it("carry the owner's own guide word for word", () => {
    expect(JURY_SYSTEM).toContain(CHECKLIST_GUIDE);
  });

  it("give the JSON shape for each kind of item, by the keys a reply is read with", () => {
    for (const key of ["claimBeyondPremise", "linkExplainsFinding", "ignoresObviousAlternative", "counters"]) expect(JURY_SYSTEM).toContain(`"${key}"`);
    expect(JURY_SYSTEM).toMatch(/one JSON object only/);
  });

  it("keep to the copy rules: no em dash", () => {
    expect(JURY_SYSTEM).not.toContain("—");
    expect(CHECKLIST_GUIDE).not.toContain("—");
  });
});

describe("juryPrompt", () => {
  const bannedWords = [...PROPOSERS, ...ADVERSARIES]
    .flatMap((r) => [r.id, r.model])
    .concat(["medium", "high", "survived", "published", "falsify", "safety", "proposer", "adversary", "stage", "claude", "anthropic"]);

  it("never names a setup, a model, an effort, a run or a stage, for any item the jury is asked, instructions included", () => {
    for (const item of asked) {
      const text = `${JURY_SYSTEM}\n${juryPrompt(item, a, b, lines, unitName)}`.toLowerCase();
      for (const word of bannedWords) expect(text, `${item.itemId}: ${word}`).not.toMatch(new RegExp(`\\b${escape(word.toLowerCase())}\\b`));
    }
  });

  it("shows a reason exactly as the owner's screen does", () => {
    expect(juryPrompt(reason, a, b, lines, unitName)).toBe(screen(reason, a, b, lines));
  });

  it("follows a disagreement's reason with each counter-test, labelled by its id", () => {
    const text = juryPrompt(disagreement, a, b, lines, unitName);
    expect(text.startsWith(screen(disagreement, a, b, lines))).toBe(true);
    for (const id of disagreement.counterIds) expect(text).toContain(`[${id}] ${counterText(disagreement.candidateId, id, b, unitName)}`);
  });
});

describe("readJudgeReply", () => {
  const json = (value: unknown) => JSON.stringify(value);

  it("reads a reason's 3 checks, keeping nothing else a reply adds", () => {
    expect(readJudgeReply(json({ ...SOUND, note: "free text" }), reason)).toEqual(SOUND);
    expect(readJudgeReply(json({ ...SOUND, counters: { x: "yes" } }), reason)).toEqual(SOUND);
  });

  it("finds the object inside other text or a code fence, and ignores the rest", () => {
    expect(readJudgeReply(`Here's my answer:\n\`\`\`json\n${json(UNSOUND)}\n\`\`\`\nThe claim goes too far.`, reason)).toEqual(UNSOUND);
  });

  it("skips a reasoning block and anything in braces that isn't JSON", () => {
    expect(readJudgeReply(`<think>maybe ${json(SOUND)}? no</think>${json(UNSOUND)}`, reason)).toEqual(UNSOUND);
    expect(readJudgeReply(`the set {a, b} first, then ${json(SOUND)}`, reason)).toEqual(SOUND);
  });

  it("copes with braces inside a string", () => {
    expect(readJudgeReply(`{"note": "a } and a {", "claimBeyondPremise": "no", "linkExplainsFinding": "yes", "ignoresObviousAlternative": "no"}`, reason)).toEqual(SOUND);
  });

  it("reads the first JSON object only: an invalid one makes the reply unusable, whatever follows", () => {
    expect(readJudgeReply(`${json({ claimBeyondPremise: "no" })} ${json(SOUND)}`, reason)).toBeNull();
  });

  it("is unusable with no object, a missing field or an answer outside yes, no and unsure", () => {
    expect(readJudgeReply("", reason)).toBeNull();
    expect(readJudgeReply("yes, no, no", reason)).toBeNull();
    expect(readJudgeReply(json({ claimBeyondPremise: "no", linkExplainsFinding: "yes" }), reason)).toBeNull();
    expect(readJudgeReply(json({ ...SOUND, linkExplainsFinding: "Yes" }), reason)).toBeNull();
    expect(readJudgeReply(json({ ...SOUND, linkExplainsFinding: true }), reason)).toBeNull();
  });

  it("needs breaks for every counter-test of a disagreement, and drops a counter id it wasn't asked about", () => {
    const counters = breaks(disagreement, "yes");
    expect(readJudgeReply(json({ ...SOUND, counters: { ...counters, other: "no" } }), disagreement)).toEqual({ ...SOUND, counters });
    const [first, ...rest] = disagreement.counterIds;
    expect(readJudgeReply(json({ ...SOUND, counters: Object.fromEntries(rest.map((id) => [id, "no"])) }), disagreement)).toBeNull();
    expect(readJudgeReply(json({ ...SOUND, counters: { ...counters, [first!]: "maybe" } }), disagreement)).toBeNull();
    expect(readJudgeReply(json(SOUND), disagreement)).toBeNull();
    expect(readJudgeReply(json({ ...SOUND, counters: ["yes"] }), disagreement)).toBeNull();
  });

  it("never reads an answer to a drift item: the jury isn't asked one", () => {
    expect(readJudgeReply(json(SOUND), drift)).toBeNull();
  });
});

describe("majority", () => {
  it("takes a unanimous answer, and 2 against 1", () => {
    expect(majority(["yes", "yes", "yes"])).toBe("yes");
    expect(majority(["no", "yes", "no"])).toBe("no");
    expect(majority(["yes", "yes", null])).toBe("yes");
  });

  it("is unsure on a tie, with fewer than 2 answers, or when every judge was unsure", () => {
    expect(majority(["yes", "no", null])).toBe("unsure");
    expect(majority(["yes", "no", "unsure"])).toBe("unsure");
    expect(majority(["yes", null, null])).toBe("unsure");
    expect(majority(["yes", "unsure", "unsure"])).toBe("unsure");
    expect(majority(["unsure", "unsure", "unsure"])).toBe("unsure");
    expect(majority([null, undefined, null])).toBe("unsure");
  });
});

describe("toRatings", () => {
  const AT = "2026-09-27T00:00:00.000Z";
  const small: RatingItem[] = [reason, disagreement, drift];
  const answerOf = (ratings: Ratings, itemId: string) => ratings.answers.find((x) => x.itemId === itemId)!;

  it("rates a reason sound on a unanimous no, yes, no", () => {
    const byJudge: AnswersByJudge = { J1: { [reason.itemId]: SOUND }, J2: { [reason.itemId]: SOUND }, J3: { [reason.itemId]: SOUND } };
    expect(answerOf(toRatings(small, byJudge, AT), reason.itemId).answer).toBe("yes");
  });

  it("goes with 2 judges against 1, check by check", () => {
    const byJudge: AnswersByJudge = { J1: { [reason.itemId]: UNSOUND }, J2: { [reason.itemId]: SOUND }, J3: { [reason.itemId]: SOUND } };
    expect(answerOf(toRatings(small, byJudge, AT), reason.itemId).answer).toBe("yes");
    const twoUnsound: AnswersByJudge = { J1: { [reason.itemId]: UNSOUND }, J2: { [reason.itemId]: UNSOUND }, J3: { [reason.itemId]: SOUND } };
    expect(answerOf(toRatings(small, twoUnsound, AT), reason.itemId).answer).toBe("no");
  });

  it("skips a reason when a check splits 1 to 1 with the third judge unusable", () => {
    const byJudge: AnswersByJudge = { J1: { [reason.itemId]: UNSOUND }, J2: { [reason.itemId]: SOUND }, J3: { [reason.itemId]: null } };
    expect(answerOf(toRatings(small, byJudge, AT), reason.itemId).answer).toBe("skip");
  });

  it("skips a reason every judge was unsure about", () => {
    const byJudge: AnswersByJudge = { J1: { [reason.itemId]: UNSURE }, J2: { [reason.itemId]: UNSURE }, J3: { [reason.itemId]: UNSURE } };
    expect(answerOf(toRatings(small, byJudge, AT), reason.itemId).answer).toBe("skip");
  });

  it("rates each counter-test by the majority of breaks, a tie a skip", () => {
    const [first, second] = disagreement.counterIds as [string, string];
    const byJudge: AnswersByJudge = {
      J1: { [disagreement.itemId]: { ...UNSOUND, counters: breaks(disagreement, "yes", { [second]: "yes" }) } },
      J2: { [disagreement.itemId]: { ...UNSOUND, counters: breaks(disagreement, "yes", { [second]: "no" }) } },
      J3: { [disagreement.itemId]: null },
    };
    const answer = answerOf(toRatings(small, byJudge, AT), disagreement.itemId);
    expect(answer.answer).toBe("no");
    expect(answer.counters![first]).toBe("yes");
    expect(answer.counters![second]).toBe("skip");
    expect(Object.keys(answer.counters!).sort()).toEqual([...disagreement.counterIds].sort());
  });

  it("answers a drift item skip: the drift check doesn't apply to a jury", () => {
    expect(answerOf(toRatings(small, {}, AT), drift.itemId)).toEqual({ itemId: drift.itemId, answer: "skip", at: AT });
  });

  it("writes the rating's own shape, every item answered, which the analysis reads as it would the owner's", () => {
    const everyone = (answer: ChecklistAnswer) =>
      Object.fromEntries(asked.map((item) => [item.itemId, item.kind === "disagreement" ? { ...answer, counters: breaks(item, "yes") } : answer]));
    const byJudge: AnswersByJudge = { J1: everyone(SOUND), J2: everyone(SOUND), J3: everyone(UNSOUND) };
    const ratings = toRatings(plan, byJudge, AT);
    expect(ratings.items).toBe(plan);
    expect(ratings.answers.map((x) => x.itemId)).toEqual(plan.map((i) => i.itemId));
    expect(unfinishedRating(ratings)).toBeNull();
    const results = analyse(a, b, ratings);
    expect(results.drift).toEqual({ kappa: null, n: 0 });
  });
});

describe("juryAgreement", () => {
  const two: Asked[] = [reason, disagreement];

  it("reads 3 judges who agree on everything as full agreement on every measure", () => {
    const one = { [reason.itemId]: SOUND, [disagreement.itemId]: { ...UNSOUND, counters: breaks(disagreement, "no") } };
    const result = juryAgreement(two, { J1: one, J2: one, J3: one });
    for (const pair of ["J1|J2", "J1|J3", "J2|J3"]) {
      for (const measure of ["claimBeyondPremise", "linkExplainsFinding", "ignoresObviousAlternative", "sound"] as const) {
        expect(result.pairs[pair]![measure]).toEqual({ n: 2, raw: 1, kappa: 1 });
      }
      expect(result.pairs[pair]!.breaks).toEqual({ n: disagreement.counterIds.length, raw: 1, kappa: 1 });
    }
    expect(result.all.sound).toEqual({ n: 2, share: 1 });
  });

  it("has nothing to measure where 2 judges never both answered usably", () => {
    const result = juryAgreement(two, { J1: { [reason.itemId]: SOUND }, J2: { [disagreement.itemId]: null }, J3: {} });
    expect(result.pairs["J1|J2"]!.sound).toEqual({ n: 0, raw: null, kappa: null });
    expect(result.pairs["J1|J2"]!.breaks).toEqual({ n: 0, raw: null, kappa: null });
    expect(result.all.claimBeyondPremise).toEqual({ n: 0, share: null });
  });

  it("is Cohen's kappa over the items both judges answered, each judge's own verdict read off its 3 checks", () => {
    const items = asked.filter((i) => i.kind === "reason").slice(0, 4);
    const j1 = [SOUND, SOUND, UNSOUND, UNSOUND];
    const j2 = [SOUND, UNSOUND, UNSOUND, UNSURE];
    const byJudge: AnswersByJudge = {
      J1: Object.fromEntries(items.map((item, i) => [item.itemId, j1[i]!])),
      J2: Object.fromEntries(items.map((item, i) => [item.itemId, j2[i]!])),
      J3: {},
    };
    const result = juryAgreement(items, byJudge);
    expect(result.pairs["J1|J2"]!.sound).toEqual({
      n: 4,
      raw: 0.5,
      kappa: agreementOf(["sound", "sound", "unsound", "unsound"], ["sound", "unsound", "unsound", "unsure"]),
    });
    expect(result.pairs["J1|J2"]!.claimBeyondPremise).toEqual({ n: 4, raw: 0.5, kappa: agreementOf(["no", "no", "yes", "yes"], ["no", "yes", "yes", "unsure"]) });
    expect(result.pairs["J1|J3"]!.sound.n).toBe(0);
  });

  it("counts the share of items where all 3 judges agree, over the ones all 3 answered", () => {
    const items = asked.filter((i) => i.kind === "reason").slice(0, 3);
    const byJudge: AnswersByJudge = {
      J1: { [items[0]!.itemId]: SOUND, [items[1]!.itemId]: SOUND, [items[2]!.itemId]: SOUND },
      J2: { [items[0]!.itemId]: SOUND, [items[1]!.itemId]: UNSOUND, [items[2]!.itemId]: SOUND },
      J3: { [items[0]!.itemId]: SOUND, [items[1]!.itemId]: SOUND, [items[2]!.itemId]: null },
    };
    const result = juryAgreement(items, byJudge);
    expect(result.all.sound).toEqual({ n: 2, share: 0.5 });
    expect(result.all.linkExplainsFinding).toEqual({ n: 2, share: 1 });
  });
});

describe("spotAgreement", () => {
  it("sets the owner's answers against the jury's majority on the sampled items, check by check, on the verdict and on breaks", () => {
    const sample = spotItems(plan);
    const reasonIn = sample.find((i) => i.kind === "reason")!;
    const disagreementIn = sample.find((i): i is RatingItem & { kind: "disagreement" } => i.kind === "disagreement")!;
    const byJudge: AnswersByJudge = {
      J1: { [reasonIn.itemId]: SOUND, [disagreementIn.itemId]: { ...UNSOUND, counters: breaks(disagreementIn, "yes") } },
      J2: { [reasonIn.itemId]: SOUND, [disagreementIn.itemId]: { ...UNSOUND, counters: breaks(disagreementIn, "yes") } },
      J3: { [reasonIn.itemId]: UNSOUND, [disagreementIn.itemId]: null },
    };
    const spot: SpotCheck = {
      items: sample.map((i) => i.itemId),
      answers: [
        { itemId: reasonIn.itemId, ...SOUND },
        { itemId: disagreementIn.itemId, ...SOUND, counters: breaks(disagreementIn, "yes") },
      ],
    };
    const result = spotAgreement(spot, plan, byJudge);
    expect(result.items).toBe(2);
    expect(result.measures.sound).toEqual({ n: 2, raw: 0.5, kappa: agreementOf(["sound", "sound"], ["sound", "unsound"]) });
    expect(result.measures.claimBeyondPremise).toEqual({ n: 2, raw: 0.5, kappa: agreementOf(["no", "no"], ["no", "yes"]) });
    expect(result.measures.linkExplainsFinding).toEqual({ n: 2, raw: 1, kappa: 1 });
    expect(result.measures.breaks).toEqual({ n: disagreementIn.counterIds.length, raw: 1, kappa: 1 });
  });

  it("reads only the plan's own sample, whatever else the file holds", () => {
    const outside = asked.find((i) => !spotItems(plan).some((x) => x.itemId === i.itemId) && i.kind === "reason")!;
    const spot: SpotCheck = { items: [outside.itemId], answers: [{ itemId: outside.itemId, ...SOUND }] };
    expect(spotAgreement(spot, plan, { J1: { [outside.itemId]: SOUND }, J2: { [outside.itemId]: SOUND }, J3: {} }).items).toBe(0);
  });
});

describe("juryRefusal", () => {
  const complete: SpotCheck = { items: [], answers: spotItems(plan).map((i) => ({ itemId: i.itemId, ...SOUND })) };

  it("refuses with no plan to rate", () => {
    expect(juryRefusal({ items: [], answers: [] }, complete, false)).toMatch(/no rating plan.*pnpm insights:pilot:rate/);
  });
  it("refuses to replace answers already there, unless told to", () => {
    const answered: Ratings = { items: plan, answers: [{ itemId: reason.itemId, answer: "yes", at: "t" }] };
    expect(juryRefusal(answered, complete, false)).toMatch(/already has 1 answer.*--force-replace/);
    expect(juryRefusal(answered, complete, true)).toBeNull();
  });
  it("refuses until the owner's spot-check has an answer for every one of its items", () => {
    const ratings: Ratings = { items: plan, answers: [] };
    expect(juryRefusal(ratings, null, false)).toMatch(new RegExp(`${SPOT_CHECK_ITEMS} of ${SPOT_CHECK_ITEMS} items.*pnpm insights:pilot:spot`));
    expect(juryRefusal(ratings, { items: [], answers: complete.answers.slice(1) }, false)).toMatch(new RegExp(`1 of ${SPOT_CHECK_ITEMS} items`));
    expect(juryRefusal(ratings, complete, false)).toBeNull();
  });
});

describe("missingJudgeKeys", () => {
  it("names every key when there's no local folder at all", () => {
    const message = missingJudgeKeys(null)!;
    for (const key of ["INSIGHTS_LOCAL", "GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) expect(message).toContain(key);
  });
  it("names only what's missing, never a value", () => {
    const message = missingJudgeKeys({ terms: [], keys: { GROQ_API_KEY: "g-secret", CLOUDFLARE_ACCOUNT_ID: "acct" } })!;
    expect(message).toContain("CLOUDFLARE_API_TOKEN");
    expect(message).not.toContain("GROQ_API_KEY");
    expect(message).not.toContain("g-secret");
  });
  it("passes once every judge's keys are there", () => {
    expect(missingJudgeKeys({ terms: [], keys: { GROQ_API_KEY: "g", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "c" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Running the jury
// ---------------------------------------------------------------------------------------

const itemById = new Map(plan.map((item) => [item.itemId, item]));
const itemOf = (call: ModelCall): RatingItem => itemById.get(call.key.slice(call.key.indexOf(":") + 1))!;
const goodReply = (item: RatingItem): string =>
  JSON.stringify(item.kind === "disagreement" ? { ...SOUND, counters: breaks(item, "no") } : SOUND);

/** A runner answering every item well, recording each call; `usage` sets what each reply reports it spent. */
function recording(answer: (call: ModelCall) => string = (call) => goodReply(itemOf(call)), usage: Partial<ModelReply["usage"]> = {}) {
  const calls: ModelCall[] = [];
  let inFlight = 0;
  let most = 0;
  const run: Runner = async (call) => {
    calls.push(call);
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    return { text: answer(call), model: `${call.model}-served`, promptHash: "h", cached: false, ms: 250, usage: { ...NO_USAGE, input: 700, output: 60, ...usage }, waitedMs: 5 };
  };
  return { run, calls, most: () => most };
}

const runnersOf = (groq: Runner, cloudflare: Runner) => new Map<Provider, Runner>([["groq", groq], ["cloudflare", cloudflare]]);
const DAY_ONE = new Date("2026-09-27T10:00:00.000Z");
const DAY_TWO = new Date("2026-09-28T00:30:00.000Z");
const options = (extra: Partial<Parameters<typeof runJury>[5]> = {}): Parameters<typeof runJury>[5] => ({
  unitName,
  ledger: memoryLedger(),
  now: () => DAY_ONE,
  ...extra,
});

/** A few reasons and disagreements and a drift item: enough to run, quick to cache. */
const few: RatingItem[] = [
  ...plan.filter((i) => i.kind === "reason").slice(0, 7),
  ...plan.filter((i) => i.kind === "disagreement").slice(0, 5),
  drift,
];
const fewAsked = few.filter((i) => i.kind !== "drift");

describe("runJury", () => {
  it("asks every judge every reason and disagreement once, never a drift item, on stage jury with a key per judge and item", async () => {
    const groq = recording();
    const cloudflare = recording();
    const run = await runJury(few, a, b, lines, runnersOf(groq.run, cloudflare.run), options());
    expect(run.judges.map((j) => j.id)).toEqual(["J1", "J2", "J3"]);
    const all = [...groq.calls, ...cloudflare.calls];
    expect(all).toHaveLength(3 * fewAsked.length);
    for (const judge of JUDGES) {
      const mine = all.filter((c) => c.key.startsWith(`${judge.id}:`));
      expect(mine.map((c) => c.key).sort()).toEqual(fewAsked.map((i) => `${judge.id}:${i.itemId}`).sort());
      for (const call of mine) {
        expect(call).toMatchObject({ stage: "jury", model: judge.model, system: JURY_SYSTEM });
        expect(call.accept).toBeUndefined();
        expect(call.prompt).toBe(juryPrompt(itemOf(call) as Asked, a, b, lines, unitName));
      }
    }
    expect(groq.calls.every((c) => c.key.startsWith("J1:") || c.key.startsWith("J2:"))).toBe(true);
    expect(cloudflare.calls.every((c) => c.key.startsWith("J3:"))).toBe(true);
  });

  it("reads each judge's answers, counting what was usable and unsure, what it spent, and which model answered", async () => {
    const unusableId = fewAsked[0]!.itemId;
    const unsureId = fewAsked[1]!.itemId;
    const answer = (call: ModelCall) => {
      const item = itemOf(call);
      if (item.itemId === unusableId) return "I can't say.";
      if (item.itemId === unsureId) return JSON.stringify({ ...SOUND, linkExplainsFinding: "unsure" });
      return goodReply(item);
    };
    const run = await runJury(few, a, b, lines, runnersOf(recording(answer).run, recording(answer).run), options());
    const j1 = run.judges[0]!;
    expect(j1.answers[unusableId]).toBeNull();
    expect(j1.answers[unsureId]!.linkExplainsFinding).toBe("unsure");
    expect(j1).toMatchObject({ asked: fewAsked.length, usable: fewAsked.length - 1, failed: 0, unsure: 1, calls: fewAsked.length, answered: ["openai/gpt-oss-120b-served"] });
    expect(j1.usage).toMatchObject({ input: 700 * fewAsked.length, output: 60 * fewAsked.length });
    expect(j1.ms).toBe(250 * fewAsked.length);
    expect(j1.waitedMs).toBe(5 * fewAsked.length);
    expect(Object.keys(j1.answers).sort()).toEqual(fewAsked.map((i) => i.itemId).sort());
  });

  it("runs one call at a time unless told otherwise", async () => {
    const groq = recording();
    const cloudflare = recording();
    await runJury(few, a, b, lines, runnersOf(groq.run, cloudflare.run), options());
    expect(Math.max(groq.most(), cloudflare.most())).toBe(1);
    const faster = recording();
    await runJury(few, a, b, lines, runnersOf(faster.run, recording().run), options({ concurrency: 3 }));
    expect(faster.most()).toBeGreaterThan(1);
  });

  it("checks it has a runner for every provider a judge or J2's stand-in needs before any call", async () => {
    const groq = recording();
    await expect(runJury(few, a, b, lines, new Map([["groq", groq.run]]), options())).rejects.toBeInstanceOf(SetupError);
    expect(groq.calls).toHaveLength(0);
  });

  it("resumes without asking again, replaying even an unusable answer exactly", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "jury-"));
    let asks = 0;
    const transport: Transport = async (call) => {
      asks++;
      const item = itemOf(call);
      return { text: item.itemId === fewAsked[2]!.itemId ? "not json" : goodReply(item), model: call.model, usage: NO_USAGE };
    };
    const runner = () => makeRunner(transport, { cacheDir, datasetVersion: "t", stageVersions: {} });
    const first = await runJury(few, a, b, lines, runnersOf(runner(), runner()), options());
    expect(asks).toBe(3 * fewAsked.length);
    const again = await runJury(few, a, b, lines, runnersOf(runner(), runner()), options());
    expect(asks).toBe(3 * fewAsked.length);
    expect(again.judges.map((j) => j.answers)).toEqual(first.judges.map((j) => j.answers));
    expect(again.judges[0]!.answers[fewAsked[2]!.itemId]).toBeNull();
  });

  describe("halting", () => {
    const failing = (error: () => Error) => {
      let calls = 0;
      const run: Runner = async () => {
        calls++;
        throw error();
      };
      return { run, calls: () => calls };
    };

    it("halts at once on a fatal error, making no further call", async () => {
      const groq = failing(() => new FatalError("groq answered 401: bad key", 401));
      const cloudflare = recording();
      await expect(runJury(plan, a, b, lines, runnersOf(groq.run, cloudflare.run), options())).rejects.toThrow(/a judge call failed: groq answered 401/);
      expect(groq.calls()).toBe(1);
      expect(cloudflare.calls).toHaveLength(0);
    });

    it("halts at once when a usage limit outlasted its wait", async () => {
      const groq = failing(() => new LimitError("the usage limit didn't reset within 6 hours", null));
      await expect(runJury(plan, a, b, lines, runnersOf(groq.run, recording().run), options())).rejects.toThrow(/usage limit/);
      expect(groq.calls()).toBe(1);
    });

    it("halts after 3 ordinary failures in a row", async () => {
      const groq = failing(() => new Error("groq answered 409: conflict"));
      await expect(runJury(plan, a, b, lines, runnersOf(groq.run, recording().run), options())).rejects.toThrow(/3 judge calls in a row failed/);
      expect(groq.calls()).toBe(3);
    });

    it("keeps going after one failure, recording that item as unusable", async () => {
      let n = 0;
      const flaky = recording();
      const groq: Runner = async (call) => {
        if (n++ === 0) throw new Error("groq: network error: reset");
        return flaky.run(call);
      };
      const run = await runJury(few, a, b, lines, runnersOf(groq, recording().run), options());
      const j1 = run.judges[0]!;
      expect(j1.failed).toBe(1);
      expect(j1.usable).toBe(fewAsked.length - 1);
      expect(Object.values(j1.answers).filter((x) => x === null)).toHaveLength(1);
    });
  });

  describe("J2's stand-in", () => {
    const withdrawn = (groqAnswer: (call: ModelCall) => Promise<ModelReply> | never, cloudflare = recording()) => {
      const groqCalls: ModelCall[] = [];
      const groq: Runner = async (call) => {
        groqCalls.push(call);
        return groqAnswer(call);
      };
      return { groq, groqCalls, cloudflare };
    };
    const ok = recording();

    it("takes J2's place when J2's first call answers 404, before any of J2's answers count, and says so", async () => {
      const setup = withdrawn(async (call) => {
        if (call.model === "qwen/qwen3.8-27b") throw new FatalError("groq answered 404: model not found", 404);
        return ok.run(call);
      });
      const run = await runJury(few, a, b, lines, runnersOf(setup.groq, setup.cloudflare.run), options());
      expect(setup.groqCalls.filter((c) => c.model === "qwen/qwen3.8-27b")).toHaveLength(1);
      expect(run.fallback).toEqual({ judge: "J2", from: "qwen/qwen3.8-27b", to: "@cf/google/gemma-4-26b-a4b-it", status: 404 });
      const j2 = run.judges[1]!;
      expect(j2).toMatchObject({ id: "J2", provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", family: "Google", usable: fewAsked.length, failed: 0 });
      const gemma = setup.cloudflare.calls.filter((c) => c.key.startsWith("J2:"));
      expect(gemma.map((c) => c.key).sort()).toEqual(fewAsked.map((i) => `J2:${i.itemId}`).sort());
      expect(gemma.every((c) => c.model === "@cf/google/gemma-4-26b-a4b-it")).toBe(true);
    });

    it("records no switch when J2's model answers", async () => {
      const run = await runJury(few, a, b, lines, runnersOf(recording().run, recording().run), options());
      expect(run.fallback).toBeNull();
      expect(run.judges[1]).toMatchObject({ provider: "groq", model: "qwen/qwen3.8-27b", family: "Alibaba" });
    });

    it("halts on a 404 after J2's first call, or on J1's: no other substitution", async () => {
      let qwen = 0;
      const late = withdrawn(async (call) => {
        if (call.model === "qwen/qwen3.8-27b" && qwen++ > 0) throw new FatalError("groq answered 404: model not found", 404);
        return ok.run(call);
      });
      await expect(runJury(few, a, b, lines, runnersOf(late.groq, late.cloudflare.run), options())).rejects.toThrow(/404/);
      const early = withdrawn(async () => {
        throw new FatalError("groq answered 404: model not found", 404);
      });
      await expect(runJury(few, a, b, lines, runnersOf(early.groq, early.cloudflare.run), options())).rejects.toThrow(/404/);
      expect(early.groqCalls).toHaveLength(1);
      expect(early.cloudflare.calls).toHaveLength(0);
    });
  });

  describe("the Cloudflare budget", () => {
    it("halts before the day's neurons would pass 9,000, and counts only what Cloudflare's judges spent", async () => {
      expect(CLOUDFLARE_DAILY_NEURONS).toBe(9_000);
      const ledger = memoryLedger();
      const groq = recording(undefined, { neurons: 5_000 }); // never counted: groq isn't Cloudflare
      const cloudflare = recording(undefined, { neurons: 1_000 });
      await expect(runJury(plan, a, b, lines, runnersOf(groq.run, cloudflare.run), options({ ledger }))).rejects.toThrow(
        /9,000 neurons.*2026-09-27.*after midnight UTC/,
      );
      expect(cloudflare.calls).toHaveLength(9);
      expect(ledger.days).toEqual({ "2026-09-27": 9_000 });
    });

    it("halts before its first call when earlier calls today already used the allowance", async () => {
      const ledger = memoryLedger({ "2026-09-27": 8_999 });
      const cloudflare = recording(undefined, { neurons: 50 });
      await expect(runJury(few, a, b, lines, runnersOf(recording().run, cloudflare.run), options({ ledger }))).rejects.toThrow(/neurons/);
      expect(cloudflare.calls).toHaveLength(0);
    });

    it("resumes the next UTC day, replaying what's cached without counting it again", async () => {
      const cacheDir = mkdtempSync(join(tmpdir(), "jury-neurons-"));
      let fresh = 0;
      const transport: Transport = async (call) => {
        fresh++;
        return { text: goodReply(itemOf(call)), model: call.model, usage: { ...NO_USAGE, input: 700, output: 60, neurons: 1_000 } };
      };
      const runners = () => runnersOf(makeRunner(transport, { cacheDir, datasetVersion: "t", stageVersions: {} }), makeRunner(transport, { cacheDir, datasetVersion: "t", stageVersions: {} }));
      const ledger = memoryLedger();
      await expect(runJury(few, a, b, lines, runners(), options({ ledger, neuronLimit: 7_000 }))).rejects.toThrow(/neurons/);
      expect(ledger.days["2026-09-27"]).toBe(7_000);
      const before = fresh;
      const run = await runJury(few, a, b, lines, runners(), options({ ledger, neuronLimit: 7_000, now: () => DAY_TWO }));
      expect(fresh - before).toBe(fewAsked.length - 7); // J3's last items alone: J1, J2 and J3's first 7 replay from the cache
      expect(ledger.days["2026-09-28"]).toBe((fewAsked.length - 7) * 1_000);
      expect(run.judges[2]!.usable).toBe(fewAsked.length);
    });

    it("estimates a call's neurons from its tokens at the model's own rate when the reply doesn't report them", async () => {
      const ledger = memoryLedger();
      const cloudflare = recording(undefined, { input: 1_000, output: 100 });
      await runJury(few, a, b, lines, runnersOf(recording().run, cloudflare.run), options({ ledger }));
      // Llama 3.3 70B: 26,668 neurons per million tokens in, 204,805 per million out.
      expect(ledger.days["2026-09-27"]).toBeCloseTo(fewAsked.length * ((1_000 * 26_668 + 100 * 204_805) / 1e6), 6);
    });

    it("stops at once when it can't record what a call spent, rather than count it as a failed call", async () => {
      const cloudflare = recording(undefined, { neurons: 10 });
      const broken = { spent: async () => 0, add: async () => { throw new Error("couldn't write the ledger: disk full"); } };
      await expect(runJury(few, a, b, lines, runnersOf(recording().run, cloudflare.run), options({ ledger: broken }))).rejects.toThrow(/^couldn't write the ledger: disk full$/);
      expect(cloudflare.calls).toHaveLength(1);
    });

    it("keeps its total in a file, per UTC day, across runs", async () => {
      const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "neurons.json");
      const ledger = fileLedger(path);
      expect(await ledger.spent("2026-09-27")).toBe(0);
      await ledger.add("2026-09-27", 1.5);
      await fileLedger(path).add("2026-09-27", 2);
      await fileLedger(path).add("2026-09-28", 4);
      expect(await fileLedger(path).spent("2026-09-27")).toBe(3.5);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ "2026-09-27": 3.5, "2026-09-28": 4 });
    });
  });
});

describe("juryAndReport", () => {
  const complete: SpotCheck = { items: spotItems(plan).map((i) => i.itemId), answers: spotItems(plan).map((i) => ({ itemId: i.itemId, ...SOUND, ...(i.kind === "disagreement" ? { counters: breaks(i, "no") } : {}) })) };
  const input = (ratings: Ratings = { items: plan, answers: [] }, spot: SpotCheck | null = complete) => ({ a, b, lines, unitName, ratings, spot });
  const MARKER = "FREE-TEXT-THE-JUDGE-WROTE";
  const chatty = (call: ModelCall) => `${MARKER} ${itemOf(call).itemId}\n${goodReply(itemOf(call))}\nbecause ${MARKER}`;

  function io() {
    const logs: string[] = [];
    const errors: string[] = [];
    const written: { jury?: JuryFile; ratings?: Ratings } = {};
    return {
      logs,
      errors,
      written,
      io: {
        log: (l: string) => logs.push(l),
        error: (l: string) => errors.push(l),
        writeJury: async (v: JuryFile) => void (written.jury = v),
        writeRatings: async (v: Ratings) => void (written.ratings = v),
      },
    };
  }

  it("writes the jury's file and its majority answers, with no text a judge wrote", async () => {
    const out = io();
    const ok = await juryAndReport(input(), runnersOf(recording(chatty).run, recording(chatty).run), { ledger: memoryLedger(), now: () => DAY_ONE }, out.io);
    expect(out.errors).toEqual([]);
    expect(ok).toBe(true);
    const jury = out.written.jury!;
    const answersByJudge = Object.fromEntries(jury.judges.map((j) => [j.id, jury.answers[j.id]!]));
    expect(out.written.ratings).toEqual(toRatings(plan, answersByJudge, DAY_ONE.toISOString()));
    expect(jury.agreement).toEqual(juryAgreement(plan, answersByJudge));
    expect(jury.spotCheck).toEqual(spotAgreement(complete, plan, answersByJudge));
    expect(jury.fallback).toBeNull();
    expect(jury.judges.map((j) => j.model)).toEqual(JUDGES.map((j) => j.model));
    const raw = JSON.stringify(jury);
    expect(raw).not.toContain(MARKER);
    for (const c of a.candidates) expect(raw).not.toContain(c.candidate.claim.en);
  });

  it("prints one progress line per judge per 10 items, and a usage line per judge", async () => {
    const out = io();
    await juryAndReport(input(), runnersOf(recording().run, recording(undefined, { neurons: 2 }).run), { ledger: memoryLedger(), now: () => DAY_ONE }, out.io);
    const total = asked.length;
    for (const judge of JUDGES) {
      const progress = out.logs.filter((l) => l.startsWith(`${judge.id} ${judge.model}: `) && l.endsWith(" items"));
      expect(progress).toHaveLength(Math.ceil(total / 10));
      expect(progress.at(-1)).toBe(`${judge.id} ${judge.model}: ${total} of ${total} items`);
      expect(out.logs.filter((l) => l.startsWith(`usage: ${judge.id} `))).toHaveLength(1);
    }
    expect(out.logs.find((l) => l.startsWith("usage: J3 "))).toMatch(/neurons/);
  });

  it("stops with the reason on a halt, and writes nothing", async () => {
    const out = io();
    const fatal: Runner = async () => {
      throw new FatalError("groq answered 401: bad key", 401);
    };
    const ok = await juryAndReport(input(), runnersOf(fatal, recording().run), { ledger: memoryLedger() }, out.io);
    expect(ok).toBe(false);
    expect(out.written).toEqual({});
    expect(out.errors).toEqual(["the jury stopped: a judge call failed: groq answered 401: bad key; answers so far are cached, run it again to resume"]);
  });

  it("refuses to start before the owner's spot-check is finished, making no call", async () => {
    const out = io();
    const groq = recording();
    const ok = await juryAndReport(input(undefined, null), runnersOf(groq.run, recording().run), { ledger: memoryLedger() }, out.io);
    expect(ok).toBe(false);
    expect(groq.calls).toHaveLength(0);
    expect(out.written).toEqual({});
    expect(out.errors[0]).toMatch(/^the jury can't start: the owner's spot-check isn't finished/);
  });

  it("refuses to replace answers already in the plan unless told to", async () => {
    const answered: Ratings = { items: plan, answers: [{ itemId: reason.itemId, answer: "yes", at: "t" }] };
    const out = io();
    expect(await juryAndReport(input(answered), runnersOf(recording().run, recording().run), { ledger: memoryLedger() }, out.io)).toBe(false);
    expect(out.errors[0]).toMatch(/--force-replace/);
    const forced = io();
    expect(await juryAndReport(input(answered), runnersOf(recording().run, recording().run), { ledger: memoryLedger(), forceReplace: true }, forced.io)).toBe(true);
    expect(forced.written.ratings!.answers).toHaveLength(plan.length);
  });

  it("reports a missing runner as a refusal to start, not a halt", async () => {
    const out = io();
    const ok = await juryAndReport(input(), new Map([["groq", recording().run]]), { ledger: memoryLedger() }, out.io);
    expect(ok).toBe(false);
    expect(out.errors[0]).toMatch(/^the jury can't start: /);
    expect(out.errors[0]).not.toContain("cached");
  });
});

describe("parseJuryArgs", () => {
  it("reads --force-replace and --concurrency, and refuses anything else", () => {
    expect(parseJuryArgs([])).toEqual({ forceReplace: false, concurrency: undefined });
    expect(parseJuryArgs(["--force-replace", "--concurrency", "2"])).toEqual({ forceReplace: true, concurrency: 2 });
    expect(() => parseJuryArgs(["--concurrency", "0"])).toThrow(/--concurrency/);
    expect(() => parseJuryArgs(["--stage", "a"])).toThrow(/--stage/);
  });
});

describe("the pilot's README", () => {
  it("says a jury rated in place of a person, and links to the second amendment", () => {
    const readme = readFileSync("insights/pilot/README.md", "utf8");
    const howItRan = readme.slice(readme.indexOf("## How it ran"), readme.indexOf("## Results")).replace(/\s+/g, " ");
    expect(howItRan).toContain("A jury of 3 models from other families rated them in place of a person");
    expect(howItRan).toContain("(preregistration.md#amendment-26-september-2026-who-rates)");
    expect(howItRan).not.toContain("The owner then rated");
  });
});
