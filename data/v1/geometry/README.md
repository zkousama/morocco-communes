# Commune boundaries, v1

One TopoJSON file per région, named by its two-digit HCP code. Each holds a
`communes` object whose features carry `code`, the nine-digit HCP code used as the key
throughout `../attributes/`, and `name`.

Boundaries come from OpenStreetMap relations at `admin_level=8`, matched to HCP
communes on the `ref:MA:HCP` tag. See LICENSE: this directory is ODbL, the
attribute files are not.

Coordinates are quantised to about metre precision. For an exact boundary, go
back to OpenStreetMap.

## What they don't cover

1,502 of the 1,503 communes have a boundary. Sidi Mohamed Benmansour (`04.281.05.11`)
doesn't: its OpenStreetMap relation has no outer ring that closes, so it's left out
rather than repaired by guesswork.

About 88 km² between Ifrane and Boulemane, in the cercle of Azrou, lies inside no
commune. OpenStreetMap has no `admin_level=8` relation there, though HCP places all of
Morocco in some commune, so a point-in-polygon lookup in that area finds nothing. The
build knows about this gap. It fails if another one appears, and it fails if this one is
filled, so the list of known gaps can't go stale.
