import type { Source } from "../../schemas/citadel.js";
import { type FetchContext, type FetchedTree, fetchGitSource } from "./git-source.js";

export {
  type FetchContext,
  type FetchWarning,
  type FetchedTree,
  discoverManifestFromCache,
} from "./git-source.js";

/**
 * Resolve one source into a materializable tree. Dispatches on source kind;
 * today every source is a git source (`url`). Path sources (`path`) are added
 * by the Local Maesters feature as a second branch here.
 */
export async function fetchSource(entry: Source, ctx: FetchContext): Promise<FetchedTree> {
  return fetchGitSource(entry, ctx);
}
