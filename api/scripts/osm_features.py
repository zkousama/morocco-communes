"""
OpenStreetMap's places in Morocco, and the schools, mosques and other features named
after a douar, from Geofabrik's daily extract of the country, to .cache/osm/morocco-features.json
for api:douar-places. `pnpm api:osm-features`; needs pyosmium (pip install osmium).

The extract is checked against the MD5 Geofabrik publishes beside it, and kept in .cache/osm
until a newer one is asked for with FRESH=1. Reading it takes seconds: the name filter runs
in osmium's C++, before Python sees an object. A feature drawn as an area is placed at the
mean of its nodes.
"""
import hashlib
import json
import os
import sys
import urllib.request

import osmium
from osmium.filter import KeyFilter

URL = "https://download.geofabrik.de/africa/morocco-latest.osm.pbf"
CACHE = ".cache/osm"
PBF = f"{CACHE}/morocco-latest.osm.pbf"
OUT = f"{CACHE}/morocco-features.json"
AGENT = {"User-Agent": "morocco-communes (github.com/zkousama/morocco-communes)"}

PLACES = {"village", "hamlet", "town", "locality", "isolated_dwelling", "neighbourhood", "suburb", "quarter", "farm", "allotments"}
# Features a village names after itself: its school, its mosque, its health post, its post office.
AMENITIES = {"school", "place_of_worship", "kindergarten", "townhall", "clinic", "doctors", "post_office"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=120) as response:
        return response.read()


def download():
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(PBF) and not os.environ.get("FRESH"):
        return
    expected = fetch(f"{URL}.md5").decode().split()[0]
    request = urllib.request.Request(URL, headers=AGENT)
    with urllib.request.urlopen(request, timeout=600) as response, open(f"{PBF}.part", "wb") as out:
        while chunk := response.read(1 << 20):
            out.write(chunk)
    digest = hashlib.md5(open(f"{PBF}.part", "rb").read()).hexdigest()
    if digest != expected:
        sys.exit(f"the extract's MD5 is {digest}, Geofabrik's is {expected}: download it again")
    os.replace(f"{PBF}.part", PBF)


def kind_of(tags):
    if tags.get("place") in PLACES:
        return "place=" + tags["place"]
    if tags.get("amenity") in AMENITIES:
        return "amenity=" + tags["amenity"]
    if tags.get("landuse") == "residential":
        return "landuse=residential"
    name = tags.get("name", "")
    if "douar" in name.lower() or "دوار" in name:
        return "other"
    return None


def main():
    download()
    as_of = osmium.io.Reader(PBF, osmium.osm.osm_entity_bits.NOTHING).header().get("osmosis_replication_timestamp")
    features = []
    for o in osmium.FileProcessor(PBF).with_locations().with_filter(KeyFilter("name")):
        kind = kind_of(o.tags)
        if not kind:
            continue
        if o.is_node():
            if not o.location.valid():
                continue
            lat, lng, oid = o.location.lat, o.location.lon, f"n{o.id}"
        elif o.is_way():
            points = [(n.lat, n.lon) for n in o.nodes if n.location.valid()]
            if not points:
                continue
            lat = sum(p[0] for p in points) / len(points)
            lng = sum(p[1] for p in points) / len(points)
            oid = f"w{o.id}"
        else:
            continue
        names = {t.k: t.v for t in o.tags if t.k == "name" or t.k.startswith("name:") or t.k in ("alt_name", "old_name", "official_name")}
        features.append({"id": oid, "kind": kind, "lat": round(lat, 5), "lng": round(lng, 5), "names": names})
    with open(OUT, "w", encoding="utf8") as out:
        json.dump({"asOf": as_of, "features": features}, out, ensure_ascii=False)
    print(f"osm-features: {len(features)} features from the map of {as_of}, to {OUT}")


main()
