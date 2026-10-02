import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../../src/worker/index.ts";
import { cleanSpelling, PER_DAY, visitorOf } from "../../src/worker/suggest.ts";
import { PRUNE_SUGGESTIONS } from "../../../workers/rollup/src/sql.ts";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  return db;
}

/** D1's calls over SQLite: prepare, bind, then first, run or all. */
function d1(db: DatabaseSync) {
  const statement = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => statement(sql, bound),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => (db.prepare(sql).run(...values), { success: true }),
    all: async () => ({ results: db.prepare(sql).all(...values), success: true }),
  });
  return { prepare: (sql: string) => statement(sql) };
}

// Imi-Mqourn's douar file, as the asset binding serves it: one douar without a Latin name, one with.
const DOUARS = {
  data: {
    fractions: [],
    douars: [
      { code: "1630717201002", name: { ar: "أيت موس" } },
      { code: "1630717201001", name: { ar: "توريرت نترست" }, latin: { name: "Taourirt n'Tirst", source: "geonames" } },
    ],
  },
};
const assets = {
  fetch: async (request: Request) =>
    new URL(request.url).pathname === "/api/communes/09.163.07.17/douars.json" ? Response.json(DOUARS) : new Response(null, { status: 404 }),
};
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {}, props: {} };
const env = (db: DatabaseSync) => ({ ASSETS: assets, DEMAND: d1(db), SUGGEST_KEY: "secret" });

const post = (db: DatabaseSync, body: unknown, ip = "203.0.113.7", extra: Record<string, string> = {}) =>
  app.fetch(
    new Request("https://communes.pages.dev/api/douar-suggestions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://communes.pages.dev", "cf-connecting-ip": ip, ...extra },
      body: JSON.stringify(body),
    }),
    env(db) as never,
    ctx as never,
  );

describe("a suggested spelling", () => {
  it("is tidied the way names are written, and refused when it isn't Latin letters", () => {
    expect(cleanSpelling("  ait   MOUSS ")).toBe("Ait Mouss");
    expect(cleanSpelling("Aït N’Tirst")).toBe("Aït N'tirst");
    expect(cleanSpelling("ait 2")).toBeNull();
    expect(cleanSpelling("http://x.ma")).toBeNull();
    expect(cleanSpelling("أيت موس")).toBeNull();
    expect(cleanSpelling("a")).toBeNull();
    expect(cleanSpelling("a".repeat(61))).toBeNull();
  });

  it("is counted from one visitor and goes live from a second", async () => {
    const db = database();
    const first = await post(db, { douar: "1630717201002", name: "Ait Mouss" }, "203.0.113.7");
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "counted", votes: 1 });
    const again = await post(db, { douar: "1630717201002", name: "ait mouss" }, "203.0.113.7");
    expect(await again.json()).toEqual({ status: "counted", votes: 1 });
    const second = await post(db, { douar: "1630717201002", name: "AIT MOUSS" }, "198.51.100.4");
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ status: "accepted", name: "Ait Mouss" });
    const later = await post(db, { douar: "1630717201002", name: "Ait Mousse" }, "192.0.2.9");
    expect(later.status).toBe(409);
  });

  it("keeps no address: the visitor is a keyed hash that changes with the day", async () => {
    const db = database();
    await post(db, { douar: "1630717201002", name: "Ait Mouss" }, "203.0.113.7");
    const [row] = db.prepare("SELECT * FROM douar_suggestions").all() as { visitor: string }[];
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(await visitorOf("secret", "2026-10-02", "203.0.113.7")).not.toBe(await visitorOf("secret", "2026-10-03", "203.0.113.7"));
  });

  it("is refused for a douar a source names, a code that isn't a douar, and a word that isn't its name", async () => {
    const db = database();
    expect((await post(db, { douar: "1630717201001", name: "Taourirt" })).status).toBe(409);
    expect((await post(db, { douar: "1630717209999", name: "Ait Mouss" })).status).toBe(404);
    expect((await post(db, { douar: "1630717201002", name: "Casablanca" })).status).toBe(422);
    expect((await post(db, { douar: "16307", name: "Ait Mouss" })).status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM douar_suggestions").get()).toEqual({ n: 0 });
  });

  it("is refused from another site, and past a visitor's daily limit", async () => {
    const db = database();
    expect((await post(db, { douar: "1630717201002", name: "Ait Mouss" }, "203.0.113.7", { origin: "https://elsewhere.example" })).status).toBe(400);
    const day = new Date().toISOString().slice(0, 10);
    const visitor = await visitorOf("secret", day, "203.0.113.7");
    for (let i = 0; i < PER_DAY; i++) {
      db.prepare("INSERT INTO douar_suggestions (douar, name, spelling, visitor, day) VALUES (?, ?, ?, ?, ?)").run(`x${i}`, "n", `s${i}`, visitor, day);
    }
    expect((await post(db, { douar: "1630717201002", name: "Ait Mouss" }, "203.0.113.7")).status).toBe(429);
  });

  it("is refused without the secret, rather than kept under no key", async () => {
    const db = database();
    const response = await app.fetch(
      new Request("https://communes.pages.dev/api/douar-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://communes.pages.dev" },
        body: JSON.stringify({ douar: "1630717201002", name: "Ait Mouss" }),
      }),
      { ...env(db), SUGGEST_KEY: undefined } as never,
      ctx as never,
    );
    expect(response.status).toBe(503);
  });

  it("is deleted after 90 days by the nightly job, and its accepted name kept", async () => {
    const db = database();
    db.prepare("INSERT INTO douar_suggestions (douar, name, spelling, visitor, day) VALUES (?, ?, ?, ?, ?)").run("1", "A", "a", "v", "2026-06-01");
    db.prepare("INSERT INTO douar_names (douar, name, since) VALUES (?, ?, ?)").run("1", "A", "2026-06-01");
    db.prepare(PRUNE_SUGGESTIONS).run("2026-07-01");
    expect(db.prepare("SELECT COUNT(*) AS n FROM douar_suggestions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM douar_names").get()).toEqual({ n: 1 });
  });
});

describe("a commune's accepted names, live", () => {
  it("gives each douar's accepted name, by commune code or slug", async () => {
    const db = database();
    db.prepare("INSERT INTO douar_names (douar, name, since) VALUES (?, ?, ?)").run("1630717201002", "Ait Mouss", "2026-10-02");
    db.prepare("INSERT INTO douar_names (douar, name, since) VALUES (?, ?, ?)").run("1630723201001", "Elsewhere", "2026-10-02");
    const response = await app.fetch(new Request("https://communes.pages.dev/api/communes/imi-mqourn/douar-names"), env(db) as never, ctx as never);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown }).data).toEqual({ names: { "1630717201002": "Ait Mouss" } });
  });
});
