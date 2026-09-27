import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mismatches } from "../../src/lib/mismatch.ts";
import type { IndicatorRecord, Topics } from "../../src/lib/indicators.ts";

/** A census's people block with a population and local language shares. */
const census = (population: number, languages: Record<string, number>): Topics => ({
  population: { legal: population },
  localLanguages: languages,
});

describe("where the two censuses don't line up", () => {
  it("flags a language share that moved more than 30 points while the population barely changed", () => {
    const then = census(7660, { darija: 88.9, tarifit: 91.2, tamazight: 0.2 });
    const now = census(6498, { darija: 84, tarifit: 0.1, tamazight: 15.8 });
    expect(mismatches(now, then)).toEqual([{ path: "localLanguages.tarifit", then: 91.2, now: 0.1 }]);
  });

  it("leaves a big move alone where the population grew even more, since newcomers can explain it", () => {
    const then = census(4207, { darija: 45.6 });
    const now = census(19139, { darija: 93.3 });
    expect(mismatches(now, then)).toEqual([]);
  });

  it("flags a move larger than the population change, even when the population grew", () => {
    const then = census(10000, { tamazight: 95, tachelhit: 0.6 });
    const now = census(13781, { tamazight: 42.7, tachelhit: 53.1 });
    expect(mismatches(now, then).map((m) => m.path)).toEqual(["localLanguages.tachelhit", "localLanguages.tamazight"]);
  });

  it("leaves ordinary changes alone", () => {
    expect(mismatches(census(5000, { darija: 60, tachelhit: 45 }), census(5200, { darija: 52, tachelhit: 55 }))).toEqual([]);
  });

  it("says nothing without both censuses or a population to compare", () => {
    expect(mismatches(census(5000, { tarifit: 0 }), null)).toEqual([]);
    expect(mismatches({ localLanguages: { tarifit: 0 } }, { localLanguages: { tarifit: 90 } })).toEqual([]);
  });
});

describe("the published figures", () => {
  const load = (dir: string) =>
    new Map(
      readdirSync(new URL(`../../../data/v1/indicators/${dir}/`, import.meta.url))
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => JSON.parse(readFileSync(new URL(`../../../data/v1/indicators/${dir}/${f}`, import.meta.url), "utf8")) as IndicatorRecord[])
        .map((r) => [r.code!, r.people.total?.all ?? null]),
    );
  const now = load("communes");
  const then = load("2014/communes");
  const of = (code: string) => mismatches(now.get(code), then.get(code)).map((m) => m.path);

  it("flag Bni Bounsar's Tarifit and Et-Taous's Tamazight and Tachelhit, and not Al Mahbass's Darija", () => {
    const code = (name: string) => {
      const communes = JSON.parse(readFileSync(new URL("../../../data/v1/attributes/communes.json", import.meta.url), "utf8")) as {
        code: string;
        name: { fr: string };
      }[];
      return communes.find((c) => c.name.fr === name)!.code;
    };
    expect(of(code("Bni Bounsar"))).toEqual(["localLanguages.tarifit"]);
    expect(of(code("Et-Taous"))).toEqual(["localLanguages.tachelhit", "localLanguages.tamazight"]);
    expect(of(code("Al Mahbass"))).toEqual([]);
  });
});
