/**
 * Puts a translated locale back into site/src/i18n/ui.ts.
 *
 *   pnpm site:apply <file.json>
 *
 * Reads the JSON reply, checks it against the English keys, and rewrites the `ary` block
 * and the `ary` line of LEVELS. Refuses on a missing key, an unknown key, or an empty
 * value, so a truncated or half-answered reply cannot land silently.
 */
import { readFile, writeFile } from "node:fs/promises";
import { LEVELS, ui } from "../src/i18n/ui.ts";

const partial = process.argv.includes("--partial");
const source = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!source) {
  console.error("usage: pnpm site:apply <file.json> [--partial]");
  process.exit(1);
}

const raw = await readFile(source, "utf8");
// Tolerate a fenced block, since that is what a chat reply usually arrives wrapped in.
const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

let parsed: Record<string, string>;
try {
  parsed = JSON.parse(text) as Record<string, string>;
} catch (error) {
  console.error(`that file is not JSON: ${(error as Error).message}`);
  process.exit(1);
}

const allKeys = [
  ...Object.keys(LEVELS.en).map((k) => `levels.${k}`),
  ...Object.keys(ui.en).map((k) => `ui.${k}`),
];
// A partial reply covers only the keys it names; a full one must cover all of them.
const expected = partial ? allKeys.filter((k) => k in parsed) : allKeys;

const problems: string[] = [];
if (partial && expected.length === 0) problems.push("the reply names none of the known keys");
for (const key of expected) {
  const value = parsed[key];
  if (value === undefined) problems.push(`missing: ${key}`);
  else if (typeof value !== "string") problems.push(`not a string: ${key}`);
  else if (value.trim() === "") problems.push(`empty: ${key}`);
}
for (const key of Object.keys(parsed)) {
  if (!allKeys.includes(key)) problems.push(`unknown key: ${key}`);
}

// Every number in the English has to survive into the translation, in the same order.
// Grouping is stripped before comparing: the separator legitimately differs by locale,
// so 3,852 in English is 3 852 in French and in Darija.
// Single digits are skipped: every language spells some of them out — the English "2
// distributions" is "jouj distributions" in Darija — and they are not what this guards.
// Populations, years, percentiles and counts are all two digits or more.
const numbersIn = (s: string) =>
  (s.match(/\d[\d\s.,\u202f\u00a0]*\d|\d/g) ?? [])
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length > 1);
for (const [key, english] of Object.entries(ui.en)) {
  if (!expected.includes(`ui.${key}`)) continue;
  const got = parsed[`ui.${key}`];
  if (typeof got !== "string") continue;
  const want = numbersIn(String(english));
  const have = numbersIn(got);
  if (want.join(",") !== have.join(",")) {
    problems.push(`numbers changed in ui.${key}: expected ${want.join(" ") || "none"}, got ${have.join(" ") || "none"}`);
  }
}

// A placeholder is filled in at render time, so one that is translated or dropped loses
// its number from the page without any error. Each {name} in the English must survive.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
for (const [key, english] of Object.entries(ui.en)) {
  if (!expected.includes(`ui.${key}`)) continue;
  const got = parsed[`ui.${key}`];
  if (typeof got !== "string") continue;
  const want = placeholders(String(english)).join(" ");
  const have = placeholders(got).join(" ");
  if (want !== have) problems.push(`placeholders changed in ui.${key}: expected ${want || "none"}, got ${have || "none"}`);
}

if (problems.length > 0) {
  console.error(`the reply does not line up with the English:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const current = (key: string): string =>
  key.startsWith("levels.")
    ? (LEVELS.ary as Record<string, string>)[key.slice("levels.".length)] ?? ""
    : (ui.ary as Record<string, string>)[key.slice("ui.".length)] ?? "";
const resolved = (key: string) => (key in parsed ? parsed[key]! : current(key));

const levelLine =
  "  ary: { " +
  Object.keys(LEVELS.en)
    .map((k) => `${k}: "${esc(resolved(`levels.${k}`))}"`)
    .join(", ") +
  " },";

const uiBlock =
  "\n  ary: {\n" +
  Object.keys(ui.en)
    .map((k) => `    ${k}: "${esc(resolved(`ui.${k}`))}",`)
    .join("\n") +
  "\n  },\n";

const path = "site/src/i18n/ui.ts";
let file = await readFile(path, "utf8");

const levelPattern = /\n {2}ary: \{ region:.*?\},/s;
if (!levelPattern.test(file)) throw new Error("could not find the ary line of LEVELS");
file = file.replace(levelPattern, `\n${levelLine}`);

const start = file.indexOf("\n  ary: {\n");
if (start === -1) throw new Error("could not find the ary block of ui");
const end = file.indexOf("\n  },\n", start);
if (end === -1) throw new Error("could not find the end of the ary block");
file = file.slice(0, start) + uiBlock.replace(/\n$/, "") + file.slice(end + "\n  },".length);

await writeFile(path, file);
console.log(`applied ${expected.length} strings to ${path}${partial ? ", leaving the rest as they were" : ""}`);
console.log("now run: pnpm typecheck && pnpm build");
