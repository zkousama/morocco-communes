import { fetchAll } from "./fetch.ts";
import { parseHcp2024 } from "./sources/hcp2024.ts";
import { parseHcp2014 } from "./sources/hcp2014.ts";
import { buildHierarchy } from "./build/hierarchy.ts";
import { assertDataset } from "./validate/assertions.ts";
import { toRecords } from "./emit/records.ts";
import { writeJson } from "./emit/json.ts";
import { writeCsv } from "./emit/csv.ts";

const OUT = "data/v1/attributes";

const sources = await fetchAll(".cache");
const hierarchy = buildHierarchy(parseHcp2024(sources.get("hcp-2024")!));
const units2014 = parseHcp2014(sources.get("hcp-2014")!);

assertDataset(hierarchy, units2014);

const records = toRecords(hierarchy, units2014);
await writeJson(records, OUT);
await writeCsv(records, OUT);

console.log(
  `wrote ${records.communes.length} communes, ${records.arrondissements.length} arrondissements to ${OUT}`,
);
