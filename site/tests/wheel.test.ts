import { describe, expect, it } from "vitest";
import { places } from "../src/i18n/places.ts";
import { communes } from "../src/lib/places.ts";
import {
  WHEEL_PLOT,
  WHEEL_HEIGHT,
  WHEEL_WIDTH,
  WHEEL_SPOKES,
  labelBoxes,
  percentileRank,
  wheelOf,
  wheelSvg,
} from "../src/lib/wheel.ts";

describe("percentile rank", () => {
  it("puts the lowest at 0 and the highest at 100, and shares a tie", () => {
    expect(percentileRank(10, [10, 20, 30])).toBe(0);
    expect(percentileRank(20, [10, 20, 30])).toBe(50);
    expect(percentileRank(30, [10, 20, 30])).toBe(100);
    expect(percentileRank(10, [10, 10, 30])).toBe(25);
    expect(percentileRank(5, [5])).toBe(50);
  });
});

describe("the wheel", () => {
  const here = [10, 20, 30, 40, 50, 60, 70, 80];
  const twin = [80, 70, 60, 50, 40, 30, 20, 10];
  const labels = places.en.wheelLabels;
  const svg = wheelSvg(labels, here, twin, places.en.wheelNote);

  it("keeps the 8 spokes in a fixed order", () => {
    expect(WHEEL_SPOKES).toEqual([
      "literacy",
      "education.higher",
      "employment",
      "amenities.runningWater",
      "dwellingType.apartment",
      "households.averageSize",
      "age.0-14",
      "age.65+",
    ]);
    expect(labels).toHaveLength(8);
    expect(places.fr.wheelLabels).toHaveLength(8);
  });

  it("draws the commune, the twin and Morocco's middle, and names every spoke", () => {
    const polygons = svg.match(/<polygon /g) ?? [];
    expect(polygons).toHaveLength(3);
    expect(svg).toContain('stroke="var(--chart-up)"');
    expect(svg).toContain('stroke="var(--chart-down)"');
    expect(svg).toContain('stroke="var(--quiet)"');
    expect(svg).toMatch(/stroke="var\(--chart-down\)"[^>]*stroke-dasharray=/);
    expect(svg).toMatch(/stroke="var\(--quiet\)"[^>]*stroke-dasharray=/);
    expect(svg).not.toMatch(/stroke="var\(--chart-up\)"[^>]*stroke-dasharray=/);
    const texts = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(texts).toEqual(labels.map((lines) => lines.join("")));
    expect(svg).toContain('role="img"');
    expect(svg).toContain(`aria-label="${places.en.wheelNote}"`);
  });

  it("keeps every label inside the chart and clear of the polygon, in both languages", () => {
    for (const lines of [places.en.wheelLabels, places.fr.wheelLabels]) {
      const boxes = labelBoxes(lines);
      expect(boxes).toHaveLength(8);
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(WHEEL_WIDTH);
        expect(box.bottom).toBeLessThanOrEqual(WHEEL_HEIGHT);
        const cx = WHEEL_WIDTH / 2;
        const cy = WHEEL_HEIGHT / 2;
        const dx = cx < box.left ? box.left - cx : cx > box.right ? cx - box.right : 0;
        const dy = cy < box.top ? box.top - cy : cy > box.bottom ? cy - box.bottom : 0;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(WHEEL_PLOT);
      }
    }
  });
});

describe("a commune's wheel", () => {
  it("is hidden when the commune has no twin", () => {
    const small = communes.find((c) => c.population["2024"].total < 5000);
    expect(small).toBeTruthy();
    expect(wheelOf(small!.code)).toBeNull();
  });

  it("ranks Agadir and Kénitra on all 8 spokes", () => {
    for (const code of ["09.001.01.01", "04.281.01.01"]) {
      const wheel = wheelOf(code);
      expect(wheel).not.toBeNull();
      expect(wheel!.ranks.here).toHaveLength(8);
      expect(wheel!.ranks.twin).toHaveLength(8);
      expect(wheel!.values.here).toHaveLength(8);
      expect(wheel!.values.twin).toHaveLength(8);
      for (const rank of [...wheel!.ranks.here, ...wheel!.ranks.twin]) {
        expect(rank).toBeGreaterThanOrEqual(0);
        expect(rank).toBeLessThanOrEqual(100);
      }
    }
  });
});
