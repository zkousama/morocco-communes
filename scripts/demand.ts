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

const args = process.argv.slice(2);
const at = args.indexOf("--days");
const DAYS = at >= 0 ? Number(args[at + 1]) : 30;
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 365) throw new Error("--days takes a whole number from 1 to 365");
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

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

show(`Places, last ${DAYS} days`, query(
  `SELECT code, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'place' AND bot = 0 GROUP BY code ORDER BY n DESC LIMIT 25`,
));
show("Searches", query(
  `SELECT text, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'search' AND bot = 0 AND text != '' GROUP BY text ORDER BY n DESC LIMIT 25`,
));
show("Searches that found nothing", query(
  `SELECT text, COUNT(*) AS n FROM events WHERE day >= '${since}' AND kind = 'search' AND results = 0 AND text != '' GROUP BY text ORDER BY n DESC LIMIT 25`,
));
show("Tools", query(
  `SELECT name, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'tool' GROUP BY name ORDER BY n DESC LIMIT 25`,
));
show("Clients", query(
  `SELECT name, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'client' GROUP BY name ORDER BY n DESC LIMIT 25`,
));
show("Where people came from", query(
  `SELECT via_site, SUM(n) AS n FROM daily WHERE day >= '${since}' AND bot = 0 GROUP BY via_site ORDER BY n DESC`,
));
show("Downloads", query(
  `SELECT code, SUM(n) AS n FROM daily WHERE day >= '${since}' AND kind = 'download' AND bot = 0 GROUP BY code ORDER BY n DESC LIMIT 25`,
));
