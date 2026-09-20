---
name: research-thesis
description: Turn an early ML/AI research idea into a one-page, falsifiable research thesis and an explicit go/no-go decision. Use when a user has a tentative research direction, wants to choose among ideas, start an ICLR-style project, or needs to state the problem, contribution, strongest related work, and success criteria before spending substantial compute. Do not use to invent novelty, results, or a research claim without evidence.
---

# Research thesis

## Required inputs

Require a raw idea, intended community/task, practical constraints, and any initial evidence. If literature is unavailable, ask `paper-search-pro` for a focused landscape first. Do not start experiments yet.

## Workflow

1. Write a 30-second pitch: **problem → insight → intervention → measurable consequence**. Reject jargon-only formulations.
2. Turn the pitch into one central claim (`C0`) and at most three supporting claims. Every claim must have a scope condition and a falsifier.
3. Name 3–5 strongest likely neighbors, then explain the differentiator in one testable sentence. Use citation evidence; “to our knowledge” is not evidence.
4. Define success before results: primary metric, comparator, minimum meaningful effect, target setting, and failure condition.
5. Score importance, novelty evidence, feasibility in available time/compute, and falsifiability from 0–2. Record assumptions and unknowns.
6. Save `thesis/research-thesis.md` and `thesis/claim-register.json` with `artifact_save`, following [thesis-contract.md](references/thesis-contract.md).

## Gate

Pass only with a 6/8 score, a named strongest comparator, and a feasible falsification experiment. Otherwise return `REFINE`, `SEARCH_MORE`, or `DROP`; do not convert uncertainty into a positive contribution claim.
