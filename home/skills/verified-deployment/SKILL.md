---
name: verified-deployment
description: >-
  Use when publishing, deploying, releasing, pushing code live, updating a stable
  hosting URL, or verifying a GitHub/Vercel deployment. Prevents preview versus
  production confusion and speculative source changes during release work.
---

# Verified Deployment

## Core

A deployment request names an operational outcome, not permission to redesign
the product. Freeze the target before mutating remote state, use one publish
path, and prove the exact requested URL serves the expected commit.

## Target Contract

Resolve these facts before any external write:

- repository and remote;
- source branch and expected commit SHA;
- hosting account/team and project ID or unambiguous project name;
- deploy mode: preview or production;
- exact stable URL or alias the user expects.

If a load-bearing fact is missing or contradictory, stop and ask one focused
question. Do not guess a project, substitute a preview URL, or create a temporary
share URL when a stable production URL was requested.

## Workflow

1. Inspect current Git and hosting linkage without changing source.
2. State the resolved target tuple and compare it with the user's wording.
3. Preserve unrelated and dirty-tree changes. Isolate only the already-approved
   files when needed; do not add refactors, tests, or product fixes during a
   publish-only task.
4. Run only the release checks required by changed state. Reuse fresh passing
   evidence when nothing relevant changed.
5. Perform one narrow publish path. A branch push or pull request proves preview,
   not production, unless the hosting configuration explicitly says otherwise.
6. Poll the exact deployment until terminal state.
7. Verify the deployed commit SHA, exact alias, and an unauthenticated HTTP request
   to the requested URL. For UI changes, check the named page or content too.

## Stop Conditions

Stop instead of broadening scope when:

- target mapping cannot be proven;
- production authorization is absent (the user's standing authority in
  `~/.claude/CLAUDE.md` covers the user's own projects' established destinations, so
  this applies to anything outside it);
- remote state contradicts the requested branch or commit;
- successful publish would require source edits the user did not request;
- verification can only prove a protected preview, not the stable target.

Return `pass`, `fail`, or `blocked`, plus target tuple, deployed SHA, exact URL,
checks performed, and remaining risk.
