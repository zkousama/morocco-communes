import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { detect, EXTREME_POPULATION_FLOOR, EXTREME_TAIL_SHARE, type Finding } from "../src/detect.ts";
import { FIELDS } from "../src/fields.ts";
import { makeRunner, stubTransport, type ModelCall } from "../src/model.ts";
import { context, propose, semanticEntropy } from "../src/propose.ts";
import { breakdown, findingLine, subjectOf } from "../src/text.ts";
import { numbers, percent } from "../../site/src/lib/format.ts";

const data = loadData();
const finding: Finding = {
  id: "f1", code: "04.421.01.0", level: "commune", measure: "fertility.totalFertilityRate",
  kind: "extreme", value: 1.19, reference: 2, score: 4, direction: "low",
};
const good = JSON.stringify({ hypotheses: [{
  claim: { en: "Women here study longer and have children later", fr: "Les femmes étudient plus longtemps" },
  link: { en: "Longer study delays first births", fr: "De plus longues études retardent les naissances" },
  premise: { en: "More people here have higher education than across Morocco", fr: "Plus de diplômés du supérieur" },
  test: { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">",
          right: { of: { unit: "country" }, field: "education.higher", year: 2024 } },
  linkTest: null, artefact: false,
}] });
const runner = (answer: string) => makeRunner(stubTransport(() => answer),
  { cacheDir: mkdtempSync(join(tmpdir(), "p-")), datasetVersion: "t", stageVersions: { propose: "1" } });

describe("propose", () => {
  it("asks 5 times and merges the same test into one candidate", async () => {
    const p = await propose(finding, data, runner(good));
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]!.support).toBe(5);
    expect(p.entropy).toBe(0);
  });

  it("skips a finding the model answers badly, and says why", async () => {
    for (const answer of ["not json", JSON.stringify({ hypotheses: [{ claim: "x" }] }), JSON.stringify({ hypotheses: [] })]) {
      const p = await propose(finding, data, runner(answer));
      expect(p.candidates).toEqual([]);
      expect(p.skipped).toBeTruthy();
    }
  });

  it("skips a finding whose every call fails, without throwing", async () => {
    const failing = makeRunner(async () => { throw new Error("claude timed out after 240000 ms"); },
      { cacheDir: mkdtempSync(join(tmpdir(), "p-")), datasetVersion: "t", stageVersions: { propose: "1" } });
    const p = await propose(finding, data, failing);
    expect(p.candidates).toEqual([]);
    expect(p.skipped).toMatch(/timed out/);
  });

  it("keeps the good answers when only some samples fail", async () => {
    let n = 0;
    const flaky = makeRunner(stubTransport(() => (n++ % 2 === 0 ? good : "not json")),
      { cacheDir: mkdtempSync(join(tmpdir(), "p-")), datasetVersion: "t", stageVersions: { propose: "1" } });
    const p = await propose(finding, data, flaky);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]!.support).toBe(3);
    expect(p.skipped).toBeUndefined();
  });

  it("never caches a sample it can't read, so a re-run asks again", async () => {
    let calls = 0;
    const cacheDir = mkdtempSync(join(tmpdir(), "p-"));
    const counting = (answer: string) => makeRunner(stubTransport(() => { calls += 1; return answer; }),
      { cacheDir, datasetVersion: "t", stageVersions: { propose: "1" } });
    await propose(finding, data, counting("not json"));
    await propose(finding, data, counting("not json"));
    expect(calls).toBe(10);
    await propose(finding, data, counting(good));
    await propose(finding, data, counting(good));
    expect(calls).toBe(15);
  });

  it("keeps a hypothesis whose link test is the wrong shape, with no link test", async () => {
    const parsed = JSON.parse(good);
    parsed.hypotheses[0].linkTest = { link: "together", x: "education.higher" };
    const p = await propose(finding, data, runner(JSON.stringify(parsed)));
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]!.linkTest).toBeNull();
  });

  it("drops a candidate the safety check refuses", async () => {
    const bad = JSON.parse(good);
    bad.hypotheses[0].claim.en = "The ministry's neglect lowered fertility";
    const p = await propose(finding, data, runner(JSON.stringify(bad)));
    expect(p.candidates).toEqual([]);
  });

  it("asks each sample under its own key, one after another, and keeps who answered", async () => {
    const calls: ModelCall[] = [];
    const recording = makeRunner(stubTransport((call) => (calls.push(call), good)),
      { cacheDir: mkdtempSync(join(tmpdir(), "p-")), datasetVersion: "t", stageVersions: { propose: "1" } });
    const p = await propose(finding, data, recording);
    expect(calls.map((c) => c.key)).toEqual(["f1:0", "f1:1", "f1:2", "f1:3", "f1:4"]);
    expect(new Set(calls.map((c) => `${c.stage} ${c.model}`))).toEqual(new Set(["propose sonnet"]));
    expect(calls[0]!.prompt).toBe(context(finding, data));
    expect(p.replies).toHaveLength(5);
    expect(p.replies[0]!.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps one candidate per test however many a sample repeats it, most supported first", async () => {
    const parsed = JSON.parse(good);
    const other = { ...parsed.hypotheses[0], test: { check: "change", of: { unit: "self" }, field: "labour.activityRate", op: ">", value: 0 } };
    let n = 0;
    const mixed = makeRunner(
      stubTransport(() => JSON.stringify({ hypotheses: n++ === 0 ? [other, other] : [parsed.hypotheses[0], other] })),
      { cacheDir: mkdtempSync(join(tmpdir(), "p-")), datasetVersion: "t", stageVersions: { propose: "1" } },
    );
    const p = await propose(finding, data, mixed);
    expect(p.candidates.map((c) => [c.test.check, c.support])).toEqual([["change", 5], ["compare", 4]]);
  });
});

describe("semantic entropy", () => {
  it("is 0 when every sample agrees and grows when they scatter", () => {
    expect(semanticEntropy([["a"], ["a"], ["a"]])).toBe(0);
    expect(semanticEntropy([["a"], ["b"], ["c"]])).toBeGreaterThan(semanticEntropy([["a"], ["a"], ["b"]]));
  });

  it("is the natural-log entropy of the clusters", () => {
    expect(semanticEntropy([["a"], ["b"]])).toBeCloseTo(Math.log(2), 10);
    expect(semanticEntropy([])).toBe(0);
  });
});

describe("the figures the proposer sees", () => {
  const sent = JSON.parse(context(finding, data));

  it("names the unit and the fields its tests can't use", () => {
    expect(sent.unit).toMatchObject({ name: "Rabat", level: "commune", code: "04.421.01.0" });
    expect(sent.offLimits).toEqual(["fertility.totalFertilityRate"]);
    expect(sent.finding).toBe(findingLine(finding, data).en);
  });

  it("gives each field as self, self in 2014, parent, neighbours and country", () => {
    const [self, self2014, parent, , country] = sent.figures["education.higher"];
    expect([self, parent, country]).toEqual([26.9, data.units.get("04.421")!.figures.y2024["education.higher"], 10.2]);
    expect(self2014).toBeNull(); // Rabat has no 2014 record of its own
  });

  it("leaves out a field with no figure anywhere, and stays short", () => {
    for (const row of Object.values(sent.figures) as (number | null)[][]) expect(row.some((v) => v !== null)).toBe(true);
    expect(context(finding, data).length).toBeLessThan(12_000);
  });
});

describe("the finding's line", () => {
  const all = detect(data, { cap: 100_000, perUnit: 100 });
  const pick = (code: string, measure: string) => all.find((f) => f.code === code && f.measure === measure)!;

  it("says where an extreme sits", () => {
    const line = findingLine(finding, data);
    expect(line.en).toBe("Fertility is 1.19 children per woman, among the lowest 1% of communes of 5,000 people or more.");
    // French groups digits and sets off % with a narrow no-break space, as the site does.
    expect(line.fr).toBe("La fécondité est de 1,19 enfant par femme, parmi les 1 % les plus bas des communes de 5 000 habitants ou plus.");
  });

  it("takes an extreme's tail and population floor from detect's own settings", () => {
    const line = findingLine(finding, data);
    expect(line.en).toContain(`lowest ${percent("en", EXTREME_TAIL_SHARE * 100, { digits: 0 })} of communes of ${numbers("en").format(EXTREME_POPULATION_FLOOR)} people`);
    expect(line.fr).toContain(`les ${percent("fr", EXTREME_TAIL_SHARE * 100, { digits: 0 })} les plus bas des communes de ${numbers("fr").format(EXTREME_POPULATION_FLOOR)} habitants`);
  });

  it("says a lone swing on a slow measure may be an error in the data", () => {
    const line = findingLine(pick("02.411.05.11", "localLanguages.tarifit"), data);
    expect(line.en).toBe(
      "The share of people who speak Tarifit went from 92.6% in 2014 to 23.2% in 2024, a swing no neighbouring commune shares, which may be an error in the data.",
    );
    expect(line.fr).toContain("passe de 92,6 % en 2014 à 23,2 % en 2024");
  });

  it("gives a change's direction against the level's own", () => {
    const change = all.find((f) => f.kind === "change" && f.level === "commune" && f.measure === "commute.train")!;
    const line = findingLine(change, data);
    expect(line.en).toMatch(/^The share of workers who get to work by train went from .+ in 2014 to .+ in 2024, a far (bigger|smaller) (rise|fall) than in other communes\.$/);
    expect(line.fr).toMatch(/^La part des actifs occupés qui vont au travail en train passe de .+ en 2014 à .+ en 2024, une (hausse|baisse) bien plus (forte|faible) que dans les autres communes\.$/);
  });

  it("sets a gap against its parent", () => {
    const gap = pick("09.541.03.11", "economy.perBusiness.jobs");
    const line = findingLine(gap, data);
    expect(line.en).toBe("The number of permanent jobs per business is 78.0, against 1.9 across its province.");
    expect(line.fr).toBe("Le nombre d’emplois permanents par entreprise est de 78,0, contre 1,9 dans sa province.");
  });

  it("has a phrase for every field, and never prints a missing number", () => {
    for (const f of FIELDS) expect(subjectOf(f.path), f.path).not.toBeNull();
    for (const f of all) {
      const line = findingLine(f, data);
      expect(`${line.en} ${line.fr}`).not.toMatch(/NaN|undefined|null/);
    }
  });
});

describe("the breakdown", () => {
  it("lists what an empty-homes figure is made of", () => {
    const empty: Finding = { ...finding, measure: "housing.occupancy.unoccupied", value: 30, reference: 10 };
    const unit = data.units.get(empty.code)!;
    expect(breakdown(empty, data)).toEqual([
      { field: "housing.occupancy.vacant", label: { en: "Vacant", fr: "Logement vacant" }, value: unit.figures.y2024["housing.occupancy.vacant"] },
      { field: "housing.occupancy.seasonal", label: { en: "Second or seasonal home", fr: "Logement secondaire ou saisonnier" }, value: unit.figures.y2024["housing.occupancy.seasonal"] },
    ]);
  });

  it("is null for a measure with no parts", () => {
    expect(breakdown(finding, data)).toBeNull();
  });
});
