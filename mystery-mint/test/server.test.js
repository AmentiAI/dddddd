import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, loadConfig, matchEntry, sign, unsign, toCsv, validateApplication, WhitelistStore } from '../mint.js';

const WALLET = '0x' + 'a'.repeat(40);
const good = { wallet: WALLET, xUsername: 'Nightshade', source: 'x', reason: 'I have waited in the dark for this.', oath: true };

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
  assert.deepEqual(Object.keys(errors).sort(), ['alias', 'oath', 'reason', 'source', 'wallet', 'xUsername']);
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
    assert.equal((await fetch(`${base}/..%2fmint.js`)).status, 404);
  });
});

test('missing SESSION_SECRET is allowed', () => {
  const cfg = loadConfig({});
  assert.ok(cfg.sessionSecret);
});

test('DATABASE_URL is picked up when set', () => {
  const cfg = loadConfig({ SESSION_SECRET: 'x', DATABASE_URL: 'postgresql://localhost/neondb' });
  assert.equal(cfg.databaseUrl, 'postgresql://localhost/neondb');
  assert.equal(loadConfig({ SESSION_SECRET: 'x' }).databaseUrl, '');
});

// ---- hosting behind a proxy (Vercel) ----

test('behind a proxy, the whitelist accepts the forwarded origin and exports under /api', async () => {
  await withServer({ VERCEL: '1', BASE_URL: 'https://theorder.example' }, async (base) => {
    const submit = (origin, headers = {}) => fetch(`${base}/api/whitelist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
      body: JSON.stringify({ ...good, wallet: '0x' + 'e'.repeat(40) }),
    });

    // The browser's origin is the deployment URL, which is not BASE_URL.
    const proxied = await submit('https://mystery-mint.vercel.app', {
      'x-forwarded-host': 'mystery-mint.vercel.app',
      'x-forwarded-proto': 'https',
    });
    assert.equal(proxied.status, 201);

    assert.equal((await submit('https://evil.example', { 'x-forwarded-host': 'mystery-mint.vercel.app' })).status, 403);

    const csv = await fetch(`${base}/api/export.csv?token=adm`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal((await fetch(`${base}/api/export.csv?token=wrong`)).status, 401);
  });
});

test('the Vercel function boots and serves the API', async () => {
  const { default: handler } = await import('../api/[...path].js');
  process.env.SESSION_SECRET ||= 'test-secret';
  process.env.DATA_FILE = path.join(await mkdtemp(path.join(tmpdir(), 'mm-fn-')), 'wl.json');
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/stats`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 0);
  } finally {
    server.close();
  }
});


// ---- removing people, and numbering ----

test('matchEntry finds people by wallet, @username or #number', () => {
  const entries = [{ number: 7, wallet: '0xAbC', xUsername: 'Nightshade' }];
  assert.equal(matchEntry(entries, '0xabc'), entries[0]);
  assert.equal(matchEntry(entries, '@nightshade'), entries[0]);
  assert.equal(matchEntry(entries, '#7'), entries[0]);
  assert.equal(matchEntry(entries, { wallet: '0xABC' }), entries[0]);
  assert.equal(matchEntry(entries, '0xdef'), null);
  assert.equal(matchEntry(entries, ''), null);
});

test('numbering starts at 1 and never reissues a removed number', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mm-rm-'));
  const store = new WhitelistStore(path.join(dir, 'wl.json'));
  await store.load();

  const first = await store.add({ xId: 'a', xUsername: 'one', wallet: '0x' + '1'.repeat(40), alias: 'One' });
  assert.equal(first.number, 1, 'an empty whitelist starts at #1');
  assert.equal((await store.add({ xId: 'b', xUsername: 'two', wallet: '0x' + '2'.repeat(40), alias: 'Two' })).number, 2);

  assert.equal((await store.remove('@one')).number, 1);
  assert.equal(store.count, 1);
  const third = await store.add({ xId: 'c', xUsername: 'three', wallet: '0x' + '3'.repeat(40), alias: 'Three' });
  assert.equal(third.number, 3, 'must not reuse #1 or clash with #2');
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')).map((e) => e.number), [2, 3]);

  // emptied out, numbering starts over
  await store.remove('#2');
  await store.remove('#3');
  assert.equal(store.count, 0);
  assert.equal((await store.add({ xId: 'd', xUsername: 'four', wallet: '0x' + '4'.repeat(40), alias: 'Four' })).number, 1);
  await rm(dir, { recursive: true, force: true });
});

test('admin can remove someone over HTTP', async () => {
  await withServer({}, async (base) => {
    assert.equal((await post(base, good)).status, 201);
    const remove = (body, token) => fetch(`${base}/api/admin/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });

    assert.equal((await remove({ wallet: WALLET })).status, 401, 'no token');
    assert.equal((await remove({ wallet: '0x' + 'f'.repeat(40) }, 'adm')).status, 404, 'unknown wallet');

    const res = await remove({ wallet: WALLET }, 'adm');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 0);

    // wallet is free again, and the next initiate is #1
    const again = await post(base, good);
    assert.equal(again.status, 201);
    assert.equal((await again.json()).entry.number, 1);
  });
});
