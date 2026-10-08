import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { learnGaps, toArabic, toLatin } from "../../src/lib/spell.ts";
import { buildWordTable, withoutAyn, type WordTable } from "../../src/lib/translitWords.ts";

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

  it("is the French for what a douar is, where it's named for that", () => {
    expect(toLatin("قرية الصيد لمهيريز", none)).toBe("Village de pêche Lmhiriz");
    expect(toLatin("معبر الحدود الكركرات", none)).toMatch(/^Poste frontière /);
    expect(toLatin("تعاونية التحرير", none)).toBe("Coopérative Ettahrir");
    expect(toLatin("التعاونية الفلاحية مبروكة", none)).toMatch(/^Coopérative agricole /);
    expect(toLatin("تجزئة العمران", none)).toMatch(/^Lotissement /);
    expect(toLatin("إقامة لوازيس", none)).toMatch(/^Résidence /);
    expect(toLatin("ضيعة ضبوع", none)).toMatch(/^Ferme /);
    expect(toLatin("الضيعة الفلاحية التازي", none)).toBe("Ferme Ettazi");
    expect(toLatin("الثكنة العسكرية", none)).toBe("Caserne");
    expect(toLatin("مركز لڭفاف الثكنة", none)).toMatch(/ Caserne$/);
    expect(toLatin("ميناء الداخلة الاطلسي", none)).toMatch(/^Port /);
    expect(toLatin("المينا امسوان", none)).toMatch(/^Port /);
    expect(toLatin("محطة القطار", none)).toBe("Gare");
    expect(toLatin("سد المسيرة", none)).toMatch(/^Barrage /);
    expect(toLatin("سد محمد الخامس", none)).toBe("Barrage Mohammed V");
    expect(toLatin("المنجم", none)).toBe("Mine");
    expect(toLatin("مزرعة ديبوا", none)).toMatch(/^Ferme /);
    expect(toLatin("منطقة المرداني", none)).toMatch(/^Zone /);
    expect(toLatin("مدرسة تالمست", none)).toMatch(/^École /);
    expect(toLatin("قرية معمل السكر", none)).toBe("Village de la sucrerie");
    expect(toLatin("ثكنة مخزن موبيل الثامنة", none)).toMatch(/^Caserne Makhzen Mobile /);
    expect(toLatin("أيت عيسى (موبيل)", none)).toMatch(/ \(Mobile\)$/);
  });

  it("comes first where it ends the Arabic, as French names a place for what it is first", () => {
    expect(toLatin("ريفر بالم تجزئة", none)).toMatch(/^Lotissement /);
    expect(toLatin("التوير التعاونية", none)).toMatch(/^Coopérative /);
    expect(toLatin("أولاد بن العوني المدرسة", table)).toMatch(/^École Oulad /);
    expect(toLatin("ألاثنين المدرسة العتيقة", none)).toMatch(/^École traditionnelle /);
  });

  it("stays last where it's a centre, as Moroccan French has it, or a douar, which can be the douar's", () => {
    expect(toLatin("فيفي المركز", none)).toMatch(/ Centre$/);
    expect(toLatin("بير الدوار", table)).toMatch(/ Douar$/);
  });

  it("stays last where the name starts with a translation, in French order already", () => {
    expect(toLatin("مركز التعاونية", none)).toBe("Centre Coopérative");
  });

  it("is translated together where a phrase runs to more words than 2", () => {
    expect(toLatin("المدرسة الوطنية الفلاحية", none)).toBe("École nationale d'agriculture");
    expect(toLatin("المجمع السكني للمدرسة الوطنية الفلاحية", none)).toBe("Complexe résidentiel de l'École nationale d'agriculture");
    expect(toLatin("اوراش تحلية مياه البحر", none)).toBe("Chantier de dessalement d'eau de mer");
  });

  it("is spelt where it's part of a name", () => {
    expect(toLatin("أولاد بن الصيد", table)).toBe("Oulad Ben Saïd");
    expect(toLatin("قرية الحمراء", table)).toBe("Karia El Hamra");
    // ثكنة is barracks, but HCP writes the commune Tekna so, and its fractions after it.
    expect(toLatin("ثكنة", table)).toBe("Tekna");
    expect(toLatin("ثكنة الشمارخ", table)).toMatch(/^Tekna /);
    // HCP writes the commune مجمع الطلبة so; only المجمع السكني, a housing estate, is translated.
    expect(toLatin("مجمع الطلبة", table)).toBe("Majmaa Tolba");
    // Sources spell a forest and an airport as names: El Ghaba, and OpenStreetMap's Hay al Matar.
    expect(toLatin("دار الغابة", table)).toBe("Dar El Ghaba");
    expect(toLatin("المطار", table)).toMatch(/Matar$/);
  });
});

describe("the mark a source writes for ع", () => {
  it("is taken out, as French spellings leave it out", () => {
    expect(withoutAyn("’Ali", "علي")).toBe("Ali");
    expect(withoutAyn("Oulad Mohand Ou ’Ali", "اولاد محند اوعلي")).toBe("Oulad Mohand Ou Ali");
    expect(withoutAyn("Ya’qoub", "يعقوب")).toBe("Yaqoub");
    expect(withoutAyn("Bel’arb", "بلعربي")).toBe("Belarb");
    expect(withoutAyn("Al’Askar", "العسكر")).toBe("Alaskar");
    expect(withoutAyn("'Ain Bou 'Issa", "عين بوعسة")).toBe("Ain Bou Issa");
  });

  it("leaves an apostrophe that isn't one: the n' joining 2 words, M'hamed, and HCP's A'yat", () => {
    expect(withoutAyn("Imi n’Tizgui", "ايمي نتزكي")).toBe("Imi n’Tizgui");
    expect(withoutAyn("M’achou", "اوماشو")).toBe("M’achou");
    expect(withoutAyn("M'hamed", "امحمد")).toBe("M'hamed");
    expect(withoutAyn("A'yat", "أعيات")).toBe("A'yat");
  });

  it("doesn't split a word's spellings in the table, so a name learned with it comes out without", () => {
    const built = buildWordTable([
      { fr: "Oulad ’Ali", ar: "اولاد علي" },
      { fr: "Oulad ’Ali", ar: "اولاد علي" },
      { fr: "Oulad Ali", ar: "اولاد علي" },
    ]);
    expect(built.toLatin["علي"]).toBe("Ali");
    expect(toLatin("زاوية سيدي عبد الحق", table)).not.toMatch(/['’]/);
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

describe("the vowel between 2 consonants", () => {
  const times = (n: number, pair: [string, string]) => Array.from({ length: n }, () => pair);

  it("is the one sources put there, by the 2 letters, where they are and what follows them", () => {
    const gaps = learnGaps([...times(4, ["إسافن", "Issafen"]), ...times(4, ["بلقاضي", "Belkadi"])]);
    expect(gaps).toMatchObject({ "فن#": "e", "^بلC": "e" });
    expect(toLatin("أزافن", { ...none, gaps })).toBe("Azafen");
    expect(toLatin("بلحسن", { ...none, gaps })).toBe("Belhsen");
  });

  it("is, where its 2 letters were never learned, the one sources mostly put in that place in a word", () => {
    const gaps = learnGaps([["زقليت", "Zaklit"], ["دندانة", "Dandana"], ["لسناد", "Lasnad"], ["رندة", "Randa"]]);
    expect(gaps["^__C"]).toBe("a");
    expect(toLatin("لبخاتي", { ...none, gaps })).toBe("Labkhati");
  });

  it("is none where sources mostly put none, which stands over what the 2 letters alone take", () => {
    const gaps = { "^مرC": "", "^مر": "e" };
    expect(toLatin("مرزوك", { ...none, gaps })).toBe("Mrzouk");
    expect(toLatin("مريم", { ...none, gaps })).toBe("Merim");
  });

  it("is learned only where seen 4 times, and where one way has 2 in 5", () => {
    expect(learnGaps(times(3, ["إسافن", "Issafen"]))).toEqual({});
    expect(learnGaps([...times(2, ["إسافن", "Issafen"]), ...times(2, ["إسافن", "Issafan"]), ...times(2, ["إسافن", "Issafin"])])).toEqual({});
  });

  it("is left to the Ta- rule at the start of a word with ت", () => {
    expect(toLatin("تكموت", { ...none, gaps: { "^تكC": "i", "^تك": "i" } })).toBe("Takmout");
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

  it("learns 2 words HCP writes as one, where that's the only way the words line up", () => {
    const built = buildWordTable([
      { fr: "Moulay Abdelkader", ar: "مولاي عبد القادر" },
      { fr: "Banlieue Nord", ar: "أحواز سلا الشمالية" },
    ]);
    expect(built.toLatin).toEqual({ "مولاي": "Moulay", "عبد القادر": "Abdelkader" });
    expect(toLatin("مولاي عبد القادر", built)).toBe("Moulay Abdelkader");
    expect(toArabic("Abdelkader", built)).toBe("عبد القادر");
  });

  it("takes no other 2 words as one, since a source that leaves a word out lines up the same way", () => {
    expect(buildWordTable([{ fr: "Safi", ar: "حي اسفي" }]).toLatin).toEqual({});
    expect(buildWordTable([{ fr: "Ouladben Ali", ar: "اولاد بن علي" }]).toLatin).toEqual({});
  });
});
