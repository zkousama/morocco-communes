import { describe, expect, it } from "vitest";
import { toDigits, toDotted, formatRegion, formatProvince, regionOf, provinceOf } from "../../src/lib/codes.ts";

describe("toDigits", () => {
  it("strips punctuation and left-pads to nine", () => {
    expect(toDigits("01.511.05.19.")).toBe("015110519");
    expect(toDigits("15110519")).toBe("015110519");
    expect(toDigits("1511010")).toBe("001511010");
  });
});

describe("toDotted", () => {
  it("composes an ordinary rural commune", () => {
    expect(toDotted("15110519", "1511")).toBe("01.511.05.19");
  });

  it("keeps the one-digit tail of an arrondissement-bearing city", () => {
    expect(toDotted("1511010", "1511")).toBe("01.511.01.0");
    expect(toDotted("7351010", "7351")).toBe("07.351.01.0");
  });

  it("composes an arrondissement", () => {
    expect(toDotted("61410101", "6141")).toBe("06.141.01.01");
  });

  it("composes a commune in a two-digit region", () => {
    expect(toDotted("120660103", "12066")).toBe("12.066.01.03");
  });
});

describe("formatRegion / formatProvince", () => {
  it("pads each level to its own width", () => {
    expect(formatRegion("1")).toBe("01");
    expect(formatRegion("12")).toBe("12");
    expect(formatProvince("1511")).toBe("01.511");
    expect(formatProvince("12066")).toBe("12.066");
  });
});

describe("toDotted for levels under a province", () => {
  it("composes a cercle", () => {
    expect(toDotted("151105", "1511")).toBe("01.511.05");
  });
});

describe("regionOf / provinceOf", () => {
  it("reads the leading groups of a nine-digit key", () => {
    expect(regionOf("015110519")).toBe("01");
    expect(provinceOf("015110519")).toBe("01.511");
  });
});
