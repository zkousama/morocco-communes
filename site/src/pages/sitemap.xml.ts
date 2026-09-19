import type { APIRoute } from "astro";
import { LOCALES, PAGES, path } from "../i18n/ui";

/**
 * Every page in both languages, each naming its other-language twin. A sitemap needs
 * absolute URLs, so without SITE_URL at build time it lists nothing, and robots.txt
 * doesn't point to it.
 */
export const GET: APIRoute = ({ site }) => {
  const at = (locale: (typeof LOCALES)[number], route: string) => new URL(path(locale, route), site).href;
  const urls = site
    ? PAGES.flatMap((route) =>
        LOCALES.map(
          (locale) => `  <url>
    <loc>${at(locale, route)}</loc>
${LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${at(l, route)}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${at("en", route)}"/>
  </url>`,
        ),
      )
    : [];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
