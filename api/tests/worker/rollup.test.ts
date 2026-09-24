import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { pruneSql, rollupSql } from "../../../workers/rollup/src/index.ts";

function db() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../../../migrations/0001_demand.sql", import.meta.url), "utf8"));
  return database;
}

const insert = (database: ReturnType<typeof db>, day: string, code: string, times: number) => {
  for (let i = 0; i < times; i += 1) {
    database
      .prepare("INSERT INTO events (day, kind, code, name, locale, country, via, via_site, bot, dataset) VALUES (?, 'place', ?, 'place', 'en', 'MA', 'browser', 'reddit', 0, '1.8.0')")
      .run(day, code);
  }
};

describe("the rollup", () => {
  it("counts a day into one row per group", () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 3);
    insert(database, "2026-09-23", "04.421.01.0", 1);
    database.exec(rollupSql("2026-09-23"));
    const rows = database.prepare("SELECT code, n FROM daily ORDER BY n DESC").all();
    expect(rows).toEqual([
      { code: "01.511.01.0", n: 3 },
      { code: "04.421.01.0", n: 1 },
    ]);
  });

  it("can run twice for the same day without doubling", () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 2);
    database.exec(rollupSql("2026-09-23"));
    database.exec(rollupSql("2026-09-23"));
    expect(database.prepare("SELECT n FROM daily").get()).toEqual({ n: 2 });
  });

  it("deletes what is past 90 days and keeps the rest", () => {
    const database = db();
    insert(database, "2026-06-01", "01.511.01.0", 1);
    insert(database, "2026-09-23", "01.511.01.0", 1);
    database.exec(pruneSql("2026-06-26"));
    const days = database.prepare("SELECT DISTINCT day FROM events").all();
    expect(days).toEqual([{ day: "2026-09-23" }]);
  });
});
