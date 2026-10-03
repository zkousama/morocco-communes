/**
 * The line a reader sees above a finding's hypotheses, in English, French and Arabic, and
 * the parts a figure is made of where it has some. Every word here is fixed; only the
 * numbers come from the data, formatted the way the site formats them.
 */
import { numbers, percent } from "../../site/src/lib/format.ts";
import type { Data, Unit } from "./data.ts";
import { EXTREME_POPULATION_FLOOR, EXTREME_TAIL_SHARE, type Finding } from "./detect.ts";
import { breakdownOf, field, FIELDS, type Level } from "./fields.ts";

type Locale = "en" | "fr" | "ar";
export type Words = { en: string; fr: string; ar: string };

const w = (en: string, fr: string, ar: string): Words => ({ en, fr, ar });

/** One phrase per key, each built from a topic's own frame. */
function frame(
  topic: string,
  en: (x: string) => string,
  fr: (x: string) => string,
  ar: (x: string) => string,
  keys: Record<string, [string, string, string]>,
): [string, Words][] {
  return Object.entries(keys).map(([key, [x, y, z]]) => [`${topic}.${key}`, w(en(x), fr(y), ar(z))]);
}

const HOUSING_TYPES: Record<string, [string, string, string]> = {
  villa: ["villas", "villas", "الفيلات"],
  apartment: ["apartments", "appartements", "الشقق"],
  traditional: ["traditional Moroccan houses", "maisons marocaines traditionnelles", "الدور المغربية التقليدية"],
  modern: ["modern Moroccan houses", "maisons marocaines modernes", "الدور المغربية العصرية"],
  sound: ["sound dwellings", "logements salubres", "المساكن اللائقة"],
  slum: ["basic houses and slums", "maisons sommaires et bidonvilles", "المساكن البدائية ودور الصفيح"],
  ruralType: ["rural-type dwellings", "logements de type rural", "المساكن من النوع القروي"],
  other: ["dwellings of other kinds", "logements d’autres types", "المساكن من أنواع أخرى"],
  precarious: ["precarious dwellings", "logements précaires", "المساكن الهشة"],
};
const HOUSING_AGES: Record<string, [string, string, string]> = {
  Under20: ["under 20 years old", "de moins de 20 ans", "التي يقل عمرها عن 20 سنة"],
  "20to49": ["20 to 49 years old", "de 20 à 49 ans", "التي عمرها من 20 إلى 49 سنة"],
  "50Plus": ["50 years or older", "de 50 ans ou plus", "التي عمرها 50 سنة فأكثر"],
};

/**
 * How each field reads as the subject of a sentence: what the figure counts, and out of
 * whom. Each is singular, so a sentence can follow it with "is" or "est de" whatever the
 * field. A field's label names a category ("Owner", "Gas") and only reads well in a table.
 * In Arabic a share opens with نسبة, which is feminine, and every other subject is
 * masculine: the verb in front of it follows that (see `verb`).
 */
const SUBJECTS = new Map<string, Words>([
  ["sex.male", w("the share of men", "la part des hommes", "نسبة الذكور")],
  ["sex.female", w("the share of women", "la part des femmes", "نسبة الإناث")],
  ...FIELDS.filter((f) => f.topic === "age").map((f): [string, Words] => [
    f.path,
    w(`the share of people ${f.label.en.toLowerCase()}`, `la part des ${f.label.fr}`, `نسبة الفئة العمرية ${f.label.ar}`),
  ]),
  ["maritalStatus.single", w("the share of people who’ve never married", "la part des célibataires", "نسبة العزاب")],
  ["maritalStatus.married", w("the share of married people", "la part des personnes mariées", "نسبة المتزوجين")],
  ["maritalStatus.divorced", w("the share of divorced people", "la part des personnes divorcées", "نسبة المطلقين")],
  ["maritalStatus.widowed", w("the share of widowed people", "la part des personnes veuves", "نسبة الأرامل")],
  ["maritalStatus.singulateMeanAgeAtMarriage", w("the average age at first marriage", "l’âge moyen au premier mariage", "متوسط السن عند الزواج الأول")],
  ["fertility.totalFertilityRate", w("fertility", "la fécondité", "المؤشر التركيبي للخصوبة")],
  [
    "fertility.completedFertility",
    w("completed fertility among women aged 45 to 49", "la descendance finale des femmes de 45 à 49 ans", "متوسط عدد الأطفال لدى النساء من 45 إلى 49 سنة"),
  ],
  ["disability.prevalence", w("the share of people with a disability", "la part des personnes en situation de handicap", "نسبة الأشخاص في وضعية إعاقة")],
  ["schooling.rate6to11", w("school enrolment at ages 6 to 11", "la scolarisation des 6-11 ans", "معدل تمدرس الأطفال من 6 إلى 11 سنة")],
  ["illiteracy.rate10Plus", w("illiteracy among people aged 10 and over", "l’analphabétisme des 10 ans et plus", "معدل الأمية لدى السكان البالغين 10 سنوات فأكثر")],
  ["illiteracy.rate15Plus", w("illiteracy among people aged 15 and over", "l’analphabétisme des 15 ans et plus", "معدل الأمية لدى السكان البالغين 15 سنة فأكثر")],
  ...frame(
    "languagesReadAndWritten",
    (x) => `the share of literate people who read and write ${x}`,
    (y) => `la part des alphabètes qui lisent et écrivent ${y}`,
    (z) => `نسبة من يقرؤون ويكتبون ${z} بين غير الأميين`,
    {
      arabic: ["Arabic", "l’arabe", "العربية"],
      amazighTifinagh: ["Amazigh in Tifinagh", "l’amazigh en tifinagh", "الأمازيغية بحرف تيفيناغ"],
      english: ["English", "l’anglais", "الإنجليزية"],
      french: ["French", "le français", "الفرنسية"],
    },
  ),
  ...frame("education", (x) => `the share of people ${x}`, (y) => `la part des personnes ${y}`, (z) => `نسبة السكان ${z}`, {
    none: ["with no schooling", "sans aucun niveau d’études", "بدون مستوى دراسي"],
    preschool: ["educated to preschool level", "de niveau préscolaire", "ذوي مستوى التعليم الأولي"],
    primary: ["educated to primary level", "de niveau primaire", "ذوي المستوى الابتدائي"],
    lowerSecondary: ["educated to lower secondary level", "de niveau secondaire collégial", "ذوي مستوى الثانوي الإعدادي"],
    upperSecondary: ["educated to upper secondary level", "de niveau secondaire qualifiant", "ذوي مستوى الثانوي التأهيلي"],
    higher: ["with higher education", "de niveau supérieur", "ذوي مستوى التعليم العالي"],
  }),
  ...frame("localLanguages", (x) => `the share of people who speak ${x}`, (y) => `la part des personnes qui parlent ${y}`, (z) => `نسبة السكان الذين يتحدثون ${z}`, {
    darija: ["Darija", "la darija", "الدارجة"],
    tachelhit: ["Tachelhit", "le tachelhit", "تشلحيت"],
    tamazight: ["Tamazight", "le tamazight", "تمازيغت"],
    tarifit: ["Tarifit", "le tarifit", "تريفيت"],
    hassania: ["Hassania", "le hassania", "الحسانية"],
  }),
  ["labour.activityRate", w("labour force participation among people aged 15 and over", "le taux d’activité des 15 ans et plus", "معدل النشاط لدى السكان البالغين 15 سنة فأكثر")],
  ["labour.unemploymentRate", w("unemployment", "le chômage", "معدل البطالة")],
  ...frame("employmentStatus", (x) => `the share of workers ${x}`, (y) => `la part des ${y}`, (z) => `نسبة ${z} بين النشيطين المشتغلين`, {
    employer: ["who are employers", "employeurs parmi les actifs occupés", "المشغلين"],
    selfEmployed: ["who are self-employed", "indépendants parmi les actifs occupés", "المستقلين"],
    publicSector: ["employed in the public sector", "salariés du public parmi les actifs occupés", "أجراء القطاع العام"],
    privateSector: ["employed in the private sector", "salariés du privé parmi les actifs occupés", "أجراء القطاع الخاص"],
    familyWorker: ["who are unpaid family workers", "aides familiaux parmi les actifs occupés", "المساعدين العائليين"],
    apprentice: ["who are apprentices", "apprentis parmi les actifs occupés", "المتعلمين لحرفة"],
    cooperativeMember: ["who are cooperative members or partners", "coopérateurs et associés parmi les actifs occupés", "أعضاء التعاونيات والشركاء"],
    other: ["with another status", "actifs occupés d’un autre statut", "ذوي حالة أخرى في المهنة"],
  }),
  ...frame("commute", (x) => `the share of workers who ${x}`, (y) => `la part des actifs occupés qui ${y}`, (z) => `نسبة النشيطين المشتغلين الذين ${z}`, {
    walking: ["get to work on foot", "vont au travail à pied", "يتنقلون إلى العمل مشيا"],
    bikeOrMotorcycle: ["get to work by bicycle or motorcycle", "vont au travail à vélo ou à moto", "يتنقلون إلى العمل بالدراجة أو الدراجة النارية"],
    privateCar: ["get to work by car", "vont au travail en voiture", "يتنقلون إلى العمل بالسيارة"],
    bus: ["get to work by bus", "vont au travail en bus", "يتنقلون إلى العمل بالحافلة"],
    taxi: ["get to work by taxi", "vont au travail en taxi", "يتنقلون إلى العمل بسيارة الأجرة"],
    employerTransport: ["get to work in transport laid on by their employer", "vont au travail par un transport de l’employeur", "يتنقلون إلى العمل بنقل يوفره المشغل"],
    train: ["get to work by train", "vont au travail en train", "يتنقلون إلى العمل بالقطار"],
    tram: ["get to work by tram", "vont au travail en tram", "يتنقلون إلى العمل بالترامواي"],
    informalTransport: ["get to work by informal transport", "vont au travail par un transport informel", "يتنقلون إلى العمل بالنقل غير المهيكل"],
    animal: ["ride an animal to work", "vont au travail à dos d’animal", "يتنقلون إلى العمل على ظهر دابة"],
    other: ["get to work some other way", "vont au travail par un autre moyen", "يتنقلون إلى العمل بوسيلة أخرى"],
    noTravel: ["don’t travel to work", "ne se déplacent pas pour travailler", "لا يتنقلون إلى العمل"],
  }),
  ["households.averageSize", w("average household size", "la taille moyenne des ménages", "متوسط حجم الأسر")],
  ["households.peoplePerRoom", w("the average number of people per room", "le nombre moyen de personnes par pièce", "متوسط عدد الأفراد في الغرفة")],
  ["households.distanceToPavedRoadKm", w("the average distance to a paved road", "la distance moyenne à une route goudronnée", "متوسط المسافة إلى طريق معبدة")],
  ...frame("dwellingType", (x) => `the share of households living in ${x}`, (y) => `la part des ménages vivant dans ${y}`, (z) => `نسبة الأسر التي تسكن ${z}`, {
    villa: ["a villa or a floor of one", "une villa ou un étage de villa", "فيلا أو طابقا في فيلا"],
    apartment: ["an apartment", "un appartement", "شقة"],
    moroccanHouse: ["a Moroccan house", "une maison marocaine", "دارا مغربية"],
    basicOrSlum: ["a basic house or a slum", "une maison sommaire ou un bidonville", "مسكنا بدائيا أو في دور الصفيح"],
    rural: ["a rural dwelling", "un logement rural", "مسكنا قرويا"],
    other: ["another kind of dwelling", "un autre type de logement", "نوعا آخر من المساكن"],
  }),
  ...frame("occupancy", (x) => `the share of households ${x}`, (y) => `la part des ménages ${y}`, (z) => `نسبة الأسر ${z}`, {
    owner: ["that own their home", "propriétaires", "المالكة لمسكنها"],
    tenant: ["that rent their home", "locataires", "المكترية لمسكنها"],
    other: ["housed some other way", "logés autrement", "التي تسكن بصفة أخرى"],
  }),
  ...frame("dwellingAge", (x) => `the share of households in homes ${x}`, (y) => `la part des ménages dans un logement ${y}`, (z) => `نسبة الأسر في مساكن ${z}`, {
    under10: ["under 10 years old", "de moins de 10 ans", "يقل عمرها عن 10 سنوات"],
    "10-19": ["10 to 19 years old", "de 10 à 19 ans", "عمرها من 10 إلى 19 سنة"],
    "20-49": ["20 to 49 years old", "de 20 à 49 ans", "عمرها من 20 إلى 49 سنة"],
    "50+": ["50 years or older", "de 50 ans ou plus", "عمرها 50 سنة فأكثر"],
  }),
  ...frame("amenities", (x) => `the share of households with ${x}`, (y) => `la part des ménages disposant ${y}`, (z) => `نسبة الأسر التي تتوفر على ${z}`, {
    kitchen: ["a kitchen", "d’une cuisine", "مطبخ"],
    toilet: ["a toilet", "de toilettes", "مرحاض"],
    bathroom: ["a bathroom or shower room", "d’une salle d’eau", "حمام أو رشاشة"],
    electricity: ["electricity", "de l’électricité", "الكهرباء"],
    runningWater: ["running water", "de l’eau courante", "الماء الجاري"],
  }),
  ...frame("wastewater", (x) => `the share of households ${x}`, (y) => `la part des ménages ${y}`, (z) => `نسبة الأسر ${z}`, {
    publicSewer: ["on the public sewer", "raccordés au réseau public d’assainissement", "المرتبطة بشبكة التطهير السائل"],
    septicTank: ["with a septic tank", "équipés d’une fosse septique", "التي تتوفر على حفرة صحية"],
    other: ["getting rid of wastewater some other way", "qui évacuent leurs eaux usées autrement", "التي تصرف المياه العادمة بطريقة أخرى"],
  }),
  ...frame("householdWaste", (x) => `the share of households ${x}`, (y) => `la part des ménages ${y}`, (z) => `نسبة الأسر ${z}`, {
    municipalBin: ["using a municipal bin", "qui utilisent un bac de la commune", "التي تستعمل حاوية الجماعة"],
    truck: ["whose waste goes on a municipal or private truck", "dont les ordures partent par camion", "التي تجمع نفاياتها بالشاحنة"],
    inTheOpen: ["dumping waste in the open", "qui jettent leurs ordures dans la nature", "التي ترمي نفاياتها في الطبيعة"],
    other: ["getting rid of waste some other way", "qui se débarrassent de leurs ordures autrement", "التي تتخلص من نفاياتها بطريقة أخرى"],
  }),
  ...frame("cookingFuel", (x) => `the share of households cooking with ${x}`, (y) => `la part des ménages qui cuisinent ${y}`, (z) => `نسبة الأسر التي تطهو ${z}`, {
    gas: ["gas", "au gaz", "بالغاز"],
    electricity: ["electricity", "à l’électricité", "بالكهرباء"],
    charcoal: ["charcoal", "au charbon", "بالفحم"],
    firewood: ["firewood", "au bois", "بالحطب"],
    other: ["another fuel", "avec un autre combustible", "بوقود آخر"],
  }),
  ...frame("housing.occupancy", (x) => `the share of urban dwellings ${x}`, (y) => `la part des logements urbains ${y}`, (z) => `نسبة المساكن الحضرية ${z}`, {
    occupied: ["that are occupied", "occupés", "المأهولة"],
    vacant: ["that are vacant", "vacants", "الشاغرة"],
    seasonal: ["that are second or seasonal homes", "secondaires ou saisonniers", "الثانوية أو الموسمية"],
    unoccupied: ["standing empty", "inoccupés", "غير المأهولة"],
  }),
  ...frame("housing.type", (x) => `the share of urban dwellings ${x}`, (y) => `la part des logements urbains ${y}`, (z) => `نسبة المساكن الحضرية ${z}`, {
    villa: ["that are villas", "qui sont des villas", "من نوع فيلا"],
    apartment: ["that are apartments", "qui sont des appartements", "من نوع شقة"],
    traditional: ["that are traditional Moroccan houses", "qui sont des maisons marocaines traditionnelles", "من نوع دار مغربية تقليدية"],
    modern: ["that are modern Moroccan houses", "qui sont des maisons marocaines modernes", "من نوع دار مغربية عصرية"],
    sound: ["that are sound", "salubres", "اللائقة"],
    slum: ["that are basic houses or slums", "qui sont des maisons sommaires ou des bidonvilles", "من نوع مسكن بدائي أو دور الصفيح"],
    ruralType: ["of a rural type", "de type rural", "من النوع القروي"],
    other: ["of another kind", "d’un autre type", "من نوع آخر"],
    precarious: ["that are precarious", "précaires", "الهشة"],
  }),
  ...frame("housing.age", (x) => `the share of urban dwellings ${x}`, (y) => `la part des logements urbains ${y}`, (z) => `نسبة المساكن الحضرية ${z}`, {
    under20: ["under 20 years old", "de moins de 20 ans", "التي يقل عمرها عن 20 سنة"],
    "20-49": ["20 to 49 years old", "de 20 à 49 ans", "التي عمرها من 20 إلى 49 سنة"],
    "50+": ["50 years or older", "de 50 ans ou plus", "التي عمرها 50 سنة فأكثر"],
  }),
  // Each is a share of its own type, not of every dwelling: a town's villas, say, split by age.
  ...Object.entries(HOUSING_TYPES).flatMap(([type, [typeEn, typeFr, typeAr]]) =>
    Object.entries(HOUSING_AGES).map(([age, [ageEn, ageFr, ageAr]]): [string, Words] => [
      `housing.ageByType.${type}${age}`,
      w(`the share of ${typeEn} that are ${ageEn}`, `la part des ${typeFr} ${ageFr}`, `نسبة ${typeAr} ${ageAr}`),
    ]),
  ),
  ...frame("housing.walls", (x) => `the share of urban dwellings with walls of ${x}`, (y) => `la part des logements urbains aux murs ${y}`, (z) => `نسبة المساكن الحضرية ذات جدران ${z}`, {
    concreteOrBrick: ["reinforced concrete or brick", "en béton armé ou en briques", "من الإسمنت المسلح أو الآجر"],
    stone: ["stone", "en pierre", "من الحجر"],
    other: ["other materials", "faits d’autres matériaux", "من مواد أخرى"],
  }),
  ...frame("housing.roofs", (x) => `the share of urban dwellings with ${x}`, (y) => `la part des logements urbains ${y}`, (z) => `نسبة المساكن الحضرية ذات ${z}`, {
    slab: ["a concrete slab roof", "au toit en dalle", "سقف من الإسمنت المسلح"],
    woodOrTiles: ["a roof of boards, wood or tiles", "au toit en planches, bois ou tuiles", "سقف من الألواح أو الخشب أو القرميد"],
    sheetMetal: ["a roof of cement or zinc sheeting", "au toit en tôle de ciment ou de zinc", "سقف من صفائح الإسمنت أو الزنك"],
    other: ["a roof of other materials", "au toit fait d’autres matériaux", "سقف من مواد أخرى"],
  }),
  ...frame(
    "housing.networks",
    (x) => `the share of urban dwellings on the public ${x} network`,
    (y) => `la part des logements urbains raccordés au réseau public ${y}`,
    (z) => `نسبة المساكن الحضرية المرتبطة بالشبكة العمومية ${z}`,
    {
      electricity: ["electricity", "d’électricité", "للكهرباء"],
      water: ["water", "d’eau", "للماء"],
      sewerage: ["sewerage", "d’assainissement", "للتطهير السائل"],
    },
  ),
  ["housing.dwellings.deficitRate", w("the housing shortfall", "le déficit en logements", "معدل العجز السكني")],
  ["economy.per1000.establishments", w("the number of establishments mapped", "le nombre d’établissements recensés", "عدد المؤسسات المحصاة")],
  ["economy.per1000.jobs", w("the number of permanent jobs in businesses", "le nombre d’emplois permanents dans les entreprises", "عدد مناصب الشغل القارة في المقاولات")],
  ["economy.perBusiness.jobs", w("the number of permanent jobs per business", "le nombre d’emplois permanents par entreprise", "عدد مناصب الشغل القارة لكل مقاولة")],
  ...frame("economy.share.sector", (x) => `the share of businesses in ${x}`, (y) => `la part des entreprises dans ${y}`, (z) => `نسبة المقاولات في ${z}`, {
    industry: ["industry", "l’industrie", "الصناعة"],
    construction: ["construction", "la construction", "البناء"],
    commerce: ["commerce", "le commerce", "التجارة"],
    services: ["services", "les services", "الخدمات"],
  }),
  ...frame("economy.share.size", (x) => `the share of businesses ${x}`, (y) => `la part des entreprises ${y}`, (z) => `نسبة المقاولات التي تشغل ${z}`, {
    "1": ["with one person", "d’une seule personne", "شخصا واحدا"],
    "2-3": ["with 2 to 3 people", "de 2 à 3 personnes", "من 2 إلى 3 أشخاص"],
    "4-9": ["with 4 to 9 people", "de 4 à 9 personnes", "من 4 إلى 9 أشخاص"],
    "10-49": ["with 10 to 49 people", "de 10 à 49 personnes", "من 10 إلى 49 شخصا"],
    "50+": ["with 50 people or more", "de 50 personnes ou plus", "50 شخصا فأكثر"],
  }),
  ...frame("economy.share.founded", (x) => `the share of businesses founded ${x}`, (y) => `la part des entreprises créées ${y}`, (z) => `نسبة المقاولات المحدثة ${z}`, {
    before1956: ["before 1956", "avant 1956", "قبل 1956"],
    "1956-1980": ["between 1956 and 1980", "entre 1956 et 1980", "بين 1956 و1980"],
    "1981-1990": ["between 1981 and 1990", "entre 1981 et 1990", "بين 1981 و1990"],
    "1991-2000": ["between 1991 and 2000", "entre 1991 et 2000", "بين 1991 و2000"],
    "2001-2010": ["between 2001 and 2010", "entre 2001 et 2010", "بين 2001 و2010"],
    "2011-2019": ["between 2011 and 2019", "entre 2011 et 2019", "بين 2011 و2019"],
    "2020+": ["in 2020 or later", "en 2020 ou après", "سنة 2020 أو بعدها"],
  }),
]);

/** A field as the subject of a sentence, or null for a field no phrase was written for. */
export function subjectOf(path: string): Words | null {
  return SUBJECTS.get(path) ?? null;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The subject a line opens with; a field with no phrase falls back on its label. */
export function opening(path: string): Words {
  const words = subjectOf(path) ?? field(path)?.label ?? w(path, path, path);
  return w(capitalise(words.en), capitalise(words.fr), words.ar);
}

/**
 * The verb an Arabic line opens with, matched to its subject: a share (نسبة) is feminine,
 * and every other subject written above is masculine.
 */
const verb = (subject: string, masculine: string, feminine: string): string => (subject.startsWith("نسبة") ? feminine : masculine);

/** A figure with its unit, the way the site writes it: shares to one decimal, fertility to 2. */
function amount(unit: string, value: number, locale: Locale): string {
  const one = numbers(locale, 1, true).format(value);
  switch (unit) {
    case "percent":
      return percent(locale, value, { fixed: true });
    case "births per woman": {
      const two = numbers(locale, 2, true).format(value);
      if (locale === "ar") return `${two} طفل لكل امرأة`;
      // French keeps "enfant" singular below 2, as INSEE writes 1,68 enfant par femme.
      return locale === "fr" ? `${two} ${value < 2 ? "enfant" : "enfants"} par femme` : `${two} children per woman`;
    }
    case "per 1,000 people":
      if (locale === "ar") return `${one} لكل ${numbers("ar").format(1000)} نسمة`;
      return locale === "fr" ? `${one} pour ${numbers("fr").format(1000)} habitants` : `${one} per 1,000 people`;
    case "years":
      return `${one} ${{ en: "years", fr: "ans", ar: "سنة" }[locale]}`;
    case "people per household":
      return `${one} ${{ en: "people", fr: "personnes", ar: "فرد" }[locale]}`;
    case "km":
      return `${one} ${locale === "ar" ? "كلم" : "km"}`;
    case "people per room":
    case "jobs per business":
      return one; // the subject already says what's counted
    default:
      return unit ? `${one} ${unit}` : one;
  }
}

/** A field's figure with its unit, as a line writes it; exported so the site's context lines write it the same way. */
export const figure = (path: string, value: number, locale: Locale): string => amount(field(path)?.unit ?? "", value, locale);

const PLURAL: Record<Level, Words> = {
  region: w("régions", "régions", "الجهات"),
  province: w("provinces", "provinces", "الأقاليم"),
  commune: w("communes", "communes", "الجماعات"),
  arrondissement: w("arrondissements", "arrondissements", "المقاطعات"),
};

/** A gap sets a commune against its province and a province against its région. */
const ACROSS_PARENT: Record<Level, Words> = {
  region: w("across Morocco", "dans tout le Maroc", "على الصعيد الوطني"),
  province: w("across its région", "dans sa région", "على صعيد الجهة"),
  commune: w("across its province", "dans sa province", "على صعيد الإقليم"),
  arrondissement: w("across its commune", "dans sa commune", "على صعيد الجماعة"),
};

const NO_NEIGHBOUR: Record<Level, Words> = {
  region: w("no other région", "aucune autre région", "أي جهة أخرى"),
  province: w("no other province in its région", "aucune autre province de sa région", "أي إقليم آخر في الجهة"),
  commune: w("no neighbouring commune", "aucune commune voisine", "أي جماعة مجاورة"),
  arrondissement: w("no other arrondissement in its city", "aucun autre arrondissement de sa ville", "أي مقاطعة أخرى في المدينة"),
};

// The tail and the population floor detect.ts picks extremes from, as the site writes them.
const tail = (locale: Locale) => percent(locale, EXTREME_TAIL_SHARE * 100, { digits: 0 });
const floor = (locale: Locale) => numbers(locale).format(EXTREME_POPULATION_FLOOR);
const EXTREME_TAIL = w(tail("en"), tail("fr"), tail("ar"));
const EXTREME_FLOOR = w(floor("en"), floor("fr"), floor("ar"));

/**
 * The mean change since 2014 across a level, taken over the same units detect.ts scores a
 * change against: every unit with both figures, bar the crosswalk-matched communes.
 */
const meanChanges = new WeakMap<Data, Map<string, number | null>>();
function meanChange(data: Data, level: Level, path: string): number | null {
  const cache = meanChanges.get(data) ?? new Map<string, number | null>();
  meanChanges.set(data, cache);
  const key = `${level}|${path}`;
  if (cache.has(key)) return cache.get(key)!;
  const changes = (data.byLevel.get(level) ?? [])
    .filter((u) => u.basis !== "crosswalk")
    .map((u) => changeOf(u, path))
    .filter((c): c is number => c !== null);
  const mean = changes.length > 0 ? changes.reduce((sum, c) => sum + c, 0) / changes.length : null;
  cache.set(key, mean);
  return mean;
}

function changeOf(unit: Unit, path: string): number | null {
  const a = unit.figures.y2014[path];
  const b = unit.figures.y2024[path];
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

/** A change finding's 2 figures, read off the unit, or worked back from the change when one is missing. */
function endpoints(finding: Finding, data: Data): { from: number; to: number } | null {
  const unit = data.units.get(finding.code);
  const a = unit?.figures.y2014[finding.measure];
  const b = unit?.figures.y2024[finding.measure];
  const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  if (known(a) && known(b)) return { from: a, to: b };
  if (known(b)) return { from: b - finding.value, to: b };
  if (known(a)) return { from: a, to: a + finding.value };
  return null;
}

function extremeLine(finding: Finding, s: Words): Words {
  const high = finding.direction === "high";
  const en = `${s.en} is ${figure(finding.measure, finding.value, "en")}, among the ${high ? "highest" : "lowest"} ${EXTREME_TAIL.en} of communes of ${EXTREME_FLOOR.en} people or more.`;
  const fr = `${s.fr} est de ${figure(finding.measure, finding.value, "fr")}, parmi les ${EXTREME_TAIL.fr} les plus ${high ? "élevés" : "bas"} des communes de ${EXTREME_FLOOR.fr} habitants ou plus.`;
  const ar = `${verb(s.ar, "يبلغ", "تبلغ")} ${s.ar} ${figure(finding.measure, finding.value, "ar")}، ضمن ${high ? "أعلى" : "أدنى"} ${EXTREME_TAIL.ar} بين الجماعات التي يبلغ عدد سكانها ${EXTREME_FLOOR.ar} نسمة أو أكثر.`;
  return w(en, fr, ar);
}

function gapLine(finding: Finding, s: Words): Words {
  const parent = ACROSS_PARENT[finding.level];
  const en = `${s.en} is ${figure(finding.measure, finding.value, "en")}, against ${figure(finding.measure, finding.reference, "en")} ${parent.en}.`;
  const fr = `${s.fr} est de ${figure(finding.measure, finding.value, "fr")}, contre ${figure(finding.measure, finding.reference, "fr")} ${parent.fr}.`;
  const ar = `${verb(s.ar, "يبلغ", "تبلغ")} ${s.ar} ${figure(finding.measure, finding.value, "ar")}، مقابل ${figure(finding.measure, finding.reference, "ar")} ${parent.ar}.`;
  return w(en, fr, ar);
}

function artefactLine(finding: Finding, s: Words, data: Data): Words {
  const none = NO_NEIGHBOUR[finding.level];
  const went = moved(finding, s, data);
  return w(
    `${went.en}, a swing ${none.en} shares, which may be an error in the data.`,
    `${went.fr}, une variation qu’${none.fr} ne partage et qui pourrait être une erreur dans les données.`,
    `${went.ar}، وهو تغير لا يظهر في ${none.ar} وقد يكون خطأ في البيانات.`,
  );
}

/** "X went from a in 2014 to b in 2024", or, without the unit's figures, just that it changed. */
function moved(finding: Finding, s: Words, data: Data): Words {
  const ends = endpoints(finding, data);
  if (!ends) {
    return w(`${s.en} changed between 2014 and 2024`, `${s.fr} évolue entre 2014 et 2024`, `${verb(s.ar, "تغير", "تغيرت")} ${s.ar} بين 2014 و2024`);
  }
  const [a, b] = [ends.from, ends.to];
  return w(
    `${s.en} went from ${figure(finding.measure, a, "en")} in 2014 to ${figure(finding.measure, b, "en")} in 2024`,
    `${s.fr} passe de ${figure(finding.measure, a, "fr")} en 2014 à ${figure(finding.measure, b, "fr")} en 2024`,
    `${verb(s.ar, "انتقل", "انتقلت")} ${s.ar} من ${figure(finding.measure, a, "ar")} سنة 2014 إلى ${figure(finding.measure, b, "ar")} سنة 2024`,
  );
}

/**
 * A change, set against the level's own mean change: a bigger or a smaller rise or fall
 * than the rest moved, or a move against the way the rest went. A finding sits 3 standard
 * deviations or more from that mean, so it's always far from it.
 */
function changeLine(finding: Finding, s: Words, data: Data): Words {
  const ends = endpoints(finding, data);
  const change = ends ? ends.to - ends.from : finding.value;
  const others = PLURAL[finding.level];
  const mean = meanChange(data, finding.level, finding.measure) ?? 0;
  const rest = mean >= 0 ? w("rise", "hausse", "ارتفاع") : w("fall", "baisse", "انخفاض");

  if (ends && figure(finding.measure, ends.from, "en") === figure(finding.measure, ends.to, "en")) {
    const held = (locale: Locale) => figure(finding.measure, ends.from, locale);
    return w(
      `${s.en} stayed at ${held("en")} from 2014 to 2024, against an average ${rest.en} in other ${others.en}.`,
      `${s.fr} reste à ${held("fr")} en 2014 comme en 2024, contre une ${rest.fr} moyenne dans les autres ${others.fr}.`,
      `${verb(s.ar, "استقر", "استقرت")} ${s.ar} عند ${held("ar")} بين 2014 و2024، مقابل ${rest.ar} في المتوسط في باقي ${others.ar}.`,
    );
  }
  const went = moved(finding, s, data);
  if (mean !== 0 && Math.sign(change) !== Math.sign(mean)) {
    return w(
      `${went.en}, against an average ${rest.en} in other ${others.en}.`,
      `${went.fr}, contre une ${rest.fr} moyenne dans les autres ${others.fr}.`,
      `${went.ar}، مقابل ${rest.ar} في المتوسط في باقي ${others.ar}.`,
    );
  }
  const bigger = Math.abs(change) > Math.abs(mean);
  const way = change > 0 ? w("rise", "hausse", "ارتفاع") : w("fall", "baisse", "انخفاض");
  return w(
    `${went.en}, a far ${bigger ? "bigger" : "smaller"} ${way.en} than in other ${others.en}.`,
    `${went.fr}, une ${way.fr} bien plus ${bigger ? "forte" : "faible"} que dans les autres ${others.fr}.`,
    `${went.ar}، وهو ${way.ar} ${bigger ? "أكبر" : "أقل"} بكثير مما سجلته باقي ${others.ar}.`,
  );
}

export function findingLine(finding: Finding, data: Data): Words {
  const s = opening(finding.measure);
  if (finding.kind === "extreme") return extremeLine(finding, s);
  if (finding.kind === "gap") return gapLine(finding, s);
  if (finding.kind === "artefact") return artefactLine(finding, s, data);
  return changeLine(finding, s, data);
}

/**
 * What the finding's figure is made of, from the unit's own 2024 figures: vacant plus second
 * homes for empty dwellings, say. Null when the measure has no listed parts, or when a part's
 * figure is missing, since a breakdown with a hole in it would misstate the whole.
 */
export function breakdown(finding: Finding, data: Data): { field: string; label: Words; value: number }[] | null {
  const parts = breakdownOf(finding.measure);
  const unit = data.units.get(finding.code);
  if (!parts || !unit) return null;
  const rows = parts.map((path) => ({ field: path, label: field(path)?.label, value: unit.figures.y2024[path] }));
  if (rows.some((r) => !r.label || r.value == null || !Number.isFinite(r.value))) return null;
  return rows.map((r) => ({ field: r.field, label: { en: r.label!.en, fr: r.label!.fr, ar: r.label!.ar }, value: r.value! }));
}
