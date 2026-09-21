import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * The Python package's own tests, run through the suite so one command checks everything.
 * They need Python and pandas, which this repository otherwise doesn't, so they're skipped
 * where those aren't installed rather than failing the build.
 */
const HERE = "packages/morocco-communes-py";

const available = (() => {
  try {
    execFileSync("python3", ["-c", "import pandas"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!available)("the Python package", () => {
  // Asynchronous, so the worker keeps answering the runner while Python works.
  it("builds its data from data/v1 and passes its tests", async () => {
    const run = promisify(execFile);
    await run("python3", [`${HERE}/build_data.py`]);
    const { stdout } = await run("python3", ["-m", "unittest", "discover", "-s", `${HERE}/tests`], { encoding: "utf8" });
    // unittest writes its summary to stderr, so a silent stdout is what success looks like.
    expect(stdout).toBe("");
  }, 120_000);
});
