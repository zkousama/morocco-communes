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

const source = process.argv[2];
if (!source) {
  console.error("usage: pnpm site:apply <file.json>");
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

const expected = [
  ...Object.keys(LEVELS.en).map((k) => `levels.${k}`),
  ...Object.keys(ui.en).map((k) => `ui.${k}`),
];

const problems: string[] = [];
for (const key of expected) {
  const value = parsed[key];
  if (value === undefined) problems.push(`missing: ${key}`);
  else if (typeof value !== "string") problems.push(`not a string: ${key}`);
  else if (value.trim() === "") problems.push(`empty: ${key}`);
}
for (const key of Object.keys(parsed)) {
  if (!expected.includes(key)) problems.push(`unknown key: ${key}`);
}

// Every number in the English has to survive into the translation, in the same order.
// Grouping is stripped before comparing: the separator legitimately differs by locale,
// so 3,852 in English is 3 852 in French and in Darija.
const numbersIn = (s: string) =>
  (s.match(/\d[\d\s.,\u202f\u00a0]*\d|\d/g) ?? []).map((n) => n.replace(/\D/g, ""));
for (const [key, english] of Object.entries(ui.en)) {
  const got = parsed[`ui.${key}`];
  if (typeof got !== "string") continue;
  const want = numbersIn(String(english));
  const have = numbersIn(got);
  if (want.join(",") !== have.join(",")) {
    problems.push(`numbers changed in ui.${key}: expected ${want.join(" ") || "none"}, got ${have.join(" ") || "none"}`);
  }
}

if (problems.length > 0) {
  console.error(`the reply does not line up with the English:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const levelLine =
  "  ary: { " +
  Object.keys(LEVELS.en)
    .map((k) => `${k}: "${esc(parsed[`levels.${k}`]!)}"`)
    .join(", ") +
  " },";

const uiBlock =
  "\n  ary: {\n" +
  Object.keys(ui.en)
    .map((k) => `    ${k}: "${esc(parsed[`ui.${k}`]!)}",`)
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
console.log(`applied ${expected.length} strings to ${path}`);
console.log("now run: pnpm typecheck && pnpm build");
