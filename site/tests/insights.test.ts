import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceNumbers, readMetrics, readUnitInsights } from "../src/lib/insights.ts";

describe("insights on the site", () => {
  it("reads nothing, without failing, when none are published", () => {
    expect(readUnitInsights(join(mkdtempSync(join(tmpdir(), "none-")), "insights")).size).toBe(0);
  });

  it("finds a place's insights by its code, and nothing for a place without", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ins-")), "insights");
    mkdirSync(join(dir, "communes"), { recursive: true });
    writeFileSync(join(dir, "communes", "04.421.01.0.json"), JSON.stringify({ code: "04.421.01.0", level: "commune", checkedAt: "2026-09-24", findings: [] }));
    const read = readUnitInsights(dir);
    expect(read.get("04.421.01.0")?.checkedAt).toBe("2026-09-24");
    expect(read.get("09.581.01.07")).toBeUndefined();
  });

  it("has no grading numbers before the first grading", () => {
    expect(readMetrics(join(mkdtempSync(join(tmpdir(), "none-")), "metrics.json"))).toBeNull();
  });
});

describe("the numbers beside a checked premise", () => {
  const self = { unit: "self" } as const;

  it("writes a comparison's 2 figures in the unit of the field it read", () => {
    const check = {
      check: "compare",
      left: { of: self, field: "housing.occupancy.vacant", year: 2024 },
      op: ">",
      right: { of: { unit: "parent" }, field: "housing.occupancy.vacant", year: 2024 },
    } as const;
    expect(evidenceNumbers("en", check, { left: 12.34, right: 8 })).toBe("12.3% against 8.0%");
    expect(evidenceNumbers("en", { ...check, left: { ...check.left, field: "fertility.totalFertilityRate" }, right: { value: 2 } }, { left: 1.6, right: 2 })).toBe(
      "1.60 against 2.00",
    );
  });

  it("writes a change as its 2 years, and a rank as a place among so many", () => {
    expect(evidenceNumbers("en", { check: "change", of: self, field: "education.higher", op: ">", value: 5 }, { y2014: 4.2, y2024: 11, change: 6.8 })).toBe(
      "4.2% in 2014, 11.0% in 2024",
    );
    expect(
      evidenceNumbers(
        "en",
        { check: "rank", of: self, field: "education.higher", year: 2024, within: "province", position: "top", share: 0.1 },
        { value: 11, rank: 2, of: 40 },
      ),
    ).toBe("11.0%, ranked 2 of 40");
  });
});
