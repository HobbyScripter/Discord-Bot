import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
assert.equal((html.match(/<script>/g) || []).length, 1, 'Dashboard should contain exactly one inline script.');
for (const marker of ['connectLiveEvents', '/api/incidents/', 'Incident Operations Center', '/events']) {
  assert.ok(html.includes(marker), `Dashboard marker missing: ${marker}`);
}
console.log('Dashboard inline integrity: OK');
