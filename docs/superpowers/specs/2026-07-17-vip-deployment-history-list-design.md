# VIP Deployment History List Design

## Summary

Add a dedicated VIP deployment history section to the tracker. It will list every verified staging and production release independently of the pull-request timeline, using the generated `vipReleases` data already refreshed during each Pages build.

## Goals

- Show every verified VIP staging and production deployment as a release-oriented list.
- Keep the list independent of the PR timeline's search, window, and projected-only controls.
- Link each entry to the authoritative `vip-go-mu-plugins` release commit.
- Include the release timestamp, channel, RTC plugin version, selected Gutenberg build, packaged Gutenberg version when available, and an explicit unavailable-artifact state when it was not available at the release timestamp.
- Let readers narrow the list to all releases, staging, or production without altering the timeline.
- Keep ordering newest-first and preserve every event from `vipReleases`.

## Non-goals

- Do not create a second data source, endpoint, or refresh schedule.
- Do not reconstruct PR membership in the browser or turn this into another PR timeline.
- Do not hide historic events whose artifact was unavailable at release time.

## Architecture

`render-helpers.mjs` will gain a pure `renderDeploymentList(releases, formatDate)` helper. It will normalize ordering by release date, escape text, render the channel badge, and include the available artifact metadata. Unit tests will cover ordering, commit links, channel labels, and the unavailable-artifact status.

`app.js` will own a release-list filter select and will re-render only the deployment list when that select changes. The existing PR controls will remain scoped to timeline rows. The static HTML will add a titled section between current channel cards and the legend, and CSS will style it as a compact, responsive list.

Because the section consumes `data.vipReleases`, the existing `npm run refresh` command and Pages workflow automatically keep it current whenever they regenerate the site.

## Data Flow

```text
VIP branch history + artifact snapshots
  -> npm run refresh
  -> data.vipReleases
  -> deployment-history filter + renderDeploymentList
  -> static GitHub Pages release list
```

## Acceptance Criteria

- The page displays all generated `vipReleases`, newest first, outside the PR timeline.
- Selecting staging or production filters only the release list.
- Each entry displays and links its authoritative release commit, plus the release data available for that event.
- An event with `artifactStatus: "unavailable-at-release"` remains visible and explicitly identifies that condition.
- The list remains readable on narrow viewports.
- `npm test`, `npm run refresh`, and the Pages build continue to pass.
