import { useEffect, useState } from "react";

// Where the Morocco communes API lives, and what the form calls things.
const API = "https://example.com";
const LABELS = { region: "Région", province: "Province", commune: "Commune", choose: "Choose" };

async function get(path) {
  const response = await fetch(API + path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

// A province's communes come in pages of 50, and no province has more than 2.
async function communesOf(province) {
  const base = `/api/provinces/${province}/communes/page`;
  const first = await get(`${base}/1.json`);
  const rest = [];
  for (let page = 2; page <= first.meta.totalPages; page++) rest.push(get(`${base}/${page}.json`));
  return [first, ...(await Promise.all(rest))].flatMap((body) => body.data);
}

const byName = (a, b) => a.name.fr.localeCompare(b.name.fr, "fr");

/**
 * Région, then province or préfecture, then commune. `value` and `onChange` carry the
 * commune's HCP code, such as 01.511.01.0, and the code's first digits already name its
 * région and province, so a saved value opens on the right lists.
 */
export function CommunePicker({ value = "", onChange, name = "commune" }) {
  const [region, setRegion] = useState(value.slice(0, 2));
  const [province, setProvince] = useState(value.slice(0, 6));
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [communes, setCommunes] = useState([]);

  useEffect(() => {
    get("/api/regions.json").then((body) => setRegions(body.data), console.error);
  }, []);

  useEffect(() => {
    setProvinces([]);
    if (!region) return;
    let current = true;
    get(`/api/regions/${region}/provinces.json`).then((body) => {
      // Préfectures d'arrondissements hold no communes of their own, so they're left out.
      if (current) setProvinces(body.data.filter((p) => p.communeCount > 0).sort(byName));
    }, console.error);
    return () => (current = false);
  }, [region]);

  useEffect(() => {
    setCommunes([]);
    if (!province) return;
    let current = true;
    communesOf(province).then((rows) => current && setCommunes(rows.sort(byName)), console.error);
    return () => (current = false);
  }, [province]);

  return (
    <>
      <label>
        {LABELS.region}
        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setProvince("");
            onChange?.("");
          }}
        >
          <option value="">{LABELS.choose}</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>{r.name.fr}</option>
          ))}
        </select>
      </label>
      <label>
        {LABELS.province}
        <select
          value={province}
          disabled={provinces.length === 0}
          onChange={(e) => {
            setProvince(e.target.value);
            onChange?.("");
          }}
        >
          <option value="">{LABELS.choose}</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>{p.name.fr}</option>
          ))}
        </select>
      </label>
      <label>
        {LABELS.commune}
        <select name={name} value={value} disabled={communes.length === 0} onChange={(e) => onChange?.(e.target.value)}>
          <option value="">{LABELS.choose}</option>
          {communes.map((c) => (
            <option key={c.code} value={c.code}>{c.name.fr}</option>
          ))}
        </select>
      </label>
    </>
  );
}
