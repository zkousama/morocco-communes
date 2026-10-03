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
  /** What it is. In French, the entry of a term HCP defines leaves this out. */
  body?: string;
  /** The concept HCP defines in its workbook, where it defines one. Its wording is read
   * from the dataset rather than written here. */
  hcpTerm?: string;
}

export interface Group {
  id: string;
  label: string;
  entries: Entry[];
}

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
            body: "A district of one of the 6 cities divided into them: Casablanca, Rabat, Fès, Marrakech, Salé and Tanger, 41 in all. The census counts those cities by arrondissement rather than as one place. A city's own figures are a sum of theirs, and say so.",
          },
          {
            id: "urban-centre",
            term: "Urban centre",
            body: "The built-up part of a rural commune. The census gives 164 of them figures of their own, inside the commune that holds them.",
          },
          {
            id: "code",
            term: "HCP code",
            body: "The identifier of a unit, written 01.511.01.0. The same code is also 001511010 padded to 9 digits. HCP's spreadsheets drop the leading zeros and write 1511010. The API takes any of the three, and a slug. Each group of digits names a level, so a commune’s code holds its province’s and its région’s.",
          },
        ],
      },
      {
        id: "people",
        label: "Counting people",
        entries: [
          {
            id: "reference-date",
            term: "Census date",
            body: "1 September 2024. Every 2024 figure describes the country as it stood that day. The census before it was in 2014.",
            hcpTerm: "Date de référence du Recensement",
          },
          {
            id: "legal-population",
            term: "Legal population",
            body: "Everyone living in the country on census day, or intending to live there for 6 months or more. It is the municipal population plus the population counted apart, and it is the figure this dataset carries as `population`: 36,828,330 in 2024.",
            hcpTerm: "Population légale",
          },
          {
            id: "municipal-population",
            term: "Municipal population",
            body: "The settled, the nomadic and the homeless. The census's own shares are taken from it: men and women, and the age bands, add up to this rather than to the legal population. 36,490,591 in 2024, about 338,000 fewer.",
            hcpTerm: "Population municipale",
          },
          {
            id: "counted-apart",
            term: "Counted apart",
            body: "People living in an institution rather than a household: soldiers and auxiliaries in barracks, workers housed on public works sites, prisoners, people in care homes, children's homes and zaouïas, and anyone in hospital for 6 months or more. They are in the legal population and not in the municipal one, which is the difference between the two.",
            hcpTerm: "Population comptée à part",
          },
          {
            id: "household",
            term: "Household",
            body: "People living under one roof with their daily expenses in common, related or not. A household is settled, nomadic or homeless. Every household figure is per household, so a dwelling nobody lives in is in none of them.",
            hcpTerm: "Ménage",
          },
          {
            id: "settled",
            term: "Settled household",
            body: "A household that usually lives in a dwelling, as against a nomadic or a homeless one. The amenities, the rooms and the distance to a road are all given for settled households.",
            hcpTerm: "Ménage sédentaire",
          },
          {
            id: "room",
            term: "Habitable room",
            body: "A room of a dwelling meant for living or sleeping in. A kitchen, a bathroom, a toilet, a hallway, a laundry, a boxroom, an empty garage or a room used only for work is not one, so people per room counts only the rooms people live in.",
            hcpTerm: "Pièce d’habitation",
          },
          {
            id: "labour-force",
            term: "Labour force",
            body: "People aged 15 and over who are on the job market, working or looking for work: those in work, plus the unemployed. The activity rate is their share of that age group, and the unemployment rate the share of them looking for work.",
            hcpTerm: "Population active de 15 ans et plus",
          },
          {
            id: "in-work",
            term: "In work",
            body: "Anyone aged 15 and over who worked at least an hour in the week before the interview, and anyone with a job they were away from for illness, leave, a dispute, training or weather. HCP follows the International Labour Organization here.",
            hcpTerm: "Population active occupée de 15 ans et plus",
          },
          {
            id: "electricity",
            term: "Electricity, running water",
            body: "Electricity counts a dwelling on the public network, and one lit by solar power or a generator. Running water counts the public network only.",
            hcpTerm: "Part des ménages sédentaires disposant de l’électricité",
          },
          {
            id: "long-questionnaire",
            term: "The long questionnaire",
            body: "Most census topics come from it. It went to every household in communes of fewer than 2,000 households, and to a random 20% of households elsewhere, so in larger communes those figures are estimates from that sample.",
          },
          {
            id: "illiteracy",
            term: "Illiteracy",
            body: "Not being able to read or write a short, simple statement about your own daily life, and understand it. The rate is the share of people aged 10 and over.",
            hcpTerm: "Analphabète",
          },
          {
            id: "disability",
            term: "Disability",
            body: "Complete incapacity, or a lot of difficulty, in at least one of 6 areas: sight, hearing, moving about, communicating, memory and concentration, and looking after yourself.",
            hcpTerm: "Personne en situation de handicap",
          },
          {
            id: "schooling",
            term: "Schooling",
            body: "The share of children who attended a school or a training college during the year, whether or not they finished it. The 2024 rate counts ages 6 to 11 during the 2023/24 school year, which HCP says are ages 7 to 12 at the census date. The 2014 census published a rate for ages 7 to 12 and its workbook gives no basis for the band, so the dataset leaves the two apart.",
            hcpTerm: "Taux de scolarisation des 6-11 ans en 2023/2024",
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
            body: "One or more rooms meant to be lived in, with one or more doors of their own onto a corridor, a stairway, a courtyard, a workplace or the street. A dwelling need not have been built to be lived in: a garage turned into a home is one. The census indicators use a narrower one, a dwelling a household lives in as its main home. The dwellings a town has and the homes its households live in are counted apart here.",
            hcpTerm: "Le logement",
          },
          {
            id: "villa",
            term: "Villa",
            body: "A detached building of one or two storeys, usually with a garden. It counts as a villa even if it was in other use on census day.",
            hcpTerm: "Villa",
          },
          {
            id: "apartment",
            term: "Apartment",
            body: "A self-contained flat in a block, whatever it was used for on census day.",
            hcpTerm: "Appartement dans un immeuble",
          },
          {
            id: "traditional-house",
            term: "Traditional Moroccan house",
            body: "Mostly in the old medinas: rooms around a central courtyard.",
            hcpTerm: "Maison marocaine traditionnelle",
          },
          {
            id: "modern-house",
            term: "Modern Moroccan house",
            body: "A house of one or more storeys, built to be lived in, that is neither a block of flats, nor a villa, nor a traditional house. It is the commonest kind in Morocco's towns.",
            hcpTerm: "Maison marocaine moderne",
          },
          {
            id: "slum",
            term: "Basic house or slum",
            body: "Very rough building: a gourbi, a precarious house on the edge of a town, a shack in a bidonville.",
            hcpTerm: "Construction sommaire ou bidonville",
          },
          {
            id: "rural-dwelling",
            term: "Rural-type dwelling",
            body: "A building that puts living space and space for livestock together, and fits none of the other kinds.",
            hcpTerm: "Logement rural",
          },
          {
            id: "other-dwelling",
            term: "Other",
            body: "Everything else, which includes a room lived in inside an institution such as a hotel, a school or a mosque, and premises built for something else and lived in anyway: a shop, a garage, a workshop.",
            hcpTerm: "Autres types à préciser",
          },
          {
            id: "occupied",
            term: "Occupied",
            body: "Lived in by a household that usually resides there, whether or not they were home on census day.",
            hcpTerm: "Logement occupé",
          },
          {
            id: "vacant",
            term: "Vacant",
            body: "Empty on census day and up for rent or for sale. Only villas, apartments and Moroccan houses can count as vacant, so an empty shack is not in this figure.",
            hcpTerm: "Logement vacant",
          },
          {
            id: "seasonal",
            term: "Second or seasonal home",
            body: "Used as a second home by a household whose main home is elsewhere. As with vacant dwellings, only villas, apartments and Moroccan houses count.",
            hcpTerm: "Logement secondaire ou saisonnier",
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
            hcpTerm: "Taux de déficit quantitatif en logements",
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
            body: "Where a figure came from, when it isn't a row of HCP's. `arrondissement_sum` on one of the 6 cities means the exact sum of that city's arrondissements, the level the census counts those cities at.",
          },
          {
            id: "comparable-to",
            term: "comparableTo",
            body: "On a 2014 field, the 2024 field that asks the same question, so the two subtract. A 2014 field without one has a `note` saying what changed.",
          },
          {
            id: "crosswalk",
            term: "Crosswalk",
            body: "The reconciliation of the 207 communes renumbered by the 2015 reform. A commune whose code changed still has its 2014 figure, and every pairing carries the evidence for it.",
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
            body: "L’identifiant d’une unité, écrit 01.511.01.0. Le même code s’écrit aussi 001511010 sur 9 chiffres et 1511010 sans les zéros de tête, forme sous laquelle il arrive dans les classeurs du HCP. L’API accepte les trois, et un slug. Chaque groupe de chiffres nomme un niveau : le code d’une commune contient donc celui de sa province et de sa région.",
          },
        ],
      },
      {
        id: "people",
        label: "Compter les habitants",
        entries: [
          { id: "reference-date", term: "Date du recensement", hcpTerm: "Date de référence du Recensement", body: "Chaque chiffre de 2024 décrit le pays tel qu’il était ce jour-là. Le recensement précédent est celui de 2014." },
          {
            id: "legal-population",
            term: "Population légale",
            hcpTerm: "Population légale",
            body: "C’est le chiffre que ce jeu de données porte sous `population` : 36 828 330 en 2024.",
          },
          {
            id: "municipal-population",
            term: "Population municipale",
            hcpTerm: "Population municipale",
            body: "C’est sur elle que se calculent les parts du recensement : les hommes et les femmes, et les tranches d’âge, s’y additionnent plutôt qu’à la population légale. 36 490 591 en 2024, environ 338 000 de moins.",
          },
          {
            id: "counted-apart",
            term: "Population comptée à part",
            hcpTerm: "Population comptée à part",
          },
          {
            id: "household",
            term: "Ménage",
            hcpTerm: "Ménage",
            body: "Tous les chiffres de ménage sont par ménage : un logement où personne n’habite n’y figure pas.",
          },
          {
            id: "settled",
            term: "Ménage sédentaire",
            hcpTerm: "Ménage sédentaire",
            body: "Les équipements, les pièces et la distance à la route sont donnés pour les ménages sédentaires.",
          },
          {
            id: "room",
            term: "Pièce d’habitation",
            hcpTerm: "Pièce d’habitation",
          },
          {
            id: "labour-force",
            term: "Population active",
            hcpTerm: "Population active de 15 ans et plus",
            body: "Le taux d’activité est leur part dans cette tranche d’âge, le taux de chômage la part d’entre eux qui cherchent un travail.",
          },
          {
            id: "in-work",
            term: "Actif occupé",
            hcpTerm: "Population active occupée de 15 ans et plus",
          },
          {
            id: "electricity",
            term: "Électricité, eau courante",
            hcpTerm: "Part des ménages sédentaires disposant de l’électricité",
          },
          {
            id: "long-questionnaire",
            term: "Le questionnaire long",
            body: "La plupart des thèmes en viennent. Il a été posé à tous les ménages dans les communes de moins de 2 000 ménages, et à 20 % des ménages tirés au hasard ailleurs : dans les grandes communes, ces chiffres sont des estimations.",
          },
          {
            id: "illiteracy",
            term: "Analphabétisme",
            hcpTerm: "Analphabète",
            body: "Le taux est la part des 10 ans et plus.",
          },
          {
            id: "disability",
            term: "Handicap",
            hcpTerm: "Personne en situation de handicap",
          },
          {
            id: "schooling",
            term: "Scolarisation",
            hcpTerm: "Taux de scolarisation des 6-11 ans en 2023/2024",
            body: "Celui de 2014 porte sur les 7-12 ans et son classeur ne dit pas sur quoi repose la tranche : le jeu de données laisse donc les deux séparés.",
          },
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
          {
            id: "dwelling",
            term: "Logement",
            hcpTerm: "Le logement",
            body: "Les indicateurs du recensement en retiennent un plus étroit, le local occupé par un ménage à titre de résidence principale. Les logements d’une ville et les logements où vivent ses ménages sont donc comptés à part ici.",
          },
          { id: "villa", term: "Villa", hcpTerm: "Villa" },
          { id: "apartment", term: "Appartement", hcpTerm: "Appartement dans un immeuble" },
          { id: "traditional-house", term: "Maison marocaine traditionnelle", hcpTerm: "Maison marocaine traditionnelle" },
          {
            id: "modern-house",
            term: "Maison marocaine moderne",
            hcpTerm: "Maison marocaine moderne",
            body: "C’est le type le plus répandu dans les villes du pays.",
          },
          { id: "slum", term: "Maison sommaire ou bidonville", hcpTerm: "Construction sommaire ou bidonville" },
          { id: "rural-dwelling", term: "Logement de type rural", hcpTerm: "Logement rural" },
          {
            id: "other-dwelling",
            term: "Autre type",
            hcpTerm: "Autres types à préciser",
          },
          { id: "occupied", term: "Logement occupé", hcpTerm: "Logement occupé" },
          {
            id: "vacant",
            term: "Logement vacant",
            hcpTerm: "Logement vacant",
          },
          {
            id: "seasonal",
            term: "Logement secondaire ou saisonnier",
            hcpTerm: "Logement secondaire ou saisonnier",
          },
          { id: "precarious", term: "Logement salubre et précaire", body: "Les villas, appartements et maisons marocaines sont les logements salubres. Les maisons sommaires et bidonvilles, les logements de type rural et le reste sont les précaires. Les deux font tout le parc." },
          {
            id: "shortfall",
            term: "Déficit en logement",
            hcpTerm: "Taux de déficit quantitatif en logements",
            body: "Des ménages au numérateur et des logements au dénominateur : le taux dépasse 100 % là où le déficit est plus grand que le parc salubre.",
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
  ar: {
    title: "المعجم",
    description: "معاني الكلمات المستعملة في هذا الموقع: الوحدات وأرقام الإحصاء والمؤسسات والمساكن.",
    lede: "معاني الكلمات. حين تضع المندوبية السامية للتخطيط تعريفا لكلمة، يرد هنا بنصه الأصلي.",
    source: "المندوبية السامية للتخطيط، إحصاء 2024",
    groups: [
      {
        id: "units",
        label: "الوحدات",
        entries: [
          {
            id: "region",
            term: "الجهة",
            body: "أعلى مستوى، وعدد الجهات 12. رمز الجهة أول مجموعة في كل رمز تحتها، فالرمز 01.511.01.0 يوجد في الجهة 01.",
          },
          {
            id: "province",
            term: "العمالة، الإقليم",
            body: "المستوى الذي يلي الجهة، ومجموع العمالات والأقاليم 83. العمالة هي النوع الحضري؛ ويحتفظ كل سجل في `type` بالكلمة التي تستعملها المندوبية السامية للتخطيط.",
          },
          {
            id: "prefecture-of-arrondissements",
            term: "عمالة المقاطعات",
            body: "8 وحدات داخل عمالة الدار البيضاء، تضم كل واحدة منها 2 أو 3 من مقاطعاتها. تقع في مستوى الإقليم ولها رمز أطول، من 06.141.01.00 إلى 06.141.01.70.",
          },
          {
            id: "cercle",
            term: "الدائرة",
            body: "تضم الجماعات القروية للإقليم، وعدد الدوائر 213. الجماعة الحضرية لا تتبع أي دائرة، لذلك تكون قيمة `cercle` فيها null.",
          },
          {
            id: "commune",
            term: "الجماعة",
            body: "الوحدة التي بنيت عليها مجموعة البيانات، وعدد الجماعات 1.503. الحضرية منها بلدية والقروية جماعة قروية؛ والحقل `type` يبين النوع.",
          },
          {
            id: "arrondissement",
            term: "المقاطعة",
            body: "جزء من مدينة مقسمة إلى مقاطعات، وهي 6 مدن: الدار البيضاء والرباط وفاس ومراكش وسلا وطنجة، ومجموع مقاطعاتها 41. يحصي الإحصاء هذه المدن حسب المقاطعة، لا باعتبارها مكانا واحدا. أرقام المدينة نفسها مجموع أرقام مقاطعاتها، ويشار معها إلى ذلك.",
          },
          {
            id: "urban-centre",
            term: "المركز الحضري",
            body: "الجزء المبني من جماعة قروية. يخص الإحصاء 164 مركزا بأرقام خاصة بها، داخل جماعاتها.",
          },
          {
            id: "code",
            term: "رمز المندوبية",
            body: "معرّف الوحدة، ويكتب 01.511.01.0. الرمز نفسه يكتب أيضا 001511010، مكملا بالأصفار إلى 9 أرقام. جداول المندوبية تحذف الأصفار الأولى وتكتبه 1511010. تقبل واجهة API الصيغ الثلاث، وكذلك slug. كل مجموعة أرقام تدل على مستوى، فرمز الجماعة يتضمن رمز إقليمها ورمز جهتها.",
          },
        ],
      },
      {
        id: "people",
        label: "إحصاء السكان",
        entries: [
          {
            id: "reference-date",
            term: "تاريخ الإحصاء",
            body: "1 شتنبر 2024. كل أرقام 2024 تصف البلاد كما كانت في ذلك اليوم. الإحصاء السابق كان سنة 2014.",
            hcpTerm: "Date de référence du Recensement",
          },
          {
            id: "legal-population",
            term: "السكان القانونيون",
            body: "كل من يقيم في البلاد يوم الإحصاء، أو ينوي الإقامة فيها 6 أشهر أو أكثر. يتكونون من السكان البلديين والسكان المحسوبين على حدة، وعددهم هو الرقم الذي تحمله مجموعة البيانات في `population`: 36.828.330 سنة 2024.",
            hcpTerm: "Population légale",
          },
          {
            id: "municipal-population",
            term: "السكان البلديون",
            body: "المستقرون والرحل والأشخاص بدون مأوى. نسب الإحصاء تحسب منهم: مجموع الرجال والنساء، ومجموع الفئات العمرية، يساوي عدد السكان البلديين لا عدد السكان القانونيين. عددهم 36.490.591 سنة 2024، أي أقل بنحو 338.000.",
            hcpTerm: "Population municipale",
          },
          {
            id: "counted-apart",
            term: "السكان المحسوبون على حدة",
            body: "أشخاص يعيشون في مؤسسة لا في أسرة: الجنود وأفراد القوات المساعدة في الثكنات، والعمال المقيمون في أوراش الأشغال العمومية، والسجناء، ونزلاء دور الرعاية ومراكز حماية الطفولة والزوايا، وكل من قضى في المستشفى 6 أشهر أو أكثر. يدخلون في السكان القانونيين ولا يدخلون في السكان البلديين، وهذا هو الفرق بين الاثنين.",
            hcpTerm: "Population comptée à part",
          },
          {
            id: "household",
            term: "الأسرة",
            body: "أشخاص يعيشون تحت سقف واحد ونفقاتهم اليومية مشتركة، سواء كانوا أقارب أم لا. الأسرة مستقرة أو رحالة أو بدون مأوى. أرقام الأسر كلها تحسب بالأسرة، فالمسكن الذي لا يسكنه أحد لا يدخل في أي منها.",
            hcpTerm: "Ménage",
          },
          {
            id: "settled",
            term: "الأسرة المستقرة",
            body: "أسرة تقيم عادة في مسكن، بخلاف الأسرة الرحالة والأسرة بدون مأوى. أرقام التجهيزات والغرف والمسافة إلى الطريق تخص كلها الأسر المستقرة.",
            hcpTerm: "Ménage sédentaire",
          },
          {
            id: "room",
            term: "غرفة السكن",
            body: "غرفة في المسكن مخصصة للعيش أو النوم. المطبخ والحمام والمرحاض والممر وغرفة الغسيل وغرفة التخزين والمرأب الفارغ والغرفة المستعملة للعمل فقط لا تعد غرف سكن، لذلك يحسب عدد الأشخاص لكل غرفة على الغرف التي يعيش فيها الناس وحدها.",
            hcpTerm: "Pièce d’habitation",
          },
          {
            id: "labour-force",
            term: "السكان النشيطون",
            body: "الأشخاص البالغون 15 سنة فأكثر الموجودون في سوق الشغل، سواء كانوا يشتغلون أو يبحثون عن شغل: النشيطون المشتغلون والعاطلون. معدل النشاط هو نسبتهم من هذه الفئة العمرية، ومعدل البطالة هو نسبة الباحثين عن شغل منهم.",
            hcpTerm: "Population active de 15 ans et plus",
          },
          {
            id: "in-work",
            term: "النشيطون المشتغلون",
            body: "كل من بلغ 15 سنة فأكثر واشتغل ساعة واحدة على الأقل خلال الأسبوع السابق للمقابلة، وكل من له شغل تغيب عنه بسبب مرض أو عطلة أو نزاع شغل أو تكوين أو سوء أحوال الطقس. تعتمد المندوبية السامية للتخطيط هنا تعريف منظمة العمل الدولية.",
            hcpTerm: "Population active occupée de 15 ans et plus",
          },
          {
            id: "electricity",
            term: "الكهرباء، الماء الجاري",
            body: "الكهرباء تشمل المسكن المرتبط بالشبكة العمومية، والمسكن المضاء بالطاقة الشمسية أو بمولد كهربائي. الماء الجاري يشمل الشبكة العمومية وحدها.",
            hcpTerm: "Part des ménages sédentaires disposant de l’électricité",
          },
          {
            id: "long-questionnaire",
            term: "الاستمارة المطولة",
            body: "منها تأتي أغلب مواضيع الإحصاء. وجهت إلى كل الأسر في الجماعات التي تضم أقل من 2.000 أسرة، وإلى 20% من الأسر، مختارة عشوائيا، في باقي الجماعات. لذلك تكون هذه الأرقام في الجماعات الكبرى تقديرات من تلك العينة.",
          },
          {
            id: "illiteracy",
            term: "الأمية",
            body: "عدم القدرة على قراءة نص قصير وبسيط عن الحياة اليومية أو كتابته، مع فهمه. المعدل هو نسبة الأميين من السكان البالغين 10 سنوات فأكثر.",
            hcpTerm: "Analphabète",
          },
          {
            id: "disability",
            term: "الإعاقة",
            body: "عجز تام، أو صعوبة كبيرة، في واحد على الأقل من 6 مجالات: البصر، السمع، الحركة، التواصل، التذكر والتركيز، العناية بالنفس.",
            hcpTerm: "Personne en situation de handicap",
          },
          {
            id: "schooling",
            term: "التمدرس",
            body: "نسبة الأطفال الذين ترددوا على مدرسة أو مؤسسة للتكوين خلال السنة، سواء أكملوها أم لا. معدل 2024 يشمل الأطفال من 6 إلى 11 سنة خلال السنة الدراسية 2023/24، وتقول المندوبية إن سنهم من 7 إلى 12 سنة في تاريخ الإحصاء. نشر إحصاء 2014 معدلا للفئة من 7 إلى 12 سنة، وجدوله لا يذكر أساس هذه الفئة، لذلك تبقي مجموعة البيانات المعدلين منفصلين.",
            hcpTerm: "Taux de scolarisation des 6-11 ans en 2023/2024",
          },
        ],
      },
      {
        id: "work",
        label: "أماكن العمل",
        entries: [
          {
            id: "establishment",
            term: "المؤسسة",
            body: "مكان يزاول فيه العمل، حددت فرق الإحصاء موقعه في الميدان: مقاولة، أو مرفق عمومي، أو جمعية لها مقر خاص بها. المؤسسة مكان وليست شركة، فالشركة التي لها 3 متاجر تحسب 3 مؤسسات.",
          },
          {
            id: "business",
            term: "المقاولة",
            body: "مؤسسة هدفها الربح. الضيعات الفلاحية غير محسوبة: العدد يشمل كل القطاعات ما عدا الفلاحة.",
          },
          {
            id: "permanent-job",
            term: "منصب الشغل القار",
            body: "منصب شغل دائم في هذه المقاولات. الشغل الموسمي والعرضي لا يدخل في الرقم.",
          },
          {
            id: "weekly-souk",
            term: "السوق الأسبوعي",
            body: "سوق يقام يوما واحدا في الأسبوع. يحسب إلى جانب المؤسسات لا ضمنها.",
          },
        ],
      },
      {
        id: "dwellings",
        label: "المساكن",
        entries: [
          {
            id: "dwelling",
            term: "المسكن",
            body: "غرفة أو أكثر مخصصة للسكن، لها باب خاص أو أكثر يفتح على ممر أو درج أو فناء أو مكان عمل أو على الشارع. لا يشترط أن يكون المسكن قد بني للسكن: المرأب المحول إلى سكن يعد مسكنا. مؤشرات الإحصاء تعتمد تعريفا أضيق: المسكن الذي تتخذه أسرة سكنا رئيسيا. لذلك تحسب هنا مساكن المدينة على حدة، والمساكن التي تقيم فيها أسرها على حدة.",
            hcpTerm: "Le logement",
          },
          {
            id: "villa",
            term: "الفيلا",
            body: "بناية مستقلة من طابق أو طابقين، لها حديقة في الغالب. تعد فيلا حتى لو كانت تستعمل لغرض آخر يوم الإحصاء.",
            hcpTerm: "Villa",
          },
          {
            id: "apartment",
            term: "الشقة",
            body: "مسكن مستقل داخل عمارة، أيا كان استعماله يوم الإحصاء.",
            hcpTerm: "Appartement dans un immeuble",
          },
          {
            id: "traditional-house",
            term: "الدار المغربية التقليدية",
            body: "توجد غالبا في المدن العتيقة: غرف حول فناء في وسط الدار.",
            hcpTerm: "Maison marocaine traditionnelle",
          },
          {
            id: "modern-house",
            term: "الدار المغربية العصرية",
            body: "دار من طابق أو أكثر بنيت للسكن، من غير العمارات والفيلات والدور التقليدية. هذا النوع هو الأكثر انتشارا في مدن المغرب.",
            hcpTerm: "Maison marocaine moderne",
          },
          {
            id: "slum",
            term: "المسكن البدائي أو دور الصفيح",
            body: "بناء بدائي جدا: كوخ، أو مسكن هش في أطراف المدينة، أو بيت من الصفيح في حي صفيحي.",
            hcpTerm: "Construction sommaire ou bidonville",
          },
          {
            id: "rural-dwelling",
            term: "المسكن من النوع القروي",
            body: "بناية تجمع بين السكن ومكان للماشية، ولا تدخل في أي نوع آخر.",
            hcpTerm: "Logement rural",
          },
          {
            id: "other-dwelling",
            term: "أنواع أخرى",
            body: "كل ما عدا ذلك، ومنه غرفة مسكونة داخل مؤسسة مثل فندق أو مدرسة أو مسجد، ومحل بني لغرض آخر ويستعمل للسكن: متجر أو مرأب أو ورشة.",
            hcpTerm: "Autres types à préciser",
          },
          {
            id: "occupied",
            term: "المسكن المأهول",
            body: "تقيم فيه أسرة بصفة اعتيادية، سواء كانت حاضرة يوم الإحصاء أم لا.",
            hcpTerm: "Logement occupé",
          },
          {
            id: "vacant",
            term: "المسكن الشاغر",
            body: "فارغ يوم الإحصاء ومعروض للكراء أو للبيع. الفيلات والشقق والدور المغربية وحدها تحسب شاغرة، فبيت الصفيح الفارغ لا يدخل في هذا الرقم.",
            hcpTerm: "Logement vacant",
          },
          {
            id: "seasonal",
            term: "السكن الثانوي أو الموسمي",
            body: "تستعمله سكنا ثانويا أسرة مسكنها الرئيسي في مكان آخر. وكما في المساكن الشاغرة، لا تحسب إلا الفيلات والشقق والدور المغربية.",
            hcpTerm: "Logement secondaire ou saisonnier",
          },
          {
            id: "precarious",
            term: "السكن اللائق والسكن الهش",
            body: "السكن اللائق هو الفيلات والشقق والدور المغربية، والسكن الهش هو المساكن البدائية ودور الصفيح والمساكن من النوع القروي وباقي الأنواع. الصنفان معا يكونان حظيرة المساكن كلها.",
          },
          {
            id: "shortfall",
            term: "العجز السكني",
            body: "الأسر التي تقيم في مساكن غير لائقة، مع الأسر الزائدة على عدد المساكن اللائقة المشتركة التي تقيم فيها، مقسومة على المساكن اللائقة المأهولة أو الشاغرة. البسط أسر والمقام مساكن، لذلك يتجاوز المعدل 100% حيث يكون العجز أكبر من حظيرة السكن اللائق.",
            hcpTerm: "Taux de déficit quantitatif en logements",
          },
        ],
      },
      {
        id: "reading",
        label: "قراءة البيانات",
        entries: [
          {
            id: "null",
            term: "null",
            body: "رقم لا تنشره المندوبية السامية للتخطيط في ذلك الموضع. تكتبه الجداول `…` حين لا يوجد ما يذكر، و`.` حين يكون غير متوفر، و`-` في 2014 و`_` في ملف السكن، وكلها تصل هنا null.",
          },
          {
            id: "basis",
            term: "basis",
            body: "مصدر الرقم حين لا يكون سطرا من جداول المندوبية. القيمة `arrondissement_sum` في إحدى المدن الـ6 تعني المجموع الدقيق لأرقام مقاطعات تلك المدينة، وهي المستوى الذي يحصي به الإحصاء هذه المدن.",
          },
          {
            id: "comparable-to",
            term: "comparableTo",
            body: "في حقل من حقول 2014، هو حقل 2024 الذي يحمل السؤال نفسه، فيمكن طرح أحدهما من الآخر. حقل 2014 الذي ليس له مقابل يحمل `note` يبين ما تغير.",
          },
          {
            id: "crosswalk",
            term: "جدول المطابقة",
            body: "مطابقة الجماعات التي أعاد إصلاح 2015 ترقيمها، وعددها 207. الجماعة التي تغير رمزها تحتفظ برقمها لسنة 2014، وكل مطابقة تحمل ما يثبتها.",
          },
          {
            id: "licence",
            term: "أي رخصة",
            body: "الأرقام للمندوبية، ويمكن إعادة استعمالها بشروط CC BY 4.0. الحدود من OpenStreetMap برخصة ODbL، وكذلك كل ما يستخرج منها: المساحة والكثافة والنقطة داخل الجماعة والجماعات المجاورة لكل جماعة.",
          },
        ],
      },
    ],
  },
};
