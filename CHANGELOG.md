# Changelog

What changed in `data/v1/`, by the version in `sources.json` and in the two packages.
A minor version adds fields or units, a patch corrects a figure, and a major one would
change a shape something already reads.

## 1.8.0

- HCP's own definitions, in `indicators/fields.json` and `housing/fields.json`. The 2024
  workbooks each carry a sheet of them: 52 census concepts, from the legal population to
  the distance to a tarred road, and 15 for the urban housing stock, from what makes a
  dwelling to what makes one modern. Both go out under `definitions`, in HCP's French.
- A column that one of them defines names it under `definedAs`: 56 of the 114 census
  columns and 33 of the 55 housing ones. The rest are totals HCP adds up itself and
  columns it leaves undefined.
- The Python package carries the urban housing stock, which `data/v1/` has had since
  1.7.0: `housing()` for the dwellings, `fields("housing")` for what its columns measure.

## 1.7.1

- Corrected what `dwellings.deficitRate` measures. The field notes and the site called it
  a share of households; it is the households short over the sound dwellings that are
  occupied or vacant. HCP's own definition, from the workbook, is now in the glossary
  beside it.

## 1.7.0

- The 2024 urban housing stock, in `housing/`: how many urban dwellings each unit has, how
  many are occupied, vacant or second homes, what kind they are, how old, what their walls
  and roofs are made of, how many are on the public networks, and HCP's housing shortfall.
- It counts dwellings rather than households, and only in towns, so it sits apart from the
  census indicators rather than among them. 784 units have an urban stock; the 1,233 with
  no urban area have no record.
- `/api/{level}/{code}/housing.json` serves a unit's, `/api/housing.json` the country's,
  and `get_housing` is the ninth MCP tool.

## 1.6.0

- What people did for a living in 2014, from HCP's professions workbook: the employed
  population aged 15 and over by 10 occupation groups and by 9 sectors, under `profession`
  and `workSector`.
- The qualifications people held in 2014, from the diplomas workbook: everyone aged 10 and
  over by highest general-education diploma and by highest vocational one, under `diploma`
  and `vocationalDiploma`. The two ladders are separate, so each sums to 100 on its own.
- The commune-level figures of each census move from `communes.json` to `communes/`, a
  file per région. The 2014 file had reached 34 MB in one piece, past what an asset store
  will serve. Every other level stays as it was.
- Neither of the two new workbooks has a 2024 figure to be read against: that census publishes the level of
  education people reached rather than the diploma they hold, and doesn't publish
  occupations by commune at all. Each field says so in its `note`.

## 1.5.0

- Which communes border which, in `geometry/adjacency.json` and `adjacency.csv`: 4,134
  pairs, with the length of the boundary each pair shares. Two communes border when their
  boundaries share a segment, which in OpenStreetMap means the same nodes, so the match is
  exact rather than within a tolerance. It derives from the boundaries, so it carries their
  ODbL terms and not the census licence.
- The API serves a commune's at `/api/communes/{code}/neighbours.json`, and `get_commune`
  returns them, longest shared boundary first.

## 1.4.0

- The 2024 census's count of economic establishments, in `economy/`: how many were mapped
  in each unit, how many are public services, associations or businesses, the permanent
  jobs those businesses hold, the weekly souks in use, and the businesses split by sector,
  by the people they employ and by when they were founded.
- The 6 cities the census counts by arrondissement carry the sum of their own, marked
  `basis: arrondissement_sum`. Every other record is a row of HCP's, marked `hcp`.

## 1.3.0

- How people get to work, from both censuses, joined into the indicator files rather than
  kept apart: 12 ways in 2024, 11 in 2014, 8 of them asked the same way in both.
- 2014 also has where people work, where they study and how they get to school, which the
  2024 census doesn't ask.

## 1.2.0

- The 2014 census indicators, in `indicators/2014/`, on the units the dataset publishes
  today: 1,965 of the workbooks' 1,979 rows, joined by code, through the crosswalk where a
  commune was renumbered, or by name inside a commune for an urban centre.
- 65 fields carry `comparableTo`, the 2024 field they can be read against. The rest say in
  a `note` what changed between the censuses.
- `indicators/2014/unplaced.json` names the 14 rows with no unit to land on.

## 1.1.0

- HCP's 2024 census indicators, in `indicators/`: age, marital status, fertility,
  disability, schooling, literacy and languages, education and work, and each household's
  dwelling, amenities, wastewater, waste and cooking fuel, for the whole unit, its urban
  part and its rural part, and for men and women.
- `indicators/fields.json` pairs every field with HCP's own heading, its unit and its
  notes.

## 1.0.0

- Every région, province, préfecture, cercle, commune and arrondissement, with HCP's
  codes, names in French and Arabic, the 2024 and 2014 population, and boundaries from
  OpenStreetMap.
- The 2014 ↔ 2024 crosswalk for the 207 communes renumbered by the 2015 reform, with the
  evidence for every pairing.
- `sources.json`, which records each workbook's digest and the date it was read, and the
  range of the OpenStreetMap snapshot. A build that can't account for a source refuses to
  publish.
