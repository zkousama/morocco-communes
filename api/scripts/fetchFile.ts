/** Downloads a file for a script run by hand, with its sha256, which the output records so a later run can tell whether the source changed. */
import { createHash } from "node:crypto";

export async function fetchFile(url: string): Promise<{ bytes: Uint8Array; digest: string }> {
  const response = await fetch(url, { headers: { "user-agent": "morocco-communes (github.com/zkousama/morocco-communes)" } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}
