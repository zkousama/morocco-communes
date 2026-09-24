/**
 * The month's most looked-up places, for the public page. Only page views count: the
 * beacon's place rows, `via = 'browser'`, so an API or MCP lookup can't move a place up
 * the list. Crawlers are left out, and a place has to have been opened 5 times before it
 * appears, so a single visit is never visible.
 *
 * The build never queries the owner's live database unasked. The `wrangler d1 execute …
 * --remote` query below only runs when the environment variable ATTENTION is set to
 * "remote"; any other value, including unset, writes an empty list straight away and says
 * so in one console line. If the query itself fails, for a missing login or any other
 * reason, this also writes an empty list, so a broken credential never breaks the build.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export interface Row {
  code: string;
  n: number;
  bot: number;
}

export const publishable = (rows: Row[]): { code: string; n: number }[] =>
  rows.filter((row) => row.bot === 0 && row.n >= 5).map(({ code, n }) => ({ code, n }));

/** The first day counted: 30 days back from now, as `YYYY-MM-DD`. */
export const sinceDate = (now = Date.now()): string => new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);

/** Runs a command and returns its stdout, so a test can supply one that never shells out. */
export type Runner = (command: string, args: string[]) => string;

const wrangler: Runner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * The month's place views, unfiltered by threshold. Reads the live database only when
 * ATTENTION is exactly "remote"; every other value returns an empty list without calling
 * the runner at all.
 */
export function read(since: string, env: NodeJS.ProcessEnv = process.env, run: Runner = wrangler): Row[] {
  if (env.ATTENTION !== "remote") {
    console.log('attention: ATTENTION is not "remote", so nothing was queried; writing an empty list');
    return [];
  }
  try {
    const out = run("pnpm", [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "communes_demand",
      "--remote",
      "--json",
      "--command",
      `SELECT code, SUM(n) AS n, bot FROM daily WHERE day >= '${since}' AND kind = 'place' AND via = 'browser' GROUP BY code, bot ORDER BY n DESC LIMIT 100`,
    ]);
    return (JSON.parse(out) as { results: Row[] }[])[0]?.results ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const since = sinceDate();
  const rows = publishable(read(since));
  await writeFile(
    new URL("../src/generated/attention.ts", import.meta.url),
    `// Written by site/scripts/attention.ts. Do not edit.\n` +
      `export const since = ${JSON.stringify(since)};\n` +
      `export const attention: { code: string; n: number }[] = ${JSON.stringify(rows, null, 2)};\n`,
  );
  console.log(`attention: ${rows.length} places`);
}

// Runs the build when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
