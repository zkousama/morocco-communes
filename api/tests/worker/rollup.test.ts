import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as worker from "../../../workers/rollup/src/index.ts";
import rollup from "../../../workers/rollup/src/index.ts";
import { PRUNE, ROLLUP } from "../../../workers/rollup/src/sql.ts";

function db() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../../../migrations/0001_demand.sql", import.meta.url), "utf8"));
  return database;
}

/**
 * D1 as the Worker meets it, over SQLite. exec() throws, because D1 splits its input on
 * newlines and a statement written across lines doesn't survive that, while node:sqlite
 * would have run it. prepare, bind, run and batch go to SQLite, and a batch is one
 * transaction, as it is in D1.
 */
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => statement(sql, bound),
    run: async () => {
      database.prepare(sql).run(...values);
      return { success: true };
    },
  });
  return {
    exec: async () => {
      throw new Error("D1's exec() runs one statement per line");
    },
    prepare: (sql: string) => statement(sql),
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const each of statements) results.push(await each.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** The cron's own run, at 03:17 on 24 September. */
const night = (database: DatabaseSync) =>
  rollup.scheduled(
    { scheduledTime: Date.parse("2026-09-24T03:17:00Z"), cron: "17 3 * * *", noRetry: () => {} } as never,
    { DEMAND: d1(database) } as never,
    {} as never,
  );

const insert = (database: DatabaseSync, day: string, code: string, times: number) => {
  for (let i = 0; i < times; i += 1) {
    database
      .prepare("INSERT INTO events (day, kind, code, name, locale, country, via, via_site, bot, dataset) VALUES (?, 'place', ?, 'place', 'en', 'MA', 'browser', 'reddit', 0, '1.8.0')")
      .run(day, code);
  }
};

/** Any kind of row, with the columns the rollup reads and the rest left to their defaults. */
const event = (
  database: DatabaseSync,
  row: { day: string; kind: string; text?: string; code?: string; name?: string; results?: number },
  times = 1,
) => {
  for (let i = 0; i < times; i += 1) {
    database
      .prepare("INSERT INTO events (day, kind, text, code, name, results) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.day, row.kind, row.text ?? "", row.code ?? "", row.name ?? "", row.results ?? -1);
  }
};

describe("the rollup", () => {
  it("counts a day into one row per group", () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 3);
    insert(database, "2026-09-23", "04.421.01.0", 1);
    database.prepare(ROLLUP).run("2026-09-23");
    const rows = database.prepare("SELECT code, n FROM daily ORDER BY n DESC").all();
    expect(rows).toEqual([
      { code: "01.511.01.0", n: 3 },
      { code: "04.421.01.0", n: 1 },
    ]);
  });

  it("can run twice for the same day without doubling", () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 2);
    database.prepare(ROLLUP).run("2026-09-23");
    database.prepare(ROLLUP).run("2026-09-23");
    expect(database.prepare("SELECT n FROM daily").get()).toEqual({ n: 2 });
  });

  it("keeps which tool was called, so it's still known once the raw rows have gone", () => {
    const database = db();
    event(database, { day: "2026-09-23", kind: "tool", name: "get_commune" }, 2);
    event(database, { day: "2026-09-23", kind: "tool", name: "get_indicators" });
    database.prepare(ROLLUP).run("2026-09-23");
    expect(database.prepare("SELECT kind, name, n FROM daily ORDER BY n DESC").all()).toEqual([
      { kind: "tool", name: "get_commune", n: 2 },
      { kind: "tool", name: "get_indicators", n: 1 },
    ]);
  });

  it("deletes what is past 90 days and keeps the rest, including the cut-off day itself", () => {
    const database = db();
    insert(database, "2026-06-01", "01.511.01.0", 1);
    insert(database, "2026-06-26", "01.511.01.0", 1);
    insert(database, "2026-09-23", "01.511.01.0", 1);
    database.prepare(PRUNE).run("2026-06-26");
    const days = database.prepare("SELECT DISTINCT day FROM events ORDER BY day").all();
    expect(days).toEqual([{ day: "2026-06-26" }, { day: "2026-09-23" }]);
  });
});

describe("the nightly run", () => {
  it("exports nothing but its handler, since the Workers runtime won't start on a string export", () => {
    expect(Object.keys(worker)).toEqual(["default"]);
  });

  it("rolls up yesterday through prepared statements, never exec()", async () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 2);
    await night(database);
    expect(database.prepare("SELECT day, code, n FROM daily").all()).toEqual([
      { day: "2026-09-23", code: "01.511.01.0", n: 2 },
    ]);
  });

  it("catches up a day a missed night left, up to a week back", async () => {
    const database = db();
    insert(database, "2026-09-21", "01.511.01.0", 1);
    insert(database, "2026-09-17", "04.421.01.0", 1);
    insert(database, "2026-09-16", "04.421.01.0", 1);
    insert(database, "2026-09-24", "04.421.01.0", 1);
    await night(database);
    expect(database.prepare("SELECT day FROM daily ORDER BY day").all()).toEqual([
      { day: "2026-09-17" },
      { day: "2026-09-21" },
    ]);
  });

  it("deletes past 90 days in the same run", async () => {
    const database = db();
    insert(database, "2026-06-25", "01.511.01.0", 1);
    insert(database, "2026-06-26", "01.511.01.0", 1);
    await night(database);
    expect(database.prepare("SELECT DISTINCT day FROM events ORDER BY day").all()).toEqual([{ day: "2026-06-26" }]);
  });
});
