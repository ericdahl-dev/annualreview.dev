import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("Coolify/Nixpacks deploy config", () => {
  const nixpacks = readFileSync("nixpacks.toml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("pins Node 22.22+ via nixpkgsArchive", () => {
    expect(nixpacks).toMatch(/nixpkgsArchive\s*=\s*["']f3dfef5/);
  });

  it("disables Caddy SPA layer (Node server serves dist + API)", () => {
    expect(nixpacks).toMatch(/NIXPACKS_SPA_CADDY\s*=\s*["']false["']/);
  });

  it("installs devDependencies during the Nixpacks build", () => {
    expect(nixpacks).toMatch(/production\s*=\s*false/);
    expect(nixpacks).toMatch(/NPM_CONFIG_PRODUCTION\s*=\s*["']false["']/);
  });

  it("keeps tsx as a runtime dependency for server.ts", () => {
    expect(pkg.dependencies?.tsx).toBeDefined();
    expect(pkg.devDependencies?.tsx).toBeUndefined();
  });
});
