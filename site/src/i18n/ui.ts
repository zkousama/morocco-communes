export type Locale = "en" | "fr" | "ar";

/**
 * Set this once the repository is public. Empty means the footer link is left out
 * rather than pointing somewhere that does not exist.
 */
export const REPO_URL = "";

export const LOCALES: Locale[] = ["en", "fr", "ar"];
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", ar: "العربية" };
export const RTL: Record<Locale, boolean> = { en: false, fr: false, ar: true };

/** `/` for English, `/fr/` and `/ar/` for the others. */
export const path = (locale: Locale, rest = "") =>
  locale === "en" ? `/${rest}` : `/${locale}/${rest}`;

export const ui = {
  en: {
    title: "Morocco communes API",
    tagline: "Every commune in Morocco, with its official code, both its names, its population and its boundary.",
    intro:
      "An open dataset and HTTP API for Morocco's administrative divisions, built from the census HCP publishes and the boundaries OpenStreetMap holds. Free to use, and free to run.",
    counts: "What it covers",
    regions: "régions",
    provinces: "provinces and préfectures",
    cercles: "cercles",
    communes: "communes",
    arrondissements: "arrondissements",
    tryIt: "Try it",
    tryItBody: "Every query below runs against the real API.",
    endpoints: "Endpoints",
    tiers: "Three tiers",
    tiersBody:
      "Which tier answered a request is in its X-Api-Tier header. The pre-rendered tier is files on a CDN, so it costs nothing to serve and keeps working under any amount of traffic.",
    tierPre: "Pre-rendered",
    tierPreBody: "3,852 files written at build time and served without running any code.",
    tierAlias: "Alias",
    tierAliasBody: "Query-string and extensionless shapes, rewritten to the file that holds the answer.",
    tierComputed: "Computed",
    tierComputedBody: "Search, radius queries, and filter combinations no single file answers.",
    dataset: "The dataset",
    datasetBody:
      "Committed in the repository and versioned, so you can use it without the API at all. The licences differ by directory: the attributes come from HCP, and the boundaries are ODbL, which is share-alike.",
    search: "Search",
    searchBody:
      "Type French, Arabic, or a slug. Diacritics, the alef variants and ta-marbuta all fold, and a place is findable by the names it is also known by — Fez finds Fès, Port Lyautey finds Kénitra.",
    near: "Nearby",
    nearBody: "Communes within a radius of a point, nearest first.",
    lookup: "Lookup",
    lookupBody: "One commune by code or slug. All four spellings resolve to the same unit.",
    source: "Source",
    run: "Run",
    running: "Running",
    request: "Request",
    response: "Response",
    tier: "Tier",
    query: "Query",
    radius: "Radius (km)",
    identifier: "Code or slug",
    empty: "Nothing to show yet.",
    failed: "That request failed.",
    repo: "Repository",
  },
  fr: {
    title: "API des communes du Maroc",
    tagline: "Chaque commune du Maroc, avec son code officiel, ses deux noms, sa population et sa limite.",
    intro:
      "Un jeu de données ouvert et une API HTTP pour le découpage administratif du Maroc, construits à partir du recensement publié par le HCP et des limites présentes dans OpenStreetMap. Libre d'usage, et gratuit à héberger.",
    counts: "Ce que ça couvre",
    regions: "régions",
    provinces: "provinces et préfectures",
    cercles: "cercles",
    communes: "communes",
    arrondissements: "arrondissements",
    tryIt: "Essayer",
    tryItBody: "Chaque requête ci-dessous interroge la vraie API.",
    endpoints: "Points d'accès",
    tiers: "Trois niveaux",
    tiersBody:
      "L'en-tête X-Api-Tier indique lequel a répondu. Le niveau pré-généré n'est que des fichiers sur un CDN : il ne coûte rien à servir et tient sous n'importe quel trafic.",
    tierPre: "Pré-généré",
    tierPreBody: "3 852 fichiers écrits à la construction et servis sans exécuter de code.",
    tierAlias: "Alias",
    tierAliasBody: "Les formes avec paramètres ou sans extension, réécrites vers le fichier qui porte la réponse.",
    tierComputed: "Calculé",
    tierComputedBody: "La recherche, les requêtes par rayon, et les combinaisons de filtres qu'aucun fichier ne couvre.",
    dataset: "Le jeu de données",
    datasetBody:
      "Versionné et présent dans le dépôt, donc utilisable sans passer par l'API. Les licences diffèrent par dossier : les attributs viennent du HCP, les limites sont sous ODbL, qui impose le partage à l'identique.",
    search: "Recherche",
    searchBody:
      "Tapez en français, en arabe ou un slug. Les diacritiques, les variantes de l'alif et le ta marbouta sont normalisés, et un lieu se trouve aussi par ses autres noms — Fez trouve Fès, Port Lyautey trouve Kénitra.",
    near: "À proximité",
    nearBody: "Les communes dans un rayon autour d'un point, de la plus proche à la plus lointaine.",
    lookup: "Consultation",
    lookupBody: "Une commune par code ou slug. Les quatre écritures mènent à la même unité.",
    source: "Source",
    run: "Exécuter",
    running: "En cours",
    request: "Requête",
    response: "Réponse",
    tier: "Niveau",
    query: "Requête",
    radius: "Rayon (km)",
    identifier: "Code ou slug",
    empty: "Rien à afficher pour l'instant.",
    failed: "La requête a échoué.",
    repo: "Dépôt",
  },
  ar: {
    title: "واجهة جماعات المغرب",
    tagline: "كل جماعة في المغرب، مع رمزها الرسمي واسميها وعدد سكانها وحدودها.",
    intro:
      "مجموعة بيانات مفتوحة وواجهة HTTP للتقسيم الإداري للمغرب، مبنية على الإحصاء الذي تنشره المندوبية السامية للتخطيط وعلى الحدود الموجودة في OpenStreetMap. حرة الاستخدام، ومجانية التشغيل.",
    counts: "ما تغطيه",
    regions: "جهات",
    provinces: "أقاليم وعمالات",
    cercles: "دوائر",
    communes: "جماعات",
    arrondissements: "مقاطعات",
    tryIt: "جرّبها",
    tryItBody: "كل طلب أدناه يُنفَّذ على الواجهة الحقيقية.",
    endpoints: "نقاط الوصول",
    tiers: "ثلاث طبقات",
    tiersBody:
      "ترويسة X-Api-Tier تبيّن أي طبقة أجابت. الطبقة المُهيَّأة مسبقًا ملفات على شبكة توصيل، فلا تكلّف شيئًا ولا تتأثر بحجم الزيارات.",
    tierPre: "مُهيَّأة مسبقًا",
    tierPreBody: "‏3852 ملفًا تُكتب عند البناء وتُقدَّم دون تنفيذ أي كود.",
    tierAlias: "بديلة",
    tierAliasBody: "الصيغ ذات المعاملات أو بدون امتداد، تُحوَّل إلى الملف الذي يحمل الجواب.",
    tierComputed: "محسوبة",
    tierComputedBody: "البحث، والاستعلام بنصف قطر، وتجميع المرشحات الذي لا يغطيه ملف واحد.",
    dataset: "مجموعة البيانات",
    datasetBody:
      "محفوظة في المستودع ولها إصدارات، فيمكن استخدامها دون الواجهة أصلًا. الرخص تختلف بحسب المجلد: الخصائص من المندوبية السامية للتخطيط، والحدود تحت رخصة ODbL التي تشترط المشاركة بالمثل.",
    search: "البحث",
    searchBody:
      "اكتب بالفرنسية أو العربية أو بالمعرّف. تُوحَّد الحركات وصور الألف والتاء المربوطة، ويمكن العثور على المكان بأسمائه الأخرى أيضًا — Fez تجد فاس، وPort Lyautey تجد القنيطرة.",
    near: "الأقرب",
    nearBody: "الجماعات داخل نصف قطر حول نقطة، من الأقرب إلى الأبعد.",
    lookup: "الاستعلام",
    lookupBody: "جماعة واحدة بالرمز أو المعرّف. الصيغ الأربع كلها تؤدي إلى الوحدة نفسها.",
    source: "المصدر",
    run: "تشغيل",
    running: "جارٍ",
    request: "الطلب",
    response: "الجواب",
    tier: "الطبقة",
    query: "الاستعلام",
    radius: "نصف القطر (كم)",
    identifier: "الرمز أو المعرّف",
    empty: "لا شيء لعرضه بعد.",
    failed: "فشل الطلب.",
    repo: "المستودع",
  },
} as const;

export const t = (locale: Locale) => ui[locale];
