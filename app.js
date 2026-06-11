const timeline = document.querySelector('#timeline');
const axis = document.querySelector('#axis');
const meta = document.querySelector('#meta');
const summary = document.querySelector('#summary');
const search = document.querySelector('#search');
const windowSelect = document.querySelector('#window');
const projectedOnly = document.querySelector('#projectedOnly');

const dayMs = 24 * 60 * 60 * 1000;
const labelWidth = 300;
let trackWidth = 1180;
const now = new Date();
let data;

const formatDate = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
});

const formatShort = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
});

function date(value) {
	return value ? new Date(value) : null;
}

function markerDate(pr, type) {
	switch (type) {
		case 'merge':
			return date(pr.mergedAt);
		case 'rc':
			return date(pr.release.rc?.date);
		case 'ga':
			return date(pr.release.ga?.date);
		case 'staging':
			return date(pr.release.vipStaging?.date);
		case 'production':
			return date(pr.release.vipProduction?.date);
		default:
			return null;
	}
}

function isProjected(pr, type) {
	if (pr.release.source === 'projected' && type !== 'merge') {
		return true;
	}
	if (type === 'ga') {
		return Boolean(pr.release.ga?.projected);
	}
	if (type === 'staging') {
		return Boolean(pr.release.vipStaging?.projected);
	}
	if (type === 'production') {
		return Boolean(pr.release.vipProduction?.projected);
	}
	return false;
}

function xFor(value, minDate, maxDate) {
	const span = maxDate - minDate || dayMs;
	return ((value - minDate) / span) * trackWidth;
}

function monthSpan(min, max) {
	return (
		(max.getUTCFullYear() - min.getUTCFullYear()) * 12 +
		max.getUTCMonth() -
		min.getUTCMonth() +
		1
	);
}

function visiblePrs() {
	const query = search.value.trim().toLowerCase();
	const mode = windowSelect.value;
	return data.prs.filter((pr) => {
		const text = `#${pr.number} ${pr.title} ${pr.release.version}`.toLowerCase();
		if (query && !text.includes(query)) {
			return false;
		}
		if (projectedOnly.checked && pr.release.source !== 'projected') {
			return false;
		}
		if (mode === 'past-90') {
			return markerDate(pr, 'merge') >= new Date(now.getTime() - 90 * dayMs);
		}
		if (mode === 'future') {
			return markerDate(pr, 'production') >= now || markerDate(pr, 'staging') >= now;
		}
		return true;
	}).sort((a, b) => date(b.mergedAt) - date(a.mergedAt));
}

function bounds(prs) {
	const dates = prs.flatMap((pr) =>
		['merge', 'rc', 'ga', 'staging', 'production']
			.map((type) => markerDate(pr, type))
			.filter(Boolean)
	);
	dates.push(now);
	const min = new Date(Math.min(...dates));
	const max = new Date(Math.max(...dates));
	min.setUTCDate(min.getUTCDate() - 7);
	max.setUTCDate(max.getUTCDate() + 7);
	return { min, max };
}

function renderAxis(min, max) {
	axis.innerHTML = '';
	axis.style.width = `${labelWidth + trackWidth}px`;

	const months = [];
	const cursor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1));
	while (cursor <= max) {
		months.push(new Date(cursor));
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}
	const tickStep = months.length > 34 ? 3 : months.length > 18 ? 2 : 1;

	for (const [index, month] of months.entries()) {
		if (index % tickStep !== 0) {
			continue;
		}
		const tick = document.createElement('div');
		tick.className = 'tick';
		tick.style.left = `${labelWidth + xFor(month, min, max)}px`;
		tick.textContent = month.toLocaleDateString(undefined, {
			month: 'short',
			year: 'numeric',
		});
		axis.append(tick);
	}

	const today = document.createElement('div');
	today.className = 'today';
	today.style.left = `${labelWidth + xFor(now, min, max)}px`;
	axis.append(today);

	const todayLabel = document.createElement('div');
	todayLabel.className = 'today-label';
	todayLabel.style.left = `${labelWidth + xFor(now, min, max)}px`;
	todayLabel.textContent = 'Today';
	axis.append(todayLabel);
}

function renderSummary(prs) {
	const releases = new Set(prs.map((pr) => pr.release.version));
	const projected = prs.filter((pr) => pr.release.source === 'projected').length;
	const futureVip = prs.filter(
		(pr) => markerDate(pr, 'staging') >= now || markerDate(pr, 'production') >= now
	).length;

	summary.innerHTML = [
		['PRs', prs.length],
		['Gutenberg releases', releases.size],
		['Projected release', projected],
		['Upcoming VIP', futureVip],
	]
		.map(
			([label, value]) =>
				`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`
		)
		.join('');
}

function tooltip(pr, type, value) {
	const names = {
		merge: 'Merged',
		rc: 'Gutenberg RC',
		ga: 'Gutenberg GA',
		staging: 'VIP staging',
		production: 'VIP production',
	};
	const projected = isProjected(pr, type) ? 'Projected ' : '';
	const tag =
		type === 'rc'
			? pr.release.rc?.tagName
			: type === 'ga'
				? pr.release.ga?.tagName
				: '';
	return `${projected}${names[type]}<br>${formatDate.format(value)}${
		tag ? `<br>${tag}` : ''
	}`;
}

function renderRow(pr, min, max) {
	const row = document.createElement('article');
	row.className = 'row';
	row.style.width = `${labelWidth + trackWidth}px`;

	const label = document.createElement('div');
	label.className = 'row-label';
	label.innerHTML = `
		<a href="${pr.url}" target="_blank" rel="noreferrer">#${pr.number} ${escapeHtml(
			pr.title
		)}</a>
		<div class="row-meta">
			<span>${formatShort.format(markerDate(pr, 'merge'))}</span>
			<span class="pill">${pr.release.version}</span>
			${pr.release.source === 'projected' ? '<span class="pill">projected</span>' : ''}
		</div>
	`;

	const track = document.createElement('div');
	track.className = 'track';

	const first = markerDate(pr, 'merge');
	const last = markerDate(pr, 'production');
	const bar = document.createElement('div');
	bar.className = 'bar';
	bar.style.left = `${xFor(first, min, max)}px`;
	bar.style.width = `${Math.max(8, xFor(last, min, max) - xFor(first, min, max))}px`;
	track.append(bar);

	for (const type of ['merge', 'rc', 'ga', 'staging', 'production']) {
		const value = markerDate(pr, type);
		if (!value) {
			continue;
		}
		const event = document.createElement('a');
		event.className = `event ${type}${isProjected(pr, type) ? ' projected' : ''}`;
		event.href =
			type === 'rc'
				? pr.release.rc?.url || pr.url
				: type === 'ga'
					? pr.release.ga?.url || pr.url
					: pr.url;
		event.target = '_blank';
		event.rel = 'noreferrer';
		event.style.left = `${xFor(value, min, max)}px`;
		event.setAttribute('aria-label', `${type} ${formatDate.format(value)}`);
		event.innerHTML = `<span class="tooltip">${tooltip(pr, type, value)}</span>`;
		track.append(event);
	}

	row.append(label, track);
	return row;
}

function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (char) => {
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

function render() {
	const prs = visiblePrs();
	renderSummary(prs);

	if (!prs.length) {
		timeline.innerHTML = '<div class="empty">No PRs match this view.</div>';
		axis.innerHTML = '';
		return;
	}

	const { min, max } = bounds(prs);
	trackWidth = Math.max(1180, monthSpan(min, max) * 72);
	renderAxis(min, max);
	timeline.innerHTML = '';
	timeline.style.width = `${labelWidth + trackWidth}px`;
	for (const pr of prs) {
		timeline.append(renderRow(pr, min, max));
	}
}

async function init() {
	const response = await fetch('./data/pr-release-timeline.json', {
		cache: 'no-store',
	});
	data = await response.json();
	meta.innerHTML = `
		<div>${data.source.label}</div>
		<div>Generated ${formatDate.format(new Date(data.generatedAt))}</div>
	`;
	render();
}

search.addEventListener('input', render);
windowSelect.addEventListener('change', render);
projectedOnly.addEventListener('change', render);

init().catch((error) => {
	timeline.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
