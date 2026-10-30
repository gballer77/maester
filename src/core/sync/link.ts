import type { Dirent } from "node:fs";
import { mkdir, readdir, realpath, rm, stat, symlink } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { MaesterError } from "../errors.js";
import { type ProvenanceMarkerInput, writeProvenanceMarker } from "./provenance.js";
import { assertDestinationSafe, promoteTempToDestination } from "./stage.js";

export type StageLinksInput = {
  /** Root-relative paths, already filtered — one link is created per entry. */
  files: readonly string[];
  /** Absolute directory the links point into (e.g. `.maester/cache/<name>`). */
  targetRoot: string;
  destination: string;
  marker: ProvenanceMarkerInput;
  /**
   * Relative targets survive moving the repository as a whole; they are
   * computed against the FINAL destination path. The temp dir is a sibling at
   * the same depth, so the relative target is identical before and after the
   * rename.
   */
  relativeTargets: boolean;
};

/**
 * Link-mode staging (architecture §6.13 / §6.14): build `<destination>.tmp-XXXX`
 * with one symbolic link per file, write the provenance marker, then promote
 * with the same atomic rename-swap copy mode uses. Never writes to the target.
 */
export async function stageLinks(input: StageLinksInput): Promise<void> {
  await assertDestinationSafe(input.destination, input.marker.sourceName);
  const tempDir = `${input.destination}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  await mkdir(tempDir, { recursive: true });
  try {
    // Relative targets must be computed between REAL paths: the kernel
    // resolves `..` physically, so a symlinked ancestor on either side (e.g.
    // macOS /var -> /private/var) would otherwise yield a dangling link.
    const resolved: StageLinksInput = input.relativeTargets
      ? {
          ...input,
          targetRoot: await realpath(input.targetRoot),
          destination: resolve(
            await realpath(dirname(input.destination)),
            basename(input.destination),
          ),
        }
      : input;
    for (const file of input.files) {
      await createLink(resolved, tempDir, file);
    }
    await writeProvenanceMarker(tempDir, { ...input.marker, mode: "link" });
    await promoteTempToDestination(tempDir, input.destination);
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

async function createLink(input: StageLinksInput, tempDir: string, file: string): Promise<void> {
  const linkPath = resolve(tempDir, file);
  if (!linkPath.startsWith(`${tempDir}${sep}`)) {
    throw new MaesterError(
      "LINK_PATH_UNSAFE",
      `refusing to link '${file}' outside the destination`,
    );
  }
  const absoluteTarget = resolve(input.targetRoot, file);
  const target = input.relativeTargets
    ? relative(dirname(resolve(input.destination, file)), absoluteTarget)
    : absoluteTarget;
  await mkdir(dirname(linkPath), { recursive: true });
  try {
    await symlink(target, linkPath, "file");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      throw new MaesterError(
        "LINK_UNSUPPORTED",
        `cannot create symbolic links in ${dirname(input.destination)} (${code}). This filesystem does not allow symlinks for the current user.`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Destination-relative paths of every symbolic link under `destination` that
 * no longer resolves. Returns an empty list when the destination is absent.
 */
export async function findDanglingLinks(destination: string): Promise<string[]> {
  const dangling: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink() && !(await resolves(full))) {
        dangling.push(relative(destination, full));
      }
    }
  }
  await walk(destination);
  return dangling.sort();
}

async function resolves(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
