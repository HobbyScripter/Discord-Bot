import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub polling suppresses repeated identical errors and resets after recovery', async () => {
  const source = await readFile(new URL('../src/discord-bot.js', import.meta.url), 'utf8');
  assert.match(source, /let lastReportedError = null/);
  assert.match(source, /if \(message !== lastReportedError\)/);
  assert.match(source, /lastReportedError = null/);
  assert.match(source, /GitHub-Sync für Community \$\{guild\.id\} funktioniert wieder/);
});
