import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPARABLE_2014 } from "../../api/src/lib/indicators.ts";
import { CASES } from "../../evals/cases.ts";
import { readLevel } from "../../pipeline/src/lib/levels.ts";

/**
 * The counts the README and the docs write out in words, against the data they describe.
 *
 * A figure typed into prose doesn't move when the dataset does: the 2014 census's
 * comparable fields read 65 in 5 places for a release after the commuting workbook had
 * made them 73. Each count here is taken from the data and looked for in the text.
 */
const text = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const n = (value: number) => value.toLocaleString("en");

const communes = json<{ code: string }[]>("data/v1/attributes/communes.json");
const regions = json<unknown[]>("data/v1/attributes/regions.json");
const cercles = json<unknown[]>("data/v1/attributes/cercles.json");
const arrondissements = json<unknown[]>("data/v1/attributes/arrondissements.json");
const housing = ["national", "regions", "provinces", "cercles", "communes", "arrondissements", "urban-centres"].reduce(
  (sum, name) => sum + readLevel<unknown>("data/v1/housing", name).length,
  0,
);
const renumbered = json<unknown[]>("data/v1/crosswalk/2014-2024.json");

describe("the counts the prose states", () => {
  const readme = text("README.md");

  it("gives the README the dataset's own counts", () => {
    expect(readme).toContain(`${regions.length} régions`);
    expect(readme).toContain(`${n(communes.length)} communes`);
    expect(readme).toContain(`${cercles.length} cercles`);
    expect(readme).toContain(`${arrondissements.length} arrondissements`);
    expect(readme).toContain(`${n(renumbered.length)} communes`);
  });

  it("says how many 2014 fields read against 2024, wherever it's said", () => {
    const comparable = COMPARABLE_2014.size;
    expect(readme).toContain(`${comparable} fields ask what 2024 asks`);
    expect(text("data/v1/indicators/2014/README.md")).toContain(`${comparable} fields carry \`comparableTo\``);
    expect(text("packages/morocco-communes-py/README.md")).toContain(`asks ${comparable} of the 2014 questions`);
    expect(text("site/src/i18n/docs.ts")).toContain(`asks ${comparable} of the 2014 questions`);
    expect(text("site/src/i18n/docs.ts")).toContain(`pose ${comparable} des questions de 2014`);
  });

  it("counts the units with an urban housing stock", () => {
    expect(readme).toContain(`${housing} units`);
    expect(text("site/src/i18n/docs.ts")).toContain(`${housing} units have an urban stock`);
    expect(text("packages/morocco-communes-py/README.md")).toContain(`${housing} of them`);
  });

  it("counts the eval's questions", () => {
    expect(readme).toContain(`asks a model ${CASES.length} questions`);
    expect(text("evals/README.md")).toContain(`holds ${CASES.length} questions`);
  });
});
