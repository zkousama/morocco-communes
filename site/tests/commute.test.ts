import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMUTE_FIELDS_2024, MOBILITY_FIELDS_2014, type MobilityField } from "../../pipeline/src/sources/mobilityFields.ts";
import { places } from "../src/i18n/places.ts";

/** A census's commute modes, from the field list HCP publishes them in. */
const modesOf = (fields: MobilityField[]) => fields.filter((f) => f.topic === "commute" && f.key !== "employed").map((f) => f.key);

const source = readFileSync("site/src/components/places/People.astro", "utf8");
const drawn = [...(/const MODES = \[([^\]]*)\]/s.exec(source)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]!);

describe("the commute modes the census chart draws", () => {
  it("draws every mode either census asks about", () => {
    const wanted = new Set([...modesOf(COMMUTE_FIELDS_2024), ...modesOf(MOBILITY_FIELDS_2014)]);
    expect(new Set(drawn)).toEqual(wanted);
  });

  it("has a name for each drawn mode, in both languages", () => {
    for (const key of drawn) {
      expect((places.en.commuteNames as Record<string, string>)[key], key).toBeDefined();
      expect((places.fr.commuteNames as Record<string, string>)[key], key).toBeDefined();
    }
  });
});
