import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldTopics } from "../src/lib/fold.ts";
import { places } from "../src/i18n/places.ts";

const topics = (...names: string[]) => names.map((topic) => ({ topic }));

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
  const source = readFileSync("site/src/components/places/People.astro", "utf8");
  const markup = source.slice(source.indexOf('<section class="people"'));

  it("is open until a script closes it, so every figure shows without JavaScript", () => {
    expect(markup).toMatch(/<details class="more" open>\s*<summary>\{p\.moreCensus\}<\/summary>/);
  });

  it("is closed by a script on screens as narrow as the phone menu's", () => {
    expect(markup).toMatch(/matchMedia\("\(max-width: 48rem\)"\)[\s\S]*\.open = false/);
  });

  it("keeps the mismatch note outside the fold", () => {
    expect(markup.indexOf('class="mismatch"')).toBeGreaterThan(-1);
    expect(markup.indexOf('class="mismatch"')).toBeLessThan(markup.indexOf("<details"));
    expect(markup.slice(markup.indexOf("<details")).includes('class="mismatch"')).toBe(false);
  });

  it("has a summary in both languages", () => {
    expect(places.en.moreCensus).toBe("More census figures");
    expect(places.fr.moreCensus).toBe("Plus de chiffres du recensement");
  });
});
