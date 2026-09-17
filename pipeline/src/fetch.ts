import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SOURCES } from "./sources/registry.ts";

const CHECKSUMS = new URL("../checksums.json", import.meta.url);

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Throws when a pinned digest and the digest just computed disagree. Kept
 * separate from fetchAll so the guard can be tested without a network call and
 * without writing over the real checksums.json.
 */
export function assertChecksum(id: string, digest: string, expected: string | undefined): void {
  if (expected && expected !== digest) {
    throw new Error(
      `${id} changed upstream.\n  pinned:   ${expected}\n  fetched:  ${digest}\n` +
        `Review the new file, then update pipeline/checksums.json deliberately.`,
    );
  }
}

export async function fetchAll(cacheDir: string): Promise<Map<string, Uint8Array>> {
  await mkdir(cacheDir, { recursive: true });

  let pinned: Record<string, string> = {};
  if (existsSync(CHECKSUMS)) pinned = JSON.parse(await readFile(CHECKSUMS, "utf8"));

  const out = new Map<string, Uint8Array>();
  for (const source of SOURCES) {
    const path = join(cacheDir, source.filename);
    let bytes: Uint8Array;
    if (existsSync(path)) {
      bytes = new Uint8Array(await readFile(path));
    } else {
      const response = await fetch(source.url, { headers: { "user-agent": "morocco-communes-api/0.1" } });
      if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status} from ${source.url}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(path, bytes);
    }

    const digest = sha256(bytes);
    const expected = pinned[source.id];
    assertChecksum(source.id, digest, expected);
    if (!expected) pinned[source.id] = digest;
    out.set(source.id, bytes);
  }

  await writeFile(CHECKSUMS, `${JSON.stringify(pinned, null, 2)}\n`);
  return out;
}
