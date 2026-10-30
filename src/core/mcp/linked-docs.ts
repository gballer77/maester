import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CitadelConfig } from "../../schemas/citadel.js";
import { defaultDestinationFor } from "../config/paths.js";
import { isBinaryFile } from "../sources/excludes.js";
import { readProvenanceMarker } from "../sync/provenance.js";

/**
 * Linked documents over MCP (architecture §6.14, Gap 71). Some agent hosts
 * refuse to follow symlinks that leave the workspace; these two shared tools
 * let them list and read linked citadel files through the server instead.
 * `citadel` is reserved as a connector name so the names cannot collide.
 */
export const LIST_LINKED_DOCUMENTS_TOOL = "citadel__list_linked_documents";
export const READ_LINKED_DOCUMENT_TOOL = "citadel__read_linked_document";

export type LinkedDestination = {
  name: string;
  /** Repo-relative, posix separators. */
  destination: string;
  absolute: string;
};

export type LinkedToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LinkedReadResult = { ok: true; text: string } | { ok: false; message: string };

/** Destinations whose last sync recorded link mode. */
export async function findLinkedDestinations(
  config: CitadelConfig,
  repoRoot: string,
): Promise<LinkedDestination[]> {
  const found: LinkedDestination[] = [];
  for (const source of config.sources) {
    const absolute = source.destination
      ? resolve(repoRoot, source.destination)
      : defaultDestinationFor(repoRoot, source.name, config.baseDir);
    const marker = await readProvenanceMarker(absolute);
    if (marker?.mode !== "link") continue;
    found.push({ name: source.name, destination: toPosix(relative(repoRoot, absolute)), absolute });
  }
  return found;
}

export function linkedDocumentToolDescriptors(): LinkedToolDescriptor[] {
  return [
    {
      name: LIST_LINKED_DOCUMENTS_TOOL,
      description:
        "List the files of linked citadel sources (symlinked to local directories or maester's fetch cache). Returns repo-relative citadel paths grouped by source. Pass `source` to list one source.",
      inputSchema: {
        type: "object",
        properties: { source: { type: "string", description: "Source name to list" } },
        additionalProperties: false,
      },
    },
    {
      name: READ_LINKED_DOCUMENT_TOOL,
      description:
        "Read the current text of a linked citadel file by its repo-relative citadel path (as returned by citadel__list_linked_documents).",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Repo-relative citadel path, e.g. citadel/notes/README.md",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ];
}

/**
 * Walk each linked destination's symlinks — what an agent can actually open —
 * rather than re-resolving the source.
 */
export async function listLinkedDocuments(
  destinations: readonly LinkedDestination[],
  repoRoot: string,
  source?: string,
): Promise<{ sources: { name: string; destination: string; files: string[] }[] }> {
  const selected = source ? destinations.filter((d) => d.name === source) : destinations;
  const sources = [];
  for (const dest of selected) {
    const files = (await walkLinks(dest.absolute)).map((abs) => toPosix(relative(repoRoot, abs)));
    sources.push({ name: dest.name, destination: dest.destination, files: files.sort() });
  }
  return { sources };
}

/**
 * Read a linked document. Refuses anything that normalizes outside the repo,
 * is not a symlink inside a link-mode destination, dangles, or is binary.
 */
export async function readLinkedDocument(
  destinations: readonly LinkedDestination[],
  repoRoot: string,
  path: string,
): Promise<LinkedReadResult> {
  const absolute = resolve(repoRoot, path);
  if (!isWithin(absolute, repoRoot)) {
    return { ok: false, message: `'${path}' is outside the citadel repository` };
  }
  if (!destinations.some((d) => isWithin(absolute, d.absolute) && absolute !== d.absolute)) {
    return { ok: false, message: `'${path}' is not inside a linked citadel source` };
  }
  try {
    if (!(await lstat(absolute)).isSymbolicLink()) {
      return { ok: false, message: `'${path}' is not a linked document` };
    }
  } catch {
    return { ok: false, message: `'${path}' does not exist` };
  }
  try {
    await stat(absolute);
  } catch {
    return {
      ok: false,
      message: `'${path}' no longer resolves — the source moved or the cache was cleared. Run \`maester status\`.`,
    };
  }
  if (await isBinaryFile(absolute)) {
    return { ok: false, message: `'${path}' is a binary file` };
  }
  return { ok: true, text: await readFile(absolute, "utf8") };
}

async function walkLinks(root: string): Promise<string[]> {
  const links: string[] = [];
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
      else if (entry.isSymbolicLink()) links.push(full);
    }
  }
  await walk(root);
  return links;
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
