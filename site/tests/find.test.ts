import { describe, expect, it } from "vitest";
import { escape, hrefOf, isolate, metaOf, rowHtml, rowOf, type Places } from "../src/lib/find";
import { placesFor, shortcuts } from "../src/lib/findData";
import { ui } from "../src/i18n/ui";

const FSI = "⁨";
const PDI = "⁩";

const places: Places = {
  base: { commune: "/communes/", province: "/provinces/", region: "/regions/" },
  regions: { "06": "Casablanca-Settat", "07": "Marrakech-Safi" },
  cities: { "06.141.01.0": { slug: "casablanca", name: "Casablanca" } },
  prefectures: ["06.141"],
  shared: { "07.391.05.03": "Rehamna" },
};
const levels = ui.en.findLevels;

describe("the placeholder", () => {
  it("isolates the Arabic, so the code after it stays on its right", () => {
    expect(isolate("Tanger, Tafraout, طنجة, 01.511.01.0…")).toBe(`Tanger, Tafraout, ${FSI}طنجة${PDI}, 01.511.01.0…`);
  });

  it("keeps a name of 2 words, or 2 joined by a hyphen, in one isolate", () => {
    expect(isolate("الدار البيضاء")).toBe(`${FSI}الدار البيضاء${PDI}`);
    expect(isolate("الدار البيضاء-سطات")).toBe(`${FSI}الدار البيضاء-سطات${PDI}`);
  });

  it("leaves Latin text alone, and doesn't isolate a run twice", () => {
    expect(isolate("Tanger, 01.511.01.0")).toBe("Tanger, 01.511.01.0");
    const once = isolate("Fès, فاس");
    expect(isolate(once)).toBe(once);
  });

  it("is isolated in both languages", () => {
    for (const copy of [ui.en, ui.fr]) {
      const text = isolate(copy.findPlaceholder);
      expect(text).toContain(`${FSI}طنجة${PDI}`);
    }
  });
});

describe("a result's page", () => {
  it("is its own for a commune, a province and a région", () => {
    expect(hrefOf({ code: "06.141.01.0", level: "commune", name: { fr: "Casablanca", ar: "" }, slug: "casablanca" }, places)).toBe(
      "/communes/casablanca/",
    );
    expect(hrefOf({ code: "06.141", level: "province", name: { fr: "Casablanca", ar: "" }, slug: "casablanca" }, places)).toBe(
      "/provinces/casablanca/",
    );
    expect(hrefOf({ code: "06", level: "region", name: { fr: "", ar: "" }, slug: "casablanca-settat" }, places)).toBe(
      "/regions/casablanca-settat/",
    );
  });

  it("is its city's for an arrondissement", () => {
    expect(hrefOf({ code: "06.141.01.05", level: "arrondissement", name: { fr: "Anfa", ar: "" }, slug: "anfa" }, places)).toBe(
      "/communes/casablanca/",
    );
  });

  it("is missing for a cercle, which has no page", () => {
    const cercle = { code: "07.351.01", level: "cercle", name: { fr: "X", ar: "" }, slug: "x" };
    expect(hrefOf(cercle, places)).toBeNull();
    expect(rowOf(cercle, places, levels)).toBeNull();
  });
});

describe("the line under a result's name", () => {
  const hit = (code: string, level: string) => ({ code, level, name: { fr: "N", ar: "ن" }, slug: "n" });

  it("gives the level and the région", () => {
    expect(metaOf(hit("06.141.01.0", "commune"), places, levels)).toBe("Commune · Casablanca-Settat");
    expect(metaOf(hit("07.351", "province"), places, levels)).toBe("Province · Marrakech-Safi");
  });

  it("calls a préfecture a préfecture", () => {
    expect(metaOf(hit("06.141", "province"), places, levels)).toBe("Préfecture · Casablanca-Settat");
  });

  it("names an arrondissement's city", () => {
    expect(metaOf(hit("06.141.01.05", "arrondissement"), places, levels)).toBe("Arrondissement · Casablanca");
  });

  it("names the province of a commune whose name another commune shares", () => {
    expect(metaOf(hit("07.391.05.03", "commune"), places, levels)).toBe("Commune · Rehamna");
  });

  it("is the level alone for a région", () => {
    expect(metaOf(hit("06", "region"), places, levels)).toBe("Région");
  });

  it("uses the French level names in French", () => {
    expect(metaOf(hit("06.141", "province"), places, ui.fr.findLevels)).toBe("Préfecture · Casablanca-Settat");
    expect(metaOf(hit("06.141.01.0", "commune"), places, ui.fr.findLevels)).toBe("Commune · Casablanca-Settat");
  });
});

describe("a row", () => {
  it("escapes what it's given", () => {
    const html = rowHtml({ href: "/communes/x/", name: "<b>M'diq</b>", meta: "Commune · A & B", ar: "مضيق" }, "hit-0");
    expect(html).toContain("&#60;b&#62;M&#39;diq&#60;/b&#62;");
    expect(html).toContain('Commune <span class="hit-sep">·</span> A &#38; B');
    expect(escape('"')).toBe("&#34;");
  });

  it("sets the Arabic right to left, as Arabic", () => {
    const html = rowHtml({ href: "/", name: "Fès", meta: "Commune", ar: "فاس" }, "hit-1");
    expect(html).toContain('<span class="hit-ar" lang="ar" dir="rtl">فاس</span>');
    expect(html).toContain('role="option"');
  });

  it("reads as words, with a space between the name, the line under it and the Arabic", () => {
    const html = rowHtml({ href: "/", name: "Fès", meta: "Commune · Fès-Meknès", ar: "فاس" }, "hit-2");
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("Fès Commune · Fès-Meknès فاس");
  });
});

describe("what the build hands the search", () => {
  const built = placesFor("fr");

  it("knows every région, and the 6 cities that hold arrondissements", () => {
    expect(Object.keys(built.regions)).toHaveLength(12);
    expect(built.regions["06"]).toBe("Casablanca-Settat");
    expect(Object.keys(built.cities)).toHaveLength(6);
    expect(built.cities["06.141.01.0"]).toEqual({ slug: "casablanca", name: "Casablanca" });
  });

  it("links to the pages in the page's language", () => {
    expect(built.base.commune).toBe("/fr/communes/");
    expect(placesFor("en").base.region).toBe("/regions/");
  });

  it("lists the préfectures, Casablanca's among them, and no province", () => {
    expect(built.prefectures).toContain("06.141");
    expect(built.prefectures).not.toContain("07.391");
  });

  it("gives a province for every commune whose name is shared", () => {
    const codes = Object.keys(built.shared);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => built.shared[code])).toBe(true);
  });
});

describe("the shortcuts", () => {
  it("are empty when nothing has been counted", () => {
    expect(shortcuts("en", [])).toEqual([]);
  });

  it("keep the ranking's order, skip a code with no page, and stop at 5", () => {
    const ranking = ["06.141.01.0", "99.999.99.9", "01.511.01.0", "06", "06.141", "01.511.01.05", "07.351.01.0"].map((code) => ({ code }));
    const rows = shortcuts("en", ranking);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ href: "/communes/casablanca/", name: "Casablanca", meta: "Commune · Casablanca-Settat", ar: "الدار البيضاء" });
    expect(rows.map((r) => r.meta)).toEqual([
      "Commune · Casablanca-Settat",
      "Commune · Tanger-Tétouan-Al Hoceima",
      "Région",
      "Préfecture · Casablanca-Settat",
      "Arrondissement · Tanger",
    ]);
  });
});
