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
