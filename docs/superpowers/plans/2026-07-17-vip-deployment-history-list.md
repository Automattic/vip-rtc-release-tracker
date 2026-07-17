# VIP Deployment History List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every verified VIP staging and production deployment in an independently filterable release list.

**Architecture:** Add a browser-safe rendering helper that turns the generated `vipReleases` collection into newest-first deployment rows. Wire it to a dedicated filter in the static UI without sharing the PR timeline controls, then style the list responsively.

**Tech Stack:** Node.js ECMAScript modules, built-in `node:test`, vanilla HTML/CSS/JavaScript, static GitHub Pages.

## Global Constraints

- Consume the existing generated `data.vipReleases` collection; add no network calls or build jobs.
- Keep the deployment list independent from PR search, time-window, and projected-only filters.
- Preserve `unavailable-at-release` events and never invent artifact metadata.
- Use authoritative VIP release commit URLs for every list entry.
- Use Node's built-in test runner and add no dependencies.

---

### Task 1: Release-list rendering contract

**Files:**
- Modify: `test/render-helpers.test.mjs`
- Modify: `render-helpers.mjs`

**Interfaces:**
- Produces: `renderDeploymentList(releases, formatDate) -> string`.
- Consumes: entries shaped as `{ channel, name, sha, url, date, rtcPluginVersion, gutenbergBuildVersion, artifact?, artifactStatus? }`.

- [ ] **Step 1: Write the failing helper test**

Append a fixture with staging and production releases plus an `unavailable-at-release` staging release. Assert that `renderDeploymentList` renders newest-first, contains stage and release names, links the commit URL, includes the packaged Gutenberg version for an artifact, and renders `Artifact unavailable at release` when `artifact` is absent.

- [ ] **Step 2: Run the helper test and verify RED**

Run: `node --test test/render-helpers.test.mjs`

Expected: FAIL because `renderDeploymentList` is not exported.

- [ ] **Step 3: Implement the minimal helper**

Export `renderDeploymentList` from `render-helpers.mjs`. Sort a copied release array by descending `date`, escape display fields, render each release as a `deployment-card`, and render the artifact version and tracked PR count when present; otherwise render the explicit unavailable status.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `node --test test/render-helpers.test.mjs`

Expected: PASS with no failures.

### Task 2: Independent deployment-list UI

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: `data.vipReleases` and `renderDeploymentList`.
- Produces: `#deployment-history` content filtered only by `#deployment-stage`.

- [ ] **Step 1: Add the HTML region and scoped filter**

Insert a `deployment-section` after `#channels` with heading `VIP deployment history`, a `#deployment-stage` select with `all`, `staging`, and `production` values, and an accessible `#deployment-history` list container.

- [ ] **Step 2: Wire the release-list renderer**

Import `renderDeploymentList`, implement `renderDeploymentHistory()` to filter only `data.vipReleases` by the dedicated select, and call it during `init()` plus on `#deployment-stage` changes. Keep all timeline controls and `render()` unchanged.

- [ ] **Step 3: Add responsive styles and documentation**

Add panel, toolbar, release-grid, deployment-card, channel badge, metadata, and unavailable-status rules. At the existing narrow breakpoint, stack the heading and wrap metadata. Update `README.md` to distinguish the deployment history from the PR timeline and its shared build refresh.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test && npm run refresh && npm test`

Expected: all tests pass and generated data refreshes successfully.

- [ ] **Step 5: Inspect the static page and commit**

Serve with `npm start`, confirm the independent list renders all release events, test each stage filter, inspect the narrow viewport, stop the server, and commit the feature with `feat: add VIP deployment history list`.
