"""
Reads the tables the package ships. Each one comes back as a pandas DataFrame, or as a
list of dicts when pandas isn't installed or isn't wanted.

The codes are strings and stay strings: 01.511.01.0 is a commune, and its padded form
001511010 would lose its leading zeros as a number.
"""

from __future__ import annotations

import csv
import gzip
import json
from importlib import resources
from typing import Any, Iterator

__all__ = [
    "regions",
    "provinces",
    "cercles",
    "communes",
    "arrondissements",
    "indicators",
    "economy",
    "housing",
    "crosswalk",
    "fields",
    "sources",
]

#: Columns that are identifiers rather than numbers, wherever they appear.
CODES = frozenset(
    {
        "code",
        "code_digits",
        "region_code",
        "province_code",
        "cercle_code",
        "commune_code",
        "code_2024",
        "code_2014",
    }
)

CENSUSES = ("2024", "2014")
SUBJECTS = ("people", "households")
DICTIONARIES = ("indicators", "indicators2014", "economy", "housing")


def _path(*parts: str):
    return resources.files("morocco_communes").joinpath("data", *parts)


def _header(name: str) -> list[str]:
    with gzip.open(_path(name), "rt", encoding="utf-8") as f:
        return next(csv.reader(f))


def _cell(value: str) -> Any:
    """A CSV cell as what it holds: a whole number, a decimal, or None for an empty one."""
    if value == "":
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def _dicts(name: str) -> list[dict[str, Any]]:
    with gzip.open(_path(name), "rt", encoding="utf-8", newline="") as f:
        return [{k: ((v or None) if k in CODES else _cell(v)) for k, v in row.items()} for row in csv.DictReader(f)]


def _pandas():
    try:
        import pandas as pd
    except ModuleNotFoundError as err:  # pragma: no cover - depends on the environment
        raise ModuleNotFoundError(
            "reading a table as a DataFrame needs pandas: pip install 'morocco-communes[pandas]', "
            "or pass as_frame=False for a list of dicts"
        ) from err
    return pd


def _frame(name: str):
    pd = _pandas()
    text = frozenset(_header(name)) & CODES
    with gzip.open(_path(name), "rb") as f:
        return pd.read_csv(f, dtype={column: "string" for column in text})


def _table(name: str, as_frame: bool):
    return _frame(name) if as_frame else _dicts(name)


def regions(as_frame: bool = True):
    """The 12 régions, with their 2024 population and how much they hold."""
    return _table("attributes/regions.csv.gz", as_frame)


def provinces(as_frame: bool = True):
    """The 83 provinces, préfectures and préfectures d'arrondissements."""
    return _table("attributes/provinces.csv.gz", as_frame)


def cercles(as_frame: bool = True):
    """The 213 cercles, which group the rural communes of a province."""
    return _table("attributes/cercles.csv.gz", as_frame)


def communes(as_frame: bool = True):
    """The 1,503 communes, with their type, parents, and population in 2024 and 2014."""
    return _table("attributes/communes.csv.gz", as_frame)


def arrondissements(as_frame: bool = True):
    """The 41 arrondissements of the 6 cities divided into them."""
    return _table("attributes/arrondissements.csv.gz", as_frame)


def indicators(subject: str = "people", census: str = "2024", as_frame: bool = True):
    """
    HCP's census figures: a row per unit and area for households, and per unit, area and
    sex for people. `subject` is people or households, `census` 2024 or 2014.
    """
    if subject not in SUBJECTS:
        raise ValueError(f"subject is people or households, not {subject!r}")
    if census not in CENSUSES:
        raise ValueError(f"census is 2024 or 2014, not {census!r}")
    folder = "indicators" if census == "2024" else "indicators2014"
    return _table(f"{folder}/{subject}.csv.gz", as_frame)


def economy(as_frame: bool = True):
    """The economic establishments the 2024 census mapped, a row per unit."""
    return _table("economy/establishments.csv.gz", as_frame)


def housing(as_frame: bool = True):
    """
    The urban housing stock the 2024 census counted, a row per unit that has one. It counts
    dwellings rather than households, and only in towns, so a unit with no urban area has
    no row.
    """
    return _table("housing/dwellings.csv.gz", as_frame)


def crosswalk(as_frame: bool = True):
    """The 207 communes renumbered in 2015, each 2024 code beside its 2014 one."""
    return _table("crosswalk/2014-2024.csv.gz", as_frame)


def fields(dataset: str = "indicators", as_frame: bool = True):
    """
    What each column of a table measures: its path, its label, HCP's own heading for it and
    its unit. `dataset` is indicators, indicators2014 or economy.
    """
    if dataset not in DICTIONARIES:
        raise ValueError(f"dataset is one of {', '.join(DICTIONARIES)}, not {dataset!r}")
    document = json.loads(_path("fields", f"{dataset}.json").read_text(encoding="utf-8"))
    rows = document["fields"] if "fields" in document else [*document["people"], *document["households"]]
    return _pandas().DataFrame(rows) if as_frame else rows


def sources() -> dict[str, Any]:
    """Where the data came from: each workbook's URL, digest, licence and the date it was read."""
    return json.loads(_path("sources.json").read_text(encoding="utf-8"))


def _tables() -> Iterator[str]:
    """Every table the package ships, for the tests."""
    for folder in ("attributes", "indicators", "indicators2014", "economy", "housing", "crosswalk"):
        for path in sorted(p.name for p in _path(folder).iterdir()):
            yield f"{folder}/{path}"
