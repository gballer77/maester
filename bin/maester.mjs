#!/usr/bin/env node
import("../dist/cli/main.js")
  .then((mod) => mod.run())
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
