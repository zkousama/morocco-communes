/**
 * Builds the npm package from data/v1: every unit with its code, names, parents and
 * population, as plain ES modules with types.
 *
 * The 3 fields that come from OpenStreetMap (centroid, bbox and the OSM id) are left out,
 * and so are the boundaries. They're under ODbL, whose share-alike terms would then cover
 * the package; everything here is census data, attributed.
 *
 *   node --experimental-strip-types packages/morocco-communes/build.ts
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HERE = "packages/morocco-communes";
const OUT = join(HERE, "dist");

interface Name {
  fr: string;
  ar: string;
}
interface Row {
  code: string;
  name: Name;
  population: { "2024": { total: number }; "2014"?: { total: number | null } };
}

const read = async <T>(name: string) =>
  JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as T[];

const regions = (await read<Row>("regions")).map((r) => ({
  code: r.code,
  name: r.name,
  population: r.population["2024"].total,
}));
const provinces = (await read<Row & { type: string; regionCode: string }>("provinces")).map((p) => ({
  code: p.code,
  name: p.name,
  type: p.type,
  region: p.regionCode,
  population: p.population["2024"].total,
}));
const cercles = (await read<Row & { regionCode: string; provinceCode: string }>("cercles")).map((c) => ({
  code: c.code,
  name: c.name,
  region: c.regionCode,
  province: c.provinceCode,
  population: c.population["2024"].total,
}));
type CommuneRow = Row & {
  slug: string;
  type: string;
  parents: { region: string; province: string; cercle: string | null };
};
const communes = (await read<CommuneRow>("communes")).map((c) => ({
  code: c.code,
  slug: c.slug,
  name: c.name,
  type: c.type,
  region: c.parents.region,
  province: c.parents.province,
  cercle: c.parents.cercle,
  population: c.population["2024"].total,
  population2014: c.population["2014"]?.total ?? null,
}));
const arrondissements = (await read<Row & { communeCode: string }>("arrondissements")).map((a) => ({
  code: a.code,
  name: a.name,
  commune: a.communeCode,
  population: a.population["2024"].total,
}));

const sources = JSON.parse(await readFile("data/v1/sources.json", "utf8")) as {
  datasetVersion: string;
  sources: { id: string; licence: string }[];
};
const pkg = JSON.parse(await readFile(join(HERE, "package.json"), "utf8")) as { version: string };
if (pkg.version !== sources.datasetVersion) {
  // The package is the dataset, so they share a version number.
  throw new Error(`package.json is ${pkg.version} but the dataset is ${sources.datasetVersion}`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const HEADER = "// Generated from data/v1 of the Morocco communes dataset. Census data from the Haut-Commissariat au Plan.\n";
const lists = { regions, provinces, cercles, communes, arrondissements };
const TYPES: Record<keyof typeof lists, string> = {
  regions: "Region",
  provinces: "Province",
  cercles: "Cercle",
  communes: "Commune",
  arrondissements: "Arrondissement",
};

for (const [name, rows] of Object.entries(lists) as [keyof typeof lists, unknown[]][]) {
  await writeFile(join(OUT, `${name}.js`), `${HEADER}export default ${JSON.stringify(rows)};\n`);
  await writeFile(
    join(OUT, `${name}.d.ts`),
    `import type { ${TYPES[name]} } from "./types.js";\ndeclare const ${name}: readonly ${TYPES[name]}[];\nexport default ${name};\n`,
  );
}

await writeFile(join(OUT, "types.js"), "export {};\n");
await writeFile(
  join(OUT, "types.d.ts"),
  `/** A name as the census writes it, in French and in Arabic. */
export interface Name {
  fr: string;
  ar: string;
}

/** One of the 12 régions. \`population\` is the 2024 census total. */
export interface Region {
  code: string;
  name: Name;
  population: number;
}

/** A province or a préfecture. Préfectures d'arrondissements hold arrondissements, not communes. */
export interface Province {
  code: string;
  name: Name;
  type: "province" | "prefecture" | "prefecture_of_arrondissements";
  region: string;
  population: number;
}

/** A cercle, which groups rural communes inside a province. */
export interface Cercle {
  code: string;
  name: Name;
  region: string;
  province: string;
  population: number;
}

/** A commune. \`cercle\` is null for an urban commune, and \`population2014\` for the few the 2014 census can't be matched to. */
export interface Commune {
  code: string;
  slug: string;
  name: Name;
  type: "urban" | "rural";
  region: string;
  province: string;
  cercle: string | null;
  population: number;
  population2014: number | null;
}

/** An arrondissement, inside one of the 6 communes that have them. */
export interface Arrondissement {
  code: string;
  name: Name;
  commune: string;
  population: number;
}
`,
);

await writeFile(
  join(OUT, "index.js"),
  `${HEADER}import regions from "./regions.js";
import provinces from "./provinces.js";
import cercles from "./cercles.js";
import communes from "./communes.js";
import arrondissements from "./arrondissements.js";

export { regions, provinces, cercles, communes, arrondissements };

export const version = ${JSON.stringify(sources.datasetVersion)};

let byKey;

/** A commune by HCP code (01.511.01.0) or slug (tanger). */
export function getCommune(codeOrSlug) {
  if (!byKey) {
    byKey = new Map();
    for (const c of communes) {
      byKey.set(c.code, c);
      byKey.set(c.slug, c);
    }
  }
  return byKey.get(codeOrSlug);
}

/** The provinces and préfectures of a région. */
export function provincesOf(region) {
  return provinces.filter((p) => p.region === region);
}

/** The cercles of a province. */
export function cerclesOf(province) {
  return cercles.filter((c) => c.province === province);
}

/** The communes of a région, a province or a cercle, by its code. */
export function communesOf(code) {
  return communes.filter((c) => c.region === code || c.province === code || c.cercle === code);
}

/** The arrondissements of a commune. Empty for all but 6. */
export function arrondissementsOf(commune) {
  return arrondissements.filter((a) => a.commune === commune);
}
`,
);
await writeFile(
  join(OUT, "index.d.ts"),
  `import type { Arrondissement, Cercle, Commune, Province, Region } from "./types.js";

export type { Arrondissement, Cercle, Commune, Name, Province, Region } from "./types.js";

export declare const regions: readonly Region[];
export declare const provinces: readonly Province[];
export declare const cercles: readonly Cercle[];
export declare const communes: readonly Commune[];
export declare const arrondissements: readonly Arrondissement[];

/** The dataset version, which is also the package's. */
export declare const version: string;

/** A commune by HCP code (01.511.01.0) or slug (tanger). */
export declare function getCommune(codeOrSlug: string): Commune | undefined;
/** The provinces and préfectures of a région. */
export declare function provincesOf(region: string): Province[];
/** The cercles of a province. */
export declare function cerclesOf(province: string): Cercle[];
/** The communes of a région, a province or a cercle, by its code. */
export declare function communesOf(code: string): Commune[];
/** The arrondissements of a commune. Empty for all but 6. */
export declare function arrondissementsOf(commune: string): Arrondissement[];
`,
);

console.log(
  `morocco-communes ${pkg.version}: ${regions.length} régions, ${provinces.length} provinces, ` +
    `${cercles.length} cercles, ${communes.length} communes, ${arrondissements.length} arrondissements`,
);
