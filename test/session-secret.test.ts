import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("getSessionSecret", () => {
  it("falls back to dev-secret in non-production when SESSION_SECRET is missing", async () => {
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "development";

    const { getSessionSecret } = await import("../server/session-secret.ts");

    expect(getSessionSecret()).toBe("dev-secret");
  });

  it("requires SESSION_SECRET in production", async () => {
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";

    const { getSessionSecret } = await import("../server/session-secret.ts");

    expect(() => getSessionSecret()).toThrowError(
      "SESSION_SECRET must be set in production",
    );
  });
});

