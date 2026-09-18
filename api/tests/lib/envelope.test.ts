import { describe, expect, it } from "vitest";
import { envelope, paginate, pageMeta, problem } from "../../src/lib/envelope.ts";

describe("envelope", () => {
  it("always carries the dataset version, so a cached response can be dated", () => {
    const body = envelope([{ code: "01" }], { self: "/api/regions.json" });
    expect(body.meta.datasetVersion).toBe("1.0.0");
    expect(body.data).toEqual([{ code: "01" }]);
    expect(body.links.self).toBe("/api/regions.json");
  });

  it("keeps prev and next present as null at the ends rather than omitting them", () => {
    const body = envelope([], { self: "/x" });
    expect("prev" in body.links).toBe(true);
    expect("next" in body.links).toBe(true);
    expect(body.links.prev).toBeNull();
    expect(body.links.next).toBeNull();
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 125 }, (_, i) => i);

  it("slices at 50 and reports the totals", () => {
    const { slice, meta } = paginate(items, 1, 50);
    expect(slice.length).toBe(50);
    expect(slice[0]).toBe(0);
    expect(meta).toEqual({ page: 1, perPage: 50, total: 125, totalPages: 3 });
  });

  it("returns the short last page rather than padding it", () => {
    const { slice, meta } = paginate(items, 3, 50);
    expect(slice.length).toBe(25);
    expect(slice[0]).toBe(100);
    expect(meta.totalPages).toBe(3);
  });

  it("gives an empty list one page, so page 1 always exists", () => {
    const { slice, meta } = paginate([], 1, 50);
    expect(slice).toEqual([]);
    expect(meta).toEqual({ page: 1, perPage: 50, total: 0, totalPages: 1 });
  });
});

describe("pageMeta links", () => {
  it("nulls prev on the first page and next on the last", () => {
    const first = pageMeta("/api/communes/page", 1, 3);
    expect(first).toEqual({ self: "/api/communes/page/1.json", prev: null, next: "/api/communes/page/2.json" });
    const last = pageMeta("/api/communes/page", 3, 3);
    expect(last).toEqual({ self: "/api/communes/page/3.json", prev: "/api/communes/page/2.json", next: null });
  });

  it("nulls both on a single-page list", () => {
    expect(pageMeta("/api/arrondissements/page", 1, 1)).toEqual({
      self: "/api/arrondissements/page/1.json",
      prev: null,
      next: null,
    });
  });
});

describe("problem", () => {
  it("distinguishes a code that does not exist from one that is malformed", () => {
    const missing = problem("not-found", "No commune has code 99.999.99.99", "/api/communes/99.999.99.99", "https://x.test");
    expect(missing.status).toBe(404);
    expect(missing.type).toBe("https://x.test/docs/api/#not-found");
    expect(missing.instance).toBe("/api/communes/99.999.99.99");

    const malformed = problem("invalid-code", "banana is not an HCP code", "/api/communes/banana", "https://x.test");
    expect(malformed.status).toBe(400);
    expect(malformed.type).toBe("https://x.test/docs/api/#invalid-code");
  });

  it("carries every RFC 9457 member, so a client can render it without guessing", () => {
    const p = problem("invalid-query", "radius must be a number", "/api/communes/near?radius=x", "https://x.test");
    expect(Object.keys(p).sort()).toEqual(["detail", "instance", "status", "title", "type"]);
    expect(p.title.length).toBeGreaterThan(0);
  });
});
