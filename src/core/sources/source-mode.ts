import { type Source, isPathSource } from "../../schemas/citadel.js";
import { MaesterError } from "../errors.js";
import type { MaterializationMode } from "../sync/provenance.js";
import type { FilterMode } from "./filter-mode.js";

/**
 * The effective materialization for a source, decided once the filter mode is
 * known (architecture §3 Source.mode, Gap 74):
 * - whole-repository → link for both kinds; an explicit `mode: copy` fails,
 *   because an undeclared publish surface never enters version control;
 * - otherwise path sources use `mode ?? "link"` and git sources copy.
 */
export function resolveSourceMode(
  entry: Pick<Source, "name" | "path" | "url" | "mode">,
  filterMode: FilterMode,
): MaterializationMode {
  if (filterMode === "whole-repository") {
    if (entry.mode === "copy") {
      throw new MaesterError(
        "COPY_REQUIRES_DECLARED_PATHS",
        `source '${entry.name}' sets mode: copy but publishes no declared paths, so it would surface the whole directory. Copy mode requires an \`includes\` list on the source or published entries in its maester.yaml.`,
      );
    }
    return "link";
  }
  return isPathSource(entry as Source) ? (entry.mode ?? "link") : "copy";
}
