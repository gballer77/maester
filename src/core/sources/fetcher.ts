export type FetchWarning =
  | { kind: "raven"; type: "no-matches"; name: string; includes: readonly string[] }
  | { kind: "maester"; type: "invalid-manifest"; name: string };

export type FetchedTree = {
  kind: "maester" | "raven";
  name: string;
  cacheDir: string;
  commitSha: string;
  filterSet: readonly string[] | "all";
  warnings: FetchWarning[];
};

export type FetchContext = {
  cacheDir: string;
  cacheExists: boolean;
  tokenForUrl: string | undefined;
};

export interface SourceFetcher {
  readonly kind: "maester" | "raven";
  fetch(ctx: FetchContext): Promise<FetchedTree>;
}
