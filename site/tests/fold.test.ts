import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldTopics } from "../src/lib/fold.ts";
import { places } from "../src/i18n/places.ts";

const topics = (...names: string[]) => names.map((topic) => ({ topic }));
const read = (path: string) => readFileSync(`site/src/${path}`, "utf8");
const markupOf = (path: string, start: string) => {
  const source = read(path);
  return source.slice(source.indexOf(start));
};
const at = (markup: string, text: string) => {
  const i = markup.indexOf(text);
  expect(i, text).toBeGreaterThan(-1);
  return i;
};

describe("the census topics a phone folds away", () => {
  it("leave the local languages out and fold the rest, in their order", () => {
    const in2014 = topics("localLanguages", "languageCombinations", "commute", "workplace", "profession", "diploma");
    expect(foldTopics(in2014)).toEqual({
      shown: topics("localLanguages"),
      folded: topics("languageCombinations", "commute", "workplace", "profession", "diploma"),
    });
  });

  it("fold every topic when there are no local languages", () => {
    expect(foldTopics(topics("languagesReadAndWritten", "commute"))).toEqual({
      shown: [],
      folded: topics("languagesReadAndWritten", "commute"),
    });
  });
});

describe("the census fold's markup", () => {
  const markup = markupOf("components/places/People.astro", '<section class="people"');

  it("is open until a script closes it, so every figure shows without JavaScript", () => {
    expect(markup).toMatch(/<details class="more" open>\s*<summary>\{p\.moreCensus\}<\/summary>/);
  });

  it("keeps the mismatch note outside the fold", () => {
    expect(at(markup, 'class="mismatch"')).toBeLessThan(at(markup, "<details"));
    expect(markup.slice(markup.indexOf("<details")).includes('class="mismatch"')).toBe(false);
  });

  it("has a summary in both languages", () => {
    expect(places.en.moreCensus).toBe("More census figures");
    expect(places.fr.moreCensus).toBe("Plus de chiffres du recensement");
  });
});

describe("the dwellings and business folds", () => {
  for (const [path, start, summary] of [
    ["components/places/Housing.astro", '<section class="dwellings"', "moreDwellings"],
    ["components/places/Economy.astro", '<section class="work"', "moreWork"],
  ] as const) {
    it(`keep the headline figures out and fold the charts, in ${path}`, () => {
      const markup = markupOf(path, start);
      const fold = at(markup, `<details class="more" open>\n      <summary>{p.${summary}}</summary>`);
      expect(at(markup, '<dl class="figures">')).toBeLessThan(fold);
      expect(at(markup, '<div class="pair even">')).toBeGreaterThan(fold);
    });
  }

  it("have summaries in both languages", () => {
    expect(places.en.moreDwellings).toBe("More dwelling figures");
    expect(places.fr.moreDwellings).toBe("Plus de chiffres sur les logements");
    expect(places.en.moreWork).toBe("More business figures");
    expect(places.fr.moreWork).toBe("Plus de chiffres sur les entreprises");
  });
});

describe("the in the data fold", () => {
  const markup = markupOf("components/places/Commune.astro", "<h2>{p.inTheData}</h2>");

  it("folds the files and the code, and leaves the report link out", () => {
    const fold = at(markup, "<details class=\"more\" open>\n      <summary>{p.moreData}</summary>");
    expect(at(markup, '<dl class="data">')).toBeGreaterThan(fold);
    expect(at(markup, "<Code ")).toBeLessThan(at(markup, "</details>"));
    expect(at(markup, 'class="report"')).toBeGreaterThan(at(markup, "</details>"));
  });

  it("has a summary in both languages", () => {
    expect(places.en.moreData).toBe("Files and code");
    expect(places.fr.moreData).toBe("Fichiers et code");
  });
});

describe("every fold on a place page", () => {
  const layout = read("layouts/Place.astro");

  it("is closed by one script, after the page's sections, on screens as narrow as the phone menu's", () => {
    const script = layout.slice(at(layout, "<slot />"));
    expect(script).toContain('matchMedia("(max-width: 48rem)")');
    expect(script).toContain('querySelectorAll(".place details.more")');
    expect(script).toContain(".open = false");
  });
});
