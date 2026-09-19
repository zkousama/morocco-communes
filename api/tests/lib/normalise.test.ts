import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalise, skeleton, trigrams } from "../../src/lib/normalise.ts";

const communes = JSON.parse(readFileSync("data/v1/attributes/communes.json", "utf8")) as {
  name: { fr: string; ar: string };
  slug: string;
}[];

describe("normalise: the folds the data needs", () => {
  it("folds the three alef variants, which 356 names carry", () => {
    expect(normalise("آيت")).toBe(normalise("ايت"));
    expect(normalise("أحمد")).toBe(normalise("احمد"));
    expect(normalise("إمزورن")).toBe(normalise("امزورن"));
  });

  it("folds ta-marbuta to ha, which 367 names carry", () => {
    expect(normalise("قمرة")).toBe(normalise("قمره"));
  });

  it("folds alef maqsura to ya, which 42 names carry", () => {
    expect(normalise("مولاى")).toBe(normalise("مولاي"));
  });

  it("drops the hamza forms, which 28 names carry", () => {
    expect(normalise("مأمورة")).toBe(normalise("ماموره"));
    expect(normalise("سئيد")).toBe(normalise("سييد"));
  });

  it("folds the French accents, which are the only non-ASCII letters in the Latin names", () => {
    expect(normalise("Tétouan")).toBe("tetouan");
    expect(normalise("Aïn Châabat")).toBe("ain chaabat");
    expect(normalise("Sidi Yahya")).toBe("sidi yahya");
  });

  it("treats apostrophes, hyphens and en-dashes as word separators", () => {
    expect(normalise("Oulad Sidi Ali D'Ait Ouacif")).toBe("oulad sidi ali d ait ouacif");
    expect(normalise("Tanger-Tétouan–Al Hoceima")).toBe("tanger tetouan al hoceima");
    expect(normalise("Sidi Bou Othmane’s")).toBe("sidi bou othmane s");
  });
});

describe("normalise: the folds only a query needs", () => {
  // No commune name contains a tatweel or a vowel mark. These rules exist because
  // people type them, so they are tested from the query side, where they matter.
  it("ignores a tatweel a typist inserted, which no name contains", () => {
    const data = communes.some((c) => /ـ/.test(c.name.ar));
    expect(data).toBe(false);
    expect(normalise("طنــجة")).toBe(normalise("طنجة"));
  });

  it("ignores harakat a typist added, which no name carries", () => {
    const data = communes.some((c) => /[ً-ْ]/.test(c.name.ar));
    expect(data).toBe(false);
    // طَنْجَة with fatha, sukun and fatha written in.
    expect(normalise("طَنْجَة")).toBe(normalise("طنجة"));
  });

  it("collapses runs of whitespace and trims, so a pasted query still matches", () => {
    expect(normalise("  Ait   Kamra \n")).toBe("ait kamra");
  });

  it("returns an empty string for a query with nothing searchable in it", () => {
    expect(normalise("!!! ???")).toBe("");
    expect(normalise("")).toBe("");
  });
});

describe("normalise: applied to the real dataset", () => {
  it("leaves every commune with a non-empty normalised form in both languages", () => {
    for (const c of communes) {
      expect(normalise(c.name.fr), c.name.fr).not.toBe("");
      expect(normalise(c.name.ar), c.name.ar).not.toBe("");
    }
  });

  it("puts the word-boundary pair the crosswalk found within reach of each other", () => {
    // 2014's "Al Majjatia Oulad Taleb" is 2024's "Almajjatia Oulad Taleb".
    const a = trigrams(normalise("Al Majjatia Oulad Taleb"));
    const b = trigrams(normalise("Almajjatia Oulad Taleb"));
    const shared = a.filter((g) => b.includes(g)).length;
    expect(shared / Math.max(a.length, b.length)).toBeGreaterThan(0.6);
  });
});

describe("trigrams", () => {
  it("slides a three-character window including spaces", () => {
    expect(trigrams("ait kamra").slice(0, 4)).toEqual(["ait", "it ", "t k", " ka"]);
  });

  it("yields a short name whole rather than nothing", () => {
    expect(trigrams("fes")).toEqual(["fes"]);
    expect(trigrams("ay")).toEqual(["ay"]);
    expect(trigrams("")).toEqual([]);
  });
});

describe("skeleton", () => {
  it("keeps what survives transliteration", () => {
    expect(skeleton(normalise("Tétouan"))).toBe(skeleton(normalise("Titwan")));
    expect(skeleton(normalise("Essaouira"))).toBe("swr");
    expect(skeleton(normalise("El Jadida"))).toBe("jd");
    expect(skeleton(normalise("Kelâat Sraghna"))).toBe(skeleton(normalise("Qalaat Sraghna")));
    expect(skeleton(normalise("Oulad Teima"))).toBe(skeleton(normalise("Ouled Teima")));
  });

  it("gives an Arabic name none", () => {
    expect(skeleton(normalise("طنجة"))).toBe("");
  });
});
