---
protocol: along
protocol_version: "4.8.0"
slug: docs-static-publish
type: task
status: open
priority: low
created: 2026-11-12
updated: 2026-11-12
agent: claude-code
tags: [docs, pages]
blocked_by: []
related: []
---

# Publish the docs site as a locally built static site

## Problem Statement
Docs are published to GitHub Pages by `.github/workflows/pages.yml` on GitHub Actions
(`docs:build` = `vitepress build docs`, output `.dist-docs`). GitHub Actions is off for the
`actdim` org (no budget, 2026-11-11). The user wants each public package to publish its docs as
a locally built static site, with a way to switch back to Actions later.

Depends on the Mempart root spike `spike--static-docs-publishing` (named in prose: a cross-repo
`blocked_by` is not resolvable here), which picks the shared approach. Not urgent (user,
2026-11-12): do not start before the spike.

## Requirements
- REQ-1: A documented command MUST build the site with `docs:build`, add `.nojekyll` and push
  `.dist-docs` to the `gh-pages` branch of this repo.
- REQ-2: The Pages source switch ("GitHub Actions" -> "Deploy from a branch: gh-pages") MUST be
  done only after the user's yes; `pages.yml` stays (manual trigger only) so switching back is
  one setting.

## Acceptance Criteria
- [ ] The site is served from `gh-pages`, built locally, and matches the current site.
- [ ] Publish and switch-back steps documented in this repo's docs.
