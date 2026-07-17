import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
	new URL('../.github/workflows/pages.yml', import.meta.url),
	'utf8'
);

test('Pages tests before refresh and publishes every browser module', () => {
	assert.match(workflow, /- name: Run tests\n\s+run: npm test/);
	assert.match(
		workflow,
		/cp index\.html app\.js render-helpers\.mjs styles\.css _site\//
	);
	assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('run: npm run refresh'));
});
