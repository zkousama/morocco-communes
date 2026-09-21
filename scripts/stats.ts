/**
 * Who uses this, and how, from every place that counts it, in one report.
 *
 *   pnpm stats            the last 7 days
 *   pnpm stats --days 30
 *
 * - npm and PyPI: downloads, from their public APIs. Both run a day or so behind, and a
 *   package they don't know yet reports as not counted yet.
 * - GitHub: stars, forks, and 14 days of views, clones and referrers, through `gh`, which
 *   has to be logged in as an owner of the repository for the traffic.
 * - The live API and the MCP server: what api/src/worker/usage.ts writes to Workers
 *   Analytics Engine. Needs CF_ACCOUNT_ID and a CF_API_TOKEN with Account Analytics Read.
 *
 * Page views aren't here: Cloudflare Web Analytics shows them in the dashboard, under the
 * Pages project's Metrics. The static API files aren't anywhere, since no code runs for them.
 */
import { execFileSync } from "node:child_process";

const REPO = "zkousama/morocco-communes";
const PACKAGE = "morocco-communes";
const DATASET = "communes_usage";

const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const DAYS = daysAt >= 0 ? Number(args[daysAt + 1]) : 7;
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 90) throw new Error("--days takes a whole number from 1 to 90");

const n = new Intl.NumberFormat("en-GB");
const heading = (text: string) => console.log(`\n${text}`);
const line = (label: string, value: string) => console.log(`  ${label.padEnd(26)}${value}`);

async function getJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function npm() {
  heading("npm");
  const period = DAYS <= 7 ? "last-week" : "last-month";
  const { ok, body } = await getJson(`https://api.npmjs.org/downloads/point/${period}/${PACKAGE}`);
  line(`downloads, ${period}`, ok ? n.format(body.downloads) : "not counted yet");
}

async function pypi() {
  heading("PyPI");
  const { ok, body } = await getJson(`https://pypistats.org/api/packages/${PACKAGE}/recent`);
  if (!ok) return line("downloads", "not counted yet");
  line("last day", n.format(body.data.last_day));
  line("last week", n.format(body.data.last_week));
  line("last month", n.format(body.data.last_month));
}

function gh(path: string): any {
  try {
    return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

function github() {
  heading("GitHub");
  const repo = gh(`repos/${REPO}`);
  if (!repo) return line("repository", "gh isn't logged in");
  line("stars", n.format(repo.stargazers_count));
  line("forks", n.format(repo.forks_count));
  const views = gh(`repos/${REPO}/traffic/views`);
  const clones = gh(`repos/${REPO}/traffic/clones`);
  if (views) line("views, 14 days", `${n.format(views.count)} by ${n.format(views.uniques)} people`);
  if (clones) line("clones, 14 days", `${n.format(clones.count)} by ${n.format(clones.uniques)} people`);
  const referrers: { referrer: string; count: number }[] = gh(`repos/${REPO}/traffic/popular/referrers`) ?? [];
  for (const r of referrers.slice(0, 5)) line(`  from ${r.referrer}`, n.format(r.count));
}

async function usage() {
  heading(`API and MCP, last ${DAYS} days`);
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) return line("usage", "set CF_ACCOUNT_ID and CF_API_TOKEN to read it");

  const sql = async (query: string) => {
    const { ok, status, body } = await getJson(
      `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
      { method: "POST", headers: { authorization: `Bearer ${token}` }, body: `${query} FORMAT JSON` },
    );
    if (!ok) throw new Error(`Analytics Engine answered ${status}`);
    return body.data as Record<string, string | number>[];
  };
  const since = `timestamp > NOW() - INTERVAL '${DAYS}' DAY`;
  // A data point stands for _sample_interval of them once Analytics Engine samples.
  const uses = "SUM(_sample_interval) AS uses";

  const byName = await sql(
    `SELECT blob1 AS kind, blob2 AS name, ${uses} FROM ${DATASET} WHERE ${since} GROUP BY kind, name ORDER BY uses DESC LIMIT 20`,
  );
  if (byName.length === 0) return line("usage", "nothing recorded yet");
  for (const row of byName) line(`${row.kind} ${row.name}`, n.format(Number(row.uses)));

  heading("MCP clients");
  const clients = await sql(
    `SELECT blob3 AS client, ${uses} FROM ${DATASET} WHERE ${since} AND blob1 = 'mcp' AND blob3 != '' GROUP BY client ORDER BY uses DESC LIMIT 10`,
  );
  for (const row of clients) line(String(row.client), `${n.format(Number(row.uses))} sessions`);

  heading("Countries");
  const countries = await sql(
    `SELECT blob5 AS country, ${uses} FROM ${DATASET} WHERE ${since} GROUP BY country ORDER BY uses DESC LIMIT 10`,
  );
  for (const row of countries) line(String(row.country || "unknown"), n.format(Number(row.uses)));
}

await npm();
await pypi();
github();
await usage().catch((error: Error) => line("usage", error.message));
console.log();
