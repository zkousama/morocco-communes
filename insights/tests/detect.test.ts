import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";

const data = loadData();
const findings = detect(data);

describe("detect", () => {
  it("caps the list and each unit's share of it", () => {
    expect(findings.length).toBeLessThanOrEqual(300);
    const perUnit = new Map<string, number>();
    for (const f of findings) perUnit.set(f.code, (perUnit.get(f.code) ?? 0) + 1);
    expect(Math.max(...perUnit.values())).toBeLessThanOrEqual(3);
  });

  it("gives each finding a stable id", () => {
    expect(detect(data).map((f) => f.id)).toEqual(findings.map((f) => f.id));
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
  });

  it("keeps small communes out of the extremes", () => {
    for (const f of findings.filter((f) => f.kind === "extreme" && f.level === "commune")) {
      expect(data.units.get(f.code)!.population.y2024).toBeGreaterThanOrEqual(5000);
    }
  });

  it("gives a crosswalk-matched commune no change finding", () => {
    const crosswalked = findings.filter((f) => f.kind === "change" && data.units.get(f.code)!.basis === "crosswalk");
    expect(crosswalked).toEqual([]);
  });

  it("leaves a slow measure's swing as a change when a neighbour swings the same way", () => {
    // Moulay Aissa Ben Driss's Tamazight fell 69.8 points; its neighbour Tabia
    // (05.081.05.15) fell 43.7 points on the same measure, the same relabelling toward
    // Tachelhit spreading across Azilal, not a one-commune artefact.
    const tamazight = findings.find((f) => f.code === "05.081.05.11" && f.measure === "localLanguages.tamazight");
    expect(tamazight?.kind).toBe("change");
  });

  it("turns a slow measure's lone swing into an artefact, not a change", () => {
    const all = detect(data, { cap: 100_000, perUnit: 100 });
    // Mestferki's Tarifit fell from 92.6 to 23.2 (-69.4 points) while its population held
    // steady (-1%); every neighbour held close to where it was, the biggest move being
    // Sidi Boulenouar's -9.9 points, nowhere near half of Mestferki's own swing.
    const mestferki = all.find((f) => f.code === "02.411.05.11" && f.measure === "localLanguages.tarifit");
    expect(mestferki?.kind).toBe("artefact");
  });

  it("never produces a finding from a missing figure", () => {
    for (const f of detect(data, { cap: 100_000, perUnit: 100 })) {
      expect(Number.isFinite(f.value)).toBe(true);
      expect(Number.isFinite(f.score)).toBe(true);
    }
  });
});
