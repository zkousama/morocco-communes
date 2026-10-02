import { describe, expect, it } from "vitest";
import { align, spell, train } from "../../src/lib/graphones.ts";

// Made-up pairs that agree on how each letter is written, so the model has one answer to learn.
const pairs: [string, string][] = [
  ["تيت", "tit"], ["تيم", "tim"], ["ميت", "mit"], ["تمت", "tamt"], ["مت", "mat"], ["تم", "tam"],
  ["ريت", "rit"], ["تير", "tir"], ["رمت", "ramt"], ["مير", "mir"], ["تمر", "tamr"], ["رم", "ram"],
];

describe("the joint-sequence model", () => {
  it("aligns each pair into graphones that read the whole of both", () => {
    for (const [seq, [s, t]] of align(pairs).map((seq, i) => [seq, pairs[i]!] as const)) {
      expect(seq.map((g) => g[0]).join("")).toBe(s);
      expect(seq.map((g) => g[1]).join("")).toBe(t);
    }
  });

  it("spells a word it hasn't seen from the graphones it learned, best first", () => {
    const model = train(pairs, 3);
    expect(spell(model, "ريم")[0]?.text).toBe("rim");
  });

  it("spells nothing it has no graphone for, rather than make a letter up", () => {
    expect(spell(train(pairs, 3), "زز")).toEqual([]);
  });
});
