# Real VIP Release History Design

## Summary

The tracker currently derives VIP staging and production dates from an assumed weekly schedule. It will instead supplement those projections with authoritative release history from the `staging` and `production` branches of `Automattic/vip-go-mu-plugins`.

Every data refresh will rebuild actual RTC release history from January 27, 2026 onward, resolve the RTC and Gutenberg artifacts that were deployed in each release, assign each tracked Gutenberg PR its first actual staging and production release, and record the live branch tips for both channels. The existing hourly and manual GitHub Pages build will perform this work automatically.

## Goals

- Show the current `vip-go-mu-plugins` commit deployed to staging and production.
- Show the RTC plugin and RTC Gutenberg build selected by each current channel.
- Preserve actual staging and production release history beginning at `2026-01-27T00:00:00Z`, when staged RTC version constants were introduced.
- Replace a PR's projected VIP marker with its first verifiable actual release marker for each channel.
- Retain projections for PRs that have not yet appeared in an actual channel release.
- Refresh all current and historical release information during every Pages build without a database or manually maintained release list.
- Fail the build rather than publish incomplete or internally inconsistent current release data.

## Non-goals

- The tracker will not model RTC releases before January 27, 2026 because those commits do not expose comparable staged version constants.
- It will not change how Gutenberg RC, GA, or PR-to-Gutenberg-release membership is determined.
- It will not track non-RTC changes in either VIP repository.
- It will not create a separate service, scheduled job, or persistent datastore.

## Authoritative Data Sources

The generator will use the authenticated GitHub API and raw GitHub content for all release information:

1. `Automattic/vip-go-mu-plugins`
   - Current `staging` and `production` branch tips.
   - First-parent history for those branches.
   - Release commit messages such as `Staging release: v20260714.1` and `Production release: v20260714.0`.
   - `integrations/real-time-collaboration.php` at each release commit, which supplies `VIP_RTC_PLUGIN_VERSION` and `VIP_RTC_GUTENBERG_VERSION`.
2. `Automattic/vip-go-mu-plugins-ext`
   - The artifact history for `vip-integrations/gutenberg-<VIP_RTC_GUTENBERG_VERSION>`.
   - `gutenberg.php`, which supplies the packaged Gutenberg plugin version.
   - `changelog.txt`, which supplies the Gutenberg PRs contained in that artifact snapshot.
3. Existing Gutenberg sources
   - Merged PRs with the `[Feature] Real-time Collaboration` label.
   - Gutenberg releases and `changelog.txt`, as already used by the tracker.

## Architecture

### Release-history library

Create a focused module under `scripts/lib/` for pure parsing, normalization, and mapping logic. It will expose functions that:

- Recognize staging and production release messages in either a commit subject or body.
- Parse the two RTC version constants from the integration PHP file.
- Parse the packaged Gutenberg version from an artifact's `gutenberg.php` header.
- Extract Gutenberg PR numbers from an artifact changelog.
- Extract explicitly cherry-picked PR numbers from artifact names ending in forms such as `-pr79021`.
- Map release events and artifact contents to the first actual staging and production event for each tracked PR.

Keeping these operations pure allows complete unit testing without GitHub access. Network orchestration will remain in `scripts/fetch-data.mjs` or a small adjacent client module.

### VIP history collection

For each channel, the generator will:

1. Fetch the branch tip and record its SHA, URL, and commit timestamp.
2. Read the integration file at the tip to record the versions currently selected by that channel.
3. Walk the branch's first-parent chain until the next commit would be older than `2026-01-27T00:00:00Z`.
4. Select commits whose full message contains the appropriate staging or production release label.
5. Read the integration file at each selected commit. Ignore release commits that predate the presence of both staged RTC constants on that channel; this includes the January 27 production release, which occurred before the staged constants reached production.
6. Create a normalized release event for every selected commit that contains both constants:
   - channel;
   - release name;
   - full commit SHA and URL;
   - commit timestamp;
   - RTC plugin version;
   - RTC Gutenberg build version.

Commit details will be cached in memory by SHA during a refresh so overlapping history is not requested twice.

### Artifact resolution

Artifact folder names were historically reused, especially `gutenberg-0.2`, so resolving a folder from the current default branch would produce incorrect history. For each unique channel release event, the generator will:

1. List commits in `vip-go-mu-plugins-ext` that changed the selected artifact folder.
2. Choose the newest artifact commit at or before the channel release timestamp for which both `gutenberg.php` and `changelog.txt` exist.
3. Fetch `gutenberg.php` through the GitHub contents API and fetch the larger `changelog.txt` through its raw GitHub URL at that exact artifact commit.
4. Record the artifact commit SHA, packaged Gutenberg version, and contained Gutenberg PR numbers.
5. Add any explicit `-pr<number>` suffix from the artifact version to the contained PR set, covering custom cherry-picked builds.

Each unique `(artifact folder, artifact commit)` pair will be resolved once per refresh and shared by every channel event that used it.

If the newest release for either channel cannot resolve an artifact, generation stops with an error that names the channel release, artifact folder, and attempted timestamp. A historical branch release whose selected artifact was not yet available is retained with `artifactStatus: "unavailable-at-release"`; it cannot replace a projected PR marker. This models the observed June 2 staging release without inventing artifact contents or a ship date.

### PR release mapping

Release events will be sorted chronologically within each channel. A tracked PR's actual staging or production date is the earliest event whose resolved artifact contains that PR number. This permits a custom cherry-picked PR to have an actual VIP release date earlier than its eventual upstream merge date.

When an actual event exists, it replaces the corresponding projected `vipStaging` or `vipProduction` object. When no actual event contains the PR, the existing projection remains unchanged. Actual event metadata will include the release name, commit SHA and URL, RTC plugin version, RTC Gutenberg build version, packaged Gutenberg version, and `projected: false`.

Timeline bars will span the earliest and latest available marker rather than assuming the merge marker always precedes the VIP markers. This supports custom builds released before an upstream merge.

## Generated Data Shape

The generated JSON will retain the existing PR structure and add these top-level fields:

```json
{
  "vipChannels": {
    "staging": {
      "tip": {
        "sha": "full commit SHA",
        "url": "GitHub commit URL",
        "committedAt": "ISO timestamp"
      },
      "latestRelease": {
        "name": "vYYYYMMDD.N",
        "sha": "full release SHA",
        "url": "GitHub commit URL",
        "date": "ISO timestamp"
      },
      "rtcPluginVersion": "0.3",
      "gutenbergBuildVersion": "0.2-YYYYMMDD-prNNNN"
    },
    "production": {}
  },
  "vipReleases": []
}
```

Each entry in `vipReleases` will use the normalized release-event fields described above plus resolved artifact metadata. Each actual PR marker will copy the event fields it needs so the browser does not have to join records at render time.

The `source` and `assumptions` sections will identify both VIP repositories, the history cutoff, and the rule that actual markers come from branch and artifact history while unreleased markers remain projected.

## User Interface

Add a current-channel section near the existing summary. It will show one compact card each for staging and production with:

- current branch-tip short SHA linked to the full commit;
- most recent release name and date;
- selected RTC plugin version;
- selected RTC Gutenberg build version.

Existing timeline markers will remain visually consistent. Actual VIP markers will use the existing solid staging and production styles; projected markers will retain the projected treatment. Actual marker tooltips will add the VIP release name, short commit SHA, RTC version, Gutenberg build, and packaged Gutenberg version, and the marker will link to the release commit.

The legend and summary copy will distinguish actual releases from projections. Search and time-window behavior will continue to work with both kinds of markers.

## Build Integration

`npm run refresh` will perform Gutenberg collection, VIP release-history collection, artifact resolution, and JSON generation in one command. The Pages workflow already invokes this command for pushes, manual dispatches, and its hourly schedule, so current channel tips and new releases will be incorporated automatically.

The workflow will run `npm test` before generation. Both repositories are public, but all GitHub API calls will continue to use `GITHUB_TOKEN` to obtain authenticated rate limits. No additional secret is required.

## Error Handling

Generation will fail with a descriptive error when:

- a current branch cannot be read;
- the current integration file does not contain both expected constants;
- a historical release message cannot be normalized;
- the newest channel release's artifact snapshot cannot be resolved at the release timestamp;
- artifact metadata or changelog content cannot be parsed;
- an actual marker lacks its release commit metadata.

A tracked PR that simply has not appeared in an actual release is not an error; it retains its projected marker. Historical branch releases with no artifact available at their timestamp also retain projections and are explicitly marked in generated history.

## Testing

Use Node's built-in `node:test` runner to avoid new dependencies. Tests will cover:

- staging and production release messages in commit subjects and merge-commit bodies;
- RTC integration constant parsing;
- packaged Gutenberg version parsing;
- PR extraction from artifact changelogs and custom artifact suffixes;
- choosing the artifact snapshot that existed at a release timestamp;
- deduplicating artifact fetches for repeated channel releases while retaining every release event;
- assigning the earliest actual release per channel;
- preserving projections for unreleased PRs;
- a cherry-picked PR released before its upstream merge;
- rejecting unresolved or inconsistent actual release data.

After unit tests, verification will run a fresh data refresh, validate the generated JSON, start the static server, and inspect the rendered channel cards and representative actual and projected timeline markers.

## Acceptance Criteria

- Generated `vipChannels.staging.tip.sha` and `vipChannels.production.tip.sha` match the GitHub branch endpoints at refresh time.
- Generated history contains every staging and production release carrying both staged RTC constants since January 27, 2026.
- Every historical event records the RTC versions from that exact release commit and either artifact metadata from the snapshot available at that time or an explicit `unavailable-at-release` status.
- A tracked PR receives the earliest verifiable actual staging and production markers and retains projections only for channels where no actual release contains it.
- Current-channel cards and actual marker tooltips link to the authoritative commits.
- `npm test` and `npm run refresh` run successfully in the Pages workflow before deployment.
- The hourly workflow automatically reflects branch movement and new releases without source edits.
