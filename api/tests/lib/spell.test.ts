import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toArabic, toLatin } from "../../src/lib/spell.ts";
import { buildWordTable, type WordTable } from "../../src/lib/translitWords.ts";

const table = JSON.parse(readFileSync("api/generated/translit-words.json", "utf8")) as WordTable;
const none: WordTable = { toLatin: {}, toArabic: {} };

describe("an Arabic name in Latin", () => {
  it("takes HCP's spelling for a word it has seen", () => {
    expect(toLatin("أولاد سعيد", table)).toBe("Oulad Said");
    expect(toLatin("سيدي بنور", table)).toBe("Sidi Bennour");
  });

  it("spells an unseen word by rule, the way French writes Moroccan names", () => {
    expect(toLatin("تيݣراو", none)).toBe("Tigraou");
    expect(toLatin("شعيبات", none)).toBe("Chaibate");
    expect(toLatin("السوق", none)).toBe("Essouk");
    // A short vowel Arabic leaves out stays out: HCP writes الصفا as Essafa.
    expect(toLatin("الصفا", none)).toBe("Essfa");
    expect(toLatin("زاوية سيدي", none)).toBe("Zaouiat Sidi");
    // No construct t before an adjective with the article, and no unwritten short vowel either.
    expect(toLatin("ريصانة الجنوبية", none)).toBe("Rissana El Jnoubia");
  });
});

describe("a Latin name in Arabic", () => {
  it("takes HCP's spelling for a word it has seen", () => {
    expect(toArabic("Ouled Youssef", table)).toBe("أولاد يوسف");
  });

  it("spells an unseen word by rule", () => {
    expect(toArabic("Tafraout", none)).toBe("تافراوت");
    expect(toArabic("Boujedyane", none)).toBe("بوجديان");
  });
});

describe("the word table", () => {
  it("learns a word only where its keys meet its partner's, so a translation teaches nothing", () => {
    const built = buildWordTable([
      { fr: "Sidi Kacem", ar: "سيدي قاسم" },
      { fr: "Banlieue Nord", ar: "أحواز الشمالية" },
    ]);
    expect(built.toLatin).toEqual({ "سيدي": "Sidi", "قاسم": "Kacem" });
    expect(built.toArabic).toEqual({ sidi: "سيدي", kacem: "قاسم" });
  });
});
