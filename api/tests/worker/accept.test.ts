import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { acceptSuggestions, apartFromEngine, BAR, choose, type Candidate } from "../../src/worker/accept.ts";
import { cleanSpelling, spellingOf } from "../../src/worker/suggest.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  return db;
}

/** D1's calls over SQLite: prepare, bind, then first, run, all, or a batch of them. */
function d1(db: DatabaseSync) {
  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => statement(sql, bound),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => (db.prepare(sql).run(...values), { success: true }),
    all: async () => ({ results: db.prepare(sql).all(...values), success: true }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run())),
  };
}

const ARABIC = "أيت موس";
// Close to how the engine spells it, and the same consonants written wildly.
const CLOSE = "Ait Mouss";
const WILD = "Aaiiyt Moooousssa";

// As the site's route keeps it: the spelling tidied, the way names are written.
const suggest = (db: DatabaseSync, typed: string, visitor: string, day = "2026-10-02", douar = "1630717201002") => {
  const name = cleanSpelling(typed)!;
  db.prepare("INSERT INTO douar_suggestions (douar, name, spelling, arabic, visitor, day) VALUES (?, ?, ?, ?, ?, ?)").run(douar, name, spellingOf(name), ARABIC, visitor, day);
};

describe("the nightly check of suggested spellings", () => {
  it("measures a spelling against the engine's, and the examples sit either side of the bar", () => {
    expect(apartFromEngine(ARABIC, CLOSE)).toBeLessThanOrEqual(BAR);
    expect(apartFromEngine(ARABIC, WILD)).toBeGreaterThan(BAR);
  });

  it("puts live a spelling 2 visitors suggested that reads close to the engine's", async () => {
    const db = database();
    suggest(db, "AIT MOUSS", "a", "2026-10-02");
    suggest(db, "Ait mouss", "b", "2026-10-01");
    expect(await acceptSuggestions(d1(db) as never, "2026-10-03")).toBe(1);
    expect(db.prepare("SELECT douar, name, since FROM douar_names").all()).toEqual([{ douar: "1630717201002", name: "Ait Mouss", since: "2026-10-03" }]);
  });

  it("leaves waiting a spelling only one visitor suggested, or one far from the engine's however many did", async () => {
    const db = database();
    suggest(db, CLOSE, "a");
    for (const visitor of ["a", "b", "c", "d"]) suggest(db, WILD, visitor);
    expect(await acceptSuggestions(d1(db) as never, "2026-10-03")).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM douar_names").get()).toEqual({ n: 0 });
  });

  it("picks the spelling most visitors suggested where 2 pass, then the closer", () => {
    const candidate = (name: string, votes: number): Candidate => ({ douar: "d", arabic: ARABIC, name, votes });
    expect(choose([candidate("Ait Mous", 2), candidate(CLOSE, 3)]).get("d")?.name).toBe(CLOSE);
    const tie = choose([candidate("Ait Mouss", 2), candidate("Ayt Mous", 2)]).get("d")!;
    expect(apartFromEngine(ARABIC, tie.name)).toBe(Math.min(apartFromEngine(ARABIC, "Ait Mouss"), apartFromEngine(ARABIC, "Ayt Mous")));
  });

  it("leaves alone a douar that has its name", async () => {
    const db = database();
    db.prepare("INSERT INTO douar_names (douar, name, since) VALUES (?, ?, ?)").run("1630717201002", "Ait Mous", "2026-10-01");
    suggest(db, CLOSE, "a");
    suggest(db, CLOSE, "b");
    expect(await acceptSuggestions(d1(db) as never, "2026-10-03")).toBe(0);
    expect(db.prepare("SELECT name FROM douar_names").all()).toEqual([{ name: "Ait Mous" }]);
  });
});
