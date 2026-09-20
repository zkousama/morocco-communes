"""
Morocco's administrative divisions and census figures, offline.

    import morocco_communes as mc

    mc.communes()                       # 1,503 rows, with 2024 and 2014 population
    mc.indicators("people")             # the 2024 census, by unit, area and sex
    mc.economy()                        # the establishments the 2024 census mapped

Every table comes back as a pandas DataFrame, or as a list of dicts with as_frame=False,
which needs nothing but the standard library. `fields()` says what each column measures.

The figures are the Haut-Commissariat au Plan's, from RGPH 2024 and RGPH 2014. Credit it
when you publish them. The boundaries are in the repository and its API instead: they come
from OpenStreetMap under ODbL, and so are the area and density fields derived from them.
"""

from ._data import (
    arrondissements,
    cercles,
    communes,
    crosswalk,
    economy,
    fields,
    indicators,
    provinces,
    regions,
    sources,
)
from ._version import __version__

#: The dataset's version, which is also the package's.
version = __version__

__all__ = [
    "arrondissements",
    "cercles",
    "communes",
    "crosswalk",
    "economy",
    "fields",
    "indicators",
    "provinces",
    "regions",
    "sources",
    "version",
    "__version__",
]
