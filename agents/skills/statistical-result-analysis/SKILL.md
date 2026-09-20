---
name: statistical-result-analysis
description: Analyze research-result files such as CSV, JSON, TSV, experiment logs, or tables and produce a reproducible statistical report. Use for comparing methods, selecting statistical tests, computing uncertainty and effect sizes, checking result tables, or preparing a paper's results section. Do not use to fabricate observations, infer causality from an unsuitable design, or silently choose tests without recording assumptions.
---

# Statistical result analysis

## Intake and data audit

Require input path, unit of analysis, hypothesis/estimand, primary metric, comparison groups, pairing/repeated-measure structure, and intended decision. Inspect schema, missingness, duplicate IDs, invalid ranges, and transformation needs before analysis. Save `analysis/data-audit.json`.

## Analysis protocol

1. Write `analysis/plan.md`: estimand, primary test, alternatives, alpha/interval policy, multiple-comparison policy, and diagnostic assumptions.
2. Select tests from design, not metric names: paired data require paired/resampled comparison; independent groups require independent comparison; repeated measures require a model that accounts for dependence. If assumptions cannot be checked, report a robust/nonparametric or descriptive fallback.
3. Compute sample counts, central tendency, spread, confidence intervals, effect size with direction, test statistic, p-value where appropriate, and exact data exclusions.
4. Generate machine-readable `analysis/summary.json`, code/notebook reference, and `analysis/report.md`. Preserve raw values and seeds; never overwrite inputs.
5. Check reported tables against source metrics and flag impossible precision, missing denominators, or unmatched comparison settings.

## Quality gate

Use [analysis-contract.md](references/analysis-contract.md). Avoid “significant/non-significant” as the sole conclusion; interpret magnitude, uncertainty, and practical relevance. Do not claim causal effects without a causal design and stated assumptions. Do not execute analysis code or install packages without appropriate user approval.
