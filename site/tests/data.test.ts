import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dataset paths the build reads and the download page offers.
 *
 * A published level is either one file or a directory of files, since the commune figures
 * of a census are written one file per région, and a reader written for one shape breaks
 * silently on the other until someone runs the whole build. This walks the source for
 * every literal data/v1 path and asks the disk for it exactly as written: a reader that
 * names a file reads a file, a reader that names a level names its directory. The API
 * build writes a few of the offered paths itself, and those are taken from its source.
 */
const ROOTS = ["site/scripts", "site/src", "api/src", "pipeline/src"];
/** A path in quotes with nothing interpolated into it. */
const PATHS = /"(data\/v1\/[^"$]*)"/g;
const EMITTED = /put\("\/(data\/v1\/[^"$]*)"/g;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|astro)$/.test(path) ? [path] : [];
  });

const files = ROOTS.flatMap(sources);
const mentions = files.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(PATHS)].map((m) => ({ file, path: m[1]! })),
);
const emitted = new Set(
  files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(EMITTED)].map((m) => m[1]!)),
);

describe("the data paths the site and API name", () => {
  it("has more than a handful to check", () => {
    expect(mentions.length).toBeGreaterThan(20);
    expect(emitted.size).toBeGreaterThan(0);
  });

  it("finds every one of them", () => {
    const missing = mentions.filter((m) => !existsSync(m.path) && !emitted.has(m.path));
    expect(missing.map((m) => `${m.file} names ${m.path}`)).toEqual([]);
  });
});
