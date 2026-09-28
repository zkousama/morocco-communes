import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("site/src/components/places/Commune.astro", "utf8");
const markup = source.slice(source.indexOf("<Place"));
const at = (text: string) => {
  const i = markup.indexOf(text);
  expect(i, text).toBeGreaterThan(-1);
  return i;
};

describe("a commune page's layout", () => {
  it("puts the next door and twin lines right under the headline numbers, above where it is", () => {
    expect(at('<div class="context">')).toBeGreaterThan(at("</dl>"));
    expect(at('<div class="context">')).toBeLessThan(at("<h2>{p.where}</h2>"));
  });

  it("puts the section links after those lines, above where it is", () => {
    expect(at('<nav class="contents" aria-label={p.onThisPage}>')).toBeGreaterThan(at('<div class="context">'));
    expect(at('<nav class="contents" aria-label={p.onThisPage}>')).toBeLessThan(at("<h2>{p.where}</h2>"));
  });
});
