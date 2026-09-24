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

describe("the privacy page", () => {
  const pages = [
    "site/src/pages/docs/privacy.astro",
    "site/src/pages/fr/docs/privacy.astro",
  ].map((path) => readFileSync(path, "utf8"));

  it("carries the privacy page in both languages", () => {
    for (const page of pages) expect(page).toMatch(/90/);
  });

  /** What the pages call each column of a demand row, in English and in French. */
  const COLUMNS: Record<string, [en: string, fr: string]> = {
    day: ["the day", "le jour"],
    kind: ["5 kinds of row", "5 types de ligne"],
    text: ["what was asked for", "ce qui a été demandé"],
    code: ["what was asked for", "ce qui a été demandé"],
    name: ["a tool an assistant calls", "un outil qu’un assistant appelle"],
    results: ["how many results a search showed", "le nombre de résultats qu’une recherche a affichés"],
    named: ["a place’s name or code", "le nom ou le code d’un lieu"],
    locale: ["the page’s language", "la langue de la page"],
    country: ["the country", "le pays"],
    via: ["“browser” for the site’s own search box", "« browser » pour la recherche du site"],
    via_site: ["which class of site sent the visitor", "la classe du site qui a envoyé le visiteur"],
    client: ["the name an MCP client gives itself", "le nom que se donne un client MCP"],
    bot: ["looks like a crawler’s", "ressemble à celui d’un robot"],
    dataset: ["the version of the dataset", "la version du jeu de données"],
  };

  it("names every column a demand row holds, in both languages", () => {
    const table = /CREATE TABLE IF NOT EXISTS events \(([^;]*)\);/.exec(readFileSync("migrations/0001_demand.sql", "utf8"))?.[1] ?? "";
    const columns = table.split("\n").map((line) => line.trim().split(" ")[0]).filter((word) => word !== undefined && word !== "");
    expect(Object.keys(COLUMNS).sort()).toEqual(columns.sort());
    const [en, fr] = pages.map((page) => page.replace(/\s+/g, " "));
    for (const [column, [english, french]] of Object.entries(COLUMNS)) {
      expect(en, column).toContain(english);
      expect(fr, column).toContain(french);
    }
  });

  // The retention windows and the scrub's own thresholds, pinned so a change to either
  // store's numbers is felt here too, not just read back from the code by whoever changes it.
  it("states the numbers the code and the config actually use", () => {
    for (const page of pages) {
      expect(page).toMatch(/64/); // demand.ts: MAX_CHARACTERS
      expect(page).toMatch(/6/); // demand.ts: the word and digit thresholds
      expect(page).toMatch(/90/); // workers/rollup: KEEP
      expect(page).toMatch(/3/); // sql.ts: the search's keep-count, and wrangler.toml's 3 months
    }
  });
});
