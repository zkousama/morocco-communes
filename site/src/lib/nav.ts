/**
 * The site's sections, named once for the bar and for the phone menu. The phone menu sorts
 * them in 2 groups and adds the most looked-up places, which the bar leaves to the footer.
 */
import type { t } from "../i18n/ui";

type Copy = ReturnType<typeof t>;

export interface Section {
  route: string;
  label: string;
}

export const explore = (copy: Copy): Section[] => [
  { route: "communes/", label: copy.navCommunes },
  { route: "docs/indicators/", label: copy.navFigures },
  { route: "docs/glossary/", label: copy.navGlossary },
  { route: "docs/insights/", label: copy.navInsights },
  { route: "most-looked-up/", label: copy.attention },
];

export const build = (copy: Copy): Section[] => [
  { route: "docs/api/", label: copy.navApi },
  { route: "docs/mcp/", label: copy.navMcp },
  { route: "docs/components/", label: copy.navComponents },
  { route: "docs/npm/", label: copy.navNpm },
  { route: "docs/python/", label: copy.navPython },
];

/** The bar's sections, in its order. */
export const sections = (copy: Copy): Section[] => [
  ...explore(copy).filter((s) => s.route !== "most-looked-up/"),
  ...build(copy),
];

/**
 * Marks the section a page is in: "page" on the section's own page, "true" on a place
 * page, which sits under the communes. A page with no route of its own marks none.
 */
export const currentOf = (section: string, route: string, current: boolean) =>
  !current
    ? undefined
    : section === route
      ? ("page" as const)
      : section === "communes/" && /^(communes|provinces|regions)\//.test(route)
        ? ("true" as const)
        : undefined;

/** The theme switch's 3 settings. "auto" follows the system. */
export const themes = (copy: Copy) => [
  { id: "auto", label: copy.themeAuto },
  { id: "light", label: copy.themeLight },
  { id: "dark", label: copy.themeDark },
];
