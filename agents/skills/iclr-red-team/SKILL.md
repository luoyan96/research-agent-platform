---
name: iclr-red-team
description: Simulate an evidence-grounded ICLR-style pre-submission review of a manuscript, claim register, experiment artifacts, and reproducibility package. Use when preparing an ICLR or similar ML conference submission, after results and a draft exist, to identify reject-worthy gaps in problem significance, novelty, technical soundness, empirical rigor, clarity, reproducibility, and compliance. Produces a severity-ranked repair plan; never invent venue policy or claim acceptance.
---

# ICLR red team

## Scope

Require manuscript/draft, `claim-register.json`, literature/novelty memo, experiment matrix, result artifacts, and target-year official author material when available. Use current ICLR guidance only as a rubric, not as a substitute for the target-year Author Guide.

## Three independent passes

1. **Contribution reviewer**: test problem importance, literature positioning, claim delta, and significance. Ask whether the work contributes new knowledge rather than merely a metric gain.
2. **Rigor reviewer**: trace each central claim to results; inspect matched baselines, data splits, variance/seeds, ablations, robustness, compute cost, negative results, and statistical interpretation.
3. **Presentation and compliance reviewer**: inspect one-sentence thesis, figure/table/text consistency, double-blind risks, citation integrity, reproducibility statement, ethics/limitations, and disclosure requirements.

## Synthesis

Write `reviews/iclr-red-team.md`, `reviews/iclr-red-team.json`, and `reviews/repair-plan.md` through `artifact_save`. Each issue needs `severity`, `evidence`, `why it changes the decision`, `repair`, `owner`, and `deadline`; use [review-gate.md](references/review-gate.md). Classify the package as `NOT_READY`, `READY_WITH_WARNINGS`, or `READY_FOR_HUMAN_SIGNOFF`.

## Gate

Block signoff for an unsupported central claim, no matched strong baseline, unverified citation, numerical inconsistency, missing reproducibility path, unresolved double-blind risk, or unverified target-year policy. Do not state a probability of acceptance or use fabricated reviewer consensus.
