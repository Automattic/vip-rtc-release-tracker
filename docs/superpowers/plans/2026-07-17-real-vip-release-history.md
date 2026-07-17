# Real VIP Release History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inferred VIP release dates with verifiable staging and production history while keeping unreleased projections and refreshing live channel state during every Pages build.

> **Implementation finding:** Live verification found that staging release `v20260602.1` selected `gutenberg-0.2-20260525` before that artifact reached the artifact repository. The implementation retains such historical branch releases as `unavailable-at-release`, does not map their PRs as shipped, and continues to fail when the newest release on either channel cannot resolve.

**Architecture:** Add a pure release-history library for parsing and PR mapping, plus an injected GitHub source module that walks first-parent release history and resolves the exact external artifact snapshot available at each release. The existing generator will merge actual events into projected PR schedules, and the static client will render current-channel cards and richer actual-release tooltips.

**Tech Stack:** Node.js 22, ECMAScript modules, built-in `node:test`, GitHub REST/GraphQL APIs, vanilla HTML/CSS/JavaScript, GitHub Actions and Pages.

## Global Constraints

- Release history starts at `2026-01-27T00:00:00Z` and includes only channel releases carrying both staged RTC constants.
- Keep the existing Gutenberg RC, GA, changelog mapping, and fallback projection behavior unchanged.
- Preserve projected VIP markers until a resolved artifact proves that a PR shipped on that channel.
- Use Node's built-in test runner and add no runtime or development dependencies.
- Use `GITHUB_TOKEN` for all GitHub API requests; require no additional secret.
- Resolve reused artifact folders from the newest artifact commit at or before each channel release, never from today's default-branch contents.
- Fail generation for missing current channel state, malformed staged constants, unresolved artifacts, or incomplete actual release metadata.
- Add no database, separate service, or second schedule; the existing Pages refresh remains the sole build path.

## File Structure

- Create `scripts/lib/vip-release-history.mjs`: pure parsers, artifact selection, release mapping, and channel-state normalization.
- Create `scripts/lib/vip-release-source.mjs`: GitHub branch walking and historical artifact resolution through injected clients.
- Create `test/vip-release-history.test.mjs`: unit tests for pure history logic.
- Create `test/vip-release-source.test.mjs`: unit tests for API orchestration with in-memory fixtures.
- Create `test/generated-data.test.mjs`: contract tests for the checked-in generated JSON.
- Create `render-helpers.mjs`: browser-safe pure HTML and marker helpers shared by the UI tests and `app.js`.
- Create `test/render-helpers.test.mjs`: unit tests for current-channel cards, actual tooltips, links, and event spans.
- Create `test/pages-build.test.mjs`: build-contract tests for workflow testing and Pages asset copying.
- Modify `scripts/fetch-data.mjs`: invoke VIP collection, attach HTTP status to errors, merge actual events, and emit the new data fields.
- Modify `data/pr-release-timeline.json`: refreshed generated data containing live channels and actual history.
- Modify `app.js`: render channel state, actual metadata, release links, and pre-merge event spans.
- Modify `index.html`: add the current-channel region and clarify the legend.
- Modify `styles.css`: style responsive channel cards.
- Modify `package.json`: add the built-in test command.
- Modify `.github/workflows/pages.yml`: run tests before refresh and publish `render-helpers.mjs`.
- Modify `README.md`: document actual history, projections, data sources, tests, and automatic refresh.

---

### Task 1: Pure release and artifact parsers

**Files:**
- Create: `scripts/lib/vip-release-history.mjs`
- Create: `test/vip-release-history.test.mjs`
- Modify: `package.json:6-9`

**Interfaces:**
- Produces: `HISTORY_START`, `parseReleaseName(channel, message)`, `parseRtcVersions(contents)`, `parseGutenbergVersion(contents)`, `extractArtifactPrNumbers(changelog, buildVersion)`, and `artifactCandidatesAt(commits, releasedAt)`.
- Consumes: no project modules.

- [ ] **Step 1: Add the test command and write failing parser tests**

Update `package.json` scripts to:

```json
"scripts": {
  "refresh": "node scripts/fetch-data.mjs",
  "start": "python3 -m http.server 4173",
  "test": "node --test test/*.test.mjs"
}
```

Create `test/vip-release-history.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HISTORY_START,
	artifactCandidatesAt,
	extractArtifactPrNumbers,
	parseGutenbergVersion,
	parseReleaseName,
	parseRtcVersions,
} from '../scripts/lib/vip-release-history.mjs';

test('uses the staged rollout cutoff', () => {
	assert.equal(HISTORY_START, '2026-01-27T00:00:00.000Z');
});

test('parses release names from subjects and merge bodies', () => {
	assert.equal(
		parseReleaseName('production', 'Production release: v20260623.0 (#7059)'),
		'v20260623.0'
	);
	assert.equal(
		parseReleaseName(
			'staging',
			'Merge pull request #7109 from Automattic/develop\n\nStaging release: v20260714.1'
		),
		'v20260714.1'
	);
	assert.equal(parseReleaseName('staging', 'Production release: v20260714.0'), null);
	assert.throws(
		() => parseReleaseName('staging', 'Staging release: July 14'),
		/Malformed staging release message/
	);
});

test('parses both staged RTC constants and ignores pre-constant files', () => {
	assert.deepEqual(
		parseRtcVersions(`
			const VIP_RTC_PLUGIN_VERSION = '0.3';
			const VIP_RTC_GUTENBERG_VERSION = '0.2-20260706-pr79021';
		`),
		{
			rtcPluginVersion: '0.3',
			gutenbergBuildVersion: '0.2-20260706-pr79021',
		}
	);
	assert.equal(parseRtcVersions('<?php class LegacyIntegration {}'), null);
	assert.throws(
		() => parseRtcVersions("const VIP_RTC_PLUGIN_VERSION = '0.3';"),
		/Missing VIP_RTC_GUTENBERG_VERSION/
	);
});

test('parses packaged Gutenberg versions', () => {
	assert.equal(parseGutenbergVersion(' * Version: 23.6.0-rc.1\n'), '23.6.0-rc.1');
	assert.throws(() => parseGutenbergVersion('<?php'), /Gutenberg Version header/);
});

test('extracts changelog and explicit custom-build PRs', () => {
	const changelog = [
		'https://github.com/WordPress/gutenberg/pull/79021',
		'https://github.com/WordPress/gutenberg/pull/79911',
		'https://github.com/WordPress/gutenberg/pull/79911',
	].join('\n');
	assert.deepEqual(
		extractArtifactPrNumbers(changelog, '0.2-20260706-pr79021'),
		[79021, 79911]
	);
});

test('orders artifact snapshots newest-first at a release timestamp', () => {
	const commits = [
		{ sha: 'future', committedAt: '2026-03-01T00:00:00Z' },
		{ sha: 'current', committedAt: '2026-02-10T00:00:00Z' },
		{ sha: 'older', committedAt: '2026-02-03T00:00:00Z' },
	];
	assert.deepEqual(
		artifactCandidatesAt(commits, '2026-02-12T00:00:00Z').map(({ sha }) => sha),
		['current', 'older']
	);
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `npm test`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/vip-release-history.mjs`.

- [ ] **Step 3: Implement the pure parsers**

Create `scripts/lib/vip-release-history.mjs`:

```js
export const HISTORY_START = '2026-01-27T00:00:00.000Z';

const channelLabels = {
	production: 'Production',
	staging: 'Staging',
};

export function parseReleaseName(channel, message) {
	const label = channelLabels[channel];
	if (!label) {
		throw new Error(`Unsupported VIP channel: ${channel}`);
	}
	if (!message.includes(`${label} release:`)) {
		return null;
	}
	const match = message.match(new RegExp(`${label} release: (v\\d{8}\\.\\d+)`));
	if (!match) {
		throw new Error(`Malformed ${channel} release message`);
	}
	return match[1];
}

export function parseRtcVersions(contents) {
	const rtcPluginVersion = contents.match(
		/const VIP_RTC_PLUGIN_VERSION = '([^']+)'/
	)?.[1];
	const gutenbergBuildVersion = contents.match(
		/const VIP_RTC_GUTENBERG_VERSION = '([^']+)'/
	)?.[1];

	if (!rtcPluginVersion && !gutenbergBuildVersion) {
		return null;
	}
	if (!rtcPluginVersion) {
		throw new Error('Missing VIP_RTC_PLUGIN_VERSION');
	}
	if (!gutenbergBuildVersion) {
		throw new Error('Missing VIP_RTC_GUTENBERG_VERSION');
	}

	return { rtcPluginVersion, gutenbergBuildVersion };
}

export function parseGutenbergVersion(contents) {
	const version = contents.match(/^ \* Version:\s*(\S+)/m)?.[1];
	if (!version) {
		throw new Error('Missing Gutenberg Version header');
	}
	return version;
}

export function extractArtifactPrNumbers(changelog, buildVersion) {
	const numbers = [
		...changelog.matchAll(
			/github\.com\/WordPress\/gutenberg\/pull\/(\d+)/g
		),
	].map((match) => Number(match[1]));
	for (const match of buildVersion.matchAll(/(?:^|-)pr(\d+)(?=-|$)/g)) {
		numbers.push(Number(match[1]));
	}
	return [...new Set(numbers)].sort((a, b) => a - b);
}

export function artifactCandidatesAt(commits, releasedAt) {
	const cutoff = new Date(releasedAt).getTime();
	return commits
		.filter((commit) => new Date(commit.committedAt).getTime() <= cutoff)
		.sort(
			(a, b) =>
				new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime()
		);
}
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run: `npm test`

Expected: PASS, 6 tests and 0 failures.

- [ ] **Step 5: Commit the parser unit**

```bash
git add package.json scripts/lib/vip-release-history.mjs test/vip-release-history.test.mjs
git commit -m "test: add VIP release history parsers"
```

---

### Task 2: Actual release mapping and channel state

**Files:**
- Modify: `scripts/lib/vip-release-history.mjs`
- Modify: `test/vip-release-history.test.mjs`

**Interfaces:**
- Consumes: normalized events with `{ channel, name, sha, url, date, rtcPluginVersion, gutenbergBuildVersion, artifact }`.
- Produces: `applyActualVipReleases(prs, events)` and `buildChannelState(channel, tip, versions, events)`.

- [ ] **Step 1: Write failing mapping tests**

Replace the existing import from `vip-release-history.mjs` with this combined import:

```js
import {
	applyActualVipReleases,
	HISTORY_START,
	artifactCandidatesAt,
	buildChannelState,
	extractArtifactPrNumbers,
	parseGutenbergVersion,
	parseReleaseName,
	parseRtcVersions,
} from '../scripts/lib/vip-release-history.mjs';
```

Then append:

```js

const projectedPr = {
	number: 79021,
	mergedAt: '2026-07-20T00:00:00Z',
	release: {
		vipStaging: { date: '2026-07-28T12:00:00Z', projected: true },
		vipProduction: { date: '2026-08-04T12:00:00Z', projected: true },
	},
};

const actualEvents = [
	{
		channel: 'staging',
		name: 'v20260707.0',
		sha: 'staging-old',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/staging-old',
		date: '2026-07-07T17:39:27Z',
		rtcPluginVersion: '0.3',
		gutenbergBuildVersion: '0.2-20260706-pr79021',
		artifact: {
			sha: 'artifact-old',
			url: 'https://github.com/Automattic/vip-go-mu-plugins-ext/commit/artifact-old',
			gutenbergVersion: '23.5.0',
			prNumbers: [79021],
		},
	},
	{
		channel: 'staging',
		name: 'v20260714.1',
		sha: 'staging-new',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/staging-new',
		date: '2026-07-14T17:34:40Z',
		rtcPluginVersion: '0.3',
		gutenbergBuildVersion: '0.2-20260706-pr79021',
		artifact: {
			sha: 'artifact-old',
			url: 'https://github.com/Automattic/vip-go-mu-plugins-ext/commit/artifact-old',
			gutenbergVersion: '23.5.0',
			prNumbers: [79021],
		},
	},
];

test('uses the earliest actual channel release even before upstream merge', () => {
	const [mapped] = applyActualVipReleases([projectedPr], actualEvents);
	assert.deepEqual(mapped.release.vipStaging, {
		date: '2026-07-07T17:39:27Z',
		projected: false,
		releaseName: 'v20260707.0',
		commitSha: 'staging-old',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/staging-old',
		rtcPluginVersion: '0.3',
		gutenbergBuildVersion: '0.2-20260706-pr79021',
		gutenbergVersion: '23.5.0',
		artifactSha: 'artifact-old',
	});
	assert.equal(mapped.release.vipProduction.projected, true);
});

test('retains both projected markers when no actual artifact contains the PR', () => {
	const [mapped] = applyActualVipReleases(
		[{ ...projectedPr, number: 80000 }],
		actualEvents
	);
	assert.equal(mapped.release.vipStaging.projected, true);
	assert.equal(mapped.release.vipProduction.projected, true);
});

test('builds current channel state from the tip and newest release event', () => {
	assert.deepEqual(
		buildChannelState(
			'staging',
			{
				sha: 'tip-sha',
				url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/tip-sha',
				committedAt: '2026-07-14T17:34:40Z',
			},
			{
				rtcPluginVersion: '0.3',
				gutenbergBuildVersion: '0.2-20260706-pr79021',
			},
			actualEvents
		),
		{
			channel: 'staging',
			tip: {
				sha: 'tip-sha',
				url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/tip-sha',
				committedAt: '2026-07-14T17:34:40Z',
			},
			latestRelease: {
				name: 'v20260714.1',
				sha: 'staging-new',
				url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/staging-new',
				date: '2026-07-14T17:34:40Z',
			},
			rtcPluginVersion: '0.3',
			gutenbergBuildVersion: '0.2-20260706-pr79021',
		}
	);
});

test('rejects incomplete actual release metadata', () => {
	assert.throws(
		() => applyActualVipReleases([projectedPr], [{ ...actualEvents[0], url: null }]),
		/Incomplete actual staging release v20260707.0/
	);
});
```

- [ ] **Step 2: Run the mapping tests and verify RED**

Run: `npm test`

Expected: FAIL because `applyActualVipReleases` and `buildChannelState` are not exported.

- [ ] **Step 3: Implement release mapping and channel state**

Append to `scripts/lib/vip-release-history.mjs`:

```js
const channelFields = {
	production: 'vipProduction',
	staging: 'vipStaging',
};

function assertCompleteEvent(event) {
	const required = [
		'name',
		'sha',
		'url',
		'date',
		'rtcPluginVersion',
		'gutenbergBuildVersion',
	];
	if (
		required.some((key) => !event[key]) ||
		!event.artifact?.sha ||
		!event.artifact?.gutenbergVersion ||
		!Array.isArray(event.artifact?.prNumbers)
	) {
		throw new Error(
			`Incomplete actual ${event.channel} release ${event.name || 'unknown'}`
		);
	}
}

function actualMarker(event) {
	assertCompleteEvent(event);
	return {
		date: event.date,
		projected: false,
		releaseName: event.name,
		commitSha: event.sha,
		url: event.url,
		rtcPluginVersion: event.rtcPluginVersion,
		gutenbergBuildVersion: event.gutenbergBuildVersion,
		gutenbergVersion: event.artifact.gutenbergVersion,
		artifactSha: event.artifact.sha,
	};
}

export function applyActualVipReleases(prs, events) {
	for (const event of events) {
		assertCompleteEvent(event);
	}
	return prs.map((pr) => {
		const release = { ...pr.release };
		for (const [channel, field] of Object.entries(channelFields)) {
			const first = events
				.filter(
					(event) =>
						event.channel === channel &&
						event.artifact.prNumbers.includes(pr.number)
				)
				.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
			if (first) {
				release[field] = actualMarker(first);
			}
		}
		return { ...pr, release };
	});
}

export function buildChannelState(channel, tip, versions, events) {
	const latest = events
		.filter((event) => event.channel === channel)
		.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
	if (!latest) {
		throw new Error(`No staged RTC release found for ${channel}`);
	}
	return {
		channel,
		tip,
		latestRelease: {
			name: latest.name,
			sha: latest.sha,
			url: latest.url,
			date: latest.date,
		},
		...versions,
	};
}
```

- [ ] **Step 4: Run the mapping tests and verify GREEN**

Run: `npm test`

Expected: PASS, 10 tests and 0 failures.

- [ ] **Step 5: Commit the mapping unit**

```bash
git add scripts/lib/vip-release-history.mjs test/vip-release-history.test.mjs
git commit -m "feat: map actual VIP releases to RTC PRs"
```

---

### Task 3: GitHub release-history and artifact source

**Files:**
- Create: `scripts/lib/vip-release-source.mjs`
- Create: `test/vip-release-source.test.mjs`

**Interfaces:**
- Consumes: injected `github(path)` and `fetchText(url)` functions with thrown errors carrying `status`.
- Produces: `collectChannelHistory({ channel, github, historyStart, commitCache })`, `resolveArtifactForEvent({ event, github, fetchText, folderChangesCache, artifactCache })`, and `collectVipReleaseData({ github, fetchText, historyStart })`.

- [ ] **Step 1: Write failing source tests with in-memory GitHub fixtures**

Create `test/vip-release-source.test.mjs` with fixtures for:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectChannelHistory,
	resolveArtifactForEvent,
} from '../scripts/lib/vip-release-source.mjs';

const encode = (value) => Buffer.from(value).toString('base64');

function fakeGithub(routes) {
	return async (path) => {
		if (!routes.has(path)) {
			const error = new Error(`Missing fixture: ${path}`);
			error.status = 404;
			throw error;
		}
		return routes.get(path);
	};
}

test('walks first parents and ignores releases before both constants exist', async () => {
	const integration = encode(`
		const VIP_RTC_PLUGIN_VERSION = '0.3';
		const VIP_RTC_GUTENBERG_VERSION = '0.2-20260706-pr79021';
	`);
	const routes = new Map([
		['repos/Automattic/vip-go-mu-plugins/branches/staging', { commit: { sha: 'tip' } }],
		['repos/Automattic/vip-go-mu-plugins/commits/tip', {
			sha: 'tip',
			html_url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/tip',
			commit: {
				committer: { date: '2026-07-14T17:34:40Z' },
				message: 'Staging release: v20260714.1',
			},
			parents: [{ sha: 'legacy' }],
		}],
		['repos/Automattic/vip-go-mu-plugins/commits/legacy', {
			sha: 'legacy',
			html_url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/legacy',
			commit: {
				committer: { date: '2026-01-27T20:46:38Z' },
				message: 'Staging release: v20260127.1',
			},
			parents: [{ sha: 'before-cutoff' }],
		}],
		['repos/Automattic/vip-go-mu-plugins/commits/before-cutoff', {
			sha: 'before-cutoff',
			html_url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/before-cutoff',
			commit: {
				committer: { date: '2026-01-26T23:59:59Z' },
				message: 'older',
			},
			parents: [],
		}],
		['repos/Automattic/vip-go-mu-plugins/contents/integrations/real-time-collaboration.php?ref=tip', {
			content: integration,
		}],
		['repos/Automattic/vip-go-mu-plugins/contents/integrations/real-time-collaboration.php?ref=legacy', {
			content: encode('<?php class LegacyIntegration {}'),
		}],
	]);

	const result = await collectChannelHistory({
		channel: 'staging',
		github: fakeGithub(routes),
	});
	assert.equal(result.events.length, 1);
	assert.equal(result.events[0].name, 'v20260714.1');
	assert.equal(result.tip.sha, 'tip');
	assert.equal(result.versions.gutenbergBuildVersion, '0.2-20260706-pr79021');
});

test('resolves the newest artifact snapshot available at release time', async () => {
	const folder = 'vip-integrations/gutenberg-0.2';
	const route = `repos/Automattic/vip-go-mu-plugins-ext/commits?path=${encodeURIComponent(folder)}&per_page=100`;
	const routes = new Map([
		[route, [
			{ sha: 'future', commit: { committer: { date: '2026-03-01T00:00:00Z' } } },
			{ sha: 'chosen', commit: { committer: { date: '2026-02-10T00:00:00Z' } } },
		]],
		[`repos/Automattic/vip-go-mu-plugins-ext/contents/${folder}/gutenberg.php?ref=chosen`, {
			content: encode(' * Version: 22.5.0\n'),
		}],
	]);
	const event = {
		channel: 'production',
		name: 'v20260217.0',
		sha: 'release-sha',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/release-sha',
		date: '2026-02-17T13:33:27Z',
		rtcPluginVersion: '0.2',
		gutenbergBuildVersion: '0.2',
	};
	const resolved = await resolveArtifactForEvent({
		event,
		github: fakeGithub(routes),
		fetchText: async (url) => {
			assert.equal(
				url,
				`https://raw.githubusercontent.com/Automattic/vip-go-mu-plugins-ext/chosen/${folder}/changelog.txt`
			);
			return 'https://github.com/WordPress/gutenberg/pull/70000';
		},
		folderChangesCache: new Map(),
		artifactCache: new Map(),
	});
	assert.deepEqual(resolved.artifact, {
		sha: 'chosen',
		url: 'https://github.com/Automattic/vip-go-mu-plugins-ext/commit/chosen',
		committedAt: '2026-02-10T00:00:00Z',
		gutenbergVersion: '22.5.0',
		prNumbers: [70000],
	});
});

test('deduplicates a reused artifact folder and commit across release events', async () => {
	const folder = 'vip-integrations/gutenberg-0.2';
	const route = `repos/Automattic/vip-go-mu-plugins-ext/commits?path=${encodeURIComponent(folder)}&per_page=100`;
	let changelogFetches = 0;
	const routes = new Map([
		[route, [
			{ sha: 'shared', commit: { committer: { date: '2026-02-10T00:00:00Z' } } },
		]],
		[`repos/Automattic/vip-go-mu-plugins-ext/contents/${folder}/gutenberg.php?ref=shared`, {
			content: encode(' * Version: 22.5.0\n'),
		}],
	]);
	const caches = {
		folderChangesCache: new Map(),
		artifactCache: new Map(),
	};
	const baseEvent = {
		name: 'v20260217.0',
		sha: 'release-sha',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/release-sha',
		date: '2026-02-17T13:33:27Z',
		rtcPluginVersion: '0.2',
		gutenbergBuildVersion: '0.2',
	};
	const github = fakeGithub(routes);
	const fetchText = async () => {
		changelogFetches += 1;
		return 'https://github.com/WordPress/gutenberg/pull/70000';
	};

	await resolveArtifactForEvent({
		event: { ...baseEvent, channel: 'staging' },
		github,
		fetchText,
		...caches,
	});
	await resolveArtifactForEvent({
		event: { ...baseEvent, channel: 'production' },
		github,
		fetchText,
		...caches,
	});
	assert.equal(changelogFetches, 1);
});

test('rejects an artifact with no snapshot available by release time', async () => {
	const folder = 'vip-integrations/gutenberg-0.4';
	const route = `repos/Automattic/vip-go-mu-plugins-ext/commits?path=${encodeURIComponent(folder)}&per_page=100`;
	const routes = new Map([
		[route, [
			{ sha: 'future', commit: { committer: { date: '2026-03-01T00:00:00Z' } } },
		]],
	]);
	await assert.rejects(
		resolveArtifactForEvent({
			event: {
				channel: 'staging',
				name: 'v20260217.0',
				date: '2026-02-17T13:33:27Z',
				gutenbergBuildVersion: '0.4',
			},
			github: fakeGithub(routes),
			fetchText: async () => '',
			folderChangesCache: new Map(),
			artifactCache: new Map(),
		}),
		/Could not resolve vip-integrations\/gutenberg-0\.4 for staging v20260217\.0 at 2026-02-17T13:33:27Z/
	);
});
```

- [ ] **Step 2: Run source tests and verify RED**

Run: `npm test`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/vip-release-source.mjs`.

- [ ] **Step 3: Implement branch walking and artifact resolution**

Create `scripts/lib/vip-release-source.mjs` with these exact exports and behavior:

```js
import {
	HISTORY_START,
	artifactCandidatesAt,
	buildChannelState,
	extractArtifactPrNumbers,
	parseGutenbergVersion,
	parseReleaseName,
	parseRtcVersions,
} from './vip-release-history.mjs';

const muRepository = 'Automattic/vip-go-mu-plugins';
const extRepository = 'Automattic/vip-go-mu-plugins-ext';
const integrationPath = 'integrations/real-time-collaboration.php';

function decodeContent(file) {
	if (!file?.content) {
		throw new Error('GitHub contents response did not include base64 content');
	}
	return Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

async function integrationAt(github, ref) {
	const file = await github(
		`repos/${muRepository}/contents/${integrationPath}?ref=${ref}`
	);
	return decodeContent(file);
}

async function commitAt(github, sha, cache) {
	if (!cache.has(sha)) {
		cache.set(sha, github(`repos/${muRepository}/commits/${sha}`));
	}
	return cache.get(sha);
}

export async function collectChannelHistory({
	channel,
	github,
	historyStart = HISTORY_START,
	commitCache = new Map(),
}) {
	const branch = await github(`repos/${muRepository}/branches/${channel}`);
	const tipCommit = await commitAt(github, branch.commit.sha, commitCache);
	const tip = {
		sha: tipCommit.sha,
		url: tipCommit.html_url,
		committedAt: tipCommit.commit.committer.date,
	};
	const versions = parseRtcVersions(await integrationAt(github, tip.sha));
	if (!versions) {
		throw new Error(`Current ${channel} branch is missing staged RTC constants`);
	}

	const events = [];
	let sha = tip.sha;
	while (sha) {
		const commit = await commitAt(github, sha, commitCache);
		const date = commit.commit.committer.date;
		if (new Date(date) < new Date(historyStart)) {
			break;
		}
		const name = parseReleaseName(channel, commit.commit.message);
		if (name) {
			const releaseVersions = parseRtcVersions(await integrationAt(github, sha));
			if (releaseVersions) {
				events.push({
					channel,
					name,
					sha,
					url: commit.html_url,
					date,
					...releaseVersions,
				});
			}
		}
		sha = commit.parents[0]?.sha || null;
	}

	return { channel, tip, versions, events };
}

async function artifactFile(github, folder, name, ref) {
	return decodeContent(
		await github(
			`repos/${extRepository}/contents/${folder}/${name}?ref=${ref}`
		)
	);
}

export async function resolveArtifactForEvent({
	event,
	github,
	fetchText,
	folderChangesCache,
	artifactCache,
}) {
	const folder = `vip-integrations/gutenberg-${event.gutenbergBuildVersion}`;
	if (!folderChangesCache.has(folder)) {
		const path = encodeURIComponent(folder);
		folderChangesCache.set(
			folder,
			github(`repos/${extRepository}/commits?path=${path}&per_page=100`)
		);
	}
	const changes = await folderChangesCache.get(folder);
	const candidates = artifactCandidatesAt(
		changes.map((commit) => ({
			sha: commit.sha,
			committedAt: commit.commit.committer.date,
		})),
		event.date
	);

	for (const candidate of candidates) {
		const artifactKey = `${folder}@${candidate.sha}`;
		try {
			if (!artifactCache.has(artifactKey)) {
				artifactCache.set(
					artifactKey,
					(async () => {
						const gutenbergPhp = await artifactFile(
							github,
							folder,
							'gutenberg.php',
							candidate.sha
						);
						const changelogUrl = `https://raw.githubusercontent.com/${extRepository}/${candidate.sha}/${folder}/changelog.txt`;
						const changelog = await fetchText(changelogUrl);
						return {
							sha: candidate.sha,
							url: `https://github.com/${extRepository}/commit/${candidate.sha}`,
							committedAt: candidate.committedAt,
							gutenbergVersion: parseGutenbergVersion(gutenbergPhp),
							prNumbers: extractArtifactPrNumbers(
								changelog,
								event.gutenbergBuildVersion
							),
						};
					})()
				);
			}
			return {
				...event,
				artifact: await artifactCache.get(artifactKey),
			};
		} catch (error) {
			artifactCache.delete(artifactKey);
			if (error.status !== 404) {
				throw error;
			}
		}
	}

	throw new Error(
		`Could not resolve ${folder} for ${event.channel} ${event.name} at ${event.date}`
	);
}

export async function collectVipReleaseData({
	github,
	fetchText,
	historyStart = HISTORY_START,
}) {
	const commitCache = new Map();
	const histories = await Promise.all(
		['staging', 'production'].map((channel) =>
			collectChannelHistory({ channel, github, historyStart, commitCache })
		)
	);
	const folderChangesCache = new Map();
	const artifactCache = new Map();
	const releases = [];
	for (const event of histories.flatMap((history) => history.events)) {
		releases.push(
			await resolveArtifactForEvent({
				event,
				github,
				fetchText,
				folderChangesCache,
				artifactCache,
			})
		);
	}
	releases.sort((a, b) => new Date(a.date) - new Date(b.date));
	const channels = Object.fromEntries(
		histories.map((history) => [
			history.channel,
			buildChannelState(
				history.channel,
				history.tip,
				history.versions,
				releases
			),
		])
	);
	return { channels, releases };
}
```

- [ ] **Step 4: Run source tests and verify GREEN**

Run: `npm test`

Expected: PASS, 14 tests and 0 failures.

- [ ] **Step 5: Commit the injected GitHub source**

```bash
git add scripts/lib/vip-release-source.mjs test/vip-release-source.test.mjs
git commit -m "feat: collect historical VIP channel releases"
```

---

### Task 4: Integrate actual releases into generated data

**Files:**
- Create: `test/generated-data.test.mjs`
- Modify: `scripts/fetch-data.mjs:1-83,408-477`
- Modify: `data/pr-release-timeline.json`

**Interfaces:**
- Consumes: `collectVipReleaseData({ github, fetchText })` and `applyActualVipReleases(projectedItems, vip.releases)`.
- Produces: top-level `vipChannels`, `vipReleases`, updated `source` and `assumptions`, and enriched actual PR markers.

- [ ] **Step 1: Write the failing generated-data contract**

Create `test/generated-data.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const data = JSON.parse(
	await readFile(new URL('../data/pr-release-timeline.json', import.meta.url), 'utf8')
);

test('generated data includes live VIP channels and actual releases', () => {
	assert.deepEqual(Object.keys(data.vipChannels).sort(), ['production', 'staging']);
	assert.ok(data.vipReleases.length > 0);
	for (const channel of ['staging', 'production']) {
		assert.match(data.vipChannels[channel].tip.sha, /^[0-9a-f]{40}$/);
		assert.match(data.vipChannels[channel].latestRelease.name, /^v\d{8}\.\d+$/);
		assert.ok(data.vipChannels[channel].rtcPluginVersion);
		assert.ok(data.vipChannels[channel].gutenbergBuildVersion);
	}
	for (const release of data.vipReleases) {
		assert.match(release.name, /^v\d{8}\.\d+$/);
		assert.match(release.sha, /^[0-9a-f]{40}$/);
		assert.ok(['staging', 'production'].includes(release.channel));
		assert.ok(release.rtcPluginVersion);
		assert.ok(release.gutenbergBuildVersion);
		assert.match(release.artifact.sha, /^[0-9a-f]{40}$/);
		assert.ok(release.artifact.gutenbergVersion);
		assert.ok(Array.isArray(release.artifact.prNumbers));
	}
});

test('actual VIP markers include authoritative commit metadata', () => {
	const marker = data.prs
		.flatMap((pr) => [pr.release.vipStaging, pr.release.vipProduction])
		.find((candidate) => candidate && candidate.projected === false);
	assert.ok(marker);
	assert.match(marker.commitSha, /^[0-9a-f]{40}$/);
	assert.match(marker.url, /Automattic\/vip-go-mu-plugins\/commit/);
	assert.ok(marker.releaseName);
	assert.ok(marker.gutenbergBuildVersion);
});
```

- [ ] **Step 2: Run the data contract and verify RED**

Run: `npm test`

Expected: FAIL because the checked-in JSON has no `vipChannels` field.

- [ ] **Step 3: Attach HTTP status to client errors**

In both `fetchText` and `github` inside `scripts/fetch-data.mjs`, replace direct throws with status-bearing errors:

```js
if (!response.ok) {
	const error = new Error(`Could not fetch ${url}: HTTP ${response.status}`);
	error.status = response.status;
	throw error;
}
```

```js
if (!response.ok) {
	const error = new Error(
		`GitHub API ${response.status} for ${path}: ${await response.text()}`
	);
	error.status = response.status;
	throw error;
}
```

- [ ] **Step 4: Collect VIP data and merge actual markers**

Add imports at the top of `scripts/fetch-data.mjs`:

```js
import { applyActualVipReleases } from './lib/vip-release-history.mjs';
import { collectVipReleaseData } from './lib/vip-release-source.mjs';
```

Replace the bottom orchestration beginning with `const token = getToken();` with:

```js
const token = getToken();
const [prs, releases, changelog, vip] = await Promise.all([
	fetchPrs(),
	fetchReleases(),
	readChangelog(),
	collectVipReleaseData({ github, fetchText }),
]);
const sections = parseChangelog(changelog.text);
const cycles = buildReleaseCycles(releases);
const knownCycles = [...cycles.values()]
	.filter((cycle) => cycle.rc || cycle.ga)
	.sort((a, b) => compareVersions(a.version, b.version));
const latestCycle = knownCycles.at(-1);

const projectedItems = prs
	.map((pr) => {
		const mappedVersion = chooseReleaseVersion(pr.number, sections);
		const fallback = mappedVersion
			? { version: mappedVersion, source: 'changelog' }
			: inferCycleForMerge(knownCycles, latestCycle, pr.mergedAt);
		const schedule = scheduleFor(
			fallback.version,
			cycles,
			latestCycle,
			pr.mergedAt
		);
		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			author: pr.author,
			mergedAt: pr.mergedAt,
			mergeCommit: pr.mergeCommit,
			labels: pr.labels.nodes.map((node) => node.name),
			release: { ...schedule, source: fallback.source },
		};
	})
	.sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
const items = applyActualVipReleases(projectedItems, vip.releases);

const data = {
	generatedAt: now.toISOString(),
	source: {
		repository: `${owner}/${repo}`,
		label,
		changelog: changelog.source,
		releaseDocs:
			'https://github.com/WordPress/gutenberg/blob/trunk/docs/contributors/code/release/plugin-release.md',
		vipRepository: 'Automattic/vip-go-mu-plugins',
		vipArtifactsRepository: 'Automattic/vip-go-mu-plugins-ext',
		vipHistoryStart: '2026-01-27T00:00:00.000Z',
	},
	assumptions: [
		'Gutenberg RC and GA dates come from GitHub releases when available.',
		'Unreleased GA dates are projected as seven days after RC, matching the Gutenberg release documentation.',
		'Actual VIP staging and production dates come from first-parent channel release history and the artifact snapshot available at each release.',
		'VIP dates remain projected from the weekly cadence only until an actual channel artifact contains the PR.',
		'PR-to-release inclusion is read from Gutenberg changelog.txt; labeled PRs missing from the changelog are inferred from the nearest RC after merge, or projected to the next future cycle when no RC exists yet.',
	],
	vipChannels: vip.channels,
	vipReleases: vip.releases,
	prs: items,
	releases: knownCycles.map((cycle) =>
		scheduleFor(cycle.version, cycles, latestCycle)
	),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(
	`Wrote ${items.length} ${label} PRs and ${vip.releases.length} VIP releases to ${outputPath.replace(
		`${process.cwd()}/`,
		''
	)}`
);
```

- [ ] **Step 5: Refresh data and verify GREEN**

Run: `npm run refresh`

Expected: exit 0 and output matching `Wrote <count> [Feature] Real-time Collaboration PRs and <count> VIP releases to data/pr-release-timeline.json`.

Run: `npm test`

Expected: PASS, 16 tests and 0 failures.

- [ ] **Step 6: Commit generator integration and refreshed data**

```bash
git add scripts/fetch-data.mjs data/pr-release-timeline.json test/generated-data.test.mjs
git commit -m "feat: generate actual VIP release data"
```

---

### Task 5: Render current channels and actual release details

**Files:**
- Create: `render-helpers.mjs`
- Create: `test/render-helpers.test.mjs`
- Modify: `app.js:1-308`
- Modify: `index.html:38-47`
- Modify: `styles.css:37-45,126-165,411-end`

**Interfaces:**
- Consumes: `vipChannels`, actual VIP marker metadata, and the existing PR structure.
- Produces: `escapeHtml`, `renderChannelCards`, `vipMarkerTooltip`, `markerLink`, `isProjected`, and `eventSpan` for `app.js`.

- [ ] **Step 1: Write failing rendering-helper tests**

Create `test/render-helpers.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	eventSpan,
	isProjected,
	markerLink,
	renderChannelCards,
	vipMarkerTooltip,
} from '../render-helpers.mjs';

const channels = {
	staging: {
		channel: 'staging',
		tip: {
			sha: 'ce261cbc3f4c8ed3b7589fcaecfa7b777f4b1581',
			url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/ce261cbc3f4c8ed3b7589fcaecfa7b777f4b1581',
		},
		latestRelease: {
			name: 'v20260714.1',
			date: '2026-07-14T17:34:40Z',
		},
		rtcPluginVersion: '0.3',
		gutenbergBuildVersion: '0.2-20260706-pr79021',
	},
};

test('renders authoritative current-channel cards', () => {
	const html = renderChannelCards(channels, () => 'Jul 14, 2026');
	assert.match(html, /VIP staging/);
	assert.match(html, /ce261cb/);
	assert.match(html, /v20260714\.1/);
	assert.match(html, /0\.2-20260706-pr79021/);
});

test('renders and links actual VIP metadata', () => {
	const marker = {
		projected: false,
		releaseName: 'v20260714.1',
		commitSha: 'ce261cbc3f4c8ed3b7589fcaecfa7b777f4b1581',
		url: 'https://github.com/Automattic/vip-go-mu-plugins/commit/ce261cbc3f4c8ed3b7589fcaecfa7b777f4b1581',
		rtcPluginVersion: '0.3',
		gutenbergBuildVersion: '0.2-20260706-pr79021',
		gutenbergVersion: '23.5.0',
	};
	assert.match(vipMarkerTooltip(marker), /v20260714\.1/);
	assert.equal(markerLink({ url: 'https://example.test/pr' }, 'staging', marker), marker.url);
});

test('actual VIP metadata overrides an inferred Gutenberg projection', () => {
	const pr = {
		release: {
			source: 'projected',
			vipStaging: { projected: false },
			vipProduction: { projected: true },
		},
	};
	assert.equal(isProjected(pr, 'staging'), false);
	assert.equal(isProjected(pr, 'production'), true);
	assert.equal(isProjected(pr, 'ga'), true);
});

test('spans the earliest and latest event when a VIP release predates merge', () => {
	const values = {
		merge: new Date('2026-07-20T00:00:00Z'),
		staging: new Date('2026-07-07T00:00:00Z'),
		production: new Date('2026-07-28T00:00:00Z'),
	};
	assert.deepEqual(eventSpan(values), {
		first: values.staging,
		last: values.production,
	});
});
```

- [ ] **Step 2: Run rendering tests and verify RED**

Run: `npm test`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `render-helpers.mjs`.

- [ ] **Step 3: Implement browser-safe rendering helpers**

Create `render-helpers.mjs`:

```js
export function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => {
		const map = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#039;',
		};
		return map[char];
	});
}

export function renderChannelCards(channels, formatDate) {
	return ['staging', 'production']
		.filter((channel) => channels[channel])
		.map((channel) => {
			const state = channels[channel];
			return `<article class="channel-card ${channel}">
				<div class="channel-heading"><span>VIP ${channel}</span><strong>${escapeHtml(
					state.latestRelease.name
				)}</strong></div>
				<a href="${escapeHtml(state.tip.url)}" target="_blank" rel="noreferrer">${escapeHtml(
					state.tip.sha.slice(0, 7)
				)}</a>
				<span>${escapeHtml(formatDate(new Date(state.latestRelease.date)))}</span>
				<span>RTC ${escapeHtml(state.rtcPluginVersion)}</span>
				<code>${escapeHtml(state.gutenbergBuildVersion)}</code>
			</article>`;
		})
		.join('');
}

export function vipMarkerTooltip(marker) {
	if (!marker || marker.projected !== false) {
		return '';
	}
	return [
		marker.releaseName,
		marker.commitSha.slice(0, 7),
		`RTC ${marker.rtcPluginVersion}`,
		marker.gutenbergBuildVersion,
		`Gutenberg ${marker.gutenbergVersion}`,
	]
		.map((value) => `<br>${escapeHtml(value)}`)
		.join('');
}

export function markerLink(pr, type, marker) {
	if ((type === 'staging' || type === 'production') && marker?.projected === false) {
		return marker.url;
	}
	return pr.url;
}

export function isProjected(pr, type) {
	if (type === 'staging') {
		return Boolean(pr.release.vipStaging?.projected);
	}
	if (type === 'production') {
		return Boolean(pr.release.vipProduction?.projected);
	}
	if (pr.release.source === 'projected' && type !== 'merge') {
		return true;
	}
	if (type === 'ga') {
		return Boolean(pr.release.ga?.projected);
	}
	return false;
}

export function eventSpan(values) {
	const dates = Object.values(values).filter(Boolean).sort((a, b) => a - b);
	return { first: dates[0], last: dates.at(-1) };
}
```

- [ ] **Step 4: Update the document and application rendering**

Add after the summary section in `index.html`:

```html
<section class="channels" id="channels" aria-label="Current VIP channels"></section>
```

Change the projected-only control label to `Projected VIP only`, and change the two VIP legend labels to `VIP staging (actual)` and `VIP production (actual)`.

Add this import at the top of `app.js`:

```js
import {
	escapeHtml,
	eventSpan,
	isProjected,
	markerLink,
	renderChannelCards,
	vipMarkerTooltip,
} from './render-helpers.mjs';
```

Add `const channels = document.querySelector('#channels');` after the existing `summary` query. Delete the local `isProjected` and `escapeHtml` functions because they now come from the helper module.

In `visiblePrs`, replace the projected-only condition with:

```js
if (
	projectedOnly.checked &&
	!isProjected(pr, 'staging') &&
	!isProjected(pr, 'production')
) {
	return false;
}
```

Replace `renderSummary` with:

```js
function renderSummary(prs) {
	const releases = new Set(prs.map((pr) => pr.release.version));
	const actualVip = prs.filter(
		(pr) =>
			pr.release.vipStaging?.projected === false ||
			pr.release.vipProduction?.projected === false
	).length;
	const projectedVip = prs.filter(
		(pr) => isProjected(pr, 'staging') || isProjected(pr, 'production')
	).length;

	summary.innerHTML = [
		['PRs', prs.length],
		['Gutenberg releases', releases.size],
		['Actual VIP', actualVip],
		['Projected VIP', projectedVip],
	]
		.map(
			([label, value]) =>
				`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`
		)
		.join('');
}
```

In `tooltip`, add the VIP marker selection before the return and append its actual metadata:

```js
const marker =
	type === 'staging'
		? pr.release.vipStaging
		: type === 'production'
			? pr.release.vipProduction
			: null;
return `${projected}${names[type]}<br>${formatDate.format(value)}${
	tag ? `<br>${tag}` : ''
}${vipMarkerTooltip(marker)}`;
```

In `renderRow`, replace the row bar endpoints with:

```js
const markerValues = Object.fromEntries(
	['merge', 'rc', 'ga', 'staging', 'production'].map((type) => [
		type,
		markerDate(pr, type),
	])
);
const { first, last } = eventSpan(markerValues);
```

Still in `renderRow`, add the same marker selection before assigning `event.href`, then replace the link selection with:

```js
const marker =
	type === 'staging'
		? pr.release.vipStaging
		: type === 'production'
			? pr.release.vipProduction
			: null;
event.href =
	type === 'rc'
		? pr.release.rc?.url || pr.url
		: type === 'ga'
			? pr.release.ga?.url || pr.url
			: markerLink(pr, type, marker);
```

In `init`, immediately before `render();`, add:

```js
channels.innerHTML = renderChannelCards(data.vipChannels, (value) =>
	formatDate.format(value)
);
```

- [ ] **Step 5: Add responsive channel-card styles**

Add `.channels` to the shared panel selector and insert:

```css
.channels {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1px;
	margin-top: 14px;
	padding: 0;
	overflow: hidden;
	border-radius: 8px;
}

.channel-card {
	display: grid;
	grid-template-columns: auto auto 1fr auto;
	align-items: center;
	gap: 8px 14px;
	padding: 14px 16px;
	background: var(--panel);
	font-size: 13px;
}

.channel-card.staging {
	border-top: 3px solid var(--staging);
}

.channel-card.production {
	border-top: 3px solid var(--production);
}

.channel-heading {
	display: flex;
	align-items: baseline;
	gap: 8px;
}

.channel-heading span,
.channel-card > span {
	color: var(--muted);
}

.channel-card code {
	grid-column: 1 / -1;
	overflow-wrap: anywhere;
}
```

Inside the existing mobile media query add:

```css
.channels {
	grid-template-columns: 1fr;
}

.channel-card {
	grid-template-columns: 1fr auto;
}
```

- [ ] **Step 6: Run UI helper tests and verify GREEN**

Run: `npm test`

Expected: PASS, 20 tests and 0 failures.

- [ ] **Step 7: Commit the UI unit**

```bash
git add app.js index.html styles.css render-helpers.mjs test/render-helpers.test.mjs
git commit -m "feat: show current VIP release channels"
```

---

### Task 6: Enforce the build contract and document the data flow

**Files:**
- Create: `test/pages-build.test.mjs`
- Modify: `.github/workflows/pages.yml:28-48`
- Modify: `README.md:3-33`

**Interfaces:**
- Consumes: `npm test`, `npm run refresh`, and the new browser module.
- Produces: a Pages artifact containing every required static module and documentation of the automatic refresh behavior.

- [ ] **Step 1: Write the failing Pages build test**

Create `test/pages-build.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
	new URL('../.github/workflows/pages.yml', import.meta.url),
	'utf8'
);

test('Pages tests before refresh and publishes every browser module', () => {
	assert.match(workflow, /- name: Run tests\n\s+run: npm test/);
	assert.match(
		workflow,
		/cp index\.html app\.js render-helpers\.mjs styles\.css _site\//
	);
	assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('run: npm run refresh'));
});
```

- [ ] **Step 2: Run the Pages build test and verify RED**

Run: `npm test`

Expected: FAIL because the workflow has no test step and does not copy `render-helpers.mjs`.

- [ ] **Step 3: Update the Pages workflow**

Insert after Node setup:

```yaml
      - name: Run tests
        run: npm test
```

Change the static asset copy command to:

```yaml
          cp index.html app.js render-helpers.mjs styles.css _site/
```

- [ ] **Step 4: Rewrite README release and refresh documentation**

Update `README.md` to state:

```markdown
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

The refresh fails when current channel state or an actual artifact cannot be resolved. A PR that has not shipped is not an error and keeps its projected VIP dates.

## GitHub Pages

`.github/workflows/pages.yml` runs tests, regenerates the complete dataset, and deploys the static site on pushes to `main`, manual dispatches, and every hour on the hour. New channel commits and releases therefore appear without source edits.
```

- [ ] **Step 5: Run the complete automated verification**

Run: `npm test`

Expected: PASS, 21 tests and 0 failures.

Run: `npm run refresh`

Expected: exit 0 with nonzero PR and VIP release counts.

Run: `npm test`

Expected: PASS again against freshly generated data.

Run: `git diff --check`

Expected: no output and exit 0.

- [ ] **Step 6: Verify live branch parity from generated data**

Run:

```bash
node --input-type=module -e "import {readFile} from 'node:fs/promises'; import {execFileSync} from 'node:child_process'; const data=JSON.parse(await readFile('data/pr-release-timeline.json','utf8')); for (const channel of ['staging','production']) { const live=execFileSync('gh',['api',`repos/Automattic/vip-go-mu-plugins/branches/${channel}`,'--jq','.commit.sha'],{encoding:'utf8'}).trim(); if (data.vipChannels[channel].tip.sha !== live) throw new Error(`${channel} mismatch`); console.log(channel, live); }"
```

Expected: two lines containing `staging <40-character SHA>` and `production <40-character SHA>` with exit 0.

- [ ] **Step 7: Verify the rendered tracker locally**

Run: `npm run start`

Expected: the server listens on `http://127.0.0.1:4173/`.

Open the local page with the browser-control workflow and verify:

- staging and production cards are both present;
- their short SHAs match the generated JSON;
- at least one past PR has solid actual VIP markers whose links target `Automattic/vip-go-mu-plugins` commits;
- an unreleased PR retains projected marker styling;
- the Past 90 days, All, and Upcoming VIP dates windows still render without console errors;
- the layout remains readable at desktop width and below 760px.

- [ ] **Step 8: Commit the build contract and documentation**

```bash
git add .github/workflows/pages.yml README.md test/pages-build.test.mjs data/pr-release-timeline.json
git commit -m "ci: refresh real VIP releases during Pages builds"
```

- [ ] **Step 9: Run final branch verification before integration**

Run: `npm test && git diff --check && git status --short`

Expected: all 21 tests pass, diff check is clean, and `git status --short` has no output.
