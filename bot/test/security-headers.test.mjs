import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
test('Discord transport responses explicitly disable caching and content sniffing', () => {
  const json = source.match(/function json\(response, status, payload\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(json, 'shared response helper must exist');
  for (const header of ['"cache-control": "no-store, max-age=0"', '"x-content-type-options": "nosniff"', '"referrer-policy": "no-referrer"', '"x-frame-options": "DENY"']) assert.ok(json.includes(header), `missing ${header}`);
});
