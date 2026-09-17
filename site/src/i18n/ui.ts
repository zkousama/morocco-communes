export type Locale = "en" | "fr";

/**
 * Set this once the repository is public. Empty means the footer link is left out
 * rather than pointing somewhere that does not exist.
 */
export const REPO_URL = "";

export const LOCALES: Locale[] = ["en", "fr"];
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

/** `/` for English, `/fr/` and `/ar/` for the others. */
export const path = (locale: Locale, rest = "") =>
  locale === "en" ? `/${rest}` : `/${locale}/${rest}`;

/** Levels, named as a reader of the census would name them. */
export const LEVELS: Record<Locale, Record<string, string>> = {
  en: { region: "région", province: "préfecture", cercle: "cercle", commune: "commune", arrondissement: "arrondissement" },
  fr: { region: "région", province: "préfecture", cercle: "cercle", commune: "commune", arrondissement: "arrondissement" },
};

export const ui = {
  en: {
    title: "Morocco communes",
    language: "Language",
    tagline: "Morocco’s 1,503 communes, as open data.",
    intro:
      "Official HCP codes, names in French and Arabic, population from the 2024 and 2014 censuses, and a boundary for every commune but one. Free to use, and free to run.",
    mapCaption: "All 1,502 boundaries, drawn from the files this API serves.",
    mapSource: "data/v1/geometry · OpenStreetMap, ODbL",

    codeHeading: "How a code reads",
    codeBody:
      "The code is the hierarchy. Each group of digits names one level, so a commune’s code already contains its province and its région. Cercles sit above rural communes only; an urban commune may hold arrondissements instead.",
    colPopulation: "Population, 2024",

    tryHeading: "Run a query",
    tryBody: "Every request below goes to this API and comes back unedited.",

    tiersHeading: "Where a request is answered",
    tiersBody:
      "Three places, and the X-Api-Tier header on every response says which one. Most requests never reach any code at all.",
    tierPreHeader: "no header, because nothing ran",
    tierPre: "A file on the CDN",
    tierPreBody:
      "3,852 responses are written when the site is built. Nothing runs to serve them, so they cost nothing and hold up under any amount of traffic.",
    tierAlias: "A rewrite to that file",
    tierAliasBody:
      "A query string cannot pick a file, so requests written that way are resolved to the file that already holds the answer, and the response names it.",
    tierComputed: "Worked out on the spot",
    tierComputedBody:
      "Search, radius queries, and filter combinations no single file covers. These are the only requests that spend anything.",

    dataHeading: "Take the whole thing",
    dataBody:
      "The dataset is versioned in the repository, so it can be used without this API at all. Licences differ by directory: the attributes come from the census, and the boundaries are share-alike.",

    searchTab: "Search",
    searchHint:
      "French, Arabic, or a slug. Accents, the alef variants and ta-marbuta all fold, and places are findable by the other names they go by — Fez finds Fès, Port Lyautey finds Kénitra.",
    nearTab: "Nearby",
    nearHint: "Communes within a radius of a point, nearest first.",
    lookupTab: "Lookup",
    lookupHint: "One commune by code or slug. All four ways of writing it reach the same record.",
    fieldQuery: "Search for",
    fieldRadius: "Radius in km",
    fieldIdentifier: "Code or slug",
    run: "Run",
    running: "Running",
    request: "Request",
    tier: "Answered by",
    emptyState: "Pick an example or type a query, then run it.",
    failed: "That request did not complete. Check the API is running, then try again.",

    theme: "Theme",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",

    chartsHeading: "What the numbers show",
    chartsBody:
      "Three things worth knowing before you build on this, each drawn from the dataset rather than written down beside it.",
    chartChange: "The south is filling up",
    chartChangeBody: "Population change by région between the 2014 and 2024 censuses.",
    chartChangeNote:
      "Dakhla-Oued Ed-Dahab grew by more than half. The Oriental is the only région that shrank. Both figures are sums over the communes in each, not a separate régional series.",
    chartSize: "Most communes are small",
    chartSizeBody: "Communes by 2024 population.",
    chartSpread: "Whether the crosswalk holds up",
    chartSpreadBody:
      "207 communes were renumbered by the 2015 reform, so their 2014 population had to be matched by name and elimination rather than read off an unchanged code. If those matches were wrong, their implied growth would scatter differently.",
    chartSpreadNote:
      "Bar spans the 10th to 90th percentile, block the 25th to 75th, line the median. The two distributions sit almost on top of each other, which is the evidence that the matching is sound — it is not proof, and the per-pair reasoning is in data/v1/crosswalk.",

    footerData: "Codes and population from the Haut-Commissariat au Plan, RGPH 2024 and RGPH 2014.",
    footerGeometry: "Boundaries from OpenStreetMap contributors, under the Open Database Licence.",
    repo: "Source",
  },

  fr: {
    title: "Communes du Maroc",
    language: "Langue",
    tagline: "Les 1 503 communes du Maroc, en données ouvertes.",
    intro:
      "Codes officiels du HCP, noms en français et en arabe, population des recensements de 2024 et 2014, et une limite pour chaque commune sauf une. Libre d’usage, et gratuit à héberger.",
    mapCaption: "Les 1 502 limites, tracées depuis les fichiers que cette API sert.",
    mapSource: "data/v1/geometry · OpenStreetMap, ODbL",

    codeHeading: "Comment se lit un code",
    codeBody:
      "Le code est la hiérarchie. Chaque groupe de chiffres nomme un niveau : le code d’une commune contient donc déjà sa province et sa région. Les cercles ne coiffent que les communes rurales ; une commune urbaine peut à la place contenir des arrondissements.",
    colPopulation: "Population, 2024",

    tryHeading: "Lancer une requête",
    tryBody: "Chaque requête ci-dessous part vers cette API et revient telle quelle.",

    tiersHeading: "Où une requête est traitée",
    tiersBody:
      "Trois endroits, et l’en-tête X-Api-Tier de chaque réponse dit lequel. La plupart des requêtes n’atteignent aucun code.",
    tierPreHeader: "aucun en-tête : rien ne s’est exécuté",
    tierPre: "Un fichier sur le CDN",
    tierPreBody:
      "3 852 réponses sont écrites à la construction du site. Rien ne s’exécute pour les servir : elles ne coûtent rien et tiennent sous n’importe quel trafic.",
    tierAlias: "Une réécriture vers ce fichier",
    tierAliasBody:
      "Une chaîne de requête ne peut pas désigner un fichier. Les requêtes écrites ainsi sont donc renvoyées vers le fichier qui porte déjà la réponse, et la réponse le nomme.",
    tierComputed: "Calculée à la demande",
    tierComputedBody:
      "La recherche, les requêtes par rayon, et les combinaisons de filtres qu’aucun fichier ne couvre. Ce sont les seules requêtes qui consomment quelque chose.",

    dataHeading: "Tout récupérer",
    dataBody:
      "Le jeu de données est versionné dans le dépôt : il s’utilise sans passer par cette API. Les licences diffèrent selon le dossier : les attributs viennent du recensement, les limites sont à partage à l’identique.",

    searchTab: "Recherche",
    searchHint:
      "En français, en arabe ou par slug. Les accents, les variantes de l’alif et le ta marbouta sont normalisés, et les lieux se trouvent aussi par leurs autres noms — Fez donne Fès, Port Lyautey donne Kénitra.",
    nearTab: "À proximité",
    nearHint: "Les communes dans un rayon autour d’un point, de la plus proche à la plus lointaine.",
    lookupTab: "Consultation",
    lookupHint: "Une commune par code ou slug. Les quatre écritures mènent au même enregistrement.",
    fieldQuery: "Rechercher",
    fieldRadius: "Rayon en km",
    fieldIdentifier: "Code ou slug",
    run: "Lancer",
    running: "En cours",
    request: "Requête",
    tier: "Traitée par",
    emptyState: "Choisissez un exemple ou saisissez une requête, puis lancez-la.",
    failed: "La requête n’a pas abouti. Vérifiez que l’API tourne, puis réessayez.",

    theme: "Thème",
    themeAuto: "Auto",
    themeLight: "Clair",
    themeDark: "Sombre",

    chartsHeading: "Ce que disent les chiffres",
    chartsBody:
      "Trois choses à savoir avant de construire là-dessus, chacune tirée du jeu de données et non écrite à côté.",
    chartChange: "Le sud se remplit",
    chartChangeBody: "Évolution de la population par région entre les recensements de 2014 et 2024.",
    chartChangeNote:
      "Dakhla-Oued Ed-Dahab a gagné plus de la moitié. L’Oriental est la seule région à avoir perdu des habitants. Les deux chiffres sont des sommes sur les communes, pas une série régionale distincte.",
    chartSize: "La plupart des communes sont petites",
    chartSizeBody: "Communes par population en 2024.",
    chartSpread: "Ce que vaut la table de correspondance",
    chartSpreadBody:
      "207 communes ont été renumérotées par la réforme de 2015 : leur population de 2014 a dû être appariée par nom et par élimination, faute d’un code inchangé. Si ces appariements étaient faux, leur croissance se disperserait autrement.",
    chartSpreadNote:
      "La barre couvre les 10e à 90e centiles, le bloc les 25e à 75e, le trait la médiane. Les deux distributions se superposent presque : c’est l’indice que l’appariement tient — ce n’est pas une preuve, et le raisonnement par paire est dans data/v1/crosswalk.",

    footerData: "Codes et population : Haut-Commissariat au Plan, RGPH 2024 et RGPH 2014.",
    footerGeometry: "Limites : contributeurs d’OpenStreetMap, sous licence Open Database.",
    repo: "Code source",
  },

} as const;

export const t = (locale: Locale) => ui[locale];
