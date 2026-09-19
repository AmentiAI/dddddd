// Remove someone from the whitelist.
//   node scripts/remove.mjs 0xabc...        (by wallet)
//   node scripts/remove.mjs @handle         (by X username)
//   node scripts/remove.mjs '#12'           (by initiate number)
// Works against DATABASE_URL when set, otherwise the local data/whitelist.json.
import { createStore, loadConfig, loadDotEnv } from '../mint.js';

const spec = process.argv[2];
if (!spec) {
  console.error('Usage: node scripts/remove.mjs <wallet | @username | #number>');
  process.exit(1);
}

await loadDotEnv();
const cfg = loadConfig(process.env, ['--dev']);
const store = await createStore(cfg);
const entry = await store.remove(spec);

if (!entry) {
  console.error(`Nobody on the whitelist matches ${spec}.`);
  process.exit(1);
}
console.log(`Removed #${entry.number} ${entry.alias} (@${entry.xUsername || '?'}) ${entry.wallet}`);
console.log(`${store.count} sworn remain.`);
process.exit(0);
