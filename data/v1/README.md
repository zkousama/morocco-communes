# Morocco administrative divisions, v1

Attributes for 12 régions, 75 provinces and préfectures, 8 préfectures
d'arrondissements, 213 cercles, 1,503 communes and 41 arrondissements.

Source: Haut-Commissariat au Plan, RGPH 2024 and RGPH 2014. Regenerate with
`pnpm dataset:build`.

`sources.json` records what this build read: each workbook's URL, licence, sha256 and
retrieval date, and the OpenStreetMap snapshot. The OSM vintage is a **range**, because
the boundaries come from twelve separate Overpass queries that rate-limiting spreads over
an hour or more, so the twelve régions are snapshots taken at different moments rather
than one consistent extract. `datasetVersion` is this directory's own version, which
moves independently of the API's.

Rebuilding from the same cache is byte-identical. Rebuilding after re-fetching is not,
and should not be: a newer OSM snapshot is different input, and `sources.json` is where
that shows up.

`code` is the canonical dotted HCP geographic code. `codeDigits` is the same code
zero-padded to nine digits, which is the key that joins across both censuses and
OpenStreetMap.

`population.2014` is present for all 1,503 communes, by three routes recorded in
`population.change.basis` and `provenance.population2014`:

- `exact_code`: 1,290 communes whose geographic code is unchanged since 2014.
- `arrondissement_sum`: the 6 arrondissement-bearing cities, which the 2014 workbook has
  no commune row for; their figure is the exact sum of their own arrondissements.
- `crosswalk`: 207 communes renumbered by the 2015 reform, reconciled in
  `../crosswalk/`, which records the evidence for every pairing.

Households are available on the first two routes only. The crosswalk carries population,
and attributing a household count across a changed code would be a guess.

Aghouinite, Lagouira, Mijik and Zoug carry `pm`, for *pour mémoire*,
in the 2014 source instead of a count. They join by `exact_code` and keep a 2014 object,
but its total is null and no population change is computed for them: `population.change`
is `null` for these four alone, while `provenance.population2014` still reads
`hcp-2014:exact_code`. Every other commune's `population.2014.total` carries a real
number by one of the three routes above. `communes.csv` cannot express the difference, so
use the JSON when it matters.

Each level has a CSV beside its JSON. They start with a UTF-8 byte-order mark, so Excel
reads the Arabic names and the accents correctly; other tools skip it.

Régions, provinces and cercles carry the population HCP publishes for them directly,
rather than a sum over their children. A parent can legitimately differ from the sum of
its parts.

`urbanCentres` is a list. 160 communes have at least one, 3 of them have several, and 164
exist in total.

## Five fields come from OpenStreetMap

`centroid`, `bbox`, `osm`, `areaKm2` and `density` are derived from OpenStreetMap and are
therefore **ODbL**, not HCP. `provenance.geometry` reads `osm-odbl` on every record
carrying them, and `null` where OSM holds no boundary. Redistributing a modified version
of those fields takes on ODbL's share-alike obligation; nothing else in this directory
does.

`areaKm2` is measured on the sphere from the full-resolution boundary, holes taken out,
and `density` is the 2024 population over it, in people per km². Together the boundaries
cover 685,281 km². The smallest communes are under half a km²: Moulay Yacoub, and
Méchouar de Casablanca around the royal palace.

The boundaries themselves are in `../geometry/`, which carries its own LICENSE.
