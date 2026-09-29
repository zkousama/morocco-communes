import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAPER, RAMPS, deltaE, protanopia, rampReadable } from "../src/lib/ramps.ts";

const theme = readFileSync(new URL("../src/layouts/Base.astro", import.meta.url), "utf8");
const map = readFileSync(new URL("../src/components/Map.astro", import.meta.url), "utf8");

describe("the map ramps", () => {
  it("keeps each step readable on the page, and neighbours apart", () => {
    for (const themeName of ["light", "dark"] as const) {
      for (const name of ["water", "elder", "unemp"] as const) {
        expect(rampReadable(RAMPS[themeName][name], PAPER[themeName]), `${themeName} ${name}`).toBe(true);
      }
    }
  });

  it("writes the same colours into the theme", () => {
    for (const themeName of ["light", "dark"] as const) {
      for (const name of ["water", "elder", "unemp"] as const) {
        RAMPS[themeName][name].forEach((hex, i) => {
          expect(theme).toContain(`--${name}-${i}: ${hex};`);
        });
      }
    }
  });

  it("keeps blue and orange apart for a protanope, and never shows purple with blue", () => {
    const blue = RAMPS.light.water[3]!;
    const orange = RAMPS.light.unemp[3]!;
    const purple = RAMPS.light.elder[3]!;
    expect(deltaE(protanopia(blue), protanopia(orange))).toBeGreaterThan(0.08);
    expect(deltaE(protanopia(purple), protanopia(blue))).toBeLessThan(deltaE(protanopia(blue), protanopia(orange)));
    expect(map).toContain('data-view="water"');
    expect(map).toContain("var(--water-0)");
    expect(map).toContain("var(--elder-0)");
    expect(map).toContain("var(--unemp-0)");
    expect(map).toContain("var(--seq-0)");
    const rule = (view: string) => map.split(`.atlas[data-view="${view}"]`)[1]?.split(".atlas[data-view")[0] ?? "";
    expect(rule("water")).not.toContain("--elder");
    expect(rule("elderly")).not.toContain("--water");
    expect(rule("unemployment")).not.toContain("--water");
    expect(rule("women")).toContain("--seq-");
    expect(rule("women")).not.toContain("--water");
  });
});
