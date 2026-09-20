"""
The package against the dataset it was built from: the same rows, the same figures, and
the codes still strings. Run from the repository root, where data/v1 is:

    python3 packages/morocco-communes-py/build_data.py
    python3 -m unittest discover -s packages/morocco-communes-py/tests
"""

import csv
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "morocco-communes-py" / "src"))

import morocco_communes as mc  # noqa: E402  (the path has to be set first)

DATA = ROOT / "data" / "v1"


def published(*parts: str):
    return json.loads((DATA / Path(*parts)).read_text(encoding="utf-8"))


def published_communes(census: str) -> list:
    """The communes of a census, which are published a file per région."""
    folder = DATA / "indicators" / census / "communes" if census else DATA / "indicators" / "communes"
    return [row for path in sorted(folder.glob("*.json")) for row in json.loads(path.read_text(encoding="utf-8"))]


class TestUnits(unittest.TestCase):
    def test_every_unit_is_here(self) -> None:
        for name, table in [
            ("regions", mc.regions),
            ("provinces", mc.provinces),
            ("cercles", mc.cercles),
            ("communes", mc.communes),
            ("arrondissements", mc.arrondissements),
        ]:
            with self.subTest(name):
                self.assertEqual(len(table()), len(published("attributes", f"{name}.json")))

    def test_codes_keep_their_leading_zeros(self) -> None:
        tanger = mc.communes().set_index("code").loc["01.511.01.0"]
        self.assertEqual(tanger["code_digits"], "001511010")
        self.assertEqual(tanger["region_code"], "01")
        self.assertEqual(tanger["name_ar"], "طنجة")

    def test_the_figures_are_the_dataset_s(self) -> None:
        communes = {c["code"]: c for c in published("attributes", "communes.json")}
        frame = mc.communes().set_index("code")
        for code in ["01.511.01.0", "09.581.01.07", "12.066.03.07"]:
            with self.subTest(code):
                self.assertEqual(int(frame.loc[code, "population_2024"]), communes[code]["population"]["2024"]["total"])

    def test_the_openstreetmap_fields_are_left_out(self) -> None:
        columns = set(mc.communes().columns)
        self.assertEqual(columns & {"area_km2", "density_2024"}, set())


class TestCensus(unittest.TestCase):
    def test_both_censuses_are_here(self) -> None:
        for census in ("2024", "2014"):
            for subject in ("people", "households"):
                with self.subTest(census=census, subject=subject):
                    self.assertGreater(len(mc.indicators(subject, census=census)), 1000)

    def test_a_figure_matches_the_dataset(self) -> None:
        people = mc.indicators("people")
        tanger = people[(people["code"] == "01.511.01.0") & (people["area"] == "total") & (people["sex"] == "all")]
        figure = next(r for r in published_communes("") if r["code"] == "01.511.01.0")
        self.assertAlmostEqual(
            float(tanger["labour_unemployment_rate"].iloc[0]),
            figure["people"]["total"]["all"]["labour"]["unemploymentRate"],
        )

    def test_it_refuses_a_census_it_does_not_have(self) -> None:
        with self.assertRaises(ValueError):
            mc.indicators("people", census="2004")
        with self.assertRaises(ValueError):
            mc.indicators("firms")


class TestEconomy(unittest.TestCase):
    def test_every_unit_with_establishments_is_here(self) -> None:
        rows = sum(
            len(published("economy", f"{name}.json")) if name != "national" else 1
            for name in ["national", "regions", "provinces", "cercles", "communes", "arrondissements"]
        )
        self.assertEqual(len(mc.economy()), rows)

    def test_the_parts_make_the_total(self) -> None:
        frame = mc.economy()
        parts = frame["establishments_public_services"] + frame["establishments_non_profit"] + frame["establishments_business"]
        self.assertTrue((parts == frame["establishments_total"]).all())

    def test_the_fields_describe_the_columns(self) -> None:
        fields = mc.fields("economy")
        self.assertEqual(set(fields["column"]) - set(mc.economy().columns), set())
        self.assertEqual(len(fields), 22)


class TestWithoutPandas(unittest.TestCase):
    def test_a_table_reads_as_dicts(self) -> None:
        rows = mc.communes(as_frame=False)
        self.assertEqual(len(rows), len(mc.communes()))
        tanger = next(r for r in rows if r["code"] == "01.511.01.0")
        self.assertEqual(tanger["code_digits"], "001511010")
        self.assertIsInstance(tanger["population_2024"], int)
        self.assertIsInstance(tanger["change_pct"], float)
        self.assertIsNone(tanger["cercle_code"])

    def test_the_crosswalk_reads_too(self) -> None:
        rows = mc.crosswalk(as_frame=False)
        self.assertEqual(len(rows), len(published("crosswalk", "2014-2024.json")))
        self.assertTrue(all(isinstance(r["code_2014"], str) for r in rows))


class TestProvenance(unittest.TestCase):
    def test_the_version_is_the_dataset_s(self) -> None:
        self.assertEqual(mc.version, published("sources.json")["datasetVersion"])

    def test_it_says_where_the_data_came_from(self) -> None:
        ids = [s["id"] for s in mc.sources()["sources"]]
        self.assertIn("hcp-2024", ids)
        self.assertIn("hcp-2024-establishments", ids)

    def test_every_shipped_table_has_a_header_and_rows(self) -> None:
        for name in mc._data._tables():
            with self.subTest(name):
                header = mc._data._header(name)
                self.assertTrue(header[0].startswith("code"), header[0])
                self.assertGreater(len(mc._data._dicts(name)), 0)


if __name__ == "__main__":
    unittest.main()
