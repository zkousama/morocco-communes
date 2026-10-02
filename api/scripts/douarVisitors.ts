/**
 * The douar names visitors have had accepted, read from the live database into
 * api/generated/douar-visitors.json, so the pages, the API files and the downloads carry
 * them. The page also lays them over itself live, so this only has to be as fresh as the
 * last deploy.
 *
 * Like site/scripts/attention.ts, it reads the owner's live database only when ATTENTION is
 * "remote", as `pnpm deploy:live` sets it; otherwise, and when the read fails, it writes an
 * empty list.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { VISITORS } from "../src/lib/douars.ts";

function read(): [string, string][] {
  if (process.env.ATTENTION !== "remote") {
    console.log('douar-visitors: ATTENTION is not "remote", so nothing was queried; writing an empty list');
    return [];
  }
  try {
    const out = execFileSync(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "communes_demand", "--remote", "--json", "--command", "SELECT douar, name FROM douar_names ORDER BY douar"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const rows = (JSON.parse(out) as { results: { douar: string; name: string }[] }[])[0]?.results ?? [];
    return rows.filter((r) => /^\d{13}$/.test(r.douar) && typeof r.name === "string").map((r) => [r.douar, r.name]);
  } catch {
    console.warn("douar-visitors: the live database couldn't be read; writing an empty list");
    return [];
  }
}

const names = read();
await writeFile(VISITORS, `${JSON.stringify({ names })}\n`);
console.log(`douar-visitors: ${names.length} names`);
