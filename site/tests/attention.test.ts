import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { publishable, ranking, read, type Row } from "../scripts/attention.ts";

describe("what reaches the public page", () => {
  it("keeps places seen 5 times or more, and drops the rest", () => {
    const rows = [
      { code: "01.511.01.0", n: 40 },
      { code: "04.421.01.0", n: 5 },
      { code: "07.351.01.0", n: 4 },
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
    const run = vi.fn(() => JSON.stringify([{ results: [{ code: "01.511.01.0", n: 12 }] }]));
    expect(read("2026-08-25", { ATTENTION: "remote" }, run)).toEqual([{ code: "01.511.01.0", n: 12 }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives an empty list when the query fails", () => {
    const run = vi.fn(() => {
      throw new Error("not logged in");
    });
    expect(read("2026-08-25", { ATTENTION: "remote" }, run)).toEqual([]);
  });
});

describe("the ranking's query", () => {
  const since = "2026-08-25";

  function daily() {
    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(new URL("../../migrations/0001_demand.sql", import.meta.url), "utf8"));
    return database;
  }

  /** A day's count of views of one place, as the rollup writes it. The beacon's rows are named "place". */
  const views = (database: DatabaseSync, code: string, n: number, over: { name?: string; via?: string; bot?: number } = {}) =>
    database
      .prepare("INSERT INTO daily (day, kind, code, name, via, bot, n) VALUES ('2026-09-20', 'place', ?, ?, ?, ?, ?)")
      .run(code, over.name ?? "place", over.via ?? "browser", over.bot ?? 0, n);

  const listed = (database: DatabaseSync) => publishable(database.prepare(ranking(since)).all() as unknown as Row[]);

  it("lists the places opened in a browser 5 times or more", () => {
    const database = daily();
    views(database, "01.511.01.0", 12);
    views(database, "04.421.01.0", 4);
    expect(listed(database)).toEqual([{ code: "01.511.01.0", n: 12 }]);
  });

  it("leaves a crawler off, and doesn't let its rows fill the list first", () => {
    const database = daily();
    for (let i = 0; i < 120; i += 1) views(database, `09.${String(i).padStart(3, "0")}`, 50, { bot: 1 });
    views(database, "01.511.01.0", 6);
    expect(listed(database)).toEqual([{ code: "01.511.01.0", n: 6 }]);
  });

  it("leaves off an API caller whose User-Agent says it's a browser", () => {
    const database = daily();
    views(database, "01.511.01.0", 40, { name: "communes/:id" });
    expect(listed(database)).toEqual([]);
  });
});
