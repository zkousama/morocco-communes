import { describe, expect, it } from "vitest";
import { loadData } from "../src/data.ts";
import { CHANGE_GAP_POPULATION_FLOOR, detect, implausibleYears } from "../src/detect.ts";

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

describe("records that can't be right", () => {
  it("flags Gleibat El Foula's 2014 record for its 32 people per room", () => {
    const why = implausibleYears(data.units.get("12.391.05.03")!);
    expect(why.y2014).toMatch(/people per room/);
    expect(why.y2024).toBeNull();
  });
  it("flags Touizgui's 2024 record for its 15.4 people per room", () => {
    expect(implausibleYears(data.units.get("10.071.03.05")!).y2024).toMatch(/people per room/);
  });
  it("leaves unusual places alone: the palace communes and the earthquake zone", () => {
    for (const code of ["04.421.01.07", "06.141.01.81", "09.541.04.67"]) {
      expect(implausibleYears(data.units.get(code)!)).toEqual({ y2014: null, y2024: null });
    }
  });
  it("treats a housing shortfall over 100 as a ratio, not an error", () => {
    expect(implausibleYears(data.units.get("01.405.09.05")!).y2024).toBeNull(); // Brikcha
  });
  it("leaves the Talat N'yaaqoub earthquake-zone commune alone too", () => {
    expect(implausibleYears(data.units.get("07.041.07.13")!)).toEqual({ y2014: null, y2024: null });
  });
  it("turns a change resting on an implausible 2014 into a possible data error, and leaves that unit's 2024 extremes alone", () => {
    const all = detect(data, { cap: 100_000, perUnit: 100 });
    const gleibat = all.filter((f) => f.code === "12.391.05.03");
    expect(gleibat.some((f) => f.kind === "artefact" && f.measure === "households.peoplePerRoom")).toBe(true);
    expect(gleibat.some((f) => f.kind === "change")).toBe(false);
    expect(gleibat.some((f) => f.kind === "extreme")).toBe(true); // its 2024 record (4.9 per room) is plausible
  });
  it("turns every finding on an implausible 2024 into a possible data error", () => {
    const touizgui = detect(data, { cap: 100_000, perUnit: 100 }).filter((f) => f.code === "10.071.03.05");
    expect(touizgui.length).toBeGreaterThan(0);
    for (const f of touizgui) expect(f.kind).toBe("artefact");
  });
  it("never gives 2 findings the same id, even when an extreme and a change on one figure both become artefacts", () => {
    const all = detect(data, { cap: 100_000, perUnit: 100 });
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
    expect(all.filter((f) => f.code === "10.071.03.05" && f.measure === "households.peoplePerRoom")).toHaveLength(1);
  });
});

describe("the population floors", () => {
  it("gives no change or gap finding to a commune under 2,000 people", () => {
    for (const f of detect(data, { cap: 100_000, perUnit: 100 })) {
      if (f.level !== "commune" || (f.kind !== "change" && f.kind !== "gap")) continue;
      expect(data.units.get(f.code)!.population.y2024).toBeGreaterThanOrEqual(CHANGE_GAP_POPULATION_FLOOR);
    }
  });
});
