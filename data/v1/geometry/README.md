# Commune boundaries, v1

One TopoJSON file per région, named by its two-digit HCP code. Each holds a
`communes` object whose features carry `code` — the nine-digit HCP code, the same
key used throughout `../attributes/` — and `name`.

Boundaries come from OpenStreetMap relations at `admin_level=8`, matched to HCP
communes on the `ref:MA:HCP` tag. See LICENSE: this directory is ODbL, the
attribute files are not.

Coordinates are quantised to about metre precision. For an exact boundary, go
back to OpenStreetMap.
