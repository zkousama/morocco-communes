import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data.ts";
import { detect } from "../src/detect.ts";
import { dropped, SAMPLE_HOUSEHOLDS, SMALL_BASE } from "../src/filter.ts";
import { pipeline, summary, write, type CommuneFile } from "../src/run.ts";
import { termsPattern } from "../src/safety.ts";

const data = loadData();
const run = pipeline(data, null);
const communes = [...run.files].filter(([path]) => path.startsWith("communes/")).map(([, body]) => body as CommuneFile);
const published = communes.flatMap((c) => c.findings.map((f) => ({ ...f, code: c.code })));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pipeline", () => {
  it("runs without a model, the network or INSIGHTS_LIVE", () => {
    delete process.env.INSIGHTS_LIVE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(pipeline(data, null).counts.published).toBe(run.counts.published);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishes every figure detect finds but the ones the filter drops", () => {
    const findings = detect(data);
    const kept = findings.filter((f) => dropped(f, data) === null);
    expect(run.counts.detected).toBe(findings.length);
    expect(published.map((f) => f.id).sort()).toEqual(kept.map((f) => f.id).sort());
    expect(run.counts.published + Object.values(run.counts.dropped).reduce((a, b) => a + b, 0)).toBe(findings.length);
  });

  it("publishes only communes, no artefact, no sex share and no flagged commune", () => {
    for (const f of published) {
      const unit = data.units.get(f.code)!;
      expect(unit.level).toBe("commune");
      expect(f.kind).not.toBe("artefact");
      expect(f.measure.startsWith("sex.")).toBe(false);
      expect(unit.mismatched.size).toBe(0);
    }
  });

  it("publishes no economy or housing figure on a base under 100", () => {
    expect(run.counts.dropped["small base"]).toBeGreaterThan(0);
    for (const f of published) {
      const base = data.units.get(f.code)!.base;
      if (f.measure.startsWith("economy.")) expect(base.businesses ?? 0).toBeGreaterThanOrEqual(SMALL_BASE);
      if (f.measure.startsWith("housing.")) expect(base.dwellings ?? 0).toBeGreaterThanOrEqual(SMALL_BASE);
    }
  });

  it("marks a census figure in a commune of 2,000 households or more as a sample estimate", () => {
    for (const f of published) {
      const households = data.units.get(f.code)!.base.households;
      const census = !f.measure.startsWith("economy.") && !f.measure.startsWith("housing.");
      expect(f.sampled).toBe(census && households !== null && households >= SAMPLE_HOUSEHOLDS);
    }
    expect(published.some((f) => f.sampled)).toBe(true);
    expect(published.some((f) => !f.sampled)).toBe(true);
  });

  it("never names a flagged commune as a neighbour", () => {
    for (const f of published) {
      const furthest = f.context.neighbours?.furthest.code;
      if (furthest) expect(data.units.get(furthest)!.mismatched.size).toBe(0);
    }
  });

  it("gives each figure its line in both languages, and its context as numbers", () => {
    for (const f of published) {
      expect(f.line.en.length).toBeGreaterThan(0);
      expect(f.line.fr.length).toBeGreaterThan(0);
      expect(f.context).toHaveProperty("others");
      expect(f.context).toHaveProperty("neighbours");
      expect(f.context).toHaveProperty("since2014");
    }
    expect(published.some((f) => f.context.neighbours !== null)).toBe(true);
    expect(published.some((f) => f.context.since2014 !== null)).toBe(true);
  });

  it("lists a commune's other figures as the ones in its own file", () => {
    for (const c of communes) {
      const ids = c.findings.map((f) => f.id);
      for (const f of c.findings) expect(f.context.others.map((o) => o.id)).toEqual(ids.filter((id) => id !== f.id));
    }
  });

  it("keeps a commune to 3 figures at most, and indexes every file", () => {
    for (const c of communes) expect(c.findings.length).toBeLessThanOrEqual(3);
    const index = run.files.get("index.json") as { code: string; level: string; findings: number }[];
    expect(index.map((r) => r.code)).toEqual(communes.map((c) => c.code).sort());
    for (const row of index) expect(row.findings).toBe(communes.find((c) => c.code === row.code)!.findings.length);
    expect(run.counts.communes).toBe(communes.length);
  });

  it("gives the same files every time, with nothing in them that changes from run to run", () => {
    expect(JSON.stringify([...pipeline(data, null).files])).toBe(JSON.stringify([...run.files]));
  });
});

describe("the safety policy", () => {
  it("holds back a figure whose line names a private term, and leaves it out of the others", () => {
    const withTerm = pipeline(data, termsPattern(["households"]));
    const held = published.filter((f) => /\bhouseholds\b/i.test(f.line.en));
    expect(held.length).toBeGreaterThan(0);
    expect(held.length).toBeLessThan(published.length);
    expect(withTerm.counts.dropped.safety).toBe(held.length);
    const left = [...withTerm.files].filter(([p]) => p.startsWith("communes/")).flatMap(([, b]) => (b as CommuneFile).findings);
    for (const f of left) {
      expect(f.line.en).not.toMatch(/\bhouseholds\b/i);
      for (const o of f.context.others) expect(held.some((h) => h.id === o.id)).toBe(false);
    }
  });
});

describe("what the run says", () => {
  it("counts what it found, what it dropped and why, and what it published", () => {
    const lines = summary(run.counts);
    expect(lines[0]).toBe(`detected: ${run.counts.detected}`);
    expect(lines).toContain(`dropped, artefact: ${run.counts.dropped.artefact}`);
    expect(lines.at(-1)).toBe(`published: ${run.counts.published} figures, ${run.counts.communes} communes`);
  });
});

describe("writing the files", () => {
  it("replaces what's there, keeping the README", async () => {
    const dir = mkdtempSync(join(tmpdir(), "out-"));
    mkdirSync(join(dir, "provinces"));
    writeFileSync(join(dir, "provinces", "01.511.json"), "{}");
    writeFileSync(join(dir, "README.md"), "kept");
    await write(dir, new Map<string, unknown>([["communes/a.json", { code: "a" }], ["index.json", []]]));
    expect(readdirSync(dir).sort()).toEqual(["README.md", "communes", "index.json"]);
    expect(existsSync(join(dir, "provinces"))).toBe(false);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("kept");
    expect(readFileSync(join(dir, "communes", "a.json"), "utf8")).toBe('{"code":"a"}\n');
  });

  it("creates the folder on a first run", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "new-")), "insights");
    await write(dir, new Map([["index.json", []]]));
    expect(readFileSync(join(dir, "index.json"), "utf8")).toBe("[]\n");
  });
});
