import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCrosswalk } from "../../src/emit/crosswalk.ts";
import type { CrosswalkRow } from "../../src/build/crosswalk.ts";

const row = (code2024: string, name: string): CrosswalkRow => ({
  code2024,
  codeDigits2024: code2024.replace(/\D/g, "").padStart(9, "0"),
  code2014: "01.051.05.01",
  name2024: name,
  name2014: name,
  nameAr2024: "",
  nameAr2014: "",
  method: "exact_name_in_province",
  evidence: {
    province: "01051",
    normalisedNameMatch: true,
    candidatesInProvince: 1,
    population2024: 10000,
    population2014: 9000,
    populationRatio: 1.1111,
  },
});

describe("writeCrosswalk", () => {
  it("writes both formats, sorted by the 2024 code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crosswalk-"));
    await writeCrosswalk([row("01.051.11.03", "Second"), row("01.051.11.01", "First")], dir);

    const json = JSON.parse(await readFile(join(dir, "2014-2024.json"), "utf8")) as CrosswalkRow[];
    expect(json.map((r) => r.code2024)).toEqual(["01.051.11.01", "01.051.11.03"]);

    const csv = await readFile(join(dir, "2014-2024.csv"), "utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).trim().split("\n");
    expect(lines[0]).toBe(
      "code_2024,code_2014,name_2024,name_2014,name_ar_2024,name_ar_2014,method,normalised_name_match,candidates_in_province,population_2024,population_2014,population_ratio",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]!.startsWith("01.051.11.01,")).toBe(true);
  });

  it("quotes a name containing a comma", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crosswalk-"));
    await writeCrosswalk([row("01.051.11.01", "Ait Kamra, Haut")], dir);
    const csv = await readFile(join(dir, "2014-2024.csv"), "utf8");
    expect(csv).toContain('"Ait Kamra, Haut"');
  });
});
