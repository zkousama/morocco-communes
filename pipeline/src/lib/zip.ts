import { unzipSync } from "fflate";

/** One file out of a zip archive, or an error naming what the archive holds instead. */
export function readZipEntry(bytes: Uint8Array, name: string): Uint8Array {
  const files = unzipSync(bytes, { filter: (file) => file.name === name });
  const entry = files[name];
  if (!entry) throw new Error(`the archive has no ${name}`);
  return entry;
}
