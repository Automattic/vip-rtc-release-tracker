# VIP RTC Release Tracker

Static timeline for merged Gutenberg pull requests labeled `[Feature] Real-time Collaboration`.

The tracker shows each PR's merge date, Gutenberg RC and GA release dates, then projected VIP `vip-go-mu-plugins` staging and production dates:

- Staging: first Tuesday after the Gutenberg GA release.
- Production: the following Tuesday.

## Local Development

```bash
npm run refresh
npm run start
```

Then open <http://127.0.0.1:4173/>.

## Data Refresh

`npm run refresh` writes `data/pr-release-timeline.json`.

The refresh script reads:

- Merged Gutenberg PRs from the GitHub API.
- Gutenberg release dates from GitHub releases.
- PR-to-release membership from Gutenberg `changelog.txt`.

When a labeled PR is missing from the changelog, the script infers the nearest Gutenberg release cycle after the PR merge date. If the next release has not happened yet, it projects the next RC and GA from the current Gutenberg cadence.

## GitHub Pages

`.github/workflows/pages.yml` runs daily at `11:17 UTC` and can also be triggered manually. It regenerates the data and deploys the static site to GitHub Pages.

The workflow also accepts a `repository_dispatch` event named `gutenberg-rtc-pr-merged`, so an external webhook bridge or upstream workflow can trigger an immediate refresh when a Gutenberg PR is merged and has the `[Feature] Real-time Collaboration` label.

Example dispatch:

```bash
gh api repos/Automattic/vip-rtc-release-tracker/dispatches \
  -f event_type=gutenberg-rtc-pr-merged \
  -F client_payload[pr]=79005
```
