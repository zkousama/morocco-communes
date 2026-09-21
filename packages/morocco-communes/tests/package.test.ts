import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FIELDS } from "../fields.ts";

const HERE = "packages/morocco-communes";
// dist/ is built by this test, so its types don't exist yet when the project is
// type-checked. The last test checks them the way a consumer would.
interface Unit {
  code: string;
  name: { fr: string; ar: string };
  type?: string;
  population?: number;
}
let pkg: Record<"regions" | "provinces" | "cercles" | "communes" | "arrondissements", Unit[]> & {
  version: string;
  getCommune(key: string): Unit | undefined;
  provincesOf(code: string): Unit[];
  cerclesOf(code: string): Unit[];
  communesOf(code: string): Unit[];
  arrondissementsOf(code: string): Unit[];
};

beforeAll(async () => {
  await promisify(execFile)("node", ["--experimental-strip-types", join(HERE, "build.ts")]);
  pkg = await import(resolve(HERE, "dist/index.js"));
}, 60_000);

const attributes = (name: string) =>
  JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as { code: string }[];

describe("the npm package", () => {
  it("holds every unit of the dataset", () => {
    for (const name of ["regions", "provinces", "cercles", "communes", "arrondissements"] as const) {
      expect(pkg[name].map((u) => u.code), name).toEqual(attributes(name).map((u) => u.code));
    }
  });

  it("writes the fields the docs list, in that order", () => {
    for (const name of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
      for (const unit of pkg[name]) expect(Object.keys(unit), `${name} ${unit.code}`).toEqual(FIELDS[name]);
    }
  });

  it("leaves out every field that comes from OpenStreetMap", () => {
    const text = readFileSync(join(HERE, "dist/communes.js"), "utf8");
    for (const key of ['"centroid"', '"bbox"', '"osm"', '"areaKm2"', '"density"', '"geometry"']) {
      expect(text).not.toContain(key);
    }
  });

  it("finds a commune by code or by slug", () => {
    expect(pkg.getCommune("01.511.01.0")?.name.fr).toBe("Tanger");
    expect(pkg.getCommune("tanger")?.code).toBe("01.511.01.0");
    expect(pkg.getCommune("nowhere")).toBeUndefined();
  });

  it("gives the answers the README and the docs page show", () => {
    expect(pkg.regions[0]?.name.fr).toBe("Tanger-Tétouan-Al Hoceima");
    expect(pkg.getCommune("tanger")).toMatchObject({ code: "01.511.01.0", type: "urban", population: 1275428 });
  });

  it("walks the hierarchy the way the API does", () => {
    expect(pkg.provincesOf("01")).toHaveLength(8);
    expect(pkg.communesOf("01.511")).toHaveLength(12);
    expect(pkg.communesOf("01")).toHaveLength(146);
    expect(pkg.cerclesOf("01.511").map((c) => c.code).sort()).toEqual(["01.511.03", "01.511.05"]);
    expect(pkg.arrondissementsOf("01.511.01.0")).toHaveLength(4);
  });

  it("shares its version with the dataset", () => {
    const sources = JSON.parse(readFileSync("data/v1/sources.json", "utf8")) as { datasetVersion: string };
    expect(pkg.version).toBe(sources.datasetVersion);
  });

  // Asynchronous, so the worker keeps answering the runner while tsc works; a blocking call
  // starves it, and under load the runner gives up on the worker before the check ends.
  it("type-checks for a consumer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "morocco-communes-"));
    const dist = resolve(HERE, "dist");
    writeFileSync(
      join(dir, "use.ts"),
      `import { communes, getCommune, provincesOf, type Commune } from "${dist}/index.js";
import regions from "${dist}/regions.js";
const first: Commune = communes[0]!;
const code: string = first.code;
const urban: boolean = getCommune("tanger")?.type === "urban";
const names: string[] = provincesOf(regions[0]!.code).map((p) => p.name.ar);
// @ts-expect-error a commune has no centroid in this package
first.centroid;
export { code, urban, names };
`,
    );
    await promisify(execFile)(
      "node_modules/.bin/tsc",
      ["--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", join(dir, "use.ts")],
    );
  }, 120_000);
});
