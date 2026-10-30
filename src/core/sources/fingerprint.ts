import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Fingerprint of a resolved file set (architecture Gap 54), as
 * `sha256:<hex>`. With `content`, each file contributes its path and the
 * SHA-256 of its bytes (copy mode). Without it, only the sorted path list
 * counts: link-mode content edits are already live through the links.
 */
export async function fingerprintTree(
  root: string,
  files: readonly string[],
  options: { content: boolean },
): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update("\0");
    if (options.content) {
      const bytes = await readFile(resolve(root, file));
      hash.update(createHash("sha256").update(bytes).digest("hex"));
    }
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}
