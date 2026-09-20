# Working in this repository

Read README.md and docs/roadmap.md before changing product behavior. This repository is the shared starting point for a research-agent platform; preserve the distinction between implemented foundations and planned product features.

- Keep scientific domain logic in packages/research-core and skill loading in packages/research-skills. Harness-specific integration belongs in integrations/deepseek-harness.
- agents/skills is the single source of skill content. Preserve local references and update evaluations when behavior changes. Skill files in this repository describe workflows; reading them for maintenance does not invoke those workflows.
- Run pnpm run ci for shared code or packaged-skill changes. Run focused tests while developing; do not repeat a passing full check without a new reason. The default checks exclude the pending Harness adapter and live-model evaluation; report that distinction.
- Do not use fixed UI text to claim a connection, completed task, verified citation or successful experiment. Show actual state and explicit unavailable states.
- Keep credentials, personal research materials, runtime records and generated build output outside Git. Examples must use synthetic or publishable content.
- Extend Harness through its documented interfaces; do not vendor its source into this repository. Pin and verify any selected runtime version separately.
- Prefer a small branch and reviewable PR for subsequent work. The initial empty-repository import may establish main directly. Do not deploy or publish a package as a side effect of a code change.
- Keep source attribution and migration decisions in docs/migration.md and NOTICE.md. Do not remove old exploration repositories as part of routine migration.
