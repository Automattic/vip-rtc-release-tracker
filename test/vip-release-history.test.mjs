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
