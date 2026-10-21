/**
 * Tells the search engines that take IndexNow (Bing, Yandex, Seznam and others) about every
 * page in the live sitemap, so a new or changed page is crawled within days rather than
 * whenever a crawler gets round to it. Google doesn't take IndexNow; Search Console reads the
 * sitemap instead.
 *
 *   pnpm indexnow
 *
 * The key is the file in site/public that the engines fetch to check the request comes from
 * the site's owner, so it only works once a deploy has put that file live.
 */
import { readdirSync } from "node:fs";

const SITE = "https://communes.pages.dev";
/** IndexNow takes at most this many addresses in one request. */
const PER_REQUEST = 10_000;

const keyFile = readdirSync("site/public").find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) throw new Error("no IndexNow key file in site/public");
const key = keyFile.slice(0, -4);

const live = await fetch(`${SITE}/${keyFile}`);
if (!live.ok || (await live.text()).trim() !== key) {
  throw new Error(`${SITE}/${keyFile} isn't live yet: deploy first, then run this`);
}

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
if (urls.length === 0) throw new Error(`${SITE}/sitemap.xml lists no pages`);

for (let start = 0; start < urls.length; start += PER_REQUEST) {
  const urlList = urls.slice(start, start + PER_REQUEST);
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList }),
  });
  // 200 and 202 both mean received; the engines check the key on their own time.
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow answered ${response.status}: ${await response.text()}`);
  }
  console.log(`sent ${urlList.length} pages (${response.status})`);
}
