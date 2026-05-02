import { describe, it, expect, afterEach } from "vitest";
import { isDbConfigured } from "../lib/db.ts";

describe("db – isDbConfigured", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original !== undefined) process.env.DATABASE_URL = original;
    else delete process.env.DATABASE_URL;
  });

  it("returns false when DATABASE_URL is not set", () => {
    delete process.env.DATABASE_URL;
    expect(isDbConfigured()).toBe(false);
  });

  it("returns true when DATABASE_URL is set", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    expect(isDbConfigured()).toBe(true);
  });
});
