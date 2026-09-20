# morocco-communes

Morocco's 12 régions, 83 provinces and préfectures, 213 cercles, 1,503 communes and 41
arrondissements, with HCP's codes, names in French and Arabic, the 2024 and 2014 census
figures, and the establishments the 2024 census mapped. It reads from files inside the
package, so it works offline.

```sh
pip install "morocco-communes[pandas]"
```

```python
import morocco_communes as mc

communes = mc.communes()                    # 1,503 rows
communes[communes["region_code"] == "01"]   # the 146 in Tanger-Tétouan-Al Hoceima

people = mc.indicators("people")            # the 2024 census, by unit, area and sex
economy = mc.economy()                      # the establishments, by unit
housing = mc.housing()                      # the urban dwellings, by unit
```

Every table is a pandas DataFrame. With `as_frame=False` it's a list of dicts instead, and
then the package needs nothing but the standard library.

## Tables

| Call | Rows |
|---|---|
| `regions()`, `provinces()`, `cercles()`, `communes()`, `arrondissements()` | one per unit |
| `indicators(subject, census)` | one per unit and area, and per sex for people |
| `economy()` | one per unit, from the country down to the commune |
| `housing()` | one per unit with an urban area, 784 of them |
| `crosswalk()` | one per commune renumbered in 2015 |

`indicators` takes `"people"` or `"households"`, and `census` `"2024"` or `"2014"`. The
2024 census asks 65 of the 2014 questions the same way, so those columns subtract.

`fields()` says what each column measures, with HCP's own heading for it and its unit, and
for 2024 the concept HCP defines it under and its wording. It takes `"indicators"`,
`"indicators2014"`, `"economy"` or `"housing"`. `sources()` gives each
workbook's URL, its SHA-256 and the date it was read, and `version` is the dataset's.

## Codes

A unit is identified by its HCP code, and the code is the hierarchy: `01.511.01.0` is a
commune of province `01.511`, in région `01`. Codes stay strings, so `code_digits` keeps
the leading zeros that make it 9 digits wide.

## What's elsewhere

Boundaries, which communes border which, search, the urban centres and a commune lookup by
point are in the [repository](https://github.com/zkousama/morocco-communes) and its API.
Those all come from OpenStreetMap under ODbL, so they aren't in this package, and neither
are the area and density fields derived from them. `data/v1/geometry/adjacency.csv` is the
contiguity graph if you want one: `pandas.read_csv` takes it straight.

## Licence

The code is MIT. The data is the Haut-Commissariat au Plan's, from RGPH 2024 and RGPH
2014, reusable on CC BY 4.0 terms: credit it and say what you changed.
