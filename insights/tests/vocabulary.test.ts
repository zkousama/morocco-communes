import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import type { Finding } from "../src/detect.ts";
import { evaluate, signature, type Check } from "../src/vocabulary.ts";

const data = loadData();
const rabatFertility: Finding = {
  id: "t", code: "04.421.01.0", level: "commune", measure: "fertility.totalFertilityRate",
  kind: "extreme", value: 1.19, reference: 2, score: 4, direction: "low",
};

describe("evaluate", () => {
  it("passes a true comparison and keeps its numbers", () => {
    const check: Check = {
      check: "compare",
      left: { of: { unit: "self" }, field: "education.higher", year: 2024 },
      op: ">",
      right: { of: { unit: "country" }, field: "education.higher", year: 2024 },
    };
    const outcome = evaluate(check, rabatFertility, data);
    expect(outcome.status).toBe("passed");
    expect(outcome.numbers).toEqual({ left: 26.9, right: 10.2 });
  });

  it("fails a false one", () => {
    const check: Check = {
      check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 },
      op: "<", right: { value: 1 },
    };
    expect(evaluate(check, rabatFertility, data).status).toBe("failed");
  });

  it("measures a change in points between the censuses", () => {
    // Moulay Aissa Ben Driss: running water 74.7% in 2014, 95.7% in 2024
    const unemployment: Finding = { ...rabatFertility, code: "05.081.05.11", measure: "labour.unemploymentRate", kind: "change", direction: "high" };
    const check: Check = { check: "change", of: { unit: "self" }, field: "amenities.runningWater", op: ">", value: 20 };
    const outcome = evaluate(check, unemployment, data);
    expect(outcome.status).toBe("passed");
    expect(outcome.numbers.y2014).toBe(74.7);
    expect(outcome.numbers.y2024).toBe(95.7);
  });

  it("refuses a field that doesn't exist, a unit that doesn't exist, and a year that wasn't asked", () => {
    const noField: Check = { check: "change", of: { unit: "self" }, field: "nothing.here", op: ">", value: 0 };
    const noUnit: Check = { check: "change", of: { unit: "code", code: "99.999.99.9" }, field: "labour.unemploymentRate", op: ">", value: 0 };
    const noYear: Check = {
      check: "compare", left: { of: { unit: "self" }, field: "maritalStatus.married", year: 2014 },
      op: ">", right: { value: 0 },
    };
    for (const check of [noField, noUnit, noYear]) expect(evaluate(check, rabatFertility, data).status).toBe("refused");
  });

  it("refuses a test on the finding's own measure or its family", () => {
    const own: Check = { check: "rank", of: { unit: "self" }, field: "fertility.totalFertilityRate", year: 2024, within: "country", position: "bottom", share: 0.05 };
    expect(evaluate(own, rabatFertility, data).status).toBe("refused");
    const empty: Finding = { ...rabatFertility, code: "01.511.01.0", measure: "housing.occupancy.unoccupied", direction: "high" }; // Tanger
    const part: Check = { check: "compare", left: { of: { unit: "self" }, field: "housing.occupancy.seasonal", year: 2024 }, op: ">", right: { value: 20 } };
    expect(evaluate(part, empty, data).status).toBe("refused");
  });

  it("fails a test on a missing figure, even one any number would pass", () => {
    // Rabat has no 2014 record, so its 2014 figures are null
    const missing: Check = {
      check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2014 },
      op: "<", right: { value: 1000 },
    };
    const outcome = evaluate(missing, rabatFertility, data);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toBe("missing");
  });

  it("gives the same signature to the same test written twice", () => {
    const a: Check = { check: "change", of: { unit: "self" }, field: "labour.unemploymentRate", op: ">", value: 5.04 };
    const b: Check = { value: 5.0, op: ">", field: "labour.unemploymentRate", of: { unit: "self" }, check: "change" };
    expect(signature(a)).toBe(signature(b));
  });
});
