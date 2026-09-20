---
name: experiment-matrix
description: Convert a research thesis and claim register into a minimal, reviewer-oriented ML experiment matrix. Use when planning main results, strong baselines, ablations, robustness tests, efficiency measurements, and failure analyses before running costly experiments. Produces a claim-to-evidence matrix, dependency-aware run plan, budget, and approval request; do not execute runs or change metrics without explicit approval.
---

# Experiment matrix

## Input contract

Require a passed research thesis, central claim, strongest competing method, available data/compute, and evaluation conventions. If a claim lacks a falsifier, return it to `research-thesis`; no experiment matrix can repair an undefined claim.

## Build the matrix

1. Create one row per claim and one column for decisive evidence: **main comparison**, **matched strong baseline**, **ablation/mechanism**, **robustness or boundary**, **efficiency/cost**, and **failure mode**.
2. For every proposed run record data split, metric definition, seed/run count, expected result under `C0` and its alternative, stop rule, estimated cost, and artifact path.
3. Mark rows `must-have`, `nice-to-have`, or `do-not-run`. A run is `must-have` only if omitting it leaves a reviewer question unanswered.
4. Order runs by information gained per cost: smoke test → discriminating pilot → main table → ablation → robustness. Lock metric and comparator before execution.
5. Save `experiments/matrix.md`, `experiments/matrix.json`, and `experiments/approval-request.md` through `artifact_save`; use [matrix-contract.md](references/matrix-contract.md).

## Approval and gate

Stop after planning. Require explicit approval for installs, downloads, GPU/paid resources, private data, long jobs, destructive actions, or material matrix changes. Pass to execution only when every `must-have` claim has a baseline, data provenance, metric, budget, and predicted discriminating outcome.
