import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Without this, "001511" is coerced to the number 1511 and the leading zeros
  // that every HCP code depends on are gone before this module sees the value.
  parseTagValue: false,
  // Rich-text runs carry their separating space as xml:space="preserve", and the
  // default trim eats it, concatenating "Arrondissements" onto the name that
  // follows. The 2014 workbook uses xml:space 304 times. Callers trim their own
  // values, so nothing downstream depends on this trimming.
  trimValues: false,
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

/**
 * Unzipping a workbook is a third of a second for HCP's indicators file, and the parser
 * reads six sheets from it, so each workbook is unzipped once.
 */
const unzipped = new WeakMap<Uint8Array, ReturnType<typeof unzipSync>>();
const filesOf = (bytes: Uint8Array) => {
  let files = unzipped.get(bytes);
  if (!files) unzipped.set(bytes, (files = unzipSync(bytes)));
  return files;
};

const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(ENTITY, (_, hex: string, dec: string, name: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : NAMED[name.toLowerCase()]!,
  );

const ROW = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const REF = /\br="([A-Z]+)\d*"/;
const TYPE = /\bt="([^"]*)"/;
const VALUE = /<v>([\s\S]*?)<\/v>/;

/**
 * A sheet's cells, read with patterns rather than a DOM. A worksheet is one flat run of
 * <row> and <c> elements, and a general XML parser took over four seconds on each 14 MB
 * sheet of the indicators workbook. The shared strings, which carry rich text and
 * xml:space, still go through the parser.
 */
export function readSheetRows(bytes: Uint8Array, sheetIndex = 1): (string | null)[][] {
  const files = filesOf(bytes);

  const sharedStrings: string[] = [];
  const sstFile = files["xl/sharedStrings.xml"];
  if (sstFile) {
    const sst = parser.parse(strFromU8(sstFile))?.sst;
    for (const si of sst?.si ?? []) sharedStrings.push(textOf(si));
  }

  const sheetFile = files[`xl/worksheets/sheet${sheetIndex}.xml`];
  if (!sheetFile) throw new Error(`sheet${sheetIndex}.xml not present in workbook`);
  const xml = strFromU8(sheetFile);
  const start = xml.indexOf("<sheetData");
  const end = xml.indexOf("</sheetData>");
  const data = start < 0 ? "" : xml.slice(start, end < 0 ? undefined : end);

  const out: (string | null)[][] = [];
  for (const row of data.matchAll(ROW)) {
    const cells = new Map<number, string>();
    for (const cell of (row[1] ?? "").matchAll(CELL)) {
      const attributes = cell[1]!;
      const ref = REF.exec(attributes)?.[1];
      if (!ref) continue;
      const raw = VALUE.exec(cell[2] ?? "")?.[1];
      if (raw === undefined) continue;
      const value = TYPE.exec(attributes)?.[1] === "s" ? sharedStrings[Number(raw)] ?? "" : decode(raw);
      cells.set(columnIndex(ref), value);
    }
    const width = cells.size === 0 ? 0 : Math.max(...cells.keys()) + 1;
    const line: (string | null)[] = [];
    for (let i = 0; i < width; i++) line.push(cells.get(i) ?? null);
    out.push(line);
  }
  return out;
}
