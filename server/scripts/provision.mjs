// Finds or creates the Cloudflare resources the team server needs and writes their ids into wrangler.toml:
//   D1 database "living-project-hq" and KV namespace "living-project-hq-files".
// Needs `npx wrangler login` (on a computer) or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (in CI).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB_NAME = 'living-project-hq', KV_TITLE = 'living-project-hq-files';
const config = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
const wrangler = args => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CI: 'true' } });
const parseJson = out => { const i = out.search(/[[{]/); if (i < 0) throw new Error('Wrangler did not return JSON:\n' + out); return JSON.parse(out.slice(i)); };

function database() {
  const find = () => parseJson(wrangler(['d1', 'list', '--json'])).find(d => d.name === DB_NAME);
  let db = find();
  if (!db) { console.log(`Creating D1 database ${DB_NAME}…`); wrangler(['d1', 'create', DB_NAME]); db = find(); }
  if (!db?.uuid) throw new Error('Could not find the D1 database after creating it');
  return db.uuid;
}
function kvNamespace() {
  const find = () => parseJson(wrangler(['kv', 'namespace', 'list'])).find(n => n.title === KV_TITLE || n.title.endsWith('-' + KV_TITLE));
  let ns = find();
  if (!ns) { console.log(`Creating KV namespace ${KV_TITLE}…`); wrangler(['kv', 'namespace', 'create', KV_TITLE]); ns = find(); }
  if (!ns?.id) throw new Error('Could not find the KV namespace after creating it');
  return ns.id;
}

const dbId = database(), kvId = kvNamespace();
let toml = readFileSync(config, 'utf8');
toml = toml.replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`);
toml = toml.replace(/(\[\[kv_namespaces\]\][\s\S]*?\nid = )"[^"]*"/, `$1"${kvId}"`);
writeFileSync(config, toml);
console.log(`wrangler.toml updated: D1 ${dbId}, KV ${kvId}`);
