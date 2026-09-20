# Skill evaluation matrix

Evaluate artifact behavior rather than prose similarity. Each case must assert trigger boundary, required inputs, tool intent/order, output paths, evidence tracing, and forbidden claims.

| Skill | Success fixture | Boundary fixture | Required assertions |
|---|---|---|---|
| paper-search-pro | paper-search-pro-standard | unavailable source | query/source log, dedup lineage, verified metadata only |
| systematic-literature-review | multi-source screened set | slr-incomplete-screening | protocol, exclusions, thematic—not sequential—synthesis |
| academic-paper-review | parsed manuscript | paper-review-abstract-only | locators, remedy per criticism, review limitations |
| hypothesis-research-loop | small approved pilot | hypothesis-loop-unapproved | pre-registered prediction, immutable run log, approval stop |
| statistical-result-analysis | statistical-analysis-paired | missing design fields | design-appropriate test, interval/effect size, data audit |
| research-writing-and-rebuttal | evidence-mapped revision | writing-rebuttal-missing-evidence | claim map, verified references, no unperformed-work claim |
| research-thesis | bounded thesis with named comparator | research-thesis-no-comparator | falsifier, success criterion, explicit go/no-go |
| novelty-red-team | differentiable claim | novelty-red-team-close-overlap | closest-work evidence, overlap risk, prohibited unsupported novelty language |
| experiment-matrix | approved claim plan | experiment-matrix-metric-drift | claim-to-run traceability, locked primary metric, approval gate |
| iclr-red-team | artifact-backed paper draft | iclr-red-team-unsupported-claim | three review passes, blocker repairs, no acceptance prediction |

## Manual gate

- Does the name/description route the task to the right skill and reject its nearest confusion case?
- Are tool parameters deferred to the current plugin schemas?
- Are all material outputs stored with `artifact_save` and traceable to sources or raw data?
- Are expensive, private, destructive, or side-effecting actions held at an explicit approval gate?
- Does degraded output retain uncertainty and coverage limitations?
