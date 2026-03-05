import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { normalize } from "../scripts/normalize.ts";

describe("normalize", () => {
  it("outputs timeframe and contributions from empty raw", () => {
    const evidence = normalize({}, null, null);
    expect(evidence.timeframe).toBeDefined();
    expect(evidence.contributions).toBeInstanceOf(Array);
    expect(evidence.contributions).toHaveLength(0);
  });

  it("normalizes one PR into evidence contribution", () => {
    const raw = {
      pull_requests: [
        {
          number: 42,
          title: "Add feature",
          html_url: "https://github.com/org/repo/pull/42",
          base: { repo: { full_name: "org/repo" } },
          merged_at: "2025-06-01T12:00:00Z",
          labels: [{ name: "feature" }],
          changed_files: 3,
          additions: 100,
          deletions: 20,
          body: "Summary",
          review_comments: 2,
        },
      ],
    };
    const evidence = normalize(raw, null, null);
    expect(evidence.contributions).toHaveLength(1);
    const c = evidence.contributions[0];
    expect(c.type).toBe("pull_request");
    expect(c.id).toBe("org/repo#42");
    expect(c.title).toBe("Add feature");
    expect(c.repo).toBe("org/repo");
    expect(c.merged_at).toBe("2025-06-01T12:00:00Z");
    expect(c.labels[0]).toBe("feature");
    expect(c.files_changed).toBe(3);
    expect(c.additions).toBe(100);
    expect(c.deletions).toBe(20);
  });

  it("filters PRs by start/end date", () => {
    const raw = {
      pull_requests: [
        { number: 1, merged_at: "2025-01-01T00:00:00Z", base: { repo: { full_name: "org/r" } }, title: "A", html_url: "https://x", labels: [] },
        { number: 2, merged_at: "2025-07-15T12:00:00Z", base: { repo: { full_name: "org/r" } }, title: "B", html_url: "https://x", labels: [] },
      ],
    };
    const evidence = normalize(raw, "2025-06-01", "2025-12-31");
    expect(evidence.contributions).toHaveLength(1);
    expect(evidence.contributions[0].id).toBe("org/r#2");
  });

  it("squashes commits that belong to PRs", () => {
    const raw = {
      pull_requests: [
        { number: 1, merged_at: "2025-06-01T00:00:00Z", base: { repo: { full_name: "org/r" } }, title: "PR", html_url: "https://x", labels: [], commits: [{ sha: "abc1234" }] },
      ],
      commits: [
        { sha: "abc1234", repository: { full_name: "org/r" }, commit: { author: { date: "2025-06-01T00:00:00Z" }, message: "fix" } },
      ],
    };
    const evidence = normalize(raw, null, null);
    const prs = evidence.contributions.filter((c) => c.type === "pull_request");
    const issues = evidence.contributions.filter((c) => c.type === "issue");
    expect(prs).toHaveLength(1);
    expect(issues).toHaveLength(0);
  });

  it("keeps orphan commits as issue contributions", () => {
    const raw = {
      commits: [
        { sha: "deadbeef", repository: { full_name: "org/r" }, commit: { author: { date: "2025-06-01T00:00:00Z" }, message: "direct commit" } },
      ],
    };
    const evidence = normalize(raw, null, null);
    expect(evidence.contributions).toHaveLength(1);
    expect(evidence.contributions[0].type).toBe("issue");
    expect(evidence.contributions[0].id).toBe("org/r#deadbee");
  });

  it("normalizes reviews with repository and pull_number", () => {
    const raw = {
      reviews: [
        { id: "r1", body: "Nice", state: "APPROVED", submitted_at: "2025-06-01T00:00:00Z", html_url: "https://r", repository: { full_name: "org/r" }, pull_number: 10 },
      ],
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions).toHaveLength(1);
    expect(ev.contributions[0].type).toBe("review");
    expect(ev.contributions[0].repo).toBe("org/r");
    expect(ev.contributions[0].approvals_count).toBe(1);
  });

  it("normalizes reviews with pull_request_url fallback", () => {
    const raw = {
      reviews: [{ id: "r2", body: "", state: "CHANGES_REQUESTED", submitted_at: "2025-06-01T00:00:00Z", url: "https://r", pull_request_url: "https://api.github.com/repos/org/r/pulls/55" }],
      repo: "org/r",
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].id).toContain("55");
    expect(ev.contributions[0].approvals_count).toBe(0);
  });

  it("filters reviews by date range", () => {
    const raw = {
      reviews: [
        { id: "r3", state: "APPROVED", submitted_at: "2024-01-01T00:00:00Z", url: "", pull_number: 1 },
        { id: "r4", state: "APPROVED", submitted_at: "2025-06-01T00:00:00Z", url: "", pull_number: 2 },
      ],
      repo: "org/r",
    };
    const ev = normalize(raw, "2025-01-01", "2025-12-31");
    expect(ev.contributions).toHaveLength(1);
  });

  it("normalizes releases", () => {
    const raw = {
      releases: [
        { id: "rel1", tag_name: "v1.0", name: "Release 1.0", body: "Changes", html_url: "https://r", published_at: "2025-06-01T00:00:00Z", target_commitish: "main" },
      ],
      repo: "org/r",
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions).toHaveLength(1);
    expect(ev.contributions[0].type).toBe("release");
    expect(ev.contributions[0].title).toBe("Release 1.0");
  });

  it("normalizes release with repository fallback (no target_commitish)", () => {
    const raw = {
      releases: [{ id: "rel2", tag_name: "v2.0", html_url: "https://r", created_at: "2025-06-01", repository: { full_name: "org/r" } }],
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].repo).toBe("org/r");
  });

  it("filters releases by date range", () => {
    const raw = {
      releases: [
        { id: "old", published_at: "2024-01-01T00:00:00Z" },
        { id: "new", published_at: "2025-06-01T00:00:00Z" },
      ],
      repo: "org/r",
    };
    const ev = normalize(raw, "2025-01-01", "2025-12-31");
    expect(ev.contributions).toHaveLength(1);
  });

  it("filters commits by date range", () => {
    const raw = {
      commits: [
        { sha: "aaa", commit: { author: { date: "2024-01-01" }, message: "old" } },
        { sha: "bbb", commit: { author: { date: "2025-06-01" }, message: "new" } },
      ],
      repo: "org/r",
    };
    const ev = normalize(raw, "2025-01-01", "2025-12-31");
    expect(ev.contributions).toHaveLength(1);
    expect(ev.contributions[0].title).toBe("new");
  });

  it("uses created_at or updated_at for PR date when merged_at is null", () => {
    const raw = {
      pull_requests: [
        { number: 1, merged_at: null, created_at: "2025-06-15T00:00:00Z", base: { repo: { full_name: "org/r" } }, title: "Open PR", html_url: "https://x", labels: [] },
      ],
    };
    const ev = normalize(raw, "2025-06-01", "2025-12-31");
    expect(ev.contributions).toHaveLength(1);
  });

  it("falls back to head repo for PR when base is missing", () => {
    const raw = {
      pull_requests: [
        { number: 1, head: { repo: { full_name: "fork/r" } }, title: "Fork PR", html_url: "https://x", labels: [], merged_at: null },
      ],
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].repo).toBe("fork/r");
  });

  it("falls back to raw.repo when PR has no base or head", () => {
    const raw = {
      repo: "default/repo",
      pull_requests: [{ number: 1, title: "PR", html_url: "https://x", labels: [], merged_at: null }],
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].repo).toBe("default/repo");
  });

  it("handles string labels in PR", () => {
    const raw = {
      pull_requests: [
        { number: 1, labels: ["bug", "fix"], base: { repo: { full_name: "a/b" } }, title: "T", html_url: "https://x", merged_at: null },
      ],
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].labels).toEqual(["bug", "fix"]);
  });

  it("uses raw.timeframe for defaults", () => {
    const raw = { timeframe: { start_date: "2024-01-01", end_date: "2024-12-31" } };
    const ev = normalize(raw, null, null);
    expect(ev.timeframe).toEqual({ start_date: "2024-01-01", end_date: "2024-12-31" });
  });

  it("uses pulls alias for pull_requests", () => {
    const raw = { pulls: [{ number: 5, title: "P", html_url: "https://x", labels: [], base: { repo: { full_name: "a/b" } }, merged_at: null }] };
    const ev = normalize(raw, null, null);
    expect(ev.contributions).toHaveLength(1);
  });

  it("uses pull_requests_list alias", () => {
    const raw = { pull_requests_list: [{ number: 6, title: "P2", html_url: "https://x", labels: [], base: { repo: { full_name: "a/b" } }, merged_at: null }] };
    const ev = normalize(raw, null, null);
    expect(ev.contributions).toHaveLength(1);
  });

  it("inRange returns false for invalid date", () => {
    const raw = {
      pull_requests: [{ number: 1, merged_at: "not-a-date", base: { repo: { full_name: "a/b" } }, title: "T", html_url: "https://x", labels: [] }],
    };
    const ev = normalize(raw, "2025-01-01", "2025-12-31");
    expect(ev.contributions).toHaveLength(0);
  });

  it("commit uses committer date as fallback", () => {
    const raw = {
      commits: [{ sha: "ccc", commit: { committer: { date: "2025-06-01" }, message: "msg" } }],
      repo: "o/r",
    };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].merged_at).toBe("2025-06-01");
  });

  it("contributionId with empty repo", () => {
    const raw = { commits: [{ sha: "ddd", commit: { message: "m" } }] };
    const ev = normalize(raw, null, null);
    expect(ev.contributions[0].id).toBe("#ddd");
  });

  it("preserves role_context_optional", () => {
    const raw = { role_context_optional: { level: "senior" } };
    const ev = normalize(raw, null, null);
    expect(ev.role_context_optional).toEqual({ level: "senior" });
  });
});

describe("normalize CLI", () => {
  it("reads raw file and writes evidence.json", () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const rawPath = join(dir, "raw.json");
    const outPath = join(dir, "evidence.json");
    writeFileSync(
      rawPath,
      JSON.stringify({
        pull_requests: [
          { number: 1, title: "PR", html_url: "https://github.com/a/b/pull/1", base: { repo: { full_name: "a/b" } }, merged_at: null, labels: [], body: "" },
        ],
      })
    );
    execSync(`node --import tsx/esm scripts/normalize.ts --input ${rawPath} --output ${outPath}`, { cwd: join(process.cwd()), env: { ...process.env, NODE_OPTIONS: "" } });
    const evidence = JSON.parse(readFileSync(outPath, "utf8"));
    expect(evidence.contributions).toHaveLength(1);
    expect(evidence.contributions[0].id).toBe("a/b#1");
    rmSync(dir, { recursive: true });
  });
});
