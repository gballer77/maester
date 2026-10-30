import { type Source, isGitSource, isPathSource } from "../../schemas/citadel.js";
import { MaesterError } from "../errors.js";
import { type FetchContext, type FetchedTree, fetchGitSource } from "./git-source.js";
import { type LocalFetchContext, type LocalTree, fetchLocalSource } from "./local-source.js";

export {
  type FetchContext,
  type FetchWarning,
  type FetchedTree,
  discoverManifestFromCache,
} from "./git-source.js";
export type { LocalFetchContext, LocalTree } from "./local-source.js";

/** A source resolved into a materializable tree, discriminated on `kind`. */
export type ResolvedTree = FetchedTree | LocalTree;

export type SourceFetchContext = FetchContext & { local: LocalFetchContext };

/**
 * Resolve one source into a materializable tree. Dispatches on source kind:
 * `url` → git (cache + sparse checkout), `path` → the local directory.
 */
export async function fetchSource(entry: Source, ctx: SourceFetchContext): Promise<ResolvedTree> {
  if (isGitSource(entry)) return fetchGitSource(entry, ctx);
  if (isPathSource(entry)) return fetchLocalSource(entry, ctx.local);
  throw new MaesterError(
    "SOURCE_KIND_UNKNOWN",
    `source '${entry.name}' needs a url (git repository) or a path (local directory)`,
  );
}
