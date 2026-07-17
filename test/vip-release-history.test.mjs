import assert from 'node:assert/strict';
import test from 'node:test';

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
