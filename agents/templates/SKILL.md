---
name: skill-name
description: State what the research workflow does and concrete user situations that trigger it; state its safety boundary when needed.
---

# Skill title

Require explicit inputs and Project context. Name only contract-defined tools and defer parameters to their current plugin schemas.

1. Validate inputs and prerequisites.
2. Produce a plan or inspect only saved evidence.
3. Perform documented tool actions in a safe order.
4. Save required artifacts with `artifact_save`.

## Failure and quality gate

State refusal/degradation conditions, source-tracing requirements, approval boundaries, expected paths, and how uncertainty appears in output.
