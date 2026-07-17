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

const dayMs = 24 * 60 * 60 * 1000;

function timelinePosition(value, start, end) {
	return (((value - start) / (end - start || dayMs)) * 100).toFixed(2);
}

function deploymentDetails(release, formatDate) {
	const prCount = release.artifact?.prNumbers?.length || 0;
	return [
		`VIP ${release.channel}`,
		release.name,
		formatDate(new Date(release.date)),
		`RTC ${release.rtcPluginVersion}`,
		release.gutenbergBuildVersion,
		release.artifact
			? `Gutenberg ${release.artifact.gutenbergVersion}; ${prCount} tracked RTC PR${
					prCount === 1 ? '' : 's'
				}`
			: 'Artifact unavailable at release',
	].join(' · ');
}

function renderTimelineAxis(start, end) {
	const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
	const ticks = [];
	while (cursor <= end) {
		ticks.push(`<span class="deployment-tick" style="--position: ${timelinePosition(
			cursor.getTime(),
			start.getTime(),
			end.getTime()
		)}%;">${escapeHtml(
			cursor.toLocaleDateString(undefined, {
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC',
			})
		)}</span>`);
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}
	return ticks.join('');
}

function renderDeploymentMarker(release, start, end, formatDate) {
	const position = timelinePosition(
		new Date(release.date).getTime(),
		start.getTime(),
		end.getTime()
	);
	const details = deploymentDetails(release, formatDate);
	return `<a class="deployment-marker ${escapeHtml(release.channel)}" href="${escapeHtml(
		release.url
	)}" target="_blank" rel="noreferrer" style="--position: ${position}%;" aria-label="${escapeHtml(
		details
	)}" title="${escapeHtml(details)}"><i aria-hidden="true"></i></a>`;
}

export function renderDeploymentTimeline(releases, formatDate) {
	const sorted = [...releases].sort(
		(left, right) => new Date(left.date) - new Date(right.date)
	);
	const first = new Date(sorted[0].date);
	const last = new Date(sorted.at(-1).date);
	const start = new Date(first.getTime() - 7 * dayMs);
	const end = new Date(last.getTime() + 7 * dayMs);
	const monthCount = Math.max(
		1,
		(end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
			end.getUTCMonth() -
			start.getUTCMonth() +
			1
	);
	const width = Math.max(1240, monthCount * 180);
	const lanes = ['staging', 'production']
		.filter((channel) => sorted.some((release) => release.channel === channel))
		.map(
			(channel) => `<div class="deployment-lane ${channel}">
				<div class="deployment-lane-label">VIP ${escapeHtml(channel)}</div>
				<div class="deployment-track">${sorted
					.filter((release) => release.channel === channel)
					.map((release) => renderDeploymentMarker(release, start, end, formatDate))
					.join('')}</div>
			</div>`
		)
		.join('');

	return `<div class="deployment-scroller"><div class="deployment-timeline" style="--timeline-width: ${width}px;">
		<div class="deployment-axis"><div></div><div class="deployment-axis-track">${renderTimelineAxis(
			start,
			end
		)}</div></div>
		${lanes}
	</div></div>`;
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
	if (
		(type === 'staging' || type === 'production') &&
		marker?.projected === false
	) {
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
	const dates = Object.values(values)
		.filter(Boolean)
		.sort((a, b) => a - b);
	return { first: dates[0], last: dates.at(-1) };
}
