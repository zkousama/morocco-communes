import { fetchAll } from "./fetch.ts";
import { parseHcp2024 } from "./sources/hcp2024.ts";
import { parseHcp2014 } from "./sources/hcp2014.ts";
import { buildHierarchy } from "./build/hierarchy.ts";
import { assertDataset } from "./validate/assertions.ts";
import { toRecords } from "./emit/records.ts";
import { writeJson } from "./emit/json.ts";
import { writeCsv } from "./emit/csv.ts";
import { fetchRegion } from "./sources/overpass.ts";
import { joinOsm, type OsmFeature } from "./build/osmJoin.ts";
import { findAnomalies, writeGeometry } from "./emit/topojson.ts";

const OUT = "data/v1/attributes";
const GEOMETRY_OUT = "data/v1/geometry";

const sources = await fetchAll(".cache");
const hierarchy = buildHierarchy(parseHcp2024(sources.get("hcp-2024")!));
const units2014 = parseHcp2014(sources.get("hcp-2014")!);

const knownCodes = new Set(hierarchy.communes.map((c) => c.codeDigits));
const osm = new Map<string, OsmFeature>();
const byRegion = new Map<string, OsmFeature[]>();
let unmatchedTotal = 0;
let rejectedTotal = 0;

for (const region of hierarchy.regions) {
  const response = await fetchRegion(region.code, ".cache");
  const { features, unmatched, rejected } = joinOsm(response.elements, knownCodes);
  unmatchedTotal += unmatched.length;
  rejectedTotal += rejected.length;
  for (const r of rejected) console.warn(`  rejected relation ${r.relationId} (${r.ref}): ${r.reason}`);
  byRegion.set(region.code, [...features.values()]);
  for (const [code, f] of features) osm.set(code, f);
}
const anomalies = findAnomalies([...osm.values()]);
for (const a of anomalies) console.warn(`  anomaly ${a.kind} on ${a.code}: ${a.detail}`);
if (anomalies.length > 0) {
  throw new Error(`${anomalies.length} geometry anomalies; refusing to publish boundaries that are silently malformed`);
}
console.log(`geometry: ${osm.size} communes, ${unmatchedTotal} unmatched relations, ${rejectedTotal} rejected, 0 anomalies`);

assertDataset(hierarchy, units2014, osm);

const records = toRecords(hierarchy, units2014, osm);
await writeJson(records, OUT);
await writeCsv(records, OUT);

const nameByCode = new Map(records.communes.map((c) => [c.codeDigits, c.name.fr]));
await writeGeometry(byRegion, nameByCode, GEOMETRY_OUT);

console.log(
  `wrote ${records.communes.length} communes, ${records.arrondissements.length} arrondissements to ${OUT}`,
);
