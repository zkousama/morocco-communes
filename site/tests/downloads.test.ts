import { describe, expect, it } from "vitest";
import { downloads } from "../src/generated/downloads.ts";
import { DOWNLOAD_GROUPS } from "../src/lib/downloads.ts";

describe("the downloads page", () => {
  it("places every group of files the dataset has, once", () => {
    const placed = Object.values(DOWNLOAD_GROUPS).flat();
    expect([...placed].sort()).toEqual(downloads.map((g) => g.key).sort());
  });
});
