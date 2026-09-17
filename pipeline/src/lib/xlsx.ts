import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Without this, "001511" is coerced to the number 1511 and the leading zeros
  // that every HCP code depends on are gone before this module sees the value.
  parseTagValue: false,
  isArray: (name) => name === "row" || name === "c" || name === "si",
});

/** Column letters to a zero-based index: A -> 0, AA -> 26. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1];
  if (!letters) throw new Error(`unreadable cell reference: ${ref}`);
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const record = node as Record<string, unknown>;
  if ("t" in record) return textOf(record["t"]);
  // Rich text: <si><r><t>Préfecture d'</t></r><r><t>Arrondissements…</t></r></si>.
  // The 2014 workbook stores seven strings this way, all of them Casablanca
  // préfectures d'arrondissements. Without this branch they resolve to "".
  if ("r" in record) return textOf(record["r"]);
  if ("#text" in record) return String(record["#text"]);
  return "";
}

export function readSheetRows(bytes: Uint8Array, sheetIndex = 1): (string | null)[][] {
  const files = unzipSync(bytes);

  const sharedStrings: string[] = [];
  const sstFile = files["xl/sharedStrings.xml"];
  if (sstFile) {
    const sst = parser.parse(strFromU8(sstFile))?.sst;
    for (const si of sst?.si ?? []) sharedStrings.push(textOf(si));
  }

  const sheetFile = files[`xl/worksheets/sheet${sheetIndex}.xml`];
  if (!sheetFile) throw new Error(`sheet${sheetIndex}.xml not present in workbook`);
  const sheetData = parser.parse(strFromU8(sheetFile))?.worksheet?.sheetData;

  const out: (string | null)[][] = [];
  for (const row of sheetData?.row ?? []) {
    const cells = new Map<number, string>();
    for (const cell of row.c ?? []) {
      const ref = cell["@r"];
      if (!ref) continue;
      const raw = cell.v;
      if (raw === undefined || raw === null) continue;
      const value = cell["@t"] === "s" ? sharedStrings[Number(raw)] ?? "" : String(raw);
      cells.set(columnIndex(ref), value);
    }
    const width = cells.size === 0 ? 0 : Math.max(...cells.keys()) + 1;
    const line: (string | null)[] = [];
    for (let i = 0; i < width; i++) line.push(cells.get(i) ?? null);
    out.push(line);
  }
  return out;
}
