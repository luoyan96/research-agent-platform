---
artifact_id: "<stable-id>"
project_id: "<project-id>"
type: "<artifact-type>"
created_at: "<ISO-8601 timestamp>"
sources: []
status: "draft|complete|blocked|needs_more_research"
schema_version: "1.0"
---

# <Title>

## Evidence rules

- Cite every factual conclusion with a source ID and locator.
- Keep source claims, observed results, and agent inferences separate.
- Use `uncertain` or `not stated` where evidence is absent; never synthesize a paper, page, metric, or citation.
- Save every material artifact through `artifact_save` and keep its returned ID in `sources` or the body.
