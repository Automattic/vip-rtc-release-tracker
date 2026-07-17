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
