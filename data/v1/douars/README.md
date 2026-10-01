# Douars, 2024

The villages and hamlets of Morocco's rural communes, with their people and households at
the 2024 census, published by HCP as
[Population et ménages par douars](https://www.hcp.ma/Population-et-menages-par-douars-selon-les-resultats-du-recensement-general-de-la-population-et-de-l-habitat-de-2024_a4208.html)
([the workbook](https://www.hcp.ma/file/245768/)).

A rural commune is divided into fractions (mashyakha, المشيخة), and a fraction into douars.
This has all 3 levels: 33,189 douars in 5,203 fractions across 1,279 communes, holding
13,551,229 people in 3,097,446 households.

## What's in it

For each douar: its name, its fraction, its kind, how many households and people it has,
and then, as a share of its people, their nationality, sex, age in 3 groups, whether
they're entered in a family civil-status booklet, and the marital status of those aged 15
and over; as a share of its households, the kind of dwelling they live in; and how far
its dwellings are, on average, from a paved road, an unpaved road a car can drive on, a
primary school, a collège, a lycée and a health centre or hospital.

HCP sorts douars into 3 kinds: grouped (19,096), where at least 2 thirds of the dwellings
stand together; split (8,477), made of parts called sub-douars that carry names of their
own; and dispersed (5,616), where more than a third of the dwellings are over 100 metres
from one another.

## Files

- `01.json` to `12.json` hold the douars of each région's communes, one record per douar.
- `fractions.json` has one record per fraction: its commune, its name, and how many douars,
  households and people it holds.
- `douars.csv` has a row per douar and a column per figure, with the fraction's name
  beside its code. It starts with a UTF-8 byte-order mark, for Excel.
- `fields.json` lists every field with its path, its CSV column, an English label, the
  workbook's French wording for it, and its unit. It also carries `definitions`, the 15
  concepts the workbook defines on its third sheet, in HCP's French.

## Codes

A douar's code is 13 digits: province, cercle, commune, fraction and douar. Its first 7 are
its commune's code less the région, so `0510301201001` is in `01.051.03.01`, and its first
10 are its fraction's code. Every douar lands on a commune that way.

The workbook names 7 communes in Arabic a little differently from HCP's population
workbook, which the rest of the dataset follows. The code decides.

## Which douars have figures

HCP withholds a douar's shares and distances when it has fewer than 30 households, to
protect the people in it. That's 10,560 douars holding 643,908 people: their `topics` is
null, and the CSV leaves their figure columns empty. Every douar's households and people
are given.

## Reading the figures

- Shares are percentages, to one decimal, so a group of them adds up to 100 give or take
  a few tenths.
- Distances are in km, to 2 decimals. A drivable road is an unpaved one: 3,427 douars are
  nearer a paved road than a drivable one.
- The people counted are the settled ones. Nomads aren't counted by douar, so a Saharan
  commune whose people are mostly nomads holds few douars, and 3 hold none.
- A commune's douars don't cover its urban centres, or the people HCP counts apart, such
  as soldiers in barracks. Take its urban centres off its legal population and the douars
  never add up to more than the rest; they match it exactly in 581 of the 1,279
  communes, and come within 50 people in 1,065.
- 21 communes the dataset counts as urban have douars too, covering their rural part.
- Douars and fractions are named in Arabic only. A few names use ݣ, the letter Moroccan
  Arabic writes a hard g with.
