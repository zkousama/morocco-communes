import { describe, expect, it } from "vitest";
import { buildCrosswalk } from "../../src/build/crosswalk.ts";
import type { Hcp2014Unit } from "../../src/sources/hcp2014.ts";

const commune = (code: string, codeDigits: string, fr: string, total: number | null) => ({
  code,
  codeDigits,
  name: { fr },
  population: { "2024": { total } },
});

const unit = (codeDigits: string, nameFr: string, population: number | null): Hcp2014Unit => ({
  codeDigits,
  nameFr,
  nameAr: "",
  kind: "commune",
  population,
  households: null,
});

describe("buildCrosswalk", () => {
  it("matches an identical name within the same province", () => {
    const { rows, unmatched2024, unmatched2014 } = buildCrosswalk(
      [commune("01.051.11.01", "010511101", "Ait Kamra", 10000)],
      [unit("010510501", "Ait Kamra", 9000)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("exact_name_in_province");
    expect(rows[0]!.code2014).toBe("01.051.05.01");
    expect(rows[0]!.evidence.populationRatio).toBeCloseTo(1.11, 2);
    expect(unmatched2024).toEqual([]);
    expect(unmatched2014).toEqual([]);
  });

  it("does not match across provinces even when the name is identical", () => {
    const { rows, unmatched2024 } = buildCrosswalk(
      [commune("01.051.11.01", "010511101", "Ait Kamra", 10000)],
      [unit("070510501", "Ait Kamra", 9000)],
    );
    expect(rows).toEqual([]);
    expect(unmatched2024).toEqual(["01.051.11.01"]);
  });

  it("ignores case, accents and the (Mun.) marker when comparing names", () => {
    const { rows } = buildCrosswalk(
      [commune("01.511.05.19", "015110519", "Hjar Ennhal", 27204)],
      [unit("015118105", "HJAR ENNHAL (Mun.)", 9792)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("exact_name_in_province");
  });

  it("treats an attached Arabic article as the same name", () => {
    // The real pair: 2014 writes the article separately, 2024 attaches it.
    const { rows } = buildCrosswalk(
      [commune("06.355.01.07", "063550107", "Almajjatia Oulad Taleb", 95457)],
      [unit("063550301", "Al Majjatia Oulad Taleb", 32286)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("exact_name_in_province");
    expect(rows[0]!.evidence.normalisedNameMatch).toBe(true);
  });

  it("falls back to the sole remaining candidate in a province", () => {
    const { rows } = buildCrosswalk(
      [commune("01.051.11.07", "010511107", "Bni Abdellah", 6500)],
      [unit("010510507", "Bni Abdallah", 5983)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("sole_remaining_in_province");
    expect(rows[0]!.evidence.normalisedNameMatch).toBe(false);
    expect(rows[0]!.evidence.candidatesInProvince).toBe(1);
  });

  it("leaves a province with two spelling-variant candidates unmatched rather than guessing", () => {
    const { rows, unmatched2024, unmatched2014 } = buildCrosswalk(
      [commune("01.051.11.07", "010511107", "Bni Abdellah", 6500)],
      [unit("010510507", "Bni Abdallah", 5983), unit("010510509", "Bni Hadifa", 4000)],
    );
    expect(rows).toEqual([]);
    expect(unmatched2024).toHaveLength(1);
    expect(unmatched2014).toHaveLength(2);
  });

  it("never claims one 2014 unit for two communes", () => {
    const { rows, unmatched2024 } = buildCrosswalk(
      [
        commune("01.051.11.01", "010511101", "Ait Kamra", 10000),
        commune("01.051.11.03", "010511103", "Ait Kamra", 8000),
      ],
      [unit("010510501", "Ait Kamra", 9000)],
    );
    // Pass 1 requires the name to be unique on the commune side too, so two communes
    // sharing a name never race for the unit there: both are left unmatched by pass 1.
    // Pass 2's exhaustion then resolves the first commune in array order; the second
    // sees no candidate left. The unit is never claimed twice.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe("sole_remaining_in_province");
    expect(rows[0]!.code2024).toBe("01.051.11.01");
    expect(unmatched2024).toEqual(["01.051.11.03"]);
  });

  it("reports a null ratio rather than dividing by a missing figure", () => {
    const { rows } = buildCrosswalk(
      [commune("12.066.03.03", "120660303", "Aghouinite", null)],
      [unit("120660303", "Aghouinite", null)],
    );
    expect(rows[0]!.evidence.populationRatio).toBeNull();
  });
});
