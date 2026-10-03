// Bumps the cache version of the page and of every module import at once: node scripts/bump-version.mjs
// Browsers cache modules by URL; one shared ?v= keeps old and new files from being mixed after an update.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = new URL('../docs/', import.meta.url);
const html = readFileSync(new URL('index.html', dir), 'utf8');
const next = Math.max(...[...html.matchAll(/\?v=(\d+)/g)].map(m => +m[1])) + 1;
writeFileSync(new URL('index.html', dir), html.replace(/(app-v4\.js|board-v8\.js|investigation-board\.css|app-v20\.css)\?v=\d+/g, `$1?v=${next}`));
for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  writeFileSync(new URL(f, dir), src.replace(/from '\.\/([a-z0-9-]+)\.js(\?v=\d+)?'/g, `from './$1.js?v=${next}'`));
}
console.log('version', next);
