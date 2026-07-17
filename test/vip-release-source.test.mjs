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

test('preserves a historical release whose artifact was unavailable at release time', async () => {
	const folder = 'vip-integrations/gutenberg-0.2-20260525';
	const route = `repos/Automattic/vip-go-mu-plugins-ext/commits?path=${encodeURIComponent(folder)}&per_page=100`;
	const routes = new Map([
		[route, [
			{ sha: 'later', commit: { committer: { date: '2026-06-08T17:42:35Z' } } },
		]],
	]);
	const event = {
		channel: 'staging',
		name: 'v20260602.1',
		date: '2026-06-02T19:14:10Z',
		gutenbergBuildVersion: '0.2-20260525',
	};
	const result = await resolveArtifactForEvent({
		event,
		github: fakeGithub(routes),
		fetchText: async () => '',
		folderChangesCache: new Map(),
		artifactCache: new Map(),
		allowUnavailable: true,
	});
	assert.deepEqual(result, {
		...event,
		artifact: null,
		artifactStatus: 'unavailable-at-release',
	});
});
