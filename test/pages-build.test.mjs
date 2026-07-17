import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
	new URL('../.github/workflows/pages.yml', import.meta.url),
	'utf8'
);

test('Pages tests before refresh and publishes every browser module with cache-safe URLs', () => {
	assert.match(workflow, /- name: Run tests\n\s+run: npm test/);
	assert.match(
		workflow,
		/asset_hash=\$\(shasum -a 256 app\.js render-helpers\.mjs styles\.css/
	);
	assert.match(workflow, /_site\/app\.\$\{asset_hash\}\.js/);
	assert.match(workflow, /_site\/render-helpers\.\$\{asset_hash\}\.mjs/);
	assert.match(workflow, /_site\/styles\.\$\{asset_hash\}\.css/);
	assert.match(workflow, /sed .+render-helpers/);
	assert.match(workflow, /index\.html > _site\/index\.html/);
	assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('run: npm run refresh'));
});
