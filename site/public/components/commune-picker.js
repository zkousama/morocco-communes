/**
 * <commune-picker>: région, then province or préfecture, then commune, filled in from the
 * Morocco communes API. It fills three <select> elements you write yourself, so the labels,
 * the language and the styling stay yours, and the commune's HCP code is posted with the
 * form like any other field.
 *
 *   <commune-picker>
 *     <label>Région <select data-level="region"></select></label>
 *     <label>Province <select data-level="province"></select></label>
 *     <label>Commune <select data-level="commune" name="commune" required></select></label>
 *   </commune-picker>
 *   <script type="module" src="https://<this site>/components/commune-picker.js"></script>
 *
 * Attributes:
 *   api    where the API lives. Defaults to the origin this file was loaded from.
 *   value  a commune code to start on, such as 01.511.01.0. Its région and province follow.
 *   lang   "ar" for Arabic names. French otherwise.
 *
 * It reads only the static files of the API, which cost nothing to serve.
 */
const DEFAULT_API = new URL(import.meta.url).origin;

class CommunePicker extends HTMLElement {
  #selects = {};
  #pending = { province: 0, commune: 0 };

  connectedCallback() {
    if (this.#selects.region) return;
    for (const level of ["region", "province", "commune"]) {
      const select = this.querySelector(`select[data-level="${level}"]`);
      if (!select) throw new Error(`commune-picker needs a <select data-level="${level}">`);
      // An option with an empty value that the page wrote itself is kept as the prompt.
      const prompt = select.querySelector('option[value=""]');
      this.#selects[level] = { select, prompt: prompt ? prompt.textContent : "" };
    }
    this.#selects.region.select.addEventListener("change", () => this.#region());
    this.#selects.province.select.addEventListener("change", () => this.#province());
    this.#start();
  }

  get #api() {
    return (this.getAttribute("api") || DEFAULT_API).replace(/\/$/, "");
  }

  get #lang() {
    return this.getAttribute("lang") === "ar" ? "ar" : "fr";
  }

  async #get(path) {
    const response = await fetch(this.#api + path);
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }

  /** Every commune in a province. The lists are paged, and a province runs to 2 pages at most. */
  async #communes(province) {
    const base = `/api/provinces/${province}/communes/page`;
    const first = await this.#get(`${base}/1.json`);
    const rest = [];
    for (let page = 2; page <= first.meta.totalPages; page++) rest.push(this.#get(`${base}/${page}.json`));
    return [first, ...(await Promise.all(rest))].flatMap((body) => body.data);
  }

  #fill(level, rows, selected = "") {
    const { select, prompt } = this.#selects[level];
    const lang = this.#lang;
    const options = rows.map((row) => new Option(row.name[lang], row.code, false, row.code === selected));
    select.replaceChildren(new Option(prompt, ""), ...options);
    select.disabled = rows.length === 0;
    select.dir = lang === "ar" ? "rtl" : "";
  }

  #clear(...levels) {
    for (const level of levels) this.#fill(level, []);
  }

  #sorted(rows) {
    const lang = this.#lang;
    return rows.slice().sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
  }

  async #start() {
    // A commune's code carries its région and province: 01.511.01.0 is in 01 and 01.511.
    const value = this.getAttribute("value") || "";
    const [region = "", province = ""] = value ? [value.slice(0, 2), value.slice(0, 6)] : [];
    this.#clear("province", "commune");
    try {
      const regions = await this.#get("/api/regions.json");
      this.#fill("region", regions.data, region);
      if (region) await this.#region(province, value);
    } catch (error) {
      this.#failed(error);
    }
  }

  async #region(province = "", commune = "") {
    const region = this.#selects.region.select.value;
    const ticket = ++this.#pending.province;
    this.#clear("province", "commune");
    if (!region) return;
    try {
      const body = await this.#get(`/api/regions/${region}/provinces.json`);
      // A later choice has already replaced this one.
      if (ticket !== this.#pending.province) return;
      // Préfectures d'arrondissements hold no communes of their own, so they're left out.
      const provinces = this.#sorted(body.data.filter((p) => p.communeCount > 0));
      this.#fill("province", provinces, province);
      if (province) await this.#province(commune);
    } catch (error) {
      this.#failed(error);
    }
  }

  async #province(commune = "") {
    const province = this.#selects.province.select.value;
    const ticket = ++this.#pending.commune;
    this.#clear("commune");
    if (!province) return;
    try {
      const communes = await this.#communes(province);
      if (ticket !== this.#pending.commune) return;
      this.#fill("commune", this.#sorted(communes), commune);
    } catch (error) {
      this.#failed(error);
    }
  }

  #failed(error) {
    this.dataset.state = "error";
    this.dispatchEvent(new CustomEvent("commune-picker-error", { detail: error, bubbles: true }));
  }
}

if (!customElements.get("commune-picker")) customElements.define("commune-picker", CommunePicker);
