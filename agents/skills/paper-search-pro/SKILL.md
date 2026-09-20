---
name: paper-search-pro
description: Discover and triage academic literature across available scholarly sources, including Chinese-language queries. Use when users ask to find papers, build a reading list, scope a thesis topic, produce BibTeX, or generate a searchable research briefing. Produces a ranked, deduplicated library and a self-contained HTML or Markdown report; never presents unverified citations as results.
---

# Paper search pro

## Intake and tier

Require a research question; default to `standard`. Ask at most one question if scope is missing: time range, language, source constraints, or count. Select: `quick` (20–60 records, orientation), `standard` (60–180, background), `deep` (180–400, review preparation), or `audit` (systematic-review protocol). Do not promise a result count that source coverage cannot support.

## Retrieval protocol

1. Build a query matrix: concepts, synonyms, exclusions, languages, dates, and database-specific query variants. Save it before search.
2. Use contract-defined search connectors in this order when available: open scholarly metadata, discipline indexes, preprint indexes, and the project’s local library. Record unavailable sources rather than silently treating them as searched.
3. Merge records by DOI, then stable source ID, then normalized title/year. Retain all original IDs, source URLs, query IDs, and retrieval time.
4. Score relevance against the stated question using title/abstract evidence. Assign `high`, `medium`, `low`, or `unresolved`; do not infer relevance from venue alone.
5. Produce `papers/library.json`, `papers/search-log.json`, `papers/briefing.md`, and, when requested, `papers/briefing.html`. Generate BibTeX only from verified metadata.

## Quality gate

Use the schema in [report-contract.md](references/report-contract.md). State source coverage, deduplication counts, unavailable databases, and known metadata gaps. Mark entries as unverified if DOI, authors, date, or title cannot be checked. Never download PDFs without approval or call a search result “the best paper” without an explicit ranking criterion.
