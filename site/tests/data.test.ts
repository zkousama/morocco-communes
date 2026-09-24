import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CHARACTERS, MAX_WORDS, TOO_MANY_DIGITS } from "../../api/src/worker/demand.ts";
import { KEEP_DAYS, TYPED } from "../../workers/rollup/src/sql.ts";

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

  // Read from the code, so changing a limit there fails here until both pages say the same.
  it("states the limits and the retention the code uses", () => {
    const months = /kept for (\d+) months/.exec(readFileSync("wrangler.toml", "utf8"))?.[1];
    expect(months).toBeDefined();
    const [en, fr] = pages.map((page) => page.replace(/\s+/g, " "));
    for (const phrase of [
      `cut to ${MAX_CHARACTERS} characters`,
      `more than ${MAX_WORDS} words`,
      `${TOO_MANY_DIGITS} digits or more`,
      `deleted after ${KEEP_DAYS} days`,
      `typed ${TYPED} or more times`,
      `so the ${TYPED} can all come from one visitor`,
      `rows for ${months} months`,
    ]) {
      expect(en).toContain(phrase);
    }
    for (const phrase of [
      `coupée à ${MAX_CHARACTERS} caractères`,
      `plus de ${MAX_WORDS} mots`,
      `${TOO_MANY_DIGITS} chiffres ou plus`,
      `supprimées après ${KEEP_DAYS} jours`,
      `tapés ${TYPED} fois ou plus`,
      `donc les ${TYPED} peuvent venir`,
      `lignes ${months} mois`,
    ]) {
      expect(fr).toContain(phrase);
    }
  });
});
