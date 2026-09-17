import { defineConfig } from "astro/config";
import solid from "@astrojs/solid-js";

// Static output on purpose. The playground runs in the browser against the real
// endpoints, so nothing here needs a server, and the hand-written Hono Worker stays the
// only Worker in the project. The API emitter writes into the same dist/ afterwards.
export default defineConfig({
  srcDir: "./src",
  publicDir: "./public",
  outDir: "../dist",
  integrations: [solid()],
  i18n: {
    defaultLocale: "en",
    locales: ["en", "fr", "ary"],
    routing: { prefixDefaultLocale: false },
  },
  devToolbar: { enabled: false },
});
