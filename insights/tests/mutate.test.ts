import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { mutations } from "../src/mutate.ts";
import { evaluate, type Check } from "../src/vocabulary.ts";

const data = loadData();
// a literal on the right, so there's a number to corrupt
const check: Check = { check: "compare", left: { of: { unit: "self" }, field: "education.higher", year: 2024 }, op: ">",
  right: { value: 20 } };

describe("planted errors", () => {
  it("makes each kind of corruption it claims to", () => {
    const kinds = new Set(mutations(check, data, 1).map((m) => m.kind));
    for (const k of ["unit", "year", "direction", "number", "field"]) expect(kinds.has(k as never)).toBe(true);
  });
  it("never returns the check unchanged", () => {
    for (const m of mutations(check, data, 1)) expect(JSON.stringify(m.check)).not.toBe(JSON.stringify(check));
  });

  it("gives no unit mutant when the subject isn't self", () => {
    const noSelf: Check = { ...check, left: { ...check.left, of: { unit: "country" } } };
    const kinds = new Set(mutations(noSelf, data, 1).map((m) => m.kind));
    expect(kinds.has("unit")).toBe(false);
  });

  it("gives no year mutant when the field isn't comparable", () => {
    const notComparable: Check = { ...check, left: { ...check.left, field: "housing.occupancy.vacant" } };
    const kinds = new Set(mutations(notComparable, data, 1).map((m) => m.kind));
    expect(kinds.has("year")).toBe(false);
  });

  it("gives no number mutant when the right side is a reference, not a literal", () => {
    const noLiteral: Check = { ...check, right: { of: { unit: "country" }, field: "education.higher", year: 2024 } };
    const kinds = new Set(mutations(noLiteral, data, 1).map((m) => m.kind));
    expect(kinds.has("number")).toBe(false);
  });

  it("gives a rank check a direction mutant that flips top and bottom, but no number mutant", () => {
    const rank: Check = { check: "rank", of: { unit: "self" }, field: "commute.privateCar", year: 2024, within: "province", position: "top", share: 0.1 };
    const kinds = new Set(mutations(rank, data, 1).map((m) => m.kind));
    expect(kinds.has("direction")).toBe(true);
    expect(kinds.has("number")).toBe(false);
    expect(kinds.has("unit")).toBe(true);
    expect(kinds.has("field")).toBe(true);

    const flipped = mutations(rank, data, 1).find((m) => m.kind === "direction")!;
    expect(flipped.check).toEqual({ ...rank, position: "bottom" });
  });

  it("makes a real passing rank check fail once its direction mutant flips it", () => {
    // The commune with the highest share of a field within its province: always the top
    // by any share, however narrow.
    const communes = data.byLevel.get("commune")!;
    const byProvince = new Map<string, { code: string; value: number }[]>();
    for (const c of communes) {
      const v = c.figures.y2024["commute.privateCar"];
      if (v == null || !Number.isFinite(v)) continue;
      byProvince.set(c.parent!, [...(byProvince.get(c.parent!) ?? []), { code: c.code, value: v }]);
    }
    const [, list] = [...byProvince].find(([, l]) => l.length >= 8)!;
    const top = list.reduce((a, b) => (b.value > a.value ? b : a));

    const rank: Check = { check: "rank", of: { unit: "self" }, field: "commute.privateCar", year: 2024, within: "province", position: "top", share: 0.1 };
    // measure differs from the check's field, or evaluate refuses it as a tautology
    const finding = { id: "f0", code: top.code, level: "commune" as const, measure: "education.higher", kind: "extreme" as const, value: 0, reference: 0, score: 0, direction: "high" as const };

    expect(evaluate(rank, finding, data).status).toBe("passed");
    const flipped = mutations(rank, data, 1).find((m) => m.kind === "direction")!;
    expect(evaluate(flipped.check, finding, data).status).not.toBe("passed");
  });

  it("gives no year mutant for a change check, which has none to swap", () => {
    const change: Check = { check: "change", of: { unit: "self" }, field: "education.higher", op: ">", value: 5 };
    const kinds = new Set(mutations(change, data, 1).map((m) => m.kind));
    expect(kinds.has("year")).toBe(false);
    expect(kinds.has("unit")).toBe(true);
    expect(kinds.has("direction")).toBe(true);
    expect(kinds.has("number")).toBe(true);
  });

  it("is the same for the same seed", () => {
    expect(mutations(check, data, 7)).toEqual(mutations(check, data, 7));
  });
});
