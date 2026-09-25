import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocal } from "../src/model.ts";

describe("the local folder", () => {
  it("is nothing when INSIGHTS_LOCAL isn't set", () => {
    expect(readLocal({})).toBeNull();
  });
  it("reads terms and keys from wherever it points", () => {
    const dir = mkdtempSync(join(tmpdir(), "local-"));
    writeFileSync(join(dir, "terms.txt"), "# a comment\nzorblat\n\nquix vane\n");
    writeFileSync(join(dir, "keys.env"), "GEMINI_API_KEY=abc123\nOTHER=x=y\n");
    expect(readLocal({ INSIGHTS_LOCAL: dir })).toEqual({ terms: ["zorblat", "quix vane"], keys: { GEMINI_API_KEY: "abc123", OTHER: "x=y" } });
  });
  it("treats missing files as empty", () => {
    expect(readLocal({ INSIGHTS_LOCAL: mkdtempSync(join(tmpdir(), "empty-")) })).toEqual({ terms: [], keys: {} });
  });
  it("throws a clean error, naming no path, when INSIGHTS_LOCAL names a file rather than a folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "local-"));
    const notAFolder = join(dir, "settings");
    writeFileSync(notAFolder, "x");

    let message = "";
    try {
      readLocal({ INSIGHTS_LOCAL: notAFolder });
      throw new Error("readLocal didn't throw");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("terms.txt");
    expect(message).not.toContain(notAFolder);
    expect(message).not.toContain(dir);
    expect(message).not.toContain(basename(notAFolder));
  });
});
