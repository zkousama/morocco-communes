# Economic establishments, 2024

The census counted workplaces as well as people. HCP's field teams walked the country and
put every establishment on the map, and published the count by commune in
[Cartographie des établissements économiques](https://www.hcp.ma/file/242672/).

## What's in it

For each unit: how many establishments were mapped, how many of them are public services,
how many are associations in premises of their own, how many are businesses, and how many
permanent jobs those businesses hold. The weekly souks in use are counted beside them.

The businesses are then split three ways, each covering all of them: by sector, into
industry, construction, commerce and services; by how many people work there, from one
person to 50 and over; and by when they were founded, from before 1956 to 2020 and later.

Farms are out. The workbook counts every sector but agriculture.

## Files

- `national.json`, `regions.json`, `provinces.json`, `cercles.json`, `communes.json` and
  `arrondissements.json` hold one record per unit: 12 régions, 83 provinces and
  préfectures, 213 cercles, 1,497 communes and 41 arrondissements.
- `establishments.csv` has a row per unit and a column per figure. It starts with a UTF-8
  byte-order mark, for Excel.
- `fields.json` lists every field with its path, its CSV column, an English label, HCP's
  heading and category for it, and what it counts.
- `unplaced.json` lists the rows that have no unit to land on. It is empty.

## Which units have figures

Every unit the dataset publishes carries figures, except two kinds:

- The 6 cities with arrondissements. The workbook counts those cities by arrondissement,
  and each of the 41 arrondissements is here, as are Casablanca's 8 préfectures
  d'arrondissements.
- Urban centres, which this workbook doesn't reach. It stops at the commune.

A row joins by its code, except Casablanca's préfectures d'arrondissements: this workbook
writes their codes a digit shorter than the population file, and the code it gives the
first of them is the one the commune of Casablanca carries, so they join by name.

## Reading the figures

- Every figure is a count, of establishments, of permanent jobs, or of souks.
- A weekly souk is a market that stands on one day of the week. It is counted on its own
  and is not part of the establishment total.
- The jobs are the permanent ones, so seasonal and casual work is not in the figure.
- An establishment is one place of business, so a company with three shops is counted
  three times.

## Checks

The build refuses the workbook if any of the 22 column headings isn't the one expected. In
each unit, the public services, associations and businesses must make the total, and each
of the three splits must make the business count. Across the country every one of the 22
figures must add up the tree: a région is its provinces, a province its communes and
arrondissements, a cercle its rural communes, and a préfecture d'arrondissements the
arrondissements under it.

## Licence

HCP's terms of use: reusable, commercially too, on CC BY 4.0 terms. Credit the
Haut-Commissariat au Plan, RGPH 2024, and say what was changed.
