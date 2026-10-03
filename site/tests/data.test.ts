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
    "site/src/pages/ar/docs/privacy.astro",
  ].map((path) => readFileSync(path, "utf8"));

  it("carries the privacy page in every language", () => {
    for (const page of pages) expect(page).toMatch(/90/);
  });

  /** What the pages call each column of a demand row, in English, French and Arabic. */
  const COLUMNS: Record<string, [en: string, fr: string, ar: string]> = {
    day: ["the day", "le jour", "باليوم"],
    kind: ["5 kinds of row", "5 types de ligne", "5 أنواع من الأسطر"],
    text: ["what was asked for", "ce qui a été demandé", "وبما طلب"],
    code: ["what was asked for", "ce qui a été demandé", "وبما طلب"],
    name: ["a tool an assistant calls", "un outil qu’un assistant appelle", "أداة يستدعيها مساعد ذكي"],
    results: ["how many results a search showed", "le nombre de résultats qu’une recherche a affichés", "وبعدد النتائج التي عرضها البحث"],
    named: ["a place’s name or code", "le nom ou le code d’un lieu", "اسم مكان أو رمزه"],
    locale: ["the page’s language", "la langue de la page", "وبلغة الصفحة"],
    country: ["the country", "le pays", "وبالبلد"],
    via: ["“browser” for the site’s own search box", "« browser » pour la recherche du site", "«browser» لخانة البحث"],
    via_site: ["which class of site sent the visitor", "la classe du site qui a envoyé le visiteur", "وصنف الموقع الذي جاء منه الزائر"],
    client: ["the name an MCP client gives itself", "le nom que se donne un client MCP", "الذي يطلقه عميل MCP على نفسه"],
    bot: ["looks like a crawler’s", "ressemble à celui d’un robot", "ما يرسله روبوت"],
    dataset: ["the version of the dataset", "la version du jeu de données", "وبإصدار مجموعة البيانات"],
  };

  it("names every column a demand row holds, in every language", () => {
    const table = /CREATE TABLE IF NOT EXISTS events \(([^;]*)\);/.exec(readFileSync("migrations/0001_demand.sql", "utf8"))?.[1] ?? "";
    const columns = table.split("\n").map((line) => line.trim().split(" ")[0]).filter((word) => word !== undefined && word !== "");
    expect(Object.keys(COLUMNS).sort()).toEqual(columns.sort());
    const [en, fr, ar] = pages.map((page) => page.replace(/\s+/g, " "));
    for (const [column, [english, french, arabic]] of Object.entries(COLUMNS)) {
      expect(en, column).toContain(english);
      expect(fr, column).toContain(french);
      expect(ar, column).toContain(arabic);
    }
  });

  // Read from the code, so changing a limit there fails here until every page says the same.
  it("states the limits and the retention the code uses", () => {
    const months = /kept for (\d+) months/.exec(readFileSync("wrangler.toml", "utf8"))?.[1];
    expect(months).toBeDefined();
    const [en, fr, ar] = pages.map((page) => page.replace(/\s+/g, " "));
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
    for (const phrase of [
      `ويقتطع عند ${MAX_CHARACTERS} حرفا`,
      `أكثر من ${MAX_WORDS} كلمات`,
      `${TOO_MANY_DIGITS} أرقام أو أكثر`,
      `بعد ${KEEP_DAYS} يوما`,
      `كتبت ${TYPED} مرات أو أكثر`,
      `المرات الـ${TYPED}`,
      `بهذه الأسطر ${months} أشهر`,
    ]) {
      expect(ar).toContain(phrase);
    }
  });
});
