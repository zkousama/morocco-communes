/**
 * Which communes the API has a neighbourhoods file for, and the postcodes Poste Maroc lists
 * under each, from the same table the API's files are written from. Read at build time from
 * the files the search uses.
 */
import { readFileSync } from "node:fs";
import type { Neighbourhood } from "../../../api/src/lib/neighbourhoods.ts";
import { neighbourhoodTable, postcodesByCommune, type PostcodeRow } from "../../../api/src/lib/neighbourhoodTable.ts";
import { arrondissementOf } from "./places";

const places = (JSON.parse(readFileSync("api/data/neighbourhoods.json", "utf8")) as { places: Neighbourhood[] }).places;
const postcodeRows = (JSON.parse(readFileSync("api/data/postcodes.json", "utf8")) as { postcodes: PostcodeRow[] }).postcodes;

const named = new Set(neighbourhoodTable(places, postcodeRows, (code) => arrondissementOf.get(code)?.communeCode ?? code).map((row) => row.commune));
const postcodes = postcodesByCommune(postcodeRows);

/** Whether a commune has a neighbourhoods file: a name in it, or a postcode. */
export const hasNeighbourhoods = (communeCode: string): boolean => named.has(communeCode) || postcodes.has(communeCode);

/** A commune's postcodes, in order. */
export const postcodesOf = (communeCode: string): string[] => postcodes.get(communeCode) ?? [];

/** The villages and hamlets OpenStreetMap maps inside a town, by name, in its arrondissements too. */
export const villagesOf = (communeCode: string): string[] =>
  places
    .filter((p) => p[3] === "village" && (arrondissementOf.get(p[2])?.communeCode ?? p[2]) === communeCode)
    .map((p) => p[0] || p[1])
    .sort((a, b) => a.localeCompare(b, "fr"));
