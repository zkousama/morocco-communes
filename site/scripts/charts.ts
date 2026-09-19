/**
 * Chart data, computed from the published dataset so every figure on the page is one the
 * API would return. Nothing here is rounded for effect or carried over from a previous
 * build — the script reads data/v1 and writes the numbers it finds.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ATTR = "data/v1/attributes";

interface Commune {
  areaKm2: number | null;
  parents: { region: string };
  type: "urban" | "rural";
  population: {
    "2024": { total: number | null };
    "2014": { total: number | null } | null;
    change: { pct: number; basis: string } | null;
  };
}
interface Region {
  code: string;
  name: { fr: string };
}

const read = async <T>(name: string) => JSON.parse(await readFile(`${ATTR}/${name}.json`, "utf8")) as T;
const communes = await read<Commune[]>("communes");
const regions = await read<Region[]>("regions");

/* 1. Where the population moved between the two censuses. -------------------- */

const change = regions
  .map((region) => {
    let before = 0;
    let after = 0;
    for (const c of communes) {
      if (c.parents.region !== region.code) continue;
      if (c.population["2024"].total !== null) after += c.population["2024"].total;
      if (c.population["2014"]?.total != null) before += c.population["2014"].total;
    }
    return {
      code: region.code,
      name: region.name.fr,
      before,
      after,
      pct: Number((((after - before) / before) * 100).toFixed(1)),
    };
  })
  .sort((a, b) => b.pct - a.pct);

/* 2. How big a commune actually is. ------------------------------------------ */

const EDGES = [0, 2000, 5000, 10000, 25000, 50000, 100000, Infinity];
// Language-neutral on purpose: these read the same in every locale the site has.
const LABELS = ["<2k", "2–5k", "5–10k", "10–25k", "25–50k", "50–100k", "100k+"];
const sizes = EDGES.slice(0, -1).map((lo, i) => {
  const hi = EDGES[i + 1]!;
  return {
    label: LABELS[i]!,
    count: communes.filter((c) => {
      const t = c.population["2024"].total;
      return t !== null && t >= lo && t < hi;
    }).length,
  };
});

/* 3. Whether the crosswalk holds up. ----------------------------------------- */

/**
 * The 207 renumbered communes got their 2014 figure by a name-and-exhaustion match
 * rather than by a code that stayed put. If those matches were wrong, their implied
 * growth would scatter differently from the 1,286 communes whose code never changed.
 * This is the comparison, so a reader can judge the reconciliation instead of trusting it.
 */
const quantiles = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;
  return { p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p90: at(0.9) };
};

// The label lives in site/src/i18n/ui.ts, keyed on the basis, so it is translated like
// everything else the reader sees.
const BASES = ["exact_code", "crosswalk"] as const;
const spread = BASES.map((basis) => {
  const pct = communes
    .filter((c) => c.population.change?.basis === basis)
    .map((c) => c.population.change!.pct);
  return { basis, count: pct.length, ...quantiles(pct) };
});

/* 4. Urban communes are a small minority everywhere. ------------------------- */

const urban = regions
  .map((region) => {
    const inRegion = communes.filter((c) => c.parents.region === region.code);
    const u = inRegion.filter((c) => c.type === "urban").length;
    return { code: region.code, name: region.name.fr, urban: u, total: inRegion.length };
  })
  .sort((a, b) => b.urban / b.total - a.urban / a.total);

/* 5. Where people live: how little land holds half of them. Densest first, since that
   finds the least land that does; taking the most populous first would count the wide
   rural edges of big communes. That way, half the people live on 0.83% of the land,
   and 1.37% without the 2 southern régions, where densest first gives 0.45% and 0.73%. */

const byDensity = [...communes].sort((a, b) => (b.density ?? -1) - (a.density ?? -1));
const people = communes.reduce((s, c) => s + (c.population["2024"].total ?? 0), 0);
const land = communes.reduce((s, c) => s + (c.areaKm2 ?? 0), 0);
let held = 0;
let count = 0;
while (held < people / 2) held += byDensity[count++]!.population["2024"].total ?? 0;
const half = {
  communes: count,
  total: communes.length,
  peopleShare: Number(((held / people) * 100).toFixed(1)),
  landShare: Number(((byDensity.slice(0, count).reduce((s, c) => s + (c.areaKm2 ?? 0), 0) / land) * 100).toFixed(2)),
};

/* 6. What the two censuses found, on the figures both of them asked the same way. ---- */

interface Census {
  people: { total: { all: Record<string, Record<string, number | null>> } };
  households: { total: Record<string, Record<string, number | null>> };
}
const now = JSON.parse(await readFile("data/v1/indicators/national.json", "utf8")) as Census;
const before2014 = JSON.parse(await readFile("data/v1/indicators/2014/national.json", "utf8")) as Census;

// Five rates everyone can read, each a percentage, each asked the same way at both
// censuses. The label for each is in site/src/i18n/ui.ts, keyed on `key`.
const SINCE: { key: string; of: "people" | "households"; topic: string; field: string }[] = [
  { key: "illiteracy", of: "people", topic: "illiteracy", field: "rate10Plus" },
  { key: "higher", of: "people", topic: "education", field: "higher" },
  { key: "unemployment", of: "people", topic: "labour", field: "unemploymentRate" },
  { key: "water", of: "households", topic: "amenities", field: "runningWater" },
  { key: "electricity", of: "households", topic: "amenities", field: "electricity" },
];
const figureOf = (census: Census, row: (typeof SINCE)[number]) => {
  const block = row.of === "people" ? census.people.total.all : census.households.total;
  const value = block[row.topic]?.[row.field];
  if (typeof value !== "number") throw new Error(`no national figure for ${row.topic}.${row.field}`);
  return value;
};
const since = SINCE.map((row) => ({
  key: row.key,
  before: figureOf(before2014, row),
  after: figureOf(now, row),
}));

/* 7. Which communes lost people, urban and rural apart. ---------------------- */

const shrinking = (["rural", "urban"] as const).map((type) => {
  const withBoth = communes.filter((c) => c.type === type && c.population.change);
  const before = withBoth.reduce((s, c) => s + c.population["2014"]!.total!, 0);
  const after = withBoth.reduce((s, c) => s + c.population["2024"].total!, 0);
  return {
    type,
    shrank: withBoth.filter((c) => c.population.change!.pct < 0).length,
    grew: withBoth.filter((c) => c.population.change!.pct >= 0).length,
    pct: Number((((after - before) / before) * 100).toFixed(1)),
  };
});

await mkdir("site/src/generated", { recursive: true });
await writeFile(
  "site/src/generated/charts.ts",
  `// Generated by site/scripts/charts.ts from data/v1/attributes. Do not edit.
export const change = ${JSON.stringify(change, null, 2)};

export const sizes = ${JSON.stringify(sizes, null, 2)};

export const spread = ${JSON.stringify(spread, null, 2)};

export const urban = ${JSON.stringify(urban, null, 2)};

export const half = ${JSON.stringify(half, null, 2)};

export const shrinking = ${JSON.stringify(shrinking, null, 2)};

export const since = ${JSON.stringify(since, null, 2)};
`,
);

console.log(
  `charts: ${change.length} régions, ${sizes.length} size buckets, ` +
    `${spread.map((s) => `${s.basis}=${s.count}`).join(" ")}`,
);
