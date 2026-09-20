# Urban housing stock, 2024

What the 2024 census found about the dwellings of Morocco's towns, published by HCP as
[Indicateurs communaux du parc logement urbain](https://www.hcp.ma/file/246208/).

This counts dwellings, not households. A dwelling is a place built or converted to be
lived in, whether or not anyone lives in it, so a vacant flat is in here and in no
household's record. The census indicators in `../indicators/` describe the dwelling each
household lives in, for the whole country; this covers the urban part of a unit only.

## What's in it

For each unit: how many urban dwellings it has, and then, as a share of them, how many are
occupied, vacant or second homes; what kind they are, from a villa or an apartment to a
slum or a rural-type dwelling; how old they are, in 3 bands, and how old each kind is;
what their walls and roofs are made of; how many are on the public electricity, water and
sewerage networks; and HCP's quantitative housing shortfall.

Nationally that is 8,336,782 urban dwellings: 71.1% occupied, 13.4% vacant and 15.5%
second or seasonal homes; 96.6% sound and 2.2% a slum or basic house.

## Files

- `national.json`, `regions.json`, `provinces.json`, `cercles.json`, `communes.json`,
  `arrondissements.json` and `urban-centres.json` hold one record per unit: 12 régions, 83
  provinces and préfectures, 103 cercles, 380 communes, 41 arrondissements and 164 urban
  centres.
- `dwellings.csv` has a row per unit and a column per figure. It starts with a UTF-8
  byte-order mark, for Excel.
- `fields.json` lists every field with its path, its CSV column, an English label, the
  workbook's own wording for it, and what it measures.
- `fields.json` also carries `definitions`, the 15 concepts the workbook defines on its
  second sheet, in HCP's French: what a dwelling is, what each type of one is, what counts
  as vacant, and how the shortfall is worked out. A field one of them defines names it
  under `definedAs`, 33 of the 55 in all. The rest are the totals HCP adds up itself and
  the walls, roofs and networks, which it leaves undefined.
- `unplaced.json` holds the rows with no unit to land on, and how many units have no urban
  dwellings.

## Which units have figures

784 of the 2,017 units in the workbook have an urban housing stock. The other 1,233 have
no urban area, and carry no record here rather than 55 nulls.

Null inside a record is a figure the workbook leaves out, which it writes as `_`. The age
of the dwellings by kind is left that way for most units.

## Reading the figures

- Shares are percentages of that unit's urban dwellings, to one decimal, so a group of
  them lands near 100 rather than exactly on it.
- The shortfall is the households living in unsound dwellings, plus the households beyond
  the sound shared dwellings they occupy, over the sound dwellings that are occupied or
  vacant. Households on top and dwellings underneath, so it passes 100% where the
  shortfall is larger than the sound stock: Tainaste's is 232.6%.
- A unit's figures cover its urban part. A commune that is half town and half country has
  the town's dwellings here and all of its households in `../indicators/`.

## Checks

The build refuses the workbook if any of the 55 columns' wording has moved, reading each
column's own header cells down its 4 merged rows. In each unit the occupied and the
unoccupied must make the whole stock, the vacant and the seasonal must make the
unoccupied, sound and precarious housing must make the whole stock and each must be the
kinds under it, the age bands must cover it, and the walls and the roofs must each be a
split of it.

## Licence

HCP's terms of use: reusable, commercially too, on CC BY 4.0 terms. Credit the
Haut-Commissariat au Plan, RGPH 2024, and say what was changed.
