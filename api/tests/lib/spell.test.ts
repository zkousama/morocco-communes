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
    // Sources mostly leave the e off after a final t (Tagmout), though HCP writes the commune Chaibate.
    expect(toLatin("شعيبات", none)).toBe("Chaibat");
    expect(toLatin("تالوين", none)).toBe("Talouine");
    // A Tamazight name starting with t and a consonant starts Ta-.
    expect(toLatin("تكموت", none)).toBe("Takmout");
    expect(toLatin("السوق", none)).toBe("Essouk");
    // A short vowel Arabic leaves out stays out: HCP writes الصفا as Essafa.
    expect(toLatin("الصفا", none)).toBe("Essfa");
    expect(toLatin("زاوية سيدي", none)).toBe("Zaouiat Sidi");
    // No construct t before an adjective with the article, and no unwritten short vowel either.
    expect(toLatin("ريصانة الجنوبية", none)).toBe("Rissana El Jnoubia");
  });
});

describe("a word a source writes in lower case", () => {
  it("starts with a capital, but for the n' joining 2 words", () => {
    const lower: WordTable = { toLatin: { "ملولن": "mloulne", "البرد": "el Berd", "نترست": "n’Tirst" }, toArabic: {} };
    expect(toLatin("إغير ملولن", lower)).toBe("Ighir Mloulne");
    expect(toLatin("البرد", lower)).toBe("El Berd");
    expect(toLatin("توريرت نترست", lower)).toMatch(/ n'Tirst$/);
  });
});

describe("a word that's translated, not spelt", () => {
  it("is Centre for the centre of a commune", () => {
    expect(toLatin("المركز", none)).toBe("Centre");
    expect(toLatin("مركز اكاون", none)).toBe("Centre Akaoune");
  });
});

describe("a name with another in brackets", () => {
  it("keeps the brackets, each part spelt on its own, and writes formerly as ex before the old name", () => {
    expect(toLatin("حلابة (أولاد علي منصور)", table)).toBe("Halaba (Oulad Ali Mansour)");
    expect(toLatin("إيمي مقورن المركز (اضار اوكادير سابقا)", table)).toBe("Imi Mqourn Centre (ex Adar Ougadir)");
    expect(toLatin("دوار 12(الضوسي)", table)).toMatch(/^Douar 12 \(.+\)$/);
  });

  it("drops a bracket left open", () => {
    expect(toLatin("(بن شرو", table)).not.toContain("(");
  });
});

describe("a number in a name", () => {
  it("stays a number in both directions, whatever the table learned", () => {
    expect(toLatin("أولاد كثير 1", { ...table, toLatin: { ...table.toLatin, "1": "Hay" } })).toBe("Oulad Ktir 1");
    expect(toLatin("دوار ٢", none)).toMatch(/ 2$/);
    expect(toArabic("Hay 3", none)).toMatch(/ 3$/);
  });

  it("isn't learned as a word", () => {
    expect(buildWordTable([{ fr: "Hay 1", ar: "حي 1" }]).toLatin).toEqual({ "حي": "Hay" });
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

describe("the opening of a word", () => {
  it("takes the vowel sources put between its first 2 consonants, where they agree", () => {
    const learned = buildWordTable([
      ...Array.from({ length: 8 }, () => ({ fr: "Belkadi", ar: "بلقاضي" })),
      ...Array.from({ length: 8 }, () => ({ fr: "Mrizig", ar: "مريزيك" })),
    ]);
    expect(learned.openings).toMatchObject({ "بل": "e" });
    expect(toLatin("بلحسن", { ...none, openings: learned.openings })).toBe("Belhsn");
    expect(toLatin("مرزوك", { ...none, openings: { "مر": "" } })).toBe("Mrzouk");
  });
});

describe("the word table", () => {
  it("learns a word only where its keys meet its partner's, so a translation teaches nothing", () => {
    const built = buildWordTable([
      { fr: "Sidi Kacem", ar: "سيدي قاسم" },
      { fr: "Banlieue Nord", ar: "أحواز الشمالية" },
    ]);
    expect(built.toLatin).toEqual({ "سيدي": "Sidi", "قاسم": "Kacem" });
    expect(built.openings).toEqual({});
    expect(built.toArabic).toEqual({ sidi: "سيدي", kacem: "قاسم" });
  });
});
