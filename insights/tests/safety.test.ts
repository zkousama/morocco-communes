import { describe, expect, it } from "vitest";
import { refusal } from "../src/safety.ts";

describe("refusal", () => {
  it("refuses blame on a political actor", () => {
    expect(refusal("The ministry's neglect emptied the town")).toBe("political");
    expect(refusal("Le gouvernement a abandonné la commune")).toBe("political");
  });
  it("refuses claims about ethnic or religious groups", () => {
    expect(refusal("Berbers left for the cities")).toBe("groups");
    expect(refusal("Les juifs de la ville sont partis")).toBe("groups");
  });
  it("refuses claims about a named person", () => {
    expect(refusal("The mayor, Mr Alami, closed the market")).toBe("individuals");
  });
  it("lets a claim about places and figures through", () => {
    expect(refusal("Families moved to the suburbs, which doubled in size")).toBeNull();
    expect(refusal("Tamazight is used by fewer people than in 2014")).toBeNull();
  });

  it("matches accented words whole, with either apostrophe", () => {
    expect(refusal("Les réfugiés sont arrivés après 2015")).toBe("groups");
    expect(refusal("La négligence de l’État a vidé le village")).toBe("political");
  });
  it("doesn't find a listed word inside a longer one", () => {
    expect(refusal("Une partie des familles est partie vers la côte")).toBeNull();
    expect(refusal("More people read and write Arabic than in 2014")).toBeNull();
  });
  it("needs a capitalised name after a title", () => {
    expect(refusal("Le maire Ahmed Benali a fermé le souk")).toBe("individuals");
    expect(refusal("Mme Tazi a ouvert une école")).toBe("individuals");
    expect(refusal("The mayor of the town opened a school")).toBeNull();
  });
});
