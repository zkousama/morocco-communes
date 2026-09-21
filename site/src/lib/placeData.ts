/**
 * The schema.org description of one unit's page, for search engines and the systems that
 * build knowledge graphs from them. A commune links to its Wikidata item and its
 * OpenStreetMap relation, which is how a crawler tells this Tanger from any other page
 * about Tanger. Only written when the deployed origin is known, since every URL in it has
 * to be absolute.
 */
export interface PlaceFacts {
  site: URL | undefined;
  /** The page's own path, from the root. */
  href: string;
  name: { fr: string; ar: string };
  code: string;
  /** The unit it sits in, or Morocco for a région. */
  parent?: { name: string; href: string };
  osm?: { relationId?: number; wikidata?: string } | null;
  centroid?: { lat: number; lng: number } | null;
}

export function placeData(facts: PlaceFacts): Record<string, unknown> | null {
  const { site } = facts;
  if (!site) return null;
  const sameAs = [
    facts.osm?.wikidata && `https://www.wikidata.org/wiki/${facts.osm.wikidata}`,
    facts.osm?.relationId && `https://www.openstreetmap.org/relation/${facts.osm.relationId}`,
  ].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "AdministrativeArea",
    name: facts.name.fr,
    alternateName: facts.name.ar,
    url: new URL(facts.href, site).href,
    identifier: { "@type": "PropertyValue", propertyID: "HCP geographic code", value: facts.code },
    ...(sameAs.length > 0 && { sameAs }),
    containedInPlace: facts.parent
      ? { "@type": "AdministrativeArea", name: facts.parent.name, url: new URL(facts.parent.href, site).href }
      : { "@type": "Country", name: "Morocco", sameAs: "https://www.wikidata.org/wiki/Q1028" },
    ...(facts.centroid && {
      geo: { "@type": "GeoCoordinates", latitude: facts.centroid.lat, longitude: facts.centroid.lng },
    }),
  };
}
