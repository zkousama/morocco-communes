import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATASET_VERSION, SOURCES } from "../sources/registry.ts";

export interface FileSource {
  id: string;
  url: string;
  licence: string;
  sha256: string | null;
  retrievedAt: string | null;
}

export interface OsmSource {
  id: "osm";
  via: string;
  licence: string;
  attribution: string;
  /**
   * A range, not an instant. The boundaries come from twelve separate Overpass queries,
   * and Overpass rate-limits hard enough that they cannot all be answered at once, so
   * the twelve régions are snapshots of OSM taken minutes to hours apart. Reporting a
   * single timestamp would imply a consistency the data does not have.
   */
  snapshot: { earliest: string | null; latest: string | null; regions: number };
}

export interface SourcesDocument {
  datasetVersion: string;
  sources: (FileSource | OsmSource)[];
}

const OSM_LICENCE = "ODbL-1.0";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors, opendatacommons.org/licenses/odbl/1-0/";

export function buildSources(
  digests: Record<string, string>,
  retrievedAt: Map<string, string | null>,
  osmFetchedAt: (string | null)[],
): SourcesDocument {
  const known = osmFetchedAt.filter((t): t is string => t !== null).sort();
  return {
    datasetVersion: DATASET_VERSION,
    sources: [
      ...SOURCES.map((s) => ({
        id: s.id,
        url: s.url,
        licence: s.licence,
        sha256: digests[s.id] ?? null,
        retrievedAt: retrievedAt.get(s.id) ?? null,
      })),
      {
        id: "osm" as const,
        via: "Overpass API",
        licence: OSM_LICENCE,
        attribution: OSM_ATTRIBUTION,
        snapshot: {
          earliest: known[0] ?? null,
          latest: known[known.length - 1] ?? null,
          regions: osmFetchedAt.length,
        },
      },
    ],
  };
}

/**
 * Refuses to publish a dataset that cannot say where it came from. Every check names a
 * concrete expectation rather than testing that a list is non-empty, so an empty input
 * fails loudly instead of passing vacuously.
 */
export function checkSources(doc: SourcesDocument): string[] {
  const problems: string[] = [];
  const ids = doc.sources.map((s) => s.id);
  for (const s of SOURCES) {
    if (!ids.includes(s.id)) problems.push(`source ${s.id} is missing from sources.json`);
  }
  if (!ids.includes("osm")) problems.push("source osm is missing from sources.json");

  for (const s of doc.sources) {
    if ("snapshot" in s) {
      if (s.snapshot.regions !== 12) {
        problems.push(`osm snapshot covers ${s.snapshot.regions} régions, expected 12`);
      }
      if (s.snapshot.earliest === null || s.snapshot.latest === null) {
        problems.push("osm snapshot has no vintage");
      } else if (s.snapshot.earliest > s.snapshot.latest) {
        problems.push("osm snapshot range runs backwards");
      }
      continue;
    }
    if (s.sha256 === null) problems.push(`source ${s.id} is not pinned to a digest`);
    if (s.retrievedAt === null) problems.push(`source ${s.id} has no retrieval date`);
  }
  return problems;
}

/** The day each cached source file was written, or null if it is not on disk. */
export async function retrievedAt(cacheDir: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const source of SOURCES) {
    const path = join(cacheDir, source.filename);
    // Date only: the download clock time would imply a precision about the workbook's
    // own vintage that it does not carry. The digest is what identifies the file.
    out.set(source.id, existsSync(path) ? (await stat(path)).mtime.toISOString().slice(0, 10) : null);
  }
  return out;
}

export async function writeSources(doc: SourcesDocument, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sources.json"), `${JSON.stringify(doc, null, 2)}\n`);
}
