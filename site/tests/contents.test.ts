import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentsOf } from "../src/lib/contents.ts";
import { places } from "../src/i18n/places.ts";

const everything = { change: true, people: true, dwellings: true, work: true, urbanCentres: true, arrondissements: true };

describe("a commune page's section links", () => {
  it("link every section the page has, in its order, by the section's own heading", () => {
    expect(contentsOf("en", everything)).toEqual([
      { id: "where", label: "Where it is" },
      { id: "change", label: "How it changed" },
      { id: "people", label: "People and homes" },
      { id: "dwellings", label: "Urban dwellings" },
      { id: "work", label: "Business and jobs" },
      { id: "urban-centres", label: "Urban centres" },
      { id: "arrondissements", label: "Arrondissements" },
      { id: "data", label: "In the data" },
    ]);
  });

  it("use the French headings on a French page", () => {
    expect(contentsOf("fr", everything).map((s) => s.label)).toEqual([
      places.fr.where,
      places.fr.howItChanged,
      places.fr.people,
      places.fr.dwellingsTitle,
      places.fr.work,
      places.fr.urbanCentres,
      places.fr.arrondissements,
      places.fr.inTheData,
    ]);
  });

  it("skip a section the page doesn't have", () => {
    const rural = { change: true, people: true, dwellings: false, work: true, urbanCentres: false, arrondissements: false };
    expect(contentsOf("en", rural).map((s) => s.id)).toEqual(["where", "change", "people", "work", "data"]);
  });

  it("point at ids the sections carry", () => {
    const sources = ["Commune", "People", "Housing", "Economy"]
      .map((name) => readFileSync(`site/src/components/places/${name}.astro`, "utf8"))
      .join("\n");
    for (const { id } of contentsOf("en", everything)) {
      expect(sources, id).toMatch(new RegExp(`<section[^>]*\\sid="${id}"`));
    }
  });

  it("are labelled for screen readers in both languages", () => {
    expect(places.en.onThisPage).toBe("On this page");
    expect(places.fr.onThisPage).toBe("Sur cette page");
  });
});
