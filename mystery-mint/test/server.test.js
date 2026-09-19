import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, loadConfig, sign, unsign, toCsv, validateApplication, WhitelistStore } from '../server.js';

const WALLET = '0x' + 'a'.repeat(40);
const good = { wallet: WALLET, xUsername: 'Nightshade', email: '', source: 'x', reason: 'I have waited in the dark for this.', oath: true };

test('signed cookies reject tampering and expiry', () => {
  const t = sign({ xId: '1' }, 'secret', 60);
  assert.equal(unsign(t, 'secret').xId, '1');
  assert.equal(unsign(t, 'other'), null);
  assert.equal(unsign(t.replace(/^./, 'x'), 'secret'), null);
  assert.equal(unsign(sign({ xId: '1' }, 'secret', -1), 'secret'), null);
});

test('validation', () => {
  assert.deepEqual(validateApplication(good).errors, {});
  const { errors } = validateApplication({ wallet: '0x123', xUsername: '!!', alias: 'a', email: 'nope', source: 'tv', reason: 'short', oath: 'yes' });
  assert.deepEqual(Object.keys(errors).sort(), ['alias', 'email', 'oath', 'reason', 'source', 'wallet', 'xUsername']);
});

test('csv escapes quotes and blocks formulas', () => {
  const csv = toCsv([{ number: 1, alias: '=HYPERLINK("x")', reason: 'a, "b"' }]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"a, ""b"""/);
});

async function withServer(env, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mm-'));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const cfg = loadConfig({ DEV_MODE: '1', BASE_URL: base, ADMIN_TOKEN: 'adm', DATA_FILE: path.join(dir, 'wl.json'), ...env });
  const store = new WhitelistStore(cfg.dataFile);
  await store.load();
  server.on('request', createApp(cfg, store));
  try {
    await fn(base, cfg);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const post = (base, body, origin = base) => fetch(`${base}/api/whitelist`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify(body),
});

test('full whitelist flow', async () => {
  await withServer({}, async (base, cfg) => {
    assert.equal((await post(base, good, 'https://evil.example')).status, 403);
    assert.equal((await post(base, { ...good, wallet: 'bad' })).status, 422);

    const ok = await post(base, good);
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).entry.xUsername, 'Nightshade');

    const again = await post(base, { ...good, wallet: '0x' + 'b'.repeat(40) });
    assert.equal(again.status, 409);

    const dupWallet = await post(base, { ...good, xUsername: 'OtherHandle', wallet: WALLET.toUpperCase().replace('0X', '0x') });
    assert.equal(dupWallet.status, 409);
    const second = await post(base, { ...good, xUsername: 'OtherHandle', wallet: '0x' + 'c'.repeat(40) });
    assert.equal(second.status, 201);

    const me = await (await fetch(`${base}/api/me`)).json();
    assert.equal(me.count, 2);

    assert.equal((await fetch(`${base}/admin/export.csv`)).status, 401);
    const csv = await (await fetch(`${base}/admin/export.csv`, { headers: { Authorization: 'Bearer adm' } })).text();
    assert.equal(csv.trim().split('\n').length, 3);

    const saved = JSON.parse(await readFile(cfg.dataFile, 'utf8'));
    assert.equal(saved.length, 2);

    const pub = await (await fetch(`${base}/api/whitelist`)).json();
    assert.equal(pub.count, 2);
    assert.equal(pub.entries.length, 2);
    assert.equal(pub.entries[0].xUsername, 'Nightshade');
    assert.equal(pub.entries[0].email, undefined);
    assert.equal(pub.entries[0].reason, undefined);
    assert.equal(pub.entries[0].xId, undefined);
    assert.match(pub.entries[0].wallet, /…/);
    assert.ok(!pub.entries[0].wallet.includes('a'.repeat(10)));
  });
});

test('whitelist cap', async () => {
  await withServer({ WHITELIST_CAP: '1' }, async (base) => {
    assert.equal((await post(base, good)).status, 201);
    const res = await post(base, { ...good, xUsername: 'OtherHandle', wallet: '0x' + 'd'.repeat(40) });
    assert.equal(res.status, 403);
  });
});

test('static files and path traversal', async () => {
  await withServer({}, async (base) => {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    const story = await fetch(`${base}/story`);
    assert.equal(story.status, 200);
    assert.match(await story.text(), /THE FIRST BROTHER/);
    const board = await fetch(`${base}/board`);
    assert.equal(board.status, 200);
    assert.match(await board.text(), /THE BOARD/);
    assert.doesNotMatch(await home.text(), /Connect with X/);
    assert.equal((await fetch(`${base}/..%2fserver.js`)).status, 404);
  });
});

test('refuses to start without a session secret outside dev mode', () => {
  assert.throws(() => loadConfig({}), /SESSION_SECRET/);
});

test('DATABASE_URL is picked up when set', () => {
  const cfg = loadConfig({ SESSION_SECRET: 'x', DATABASE_URL: 'postgresql://localhost/neondb' });
  assert.equal(cfg.databaseUrl, 'postgresql://localhost/neondb');
  assert.equal(loadConfig({ SESSION_SECRET: 'x' }).databaseUrl, '');
});
