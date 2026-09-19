/**
 * Which commune contains a point. The boundaries are cut at build time into square tiles,
 * split in four wherever a tile would hold too many points, so a lookup reads one small
 * file and tests a few clipped polygons. The index below says which tiles exist.
 */

/** The quadtree the tiles form. Tile z/x/y covers 1/2^z of a degree on each side. */
export interface TileIndex {
  /** Longitude and latitude of the south-west corner of tile x=0, y=0 at every zoom. */
  origin: [number, number];
  maxZoom: number;
  /** Tiles cut into 4 smaller ones. */
  split: string[];
  /** Tiles that hold boundaries. A tile in neither list covers no commune. */
  leaf: string[];
}

export interface Tile {
  /** The tile's south-west corner, in degrees. */
  origin: [number, number];
  /** The size of one coordinate step, in degrees. */
  unit: number;
  /** Each commune's rings, clipped to the tile, as flat x,y pairs counted in steps from the origin. */
  communes: { code: string; rings: number[][] }[];
}

export interface PreparedIndex {
  origin: [number, number];
  maxZoom: number;
  split: Set<string>;
  leaf: Set<string>;
}

export const prepareIndex = (index: TileIndex): PreparedIndex => ({
  origin: index.origin,
  maxZoom: index.maxZoom,
  split: new Set(index.split),
  leaf: new Set(index.leaf),
});

export const tilePath = (key: string) => `/api/tiles/${key}.json`;

/** The key of the tile a point falls in, or null when no boundary is anywhere near it. */
export function tileAt(index: PreparedIndex, lat: number, lng: number): string | null {
  for (let z = 0; z <= index.maxZoom; z++) {
    const n = 2 ** z;
    const key = `${z}/${Math.floor((lng - index.origin[0]) * n)}/${Math.floor((lat - index.origin[1]) * n)}`;
    if (index.leaf.has(key)) return key;
    if (!index.split.has(key)) return null;
  }
  return null;
}

/**
 * The code of the commune whose boundary contains the point, by the even-odd rule over all
 * of its rings, so a hole in a commune reads as outside it. Null when none does.
 */
export function communeIn(tile: Tile, lat: number, lng: number): string | null {
  const x = (lng - tile.origin[0]) / tile.unit;
  const y = (lat - tile.origin[1]) / tile.unit;
  for (const commune of tile.communes) {
    let inside = false;
    for (const ring of commune.rings) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const xi = ring[i]!;
        const yi = ring[i + 1]!;
        const xj = ring[j]!;
        const yj = ring[j + 1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return commune.code;
  }
  return null;
}
