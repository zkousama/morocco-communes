import { describe, expect, it } from "vitest";
import { CHECKED } from "../../api/src/lib/mismatch.ts";
import { figureName, mismatchNote, noteUnder } from "../src/lib/mismatch";

describe("the census note", () => {
  const water = { path: "amenities.runningWater", then: 97.2, now: 3 };
  const darija = { path: "localLanguages.darija", then: 5, now: 60 };

  it("names every figure the check covers, in both languages", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const path of CHECKED) expect(figureName(locale, path), `${locale} ${path}`).toMatch(/^\p{Lu}/u);
    }
    expect(figureName("en", "wastewater.publicSewer")).toBe("Public sewer");
    expect(figureName("fr", "localLanguages.tarifit")).toBe("Tarifit");
  });

  it("reads an amenity in lower case, and a language as a name", () => {
    expect(mismatchNote("en", [darija, water])).toBe(
      "The two censuses don’t line up here: Darija 5.0% in 2014, 60.0% in 2024; running water 97.2% in 2014, 3.0% in 2024. Both are HCP’s figures. The population didn’t change enough to explain it, so the answer was most likely recorded differently.",
    );
    expect(mismatchNote("fr", [water])).toBe(
      "Les deux recensements ne concordent pas ici : eau courante 97,2\u202f% en 2014, 3,0\u202f% en 2024. Les deux chiffres sont ceux du HCP. La population n’a pas assez changé pour l’expliquer : la réponse a sans doute été enregistrée autrement.",
    );
  });

  it("has nothing to say when nothing is flagged", () => {
    expect(mismatchNote("en", [])).toBeNull();
  });

  it("sits under the languages when a language is flagged, and under the headline figures otherwise", () => {
    expect(noteUnder([water, darija])).toBe("languages");
    expect(noteUnder([water])).toBe("figures");
  });
});
