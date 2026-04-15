# Venue RAG pipeline plan (EDV-6)

## Goal

Design a venue-specific retrieval pipeline that:

1. Identifies the correct venue for each booking request.
2. Retrieves only that venue's approved context.
3. Produces grounded answers with minimal cross-venue leakage risk.

This plan is scoped for implementation and evaluation, not a production-ready rollout in one pass.

---

## 1) Source documents and ingestion boundaries

### In-scope source types

- Venue event guides (PDF/DOCX), e.g. Brando's event guide.
- Venue policy docs (capacity, staffing, cancellation, curfew, AV package).
- Venue FAQ and pricing sheets.
- Venue profile data from the structured venue model (core fields and canonical aliases).

### Out-of-scope for initial phase

- Unverified email threads.
- User-uploaded docs without venue ownership verification.
- Cross-venue "master docs" unless split into venue-owned sections before ingestion.

### Ingestion boundary rules

- Every ingested document must map to exactly one `venue_id`.
- Reject docs that cannot be confidently bound to one venue.
- Persist document provenance:
  - `doc_id`, `venue_id`, `source_type`, `source_uri`, `uploaded_at`, `checksum`.
- Re-ingestion is idempotent by checksum + `venue_id`.

---

## 2) Parsing and ingestion tooling

### Primary parser: `unstructured`

Use `unstructured` for first-pass extraction across PDF/DOCX/HTML because it provides:

- consistent element extraction for mixed layouts,
- table-aware parsing,
- configurable chunking hooks.

### Fallback parser strategy

When extraction quality is below thresholds (see evaluation section), route by MIME type:

- PDF fallback: `pypdf` text extraction.
- DOCX fallback: `python-docx`.
- HTML fallback: readability-style extraction.

### Parse-quality checks

Run automatic checks before indexing:

- non-empty content ratio,
- malformed-character ratio,
- heading detection presence,
- table extraction integrity (for pricing docs).

Flag failed docs for manual review; do not publish failed parses to retrieval.

---

## 3) Chunking strategy and retrieval boundaries

### Chunk design

Use structure-aware chunking:

- Prefer heading/section-based segmentation.
- Target chunk size: ~600-900 tokens.
- Overlap: ~80-120 tokens.
- Keep atomic policy statements in one chunk where possible.

### Metadata model per chunk

- `chunk_id`
- `venue_id` (required)
- `doc_id` (required)
- `source_type`
- `section_title`
- `effective_date` (optional)
- `policy_type` (optional enum: pricing, capacity, catering, logistics, contract, etc.)
- `visibility` (default `internal`)
- `checksum`

### Hard retrieval boundary

All retrieval queries must include a mandatory metadata filter:

- `where venue_id == <resolved_venue_id>`

This filter is not optional and must be enforced server-side (not prompt-only).

---

## 4) Venue identification and disambiguation

### Step A: deterministic candidate generation

From request text + known structured fields:

- exact venue ID match (if provided),
- exact alias/name match,
- normalized fuzzy match over canonical aliases.

### Step B: confidence scoring

Combine:

- lexical name similarity,
- city/region match,
- known contact-domain hints (if available),
- optional user-selected venue context.

### Step C: decision policy

- If confidence >= high threshold: lock venue and continue.
- If confidence in gray zone: ask a clarifying question before retrieval.
- If confidence low: do not retrieve; request venue confirmation.

### Safety note

Never run retrieval across multiple venues in one query unless explicitly in an internal admin/debug mode.

---

## 5) Retrieval flow in booking-request generation

### Proposed request path

1. Parse booking request input.
2. Resolve `venue_id` using disambiguation policy.
3. Fetch structured venue profile (`venue_id` scoped).
4. Retrieve top-k chunks from vector index with strict `venue_id` filter.
5. Rerank retrieved chunks (semantic + policy-priority reranking).
6. Build model context:
   - structured fields first (authoritative),
   - then retrieved snippets with citation IDs (`doc_id/chunk_id`).
7. Generate draft response with grounding rules:
   - cite retrieved or structured source for venue-specific claims,
   - if unsupported, state uncertainty and ask follow-up.

### Context precedence

1. Structured venue model (source of truth for canonical fields).
2. Latest effective-dated policy chunks.
3. General FAQ chunks.

If conflicts occur, prefer structured model and include "needs confirmation" text for disputed policy details.

---

## 6) Anti-leakage controls

### Preventive controls

- Mandatory `venue_id` filter in retriever.
- Request-time assertion: all retrieved chunks share one `venue_id`.
- Prompt guardrail: "Do not mention details without cited venue-scoped evidence."

### Detective controls

- Post-generation validator scans output for:
  - terms known to belong to different venues,
  - uncited numeric claims (prices/capacities),
  - references to chunks not present in context.

### Failure behavior

If leakage risk is detected:

- block final response,
- return safe fallback asking for venue confirmation or additional context,
- emit telemetry event for review.

---

## 7) Evaluation plan

### Offline test set

Build a curated eval set with:

- venue-disambiguation cases (similar names, same city, typo-heavy input),
- policy lookup cases (pricing, capacity, restrictions),
- adversarial leakage prompts ("what does the other venue charge?"),
- insufficient-context cases requiring follow-up questions.

### Metrics

- Venue resolution accuracy.
- Retrieval precision@k (venue-scoped relevance).
- Cross-venue leakage rate (target: near-zero; release-gated).
- Grounded claim rate (claim has valid citation).
- Clarification quality when confidence is low.

### Release gates

Before enabling default flow:

- leakage rate below agreed threshold on eval set,
- high-confidence venue resolution meets threshold,
- no critical uncited policy claims in sampled outputs.

---

## 8) Implementation phases

### Phase 1: ingestion foundation

- Build parser abstraction with `unstructured` primary + MIME fallbacks.
- Add ingestion validation and provenance schema.
- Index chunks with required `venue_id`.

### Phase 2: retrieval safety

- Add strict metadata-filtered retrieval path.
- Add disambiguation service + confidence policy.
- Wire structured + retrieved context assembly for booking flow.

### Phase 3: quality and launch criteria

- Implement leakage validator and telemetry.
- Create offline eval harness + benchmark suite.
- Tune thresholds (disambiguation, top-k, rerank, blockers).

---

## 9) Open decisions to confirm before build

1. Canonical alias source of truth: venue model table or external CRM sync?
2. Effective-date policy: should expired docs remain retrievable for historical requests?
3. How strict should clarification gating be for partially identified venues?
4. What is the acceptable leakage-rate threshold for rollout?

---

## 10) Definition of done for EDV-6 planning

Planning is complete when:

- ingestion boundaries and ownership rules are documented,
- parser/tooling choice + fallback path is defined,
- chunking/metadata/retrieval boundaries are explicit,
- venue disambiguation policy is explicit with safe fallbacks,
- booking-flow integration points are mapped,
- evaluation metrics + release gates are defined.
