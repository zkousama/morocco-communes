import { describe, expect, it, vi } from "vitest";
import { publishable, read } from "../scripts/attention.ts";

describe("what reaches the public page", () => {
  it("keeps places seen 5 times or more, and drops the rest", () => {
    const rows = [
      { code: "01.511.01.0", n: 40, bot: 0 },
      { code: "04.421.01.0", n: 5, bot: 0 },
      { code: "07.351.01.0", n: 4, bot: 0 },
      { code: "06.141.01.0", n: 90, bot: 1 },
    ];
    expect(publishable(rows)).toEqual([
      { code: "01.511.01.0", n: 40 },
      { code: "04.421.01.0", n: 5 },
    ]);
  });

  it("gives an empty list when nothing has been counted", () => {
    expect(publishable([])).toEqual([]);
  });
});

describe("the owner's live database", () => {
  it("is never queried when ATTENTION isn't set", () => {
    const run = vi.fn(() => "");
    expect(read("2026-08-25", {}, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("is never queried when ATTENTION is set to anything but \"remote\"", () => {
    const run = vi.fn(() => "");
    expect(read("2026-08-25", { ATTENTION: "1" }, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("is read through the runner once ATTENTION is \"remote\"", () => {
    const run = vi.fn(() => JSON.stringify([{ results: [{ code: "01.511.01.0", n: 12, bot: 0 }] }]));
    expect(read("2026-08-25", { ATTENTION: "remote" }, run)).toEqual([{ code: "01.511.01.0", n: 12, bot: 0 }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives an empty list when the query fails", () => {
    const run = vi.fn(() => {
      throw new Error("not logged in");
    });
    expect(read("2026-08-25", { ATTENTION: "remote" }, run)).toEqual([]);
  });
});
