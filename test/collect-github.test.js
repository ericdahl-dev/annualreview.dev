import { describe, it, expect, vi } from "vitest";
import { collectRawGraphQL, parseArgs } from "../scripts/collect-github.ts";
import { normalize } from "../scripts/normalize.ts";

describe("parseArgs", () => {
  it("parses --start, --end, --output, --no-reviews", () => {
    const orig = process.argv.slice(2);
    process.argv = ["node", "collect-github.js", "--start", "2025-01-01", "--end", "2025-12-31", "--output", "out.json", "--no-reviews"];
    const out = parseArgs();
    expect(out.start).toBe("2025-01-01");
    expect(out.end).toBe("2025-12-31");
    expect(out.output).toBe("out.json");
    expect(out.noReviews).toBe(true);
    process.argv = ["node", "collect-github.js", ...orig];
  });
});

describe("collectRawGraphQL", () => {
  it("returns timeframe, pull_requests, reviews in REST-like shape with mocked GraphQL", async () => {
    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      const body = JSON.parse(opts?.body ?? "{}");
      const query = body.query ?? "";
      if (query.includes("viewer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { viewer: { login: "testuser" } } }),
          text: () => Promise.resolve(""),
        });
      }
      if (query.includes("search")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                search: {
                  edges: [
                    {
                      node: {
                        __typename: "PullRequest",
                        number: 42,
                        title: "Fix bug",
                        body: "Description",
                        url: "https://github.com/org/repo/pull/42",
                        mergedAt: "2025-06-01T12:00:00Z",
                        additions: 10,
                        deletions: 2,
                        changedFiles: 3,
                        baseRepository: { nameWithOwner: "org/repo" },
                        labels: { nodes: [{ name: "bug" }] },
                        reviewThreads: { totalCount: 1 },
                        reviews: {
                          nodes: [
                            {
                              id: "PRR_abc",
                              body: "LGTM",
                              state: "APPROVED",
                              submittedAt: "2025-06-01T14:00:00Z",
                              url: "https://github.com/org/repo/pull/42#pullrequestreview-1",
                            },
                          ],
                        },
                      },
                    },
                  ],
                  pageInfo: { endCursor: null, hasNextPage: false },
                },
              },
            }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve("Unexpected") });
    });

    const result = await collectRawGraphQL({
      start: "2025-01-01",
      end: "2025-12-31",
      noReviews: false,
      token: "ghp_test",
      fetchFn: mockFetch,
    });

    expect(result.timeframe).toEqual({ start_date: "2025-01-01", end_date: "2025-12-31" });
    expect(result.pull_requests).toHaveLength(1);
    expect(result.pull_requests[0]).toMatchObject({
      number: 42,
      title: "Fix bug",
      body: "Description",
      html_url: "https://github.com/org/repo/pull/42",
      merged_at: "2025-06-01T12:00:00Z",
      base: { repo: { full_name: "org/repo" } },
      labels: [{ name: "bug" }],
      changed_files: 3,
      additions: 10,
      deletions: 2,
      review_comments: 1,
    });
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      id: "PRR_abc",
      body: "LGTM",
      state: "APPROVED",
      repository: { full_name: "org/repo" },
      pull_number: 42,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("with noReviews omits reviews from output", async () => {
    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      const body = JSON.parse(opts?.body ?? "{}");
      const query = body.query ?? "";
      if (query.includes("viewer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { viewer: { login: "u" } } }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              search: {
                edges: [],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          }),
        text: () => Promise.resolve(""),
      });
    });

    const result = await collectRawGraphQL({
      start: "2025-01-01",
      end: "2025-12-31",
      noReviews: true,
      token: "x",
      fetchFn: mockFetch,
    });
    expect(result.pull_requests).toHaveLength(0);
    expect(result.reviews).toHaveLength(0);
  });

  it("throws when viewer login is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { viewer: {} } }),
      text: () => Promise.resolve(""),
    });
    await expect(
      collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch })
    ).rejects.toThrow(/viewer login/i);
  });

  it("throws on GraphQL errors", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { viewer: { login: "u" } } }),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ errors: [{ message: "rate limited" }] }),
        text: () => Promise.resolve(""),
      });
    await expect(
      collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch })
    ).rejects.toThrow("rate limited");
  });

  it("throws on HTTP error from GitHub", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Bad credentials"),
    });
    await expect(
      collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch })
    ).rejects.toThrow(/401/);
  });

  it("throws when search returns no search data", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { viewer: { login: "u" } } }),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
        text: () => Promise.resolve(""),
      });
    await expect(
      collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch })
    ).rejects.toThrow(/no search/i);
  });

  it("skips non-PullRequest nodes", async () => {
    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      const body = JSON.parse(opts?.body ?? "{}");
      if (body.query.includes("viewer")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { viewer: { login: "u" } } }), text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            search: {
              edges: [{ node: { __typename: "Issue", number: 1 } }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        }),
        text: () => Promise.resolve(""),
      });
    });
    const result = await collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch });
    expect(result.pull_requests).toHaveLength(0);
  });

  it("paginates when hasNextPage is true", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      const body = JSON.parse(opts?.body ?? "{}");
      if (body.query.includes("viewer")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { viewer: { login: "u" } } }), text: () => Promise.resolve("") });
      }
      callCount++;
      const isFirst = callCount === 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            search: {
              edges: [{
                node: {
                  __typename: "PullRequest",
                  number: callCount,
                  title: `PR${callCount}`,
                  body: "",
                  url: "https://x",
                  mergedAt: null,
                  additions: 0, deletions: 0, changedFiles: 0,
                  baseRepository: { nameWithOwner: "a/b" },
                  labels: { nodes: [] },
                  reviewThreads: { totalCount: 0 },
                  reviews: { nodes: [] },
                },
              }],
              pageInfo: { endCursor: isFirst ? "cursor1" : null, hasNextPage: isFirst },
            },
          },
        }),
        text: () => Promise.resolve(""),
      });
    });
    const result = await collectRawGraphQL({ start: "2025-01-01", end: "2025-12-31", token: "x", fetchFn: mockFetch });
    expect(result.pull_requests).toHaveLength(2);
  });

  it("normalize(collectRawGraphQL(...)) produces contributions", async () => {
    const mockFetch = vi.fn().mockImplementation((url, opts) => {
      const body = JSON.parse(opts?.body ?? "{}");
      const query = body.query ?? "";
      if (query.includes("viewer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { viewer: { login: "u" } } }),
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              search: {
                edges: [
                  {
                    node: {
                      __typename: "PullRequest",
                      number: 1,
                      title: "PR one",
                      body: "",
                      url: "https://github.com/a/b/pull/1",
                      mergedAt: "2025-01-15T00:00:00Z",
                      additions: 0,
                      deletions: 0,
                      changedFiles: 1,
                      baseRepository: { nameWithOwner: "a/b" },
                      labels: { nodes: [] },
                      reviewThreads: { totalCount: 0 },
                      reviews: { nodes: [{ id: "r1", body: "ok", state: "APPROVED", submittedAt: "2025-01-15T01:00:00Z", url: "https://x" }] },
                    },
                  },
                ],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          }),
        text: () => Promise.resolve(""),
      });
    });

    const raw = await collectRawGraphQL({
      start: "2025-01-01",
      end: "2025-12-31",
      noReviews: false,
      token: "t",
      fetchFn: mockFetch,
    });
    const evidence = normalize(raw, "2025-01-01", "2025-12-31");
    expect(evidence.contributions).toHaveLength(2);
    const types = evidence.contributions.map((c) => c.type);
    expect(types).toContain("pull_request");
    expect(types).toContain("review");
  });
});
