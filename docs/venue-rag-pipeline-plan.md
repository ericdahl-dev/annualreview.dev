# Venue RAG Pipeline Plan (EDV-6)

## Goal
Design a venue-specific retrieval pipeline that:
- grounds booking-response drafting in venue documents and structured venue data,
- reliably disambiguates among many venues,
- prevents cross-venue leakage.

## 1) Source documents and ingestion boundaries

### In-scope sources (per venue)
1. Structured venue profile (system-of-record fields):
   - venue_id, canonical_name, aliases, address, timezone, capacity, room inventory
   - policies (min spend, deposits, cancellation, curfew, vendors, insurance)
   - amenities (A/V, parking, accessibility)
2. Venue-owned documents:
   - event guide PDFs (for example: Brando's event guide)
   - pricing sheets, FAQs, floor plans, menus, package docs
   - contract templates and policy addenda
3. Operational notes approved for customer-facing responses:
   - approved Q&A snippets and playbooks.

### Out-of-scope sources (initial release)
- Cross-venue generic sales playbooks (keep in a separate global index later).
- Private operational logs not approved for customer-facing responses.
- Unstructured email threads unless normalized and approved.

### Ingestion boundary rule
Every ingested item must be bound to exactly one `venue_id` (or explicitly marked `global`). If a document cannot be unambiguously mapped to one venue, it is rejected from venue index ingestion.

## 2) Parsing and ingestion tooling

### Recommended parser stack
- Primary: `unstructured` partitioning for PDF/DOCX/HTML (high recall on mixed layouts).
- Fallbacks:
  - native text extraction for clean PDFs,
  - OCR path for scanned pages (only if extraction quality score is below threshold).

### Parser evaluation criteria
- Text fidelity (headers, bullets, tables, pricing values preserved).
- Element typing quality (Title/List/Table/Narrative segmentation).
- Throughput and cost per document.
- Determinism/version stability for re-indexing.

### Ingestion pipeline stages
1. **Acquire**: fetch from approved source bucket/folder.
2. **Normalize**: parse to canonical `DocumentElement[]`.
3. **Validate**: enforce required metadata (`venue_id`, `doc_type`, `effective_date`).
4. **Chunk**: apply venue-aware chunking strategy (below).
5. **Embed + index**: write to vector store and metadata store.
6. **Audit log**: persist ingestion version, checksum, parser version, and rejection reasons.

## 3) Chunking strategy, metadata model, and retrieval boundaries

### Chunking strategy
- Use semantic chunks from parser elements first, then token-limit split.
- Target chunk size: ~300-500 tokens, overlap 50-80 tokens.
- Keep tables/pricing blocks atomic where possible (no row-splitting unless necessary).
- Attach parent section title to each chunk to preserve context.

### Metadata model (required fields)
- `venue_id` (hard filter key)
- `doc_id`, `doc_version`, `source_uri`, `doc_type`
- `section_path` (for explainability)
- `effective_date` / `expires_at` (policy freshness)
- `sensitivity` (`customer_safe`, `internal_only`)
- `parser_version`, `ingested_at`
- `hash` (dedupe + change detection)

### Retrieval boundaries
Hard constraints at query time:
1. `venue_id == resolved_venue_id`
2. `sensitivity == customer_safe`
3. `effective_date <= now < expires_at` when dates exist

Soft ranking signals:
- semantic similarity,
- doc-type priors (policy/pricing > generic FAQ for booking asks),
- recency weighting for policy docs.

## 4) Venue identification and anti-leakage controls

### Venue resolution flow
1. Resolve venue from booking context using deterministic keys:
   - explicit `venue_id` from request, else
   - normalized venue name + address match, else
   - alias map lookup.
2. If multiple candidates remain, return clarification prompt before retrieval.
3. If no candidate confidence above threshold, do not answer venue specifics.

### Leakage prevention controls
- Retrieval hard-filter on `venue_id` (non-negotiable).
- Post-retrieval guard: reject any chunk whose metadata venue mismatches resolved venue.
- Response guardrails: if evidence set is empty or ambiguous, explicitly say details require confirmation.
- Trace logging: store chunk ids used for each answer to support audits.

## 5) Retrieval architecture in booking-request flow

## Request-time sequence
1. Receive booking request and extract intent (capacity, date, policy, pricing, amenities).
2. Resolve `venue_id`.
3. Build retrieval query from user ask + structured slots.
4. Retrieve top-k venue chunks (k=8-12), then rerank to top-n evidence (n=4-6).
5. Compose context package:
   - structured venue snapshot (authoritative fields),
   - retrieved evidence snippets with citations.
6. Generate booking draft with citation requirements per claim.
7. Run safety checks:
   - no claims without supporting structured field or retrieved citation,
   - no cross-venue metadata in evidence.
8. Return response + evidence references for debugging.

### Data precedence rule
When structured data conflicts with documents, structured system-of-record wins unless document is explicitly marked newer and authoritative for that field.

## 6) Evaluation plan

### Offline evaluation set
- Build labeled queries across many venues:
  - direct venue asks, ambiguous names, similarly named venues, policy edge cases.
- Include adversarial cases designed to trigger leakage.

### Metrics
- Venue resolution accuracy (top-1 and abstain quality).
- Retrieval precision@k within correct venue.
- Cross-venue leakage rate (must be 0 in evaluation gate).
- Answer grounding rate (% claims backed by citation).
- Hallucination/unsupported-claim rate.

### Online safeguards (pre-GA)
- Shadow mode logging for real booking requests.
- Human review on sampled responses with citation trace.
- Block promotion if leakage or unsupported claim thresholds are exceeded.

## 7) Implementation milestones

1. **Schema + ingestion contract**
   - Define chunk metadata schema and validation.
2. **Parser bake-off**
   - Evaluate `unstructured` vs fallback extractors on representative venue docs.
3. **Indexing + hard-filter retrieval**
   - Implement strict `venue_id` retrieval boundaries.
4. **Booking-flow integration**
   - Add context composer and citation-enforced generation.
5. **Evaluation harness + gates**
   - Add offline dataset + leakage and grounding gates.
6. **Staged rollout**
   - Shadow mode, monitored ramp, then general availability.

## 8) Open decisions needed

1. Source-of-truth owner for structured venue profile and SLA for updates.
2. Final vector store and reranker selection.
3. Global-vs-venue content strategy for future shared FAQs.
4. Policy precedence exceptions (if any) beyond the default rule above.
