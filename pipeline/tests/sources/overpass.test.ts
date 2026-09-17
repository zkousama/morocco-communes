import { describe, expect, it } from "vitest";
import { buildRegionQuery, OVERPASS_ENDPOINTS } from "../../src/sources/overpass.ts";

describe("buildRegionQuery", () => {
  it("anchors the code filter to the région so regions cannot bleed into each other", () => {
    const q = buildRegionQuery("01");
    expect(q).toContain('"ref:MA:HCP"~"^01\\\\."');
    expect(q).toContain('"admin_level"="8"');
    expect(q).toContain("out geom");
  });

  it("asks for JSON and a timeout below the client's own", () => {
    const q = buildRegionQuery("07");
    expect(q).toContain("[out:json]");
    expect(/\[timeout:(\d+)\]/.exec(q)?.[1]).toBe("110");
  });
});

describe("OVERPASS_ENDPOINTS", () => {
  it("lists more than one mirror, because the main endpoint 504s on these queries", () => {
    expect(OVERPASS_ENDPOINTS.length).toBeGreaterThan(1);
    for (const e of OVERPASS_ENDPOINTS) expect(e.startsWith("https://")).toBe(true);
  });
});
