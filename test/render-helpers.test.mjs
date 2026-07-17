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
