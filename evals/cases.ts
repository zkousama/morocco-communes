/**
 * The questions the eval asks, each with what a right answer has to contain. Every
 * expected figure is read from data/v1, or for the few that depend on a boundary, from the
 * running API, so the eval stays right when the data is rebuilt.
 */
import { readFileSync } from "node:fs";

const attributes = (name: string) => JSON.parse(readFileSync(`data/v1/attributes/${name}.json`, "utf8")) as Unit[];
const indicators = (name: string) => JSON.parse(readFileSync(`data/v1/indicators/${name}.json`, "utf8")) as Figures[];
const indicators2014 = (name: string) => JSON.parse(readFileSync(`data/v1/indicators/2014/${name}.json`, "utf8")) as Figures[];
const economy = (name: string) => JSON.parse(readFileSync(`data/v1/economy/${name}.json`, "utf8")) as Establishments[];

interface Unit {
  code: string;
  slug?: string;
  name: { fr: string; ar: string };
  type?: "urban" | "rural";
  parents?: { region: string; province: string; cercle: string | null };
  regionCode?: string;
  provinceCode?: string;
  communeCode?: string;
  population: { "2024": { total: number }; "2014"?: { total: number | null } | null; change?: { pct: number } | null };
  density?: number | null;
}
type Topics = Record<string, Record<string, number | null>>;
interface Figures {
  code: string;
  people: Record<string, Record<string, Topics> | null>;
  households: Record<string, Topics | null>;
}
interface Establishments {
  code: string;
  name: { fr: string };
  topics: Topics;
}

const communes = attributes("communes");
const provinces = attributes("provinces");
const regions = attributes("regions");
const arrondissements = attributes("arrondissements");
const cercles = attributes("cercles");
const figuresOf = new Map(
  [...indicators("communes"), ...indicators("provinces"), ...indicators("regions"), ...indicators("arrondissements")].map((f) => [f.code, f]),
);
const national = JSON.parse(readFileSync("data/v1/indicators/national.json", "utf8")) as Figures;
const establishmentsOf = new Map(
  [...economy("communes"), ...economy("provinces"), ...economy("regions"), ...economy("arrondissements")].map((r) => [r.code, r]),
);
const nationalEconomy = JSON.parse(readFileSync("data/v1/economy/national.json", "utf8")) as Establishments;
const counts = (code: string) => establishmentsOf.get(code)?.topics ?? fail(`no establishments for ${code}`);
const jobsIn = (r: Establishments) => r.topics.establishments!.jobs ?? 0;
const byJobs = (rows: Establishments[]) => [...rows].sort((a, b) => jobsIn(b) - jobsIn(a));
const mostJobs = byJobs(economy("communes"))[0]!;
const busiestArrondissement = byJobs(economy("arrondissements"))[0]!;
const figures2014 = new Map(
  [...indicators2014("communes"), ...indicators2014("provinces"), ...indicators2014("regions")].map((f) => [f.code, f]),
);

const commune = (slug: string) => communes.find((c) => c.slug === slug) ?? fail(`no commune ${slug}`);
const province = (name: string) => provinces.find((p) => p.name.fr === name) ?? fail(`no province ${name}`);
const region = (name: string) => regions.find((r) => r.name.fr === name) ?? fail(`no région ${name}`);
const people = (code: string) => figuresOf.get(code)?.people ?? fail(`no indicators for ${code}`);
const homes = (code: string) => figuresOf.get(code)?.households ?? fail(`no indicators for ${code}`);
function fail(message: string): never {
  throw new Error(message);
}
const pop = (u: Unit) => u.population["2024"].total;

/** What an answer must hold. A name matches with or without its accents. */
export interface Expect {
  /** Names or phrases that must all appear, each a list of acceptable spellings. */
  names?: string[][];
  /** Figures that must all appear, as numbers; a decimal matches however it's written. */
  numbers?: number[];
  /** A pattern the answer must match, for answers that are words rather than figures. */
  pattern?: RegExp;
  /** Tools that must be among those called. */
  tools?: string[];
  /** Calls beyond which a right answer still counts, but as slow. */
  maxCalls?: number;
}

export interface Case {
  id: string;
  category: "lookup" | "spelling" | "language" | "geo" | "list" | "indicators" | "economy" | "coverage" | "refusal";
  question: string;
  expect: Expect | ((api: string) => Promise<Expect>);
}

const get = async (api: string, path: string) => {
  const response = await fetch(api + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as { data: unknown; meta: { total?: number } };
};

const tafraout = commune("tafraout");
const tiznit = commune("tiznit");
const ketama = commune("ketama");
const tetouan = commune("tetouan");
const essaouira = commune("essaouira");
const tanger = commune("tanger");
const sale = commune("sale");
const jadida = commune("el-jadida");
const kenitra = commune("kenitra");
const casablanca = commune("casablanca");
const assilah = commune("assilah");
const ouarzazate = commune("ouarzazate");
const hoceima = commune("al-hoceima");
const sidiBennour = commune("sidi-bennour");

const largest = [...communes].sort((a, b) => pop(b) - pop(a));
const densest = [...communes].filter((c) => c.density != null).sort((a, b) => b.density! - a.density!)[0]!;
const souss = region("Souss-Massa");
const fastestInSouss = communes
  .filter((c) => c.parents!.region === souss.code && c.population.change)
  .sort((a, b) => b.population.change!.pct - a.population.change!.pct)[0]!;
const chefchaouen = province("Chefchaouen");
const shrinking = communes
  .filter((c) => c.parents!.province === chefchaouen.code && c.type === "rural" && c.population.change && c.population.change.pct < 0)
  .sort((a, b) => a.population.change!.pct - b.population.change!.pct);
const tangerRegion = region("Tanger-Tétouan-Al Hoceima");
const urbanInTanger = communes.filter((c) => c.parents!.region === tangerRegion.code && c.type === "urban").length;

const labour = (code: string, sex = "all", area = "total") => people(code)[area]![sex]!.labour!;
/** A figure at the 2014 census, for the cases that ask what changed. */
const illiteracy2014 = (code: string) => figures2014.get(code)?.people.total?.all?.illiteracy?.rate10Plus ?? null;
const illiteracy = (code: string, sex = "all", area = "total") => people(code)[area]![sex]!.illiteracy!.rate10Plus!;
const over50k = communes.filter((c) => pop(c) > 50_000);
const jobless = [...over50k].sort((a, b) => (labour(b.code).unemploymentRate ?? -1) - (labour(a.code).unemploymentRate ?? -1))[0]!;
const azilal = province("Azilal");
const taroudannt = province("Taroudannt");
const tiznitProvince = province("Tiznit");
const driest = communes
  .filter((c) => c.parents!.province === tiznitProvince.code && homes(c.code).total?.amenities?.runningWater != null)
  .sort((a, b) => homes(a.code).total!.amenities!.runningWater! - homes(b.code).total!.amenities!.runningWater!)[0]!;
const fellMost = communes
  .filter((c) => pop(c) > 20_000 && c.parents!.region === "01" && illiteracy2014(c.code) !== null)
  .sort((a, b) => illiteracy(a.code) - illiteracy2014(a.code)! - (illiteracy(b.code) - illiteracy2014(b.code)!))[0]!;
const womenAtWork = [...regions].sort(
  (a, b) => labour(b.code, "female").activityRate! - labour(a.code, "female").activityRate!,
)[0]!;
const rabat = commune("rabat");
const agdal = arrondissements.find((a) => a.name.fr === "Agdal Riyad" && a.communeCode === rabat.code) ?? fail("no Agdal Riyad");
const casaArrondissements = arrondissements.filter((a) => a.communeCode === casablanca.code).sort((a, b) => pop(b) - pop(a));

export const CASES: Case[] = [
  {
    id: "tafraout-province",
    category: "lookup",
    question: "Which province is Tafraout in, and how many people live there?",
    expect: { names: [["Tiznit"]], numbers: [pop(tafraout)], tools: ["search"], maxCalls: 3 },
  },
  {
    id: "kenitra-2014",
    category: "lookup",
    question: "What was the population of Kénitra in 2014?",
    expect: { numbers: [kenitra.population["2014"]!.total!], maxCalls: 3 },
  },
  {
    id: "casablanca-change",
    category: "lookup",
    question: "By how much has Casablanca's population changed since 2014, in percent?",
    expect: { numbers: [Math.round(casablanca.population.change!.pct * 10) / 10], maxCalls: 3 },
  },
  {
    id: "ouarzazate-code",
    category: "lookup",
    question: "What is the HCP geographic code of the commune of Ouarzazate?",
    expect: { names: [[ouarzazate.code]], maxCalls: 3 },
  },
  {
    id: "sidi-bennour-commune",
    category: "lookup",
    question: "How many people live in the commune of Sidi Bennour?",
    expect: { numbers: [pop(sidiBennour)], maxCalls: 4 },
  },
  {
    id: "agdal-arrondissement",
    category: "lookup",
    question: "What is the population of the Agdal Riyad arrondissement in Rabat?",
    expect: { numbers: [pop(agdal)], maxCalls: 4 },
  },
  {
    id: "ktama",
    category: "spelling",
    question: "What région is Ktama in, and what's its population?",
    expect: { names: [["Tanger-Tétouan-Al Hoceima", "Tanger-Tetouan-Al Hoceima", "Tanger-Tétouan"]], numbers: [pop(ketama)], maxCalls: 3 },
  },
  {
    id: "titwan",
    category: "spelling",
    question: "How many people live in Titwan?",
    expect: { numbers: [pop(tetouan)], maxCalls: 3 },
  },
  {
    id: "mogador",
    category: "spelling",
    question: "How many people lived in Mogador at the last census?",
    expect: { numbers: [pop(essaouira)], maxCalls: 3 },
  },
  {
    id: "jdida",
    category: "spelling",
    question: "What's the population of Jdida?",
    expect: { numbers: [pop(jadida)], maxCalls: 3 },
  },
  {
    id: "arabic-tanger",
    category: "language",
    question: "كم عدد سكان جماعة طنجة حسب إحصاء 2024؟",
    expect: { numbers: [pop(tanger)], maxCalls: 3 },
  },
  {
    id: "french-sale",
    category: "language",
    question: "Quelle est la population de la commune de Salé en 2024 ?",
    expect: { numbers: [pop(sale)], maxCalls: 3 },
  },
  {
    id: "point-agadir",
    category: "geo",
    question: "Which commune is the point 30.42, -9.60 in?",
    expect: async (api) => {
      const hit = (await get(api, "/api/communes/at?lat=30.42&lng=-9.60")).data as { name: { fr: string } };
      return { names: [[hit.name.fr]], tools: ["commune_at"], maxCalls: 2 };
    },
  },
  {
    id: "point-maarif",
    category: "geo",
    question: "I'm standing at 33.5862, -7.6325 in Casablanca. Which arrondissement am I in?",
    expect: async (api) => {
      const hit = (await get(api, "/api/communes/at?lat=33.5862&lng=-7.6325")).data as { arrondissement: { name: { fr: string } } };
      return { names: [[hit.arrondissement.name.fr, hit.arrondissement.name.fr.replace("â", "a")]], tools: ["commune_at"], maxCalls: 2 };
    },
  },
  {
    id: "near-chefchaouen",
    category: "geo",
    question: "Which communes are within 10 km of the centre of the commune of Chefchaouen? Name the 3 nearest.",
    expect: async (api) => {
      const centre = commune("chefchaouen") as Unit & { centroid: { lat: number; lng: number } };
      const raw = JSON.parse(readFileSync("data/v1/attributes/communes.json", "utf8")) as (Unit & { centroid: { lat: number; lng: number } | null })[];
      const at = raw.find((c) => c.code === centre.code)!.centroid!;
      const hits = (await get(api, `/api/communes/near?lat=${at.lat}&lng=${at.lng}&radius=10&limit=4`)).data as { name: { fr: string } }[];
      // The nearest is Chefchaouen itself, so the next 2 have to be named.
      return { names: hits.slice(1, 3).map((h) => [h.name.fr]), tools: ["communes_near"], maxCalls: 4 };
    },
  },
  {
    id: "largest-five",
    category: "list",
    question: "What are the 5 most populous communes in Morocco?",
    expect: { names: largest.slice(0, 5).map((c) => [c.name.fr]), tools: ["list_communes"], maxCalls: 2 },
  },
  {
    id: "densest",
    category: "list",
    question: "Which commune in Morocco is the most densely populated?",
    expect: { names: [[densest.name.fr]], tools: ["list_communes"], maxCalls: 2 },
  },
  {
    id: "fastest-souss",
    category: "list",
    question: "Which commune in the Souss-Massa région grew the fastest between 2014 and 2024?",
    expect: { names: [[fastestInSouss.name.fr]], tools: ["list_communes"], maxCalls: 4 },
  },
  {
    id: "shrinking-chefchaouen",
    category: "list",
    question: "Which rural communes of Chefchaouen province lost the most people between 2014 and 2024? Name the 3 that shrank most, in percent.",
    expect: { names: shrinking.slice(0, 3).map((c) => [c.name.fr]), tools: ["list_communes"], maxCalls: 4 },
  },
  {
    id: "urban-count",
    category: "list",
    question: "How many urban communes are there in the Tanger-Tétouan-Al Hoceima région?",
    expect: { numbers: [urbanInTanger], tools: ["list_communes"], maxCalls: 4 },
  },
  {
    id: "tanger-unemployment",
    category: "indicators",
    question: "What's the unemployment rate in the commune of Tanger?",
    expect: { numbers: [labour(tanger.code).unemploymentRate!], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "morocco-fertility",
    category: "indicators",
    question: "What was Morocco's total fertility rate in the 2024 census?",
    expect: { numbers: [national.people.total!.all!.fertility!.totalFertilityRate!], tools: ["get_indicators"], maxCalls: 2 },
  },
  {
    id: "illiteracy-women",
    category: "indicators",
    question: "Compare the illiteracy rate of women in the communes of Tafraout and Tiznit.",
    expect: { numbers: [illiteracy(tafraout.code, "female"), illiteracy(tiznit.code, "female")], tools: ["get_indicators"], maxCalls: 5 },
  },
  {
    id: "jobless-50k",
    category: "indicators",
    question: "Among communes of more than 50,000 people, where is unemployment highest?",
    expect: { names: [[jobless.name.fr]], numbers: [labour(jobless.code).unemploymentRate!], tools: ["list_communes"], maxCalls: 3 },
  },
  {
    id: "azilal-water",
    category: "indicators",
    question: "What share of households in Azilal province have running water?",
    expect: { numbers: [homes(azilal.code).total!.amenities!.runningWater!], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "tiznit-driest",
    category: "indicators",
    question: "Which commune in Tiznit province has the lowest share of households with running water?",
    expect: { names: [[driest.name.fr]], tools: ["list_communes"], maxCalls: 3 },
  },
  {
    id: "hoceima-languages",
    category: "indicators",
    question: "Which local languages do people use in the commune of Al Hoceima, and in what shares?",
    expect: {
      numbers: [people(hoceima.code).total!.all!.localLanguages!.tarifit!, people(hoceima.code).total!.all!.localLanguages!.darija!],
      tools: ["get_indicators"],
      maxCalls: 3,
    },
  },
  {
    id: "tafraout-tachelhit",
    category: "indicators",
    question: "What percentage of people in Tafraout use Tachelhit?",
    expect: { numbers: [people(tafraout.code).total!.all!.localLanguages!.tachelhit!], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "taroudannt-rural-women",
    category: "indicators",
    question: "In the rural part of Taroudannt province, what is the illiteracy rate among women aged 10 and over?",
    expect: { numbers: [illiteracy(taroudannt.code, "female", "rural")], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "casablanca-household",
    category: "indicators",
    question: "What's the average household size in the commune of Casablanca?",
    expect: { numbers: [homes(casablanca.code).total!.households!.averageSize!], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "women-at-work",
    category: "indicators",
    question: "Which of Morocco's 12 régions has the highest labour force participation among women?",
    expect: { names: [[womenAtWork.name.fr]], numbers: [labour(womenAtWork.code, "female").activityRate!], tools: ["get_indicators"], maxCalls: 3 },
  },
  {
    id: "assilah-since-2014",
    category: "indicators",
    question: "In the commune of Assilah, how did illiteracy change between the 2014 and 2024 censuses?",
    expect: {
      numbers: [illiteracy2014(assilah.code)!, illiteracy(assilah.code)],
      tools: ["get_indicators"],
      maxCalls: 3,
    },
  },
  {
    id: "illiteracy-fell-most",
    category: "indicators",
    question:
      "Among communes of Tanger-Tétouan-Al Hoceima with more than 20,000 people, where did illiteracy fall the most between the 2014 and 2024 censuses?",
    expect: {
      names: [[fellMost.name.fr]],
      tools: ["list_communes"],
      maxCalls: 4,
    },
  },
  {
    id: "casablanca-2014",
    category: "coverage",
    question: "What was the illiteracy rate in the commune of Casablanca at the 2014 census?",
    expect: { pattern: /arrondissement/i, maxCalls: 4 },
  },
  {
    id: "casablanca-arrondissements",
    category: "coverage",
    question: "Which arrondissement of Casablanca has the most people, and how many?",
    expect: { names: [[casaArrondissements[0]!.name.fr]], numbers: [pop(casaArrondissements[0]!)], maxCalls: 3 },
  },
  {
    id: "taroudannt-cercles",
    category: "coverage",
    question: "How many cercles does Taroudannt province have?",
    expect: { numbers: [cercles.filter((c) => c.provinceCode === taroudannt.code).length], maxCalls: 4 },
  },
  {
    id: "tiznit-businesses",
    category: "economy",
    question: "How many businesses are there in the commune of Tiznit, and how many permanent jobs do they hold?",
    expect: {
      numbers: [counts(tiznit.code).establishments!.business!, counts(tiznit.code).establishments!.jobs!],
      tools: ["get_economy"],
      maxCalls: 3,
    },
  },
  {
    id: "most-jobs",
    category: "economy",
    question: "Which commune in Morocco has the most permanent jobs in its businesses?",
    expect: {
      names: [[mostJobs.name.fr]],
      numbers: [mostJobs.topics.establishments!.jobs!],
      tools: ["list_communes"],
      maxCalls: 3,
    },
  },
  {
    id: "morocco-commerce",
    category: "economy",
    question: "How many of Morocco's businesses are in commerce?",
    expect: { numbers: [nationalEconomy.topics.sector!.commerce!], tools: ["get_economy"], maxCalls: 2 },
  },
  {
    id: "casablanca-establishments",
    category: "economy",
    question: "How many establishments were mapped in the commune of Casablanca?",
    // The census counts the city by arrondissement, so the figure is a sum of its 16 and
    // the answer has to say so rather than pass it off as a count HCP published.
    expect: {
      numbers: [counts(casablanca.code).establishments!.total!],
      pattern: /arrondissement/i,
      tools: ["get_economy"],
      maxCalls: 3,
    },
  },
  {
    id: "tiznit-province-businesses",
    category: "economy",
    question: "How many businesses are there in Tiznit province?",
    expect: {
      // Tiznit is a commune and a province, and the commune's 4,731 is the wrong answer.
      numbers: [counts(tiznitProvince.code).establishments!.business!],
      tools: ["get_economy"],
      maxCalls: 3,
    },
  },
  {
    id: "busiest-arrondissement",
    category: "economy",
    question: "Which arrondissement in Morocco has the most permanent jobs in its businesses?",
    expect: {
      names: [[busiestArrondissement.name.fr, busiestArrondissement.name.fr.replace("ï", "i")]],
      numbers: [jobsIn(busiestArrondissement)],
      tools: ["get_economy"],
      maxCalls: 3,
    },
  },
  {
    id: "point-then-jobs",
    category: "geo",
    question: "I'm at 30.42, -9.60. Which commune is this, and how many permanent jobs do its businesses hold?",
    expect: async (api) => {
      const hit = (await get(api, "/api/communes/at?lat=30.42&lng=-9.60")).data as { code: string; name: { fr: string } };
      return {
        names: [[hit.name.fr]],
        numbers: [counts(hit.code).establishments!.jobs!],
        tools: ["commune_at", "get_economy"],
        maxCalls: 4,
      };
    },
  },
  {
    id: "ketama-then-and-now",
    category: "economy",
    question: "Has illiteracy in the commune of Ketama fallen since 2014, and how many businesses are there now?",
    expect: {
      numbers: [
        illiteracy(ketama.code),
        illiteracy2014(ketama.code),
        counts(ketama.code).establishments!.business!,
      ],
      tools: ["get_indicators", "get_economy"],
      maxCalls: 5,
    },
  },
  {
    id: "tafraout-income",
    category: "refusal",
    question: "What's the average household income in the commune of Tafraout?",
    expect: { pattern: /\b(no|not|n't|isn't|doesn't|unavailable|unable)\b/i, maxCalls: 4 },
  },
  {
    id: "atlantis",
    category: "refusal",
    question: "What's the population of the commune of Atlantis in Morocco?",
    expect: { pattern: /\b(no|not|n't|isn't|couldn't|can't|doesn't|unable)\b/i, maxCalls: 3 },
  },
];
