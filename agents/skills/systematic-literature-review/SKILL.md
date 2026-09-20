---
name: systematic-literature-review
description: Create a reproducible systematic or scoping literature review with screening records, per-paper evidence extraction, thematic synthesis, and formatted references. Use for requests such as systematic review, SLR, PRISMA-style review, annotated bibliography, or cross-paper method comparison. Do not use for reviewing a single paper; route that task to academic-paper-review.
---

# Systematic literature review

## Protocol first

Require a review question, scope, and intended review type. Before retrieval, save `slr/protocol.md` with eligibility criteria, sources, exact query strings, screening fields, extraction fields, synthesis plan, and stop rule. For a formal PRISMA claim, use the reporting checklist in [slr-checklist.md](references/slr-checklist.md); otherwise call the output a scoped review.

## Workflow

1. Search sources using the documented query matrix. Log date, source, query, count, and export identity.
2. Deduplicate, then screen title/abstract/full text in that order. Preserve each exclusion and reason; never silently remove a record.
3. Extract a fixed record for every included paper: bibliographic metadata, question, population/data, method, comparator, outcomes/metrics, key findings, limitations, and source locators.
4. Assess evidence quality with criteria appropriate to the field. Do not convert missing reporting into low performance.
5. Synthesize by theme, method, data, and result direction—not one-paper-at-a-time. Keep contradictory and null findings visible.
6. Save `slr/study-table.json`, `slr/screening-log.csv`, `slr/review.md`, and requested `references.bib` through `artifact_save`.

## Quality gate

The final report must disclose databases actually searched, date range, selection flow/counts, limitations, and all included study IDs. Citations must be verified before entering the bibliography. If full text is inaccessible or screening cannot finish, save an incomplete review with a precise coverage statement rather than presenting it as systematic.
