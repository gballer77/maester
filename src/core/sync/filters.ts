import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { MaesterConfigSchema } from "../../schemas/maester.js";

export type ManifestDiscovery =
  | { mode: "manifest"; patterns: string[] }
  | { mode: "no-manifest"; reason: "absent" | "invalid" };

export async function discoverManifestFromCache(cacheDir: string): Promise<ManifestDiscovery> {
  const path = resolve(cacheDir, "maester.yaml");
  if (!existsSync(path)) return { mode: "no-manifest", reason: "absent" };
  try {
    const raw = await readFile(path, "utf8");
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) return { mode: "no-manifest", reason: "invalid" };
    const parsed = MaesterConfigSchema.safeParse(doc.toJS({ maxAliasCount: -1 }));
    if (!parsed.success) return { mode: "no-manifest", reason: "invalid" };
    const patterns = parsed.data.documents.map((d) => d.path);
    if (patterns.length === 0) return { mode: "no-manifest", reason: "invalid" };
    if (!patterns.includes("maester.yaml")) patterns.unshift("maester.yaml");
    return { mode: "manifest", patterns };
  } catch {
    return { mode: "no-manifest", reason: "invalid" };
  }
}
