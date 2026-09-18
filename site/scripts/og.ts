/**
 * Renders site/public/og.png, the image a link preview shows on LinkedIn, X, Slack and
 * the rest. 1200 × 630 is the size they all crop to.
 *
 * Needs a Chrome or Chromium binary, which the build does not, so this is run by hand
 * when the map or the headline changes and the PNG is committed:
 *
 *   pnpm site:og
 *   CHROME=/path/to/chrome pnpm site:og
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ui } from "../src/i18n/ui.ts";

function findChrome(): string {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const bin of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(bin)) return bin;
  }
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      const bin = join(cache, dir, "chrome-linux64", "chrome");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("no Chrome found; set CHROME=/path/to/chrome");
}

const svg = (await readFile("site/public/morocco.svg", "utf8")).replace(/<svg /, '<svg class="map" ');
const copy = ui.en;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Instrument+Sans:wght@400;500&family=JetBrains+Mono&display=block">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: #0d1a17; color: #e8efe9; display: grid; grid-template-columns: 1fr 500px;
         align-items: center; padding: 0 64px 0 76px; box-sizing: border-box; }
  .words { display: flex; flex-direction: column; gap: 26px; }
  .name { font: 500 22px "Instrument Sans", sans-serif; color: #8ba398; letter-spacing: 0.01em; }
  h1 { font: 400 70px/1.04 "Instrument Serif", serif; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
  .path { font: 400 18px "JetBrains Mono", monospace; color: #7fcfae; }
  .map { width: 500px; height: auto; display: block; }
</style></head><body>
  <div class="words">
    <div class="name">${copy.title}</div>
    <h1>${copy.tagline.replace("’", "&rsquo;")}</h1>
    <div class="path">GET /api/communes/tanger</div>
  </div>
  ${svg}
</body></html>`;

const dir = await mkdtemp(join(tmpdir(), "og-"));
const page = join(dir, "og.html");
await writeFile(page, html);
execFileSync(
  findChrome(),
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    "--virtual-time-budget=6000",
    `--screenshot=${join(process.cwd(), "site/public/og.png")}`,
    `file://${page}`,
  ],
  { stdio: "ignore" },
);
console.log("og: site/public/og.png");
