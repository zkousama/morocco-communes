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

  it("keeps a rank's share to 2 decimals in its signature, apart from every other number", () => {
    const base = { check: "rank", of: { unit: "self" }, field: "labour.unemploymentRate", year: 2024, within: "country", position: "top" } as const;
    const fivePercent: Check = { ...base, share: 0.05 };
    const tenPercent: Check = { ...base, share: 0.1 };
    const almostFivePercent: Check = { ...base, share: 0.051 };
    expect(signature(fivePercent)).not.toBe(signature(tenPercent));
    expect(signature(fivePercent)).toBe(signature(almostFivePercent));
  });

  it("ranks a real unit within its province and keeps its numbers", () => {
    // Rabat prefecture (04.421) holds only 2 communes: Rabat itself (26.9% higher
    // education) and Touarga (17.8%), so Rabat ranks 1st of 2.
    const check: Check = {
      check: "rank", of: { unit: "self" }, field: "education.higher", year: 2024,
      within: "province", position: "top", share: 0.5,
    };
    const outcome = evaluate(check, rabatFertility, data);
    expect(outcome.status).toBe("passed");
    expect(outcome.numbers).toEqual({ value: 26.9, rank: 1, of: 2 });
  });

  it("fails a rank outside the requested share", () => {
    // Touarga (04.421.01.07), Rabat prefecture's other commune, has the lower
    // higher-education share (17.8% against Rabat's 26.9%), so it ranks 2nd of 2 and
    // misses the top 5%.
    const touarga: Finding = { ...rabatFertility, code: "04.421.01.07" };
    const check: Check = {
      check: "rank", of: { unit: "self" }, field: "education.higher", year: 2024,
      within: "province", position: "top", share: 0.05,
    };
    const outcome = evaluate(check, touarga, data);
    expect(outcome.status).toBe("failed");
    expect(outcome.numbers).toEqual({ value: 17.8, rank: 2, of: 2 });
  });

  it("puts rank 1 on the highest value, not the lowest", () => {
    // Same 2 communes, same field: Rabat's 26.9% outranks Touarga's 17.8%.
    const touarga: Finding = { ...rabatFertility, code: "04.421.01.07" };
    const check: Check = {
      check: "rank", of: { unit: "self" }, field: "education.higher", year: 2024,
      within: "province", position: "top", share: 0.5,
    };
    expect(evaluate(check, rabatFertility, data).numbers.rank).toBe(1);
    expect(evaluate(check, touarga, data).numbers.rank).toBe(2);
  });

  it("refuses a within area the subject doesn't sit inside", () => {
    // A province sits inside a région, not inside another province, so ranking one
    // "within province" has no area to rank it in.
    const rabatProvince: Finding = { ...rabatFertility, code: "04.421", level: "province" };
    const check: Check = {
      check: "rank", of: { unit: "self" }, field: "labour.unemploymentRate", year: 2024,
      within: "province", position: "top", share: 0.05,
    };
    expect(evaluate(check, rabatProvince, data).status).toBe("refused");
  });

  it("refuses a neighbours or country subject", () => {
    const neighbours: Check = {
      check: "rank", of: { unit: "neighbours", stat: "median" }, field: "labour.unemploymentRate", year: 2024,
      within: "country", position: "top", share: 0.05,
    };
    const country: Check = {
      check: "rank", of: { unit: "country" }, field: "labour.unemploymentRate", year: 2024,
      within: "country", position: "top", share: 0.05,
    };
    expect(evaluate(neighbours, rabatFertility, data).status).toBe("refused");
    expect(evaluate(country, rabatFertility, data).status).toBe("refused");
  });
});
