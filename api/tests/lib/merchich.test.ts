import { describe, expect, it } from "vitest";
import { merchichToWgs } from "../../src/lib/merchich.ts";

// pyproj, EPSG:26191 to EPSG:4326, on points from the purchased douar file.
const POINTS: [number, number, number, number][] = [
  [502353.976, 450428.9464, 34.65391905, -5.37270179],
  [778442.329, 481294.869, 34.89548067, -2.35173296],
  [179939.634, 192260.851, 32.27861195, -8.79718113],
  [611377.542, 394469.482, 34.14354434, -4.19043488],
  [373114.048, 121805.589, 31.68281334, -6.73665637],
  [443830.071, 370106.363, 33.928204, -6.00607557],
  [411367.582, 233067.638, 32.6900474, -6.34384969],
];

describe("Merchich Nord Maroc to WGS84", () => {
  it("lands on the same point proj does, to a metre", () => {
    for (const [x, y, lat, lng] of POINTS) {
      const got = merchichToWgs(x, y);
      expect(got.lat).toBeCloseTo(lat, 5);
      expect(got.lng).toBeCloseTo(lng, 5);
    }
  });
});
