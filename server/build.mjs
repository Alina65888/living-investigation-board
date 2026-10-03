// Assembles the folder that goes into the site directory on the hosting (e.g. ~/www/zadachimantckd.ru):
//   the static app from ../docs + .htaccess + api/ (PHP). Run: node build.mjs  →  server/dist/site
// With ADMIN_EMAIL set in the environment it also writes api/config.php (used by the GitHub deploy).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname, out = resolve(here, 'dist/site');
rmSync(resolve(here, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(here, '../docs'), out, { recursive: true, filter: src => !/\.md$/.test(src) });
cpSync(resolve(here, 'public'), out, { recursive: true, filter: src => !src.endsWith('/api/config.php') });

const email = (process.env.ADMIN_EMAIL || '').trim();
if (email) {
  if (!/^[^@\s'\\]+@[^@\s'\\]+\.[^@\s'\\]+$/.test(email)) throw new Error('ADMIN_EMAIL does not look like an email');
  writeFileSync(resolve(out, 'api/config.php'), `<?php\n// Written by the deploy from the ADMIN_EMAIL secret.\nreturn ['admin_email' => '${email}', 'db' => ['driver' => 'sqlite'], 'data_dir' => ''];\n`);
}
for (const f of ['index.html', '.htaccess', 'api/index.php', 'api/lib.php', 'app-v4.js']) if (!existsSync(resolve(out, f))) throw new Error('Missing ' + f);
console.log(`Site folder ready: ${out}${email ? ' (with api/config.php)' : ' (copy api/config.sample.php to api/config.php on the hosting)'}`);
