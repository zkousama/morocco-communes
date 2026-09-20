import { describe, expect, it } from "vitest";
import {
  definitionsByTerm,
  parseCensusDefinitions,
  parseHousingDefinitions,
  termFor,
  termKey,
} from "../../src/sources/hcpDefinitions.ts";
import { HCP_CONCEPT as CENSUS_CONCEPT, HOUSEHOLD_FIELDS, PEOPLE_FIELDS } from "../../src/sources/indicatorFields.ts";
import { HCP_CONCEPT as HOUSING_CONCEPT, HOUSING_FIELDS } from "../../src/sources/housingFields.ts";
import { readCachedWorkbook } from "../support/workbooks.ts";

const census = parseCensusDefinitions(readCachedWorkbook(".cache/hcp-indicateurs-2024.xlsx"));
const housing = parseHousingDefinitions(readCachedWorkbook(".cache/hcp-logement-urbain-2024.xlsx"));

describe("HCP's definitions of the census concepts", () => {
  it("reads all 52 of them", () => {
    expect(census).toHaveLength(52);
    expect(census[0]!.term).toBe("Recensement Général de la Population et de l'Habitat (RGPH)");
  });

  it("gives each one a term and its wording, and no leftover colon", () => {
    for (const d of census) {
      expect(d.term.length, d.term).toBeGreaterThan(2);
      expect(d.term.endsWith(":"), d.term).toBe(false);
      expect(d.body.length, d.term).toBeGreaterThan(20);
    }
  });

  it("defines the census date as the 1st of September 2024", () => {
    const index = definitionsByTerm(census);
    expect(index.get(termKey("Date de référence du Recensement"))!.body).toContain("1er septembre 2024");
  });
});

describe("HCP's definitions of the dwelling types", () => {
  it("reads the 15 of them, the headings and the types under them", () => {
    expect(housing.map((d) => d.term)).toEqual([
      "Le logement",
      "Villa",
      "Appartement dans un immeuble",
      "Maison marocaine traditionnelle",
      "Maison marocaine moderne",
      "Construction sommaire ou bidonville",
      "Chambre dans un établissement",
      "Local non destiné à l’habitation",
      "Logement rural",
      "Autres types à préciser",
      "Logement occupé",
      "Logement vacant",
      "Logement secondaire ou saisonnier",
      "Taux de déficit quantitatif en logements",
      "Déficit quantitatif total en logements",
    ]);
  });

  it("keeps both paragraphs of what a dwelling is", () => {
    const dwelling = housing[0]!.body;
    expect(dwelling).toContain("une ou plusieurs pièces destinées à l’habitation");
    expect(dwelling).toContain("garage transformé en habitation");
  });

  it("says the shortfall is over the sound dwellings, not the households", () => {
    const index = definitionsByTerm(housing);
    expect(index.get(termKey("Taux de déficit quantitatif en logements"))!.body).toContain(
      "logements salubres occupés et vacants",
    );
  });
});

describe("the concept each column is defined under", () => {
  const censusIndex = definitionsByTerm(census);
  const housingIndex = definitionsByTerm(housing);
  const censusFields = [...PEOPLE_FIELDS, ...HOUSEHOLD_FIELDS];

  it("finds one for over half the census columns", () => {
    const found = censusFields.map((f) => termFor(censusIndex, CENSUS_CONCEPT, f)).filter(Boolean);
    expect(found.length).toBeGreaterThan(censusFields.length / 2);
  });

  it("takes a column at its own heading where HCP heads it with the concept", () => {
    const rate = censusFields.find((f) => `${f.topic}.${f.key}` === "labour.unemploymentRate")!;
    expect(termFor(censusIndex, CENSUS_CONCEPT, rate)).toBe("Taux de chômage");
  });

  it("names the concept where the heading isn't it", () => {
    const electricity = censusFields.find((f) => `${f.topic}.${f.key}` === "amenities.electricity")!;
    expect(termFor(censusIndex, CENSUS_CONCEPT, electricity)).toBe(
      "Part des ménages sédentaires disposant de l'électricité",
    );
    const modern = HOUSING_FIELDS.find((f) => `${f.topic}.${f.key}` === "type.modern")!;
    expect(termFor(housingIndex, HOUSING_CONCEPT, modern)).toBe("Maison marocaine moderne");
    // The age bands of a type carry the type's definition.
    const old = HOUSING_FIELDS.find((f) => `${f.topic}.${f.key}` === "ageByType.modern50Plus")!;
    expect(termFor(housingIndex, HOUSING_CONCEPT, old)).toBe("Maison marocaine moderne");
  });

  it("leaves a total HCP works out itself undefined", () => {
    const sound = HOUSING_FIELDS.find((f) => `${f.topic}.${f.key}` === "type.sound")!;
    expect(termFor(housingIndex, HOUSING_CONCEPT, sound)).toBe(null);
  });

  it("refuses a concept HCP doesn't define", () => {
    const field = { topic: "made", key: "up", heading: "Nothing" };
    expect(() => termFor(censusIndex, { "made.up": "Un concept inventé" }, field)).toThrow(/doesn't define/);
  });

  it("names only concepts the workbooks define", () => {
    for (const [path, term] of Object.entries(CENSUS_CONCEPT)) {
      expect(censusIndex.has(termKey(term)), `${path} → ${term}`).toBe(true);
    }
    for (const [path, term] of Object.entries(HOUSING_CONCEPT)) {
      expect(housingIndex.has(termKey(term)), `${path} → ${term}`).toBe(true);
    }
  });
});
