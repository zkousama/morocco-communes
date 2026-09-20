# Changelog

What changed in `data/v1/`, by the version in `sources.json` and in the two packages.
A minor version adds fields or units, a patch corrects a figure, and a major one would
change a shape something already reads.

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
