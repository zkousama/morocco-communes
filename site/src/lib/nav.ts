/**
 * The site's sections, named once for the header dropdowns and the phone menu.
 * Both surfaces read `menu`, so a link can't appear in one and not the other.
 */
import type { t } from "../i18n/ui";

type Copy = ReturnType<typeof t>;

export interface Section {
  route: string;
  label: string;
}

export interface MenuGroup {
  id: string;
  label: string;
  sections: Section[];
}

export const explore = (copy: Copy): Section[] => [
  { route: "communes/", label: copy.navCommunes },
  { route: "insights/", label: copy.navInsights },
  { route: "where/", label: copy.navWhere },
  { route: "compare/", label: copy.navCompare },
];

export const data = (copy: Copy): Section[] => [
  { route: "docs/indicators/", label: copy.navFigures },
  { route: "docs/glossary/", label: copy.navGlossary },
];

export const build = (copy: Copy): Section[] => [
  { route: "docs/api/", label: copy.navApi },
  { route: "docs/mcp/", label: copy.navMcp },
  { route: "docs/components/", label: copy.navComponents },
  { route: "docs/npm/", label: copy.navNpm },
  { route: "docs/python/", label: copy.navPython },
];

/** Explore, Data, Build. The bar and the phone menu both render this. */
export const menu = (copy: Copy): MenuGroup[] => [
  { id: "menu-explore", label: copy.menuExplore, sections: explore(copy) },
  { id: "menu-data", label: copy.menuData, sections: data(copy) },
  { id: "menu-build", label: copy.menuBuild, sections: build(copy) },
];

/** Every section, in menu order. */
export const sections = (copy: Copy): Section[] => menu(copy).flatMap((group) => group.sections);

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
