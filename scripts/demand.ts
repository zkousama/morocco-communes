/**
 * What people looked for, from the demand log.
 *
 *   pnpm demand            the last 30 days
 *   pnpm demand --days 7
 *
 * Reads D1 through wrangler, which is already logged in, so there is no token to make or
 * store. Nothing here identifies a person: the rows hold no address and no identifier.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Why wrangler failed, from its JSON error when it gave one, or its first line of error text. */
function reasonOf(stdout: string, stderr: string): string {
  try {
    const text = (JSON.parse(stdout) as { error?: { text?: unknown } }).error?.text;
    if (typeof text === "string") return text;
  } catch {
    // Not JSON, so the reason is somewhere in the text.
  }
  const lines = `${stderr}\n${stdout}`
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((l) => /error/i.test(l)) ?? lines[0] ?? "it printed nothing";
  return line.replace(/^✘\s*\[ERROR\]\s*/, "").slice(0, 200);
}

function query(sql: string): Record<string, unknown>[] {
  const run = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "communes_demand", "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (run.status === 0) {
    try {
      const parsed = JSON.parse(run.stdout) as { results: Record<string, unknown>[] }[];
      return parsed[0]?.results ?? [];
    } catch {
      // An answer that isn't rows is reported below, like a failure.
    }
  }
  const reason = (run.error?.message ?? reasonOf(run.stdout ?? "", run.stderr ?? "")).replace(/\.$/, "");
  console.error(`wrangler couldn't read communes_demand: ${reason}. If you aren't logged in, pnpm exec wrangler login fixes that.`);
  process.exit(1);
}

const show = (title: string, rows: Record<string, unknown>[]) => {
  console.log(`\n${title}`);
  if (rows.length === 0) return console.log("  nothing yet");
  for (const row of rows) console.log("  " + Object.values(row).join("  "));
};

/** Each part of the report, as its title and the query that fills it. */
export const sections = (since: string, days: number): [title: string, sql: string][] => [
  [
    `Places, last ${days} days`,
    `SELECT code, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'place' AND bot = 0 GROUP BY code ORDER BY n DESC LIMIT 25`,
  ],
  [
    "Searches",
    `SELECT text, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'search' AND bot = 0 AND text != '' GROUP BY text ORDER BY n DESC LIMIT 25`,
  ],
  [
    "Searches that found nothing",
    `SELECT text, COUNT(*) AS n FROM events WHERE day >= '${since}' AND kind = 'search' AND results = 0 AND bot = 0 AND text != '' GROUP BY text ORDER BY n DESC LIMIT 25`,
  ],
  [
    "Tools",
    `SELECT name, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'tool' GROUP BY name ORDER BY n DESC LIMIT 25`,
  ],
  [
    "Clients",
    `SELECT name, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'client' GROUP BY name ORDER BY n DESC LIMIT 25`,
  ],
  // An assistant's tool and client rows come from no site, and would all count as direct.
  [
    "Where people came from",
    `SELECT via_site, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind IN ('place', 'search', 'download') AND bot = 0 GROUP BY via_site ORDER BY n DESC`,
  ],
  [
    "Downloads",
    `SELECT code, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'download' AND bot = 0 GROUP BY code ORDER BY n DESC LIMIT 25`,
  ],
];

// Runs the report when this file is the entry point, not when a test imports it.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--days");
  const days = at >= 0 ? Number(args[at + 1]) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days takes a whole number from 1 to 365");
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  for (const [title, sql] of sections(since, days)) show(title, query(sql));
}
