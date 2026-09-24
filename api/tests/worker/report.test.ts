import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { sections } from "../../../scripts/demand.ts";

function db() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../../../migrations/0001_demand.sql", import.meta.url), "utf8"));
  return database;
}

/** The rows `pnpm demand` would print under a title, for the month before 24 September. */
const section = (database: DatabaseSync, title: string) => {
  const sql = sections("2026-08-25", 30).find(([t]) => t === title)?.[1];
  if (!sql) throw new Error(`no section called ${title}`);
  return database.prepare(sql).all().map((row) => ({ ...row }));
};

describe("pnpm demand", () => {
  it("says where people came from by the rows that arrive from a site, never a tool or a client", () => {
    const database = db();
    const add = database.prepare("INSERT INTO daily (day, kind, code, name, via_site, bot, n) VALUES ('2026-09-20', ?, '', '', ?, ?, ?)");
    add.run("place", "reddit", 0, 3);
    add.run("search", "search", 0, 2);
    add.run("download", "direct", 0, 1);
    add.run("tool", "direct", 0, 50);
    add.run("client", "direct", 0, 7);
    add.run("place", "reddit", 1, 100);
    expect(section(database, "Where people came from")).toEqual([
      { via_site: "reddit", n: 3 },
      { via_site: "search", n: 2 },
      { via_site: "direct", n: 1 },
    ]);
  });

  it("leaves crawlers out of the searches that found nothing", () => {
    const database = db();
    const add = database.prepare("INSERT INTO events (day, kind, text, results, bot) VALUES ('2026-09-20', 'search', ?, 0, ?)");
    add.run("ecoles tanger", 0);
    add.run("wp-login", 1);
    expect(section(database, "Searches that found nothing")).toEqual([{ text: "ecoles tanger", n: 1 }]);
  });
});
