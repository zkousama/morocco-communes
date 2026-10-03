import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docs, SPEC_AR, SPEC_FR } from "../src/i18n/docs.ts";
import { DOUAR_TYPES_AR, FIELDS_AR } from "../src/i18n/fields.ts";
import { glossary } from "../src/i18n/glossary.ts";
import { names } from "../src/i18n/names.ts";
import { ordinal, places } from "../src/i18n/places.ts";
import { dirOf, LOCALES, path, ui } from "../src/i18n/ui.ts";
import { counted, numbers, percent, span } from "../src/lib/format.ts";
import { insightsOf } from "../src/lib/insights.ts";
import { byNameIn, nameBeside, nameIn } from "../src/lib/names.ts";

/** Every string in an object, by its path. */
const leaves = (value: unknown, at = ""): [string, string][] =>
  typeof value === "string"
    ? [[at, value]]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, at ? `${at}.${key}` : key))
      : [];
const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
/** The left-to-right mark format.ts puts around a sign, a percent and a range in Arabic. */
const LRM = "‎";

describe("the Arabic site", () => {
  it("is a language of the site, under /ar/, read right to left", () => {
    expect(LOCALES).toContain("ar");
    expect(path("ar", "communes/")).toBe("/ar/communes/");
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("fr")).toBe("ltr");
  });

  it("has a page wherever French has one", () => {
    const pages = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? pages(join(dir, entry)) : [join(dir, entry)]));
    const french = pages("site/src/pages/fr").map((file) => file.replace("site/src/pages/fr/", ""));
    expect(french.length).toBeGreaterThan(15);
    expect(french.filter((file) => !existsSync(join("site/src/pages/ar", file)))).toEqual([]);
  });

  it("says in Arabic every string the interface, the docs and the names page have", () => {
    for (const [name, copy] of Object.entries({ ui, docs, names })) {
      const english = new Map(leaves(copy.en));
      const arabic = new Map(leaves(copy.ar));
      expect([...arabic.keys()].sort(), name).toEqual([...english.keys()].sort());
      for (const [key, text] of arabic) expect(placeholders(text), `${name} ${key}`).toEqual(placeholders(english.get(key)!));
    }
  });

  it("says in Arabic every string the place pages have, with a counted noun in each form Arabic gives it", () => {
    const english = new Map(leaves(places.en));
    const arabic = leaves(places.ar);
    // Arabic counts a noun in 5 forms where English has 2, and writes one and two without the number.
    const forms = /\.(one|two|few|many|other)$/;
    const plain = arabic.filter(([key]) => !forms.test(key));
    expect(plain.map(([key]) => key).sort()).toEqual([...english.keys()].filter((key) => !forms.test(key)).sort());
    for (const [key, text] of plain) expect(placeholders(text), key).toEqual(placeholders(english.get(key)!));
    for (const key of ["douarCount", "fractionCount", "movedPoints"] as const) {
      expect(Object.keys(places.ar[key]).sort(), key).toEqual(["few", "many", "one", "other", "two"]);
    }
  });

  it("translates every line of the API's spec that French does", () => {
    expect(Object.keys(SPEC_AR)).toEqual(Object.keys(SPEC_FR));
    for (const [key, text] of Object.entries(SPEC_AR)) expect(text, key).toMatch(/\p{Script=Arabic}/u);
  });

  it("keeps the glossary's numbers the ones the English gives", () => {
    const digits = (text = "") => (text.match(/\d[\d.,  ]*\d|\d/g) ?? []).map((n) => n.replace(/\D/g, "")).sort();
    const english = new Map(glossary.en.groups.flatMap((g) => g.entries).map((e) => [e.id, e.body]));
    for (const entry of glossary.ar.groups.flatMap((g) => g.entries)) expect(digits(entry.body), entry.id).toEqual(digits(english.get(entry.id)));
  });

  it("writes its numbers in Western digits, as Morocco does", () => {
    const all = [ui.ar, places.ar, docs.ar, glossary.ar, names.ar, FIELDS_AR, SPEC_AR].flatMap((copy) => leaves(copy));
    expect(all.length).toBeGreaterThan(1500);
    expect(all.filter(([, text]) => /[٠-٩۰-۹]/.test(text)).map(([key]) => key)).toEqual([]);
  });
});

describe("the census fields' Arabic names", () => {
  const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
  const paths = (fields: { path: string }[]) => fields.map((f) => f.path);
  const census = read("data/v1/indicators/fields.json");
  const census2014 = read("data/v1/indicators/2014/fields.json");
  const dictionaries: Record<keyof typeof FIELDS_AR, string[]> = {
    indicators: paths([...census.people, ...census.households]),
    indicators2014: paths([...census2014.people, ...census2014.households]),
    economy: paths(read("data/v1/economy/fields.json").fields),
    housing: paths(read("data/v1/housing/fields.json").fields),
    douars: paths(read("data/v1/douars/fields.json").fields),
  };

  it("cover every field of the dataset, and nothing else", () => {
    for (const [set, fields] of Object.entries(dictionaries)) {
      expect(Object.keys(FIELDS_AR[set as keyof typeof FIELDS_AR]).sort(), set).toEqual([...new Set(fields)].sort());
    }
    expect(Object.keys(DOUAR_TYPES_AR).sort()).toEqual(Object.keys(read("data/v1/douars/fields.json").types).sort());
  });

  it("are written in Arabic", () => {
    for (const [key, label] of leaves(FIELDS_AR)) expect(label, key).toMatch(/^[\p{Script=Arabic}\dA-Z]/u);
  });
});

describe("numbers and names in Arabic", () => {
  it("groups thousands with a point and writes a decimal comma", () => {
    expect(numbers("ar").format(1503)).toBe("1.503");
    expect(numbers("ar", 1, true).format(93.5)).toBe("93,5");
    expect(ordinal("ar", 1089)).toBe("1.089");
  });

  it("keeps a sign, a percent sign and a range in reading order inside right-to-left text", () => {
    expect(percent("ar", 12.8)).toBe(`12,8${LRM}%${LRM}`);
    expect(percent("ar", -3.5, { signed: true })).toBe(`${LRM}−3,5${LRM}%${LRM}`);
    expect(span("ar", "70", "74")).toBe(`70${LRM}–74`);
    // The other languages carry no mark.
    expect(percent("en", -3.5, { signed: true })).toBe("−3.5%");
    expect(percent("fr", 12.8)).toBe("12,8 %");
    expect(span("fr", "70", "74")).toBe("70–74");
  });

  it("counts a noun in the form Arabic gives the number", () => {
    const douars = places.ar.douarCount;
    expect(counted("ar", douars, 1)).toBe("دوار واحد");
    expect(counted("ar", douars, 2)).toBe("دواران");
    expect(counted("ar", douars, 7)).toBe("7 دواوير");
    expect(counted("ar", douars, 24)).toBe("24 دوارا");
    expect(counted("ar", douars, 100)).toBe("100 دوار");
    expect(counted("en", places.en.douarCount, 1)).toBe("1 douar");
    expect(counted("fr", places.fr.douarCount, 24)).toBe("24 douars");
  });

  it("leads with the Arabic name on the Arabic site and sets the Latin one beside it", () => {
    const tanger = { fr: "Tanger", ar: "طنجة" };
    expect(nameIn("ar", tanger)).toBe("طنجة");
    expect(nameBeside("ar", tanger)).toBe("Tanger");
    expect(nameIn("fr", tanger)).toBe("Tanger");
    expect(nameBeside("en", tanger)).toBe("طنجة");
    expect(nameIn("ar", { fr: "Hay Salam", ar: null })).toBe("Hay Salam");
    expect(nameBeside("ar", { fr: "Hay Salam", ar: null })).toBeUndefined();
    const units = [{ name: { fr: "Tiznit", ar: "تيزنيت" } }, { name: { fr: "Agadir", ar: "أكادير" } }];
    expect([...units].sort(byNameIn("ar")).map((u) => u.name.fr)).toEqual(["Agadir", "Tiznit"]);
  });
});

describe("the standout figures' Arabic lines", () => {
  const lines = [...insightsOf.values()].flatMap((file) => file.findings.map((f) => f.line.ar));

  it("are written for every published figure", () => {
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) expect(line).toMatch(/^\p{Script=Arabic}.*\.$/u);
  });

  it("open on a verb that agrees with its subject: a share is feminine, the rest masculine", () => {
    const verbs: Record<string, "f" | "m"> = { تبلغ: "f", يبلغ: "m", انتقلت: "f", انتقل: "m", استقرت: "f", استقر: "m", تغيرت: "f", تغير: "m" };
    for (const line of lines) {
      const [verb, subject] = line.split(" ");
      expect(Object.keys(verbs), line).toContain(verb);
      expect(subject === "نسبة" ? "f" : "m", line).toBe(verbs[verb!]);
    }
  });
});
