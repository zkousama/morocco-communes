import { fetchAll, sha256 } from "./fetch.ts";
import { parseHcp2024 } from "./sources/hcp2024.ts";
import { parseHcp2014 } from "./sources/hcp2014.ts";
import { buildHierarchy } from "./build/hierarchy.ts";
import { assertDataset } from "./validate/assertions.ts";
import { crosswalkInputs, toRecords } from "./emit/records.ts";
import { writeJson } from "./emit/json.ts";
import { writeCsv } from "./emit/csv.ts";
import { fetchRegion } from "./sources/overpass.ts";
import { joinOsm, type OsmFeature } from "./build/osmJoin.ts";
import { writeGeometry } from "./emit/topojson.ts";
import { buildCrosswalk } from "./build/crosswalk.ts";
import { writeCrosswalk } from "./emit/crosswalk.ts";
import { buildSources, checkSources, retrievedAt, writeSources } from "./emit/sources.ts";

const OUT = "data/v1/attributes";
const DATASET_OUT = "data/v1";
const GEOMETRY_OUT = "data/v1/geometry";
const CROSSWALK_OUT = "data/v1/crosswalk";

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

const records = toRecords(hierarchy, units2014, osm, crosswalkByCode);
await writeJson(records, OUT);
await writeCsv(records, OUT);
await writeCrosswalk(rows, CROSSWALK_OUT);

const nameByCode = new Map(records.communes.map((c) => [c.codeDigits, c.name.fr]));
await writeGeometry(byRegion, nameByCode, GEOMETRY_OUT);

// Provenance is the dataset's whole argument, so a build that cannot say which snapshot
// it read refuses to publish rather than shipping a null vintage under a README that
// claims the sources are pinned.
const digests = Object.fromEntries([...sources].map(([id, bytes]) => [id, sha256(bytes)]));
const sourcesDoc = buildSources(digests, await retrievedAt(".cache"), osmFetchedAt);
const sourceProblems = checkSources(sourcesDoc);
if (sourceProblems.length > 0) {
  throw new Error(`the dataset cannot account for its sources:\n  ${sourceProblems.join("\n  ")}`);
}
await writeSources(sourcesDoc, DATASET_OUT);

console.log(
  `wrote ${records.communes.length} communes, ${records.arrondissements.length} arrondissements to ${OUT}`,
);
