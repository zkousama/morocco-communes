import { describe, expect, it } from "vitest";
import { refusal, termsPattern } from "../src/safety.ts";

describe("refusal", () => {
  it("refuses a named person", () => {
    expect(refusal("The mayor, Mr Alami, closed the market")).toBe("individuals");
    expect(refusal("Le maire Ahmed Benali a fermé le souk")).toBe("individuals");
    expect(refusal("Mme Tazi a ouvert une école")).toBe("individuals");
  });
  it("needs a capitalised name after a title", () => {
    expect(refusal("The mayor of the town opened a school")).toBeNull();
  });
  it("lets a claim about places and figures through", () => {
    expect(refusal("Families moved to the suburbs, which doubled in size")).toBeNull();
    expect(refusal("Slum-clearance and rehousing programmes moved households out of these districts")).toBeNull();
  });
});

describe("private terms", () => {
  const terms = termsPattern(["zorblat", "quix vane"]);
  it("refuses a listed term, whole, in any case", () => {
    expect(refusal("The Zorblat moved the market", terms)).toBe("terms");
    expect(refusal("a quix   vane was built", terms)).toBe("terms");
  });
  it("doesn't find a listed term inside a longer word", () => {
    expect(refusal("zorblatism rose", terms)).toBeNull();
  });
  it("has nothing to match without terms", () => {
    expect(termsPattern([])).toBeNull();
    expect(refusal("The Zorblat moved the market", null)).toBeNull();
  });
  it("reads a term the way it reads the text: a curly apostrophe as a straight one", () => {
    const curly = termsPattern(["qu’ix"]);
    expect(refusal("the qu'ix vane", curly)).toBe("terms");
    expect(refusal("the qu’ix vane", curly)).toBe("terms");
  });
  it("trims a term and matches its inner spaces however many there are", () => {
    const spaced = termsPattern(["  quix  vane\t"]);
    expect(refusal("a quix vane was built", spaced)).toBe("terms");
    expect(refusal("a quix\tvane was built", spaced)).toBe("terms");
    expect(refusal("a quixvane was built", spaced)).toBeNull();
  });
  it("never lets a blank term match everything", () => {
    expect(termsPattern(["   ", "\t"])).toBeNull();
    expect(refusal("anything at all", termsPattern(["", "zorblat"]))).toBeNull();
  });
});
