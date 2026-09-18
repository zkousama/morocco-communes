# morocco-communes

Morocco's 12 régions, 83 provinces and préfectures, 213 cercles, 1,503 communes and 41
arrondissements, with their HCP codes, names in French and Arabic, and population from the
2024 census. It works offline and has no dependencies.

```sh
npm install morocco-communes
```

```js
import { regions, provincesOf, communesOf, getCommune } from "morocco-communes";

regions[0].name.fr;         // "Tanger-Tétouan-Al Hoceima"
provincesOf("01");          // its 8 provinces and préfectures
communesOf("01.511");       // the 12 communes of Tanger-Assilah
getCommune("tanger");       // { code: "01.511.01.0", type: "urban", population: 1275428, ... }
```

Each list is also its own module, so a région dropdown doesn't pull in every commune:

```js
import regions from "morocco-communes/regions";
```

## Records

| List | Fields |
|---|---|
| `regions` | `code`, `name`, `population` |
| `provinces` | `code`, `name`, `type`, `region`, `population` |
| `cercles` | `code`, `name`, `region`, `province`, `population` |
| `communes` | `code`, `slug`, `name`, `type`, `region`, `province`, `cercle`, `population`, `population2014` |
| `arrondissements` | `code`, `name`, `commune`, `population` |

`name` is `{ fr, ar }`. `population` is the 2024 census total. A parent is given by its
code, and a commune's `cercle` is null when it's urban.

The code is the hierarchy: `01.511.01.0` is a commune of province `01.511`, in région `01`.

## Helpers

- `getCommune(codeOrSlug)` finds a commune by `01.511.01.0` or `tanger`.
- `provincesOf(region)`, `cerclesOf(province)` and `arrondissementsOf(commune)` list a unit's children.
- `communesOf(code)` takes a région, a province or a cercle.
- `version` is the dataset's version, which is also the package's.

## More

Boundaries, centroids, the 2014 census in full, households and search are in the
[repository](https://github.com/zkousama/morocco-communes-api) and its API. The
boundaries come from OpenStreetMap under ODbL, so they aren't in this package.

## Licence

The code is MIT. The data is from the Haut-Commissariat au Plan (RGPH 2024 and 2014);
credit it when you publish it.
