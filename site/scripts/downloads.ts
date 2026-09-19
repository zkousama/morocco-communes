/**
 * The download list, built from the files that actually exist under data/v1 with their
 * real sizes. A file named here that is missing fails the build, which is how a link to
 * data/v1/crosswalk/crosswalk.json — a path that never existed — stays gone.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { buildGeometry, outlineCollections } from "../../api/src/emit/geometry.ts";

interface Group {
  key: string;
  licence: "hcp" | "odbl";
  /** `bytes` is set for a file the API build writes rather than one committed under data/v1. */
  files: { label: string; path: string; bytes?: number }[];
}

const level = async (name: string) => JSON.parse(await readFile(`data/v1/attributes/${name}.json`, "utf8")) as never[];
const geometry = await buildGeometry("data/v1", {
  communes: await level("communes"),
  provinces: await level("provinces"),
  regions: await level("regions"),
  arrondissements: await level("arrondissements"),
});
const outlines = outlineCollections(geometry);

const regions = JSON.parse(await readFile("data/v1/attributes/regions.json", "utf8")) as {
  code: string;
  name: { fr: string };
}[];

// Ordered so the narrow groups pair up on the two-column grid and the full-width
// boundaries row does not leave a hole beside the one before it.
const GROUPS: Group[] = [
  {
    key: "dlCommunes",
    // Area, density and the point inside each commune come from the boundaries.
    licence: "odbl",
    files: [
      { label: "JSON", path: "data/v1/attributes/communes.json" },
      { label: "CSV", path: "data/v1/attributes/communes.csv" },
    ],
  },
  {
    key: "dlRegions",
    licence: "hcp",
    files: [
      { label: "JSON", path: "data/v1/attributes/regions.json" },
      { label: "CSV", path: "data/v1/attributes/regions.csv" },
    ],
  },
  {
    key: "dlProvinces",
    licence: "hcp",
    files: [
      { label: "JSON", path: "data/v1/attributes/provinces.json" },
      { label: "CSV", path: "data/v1/attributes/provinces.csv" },
    ],
  },
  {
    key: "dlCercles",
    licence: "hcp",
    files: [
      { label: "JSON", path: "data/v1/attributes/cercles.json" },
      { label: "CSV", path: "data/v1/attributes/cercles.csv" },
    ],
  },
  {
    key: "dlArrondissements",
    licence: "hcp",
    files: [
      { label: "JSON", path: "data/v1/attributes/arrondissements.json" },
      { label: "CSV", path: "data/v1/attributes/arrondissements.csv" },
    ],
  },
  {
    key: "dlCrosswalk",
    licence: "hcp",
    files: [
      { label: "JSON", path: "data/v1/crosswalk/2014-2024.json" },
      { label: "CSV", path: "data/v1/crosswalk/2014-2024.csv" },
    ],
  },
  {
    key: "dlIndicators",
    licence: "hcp",
    files: [
      { label: "people.csv", path: "data/v1/indicators/people.csv" },
      { label: "households.csv", path: "data/v1/indicators/households.csv" },
      { label: "communes.json", path: "data/v1/indicators/communes.json" },
      { label: "provinces.json", path: "data/v1/indicators/provinces.json" },
      { label: "regions.json", path: "data/v1/indicators/regions.json" },
      { label: "fields.json", path: "data/v1/indicators/fields.json" },
    ],
  },
  {
    key: "dlBoundaries",
    licence: "odbl",
    // One file per région, labelled by the région it holds rather than by its code.
    files: regions.map((r) => ({ label: r.name.fr, path: `data/v1/geometry/${r.code}.topojson` })),
  },
  {
    key: "dlBoundariesGeojson",
    licence: "odbl",
    // Built from the TopoJSON by the API build, by the same function, so its size is known here.
    files: regions.map((r) => {
      const collection = geometry.regions.get(r.code);
      if (!collection) throw new Error(`no GeoJSON is built for région ${r.code}`);
      return {
        label: r.name.fr,
        path: `data/v1/geometry/${r.code}.geojson`,
        bytes: Buffer.byteLength(JSON.stringify(collection)),
      };
    }),
  },
  {
    key: "dlOutlines",
    licence: "odbl",
    files: [
      { label: "provinces", path: "data/v1/geometry/provinces.geojson", bytes: Buffer.byteLength(JSON.stringify(outlines.provinces)) },
      { label: "régions", path: "data/v1/geometry/regions.geojson", bytes: Buffer.byteLength(JSON.stringify(outlines.regions)) },
      {
        label: "arrondissements",
        path: "data/v1/geometry/arrondissements.geojson",
        bytes: Buffer.byteLength(JSON.stringify(outlines.arrondissements)),
      },
    ],
  },
  { key: "dlSources", licence: "hcp", files: [{ label: "JSON", path: "data/v1/sources.json" }] },
];

const missing: string[] = [];
const groups = [];
for (const group of GROUPS) {
  const files = [];
  for (const file of group.files) {
    try {
      const bytes = file.bytes ?? (await stat(file.path)).size;
      files.push({ label: file.label, href: `/${file.path}`, bytes });
    } catch {
      missing.push(file.path);
    }
  }
  groups.push({ key: group.key, licence: group.licence, files });
}
if (missing.length > 0) {
  throw new Error(`the download list names files that do not exist:\n  ${missing.join("\n  ")}`);
}

await mkdir("site/src/generated", { recursive: true });
await writeFile(
  "site/src/generated/downloads.ts",
  `// Generated by site/scripts/downloads.ts from data/v1. Do not edit.
export const downloads = ${JSON.stringify(groups, null, 2)} as const;
`,
);
console.log(`downloads: ${groups.reduce((n, g) => n + g.files.length, 0)} files in ${groups.length} groups`);
