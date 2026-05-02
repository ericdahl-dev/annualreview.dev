/**
 * Fetch the current user's PRs and reviews from GitHub for a date range.
 * Output: raw JSON { timeframe, pull_requests, reviews } for the normalizer.
 * CLI: GITHUB_TOKEN=xxx node --import tsx/esm scripts/collect-github.ts --start YYYY-MM-DD --end YYYY-MM-DD [--output raw.json] [--no-reviews]
 */

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { parseArgs as parseArgsBase } from "../lib/parse-args.ts";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

const SEARCH_PR_PAGE_SIZE = 100;

const COLLECT_GITHUB_SCHEMA = {
  flags: [
    { name: "start", option: "--start", type: "string" as const },
    { name: "end", option: "--end", type: "string" as const },
    { name: "output", option: "--output", type: "string" as const },
    { name: "noReviews", option: "--no-reviews", type: "boolean" as const },
  ],
};

export interface CollectRawResult {
  timeframe: { start_date: string; end_date: string };
  pull_requests: RawPr[];
  reviews: RawReview[];
}

interface RawPr {
  number: number;
  title: string;
  body: string | null;
  url: string;
  html_url: string;
  merged_at: string | null;
  base: { repo: { full_name: string } };
  labels: { name: string }[];
  changed_files?: number;
  additions?: number;
  deletions?: number;
  review_comments?: number;
}

interface RawReview {
  id: string;
  body: string;
  state: string;
  submitted_at: string | null;
  url: string;
  html_url: string;
  repository: { full_name: string };
  pull_number: number;
}

function parseArgs(argv: string[] = process.argv.slice(2)): Record<string, unknown> {
  return parseArgsBase(COLLECT_GITHUB_SCHEMA, argv);
}

export { parseArgs };

interface GraphQLFetchOpts {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

async function graphqlFetch({
  token,
  query,
  variables = {},
  fetchFn = fetch,
}: GraphQLFetchOpts): Promise<{ data: unknown }> {
  const res = await fetchFn(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok)
    throw new Error(`${GITHUB_GRAPHQL} ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new Error(msg);
  }
  return { data: json.data };
}

interface GraphQLPrNode {
  __typename?: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  mergedAt: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  baseRepository?: { nameWithOwner?: string };
  labels?: { nodes?: { name: string }[] };
  reviewThreads?: { totalCount?: number };
  reviews?: { nodes?: GraphQLReviewNode[] };
}

interface GraphQLReviewNode {
  id: string;
  body: string | null;
  state: string | null;
  submittedAt: string | null;
  url: string | null;
  author?: { login?: string } | null;
}

function mapGraphQLPrToRaw(node: GraphQLPrNode): RawPr {
  const repo = node.baseRepository?.nameWithOwner ?? "";
  const labels = (node.labels?.nodes ?? []).map((n) => ({ name: n.name }));
  return {
    number: node.number,
    title: node.title ?? "",
    body: node.body ?? "",
    url: node.url ?? "",
    html_url: node.url ?? "",
    merged_at: node.mergedAt ?? null,
    base: { repo: { full_name: repo } },
    labels,
    changed_files: node.changedFiles ?? 0,
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    review_comments: node.reviewThreads?.totalCount ?? 0,
  };
}

function mapGraphQLReviewToRaw(
  reviewNode: GraphQLReviewNode,
  repoFullName: string,
  pullNumber: number
): RawReview {
  return {
    id: reviewNode.id,
    body: reviewNode.body ?? "",
    state: reviewNode.state ?? "",
    submitted_at: reviewNode.submittedAt ?? null,
    url: reviewNode.url ?? "",
    html_url: reviewNode.url ?? "",
    repository: { full_name: repoFullName },
    pull_number: pullNumber,
  };
}

export interface CollectRawGraphQLOpts {
  start: string;
  end: string;
  noReviews?: boolean;
  token: string;
  fetchFn?: typeof fetch;
}

export async function collectRawGraphQL({
  start,
  end,
  noReviews = false,
  token,
  fetchFn = fetch,
}: CollectRawGraphQLOpts): Promise<CollectRawResult> {
  const { data: viewerData } = await graphqlFetch({
    token,
    query: "query { viewer { login } }",
    fetchFn,
  });
  const login = (viewerData as { viewer?: { login?: string } })?.viewer?.login;
  if (!login) throw new Error("Could not get viewer login");

  const q = `author:${login} type:pr created:${start}..${end}`;
  const pull_requests: RawPr[] = [];
  const reviews: RawReview[] = [];
  let cursor: string | null = null;

  const searchQuery = `
    query($q: String!, $after: String) {
      search(query: $q, type: ISSUE, first: ${SEARCH_PR_PAGE_SIZE}, after: $after) {
        edges {
          node {
            __typename
            ... on PullRequest {
              number title body url mergedAt additions deletions changedFiles
              baseRepository { nameWithOwner }
              labels(first: 100) { nodes { name } }
              reviewThreads(first: 1) { totalCount }
              reviews(first: 100) { nodes { id body state submittedAt url } }
            }
          }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  `;

  for (;;) {
    const variables = { q, after: cursor };
    const { data } = await graphqlFetch({
      token,
      query: searchQuery,
      variables,
      fetchFn,
    });
    const search = (data as { search?: { edges?: { node?: GraphQLPrNode }[]; pageInfo?: { endCursor?: string; hasNextPage?: boolean } } })?.search;
    if (!search) throw new Error("Unexpected GraphQL response: no search");

    const edges = search.edges ?? [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || node.__typename !== "PullRequest") continue;

      const rawPr = mapGraphQLPrToRaw(node);
      pull_requests.push(rawPr);

      if (!noReviews && node.reviews?.nodes?.length) {
        const repoFullName = node.baseRepository?.nameWithOwner ?? "";
        for (const r of node.reviews.nodes) {
          reviews.push(mapGraphQLReviewToRaw(r, repoFullName, node.number));
        }
      }
    }

    const hasNext = search.pageInfo?.hasNextPage === true;
    if (!hasNext) break;
    cursor = search.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }

  // Second pass: collect reviews submitted by the user on other people's PRs.
  // This covers contributions in both personal and org repos that would be missed
  // by the author-only search above.
  if (!noReviews) {
    const reviewedPrQuery = `reviewed-by:${login} -author:${login} type:pr updated:${start}..${end}`;
    let reviewedCursor: string | null = null;
    const startTs = new Date(start + "T00:00:00Z").getTime();
    const endTs = new Date(end + "T23:59:59Z").getTime();

    const submittedReviewsSearchQuery = `
      query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: ${SEARCH_PR_PAGE_SIZE}, after: $after) {
          edges {
            node {
              __typename
              ... on PullRequest {
                number
                baseRepository { nameWithOwner }
                reviews(first: 100) {
                  nodes { id body state submittedAt url author { login } }
                }
              }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    `;

    for (;;) {
      const variables = { q: reviewedPrQuery, after: reviewedCursor };
      const { data } = await graphqlFetch({
        token,
        query: submittedReviewsSearchQuery,
        variables,
        fetchFn,
      });
      const search = (data as { search?: { edges?: { node?: GraphQLPrNode }[]; pageInfo?: { endCursor?: string; hasNextPage?: boolean } } })?.search;
      if (!search) throw new Error("Unexpected GraphQL response: no search");

      const edges = search.edges ?? [];
      for (const edge of edges) {
        const node = edge?.node;
        if (!node || node.__typename !== "PullRequest") continue;
        const repoFullName = node.baseRepository?.nameWithOwner ?? "";
        if (node.reviews?.nodes?.length) {
          for (const r of node.reviews.nodes) {
            // Only include reviews submitted by the authenticated user
            if (r.author?.login !== login) continue;
            // Filter to the requested date range by submission timestamp
            if (r.submittedAt) {
              const submittedTs = new Date(r.submittedAt).getTime();
              if (submittedTs < startTs || submittedTs > endTs) continue;
            }
            reviews.push(mapGraphQLReviewToRaw(r, repoFullName, node.number));
          }
        }
      }

      const hasNextReviewed = search.pageInfo?.hasNextPage === true;
      if (!hasNextReviewed) break;
      reviewedCursor = search.pageInfo?.endCursor ?? null;
      if (!reviewedCursor) break;
    }
  }

  return {
    timeframe: { start_date: start, end_date: end },
    pull_requests,
    reviews,
  };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN required");
    process.exit(1);
  }
  const parsed = parseArgs();
  const start = parsed.start as string | undefined;
  const end = parsed.end as string | undefined;
  const output = parsed.output as string | undefined;
  const noReviews = parsed.noReviews as boolean | undefined;
  if (!start || !end) {
    console.error("--start YYYY-MM-DD and --end YYYY-MM-DD required");
    process.exit(1);
  }
  const raw = await collectRawGraphQL({
    start,
    end,
    noReviews: noReviews ?? false,
    token,
  });
  const json = JSON.stringify(raw, null, 2);
  if (output) {
    writeFileSync(output, json);
    console.error("Wrote", output);
  } else {
    console.log(json);
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
