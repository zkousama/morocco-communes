/**
 * Douar names in Latin as the Ministry of National Education writes them, from its lists of
 * public schools on data.gov.ma, to api/data/douar-names.json. `pnpm api:douar-names`.
 *
 * Each list gives a school's name and address in both scripts, and its commune and province
 * by name. The commune is placed among the communes of its province, by name; a school whose
 * commune can't be placed is passed over. Then douarNames.ts takes each douar a school names.
 *
 * Before writing, the same runs with each school's commune swapped for another; a douar named
 * then is chance. Over 5% stops the script.
 */
import { readFile, writeFile } from "node:fs/promises";
import { nameDouars, type School } from "../src/lib/douarNames.ts";
import { normalise } from "../src/lib/normalise.ts";
import { keysMeet, latinKeys } from "../src/lib/translit.ts";
import { readSheetRows } from "../../pipeline/src/lib/xlsx.ts";
import { fetchFile } from "./fetchFile.ts";

const OUT = "api/data/douar-names.json";
const DATASET = "https://data.gov.ma/data/fr/dataset";
const LISTS = [
  `${DATASET}/4de8f7dc-c536-44e8-93a8-3efd2aca2c52/resource/f98bdb47-19a8-4f4d-8407-ae08b56305d5/download/etablissements_publics_primaire_juillet-2026.xlsx`,
  `${DATASET}/93f014c7-2b83-4fe9-b06b-48364bc8e8e8/resource/e13f4f7f-054e-4186-8197-bccf1bb251d2/download/etablissements_publics_collegial_juillet-2026.xlsx`,
  `${DATASET}/17805f1b-6d88-41d5-ace9-bf0e4007e51f/resource/3ce45071-bbb1-49b4-b8b3-00065c3a0f2e/download/etablissement_publics_qualifiant_juillet-2026.xlsx`,
];
const COLUMNS = ["NOM_ETABL", "NOM_ETABA", "AdresseL", "AdresseA", "LL_COM", "LL_PROV"] as const;
/** The most of the names that may be chance. */
const MAX_CHANCE = 0.05;

const read = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
const squash = (s: string) => normalise(s).replace(/ /g, "");

const communes = await read<{ code: string; name: { fr: string }; parents: { province: string } }[]>("data/v1/attributes/communes.json");
const provinces = await read<{ code: string; name: { fr: string } }[]>("data/v1/attributes/provinces.json");
const communeKeys = new Map(communes.map((c) => [c.code, latinKeys(c.name.fr)]));

// The list writes a province as "Province: Taroudannt" or "Préfecture: Skhirate- Tém", cut short.
const provinceMemo = new Map<string, string[]>();
const provincesNamed = (label: string) => {
  if (!provinceMemo.has(label)) {
    const name = label.replace(/^(Préfecture|Province)\s*:\s*/i, "");
    const short = squash(name).slice(0, 8);
    provinceMemo.set(label, provinces.filter((p) => squash(p.name.fr).startsWith(short) || keysMeet(latinKeys(p.name.fr), latinKeys(name))).map((p) => p.code));
  }
  return provinceMemo.get(label)!;
};
// And a commune as "Tafraout (Mun.)" or "Ait Baha (CR)": its name, among its province's communes.
const communeMemo = new Map<string, string | null>();
const communeNamed = (label: string, province: string) => {
  const memo = `${label}|${province}`;
  if (!communeMemo.has(memo)) {
    const name = label.replace(/\s*\(.*\)\s*$/, "");
    const codes = provincesNamed(province);
    const inside = communes.filter((c) => codes.includes(c.parents.province));
    const exact = inside.filter((c) => squash(c.name.fr) === squash(name));
    const wanted = latinKeys(name);
    const keyed = exact.length === 1 ? exact : inside.filter((c) => keysMeet(communeKeys.get(c.code)!, wanted));
    communeMemo.set(memo, keyed.length === 1 ? keyed[0]!.code : null);
  }
  return communeMemo.get(memo)!;
};

const schools: School[] = [];
const digests: string[] = [];
for (const url of LISTS) {
  const file = await fetchFile(url);
  digests.push(`${url.split("/").pop()} sha256 ${file.digest}`);
  const rows = readSheetRows(file.bytes, 1).map((r) => r.map((c) => String(c ?? "").trim()));
  const at = COLUMNS.map((name) => rows[0]!.indexOf(name));
  if (at.some((i) => i < 0)) throw new Error(`${url.split("/").pop()} has no ${COLUMNS.filter((_, i) => at[i]! < 0).join(", ")} column`);
  const [nameFr, nameAr, addressFr, addressAr, commune, province] = at as [number, number, number, number, number, number];
  for (const r of rows.slice(1)) {
    schools.push({
      name: { fr: r[nameFr]!, ar: r[nameAr]! },
      address: { fr: r[addressFr]!, ar: r[addressAr]! },
      commune: communeNamed(r[commune]!, r[province]!),
    });
  }
}

const douarsIn = new Map<string, { code: string; name: { ar: string } }[]>();
for (let r = 1; r <= 12; r++) {
  for (const d of await read<{ code: string; communeCode: string; name: { ar: string } }[]>(`data/v1/douars/${String(r).padStart(2, "0")}.json`)) {
    douarsIn.set(d.communeCode, [...(douarsIn.get(d.communeCode) ?? []), d]);
  }
}
const named = nameDouars(schools, douarsIn);
const bySize = [...douarsIn].sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1)).map(([code]) => code);
const swap = new Map(bySize.map((code, i) => [code, bySize[(i + 7) % bySize.length]!]));
const decoys = nameDouars(schools, douarsIn, (code) => swap.get(code) ?? code);
const chance = decoys.size / Math.max(named.size, 1);
const placed = schools.filter((s) => s.commune).length;
console.log(
  `douar-names: ${schools.length} schools, ${placed} placed in a commune; ${named.size} douars named; ` +
    `${decoys.size} with the commune swapped, so about ${(chance * 100).toFixed(1)}% are chance`,
);
if (chance > MAX_CHANCE) throw new Error(`more than ${MAX_CHANCE * 100}% of the names would be chance; nothing written`);

await writeFile(
  OUT,
  `${JSON.stringify({
    source: `Ministère de l'Éducation nationale, du Préscolaire et des Sports, lists of public schools, July 2026, data.gov.ma, ODbL: ${digests.join("; ")}`,
    chance: Math.round(chance * 1000) / 1000,
    names: [...named].sort(([a], [b]) => (a < b ? -1 : 1)),
  })}\n`,
);
console.log(`douar-names: wrote ${named.size} to ${OUT}`);
