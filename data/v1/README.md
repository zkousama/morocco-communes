# Morocco administrative divisions, v1

Attributes for 12 régions, 75 provinces and préfectures, 8 préfectures
d'arrondissements, 213 cercles, 1,503 communes and 41 arrondissements.

Source: Haut-Commissariat au Plan, RGPH 2024 and RGPH 2014. Regenerate with
`pnpm dataset:build`.

`code` is the canonical dotted HCP geographic code. `codeDigits` is the same code
zero-padded to nine digits, which is the key that joins across both censuses and
OpenStreetMap.

`population.2014` is present for 1,296 communes: 1,290 whose code is unchanged since
2014, and 6 more recovered by summing their own arrondissements. Those 6 are the
arrondissement-bearing cities, which the 2014 workbook has no commune row for at all,
so the sum is an exact aggregation of sourced values rather than an estimate.
`provenance.population2014` records which route produced each figure.

The remaining 207 communes were renumbered when cercles were reorganised and stay null
until the crosswalk lands.

Four communes — Aghouinite, Lagouira, Mijik and Zoug — carry `pm`, for *pour mémoire*,
in the 2014 source instead of a count. They keep a 2014 object with a null total, and no
population change is computed for them. That is a different thing from the 207 renumbered
communes, whose `population.2014` is null outright: read `provenance.population2014` to
tell them apart. `communes.csv` cannot express the difference, so use the JSON when it
matters.

Régions, provinces and cercles carry the population HCP publishes for them directly,
rather than a sum over their children. A parent can legitimately differ from the sum of
its parts.

`urbanCentres` is a list. 160 communes have one, three have several, and 164 exist in
total.
