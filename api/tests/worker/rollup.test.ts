import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as worker from "../../../workers/rollup/src/index.ts";
import rollup from "../../../workers/rollup/src/index.ts";
import { PRUNE, ROLLUP } from "../../../workers/rollup/src/sql.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

/** The live database's tables, every migration applied in order. */
function db() {
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  return database;
}

/**
 * D1 as the Worker meets it, over SQLite. exec() throws, because D1 splits its input on
 * newlines and a statement written across lines doesn't survive that, while node:sqlite
 * would have run it. prepare, bind, run, all and batch go to SQLite, and a batch is one
 * transaction, as it is in D1.
 */
function d1(database: DatabaseSync) {
  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => statement(sql, bound),
    run: async () => {
      database.prepare(sql).run(...values);
      return { success: true };
    },
    all: async () => ({ results: database.prepare(sql).all(...values), success: true }),
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
  row: { day: string; kind: string; text?: string; code?: string; name?: string; results?: number; named?: 0 | 1 },
  times = 1,
) => {
  for (let i = 0; i < times; i += 1) {
    database
      .prepare("INSERT INTO events (day, kind, text, code, name, results, named) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.day, row.kind, row.text ?? "", row.code ?? "", row.name ?? "", row.results ?? -1, row.named ?? 0);
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

describe("a search's text in the rollup", () => {
  const texts = (database: DatabaseSync) => database.prepare("SELECT kind, text, n FROM daily ORDER BY n DESC, text").all();

  it("goes when the search names no place and was typed fewer than 3 times, hits or not, and stays in the raw rows", () => {
    const database = db();
    event(database, { day: "2026-09-23", kind: "search", name: "search", text: "ousama ajebbar", results: 10, named: 0 });
    event(database, { day: "2026-09-23", kind: "search", name: "search", text: "someone", results: 0, named: 0 }, 2);
    database.prepare(ROLLUP).run("2026-09-23");
    expect(texts(database)).toEqual([{ kind: "search", text: "", n: 3 }]);
    expect(database.prepare("SELECT DISTINCT text FROM events ORDER BY text").all()).toEqual([
      { text: "ousama ajebbar" },
      { text: "someone" },
    ]);
  });

  it("stays when the search was typed 3 times, a place or not", () => {
    const database = db();
    event(database, { day: "2026-09-23", kind: "search", name: "search", text: "xyzzy", results: 0 }, 3);
    database.prepare(ROLLUP).run("2026-09-23");
    expect(texts(database)).toEqual([{ kind: "search", text: "xyzzy", n: 3 }]);
  });

  it("stays when the search names a place, even once", () => {
    const database = db();
    event(database, { day: "2026-09-23", kind: "search", name: "search", text: "tanger", results: 4, named: 1 });
    database.prepare(ROLLUP).run("2026-09-23");
    expect(texts(database)).toEqual([{ kind: "search", text: "tanger", n: 1 }]);
  });

  it("holds an assistant's query to the same rule", () => {
    const database = db();
    event(database, { day: "2026-09-23", kind: "tool", name: "search", text: "tiznit", named: 1 });
    event(database, { day: "2026-09-23", kind: "tool", name: "search", text: "someone" });
    database.prepare(ROLLUP).run("2026-09-23");
    expect(texts(database)).toEqual([
      { kind: "tool", text: "", n: 1 },
      { kind: "tool", text: "tiznit", n: 1 },
    ]);
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

describe("the nightly check of suggested spellings", () => {
  it("can fail without stopping the rollup or the 90-day deletion", async () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 2);
    insert(database, "2026-06-01", "01.511.01.0", 1);
    // The check reads this table first; without it, its query throws.
    database.exec("DROP TABLE douar_names");
    await night(database);
    expect(database.prepare("SELECT n FROM daily WHERE day = '2026-09-23'").get()).toEqual({ n: 2 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM events WHERE day = '2026-06-01'").get()).toEqual({ n: 0 });
  });
});

describe("the ranking the public page reads", () => {
  const ranking = (database: DatabaseSync) => database.prepare("SELECT code, n, since FROM ranking ORDER BY n DESC, code").all();

  /** A day's views of a place as the rollup has already counted them. */
  const counted = (database: DatabaseSync, day: string, code: string, n: number, over: { name?: string; via?: string; bot?: number } = {}) =>
    database
      .prepare("INSERT INTO daily (day, kind, code, name, via, bot, n) VALUES (?, 'place', ?, ?, ?, ?, ?)")
      .run(day, code, over.name ?? "place", over.via ?? "browser", over.bot ?? 0, n);

  it("is written each night from the last 30 days, with places opened 5 times or more", async () => {
    const database = db();
    insert(database, "2026-09-23", "01.511.01.0", 6);
    counted(database, "2026-08-25", "04.421.01.0", 5);
    counted(database, "2026-08-24", "07.351.01.0", 50);
    insert(database, "2026-09-23", "09.271.01.0", 4);
    await night(database);
    expect(ranking(database)).toEqual([
      { code: "01.511.01.0", n: 6, since: "2026-08-25" },
      { code: "04.421.01.0", n: 5, since: "2026-08-25" },
    ]);
  });

  it("replaces the night before's, so a place that dropped below 5 goes", async () => {
    const database = db();
    database.prepare("INSERT INTO ranking (code, n, since) VALUES ('09.271.01.0', 40, '2026-08-01')").run();
    insert(database, "2026-09-23", "01.511.01.0", 6);
    await night(database);
    await night(database);
    expect(ranking(database)).toEqual([{ code: "01.511.01.0", n: 6, since: "2026-08-25" }]);
  });

  it("counts only people's page views, not crawlers or API lookups", async () => {
    const database = db();
    counted(database, "2026-09-20", "01.511.01.0", 9, { bot: 1 });
    counted(database, "2026-09-20", "01.511.01.0", 9, { name: "communes/:id", via: "curl" });
    counted(database, "2026-09-20", "04.421.01.0", 5);
    await night(database);
    expect(ranking(database)).toEqual([{ code: "04.421.01.0", n: 5, since: "2026-08-25" }]);
  });

  it("is filled when the table is made, so the page isn't empty until the first night", () => {
    const database = new DatabaseSync(":memory:");
    const files = readdirSync(MIGRATIONS).sort();
    database.exec(readFileSync(new URL(files[0]!, MIGRATIONS), "utf8"));
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    counted(database, recent, "01.511.01.0", 7);
    for (const file of files.slice(1)) database.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    expect(database.prepare("SELECT code, n FROM ranking").all()).toEqual([{ code: "01.511.01.0", n: 7 }]);
  });
});

describe("switching it on", () => {
  const scripts = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  }).scripts;

  // pnpm deploy is pnpm's own command for workspaces, so the site's deploy goes through run.
  it("migrates the live database, builds the ranking from it, then deploys the site and the rollup", () => {
    expect(scripts["deploy:live"]?.split(" && ")).toEqual([
      "wrangler d1 migrations apply communes_demand --remote",
      "ATTENTION=remote SITE_URL=https://communes.pages.dev pnpm build",
      "pnpm run deploy",
      "pnpm rollup:deploy",
    ]);
  });

  it("gives the rollup Worker no public address, since only its schedule runs it", () => {
    const config = readFileSync(new URL("../../../workers/rollup/wrangler.toml", import.meta.url), "utf8");
    expect(config).toMatch(/^workers_dev = false$/m);
  });
});
