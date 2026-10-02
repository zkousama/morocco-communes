import { describe, expect, it } from "vitest";
import { addressDouar, nameDouars, pairsOf, tidy, type School } from "../../src/lib/douarNames.ts";

const school = (over: Partial<School>): School => ({
  name: { fr: "ESSALAM", ar: "السلام" },
  address: { fr: "DOUAR OULED TALEB COMMUNE SIDI TAIBI", ar: "دوار اولاد الطالب ج/ سيدي الطيبي" },
  commune: "c1",
  ...over,
});
const douars = new Map([["c1", [{ code: "1", name: { ar: "أولاد الطالب" } }, { code: "2", name: { ar: "تاكموت" } }]]]);

describe("a school's douar", () => {
  it("is read out of its address, up to the commune", () => {
    expect(addressDouar.fr("DOUAR OULED TALEB COMMUNE SIDI TAIBI")).toBe("OULED TALEB");
    expect(addressDouar.ar("دوار اولاد الطالب ج/ سيدي الطيبي")).toBe("اولاد الطالب");
  });

  it("is read out of its name, without the word for a school", () => {
    expect(pairsOf(school({ name: { fr: "GROUPE SCOLAIRE TAGMOUT", ar: "مجموعة مدارس تاكموت" }, address: { fr: "", ar: "" } }))).toEqual([["TAGMOUT", "تاكموت"]]);
  });

  it("isn't taken when the 2 scripts name different things", () => {
    // The school's own name is a pair; the address, Tafraout beside اولاد الطالب, isn't.
    expect(pairsOf(school({ address: { fr: "DOUAR TAFRAOUT", ar: "دوار اولاد الطالب" } }))).toEqual([["ESSALAM", "السلام"]]);
  });

  it("is written the way names are, not in capitals", () => {
    expect(tidy("OULED  SIDI ABDENNEBI")).toBe("Ouled Sidi Abdennebi");
    expect(tidy("IMI N'TLIT")).toBe("Imi N'tlit");
  });
});

describe("naming the douars", () => {
  it("names a douar its commune holds under the school's Arabic", () => {
    expect([...nameDouars([school({})], douars)]).toEqual([["1", "Ouled Taleb"]]);
  });

  it("names nothing once the commune is swapped for another, which is how chance is measured", () => {
    expect(nameDouars([school({})], douars, () => "c2").size).toBe(0);
  });
});
