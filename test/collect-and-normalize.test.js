import { describe, it, expect, vi } from "vitest";
import { collectAndNormalize } from "../lib/collect-and-normalize.ts";

describe("collectAndNormalize (deprecated alias)", () => {
  it("delegates to evidence intake and throws on invalid evidence", async () => {
    vi.mock("../scripts/collect-github.ts", () => ({
      collectRawGraphQL: vi.fn().mockResolvedValue({}),
    }));
    vi.mock("../scripts/normalize.ts", () => ({
      normalize: vi.fn().mockReturnValue({ not_evidence: true }),
    }));

    await expect(
      collectAndNormalize({ token: "tok", start_date: "2025-01-01", end_date: "2025-12-31" })
    ).rejects.toThrow(/invalid evidence/i);
  });
});
