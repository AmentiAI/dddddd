// Mystery Mint server: static site + whitelist API.
// No dependencies. Run: npm start   (reads .env if present)
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SESSION_TTL = 7 * 24 * 3600;
const MAX_BODY = 8 * 1024;

export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
export const X_USER_RE = /^[A-Za-z0-9_]{1,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SOURCES = ['x', 'discord', 'friend', 'whisper', 'other'];

export function normalizeXUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '');
}

// Minimal .env loader (works on every Node version / OS). Real env vars win.
async function loadDotEnv(files = [path.join(ROOT, '.env'), path.join(ROOT, '..', '.env')]) {
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export function loadConfig(env = process.env, argv = []) {
  const port = Number(env.PORT || 3000);
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const devMode = env.DEV_MODE === '1' || argv.includes('--dev');
  // On Vercel (and behind any reverse proxy) the public URL comes from the request headers.
  const trustProxy = !!env.VERCEL || env.TRUST_PROXY === '1';
  let sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret) {
    if (!devMode) throw new Error('SESSION_SECRET is required (see .env.example). Set DEV_MODE=1 for local testing.');
    sessionSecret = randomBytes(32).toString('hex');
  }
  return {
    port,
    baseUrl,
    secure: baseUrl.startsWith('https://') || trustProxy,
    trustProxy,
    devMode,
    sessionSecret,
    adminToken: env.ADMIN_TOKEN || '',
    dataFile: env.DATA_FILE || path.join(ROOT, 'data', 'whitelist.json'),
    databaseUrl: env.DATABASE_URL || '',
    whitelistCap: env.WHITELIST_CAP === undefined || env.WHITELIST_CAP === ''
      ? 1750
      : Number(env.WHITELIST_CAP), // 0 = no cap
  };
}

// ---------- signed cookies ----------

export function sign(obj, secret, ttlSec) {
  const payload = Buffer.from(JSON.stringify({ ...obj, exp: Date.now() + ttlSec * 1000 })).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function unsign(token, secret) {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return obj.exp > Date.now() ? obj : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// ---------- validation ----------

export function validateApplication(body) {
  const errors = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const xUsername = normalizeXUsername(body.xUsername);
  const alias = str(body.alias) || xUsername;
  const value = {
    wallet: str(body.wallet),
    xUsername,
    alias,
    email: str(body.email),
    reason: str(body.reason),
    source: str(body.source),
  };
  if (!X_USER_RE.test(value.xUsername)) errors.xUsername = 'Enter your X username (letters, numbers, underscore).';
  if (!WALLET_RE.test(value.wallet)) errors.wallet = 'Must be a 0x wallet address (42 characters).';
  if (value.alias.length < 2 || value.alias.length > 32) errors.alias = 'Your name in the Order: 2 to 32 characters.';
  if (value.email && (value.email.length > 254 || !EMAIL_RE.test(value.email))) errors.email = 'That email is not real.';
  if (value.reason.length < 20) errors.reason = 'Speak at least 20 characters. The Order listens.';
  if (value.reason.length > 600) errors.reason = 'Keep it under 600 characters.';
  if (!SOURCES.includes(value.source)) errors.source = 'Tell us how the whisper reached you.';
  if (body.oath !== true) errors.oath = 'The oath must be sworn.';
  return { errors, value };
}

export function toCsv(entries) {
  const cols = ['number', 'createdAt', 'xUsername', 'xId', 'wallet', 'alias', 'email', 'source', 'reason'];
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...entries.map((e) => cols.map((c) => cell(e[c])).join(','))].join('\n') + '\n';
}

// ---------- storage ----------

export class WhitelistStore {
  constructor(file) {
    this.file = file;
    this.entries = [];
    this.writes = Promise.resolve();
  }

  async load() {
    try {
      this.entries = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.entries = [];
    }
  }

  get count() {
    return this.entries.length;
  }

  byX(xId) {
    return this.entries.find((e) => e.xId === xId);
  }

  byUsername(username) {
    const u = normalizeXUsername(username).toLowerCase();
    return this.entries.find((e) => (e.xUsername || '').toLowerCase() === u);
  }

  byWallet(wallet) {
    const w = wallet.toLowerCase();
    return this.entries.find((e) => e.wallet.toLowerCase() === w);
  }

  // Check-and-insert runs synchronously so concurrent requests can't double-register;
  // disk writes are serialized behind it.
  async add(fields) {
    const entry = { number: this.entries.length + 1, createdAt: new Date().toISOString(), ...fields };
    this.entries.push(entry);
    const snapshot = JSON.stringify(this.entries, null, 2);
    const write = this.writes.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    this.writes = write.catch(() => {});
    try {
      await write;
    } catch (e) {
      this.entries = this.entries.filter((x) => x !== entry);
      throw e;
    }
    return entry;
  }
}

const WHITELIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS whitelist (
  number INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  x_id TEXT NOT NULL UNIQUE,
  x_username TEXT,
  x_name TEXT,
  wallet TEXT NOT NULL,
  wallet_lc TEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL,
  email TEXT,
  source TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS whitelist_created_at_idx ON whitelist (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS whitelist_x_username_lc_idx ON whitelist (lower(x_username));

CREATE TABLE IF NOT EXISTS mint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  supply INTEGER NOT NULL DEFAULT 2000,
  price_usd NUMERIC(10,2) NOT NULL DEFAULT 2,
  creator_fee_bps INTEGER NOT NULL DEFAULT 500,
  treasury TEXT NOT NULL DEFAULT 'The Future of The Order'
);
INSERT INTO mint (id, supply, price_usd, creator_fee_bps, treasury)
VALUES (1, 2000, 2, 500, 'The Future of The Order')
ON CONFLICT (id) DO NOTHING;
`;

function rowToEntry(row) {
  return {
    number: row.number,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    xId: row.x_id,
    xUsername: row.x_username,
    xName: row.x_name,
    wallet: row.wallet,
    alias: row.alias,
    email: row.email || '',
    source: row.source,
    reason: row.reason,
  };
}

export class PostgresWhitelistStore {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
    this.entries = [];
  }

  async load() {
    await this.pool.query(WHITELIST_SCHEMA);
    const { rows } = await this.pool.query('SELECT * FROM whitelist ORDER BY number');
    this.entries = rows.map(rowToEntry);
  }

  get count() {
    return this.entries.length;
  }

  byX(xId) {
    return this.entries.find((e) => e.xId === xId);
  }

  byUsername(username) {
    const u = normalizeXUsername(username).toLowerCase();
    return this.entries.find((e) => (e.xUsername || '').toLowerCase() === u);
  }

  byWallet(wallet) {
    const w = wallet.toLowerCase();
    return this.entries.find((e) => e.wallet.toLowerCase() === w);
  }

  async add(fields) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO whitelist (x_id, x_username, x_name, wallet, wallet_lc, alias, email, source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          fields.xId,
          fields.xUsername || null,
          fields.xName || null,
          fields.wallet,
          fields.wallet.toLowerCase(),
          fields.alias,
          fields.email || null,
          fields.source,
          fields.reason,
        ],
      );
      const entry = rowToEntry(rows[0]);
      this.entries.push(entry);
      return entry;
    } catch (e) {
      if (e.code === '23505') {
        await this.load();
        throw Object.assign(new Error('Already sworn.'), { status: 409 });
      }
      throw e;
    }
  }
}

export async function createStore(cfg, { timeoutMs = 15000 } = {}) {
  if (cfg.databaseUrl) {
    const store = new PostgresWhitelistStore(cfg.databaseUrl);
    // A wrong or unreachable DATABASE_URL otherwise hangs startup with no explanation.
    let timer;
    try {
      await Promise.race([
        store.load(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            `Could not reach the database at ${String(cfg.databaseUrl).replace(/:[^:@/]*@/, ':***@')} within ${timeoutMs / 1000}s. `
            + 'Check DATABASE_URL, or remove it to store the whitelist in a local file.')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return store;
  }
  const store = new WhitelistStore(cfg.dataFile);
  await store.load();
  return store;
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// The origin the browser actually used, per the proxy's headers.
export function requestOrigin(req) {
  const first = (v) => String(v || '').split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
  const proto = first(req.headers['x-forwarded-proto']) || 'https';
  return host ? `${proto}://${host}` : '';
}

function sameOrigin(origin, baseUrl) {
  if (origin === baseUrl) return true;
  try {
    const o = new URL(origin);
    const b = new URL(baseUrl);
    if (o.protocol !== b.protocol || o.port !== b.port) return false;
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    return loopback.has(o.hostname) && loopback.has(b.hostname);
  } catch {
    return false;
  }
}

function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    return ++h.count <= limit;
  };
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const names = [rel];
  if (rel && !path.extname(rel)) names.push(`${rel}.html`);
  for (const name of names) {
    const file = path.resolve(PUBLIC_DIR, name);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) continue;
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
      return;
    } catch { /* try next name */ }
  }
  send(res, 404, 'Not found');
}

export function createApp(cfg, store) {
  const allowSubmit = rateLimiter(10, 60_000);
  const publicEntry = (e, { maskWallet = false } = {}) => e && {
    number: e.number,
    alias: e.alias,
    wallet: maskWallet && e.wallet ? `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}` : e.wallet,
    xUsername: e.xUsername || null,
    createdAt: e.createdAt || null,
  };
  const stats = () => ({ count: store.count, cap: cfg.whitelistCap || null });

  const routes = {
    'GET /api/stats': (req, res) => send(res, 200, stats()),

    'GET /api/whitelist': (req, res) => send(res, 200, {
      entries: store.entries.map((e) => publicEntry(e, { maskWallet: true })),
      ...stats(),
    }),

    'GET /api/me': (req, res) => send(res, 200, stats()),

    'POST /api/whitelist': async (req, res, url, cookies, ip) => {
      const allowed = [cfg.baseUrl, cfg.trustProxy ? requestOrigin(req) : ''];
      if (!allowed.some((o) => o && sameOrigin(req.headers.origin, o))) {
        return send(res, 403, { error: 'Bad origin.' });
      }
      if (!String(req.headers['content-type']).startsWith('application/json')) {
        return send(res, 415, { error: 'Expected JSON.' });
      }
      if (!allowSubmit(ip)) return send(res, 429, { error: 'Too many attempts. Patience, initiate.' });

      const { errors, value } = validateApplication(await readJson(req));
      if (Object.keys(errors).length) return send(res, 422, { error: 'The oath is incomplete.', errors });
      const takenName = store.byUsername(value.xUsername);
      if (takenName) {
        return send(res, 409, { error: 'That X username is already sworn.', entry: publicEntry(takenName), errors: { xUsername: 'Already sworn.' } });
      }
      if (store.byWallet(value.wallet)) {
        return send(res, 409, { error: 'That wallet already belongs to another initiate.', errors: { wallet: 'Already sworn.' } });
      }
      if (cfg.whitelistCap && store.count >= cfg.whitelistCap) {
        return send(res, 403, { error: 'The Order is full. Watch for the next summoning.' });
      }
      const handle = value.xUsername;
      const entry = await store.add({
        xId: `x:${handle.toLowerCase()}`,
        xUsername: handle,
        xName: handle,
        ...value,
      });
      send(res, 201, { entry: publicEntry(entry), ...stats() });
    },

    'GET /admin/export.csv': (req, res, url) => admin(req, res, url, () =>
      send(res, 200, toCsv(store.entries), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="whitelist.csv"',
      })),

    'GET /admin/export.json': (req, res, url) => admin(req, res, url, () => send(res, 200, store.entries)),
  };
  routes['GET /api/export.csv'] = routes['GET /admin/export.csv'];
  routes['GET /api/export.json'] = routes['GET /admin/export.json'];

  function admin(req, res, url, fn) {
    if (!cfg.adminToken) return send(res, 404, 'Not found');
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token') || '';
    if (!safeEqual(token, cfg.adminToken)) return send(res, 401, 'Unauthorized');
    fn();
  }

  return async (req, res) => {
    const url = new URL(req.url, cfg.baseUrl);
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const handler = routes[`${req.method} ${url.pathname}`];
    try {
      if (handler) return await handler(req, res, url, parseCookies(req.headers.cookie), ip);
      if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(res, url.pathname);
      send(res, 405, 'Method not allowed');
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Something broke. Try again.' });
    }
  };
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.basename(entry).toLowerCase() === 'server.js';
}

export async function start(argv = process.argv.slice(2)) {
  await loadDotEnv();
  const cfg = loadConfig(process.env, argv);
  const store = await createStore(cfg);
  const app = createApp(cfg, store);

  const listenOn = (host) =>
    new Promise((resolve, reject) => {
      const s = http.createServer(app);
      s.on('error', reject);
      s.listen(cfg.port, host, () => resolve(s));
    });

  let ipv4;
  try {
    ipv4 = await listenOn('127.0.0.1');
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nPort ${cfg.port} is already in use. Close the other server, or set PORT=3001 in .env.\n`);
      process.exit(1);
    }
    throw e;
  }
  // Also bind ::1. On Windows, "localhost" often resolves to IPv6 first and the
  // tab spins forever if only 127.0.0.1 is listening.
  try {
    await listenOn('::1');
  } catch (e) {
    if (e.code !== 'EADDRINUSE' && e.code !== 'EAFNOSUPPORT') throw e;
  }

  const openUrl = cfg.baseUrl.includes('localhost') ? `http://127.0.0.1:${cfg.port}` : cfg.baseUrl;
  const backend = cfg.databaseUrl ? 'postgres' : 'local file';
  console.log(`\n  Mystery Mint running -> open ${openUrl}\n  (${store.count} sworn · ${backend})`);
  if (cfg.devMode) console.log('  DEV MODE: local testing.\n');
  return ipv4;
}

if (isDirectRun()) {
  start().catch((e) => {
    console.error(`\nCould not start: ${e.message}\n`);
    process.exit(1);
  });
}
