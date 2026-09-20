# 2024 census indicators

HCP's demographic and socio-economic indicators from the 2024 census, for Morocco and
every région, province and préfecture, cercle, commune and arrondissement, and the 164
urban centres inside rural communes. The source is
[Indicateurs démographiques et socioéconomiques du Royaume du Maroc selon les résultats du RGPH 2024](https://www.hcp.ma/Indicateurs-demographiques-et-socioeconomiques-du-Royaume-du-Maroc-selon-les-resultats-du-RGPH-2024_a4022.html),
published on 17 December 2024.

## What's in it

About people: the legal and municipal population, sex, age in 5-year bands, the marital
status of those aged 15 and over and the singulate mean age at marriage, fertility,
disability, schooling at 6 to 11, illiteracy from 10 and from 15, the languages literate
people read and write, level of education, the local languages people use, the labour
force and unemployment, and employment status. Each is given for everyone, for men and
for women, except the legal population and the sex split, which are for everyone, and
fertility, which is for everyone and for women.

Getting to work: how many employed people there are and the share using each way of
getting to work, from HCP's own workbook on the subject,
[Indicateurs communaux Mode de transport domicile-lieu de travail des actifs occupés](https://www.hcp.ma/file/248301/).
It counts the settled employed population, so its count falls a little short of the number
in work.

About households: how many there are, their average size, how many are sedentary, people
per room, dwelling type, occupancy, the dwelling's age, amenities, wastewater, household
waste, cooking fuel and the distance to a paved road.

Both come for the whole unit, its urban part and its rural part.

## Files

- `2014/` holds the same figures from the 2014 census, with a README of its own.
- `national.json`, `regions.json`, `provinces.json`, `cercles.json`,
  `arrondissements.json` and `urban-centres.json` hold one record per unit.
- `communes/` holds the communes, one file per région, `01.json` to `12.json`. All of them
  in one file passes what an asset store will serve, and is more than anyone wants in
  order to read one commune. `people.csv` and `households.csv` below have every unit,
  communes included.
- `people.csv` has a row per unit, area and sex, and `households.csv` a row per unit and
  area. Both start with a UTF-8 byte-order mark, for Excel.
- `fields.json` lists every field with its path, its CSV column, an English label, HCP's
  heading and category for it, its unit and the sexes it's given for, and HCP's notes. It
  covers both workbooks, the indicators and commuting, in that order.

A record, cut short:

```json
{
  "code": "01.511.01.0",
  "level": "commune",
  "name": { "fr": "Tanger", "ar": "طنجة" },
  "fromLocalAdministration": false,
  "people": {
    "total": {
      "all": { "labour": { "unemploymentRate": 15.3 } },
      "male": { "labour": { "unemploymentRate": 14.4 } },
      "female": { "labour": { "unemploymentRate": 17.7 } }
    },
    "urban": { "all": { "labour": { "unemploymentRate": 15.3 } } },
    "rural": null
  },
  "households": {
    "total": { "amenities": { "runningWater": 98.8 } },
    "urban": { "amenities": { "runningWater": 98.8 } },
    "rural": null
  }
}
```

An area is null where the unit has none of it: the rural part of an urban commune, or
the urban part of a rural commune without an urban centre. An urban centre's code is its
commune's code and one more digit, as HCP numbers it, and the API serves it inside its
commune's file.

## Reading the figures

- Shares and rates are percentages. HCP rounds them to one decimal, and fertility to two.
- Most topics come from the census's long questionnaire. It went to every household in
  communes of fewer than 2,000 households, and to a random 20% of households elsewhere,
  so in larger communes these figures are estimates from that sample. A rate can differ
  in its last decimal from one worked out from the counts beside it.
- Homeless people aren't counted in fertility, the schooling rate, the languages, or
  anything about work. The population aged 15 and over does count them, so the active and
  inactive population can add up to slightly less.
- Null is where HCP prints `…`, nothing to report, or `.`, unavailable.
- Mijik, Lagouira, Aghouinite and Zoug have `fromLocalAdministration: true`. HCP collected
  their figures from the local administration, because their people move with the seasons,
  and publishes only their counts.
- Every figure is HCP's as published. Touizgui's 15.4 people per room is what the workbook
  gives: 25 of its 177 households are sedentary.

## Checks

The build refuses the workbook if any column's heading isn't the one expected, and checks
every row. Each unit's legal population and household count must equal the population
file's. Men and women, and urban and rural, must add up. Each set of shares must sum to
100 within rounding, and each rate must agree with its counts within what the sample
allows.

## Licence

HCP's terms of use: reusable, commercially too, on CC BY 4.0 terms. Credit the
Haut-Commissariat au Plan, RGPH 2024, and say what was changed.
