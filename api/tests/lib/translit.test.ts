import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arabicKeys, keysMeet, latinKeys } from "../../src/lib/translit.ts";

const read = (level: string) =>
  JSON.parse(readFileSync(`data/v1/attributes/${level}.json`, "utf8")) as { name: { fr: string; ar: string | null } }[];
const pairs = ["communes", "provinces", "regions", "arrondissements", "cercles"]
  .flatMap(read)
  .filter((u): u is { name: { fr: string; ar: string } } => Boolean(u.name.fr && u.name.ar));
const meet = (ar: string, fr: string) => keysMeet(arabicKeys(ar), latinKeys(fr));

describe("an Arabic name and its Latin spelling", () => {
  it("meet for the douar names people type in Latin", () => {
    expect(meet("تيݣراو", "Tigraw")).toBe(true);
    expect(meet("تيݣراو", "Tigraou")).toBe(true);
    expect(meet("اكنيس", "Agnis")).toBe(true);
    expect(meet("أولاد سعيد", "Ouled Said")).toBe(true);
  });

  it("meet across the spellings French uses for one sound", () => {
    expect(meet("زاوية سيدي قاسم", "Zaouiat Sidi Kacem")).toBe(true);
    expect(meet("غفساي", "Rhafsai")).toBe(true);
    expect(meet("غفساي", "Ghafsai")).toBe(true);
    expect(meet("جرسيف", "Guercif")).toBe(true);
    expect(meet("عبد القادر", "Abdelkader")).toBe(true);
    expect(meet("مولاي إدريس زرهون", "My Idriss Zerhoun")).toBe(true);
    expect(meet("سيدي إسحاق", "Sidi Ishaq")).toBe(true);
  });

  it("don't meet for different names", () => {
    expect(meet("تيزنيت", "Tafraout")).toBe(false);
    expect(meet("سيدي بنور", "Sidi Kacem")).toBe(false);
  });

  it("meet for at least 98% of the units HCP names in both scripts", () => {
    const met = pairs.filter((u) => meet(u.name.ar, u.name.fr)).length;
    expect(pairs.length).toBe(1852);
    expect(met / pairs.length).toBeGreaterThanOrEqual(0.98);
  });
});
