import { describe, expect, it } from "vitest";
import { matchSensitive } from "../../../../src/core/publisher/sensitive.js";

describe("matchSensitive", () => {
  it.each([
    [".env", "environment file"],
    ["services/api/.env.production", "environment file"],
    ["certs/server.pem", "key material"],
    ["deploy/id_ed25519", "SSH private key"],
    [".npmrc", "credential store"],
    ["home/.aws/config", "credential directory"],
    ["config/secrets/token.txt", "secrets directory"],
    ["ops/credentials.json", "credentials file"],
    ["infra/terraform.tfstate.backup", "Terraform state"],
  ])("flags %s", (p, reason) => {
    expect(matchSensitive(p)).toBe(reason);
  });

  it.each([
    ".env.example",
    "docs/.env.template",
    "deploy/id_ed25519.pub",
    "README.md",
    "docs/keys.md",
  ])("does not flag %s", (p) => {
    expect(matchSensitive(p)).toBeUndefined();
  });
});
