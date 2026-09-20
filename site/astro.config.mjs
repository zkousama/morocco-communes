import { defineConfig } from "astro/config";
import solid from "@astrojs/solid-js";

// A deploy without it ships no canonical, no link previews and an empty sitemap, which
// is the kind of thing nobody notices for a month.
if (!process.env.SITE_URL) {
  console.warn("\n  SITE_URL is not set: this build has no canonical URLs, no link preview image and an empty sitemap.");
  console.warn("  For a deploy: SITE_URL=https://your-deployment pnpm build\n");
}

// Static output on purpose. The playground runs in the browser against the real
// endpoints, so nothing here needs a server, and the hand-written Hono Worker stays the
// only Worker in the project. The API emitter writes into the same dist/ afterwards.
export default defineConfig({
  // The deployed origin. Link previews and canonical URLs have to be absolute, and the
  // hostname is only known once the Worker is deployed, so it comes in at build time:
  //   SITE_URL=https://example.workers.dev pnpm build
  // Without it the pages still build; the tags that need it are left out.
  site: process.env.SITE_URL || undefined,
  srcDir: "./src",
  publicDir: "./public",
  outDir: "../dist",
  integrations: [solid()],
  i18n: {
    defaultLocale: "en",
    locales: ["en", "fr"],
    routing: { prefixDefaultLocale: false },
  },
  devToolbar: { enabled: false },
});
