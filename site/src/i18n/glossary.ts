import type { Locale } from "./ui";

/**
 * What the words on this site mean.
 *
 * Where HCP defines a term itself, `hcp` carries its own wording from the workbook and
 * the English entry renders it rather than replacing it. Where it doesn't, the entry says
 * what the dataset holds and what the build checks, so nothing here is a definition
 * invented for the page.
 */

export interface Entry {
  id: string;
  term: string;
  body: string;
  /** HCP's own words, from the workbook that defines the term. */
  hcp?: string;
}

export interface Group {
  id: string;
  label: string;
  entries: Entry[];
}

const HCP_DWELLING =
  "Un logement est constitué d’une ou plusieurs pièces destinées à l’habitation et disposant d’une ou plusieurs entrées directes. Un logement peut ne pas avoir été construit à l’origine pour l’habitation.";

export const glossary: Record<Locale, { title: string; description: string; lede: string; source: string; groups: Group[] }> = {
  en: {
    title: "Glossary",
    description: "What the words on this site mean: the units, the census figures, the establishments and the dwellings.",
    lede: "What the words mean. Where HCP defines one, this gives HCP's own wording.",
    source: "HCP, RGPH 2024",
    groups: [
      {
        id: "units",
        label: "The units",
        entries: [
          {
            id: "region",
            term: "Région",
            body: "The top level, 12 of them. Its code is the first group of every code below it, so 01.511.01.0 is in région 01.",
          },
          {
            id: "province",
            term: "Province, préfecture",
            body: "The level under a région, 83 in all. A préfecture is the urban kind; each record keeps HCP's own word for it in `type`.",
          },
          {
            id: "prefecture-of-arrondissements",
            term: "Préfecture d’arrondissements",
            body: "8 units inside the préfecture of Casablanca, each holding 2 or 3 of its arrondissements. They sit at the province level with a longer code, 06.141.01.00 to 06.141.01.70.",
          },
          {
            id: "cercle",
            term: "Cercle",
            body: "Groups the rural communes of a province, 213 of them. An urban commune belongs to none, so its `cercle` is null.",
          },
          {
            id: "commune",
            term: "Commune",
            body: "The unit this dataset is built around, 1,503 of them. An urban one is a municipalité and a rural one a commune rurale; `type` says which.",
          },
          {
            id: "arrondissement",
            term: "Arrondissement",
            body: "A district of one of the 6 cities divided into them: Casablanca, Rabat, Fès, Marrakech, Salé and Tanger, 41 in all. The census counts those cities by arrondissement rather than as one place, which is why a city's own figures are marked as a sum of theirs.",
          },
          {
            id: "urban-centre",
            term: "Urban centre",
            body: "The built-up part of a rural commune. The census gives 164 of them figures of their own, inside the commune that holds them.",
          },
          {
            id: "code",
            term: "HCP code",
            body: "The identifier of a unit, written 01.511.01.0. The same code is also 001511010 padded to 9 digits and 1511010 with the leading zeros dropped, which is how it arrives in HCP's spreadsheets. The API takes any of the three, and a slug.",
          },
        ],
      },
      {
        id: "people",
        label: "Counting people",
        entries: [
          {
            id: "legal-population",
            term: "Legal population",
            body: "The count HCP publishes as the unit's population, and the one this dataset carries as `population`. Nationally 36,828,330 in 2024.",
          },
          {
            id: "municipal-population",
            term: "Municipal population",
            body: "The count the census's own shares are taken from: men and women, and the age bands, add up to it rather than to the legal population. Nationally 36,490,591, about 338,000 fewer.",
          },
          {
            id: "household",
            term: "Household",
            body: "What the census counted as one household in a dwelling. Every household figure is per household, so a dwelling nobody lives in is in none of them; the urban dwellings section counts those.",
          },
          {
            id: "settled",
            term: "Settled households",
            body: "Households with a fixed dwelling. The amenities are given as a share of those.",
          },
          {
            id: "labour-force",
            term: "Labour force",
            body: "People aged 15 and over who are working or looking for work. The activity rate is their share of that age group, and the unemployment rate is the share of the labour force looking for work.",
          },
          {
            id: "long-questionnaire",
            term: "The long questionnaire",
            body: "Most census topics come from it. It went to every household in communes of fewer than 2,000 households, and to a random 20% of households elsewhere, so in larger communes those figures are estimates from that sample.",
          },
          {
            id: "illiteracy",
            term: "Illiteracy",
            body: "The share of people aged 10 and over who can't read or write.",
          },
          {
            id: "schooling",
            term: "Schooling",
            body: "The share of children in school. The 2024 census asks it of ages 6 to 11, the 2014 census of ages 7 to 12, which is why the two don't subtract.",
          },
        ],
      },
      {
        id: "work",
        label: "Workplaces",
        entries: [
          {
            id: "establishment",
            term: "Establishment",
            body: "A place where work happens, put on the map by the census's field teams: a business, a public service, or an association in premises of its own. It is a place rather than a company, so a firm with 3 shops is 3 establishments.",
          },
          {
            id: "business",
            term: "Business",
            body: "An establishment run for profit. Farms are out: the count covers every sector but agriculture.",
          },
          {
            id: "permanent-job",
            term: "Permanent job",
            body: "A job those businesses hold permanently. Seasonal and casual work isn't in the figure.",
          },
          {
            id: "weekly-souk",
            term: "Weekly souk",
            body: "A market that stands on one day of the week. It is counted beside the establishments rather than among them.",
          },
        ],
      },
      {
        id: "dwellings",
        label: "Dwellings",
        entries: [
          {
            id: "dwelling",
            term: "Dwelling",
            body: "One or more rooms meant to be lived in, with one or more doors of their own onto a corridor, a stairway, a courtyard, a workplace or the street. A dwelling need not have been built to be lived in: a garage turned into a home is one.",
            hcp: HCP_DWELLING,
          },
          {
            id: "villa",
            term: "Villa",
            body: "A detached building of one or two storeys, usually with a garden. It counts as a villa even if it was in other use on census day.",
            hcp: "Construction isolée de plain-pied ou à deux étages, généralement dotée d’un jardin. Une villa peut avoir un usage autre que l’habitation au moment du recensement.",
          },
          {
            id: "apartment",
            term: "Apartment",
            body: "A self-contained flat in a block, whatever it was used for on census day.",
            hcp: "Appartement dans un immeuble : appartement doit être individualisé pouvant servir différents usages (habitation, professionnel, etc.) au moment du recensement.",
          },
          {
            id: "traditional-house",
            term: "Traditional Moroccan house",
            body: "Mostly in the old medinas: rooms around a central courtyard.",
            hcp: "Majoritairement située dans les anciennes médinas, elle se caractérise par une cour centrale entourée de chambres d’habitation.",
          },
          {
            id: "modern-house",
            term: "Modern Moroccan house",
            body: "A house of one or more storeys, built to be lived in, that is neither a block of flats, nor a villa, nor a traditional house. It is the commonest kind in Morocco's towns.",
            hcp: "Construction individuelle à un ou plusieurs étages, destinée principalement à l’habitation. Sa structure ne correspond ni à celle d’un immeuble à appartements, ni d’une villa, ni d’une maison traditionnelle.",
          },
          {
            id: "slum",
            term: "Basic house or slum",
            body: "Very rough building: a gourbi, a precarious house on the edge of a town, a shack in a bidonville.",
            hcp: "Constructions très rudimentaires telles que gourbis, petites maisons précaires en périphérie urbaine, baraques dans les bidonvilles, etc.",
          },
          {
            id: "rural-dwelling",
            term: "Rural-type dwelling",
            body: "A building that puts living space and space for livestock together, and fits none of the other kinds.",
            hcp: "Comprend des constructions combinant habitation et espace pour l’élevage, ne correspondant pas aux catégories précédentes.",
          },
          {
            id: "other-dwelling",
            term: "Other",
            body: "Everything else, which includes a room lived in inside an institution such as a hotel, a school or a mosque, and premises built for something else and lived in anyway: a shop, a garage, a workshop.",
            hcp: "Tous les autres logements ne pouvant être classés dans les catégories ci-dessus.",
          },
          {
            id: "occupied",
            term: "Occupied",
            body: "Lived in by a household that usually resides there, whether or not they were home on census day.",
            hcp: "Logement habité par un ménage résident habituel au moment du recensement. Le ménage peut être présent ou temporairement absent à la date de référence.",
          },
          {
            id: "vacant",
            term: "Vacant",
            body: "Empty on census day and up for rent or for sale. Only villas, apartments and Moroccan houses can count as vacant, so an empty shack is not in this figure.",
            hcp: "Logement non occupé par un ménage au moment du recensement et destiné soit à la location, soit à la vente. Seuls les logements de type villa, appartement ou maison marocaine moderne ou traditionnelle sont considérés comme logements vacants.",
          },
          {
            id: "seasonal",
            term: "Second or seasonal home",
            body: "Used as a second home by a household whose main home is elsewhere. As with vacant dwellings, only villas, apartments and Moroccan houses count.",
            hcp: "Logement utilisé comme résidence secondaire par un ménage dont la résidence principale se situe ailleurs. Seuls les logements de type villa, appartement ou maison marocaine moderne ou traditionnelle sont pris en compte dans cette catégorie.",
          },
          {
            id: "precarious",
            term: "Sound and precarious housing",
            body: "Villas, apartments and Moroccan houses are the sound ones. Basic houses and slums, rural-type dwellings and the rest are the precarious ones. The two make the whole stock.",
          },
          {
            id: "shortfall",
            term: "Housing shortfall",
            body: "The households living in unsound dwellings, plus the households beyond the sound shared dwellings they occupy, over the sound dwellings that are occupied or vacant. Households on top and dwellings underneath, so it passes 100% where the shortfall is larger than the sound stock.",
            hcp: "Le taux de déficit quantitatif en logements est le rapport du déficit quantitatif total à la somme des logements salubres occupés et vacants. Le déficit quantitatif total est la somme de ménages vivant dans des logements insalubres et l’excédent du nombre de ménages par rapport aux logements salubres de cohabitation qu’ils occupent.",
          },
        ],
      },
      {
        id: "reading",
        label: "Reading the data",
        entries: [
          {
            id: "null",
            term: "Null",
            body: "A figure HCP doesn't publish there. The workbooks write it `…` for nothing to report, `.` for unavailable, `-` in 2014 and `_` in the housing file, and all of them arrive here as null.",
          },
          {
            id: "basis",
            term: "basis",
            body: "Where a figure came from, when it isn't a row of HCP's. `arrondissement_sum` on one of the 6 cities means it is the exact sum of that city's arrondissements, which is how the census counts it.",
          },
          {
            id: "comparable-to",
            term: "comparableTo",
            body: "On a 2014 field, the 2024 field that asks the same question, so the two subtract. A 2014 field without one has a `note` saying what changed.",
          },
          {
            id: "crosswalk",
            term: "Crosswalk",
            body: "The reconciliation of the 207 communes renumbered by the 2015 reform, which is how a commune whose code changed still has a 2014 figure. Every pairing carries the evidence for it.",
          },
          {
            id: "licence",
            term: "Which licence",
            body: "The figures are HCP's, reusable on CC BY 4.0 terms. The boundaries come from OpenStreetMap under ODbL, and so does everything drawn from them: the area, the density, the point inside a commune and which communes border which.",
          },
        ],
      },
    ],
  },
  fr: {
    title: "Glossaire",
    description: "Ce que veulent dire les mots de ce site : les unités, les chiffres du recensement, les établissements et les logements.",
    lede: "Ce que veulent dire les mots. Là où le HCP définit un terme, voici ses propres mots.",
    source: "HCP, RGPH 2024",
    groups: [
      {
        id: "units",
        label: "Les unités",
        entries: [
          { id: "region", term: "Région", body: "Le niveau le plus haut, au nombre de 12. Son code ouvre tous les codes en dessous : 01.511.01.0 est dans la région 01." },
          { id: "province", term: "Province, préfecture", body: "Le niveau sous la région, 83 en tout. La préfecture est la forme urbaine ; chaque fiche garde le mot du HCP dans `type`." },
          {
            id: "prefecture-of-arrondissements",
            term: "Préfecture d’arrondissements",
            body: "8 unités à l’intérieur de la préfecture de Casablanca, chacune regroupant 2 ou 3 de ses arrondissements. Elles sont au niveau province avec un code plus long, de 06.141.01.00 à 06.141.01.70.",
          },
          { id: "cercle", term: "Cercle", body: "Regroupe les communes rurales d’une province, 213 en tout. Une commune urbaine n’en dépend d’aucun : son `cercle` vaut null." },
          { id: "commune", term: "Commune", body: "L’unité autour de laquelle ce jeu de données est bâti, 1 503 en tout. L’urbaine est une municipalité, la rurale une commune rurale ; `type` dit laquelle." },
          {
            id: "arrondissement",
            term: "Arrondissement",
            body: "Une division de l’une des 6 villes qui en ont : Casablanca, Rabat, Fès, Marrakech, Salé et Tanger, 41 en tout. Le recensement compte ces villes par arrondissement plutôt que d’un bloc, d’où les chiffres d’une ville signalés comme une somme des leurs.",
          },
          { id: "urban-centre", term: "Centre urbain", body: "La partie agglomérée d’une commune rurale. Le recensement en dote 164 de chiffres propres, à l’intérieur de leur commune." },
          {
            id: "code",
            term: "Code HCP",
            body: "L’identifiant d’une unité, écrit 01.511.01.0. Le même code s’écrit aussi 001511010 sur 9 chiffres et 1511010 sans les zéros de tête, forme sous laquelle il arrive dans les classeurs du HCP. L’API accepte les trois, et un slug.",
          },
        ],
      },
      {
        id: "people",
        label: "Compter les habitants",
        entries: [
          { id: "legal-population", term: "Population légale", body: "Le chiffre que le HCP publie comme population de l’unité, et celui que ce jeu de données porte sous `population`. 36 828 330 au niveau national en 2024." },
          { id: "municipal-population", term: "Population municipale", body: "Le chiffre sur lequel se calculent les parts du recensement : les hommes et les femmes, et les tranches d’âge, s’y additionnent plutôt qu’à la population légale. 36 490 591, soit environ 338 000 de moins." },
          { id: "household", term: "Ménage", body: "Ce que le recensement compte comme un ménage dans un logement. Tous les chiffres de ménage sont par ménage : un logement où personne n’habite n’y figure pas, c’est la section des logements urbains qui les compte." },
          { id: "settled", term: "Ménages sédentaires", body: "Les ménages ayant un logement fixe. Les équipements sont donnés en part de ceux-là." },
          { id: "labour-force", term: "Population active", body: "Les 15 ans et plus qui travaillent ou cherchent du travail. Le taux d’activité est leur part dans cette tranche d’âge, et le taux de chômage la part de la population active qui cherche du travail." },
          {
            id: "long-questionnaire",
            term: "Le questionnaire long",
            body: "La plupart des thèmes en viennent. Il a été posé à tous les ménages dans les communes de moins de 2 000 ménages, et à 20 % des ménages tirés au hasard ailleurs : dans les grandes communes, ces chiffres sont des estimations.",
          },
          { id: "illiteracy", term: "Analphabétisme", body: "La part des 10 ans et plus qui ne savent ni lire ni écrire." },
          { id: "schooling", term: "Scolarisation", body: "La part des enfants scolarisés. Le recensement de 2024 la demande de 6 à 11 ans, celui de 2014 de 7 à 12 ans : les deux ne se soustraient donc pas." },
        ],
      },
      {
        id: "work",
        label: "Les lieux de travail",
        entries: [
          {
            id: "establishment",
            term: "Établissement",
            body: "Un lieu où l’on travaille, relevé sur le terrain par le recensement : une entreprise, un service public, ou une association dans un local à elle. C’est un lieu et non une société : une enseigne à 3 boutiques fait 3 établissements.",
          },
          { id: "business", term: "Entreprise", body: "Un établissement à but lucratif. L’agriculture n’y est pas : le comptage couvre tous les autres secteurs." },
          { id: "permanent-job", term: "Emploi permanent", body: "Un emploi que ces entreprises portent de façon permanente. Le saisonnier et l’occasionnel ne sont pas dans le chiffre." },
          { id: "weekly-souk", term: "Souk hebdomadaire", body: "Un marché qui se tient un jour par semaine. Il est compté à côté des établissements et non parmi eux." },
        ],
      },
      {
        id: "dwellings",
        label: "Les logements",
        entries: [
          { id: "dwelling", term: "Logement", body: HCP_DWELLING },
          { id: "villa", term: "Villa", body: "Construction isolée de plain-pied ou à deux étages, généralement dotée d’un jardin. Une villa peut avoir un usage autre que l’habitation au moment du recensement." },
          { id: "apartment", term: "Appartement", body: "Appartement individualisé dans un immeuble, pouvant servir différents usages au moment du recensement." },
          { id: "traditional-house", term: "Maison marocaine traditionnelle", body: "Majoritairement située dans les anciennes médinas, elle se caractérise par une cour centrale entourée de chambres d’habitation." },
          {
            id: "modern-house",
            term: "Maison marocaine moderne",
            body: "Construction individuelle à un ou plusieurs étages, destinée principalement à l’habitation. Sa structure ne correspond ni à celle d’un immeuble à appartements, ni d’une villa, ni d’une maison traditionnelle. C’est le type le plus répandu dans les villes du pays.",
          },
          { id: "slum", term: "Maison sommaire ou bidonville", body: "Constructions très rudimentaires telles que gourbis, petites maisons précaires en périphérie urbaine, baraques dans les bidonvilles." },
          { id: "rural-dwelling", term: "Logement de type rural", body: "Constructions combinant habitation et espace pour l’élevage, ne correspondant pas aux catégories précédentes." },
          {
            id: "other-dwelling",
            term: "Autre type",
            body: "Tout le reste, dont une chambre habitée dans un établissement comme un hôtel, une école ou une mosquée, et un local prévu pour autre chose et habité quand même : boutique, garage, atelier.",
          },
          { id: "occupied", term: "Logement occupé", body: "Habité par un ménage résident habituel au moment du recensement, présent ou temporairement absent à la date de référence." },
          {
            id: "vacant",
            term: "Logement vacant",
            body: "Non occupé au moment du recensement et destiné à la location ou à la vente. Seuls les logements de type villa, appartement ou maison marocaine moderne ou traditionnelle sont considérés comme vacants : une baraque vide n’est pas dans ce chiffre.",
          },
          {
            id: "seasonal",
            term: "Logement secondaire ou saisonnier",
            body: "Utilisé comme résidence secondaire par un ménage dont la résidence principale se situe ailleurs. Comme pour les vacants, seuls les villas, appartements et maisons marocaines comptent.",
          },
          { id: "precarious", term: "Logement salubre et précaire", body: "Les villas, appartements et maisons marocaines sont les logements salubres. Les maisons sommaires et bidonvilles, les logements de type rural et le reste sont les précaires. Les deux font tout le parc." },
          {
            id: "shortfall",
            term: "Déficit en logement",
            body: "Le rapport du déficit quantitatif total à la somme des logements salubres occupés et vacants. Le déficit quantitatif total est la somme des ménages vivant dans des logements insalubres et de l’excédent des ménages sur les logements salubres de cohabitation qu’ils occupent. Des ménages au numérateur et des logements au dénominateur : le taux dépasse 100 % là où le déficit est plus grand que le parc salubre.",
          },
        ],
      },
      {
        id: "reading",
        label: "Lire les données",
        entries: [
          { id: "null", term: "Null", body: "Un chiffre que le HCP ne publie pas là. Les classeurs l’écrivent `…` pour « n’ayant pas lieu de figurer », `.` pour « indisponible », `-` en 2014 et `_` dans le fichier logement : tous arrivent ici en null." },
          { id: "basis", term: "basis", body: "D’où vient un chiffre quand ce n’est pas une ligne du HCP. `arrondissement_sum` sur l’une des 6 villes veut dire qu’il est la somme exacte de ses arrondissements, façon dont le recensement la compte." },
          { id: "comparable-to", term: "comparableTo", body: "Sur un champ de 2014, le champ de 2024 qui pose la même question : les deux se soustraient. Un champ de 2014 sans cela porte un `note` qui dit ce qui a changé." },
          { id: "crosswalk", term: "Correspondance", body: "La réconciliation des 207 communes renumérotées par la réforme de 2015, grâce à laquelle une commune dont le code a changé garde un chiffre de 2014. Chaque appariement porte ce qui le justifie." },
          {
            id: "licence",
            term: "Quelle licence",
            body: "Les chiffres sont ceux du HCP, réutilisables aux conditions CC BY 4.0. Les limites viennent d’OpenStreetMap sous ODbL, et tout ce qui en découle avec elles : la superficie, la densité, le point à l’intérieur d’une commune et les communes qui se touchent.",
          },
        ],
      },
    ],
  },
};
