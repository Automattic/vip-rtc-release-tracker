# VIP RTC Release Tracker

Static timeline for merged Gutenberg pull requests labeled `[Feature] Real-time Collaboration`.

The tracker shows each PR's merge date, Gutenberg RC and GA dates, and its first verified VIP staging and production releases. Actual VIP dates come from the `staging` and `production` histories in `Automattic/vip-go-mu-plugins`; projected dates remain visible only until an artifact containing the PR reaches that channel.

The current-channel cards show the live branch tip, latest release, RTC plugin version, and RTC Gutenberg build selected for staging and production.

## Local Development

```bash
npm test
npm run refresh
npm run start
```

Then open <http://127.0.0.1:4173/>.

## Data Refresh

`npm run refresh` writes `data/pr-release-timeline.json` from:

- merged Gutenberg PRs carrying `[Feature] Real-time Collaboration`;
- Gutenberg releases and `changelog.txt`;
- first-parent staging and production release history in `Automattic/vip-go-mu-plugins` from January 27, 2026 onward;
- the exact `Automattic/vip-go-mu-plugins-ext` artifact snapshot available at each VIP release.

The refresh fails when current channel state or the newest channel release artifact cannot be resolved. A historical branch release whose selected artifact was not yet available remains in the history as `unavailable-at-release` and does not replace any projected PR marker. A PR that simply has not shipped also keeps its projected VIP dates.

## GitHub Pages

`.github/workflows/pages.yml` runs tests, regenerates the complete dataset, and deploys the static site on pushes to `main`, manual dispatches, and every hour on the hour. New channel commits and releases therefore appear without source edits.
