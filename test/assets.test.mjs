// The page and all module imports share one cache version: otherwise a browser may combine a new
// app-v4.js with an old cached workspace-store.js and show a blank page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('module imports carry the same ?v= as index.html', () => {
  const dir = new URL('../docs/', import.meta.url);
  const v = readFileSync(new URL('index.html', dir), 'utf8').match(/app-v4\.js\?v=(\d+)/)[1];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/from '(\.\/[^']+)'/g)) {
      assert.match(m[1], new RegExp(`\\.js\\?v=${v}$`), `${f} imports ${m[1]} without ?v=${v}`);
    }
  }
});
