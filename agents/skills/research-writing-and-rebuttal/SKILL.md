---
name: research-writing-and-rebuttal
description: Draft, revise, polish, or respond to reviews for Chinese- or English-language academic manuscripts, including Markdown and LaTeX. Use for paper sections, abstracts, related work, methods/results/discussion, reviewer rebuttals, revision plans, or submission-readiness checks. Preserve formulas, terminology, citations, and measured results; never invent evidence, references, ethics approvals, author roles, or journal requirements.
---

# Research writing and rebuttal

## Source-of-truth gate

Require manuscript files and/or saved research artifacts. Build `writing/evidence-map.json` before drafting: each factual claim, number, figure, and citation maps to an artifact/source ID and locator. Keep English paper titles, formulas, variable names, code identifiers, and citation keys unchanged unless the user asks otherwise.

## Drafting and revision

1. Identify task: new section, language/style edit, structural rewrite, rebuttal, or submission audit. Confirm target venue/style only if it changes content or formatting.
2. Create an outline that gives each paragraph one claim and supporting evidence. Mark unavailable evidence `[需补证据]` / `[evidence needed]` rather than filling it.
3. Draft with claim/evidence separation. Use `citation_verify` before adding or modifying a bibliography entry.
4. For reviews, create `revision/response-matrix.md`: reviewer point, interpretation, action, changed-file/locator, evidence, and response text. Never promise an experiment not planned or completed.
5. Run the checklist in [manuscript-contract.md](references/manuscript-contract.md), then save a clean draft and a change log through `artifact_save`.

## Quality gate

Every quantitative statement resolves to an analysis/experiment artifact; every external source resolves to verified metadata. Keep limitations, negative results, funding, ethics, conflicts, author contributions, and AI-use disclosures as explicit review items—not assumed facts. If venue policy is unverified, provide a placeholder and label it for human confirmation.
