import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const owner = 'WordPress';
const repo = 'gutenberg';
const label = '[Feature] Real-time Collaboration';
const gutenbergDir =
	process.env.GUTENBERG_DIR ||
	resolve(projectRoot, '..', 'github', 'WordPress', 'gutenberg');
const changelogPath = resolve(gutenbergDir, 'changelog.txt');
const changelogUrl =
	process.env.GUTENBERG_CHANGELOG_URL ||
	`https://raw.githubusercontent.com/${owner}/${repo}/trunk/changelog.txt`;
const outputPath = resolve(projectRoot, 'data', 'pr-release-timeline.json');

const now = new Date();

function getToken() {
	if (process.env.GITHUB_TOKEN) {
		return process.env.GITHUB_TOKEN;
	}

	try {
		return execFileSync('gh', ['auth', 'token'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		throw new Error(
			'Set GITHUB_TOKEN or authenticate with `gh auth login` before refreshing data.'
		);
	}
}

async function fetchText(url) {
	const response = await fetch(url, {
		headers: token
			? {
					Authorization: `Bearer ${token}`,
			  }
			: {},
	});

	if (!response.ok) {
		throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
	}

	return response.text();
}

async function github(path, options = {}) {
	const response = await fetch(`https://api.github.com/${path}`, {
		...options,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(options.headers || {}),
		},
	});

	if (!response.ok) {
		throw new Error(
			`GitHub API ${response.status} for ${path}: ${await response.text()}`
		);
	}

	return response.json();
}

async function graphql(query, variables) {
	return github('graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ query, variables }),
	});
}

async function fetchPrs() {
	const query = `
		query($owner:String!, $repo:String!, $label:String!, $cursor:String) {
			repository(owner:$owner, name:$repo) {
				pullRequests(
					first: 100
					labels: [$label]
					states: MERGED
					after: $cursor
					orderBy: { field: UPDATED_AT, direction: DESC }
				) {
					pageInfo { hasNextPage endCursor }
					nodes {
						number
						title
						url
						mergedAt
						createdAt
						mergeCommit { oid committedDate }
						author { login url }
						labels(first: 30) { nodes { name } }
					}
				}
			}
		}
	`;

	const prs = [];
	let cursor = null;
	do {
		const result = await graphql(query, { owner, repo, label, cursor });
		const page = result.data.repository.pullRequests;
		prs.push(...page.nodes);
		cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
	} while (cursor);

	return prs;
}

async function fetchReleases() {
	const releases = [];
	for (let page = 1; ; page++) {
		const batch = await github(
			`repos/${owner}/${repo}/releases?per_page=100&page=${page}`
		);
		if (!batch.length) {
			break;
		}
		releases.push(...batch);
	}

	return releases
		.filter((release) => /^\d|^v\d/.test(release.tag_name))
		.map((release) => ({
			name: release.name || release.tag_name,
			tagName: release.tag_name,
			url: release.html_url,
			publishedAt: release.published_at,
			createdAt: release.created_at,
			prerelease: release.prerelease,
		}));
}

function parseVersion(version) {
	const normalized = version.replace(/^v/, '');
	const match = normalized.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/
	);
	if (!match) {
		return null;
	}

	return {
		version: normalized,
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		rc: match[4] ? Number(match[4]) : null,
		base: `${match[1]}.${match[2]}.${match[3]}`,
	};
}

function compareVersions(a, b) {
	const parsedA = parseVersion(a);
	const parsedB = parseVersion(b);
	for (const key of ['major', 'minor', 'patch']) {
		if (parsedA[key] !== parsedB[key]) {
			return parsedA[key] - parsedB[key];
		}
	}
	if (parsedA.rc === parsedB.rc) {
		return 0;
	}
	if (parsedA.rc === null) {
		return 1;
	}
	if (parsedB.rc === null) {
		return -1;
	}
	return parsedA.rc - parsedB.rc;
}

function addDays(date, days) {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function nextTuesdayAfter(date) {
	const next = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)
	);
	const day = next.getUTCDay();
	let days = (2 - day + 7) % 7;
	if (days === 0) {
		days = 7;
	}
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function iso(date) {
	return date ? date.toISOString() : null;
}

async function readChangelog() {
	if (existsSync(changelogPath)) {
		return {
			text: readFileSync(changelogPath, 'utf8'),
			source: changelogPath,
		};
	}

	return {
		text: await fetchText(changelogUrl),
		source: changelogUrl,
	};
}

function parseChangelog(text) {
	const sections = [];
	const headingPattern = /^= ([\d.]+(?:-rc\.\d+)?) =$/gm;
	const headings = [...text.matchAll(headingPattern)];

	for (let index = 0; index < headings.length; index++) {
		const heading = headings[index];
		const version = heading[1];
		const start = heading.index + heading[0].length;
		const end = headings[index + 1]?.index ?? text.length;
		const body = text.slice(start, end);
		const prs = [
			...new Set(
				[...body.matchAll(/github\.com\/WordPress\/gutenberg\/pull\/(\d+)/g)].map(
					(match) => Number(match[1])
				)
			),
		];
		sections.push({ version, prs });
	}

	return sections;
}

function buildReleaseCycles(releases) {
	const cycles = new Map();
	for (const release of releases) {
		const parsed = parseVersion(release.tagName);
		if (!parsed) {
			continue;
		}

		const cycle = cycles.get(parsed.base) || {
			version: parsed.base,
			rc: null,
			ga: null,
			patches: [],
		};

		if (parsed.rc !== null) {
			if (!cycle.rc || parsed.rc < cycle.rc.number) {
				cycle.rc = {
					number: parsed.rc,
					tagName: release.tagName,
					date: release.publishedAt || release.createdAt,
					url: release.url,
					projected: false,
				};
			}
		} else if (parsed.patch === 0) {
			cycle.ga = {
				tagName: release.tagName,
				date: release.publishedAt || release.createdAt,
				url: release.url,
				projected: false,
			};
		} else {
			cycle.patches.push({
				tagName: release.tagName,
				date: release.publishedAt || release.createdAt,
				url: release.url,
			});
		}

		cycles.set(parsed.base, cycle);
	}

	return cycles;
}

function chooseReleaseVersion(prNumber, sections) {
	const candidates = sections
		.filter((section) => section.prs.includes(prNumber))
		.map((section) => section.version);

	if (!candidates.length) {
		return null;
	}

	const stableCandidates = candidates.filter(
		(version) => parseVersion(version)?.rc === null
	);
	const pool = stableCandidates.length ? stableCandidates : candidates;
	return pool.sort(compareVersions)[0].replace(/-rc\.\d+$/, '');
}

function projectCycleAfter(latestCycle, mergedAt) {
	const mergedDate = new Date(mergedAt);
	const latestParsed = parseVersion(latestCycle.version);
	let version = latestCycle.version;
	let rcDate = latestCycle.rc?.date
		? new Date(latestCycle.rc.date)
		: addDays(new Date(latestCycle.ga.date), -7);
	let gaDate = latestCycle.ga?.date
		? new Date(latestCycle.ga.date)
		: addDays(rcDate, 7);

	while (rcDate <= mergedDate) {
		latestParsed.minor += 1;
		version = `${latestParsed.major}.${latestParsed.minor}.0`;
		rcDate = addDays(rcDate, 14);
		gaDate = addDays(gaDate, 14);
	}

	return { version, rcDate, gaDate };
}

function dateForCycle(cycle, type) {
	if (type === 'rc' && cycle.rc?.date) {
		return new Date(cycle.rc.date);
	}
	if (type === 'ga' && cycle.ga?.date) {
		return new Date(cycle.ga.date);
	}
	return null;
}

function inferCycleForMerge(knownCycles, latestCycle, mergedAt) {
	const mergedDate = new Date(mergedAt);
	const inferred = knownCycles.find((cycle) => {
		const rcDate = dateForCycle(cycle, 'rc');
		return rcDate && rcDate > mergedDate;
	});

	if (inferred) {
		return { version: inferred.version, source: 'inferred' };
	}

	const projected = projectCycleAfter(latestCycle, mergedAt);
	return { version: projected.version, source: 'projected' };
}

function scheduleFor(version, cycles, latestCycle, mergedAt) {
	const cycle = cycles.get(version);
	let rc = cycle?.rc;
	let ga = cycle?.ga;

	if (!cycle) {
		const projected = projectCycleAfter(latestCycle, mergedAt);
		rc = {
			tagName: `v${projected.version}-rc.1`,
			date: iso(projected.rcDate),
			url: null,
			projected: true,
		};
		ga = {
			tagName: `v${projected.version}`,
			date: iso(projected.gaDate),
			url: null,
			projected: true,
		};
		version = projected.version;
	} else if (rc && !ga) {
		ga = {
			tagName: `v${version}`,
			date: iso(addDays(new Date(rc.date), 7)),
			url: null,
			projected: true,
		};
	}

	const gaDate = ga?.date ? new Date(ga.date) : null;
	const stagingDate = gaDate ? nextTuesdayAfter(gaDate) : null;
	const productionDate = stagingDate ? addDays(stagingDate, 7) : null;

	return {
		version,
		rc,
		ga,
		vipStaging: stagingDate
			? {
					date: iso(stagingDate),
					projected: ga?.projected || stagingDate > now,
			  }
			: null,
		vipProduction: productionDate
			? {
					date: iso(productionDate),
					projected: ga?.projected || productionDate > now,
			  }
			: null,
	};
}

const token = getToken();
const [prs, releases, changelog] = await Promise.all([
	fetchPrs(),
	fetchReleases(),
	readChangelog(),
]);
const sections = parseChangelog(changelog.text);
const cycles = buildReleaseCycles(releases);
const knownCycles = [...cycles.values()]
	.filter((cycle) => cycle.rc || cycle.ga)
	.sort((a, b) => compareVersions(a.version, b.version));
const latestCycle = knownCycles.at(-1);

const items = prs
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
			release: {
				...schedule,
				source: fallback.source,
			},
		};
	})
	.sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));

const data = {
	generatedAt: now.toISOString(),
	source: {
		repository: `${owner}/${repo}`,
		label,
		changelog: changelog.source,
		releaseDocs:
			'https://github.com/WordPress/gutenberg/blob/trunk/docs/contributors/code/release/plugin-release.md',
	},
	assumptions: [
		'Gutenberg RC and GA dates come from GitHub releases when available.',
		'Unreleased GA dates are projected as seven days after RC, matching the Gutenberg release documentation.',
		'VIP staging is the first Tuesday after Gutenberg GA; VIP production is the following Tuesday.',
		'PR-to-release inclusion is read from Gutenberg changelog.txt; labeled PRs missing from the changelog are inferred from the nearest RC after merge, or projected to the next future cycle when no RC exists yet.',
	],
	prs: items,
	releases: knownCycles.map((cycle) => scheduleFor(cycle.version, cycles, latestCycle)),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

console.log(
	`Wrote ${items.length} ${label} PRs to ${outputPath.replace(
		`${process.cwd()}/`,
		''
	)}`
);
