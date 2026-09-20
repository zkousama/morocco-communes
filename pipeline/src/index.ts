import { fetchAll, sha256 } from "./fetch.ts";
import { parseHcp2024 } from "./sources/hcp2024.ts";
import { parseHcp2014 } from "./sources/hcp2014.ts";
import { buildHierarchy } from "./build/hierarchy.ts";
import { assertDataset, checkArrondissements } from "./validate/assertions.ts";
import { crosswalkInputs, toRecords } from "./emit/records.ts";
import { writeJson } from "./emit/json.ts";
import { writeCsv } from "./emit/csv.ts";
import { fetchArrondissements, fetchRegion } from "./sources/overpass.ts";
import { joinOsm, type OsmFeature } from "./build/osmJoin.ts";
import { writeArrondissementGeometry, writeGeometry } from "./emit/topojson.ts";
import { buildCrosswalk } from "./build/crosswalk.ts";
import { writeCrosswalk } from "./emit/crosswalk.ts";
import { buildSources, checkSources, retrievedAt, writeSources } from "./emit/sources.ts";
import { parseHcpIndicators } from "./sources/hcpIndicators.ts";
import { parseHcp2014Indicators } from "./sources/hcp2014Indicators.ts";
import { parseHcp2014Mobility, parseHcpCommute2024 } from "./sources/hcpMobility.ts";
import { parseHcpEstablishments } from "./sources/hcpEstablishments.ts";
import { joinCensus2014, joinCensus2024 } from "./sources/censusFields.ts";
import { buildIndicators } from "./build/indicators.ts";
import { buildIndicators2014 } from "./build/indicators2014.ts";
import { buildEconomy } from "./build/economy.ts";
import { checkIndicators } from "./validate/indicators.ts";
import { checkIndicators2014 } from "./validate/indicators2014.ts";
import { checkEconomy } from "./validate/economy.ts";
import { writeIndicators } from "./emit/indicators.ts";
import { toRecords2014, writeIndicators2014 } from "./emit/indicators2014.ts";
import { writeEconomy } from "./emit/economy.ts";
import { SOURCES } from "./sources/registry.ts";

const OUT = "data/v1/attributes";
const DATASET_OUT = "data/v1";
const GEOMETRY_OUT = "data/v1/geometry";
const CROSSWALK_OUT = "data/v1/crosswalk";
const INDICATORS_OUT = "data/v1/indicators";
const INDICATORS_2014_OUT = "data/v1/indicators/2014";
const ECONOMY_OUT = "data/v1/economy";

const sources = await fetchAll(".cache");
const hierarchy = buildHierarchy(parseHcp2024(sources.get("hcp-2024")!));
const units2014 = parseHcp2014(sources.get("hcp-2014")!);

const knownCodes = new Set(hierarchy.communes.map((c) => c.codeDigits));
const osm = new Map<string, OsmFeature>();
const byRegion = new Map<string, OsmFeature[]>();
let unmatchedTotal = 0;
let rejectedTotal = 0;
const osmFetchedAt: (string | null)[] = [];

for (const region of hierarchy.regions) {
  const snapshot = await fetchRegion(region.code, ".cache");
  osmFetchedAt.push(snapshot.fetchedAt);
  const { features, unmatched, rejected } = joinOsm(snapshot.elements, knownCodes);
  unmatchedTotal += unmatched.length;
  rejectedTotal += rejected.length;
  for (const r of rejected) console.warn(`  rejected relation ${r.relationId} (${r.ref}): ${r.reason}`);
  for (const u of unmatched) console.warn(`  unmatched relation ${u.relationId} carries ref ${u.ref}`);
  byRegion.set(region.code, [...features.values()]);
  for (const [code, f] of features) osm.set(code, f);
}
// Anomalies are checked inside assertDataset, not in this loop, so one malformed
// relation does not stop the loop above from finishing every other region, and every
// attribute failure below is collected into one list instead of stopping at the first.
console.log(`geometry: ${osm.size} communes, ${unmatchedTotal} unmatched relations, ${rejectedTotal} rejected`);

// The arrondissements come in one query of their own, at admin_level 10.
const arrondissementSnapshot = await fetchArrondissements(".cache");
const arrondissementJoin = joinOsm(
  arrondissementSnapshot.elements,
  new Set(hierarchy.arrondissements.map((a) => a.codeDigits)),
);
for (const r of arrondissementJoin.rejected) console.warn(`  rejected relation ${r.relationId} (${r.ref}): ${r.reason}`);
for (const u of arrondissementJoin.unmatched) console.warn(`  unmatched relation ${u.relationId} carries ref ${u.ref}`);
const arrondissementOsm = arrondissementJoin.features;
const arrondissementProblems = checkArrondissements(
  hierarchy.arrondissements,
  arrondissementOsm,
  osm,
  new Map(hierarchy.communes.map((c) => [c.code, c.codeDigits])),
);
if (arrondissementProblems.length > 0) {
  throw new Error(`the arrondissement boundaries don't account for their cities:\n  ${arrondissementProblems.join("\n  ")}`);
}
console.log(`geometry: ${arrondissementOsm.size} arrondissements`);

const { unresolved, claimed } = crosswalkInputs(hierarchy, units2014);
// Sorted, because Map iteration order would otherwise decide which unit a pass sees
// first, and the plan forbids the output depending on anything but the input.
const unclaimed = [...units2014.values()]
  .filter((u) => u.kind !== "arrondissement" && !claimed.has(u.codeDigits))
  .sort((a, b) => a.codeDigits.localeCompare(b.codeDigits));

const { rows, unmatched2024, unmatched2014 } = buildCrosswalk(unresolved, unclaimed);
for (const code of unmatched2024) console.warn(`  crosswalk could not place 2024 commune ${code}`);
for (const code of unmatched2014) console.warn(`  crosswalk could not place 2014 unit ${code}`);
console.log(`crosswalk: ${rows.length} rows, ${unmatched2024.length} unplaced 2024, ${unmatched2014.length} unplaced 2014`);

// The assertions on the crosswalk are guarded by `crosswalk.length > 0` so the
// attribute-only path still passes, which means a matcher returning nothing would
// check nothing at all and the build would ship 207 nulls under two READMEs claiming
// 1,503 filled. Refusing an incomplete reconciliation here closes that: zero rows
// means all 207 communes land in unmatched2024.
if (unmatched2024.length > 0 || unmatched2014.length > 0) {
  throw new Error(
    `crosswalk left ${unmatched2024.length} commune(s) and ${unmatched2014.length} 2014 unit(s) unplaced; ` +
      `refusing to publish a reconciliation that does not account for both sides`,
  );
}

const crosswalkByCode = new Map(rows.map((r) => [r.codeDigits2024, r]));

assertDataset(hierarchy, units2014, osm, rows);

const records = toRecords(hierarchy, units2014, osm, crosswalkByCode, arrondissementOsm);
await writeJson(records, OUT);
await writeCsv(records, OUT);
await writeCrosswalk(rows, CROSSWALK_OUT);

// HCP's indicators, joined to the units above by code. The population and household
// counts they repeat have to equal the population file's, unit for unit.
type Counted = { code: string; population: { "2024": { total: number | null; households: number | null } } };
const published = new Map(
  (Object.values(records) as Counted[][]).flat().map((u) => [u.code, { population: u.population["2024"].total, households: u.population["2024"].households }]),
);
// Each census comes in more than one workbook: the indicators, and commuting in its own.
// They list the same units in the same order, and are joined row by row before anything
// is placed on the dataset.
const indicators = buildIndicators(
  joinCensus2024(parseHcpIndicators(sources.get("hcp-2024-indicators")!), parseHcpCommute2024(sources.get("hcp-2024-commute")!)),
  records as never,
);
const indicatorProblems = checkIndicators(indicators, published);
if (indicatorProblems.length > 0) {
  throw new Error(`the indicators don't hold together:\n  ${indicatorProblems.slice(0, 40).join("\n  ")}${indicatorProblems.length > 40 ? `\n  and ${indicatorProblems.length - 40} more` : ""}`);
}
const indicatorSource = SOURCES.find((s) => s.id === "hcp-2024-indicators")!;
await writeIndicators(indicators, INDICATORS_OUT, { id: indicatorSource.id, url: indicatorSource.url });
console.log(`indicators: ${indicators.length} rows, ${indicators.filter((r) => r.level === "urbanCentre").length} of them urban centres`);

// The same indicators from the 2014 census, on the units the dataset publishes today.
// A unit HCP counted then and doesn't count now keeps no figures here; it is listed,
// with its reason, in the unplaced file beside them.
const rows2014 = joinCensus2014(
  parseHcp2014Indicators(sources.get("hcp-2014-indicators-people")!, sources.get("hcp-2014-indicators-households")!),
  parseHcp2014Mobility(sources.get("hcp-2014-mobility")!),
);
const population2014 = new Map(records.communes.map((c) => [c.code, c.population["2014"]]));
const placed2014 = buildIndicators2014(
  rows2014,
  indicators,
  new Map(rows.map((r) => [r.code2014.replace(/\D/g, ""), r.code2024])),
  new Map([...population2014].map(([code, prior]) => [code, prior?.total ?? null])),
);
for (const r of placed2014.renamed) console.log(`  ${r.code} is ${r.name2024} now and was ${r.name2014} in 2014; the population workbook agrees it is one place`);
const problems2014 = checkIndicators2014(
  placed2014.byCode,
  new Map(indicators.map((r) => [r.code ?? "", r.name.fr])),
  new Map([...population2014].map(([code, prior]) => [code, { population: prior?.total ?? null, households: prior?.households ?? null }])),
);
if (problems2014.length > 0) {
  throw new Error(`the 2014 indicators don't hold together:\n  ${problems2014.slice(0, 40).join("\n  ")}${problems2014.length > 40 ? `\n  and ${problems2014.length - 40} more` : ""}`);
}
const records2014 = toRecords2014(indicators, placed2014.byCode);
const people2014Source = SOURCES.find((s) => s.id === "hcp-2014-indicators-people")!;
const households2014Source = SOURCES.find((s) => s.id === "hcp-2014-indicators-households")!;
await writeIndicators2014(records2014, placed2014.unplaced, INDICATORS_2014_OUT, {
  people: { id: people2014Source.id, url: people2014Source.url },
  households: { id: households2014Source.id, url: households2014Source.url },
});
console.log(`indicators 2014: ${records2014.length} units carry figures, ${placed2014.unplaced.length} rows have no unit to land on`);

// The census's other count, of workplaces rather than people. It stops at the commune,
// and the six cities with arrondissements are counted through those instead.
const economy = buildEconomy(parseHcpEstablishments(sources.get("hcp-2024-establishments")!), indicators);
for (const u of economy.unplaced) console.warn(`  establishments row ${u.code} ${u.label}: ${u.reason}`);
const economyProblems = checkEconomy(
  economy.records,
  new Map(records.communes.map((c) => [c.code, c.parents.cercle])),
  indicators.filter((r) => r.code !== null).map((r) => ({ code: r.code!, level: r.level, name: r.name.fr })),
  new Set((records.arrondissements as { communeCode: string }[]).map((a) => a.communeCode)),
);
if (economyProblems.length > 0) {
  throw new Error(`the establishments don't hold together:\n  ${economyProblems.slice(0, 40).join("\n  ")}${economyProblems.length > 40 ? `\n  and ${economyProblems.length - 40} more` : ""}`);
}
const economySource = SOURCES.find((s) => s.id === "hcp-2024-establishments")!;
await writeEconomy(economy.records, economy.unplaced, ECONOMY_OUT, { id: economySource.id, url: economySource.url });
console.log(`establishments: ${economy.records.length} units carry figures, ${economy.unplaced.length} rows have no unit to land on`);

const nameByCode = new Map(records.communes.map((c) => [c.codeDigits, c.name.fr]));
await writeGeometry(byRegion, nameByCode, GEOMETRY_OUT);
// The records' names, with the "Arrondissement de" label taken off, as the communes' are.
const arrondissementNames = new Map(
  (records.arrondissements as { codeDigits: string; name: { fr: string } }[]).map((a) => [a.codeDigits, a.name.fr]),
);
await writeArrondissementGeometry([...arrondissementOsm.values()], arrondissementNames, GEOMETRY_OUT);

// Provenance is the dataset's whole argument, so a build that cannot say which snapshot
// it read refuses to publish rather than shipping a null vintage under a README that
// claims the sources are pinned.
const digests = Object.fromEntries([...sources].map(([id, bytes]) => [id, sha256(bytes)]));
const sourcesDoc = buildSources(digests, await retrievedAt(".cache"), osmFetchedAt, [arrondissementSnapshot.fetchedAt]);
const sourceProblems = checkSources(sourcesDoc);
if (sourceProblems.length > 0) {
  throw new Error(`the dataset cannot account for its sources:\n  ${sourceProblems.join("\n  ")}`);
}
await writeSources(sourcesDoc, DATASET_OUT);

console.log(
  `wrote ${records.communes.length} communes, ${records.arrondissements.length} arrondissements to ${OUT}`,
);
