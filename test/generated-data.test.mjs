import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rawData = await readFile(
	new URL('../data/pr-release-timeline.json', import.meta.url),
	'utf8'
);
const data = JSON.parse(rawData);

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
		if (release.artifact) {
			assert.match(release.artifact.sha, /^[0-9a-f]{40}$/);
			assert.ok(release.artifact.gutenbergVersion);
			assert.ok(Array.isArray(release.artifact.prNumbers));
		} else {
			assert.equal(release.artifactStatus, 'unavailable-at-release');
		}
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

test('every non-projected VIP marker has authoritative release metadata', () => {
	for (const pr of data.prs) {
		for (const marker of [pr.release.vipStaging, pr.release.vipProduction]) {
			if (marker?.projected === false) {
				assert.match(marker.commitSha, /^[0-9a-f]{40}$/);
				assert.ok(marker.releaseName);
				assert.match(marker.url, /Automattic\/vip-go-mu-plugins\/commit/);
			}
		}
	}
});

test('published artifact membership is scoped to tracked RTC PRs', () => {
	const tracked = new Set(data.prs.map((pr) => pr.number));
	for (const release of data.vipReleases.filter((event) => event.artifact)) {
		assert.ok(
			release.artifact.prNumbers.every((number) => tracked.has(number)),
			`${release.name} contains an unrelated Gutenberg PR`
		);
	}
	assert.ok(Buffer.byteLength(rawData) < 2_000_000, 'generated JSON exceeds 2 MB');
});
