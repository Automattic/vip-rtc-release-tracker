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
