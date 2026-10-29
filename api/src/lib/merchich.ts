/**
 * Merchich / Nord Maroc (EPSG:26191) to WGS84.
 *
 * The purchased douar file is in this grid: a Lambert conformal conic on the Clarke 1880
 * IGN ellipsoid, then the three-shift that EPSG uses from Merchich to WGS84, +31 m,
 * +146 m, +47 m, with no rotation and no scale. The same steps as proj's EPSG:26191 to
 * EPSG:4326, written out so the match doesn't need a projection library.
 */

const A = 6378249.2;
const F = 1 / 293.4660212936269;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);

const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;

const LAT0 = (33.3 * Math.PI) / 180;
const LON0 = (-5.4 * Math.PI) / 180;
const K0 = 0.999625769;
const X0 = 500000;
const Y0 = 300000;

const tOf = (phi: number) => {
  const s = E * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (E / 2);
};

const N = Math.sin(LAT0);
const T0 = tOf(LAT0);
const M0 = Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2);
const CONE = M0 / (N * T0 ** N);
const RHO0 = A * CONE * T0 ** N;

const phiOf = (t: number) => {
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 12; i++) {
    const s = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (E / 2));
  }
  return phi;
};

const toClarke = (lat: number, lng: number): [number, number, number] => {
  const s = Math.sin(lat);
  const radius = A / Math.sqrt(1 - E2 * s * s);
  const c = Math.cos(lat);
  return [radius * c * Math.cos(lng), radius * c * Math.sin(lng), radius * (1 - E2) * s];
};

const fromWgs = (x: number, y: number, z: number): { lat: number; lng: number } => {
  const b = WGS_A * (1 - WGS_F);
  const e2 = WGS_F * (2 - WGS_F);
  const ep2 = (WGS_A * WGS_A - b * b) / (b * b);
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * WGS_A, p * b);
  const st = Math.sin(th);
  const ct = Math.cos(th);
  return {
    lat: Math.atan2(z + ep2 * b * st ** 3, p - e2 * WGS_A * ct ** 3),
    lng: Math.atan2(y, x),
  };
};

/** A Merchich easting and northing, in metres, as WGS84 degrees. */
export function merchichToWgs(x: number, y: number): { lat: number; lng: number } {
  const east = (x - X0) / K0;
  const north = (y - Y0) / K0;
  const rho = Math.sign(N) * Math.hypot(east, RHO0 - north);
  const theta = Math.atan2(east, RHO0 - north);
  const t = (rho / (A * CONE)) ** (1 / N);
  const lat = phiOf(t);
  const lng = LON0 + theta / N;
  const [cx, cy, cz] = toClarke(lat, lng);
  const wgs = fromWgs(cx + 31, cy + 146, cz + 47);
  return { lat: (wgs.lat * 180) / Math.PI, lng: (wgs.lng * 180) / Math.PI };
}
