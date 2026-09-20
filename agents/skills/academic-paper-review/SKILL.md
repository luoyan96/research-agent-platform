---
name: academic-paper-review
description: Produce an evidence-grounded peer review or deep critical reading of one academic paper, PDF, preprint, or manuscript. Use for requests to review, critique, assess, summarize, prepare conference feedback, or identify revision priorities for a specific paper. Returns venue-aware strengths, weaknesses, numerical checks, reproducibility assessment, and actionable recommendations without inventing missing sections or results.
---

# Academic paper review

## Intake

Require one paper/manuscript and review purpose: quick triage, internal review, target venue, or revision audit. Fetch and parse the source using only contract tools. If content is abstract-only, label the review `limited-to-abstract` and do not score experimental rigor.

## Evidence-led passes

1. Record identity, version, venue/status, paper type, and accessible sections.
2. Extract claimed contributions, assumptions, method, datasets, baselines, metrics, results, limitations, and disclosures with source locators.
3. Run consistency checks: each headline number appears in a table/figure/text; comparisons specify matched settings; claims match evidence; test/reporting omissions are listed as omissions, not proof of invalidity.
4. Assess novelty positioning, methodological rigor, evidence sufficiency, reproducibility, ethics, and writing clarity. For venue review, map evidence to the venue’s supplied rubric rather than inventing a policy.
5. Save `reviews/<paper-id>.md` and `reviews/<paper-id>.json`; order requested changes by severity and effort using [review-contract.md](references/review-contract.md).

## Quality gate

Every criticism must name the observed evidence or absence and one concrete remedy. Separate blocking flaws, major concerns, minor comments, and questions. State review limitations; never manufacture page numbers, prior work, statistical errors, or acceptance recommendations beyond the requested rubric.
