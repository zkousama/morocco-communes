import { describe, expect, it } from "vitest";
import { CHECKED } from "../../api/src/lib/mismatch.ts";
import { afterQuake, amenityNote, figureName, languageNote } from "../src/lib/mismatch";
import { communes } from "../src/lib/places";

const codeOf = (name: string) => communes.find((c) => c.name.fr === name)!.code;

describe("the census notes", () => {
  const water = { path: "amenities.runningWater", then: 97.2, now: 3 };
  const power = { path: "amenities.electricity", then: 92.7, now: 56.2 };
  const kitchen = { path: "amenities.kitchen", then: 96, now: 56 };
  const darija = { path: "localLanguages.darija", then: 5, now: 60 };

  it("names every figure the check covers, in every language", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const path of CHECKED) expect(figureName(locale, path), `${locale} ${path}`).toMatch(/^\p{Lu}/u);
    }
    for (const path of CHECKED) expect(figureName("ar", path), `ar ${path}`).toMatch(/^\p{Script=Arabic}/u);
    expect(figureName("en", "wastewater.publicSewer")).toBe("Public sewer");
    expect(figureName("fr", "localLanguages.tarifit")).toBe("Tarifit");
  });

  it("say the languages don't line up, and nothing about amenities", () => {
    expect(languageNote("en", [darija, water])).toBe(
      "The two censuses don’t line up here: Darija 5.0% in 2014, 60.0% in 2024.",
    );
    expect(languageNote("en", [water])).toBeNull();
  });

  it("state an amenity's fall with no cause", () => {
    expect(amenityNote("en", [darija, water], codeOf("Lounasda"))).toBe(
      "Between the two censuses, households with running water went from 97.2% to 3.0%. A fall this large is rare, and the site keeps it out of comparisons.",
    );
    expect(amenityNote("en", [darija], codeOf("Lounasda"))).toBeNull();
  });

  it("add the earthquake in the provinces it affected", () => {
    expect(amenityNote("en", [water, power], codeOf("Ijoukak"))).toBe(
      "Between the two censuses, households with running water went from 97.2% to 3.0%; households with electricity went from 92.7% to 56.2%. Falls this large are rare, and the site keeps them out of comparisons. The 2024 census came a year after the September 2023 earthquake.",
    );
    expect(amenityNote("fr", [kitchen], codeOf("Anougal"))).toBe(
      "Entre les deux recensements, les ménages ayant une cuisine sont passés de 96,0\u202f% à 56,0\u202f%. Une baisse aussi forte est rare, et le site l’écarte des comparaisons. Le recensement de 2024 a eu lieu un an après le séisme de septembre 2023.",
    );
  });

  it("place Al Haouz, Taroudannt, Azilal, Chichaoua, Marrakech and Ouarzazate after the earthquake, and not El Kelâa des Sraghna", () => {
    for (const name of ["Ijoukak", "Tigouga", "Tisqi", "Adassil", "Ouarzazate"]) expect(afterQuake(codeOf(name)), name).toBe(true);
    expect(communes.some((c) => c.code.startsWith("07.351.") && afterQuake(c.code))).toBe(true);
    expect(afterQuake(codeOf("Lounasda"))).toBe(false);
  });
});
