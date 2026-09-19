// ---- edit these ----
const CONFIG = {
  mintDate: null,                 // e.g. '2026-11-01T18:00:00Z'; null keeps it "SEALED"
  supply: 2000,
  whitelistCap: 1750,
  price: 2,
  creatorFee: '5%',
  treasury: 'The Future of The Order',
  xHandle: 'TheHoodedOrder',      // the project's X account
  siteUrl: location.origin,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n, w = 4) => String(n).padStart(w, '0');
let state = { x: null, entry: null, count: null, cap: null };

// ---------- embers ----------
function embers() {
  const canvas = $('#embers');
  const ctx = canvas.getContext('2d');
  let w, h, dpr, parts = [];
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    const n = Math.round(Math.min(90, innerWidth / 14));
    parts = Array.from({ length: n }, () => spawn(true));
  };
  const spawn = (anywhere) => ({
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : h + 10,
    r: (Math.random() * 1.6 + 0.4) * dpr,
    vy: (Math.random() * 0.5 + 0.15) * dpr,
    sway: Math.random() * Math.PI * 2,
    life: Math.random() * 0.6 + 0.4,
    hue: Math.random() < 0.85 ? 0 : 12,
  });
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y -= p.vy;
      p.x += Math.sin(t / 1400 + p.sway) * 0.3 * dpr;
      const fade = Math.min(1, p.y / h) * p.life;
      if (p.y < -10) Object.assign(p, spawn(false));
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${fade * 0.8})`;
      ctx.shadowColor = `hsla(${p.hue}, 100%, 55%, 1)`;
      ctx.shadowBlur = 8 * dpr;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!document.hidden) requestAnimationFrame(frame);
  };
  resize();
  addEventListener('resize', resize);
  if (reduceMotion) return;
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
}

// ---------- text decode ----------
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ†‡§∆◊#%&*';
function decode(el) {
  const target = el.dataset.text || (el.dataset.text = el.textContent);
  if (reduceMotion) return;
  let frame = 0;
  const total = target.length * 3 + 12;
  const tick = () => {
    el.textContent = [...target].map((ch, i) =>
      ch === ' ' || frame > i * 3 + 12 ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('');
    if (++frame <= total) requestAnimationFrame(tick);
  };
  tick();
}

// ---------- scroll reveal / parallax ----------
function reveals() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.matches('[data-decode]')) decode(e.target);
      io.unobserve(e.target);
    }
  }, { threshold: 0.2 });
  $$('.reveal, h2[data-decode]').forEach((el) => io.observe(el));
  const stage = $('.hero-stage');
  addEventListener('scroll', () => {
    if (!reduceMotion && stage) stage.style.setProperty('--parallax', `${scrollY * 0.18}px`);
  }, { passive: true });
}

// ---------- cursor ----------
function cursor() {
  if (matchMedia('(hover: none)').matches || reduceMotion) return;
  const c = $('.cursor');
  let x = -100, y = -100, cx = x, cy = y;
  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    c.classList.add('on');
    c.classList.toggle('hot', !!e.target.closest('a, button, summary, input, select, textarea, .hood-card, .pack-card, .hero-pack'));
  });
  const loop = () => {
    cx += (x - cx) * 0.18; cy += (y - cy) * 0.18;
    c.style.transform = `translate(${cx}px, ${cy}px)`;
    requestAnimationFrame(loop);
  };
  loop();
}

// ---------- countdown ----------
function countdown() {
  const el = $('#countdown');
  if (!el || !CONFIG.mintDate) return;
  const when = new Date(CONFIG.mintDate);
  $('.js-mint-when').textContent = `The mint opens ${when.toUTCString().replace(':00 GMT', ' UTC')}. The price stays sealed until then.`;
  const tick = () => {
    const ms = when - Date.now();
    if (ms <= 0) { el.textContent = 'OPEN'; return; }
    const s = Math.floor(ms / 1000);
    el.textContent = `${pad(Math.floor(s / 86400), 2)}:${pad(Math.floor(s / 3600) % 24, 2)}:${pad(Math.floor(s / 60) % 60, 2)}:${pad(s % 60, 2)}`;
    setTimeout(tick, 1000);
  };
  tick();
}

function tilt(el, amount = 16, rest = { rx: 0, ry: 0 }) {
  if (!el || reduceMotion || matchMedia('(hover: none)').matches) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * amount}deg`);
    el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -amount}deg`);
  });
  el.addEventListener('pointerleave', () => {
    el.style.setProperty('--rx', `${rest.rx}deg`);
    el.style.setProperty('--ry', `${rest.ry}deg`);
  });
}

// ---------- sealed pack gallery ----------
function gallery() {
  const tints = [
    'contrast(1.06) saturate(1.08)',
    'brightness(1.08) saturate(1.15)',
    'brightness(0.9) contrast(1.1)',
    'sepia(0.18) saturate(1.2)',
    'brightness(1.04) contrast(1.12)',
    'saturate(1.25) brightness(0.96)',
    'contrast(1.14) saturate(0.92)',
    'brightness(1.1) sepia(0.12)',
  ];
  const g = $('#gallery');
  if (!g) return;
  const count = innerWidth < 600 ? 4 : 8;
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'pack-card reveal';
    card.innerHTML = `
      <div class="glitch">
        <img src="pack.png" alt="" width="400" height="600" style="filter:${tints[i % tints.length]}">
      </div>
      <div class="tag"><span>#????</span><span>SEALED</span></div>`;
    g.appendChild(card);
    tilt(card, 14);
  }
  const pack = $('#hero-pack');
  if (pack && !reduceMotion) {
    pack.addEventListener('pointerenter', () => pack.classList.add('violent'));
    pack.addEventListener('pointerleave', () => pack.classList.remove('violent'));
  }
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data };
}

function renderCount() {
  if (state.count == null) return;
  const cap = state.cap || CONFIG.whitelistCap || CONFIG.supply;
  $$('[data-sworn]').forEach((el) => { el.textContent = pad(state.count); });
  $$('[data-sworn-line]').forEach((el) => { el.textContent = `${pad(state.count)} / ${Number(cap).toLocaleString('en-US')} sworn`; });
}

async function loadMe() {
  try {
    const { ok, data } = await api('/api/me');
    if (ok) Object.assign(state, data);
  } catch { /* server offline: page still works as a static site */ }
  renderCount();
  if ($('#oath')) renderOath();
  await loadBoard();
}

function maskWallet(wallet) {
  return wallet && wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : (wallet || '—');
}

function boardDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadBoard() {
  const list = $('#board-rows');
  if (!list) return;
  const empty = $('#board-empty');
  const err = $('#board-error');
  if (err) err.hidden = true;
  try {
    const { ok, data } = await api('/api/whitelist');
    if (!ok) throw new Error('ledger');
    const entries = data.entries || [];
    if (state.count == null) state.count = data.count ?? entries.length;
    if (data.cap != null) state.cap = data.cap;
    renderCount();
    if (!entries.length) {
      list.replaceChildren();
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.replaceChildren(...entries.map((e) => {
      const tr = document.createElement('tr');
      const cells = [
        `#${pad(e.number)}`,
        e.xUsername ? `@${e.xUsername}` : '—',
        maskWallet(e.wallet),
        boardDate(e.createdAt),
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      return tr;
    }));
  } catch {
    list.replaceChildren();
    if (empty) empty.hidden = true;
    if (err) err.hidden = false;
  }
}

// ---------- oath overlay ----------
let lastFocus = null;

function openOath() {
  const dlg = $('#oath');
  if (!dlg.hidden) return;
  lastFocus = document.activeElement;
  dlg.hidden = false;
  document.body.classList.add('locked');
  decode($('#oath-title'));
  setTimeout(() => $('#x-username')?.focus(), 50);
}

function closeOath() {
  $('#oath').hidden = true;
  document.body.classList.remove('locked');
  if (location.hash === '#oath') history.replaceState(null, '', location.pathname);
  lastFocus?.focus();
}

function renderOath() {
  if (state.entry) showSworn(state.entry);
}

function showSworn(entry) {
  $('#oath-form-view').hidden = true;
  $('#oath-sworn').hidden = false;
  $('#initiate-no').textContent = `#${pad(entry.number)}`;
  $('#initiate-alias').textContent = entry.xUsername ? `@${entry.xUsername}` : (entry.alias || '');
  $('#initiate-wallet').textContent = `${entry.wallet.slice(0, 6)}…${entry.wallet.slice(-4)}`;
  const text = `I have sworn the oath. Initiate #${pad(entry.number)} of The Order.\n\n2,000 sealed packs at $2. All profits go to The Future of The Order.\n@${CONFIG.xHandle}`;
  $('#share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(CONFIG.siteUrl)}`;
}

function setErrors(errors = {}) {
  $$('[data-err]').forEach((el) => {
    const msg = errors[el.dataset.err] || '';
    el.textContent = msg;
    el.closest('.field')?.classList.toggle('invalid', !!msg);
  });
}

function showFormError(msg) {
  const el = $('#form-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function oath() {
  $$('[data-open-oath]').forEach((b) => b.addEventListener('click', openOath));
  $$('[data-close-oath]').forEach((b) => b.addEventListener('click', closeOath));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#oath').hidden) closeOath();
    if (e.key === 'Tab' && !$('#oath').hidden) {
      const focusables = $$('#oath a[href], #oath button:not([disabled]), #oath input:not([disabled]), #oath select:not([disabled]), #oath textarea:not([disabled])')
        .filter((el) => el.offsetParent !== null);
      const first = focusables[0], last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  if (location.hash === '#oath') {
    history.replaceState(null, '', location.pathname + '#oath');
    openOath();
  }

  const handle = $('#x-username');
  if (handle) {
    handle.addEventListener('input', () => {
      handle.value = handle.value.trim().replace(/^@+/, '');
    });
  }

  const wallet = $('#wallet');
  wallet.addEventListener('input', () => {
    wallet.value = wallet.value.trim();
    wallet.parentElement.classList.toggle('ok', /^0x[0-9a-fA-F]{40}$/.test(wallet.value));
  });

  $('#oath-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      xUsername: f.xUsername.value.trim(),
      wallet: f.wallet.value.trim(),
      source: f.source.value,
      reason: f.reason.value.trim(),
      oath: f.oath.checked,
    };
    setErrors();
    showFormError('');
    const btn = $('#swear-btn');
    btn.disabled = true;
    btn.textContent = 'Sealing…';
    try {
      const { ok, status, data } = await api('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (ok) {
        state.entry = data.entry;
        state.count = data.count;
        renderCount();
        showSworn(data.entry);
        loadBoard();
        return;
      }
      if (status === 409 && data.entry) { state.entry = data.entry; showSworn(data.entry); return; }
      setErrors(data.errors);
      showFormError(data.error || 'The oath was not accepted.');
      $('.invalid input, .invalid select, .invalid textarea')?.focus();
    } catch {
      showFormError('The Order could not be reached. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Seal the Oath';
    }
  });
}

// ---------- secrets ----------
function secrets() {
  let typed = '';
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-8);
    if (typed === 'sherwood') {
      const s = $('#secret');
      s.hidden = false;
      setTimeout(() => (s.hidden = true), 6000);
    }
  });
  const title = document.title;
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? 'we are still watching…' : title;
  });
  console.log('%cThe Order sees you looking.', 'font: 600 16px serif; color: #ff5a2a');
  console.log('%cThere are words the forest remembers. Type one of them anywhere on this page.', 'color: #c9a45c');
}

// ---------- boot ----------
$('.js-year').textContent = new Date().getFullYear();
$('.js-x-link').href = `https://x.com/${CONFIG.xHandle}`;
$('.js-x-link').textContent = `X / @${CONFIG.xHandle}`;
function navScroll() {
  const nav = $('.nav');
  if (!nav) return;
  const on = () => nav.classList.toggle('scrolled', scrollY > 16);
  addEventListener('scroll', on, { passive: true });
  on();
}

cursor();
gallery();
reveals();
navScroll();
countdown();
if ($('#oath')) oath();
secrets();
const titleEl = $('.title');
if (titleEl) decode(titleEl);
loadMe();
