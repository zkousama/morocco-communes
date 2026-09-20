import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A level's records, from the one file that holds them or from the directory of files
 * that does.
 *
 * The communes of a census are written one file per région. In a single file the 2014
 * commune figures come to 34 MB, past the 25 MB an asset store will serve, and past what
 * anyone wants to download to read one commune. Every other level is small enough to stay
 * in one file, so a reader has to take either shape.
 */
export function readLevel<T>(dir: string, name: string): T[] {
  const file = join(dir, `${name}.json`);
  if (existsSync(file)) {
    const body = JSON.parse(readFileSync(file, "utf8")) as T | T[];
    return Array.isArray(body) ? body : [body];
  }
  const folder = join(dir, name);
  if (!existsSync(folder)) throw new Error(`no ${name}.json and no ${name}/ in ${dir}`);
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(folder, f), "utf8")) as T[]);
}

/** The région a unit belongs to, which is the first group of its code. */
export const regionOfCode = (code: string) => code.split(".")[0]!;
