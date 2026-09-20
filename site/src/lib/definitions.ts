/**
 * HCP's own definitions, read from the dataset at build time.
 *
 * The 2024 workbooks define their concepts on a sheet of their own, and the pipeline
 * publishes them under `definitions` in each fields file. The glossary names the term it
 * wants and takes HCP's wording from here, so the page and the data can't drift apart.
 */
import { readFileSync } from "node:fs";
import { termKey } from "../../../pipeline/src/lib/terms.ts";

export interface Definition {
  term: string;
  body: string;
}

const read = (path: string) =>
  (JSON.parse(readFileSync(path, "utf8")) as { definitions: Definition[] }).definitions;

const index = new Map<string, Definition>();
for (const d of [...read("data/v1/indicators/fields.json"), ...read("data/v1/housing/fields.json")]) {
  index.set(termKey(d.term), d);
}

/** What HCP says a term means. A term it doesn't define stops the build. */
export function hcpDefinition(term: string): Definition {
  const found = index.get(termKey(term));
  if (!found) throw new Error(`HCP's workbooks define no "${term}"`);
  return found;
}
