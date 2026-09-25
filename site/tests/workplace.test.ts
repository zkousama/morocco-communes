import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILITY_FIELDS_2014, type MobilityField } from "../../pipeline/src/sources/mobilityFields.ts";
import { places } from "../src/i18n/places.ts";

/** Where the 2014 workbook says people work, from the field list HCP publishes them in. */
const workplacesOf = (fields: MobilityField[]) => fields.filter((f) => f.topic === "workplace").map((f) => f.key);

const source = readFileSync("site/src/components/places/People.astro", "utf8");
const drawn = [...(/const WORKPLACES = \[([^\]]*)\]/s.exec(source)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]!);

describe("the workplace list the census chart draws", () => {
  it("draws every answer the 2014 workbook has", () => {
    expect(new Set(drawn)).toEqual(new Set(workplacesOf(MOBILITY_FIELDS_2014)));
  });

  it("has a name for each drawn answer, in both languages", () => {
    for (const key of drawn) {
      expect((places.en.workplaceNames as Record<string, string>)[key], key).toBeDefined();
      expect((places.fr.workplaceNames as Record<string, string>)[key], key).toBeDefined();
    }
  });
});
