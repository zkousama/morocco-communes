# 2014 census indicators

The same kind of figures from the census before, on the units the dataset publishes
today. HCP publishes them in two workbooks,
[Indicateurs sur la population selon les résultats du RGPH 2014](https://www.hcp.ma/file/230045/)
and [Indicateurs sur les ménages et les conditions d'habitation selon les résultats du RGPH 2014](https://www.hcp.ma/file/230042/).

## What's in it

About people: the legal and municipal population, age in 5-year bands, marital status and
the mean age at first marriage, disability, fertility, schooling at 7 to 12, illiteracy
from 10, the combinations of languages literate people read and write, level of education,
the local languages people use, the labour force, activity and unemployment, and
employment status. Each is given for everyone, for men and for women, except the legal
population, which is for everyone.

About households: how many there are, their average size, dwelling type, people per room,
occupancy, the dwelling's age, amenities, wastewater, household waste, cooking fuel, the
equipment a household owns, and the distance to a paved road.

Both come for the whole unit, its urban part and its rural part.

## Files

The file names are the 2024 ones, and a record keeps the code and name the unit has today.

- `national.json`, `regions.json`, `provinces.json`, `cercles.json`, `communes.json`,
  `arrondissements.json` and `urban-centres.json` hold one record per unit.
- `people.csv` has a row per unit, area and sex, and `households.csv` a row per unit and
  area. Both start with a UTF-8 byte-order mark, for Excel.
- `fields.json` lists every field with its path, its CSV column, an English label, HCP's
  heading and category for it, its unit, the sexes it's given for, and either the 2024
  field it can be read against or a note saying what changed.
- `unplaced.json` lists the 14 rows of the 2014 workbooks that have no unit to land on.

## Reading them against 2024

65 fields carry `comparableTo`: the two censuses ask them the same way, and subtracting
one from the other says what changed. `/api/communes?sort=change.illiteracy.rate10Plus`
ranks communes by that difference.

The rest changed between the censuses, and each says how in its `note`:

- Marital status covered everyone in 2014, children included, rather than people aged 15
  and over. Dividing a 2014 share by the share of the population aged 15 and over brings
  it close to the 2024 base.
- Schooling covered children aged 7 to 12, a year older at each end than 2024's 6 to 11.
- Reading and writing was asked as a combination of languages, so each literate person
  counted once, under one of `arabicOnly`, `arabicAndFrench`, `arabicFrenchEnglish` or
  `other`. In 2024 each language was asked separately.
- A household counted under every cooking fuel it used, so those shares pass 100. The
  2024 census recorded one fuel per household.
- The employment shares took in unemployed people who had worked before, which the 2024
  shares leave out.
- `householdWaste.otherOrOpen` is one category for everything that is neither a bin nor a
  truck. The 2024 census counts waste dumped in the open on its own.
- `labour.inactive` is everyone outside the labour force at any age. The 2024 count starts
  at 15, like the labour force itself.
- `equipment` covers a television, a radio, phones, internet, a computer, a satellite dish
  and a fridge, asked in 2014 and not in 2024.

## Which units have figures

1,965 of the 1,979 rows in the workbooks land on a unit, and 14 don't:

- Casablanca and the 5 other cities with arrondissements have no figures of their own,
  because the 2014 census published those cities by arrondissement. Each arrondissement is
  here, and so are Casablanca's 8 préfectures d'arrondissements.
- 13 cercles that were redrawn between the censuses, and 1 urban centre that isn't listed
  any more, have no unit to land on. They are in `unplaced.json`, each with the reason.
- A unit drawn since 2014 has no record here: 8 provinces, 30 cercles, the 6 cities and 16
  urban centres.

A row joins by its code, by the crosswalk in `../../crosswalk/` where a commune's code
changed, or, for an urban centre, by its name inside its commune. Ourtzarh was written
Ouartzagh in 2014, and the population workbook gives both spellings the same count.

## Reading the figures

- Shares and rates are percentages. The workbooks carry the full division, 10.155696524579501
  for 10.2, and each figure is rounded here to the decimal HCP's own tables stop at.
- Null is where HCP prints `-`, nothing to report, such as the urban part of a rural
  commune or a mother's fertility under Masculin.
- Every figure is HCP's as published. Gleibat El Foula's 32 people per room is what the
  workbook gives: the census counted 32 people in 18 households there.

## Checks

The build refuses a workbook if any column's heading isn't the one expected, and checks
every unit. Each one's legal population and household count must equal the 2014 population
file's, which was read and joined separately. Men and women, and urban and rural, must add
up. Each set of shares must sum to 100 within rounding, and the labour force and everyone
outside it must together be the whole population counted.

## Licence

HCP's terms of use: reusable, commercially too, on CC BY 4.0 terms. Credit the
Haut-Commissariat au Plan, RGPH 2014, and say what was changed.
