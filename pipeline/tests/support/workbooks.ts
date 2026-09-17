import { readFileSync } from "node:fs";

/**
 * Reads a workbook cached under .cache/ by `pnpm dataset:build` (via fetchAll).
 * .cache/ is gitignored, so on a fresh checkout it does not exist yet. Reading it
 * directly with readFileSync surfaces a bare ENOENT that gives no hint what to do,
 * which is enough to make the whole test file die at import. This throws a message
 * that names the missing file and says how to produce it.
 */
export function readCachedWorkbook(path: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`missing cached workbook ${path}. Run \`pnpm dataset:build\` first.`);
    }
    throw err;
  }
}
