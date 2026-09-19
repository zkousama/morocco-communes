# Commune boundaries, v1

One TopoJSON file per région, named by its two-digit HCP code. Each holds a
`communes` object whose features carry `code`, the nine-digit HCP code used as the key
throughout `../attributes/`, and `name`. `arrondissements.topojson` holds the 41
arrondissements of Casablanca, Rabat, Fès, Marrakech, Salé and Tanger the same way, in
an `arrondissements` object.

Boundaries come from OpenStreetMap relations at `admin_level=8` for communes and
`admin_level=10` for arrondissements, matched to HCP on the `ref:MA:HCP` tag. The build
checks that each arrondissement lies inside its commune and that a city's arrondissements
cover its area to within 1%. See LICENSE: this directory is ODbL, the
attribute files are not.

Coordinates are quantised to about metre precision. For an exact boundary, go
back to OpenStreetMap.

## What they don't cover

1,502 of the 1,503 communes have a boundary. Sidi Mohamed Benmansour (`04.281.05.11`)
doesn't: its OpenStreetMap relation has no outer ring that closes, so it's left out
rather than repaired by guesswork.

The land Benmansour should cover is likely the 11 km² gap inside Kénitra province that no
other commune's boundary reaches, but nothing in OpenStreetMap says so.

About 88 km² between Ifrane and Boulemane, in the cercle of Azrou, lies inside no
commune. OpenStreetMap has no `admin_level=8` relation there, though HCP places all of
Morocco in some commune, so a point-in-polygon lookup in that area finds nothing. The
build knows about this gap. It fails if another one appears, and it fails if this one is
filled, so the list of known gaps can't go stale.
