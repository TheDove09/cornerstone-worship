import { api, DEMO } from './data.js';
import { CONFIG } from './config.js';
import { parseSongs, parseSongSelectUrl, dedupe } from './song-import.js';

// ── helpers ────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = s => parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const today = () => ymd(new Date());
const nextSunday = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return ymd(d); };
const firstName = n => (n || '').trim().split(/\s+/)[0] || 'friend';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const MAJOR = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEYS = [...MAJOR, ...MAJOR.map(k => k + 'm')];
const ROLES = ['Worship Leader', 'Vocals', 'Piano / Keys', 'Acoustic Guitar', 'Electric Guitar', 'Bass', 'Drums', 'Pastor', 'Sound / Tech', 'Slides / Media'];
const sortRoles = list => [...list].sort((a, b) => {
  const ia = ROLES.indexOf(a), ib = ROLES.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
const roleChips = list => (list && list.length) ? `<div class="role-chips">${sortRoles(list).map(r => `<span class="role-chip">${esc(r)}</span>`).join('')}</div>` : '';
const keyOptions = sel => `<option value="">— Choose a key —</option>` +
  `<optgroup label="Major">${MAJOR.map(k => `<option ${k === sel ? 'selected' : ''}>${k}</option>`).join('')}</optgroup>` +
  `<optgroup label="Minor">${MAJOR.map(k => k + 'm').map(k => `<option ${k === sel ? 'selected' : ''}>${k}</option>`).join('')}</optgroup>`;

const svg = p => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  cal: svg('<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  msg: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  share: svg('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>'),
  send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  up: svg('<path d="M18 15l-6-6-6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  ext: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 5.8"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
};
const LOGO = `<img class="logo-mark" src="icons/logo-mark.png" alt="" aria-hidden="true">`;

const state = { profile: null, renderId: 0, quiet: false, stale: false, unread: false, updateReady: false };
const isAdmin = () => state.profile?.role === 'admin';
const root = $('#app');

// ── UI pieces ──────────────────────────────────────────────────────
function toast(msg, kind = 'ok') {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast glass ${kind}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `${kind === 'ok' ? I.check : ''}<span>${esc(msg)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3600);
}
const errBox = msg => `<div class="alert" role="alert">${esc(msg)}</div>`;

function sheet(title, html, mount) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <section class="sheet glass" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-sm" data-close>${I.x}<span>Close</span></button></div>
      <div class="sheet-body">${html}</div>
    </section>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  requestAnimationFrame(() => el.classList.add('open'));
  mount?.(el);
  return el;
}
function closeSheet() {
  const wasOpen = $$('.sheet-wrap').length > 0;
  $$('.sheet-wrap').forEach(s => s.remove());
  document.body.classList.remove('no-scroll');
  if (wasOpen && (state.stale || state.updateReady)) setTimeout(applyPending, 50);
}

function askYesNo(question, yesLabel = 'Yes', danger = false) {
  return new Promise(resolve => {
    let answered = false;
    const el = sheet('Are you sure?', `<p class="big-q">${esc(question)}</p>
      <div class="stack"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-yes>${esc(yesLabel)}</button>
      <button class="btn btn-glass btn-block" data-no>No, go back</button></div>`);
    el.querySelector('[data-yes]').onclick = () => { answered = true; closeSheet(); resolve(true); };
    el.querySelector('[data-no]').onclick = () => { closeSheet(); };
    new MutationObserver((_, o) => { if (!el.isConnected) { o.disconnect(); if (!answered) resolve(false); } }).observe(document.body, { childList: true });
  });
}

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span><span>Please wait…</span>';
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied! Now paste it into a text message or email.'); }
  catch { sheet('Copy this text', `<p class="muted">Press and hold to copy, then paste it into a text or email.</p><textarea class="input" rows="10" readonly>${esc(text)}</textarea>`); }
}

const keyOf = it => it.song_key || it.song?.default_key || '';
function setlistText(svc) {
  const lines = [`🎵 ${svc.title} — ${fmtDate(svc.service_date)}`, ''];
  svc.items.forEach((it, i) => lines.push(`${i + 1}. ${it.song?.title || 'Song'} — Key of ${keyOf(it) || '?'}${it.notes ? ` (${it.notes})` : ''}`));
  if (svc.notes) lines.push('', svc.notes);
  lines.push('', `— ${CONFIG.CHURCH_NAME} ${CONFIG.TEAM_NAME}`);
  return lines.join('\n');
}
const songSelectUrl = s => s.songselect_url ||
  (s.ccli_number ? `https://songselect.ccli.com/search/results?search=${encodeURIComponent(s.ccli_number)}`
                 : `https://songselect.ccli.com/search/results?search=${encodeURIComponent(s.title)}`);

// ── page frame ─────────────────────────────────────────────────────
const TABS = [
  ['home', 'Home', I.home, '#/home'],
  ['songs', 'Songs', I.music, '#/songs'],
  ['services', 'Sundays', I.cal, '#/services'],
  ['messages', 'Messages', I.msg, '#/messages'],
  ['me', 'Me', I.user, '#/me'],
];
function frame({ tab, title, back, actions = '' }) {
  root.innerHTML = `
    ${DEMO ? `<div class="demo-banner">Demo mode — sample data on this device only</div>` : ''}
    <header class="topbar glass">
      ${back ? `<a class="back" href="${back}">${I.back}<span>Back</span></a>` : `<a class="brand-mini" href="#/home" aria-label="Home">${LOGO}</a>`}
      <h1>${esc(title)}</h1>
      <div class="top-actions">${actions}</div>
    </header>
    <main id="main" class="page" tabindex="-1">${state.quiet && $('#main') ? $('#main').innerHTML : '<div class="loading"><span class="spinner"></span> Loading…</div>'}</main>
    <nav class="tabbar glass" aria-label="Main">
      ${TABS.map(([k, label, icon, href]) => `<a href="${href}" class="tab ${k === tab ? 'active' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${icon}<span>${label}</span>${k === 'messages' && state.unread && tab !== 'messages' ? '<i class="dot" aria-label="new"></i>' : ''}</a>`).join('')}
    </nav>`;
  if (tab === 'messages') state.unread = false;
  if (!state.quiet) window.scrollTo(0, 0);
  return ++state.renderId;
}
const fill = (rid, html) => { if (rid !== state.renderId) return null; const m = $('#main'); m.innerHTML = html; return m; };
async function load(rid, fn) {
  try { return await fn(); }
  catch (e) {
    fill(rid, `${errBox(e.message || 'Something went wrong.')}<button class="btn btn-primary btn-block" onclick="location.reload()">Try Again</button>`);
    throw e;
  }
}

// ── auth screens ───────────────────────────────────────────────────
function authShell(inner) {
  root.innerHTML = `${DEMO ? `<div class="demo-banner">Demo mode — any email &amp; password works</div>` : ''}
    <div class="auth">
      <div class="auth-brand">${LOGO}
        <div class="brand-words"><div class="brand-name">Cornerstone</div><div class="brand-sub">MISSION CHURCH</div></div>
      </div>
      <div class="auth-team">${esc(CONFIG.TEAM_NAME)}</div>
      <div class="glass card auth-card">${inner}</div>
    </div>`;  window.scrollTo(0, 0);
}
const pwField = (name, label, auto) => `<label class="field"><span>${label}</span>
  <div class="pw-wrap"><input class="input" type="password" name="${name}" autocomplete="${auto}" required>
  <button type="button" class="btn btn-ghost btn-sm pw-toggle">Show</button></div></label>`;
function bindPwToggles(el) {
  $$('.pw-toggle', el).forEach(b => b.onclick = () => {
    const i = b.previousElementSibling; const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
  });
}

function viewLogin(msg = '') {
  authShell(`
    <h2>Welcome back</h2>
    <p class="muted">Sign in with <b>your own</b> email and the password you made for this app.</p>
    ${msg}
    <form id="f" class="stack" novalidate>
      <label class="field"><span>Your email</span><input class="input" type="email" name="email" autocomplete="email" inputmode="email" required></label>
      ${pwField('password', 'Your password', 'current-password')}
      <div id="err"></div>
      <button class="btn btn-primary btn-block btn-lg">Sign In</button>
    </form>
    <div class="auth-links">
      <button class="btn btn-glass btn-block" id="join">New to the team? Create my profile</button>
      <button class="btn btn-ghost btn-block" id="forgot">I forgot my password</button>
    </div>`);
  bindPwToggles(root);
  const f = $('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    const email = f.email.value.trim(), password = f.password.value;
    if (!email || !password) return ($('#err').innerHTML = errBox('Please type your email and password.'));
    await busy(f.querySelector('button.btn-primary'), async () => {
      try { await api.signIn(email, password); await start(); }
      catch (err) { $('#err').innerHTML = errBox(err.message); }
    });
  };
  $('#join').onclick = viewSignUp;
  $('#forgot').onclick = () => {
    sheet('Reset your password', `<p>Type your email. We'll send you a link to make a new password.</p>
      <form id="rf" class="stack"><label class="field"><span>Your email</span><input class="input" type="email" name="email" required value="${esc(f.email.value)}"></label>
      <div id="rerr"></div><button class="btn btn-primary btn-block">Send Me the Link</button></form>`, el => {
      const rf = $('#rf', el);
      rf.onsubmit = async e => {
        e.preventDefault();
        await busy(rf.querySelector('button'), async () => {
          try { await api.resetPassword(rf.email.value.trim()); closeSheet(); toast('Check your email for the reset link.'); }
          catch (err) { $('#rerr', el).innerHTML = errBox(err.message); }
        });
      };
    });
  };
}

function ccliFields() {
  return `<div class="ccli-box">
    <div class="ccli-head">${I.lock}<div><b>Church CCLI login</b><div class="muted small">Ask a worship leader if you don't know it. This proves you're on the team.</div></div></div>
    <label class="field"><span>Church CCLI email</span><input class="input" type="email" name="ccli_email" autocomplete="off" inputmode="email" required></label>
    ${pwField('ccli_password', 'Church CCLI password', 'off')}
  </div>`;
}

function viewSignUp() {
  authShell(`
    <h2>Create your profile</h2>
    <p class="muted">You only do this once. After that, the app remembers you.</p>
    <form id="f" class="stack" novalidate>
      <div class="step-label">Step 1 · About you</div>
      <label class="field"><span>Your name</span><input class="input" name="name" autocomplete="name" required placeholder="e.g. Mary Smith"></label>
      <label class="field"><span>Your email</span><input class="input" type="email" name="email" autocomplete="email" inputmode="email" required></label>
      ${pwField('password', 'Make a password for this app (8 or more letters/numbers)', 'new-password')}
      <div class="step-label">Step 2 · Unlock the team</div>
      ${ccliFields()}
      <div id="err"></div>
      <button class="btn btn-primary btn-block btn-lg">Create My Profile</button>
    </form>
    <button class="btn btn-ghost btn-block" id="back">I already have a profile — Sign In</button>`);
  bindPwToggles(root);
  $('#back').onclick = () => viewLogin();
  const f = $('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    const v = k => f[k].value.trim();
    if (!v('name') || !v('email')) return ($('#err').innerHTML = errBox('Please type your name and email.'));
    if (f.password.value.length < 8) return ($('#err').innerHTML = errBox('Your password needs to be at least 8 characters long.'));
    if (!v('ccli_email') || !f.ccli_password.value) return ($('#err').innerHTML = errBox('Please type the church CCLI email and password.'));
    await busy(f.querySelector('button.btn-primary'), async () => {
      try {
        const { needsEmailConfirm } = await api.signUp(v('name'), v('email'), f.password.value);
        if (needsEmailConfirm) {
          viewLogin(`<div class="alert info">Almost done! Check your email and tap the link to confirm, then sign in here.</div>`);
          return;
        }
        try { await api.joinTeam(v('ccli_email'), f.ccli_password.value); }
        catch (err) { await start(); $('#err') && ($('#err').innerHTML = errBox(err.message)); return; }
        await start();
        toast(`Welcome to the team, ${firstName(v('name'))}!`);
      } catch (err) { $('#err').innerHTML = errBox(err.message); }
    });
  };
}

function viewUnlock() {
  authShell(`
    <h2>Hi ${esc(firstName(state.profile?.full_name))}! One more step</h2>
    <p class="muted">Type the church's CCLI login to unlock the team app. You only have to do this once.</p>
    <form id="f" class="stack" novalidate>
      ${ccliFields()}
      <div id="err"></div>
      <button class="btn btn-primary btn-block btn-lg">Unlock</button>
    </form>
    <button class="btn btn-ghost btn-block" id="out">Sign Out</button>`);
  bindPwToggles(root);
  $('#out').onclick = async () => { await api.signOut(); viewLogin(); };
  const f = $('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    await busy(f.querySelector('button.btn-primary'), async () => {
      try { await api.joinTeam(f.ccli_email.value.trim(), f.ccli_password.value); await start(); toast("You're in! Welcome to the team."); }
      catch (err) { $('#err').innerHTML = errBox(err.message); }
    });
  };
}

function newPasswordSheet() {
  sheet('Make a new password', `<form id="np" class="stack">${pwField('password', 'New password (8 or more)', 'new-password')}
    <div id="nperr"></div><button class="btn btn-primary btn-block">Save New Password</button></form>`, el => {
    bindPwToggles(el);
    const f = $('#np', el);
    f.onsubmit = async e => {
      e.preventDefault();
      if (f.password.value.length < 8) return ($('#nperr', el).innerHTML = errBox('Please use at least 8 characters.'));
      await busy(f.querySelector('.btn-primary'), async () => {
        try { await api.updatePassword(f.password.value); closeSheet(); toast('Password saved!'); }
        catch (err) { $('#nperr', el).innerHTML = errBox(err.message); }
      });
    };
  });
}

// ── HOME ───────────────────────────────────────────────────────────
const keyPill = k => `<span class="key-pill" aria-label="Key of ${esc(k || 'not set')}">${esc(k || '—')}</span>`;
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

async function viewHome() {
  const rid = frame({ tab: 'home', title: 'Home' });
  const [services, messages] = await load(rid, () => Promise.all([api.services.list(), api.messages.list()]));
  const next = services.find(s => s.service_date >= today());
  fill(rid, `
    <h2 class="hello">${greeting()}, ${esc(firstName(state.profile.full_name))}!</h2>
    <section class="glass card hero">
      <div class="eyebrow">Next Service</div>
      ${next ? `
        <div class="hero-date">${esc(fmtDate(next.service_date))}</div>
        <div class="muted">${esc(next.title)}</div>
        ${next.items.length ? `<ol class="mini-list">${next.items.map(it => `<li><span>${esc(it.song?.title)}</span>${keyPill(keyOf(it))}</li>`).join('')}</ol>`
          : `<p class="muted">Songs haven't been picked yet.</p>`}
        <a class="btn btn-primary btn-block" href="#/services/${next.id}">See the Full Set List</a>`
      : `<p class="muted">No service has been planned yet.</p>`}
    </section>
    <section class="glass card">
      <div class="row-between"><div class="eyebrow">From the Leaders</div><a href="#/messages" class="link">See all</a></div>
      ${messages.length ? messages.slice(0, 2).map(msgCard).join('') : `<p class="muted">No messages yet.</p>`}
    </section>
    ${isAdmin() ? `<section class="glass card">
      <div class="eyebrow">Leader Tools</div>
      <div class="grid2 tools">
        <button class="btn btn-glass tall" data-a="plan">${I.cal}<span>Plan a Service</span></button>
        <button class="btn btn-glass tall" data-a="msg">${I.send}<span>Send a Message</span></button>
        <button class="btn btn-glass tall" data-a="song">${I.plus}<span>Add a Song</span></button>
        <a class="btn btn-glass tall" href="#/team">${I.people}<span>Team Members</span></a>
      </div></section>` : ''}`);
  const m = $('#main');
  if (!m) return;
  $('[data-a=plan]', m)?.addEventListener('click', () => serviceEditor());
  $('[data-a=msg]', m)?.addEventListener('click', () => messageEditor());
  $('[data-a=song]', m)?.addEventListener('click', () => songEditor());
}

const msgCard = (m, names) => `<article class="msg">
  <div class="msg-title">${esc(m.title)}</div>
  ${m.body ? `<div class="msg-body">${nl2br(m.body)}</div>` : ''}
  <div class="msg-meta">${esc(m.author_name || 'Leader')} · ${esc(timeAgo(m.created_at))}</div>
  ${m.recipient_ids ? `<div class="msg-to">${I.lock}<span>${names
    ? 'To: ' + esc(m.recipient_ids.map(id => names[id] || 'someone').join(', '))
    : 'Private message'}</span></div>` : ''}
  ${m.service_id ? `<a class="btn btn-glass btn-sm" href="#/services/${m.service_id}">${I.cal}<span>Open Set List</span></a>` : ''}
</article>`;

// ── SONGS ──────────────────────────────────────────────────────────
async function viewSongs() {
  const rid = frame({ tab: 'songs', title: 'Songs' });
  const songs = await load(rid, () => api.songs.list());
  const m = fill(rid, `
    ${isAdmin() ? `<div class="grid2 add-row">
      <button class="btn btn-primary" id="add">${I.plus}<span>Add a Song</span></button>
      <button class="btn btn-glass" id="addmany">${I.plus}<span>Add Many Songs</span></button></div>` : ''}
    <label class="search glass">${I.search}<input class="input" type="search" id="q" placeholder="Search songs or artists" aria-label="Search songs"></label>
    <div id="count" class="muted small"></div>
    <div id="list" class="list"></div>`);
  if (!m) return;
  $('#add')?.addEventListener('click', () => songEditor({ title: $('#q').value.trim() }));
  $('#addmany')?.addEventListener('click', () => bulkAddSheet(songs));
  $('#list').addEventListener('click', e => { if (e.target.closest('#addq')) songEditor({ title: $('#q').value.trim() }); });
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const hits = songs.filter(s => !q || `${s.title} ${s.artist} ${s.ccli_number}`.toLowerCase().includes(q));
    $('#count').textContent = `${hits.length} song${hits.length === 1 ? '' : 's'}`;
    $('#list').innerHTML = hits.length ? hits.map(s => `
      <a class="row glass" href="#/songs/${s.id}">
        <div class="row-main"><div class="row-title">${esc(s.title)}</div><div class="row-sub">${esc(s.artist || '')}</div></div>
        ${keyPill(s.default_key)}
      </a>`).join('') : `<p class="empty">${songs.length ? `“${esc($('#q').value.trim())}” isn't in our list yet.` : 'No songs yet.' + (isAdmin() ? ' Tap “Add Many Songs” to bring in your whole list at once.' : '')}</p>`
      + (q ? `<div class="stack">
          <a class="btn btn-glass btn-block" target="_blank" rel="noopener" href="https://songselect.ccli.com/search/results?search=${encodeURIComponent($('#q').value.trim())}">${I.ext}<span>Search SongSelect</span></a>
          ${isAdmin() ? `<button class="btn btn-primary btn-block" id="addq">${I.plus}<span>Add “${esc($('#q').value.trim())}”</span></button>` : ''}</div>` : '');
  };
  $('#q').addEventListener('input', draw);
  draw();
}

async function viewSong(id) {
  const rid = frame({ tab: 'songs', title: 'Song', back: '#/songs' });
  const s = await load(rid, () => api.songs.get(id));
  const m = fill(rid, `
    <section class="glass card">
      <h2 class="song-title">${esc(s.title)}</h2>
      ${s.artist ? `<div class="muted big">${esc(s.artist)}</div>` : ''}
      <div class="facts">
        <div class="fact"><span>Key</span><b>${esc(s.default_key || '—')}</b></div>
        <div class="fact"><span>Tempo</span><b>${s.tempo ? esc(s.tempo) + ' bpm' : '—'}</b></div>
        <div class="fact"><span>Time</span><b>${esc(s.time_signature || '—')}</b></div>
        <div class="fact"><span>CCLI #</span><b>${esc(s.ccli_number || '—')}</b></div>
      </div>
      <a class="btn btn-primary btn-block btn-lg" href="${esc(songSelectUrl(s))}" target="_blank" rel="noopener">${I.ext}<span>Open in SongSelect</span></a>
      <p class="muted small center">Chord charts &amp; lyrics open in SongSelect using the church CCLI account.</p>
      <button class="btn btn-glass btn-block" id="sharekey">${I.share}<span>Share the Key With the Team</span></button>
    </section>
    ${s.notes ? `<section class="glass card"><div class="eyebrow">Notes</div><div class="notes">${nl2br(s.notes)}</div></section>` : ''}
    ${isAdmin() ? `<section class="glass card"><div class="eyebrow">Leader Tools</div><div class="stack">
      <button class="btn btn-glass btn-block" id="edit">${I.edit}<span>Edit This Song</span></button>
      <button class="btn btn-danger-ghost btn-block" id="del">${I.trash}<span>Delete This Song</span></button></div></section>` : ''}`);
  if (!m) return;
  $('#sharekey').onclick = () => shareKeySheet(s);
  $('#edit')?.addEventListener('click', () => songEditor(s));
  $('#del')?.addEventListener('click', async () => {
    if (!(await askYesNo(`Delete “${s.title}”? It will also be removed from any set lists.`, 'Yes, Delete It', true))) return;
    try { await api.songs.remove(s.id); toast('Song deleted.'); location.hash = '#/songs'; } catch (e) { toast(e.message, 'bad'); }
  });
}

function bulkAddSheet(existing) {
  sheet('Add many songs', `
    <p>Paste your song list below, <b>one song per line</b>, like this:</p>
    <pre class="example">Goodness of God, Bethel Music, 7117726, G
Way Maker, Sinach, 7115744, E
Build My Life</pre>
    <p class="muted small">Only the title is required. You can also paste SongSelect links (one per line), or a list copied from a spreadsheet.</p>
    <textarea class="input" id="bulk" rows="7" placeholder="Paste songs here…"></textarea>
    <label class="btn btn-glass btn-block file-btn">${I.plus}<span>Or choose a spreadsheet file (.csv)</span>
      <input type="file" id="bulkfile" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></label>
    <p class="muted small">Tip: Planning Center, ProPresenter and your CCLI song report can all save your song list as a .csv file.</p>
    <div id="preview"></div>`, el => {
    const ta = $('#bulk', el);
    let ready = [];
    const preview = () => {
      const { add, skipped } = dedupe(parseSongs(ta.value), existing);
      ready = add;
      $('#preview', el).innerHTML = !ta.value.trim() ? '' : `
        <div class="eyebrow" style="margin-top:14px">Ready to add ${add.length} song${add.length === 1 ? '' : 's'}</div>
        ${skipped.length ? `<p class="muted small">${skipped.length} already in the app, so they'll be skipped.</p>` : ''}
        <div class="list preview-list">${add.slice(0, 60).map(s => `<div class="row glass"><div class="row-main"><div class="row-title">${esc(s.title)}</div>
          <div class="row-sub">${esc([s.artist, s.ccli_number && 'CCLI ' + s.ccli_number].filter(Boolean).join(' · '))}</div></div>${s.default_key ? keyPill(s.default_key) : ''}</div>`).join('')}
          ${add.length > 60 ? `<p class="muted small center">…and ${add.length - 60} more</p>` : ''}</div>
        ${add.length ? `<button class="btn btn-primary btn-block btn-lg" id="doadd">${I.plus}<span>Add ${add.length} Song${add.length === 1 ? '' : 's'}</span></button>` : ''}`;
    };
    ta.addEventListener('input', preview);
    $('#bulkfile', el).addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      ta.value = await file.text(); preview(); toast(`Opened ${file.name}`);
    });
    $('#preview', el).addEventListener('click', async e => {
      const b = e.target.closest('#doadd'); if (!b) return;
      await busy(b, async () => {
        try { const n = await api.songs.saveMany(ready); closeSheet(); toast(`Added ${n} songs!`); route(); }
        catch (err) { toast(err.message, 'bad'); }
      });
    });
  });
}

function shareKeySheet(s) {
  sheet('Share the key', `
    <p class="muted">Pick the key we'll play <b>${esc(s.title)}</b> in.</p>
    <div class="key-grid">${MAJOR.map(k => `<button type="button" class="key-btn ${k === s.default_key ? 'on' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <details class="more"><summary>Minor keys</summary><div class="key-grid">${MAJOR.map(k => k + 'm').map(k => `<button type="button" class="key-btn ${k === s.default_key ? 'on' : ''}" data-k="${k}">${k}</button>`).join('')}</div></details>
    <label class="field"><span>When? (optional)</span><input class="input" id="when" placeholder="e.g. this Sunday"></label>
    <div class="stack">
      <button class="btn btn-primary btn-block" id="go">${I.share}<span>Share by Text or Email</span></button>
      ${isAdmin() ? `<button class="btn btn-glass btn-block" id="post">${I.send}<span>Send in This App…</span></button>` : ''}
    </div>`, el => {
    let key = s.default_key || '';
    $$('.key-btn', el).forEach(b => b.onclick = () => { $$('.key-btn', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); key = b.dataset.k; });
    const text = () => `🎵 ${s.title}${s.artist ? ` (${s.artist})` : ''} — we'll be in the key of ${key || '?'}${$('#when', el).value.trim() ? ' ' + $('#when', el).value.trim() : ''}.`;
    $('#go', el).onclick = () => { if (!key) return toast('Please pick a key first.', 'bad'); shareText(s.title, text()); };
    $('#post', el)?.addEventListener('click', () => {
      if (!key) return toast('Please pick a key first.', 'bad');
      messageEditor({ title: `${s.title} — Key of ${key}`, body: text() });
    });
  });
}

function songEditor(s = {}) {
  sheet(s.id ? 'Edit song' : 'Add a song', `
    <form id="sf" class="stack" novalidate>
      ${s.id ? '' : `<div class="ccli-box"><div class="ccli-head">${I.ext}<div><b>Fastest way:</b> open the song on SongSelect, copy the web address, and paste it here. The title and CCLI # fill in for you.</div></div>
        <input class="input" id="sslink" inputmode="url" placeholder="Paste SongSelect link here"></div>`}
      <label class="field"><span>Song title *</span><input class="input" name="title" required value="${esc(s.title)}"></label>
      <label class="field"><span>Artist / writer</span><input class="input" name="artist" value="${esc(s.artist)}"></label>
      <label class="field"><span>CCLI song number</span><input class="input" name="ccli_number" inputmode="numeric" value="${esc(s.ccli_number)}" placeholder="Found on the SongSelect page"></label>
      <div class="grid2">
        <label class="field"><span>Usual key</span><select class="input" name="default_key">${keyOptions(s.default_key)}</select></label>
        <label class="field"><span>Tempo (bpm)</span><input class="input" name="tempo" inputmode="numeric" value="${esc(s.tempo ?? '')}"></label>
      </div>
      <label class="field"><span>Time signature</span><select class="input" name="time_signature"><option value="">—</option>${['4/4', '3/4', '6/8', '2/4', '12/8'].map(t => `<option ${t === s.time_signature ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>SongSelect link (optional)</span><input class="input" name="songselect_url" type="url" value="${esc(s.songselect_url)}" placeholder="Paste the song's SongSelect web address"></label>
      <label class="field"><span>Notes for the team</span><textarea class="input" name="notes" rows="3">${esc(s.notes)}</textarea></label>
      <div id="serr"></div>
      <button class="btn btn-primary btn-block btn-lg">${s.id ? 'Save Changes' : 'Add Song'}</button>
    </form>`, el => {
    const f = $('#sf', el);
    $('#sslink', el)?.addEventListener('input', e => {
      const info = parseSongSelectUrl(e.target.value);
      if (!info) return;
      if (info.title) f.title.value = info.title;
      f.ccli_number.value = info.ccli_number;
      f.songselect_url.value = info.songselect_url;
      toast('Filled in from SongSelect!');
      (f.artist.value ? f.default_key : f.artist).focus();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      d.title = d.title.trim();
      if (!d.title) return ($('#serr', el).innerHTML = errBox('Please type the song title.'));
      d.tempo = d.tempo ? parseInt(d.tempo, 10) || null : null;
      if (d.songselect_url && !/^https:\/\//i.test(d.songselect_url)) return ($('#serr', el).innerHTML = errBox('The SongSelect link should start with https://'));
      await busy(f.querySelector('.btn-primary'), async () => {
        try {
          const saved = await api.songs.save({ ...d, id: s.id });
          closeSheet(); toast(s.id ? 'Song saved!' : 'Song added!');
          if (location.hash === `#/songs/${saved.id}`) route(); else location.hash = `#/songs/${saved.id}`;
        } catch (err) { $('#serr', el).innerHTML = errBox(err.message); }
      });
    };
  });
}

// ── SERVICES / SET LISTS ───────────────────────────────────────────
async function viewServices() {
  const rid = frame({ tab: 'services', title: 'Sundays', actions: isAdmin() ? `<button class="btn btn-primary btn-sm" id="add">${I.plus}<span>Plan</span></button>` : '' });
  $('#add')?.addEventListener('click', () => serviceEditor());
  const list = await load(rid, () => api.services.list());
  const up = list.filter(s => s.service_date >= today());
  const past = list.filter(s => s.service_date < today()).reverse().slice(0, 12);
  const card = s => `<a class="row glass svc-row" href="#/services/${s.id}">
    <div class="date-chip"><b>${esc(parseDate(s.service_date).getDate())}</b><span>${esc(parseDate(s.service_date).toLocaleDateString(undefined, { month: 'short' }))}</span></div>
    <div class="row-main"><div class="row-title">${esc(s.title)}</div>
    <div class="row-sub">${s.items.length ? esc(s.items.map(i => `${i.song?.title} (${keyOf(i) || '?'})`).join(' · ')) : 'No songs yet'}</div></div></a>`;
  fill(rid, `
    <h2 class="section-h">Coming Up</h2>
    <div class="list">${up.length ? up.map(card).join('') : `<p class="empty">Nothing planned yet.</p>`}</div>
    ${past.length ? `<h2 class="section-h">Past Services</h2><div class="list past">${past.map(card).join('')}</div>` : ''}`);
}

async function viewService(id) {
  const rid = frame({ tab: 'services', title: 'Set List', back: '#/services' });
  const svc = await load(rid, () => api.services.get(id));
  const m = fill(rid, `
    <section class="glass card">
      <div class="eyebrow">${esc(svc.title)}</div>
      <h2 class="hero-date">${esc(fmtDate(svc.service_date))}</h2>
      ${svc.notes ? `<div class="notes">${nl2br(svc.notes)}</div>` : ''}
    </section>
    <ol class="setlist">
      ${svc.items.length ? svc.items.map((it, i) => `<li class="glass set-item">
        <div class="num">${i + 1}</div>
        <a class="set-main" href="#/songs/${it.song_id}"><div class="row-title">${esc(it.song?.title)}</div>
          ${it.song?.artist ? `<div class="row-sub">${esc(it.song.artist)}</div>` : ''}
          ${it.notes ? `<div class="set-note">${esc(it.notes)}</div>` : ''}</a>
        <div class="big-key"><span>Key</span><b>${esc(keyOf(it) || '—')}</b></div>
      </li>`).join('') : `<p class="empty">No songs have been added yet.</p>`}
    </ol>
    <div class="stack">
      <button class="btn btn-primary btn-block btn-lg" id="share">${I.share}<span>Share by Text or Email</span></button>
      ${isAdmin() ? `
        <button class="btn btn-glass btn-block" id="post">${I.send}<span>Send in This App…</span></button>
        <button class="btn btn-glass btn-block" id="edit">${I.edit}<span>Edit This Service</span></button>
        <button class="btn btn-danger-ghost btn-block" id="del">${I.trash}<span>Delete This Service</span></button>` : ''}
    </div>`);
  if (!m) return;
  $('#share').onclick = () => shareText(`${svc.title} — ${fmtDate(svc.service_date)}`, setlistText(svc));
  $('#post')?.addEventListener('click', () =>
    messageEditor({ title: `Set list for ${fmtDate(svc.service_date)}`, body: setlistText(svc), service_id: svc.id }));
  $('#edit')?.addEventListener('click', () => serviceEditor(svc));
  $('#del')?.addEventListener('click', async () => {
    if (!(await askYesNo(`Delete the ${fmtDate(svc.service_date)} service?`, 'Yes, Delete It', true))) return;
    try { await api.services.remove(svc.id); toast('Service deleted.'); location.hash = '#/services'; } catch (e) { toast(e.message, 'bad'); }
  });
}

async function serviceEditor(svc = null) {
  let songs = [];
  try { songs = await api.songs.list(); } catch (e) { return toast(e.message, 'bad'); }
  const items = (svc?.items || []).map(it => ({ song_id: it.song_id, song_key: it.song_key, notes: it.notes, song: it.song }));
  const el = sheet(svc ? 'Edit service' : 'Plan a service', `
    <form id="vf" class="stack" novalidate>
      <div class="grid2">
        <label class="field"><span>Date</span><input class="input" type="date" name="service_date" required value="${esc(svc?.service_date || nextSunday())}"></label>
        <label class="field"><span>Name</span><input class="input" name="title" value="${esc(svc?.title || 'Sunday Service')}"></label>
      </div>
      <label class="field"><span>Notes for the team (optional)</span><textarea class="input" name="notes" rows="2" placeholder="e.g. Sound check at 8:30">${esc(svc?.notes || '')}</textarea></label>
      <div class="eyebrow">Songs</div>
      <div id="items" class="stack"></div>
      <button type="button" class="btn btn-glass btn-block" id="addsong">${I.plus}<span>Add a Song</span></button>
      <div id="picker" class="picker" hidden>
        <label class="search glass">${I.search}<input class="input" id="pq" type="search" placeholder="Search songs" aria-label="Search songs"></label>
        <div id="plist" class="list"></div>
      </div>
      <div id="verr"></div>
      <button class="btn btn-primary btn-block btn-lg" id="save">${svc ? 'Save Changes' : 'Save Service'}</button>
    </form>`);
  const drawItems = () => {
    $('#items', el).innerHTML = items.length ? items.map((it, i) => `
      <div class="edit-item glass" data-i="${i}">
        <div class="edit-top"><div class="num">${i + 1}</div><div class="row-title">${esc(it.song?.title)}</div>
          <button type="button" class="icon-btn" data-act="rm" aria-label="Remove ${esc(it.song?.title)}">${I.x}</button></div>
        <div class="grid2">
          <label class="field"><span>Key</span><select class="input" data-f="song_key">${keyOptions(it.song_key || it.song?.default_key)}</select></label>
          <div class="move"><button type="button" class="icon-btn" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${I.up}</button>
            <button type="button" class="icon-btn" data-act="down" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>${I.down}</button></div>
        </div>
        <label class="field"><span>Note (optional)</span><input class="input" data-f="notes" value="${esc(it.notes || '')}" placeholder="e.g. Grace leads"></label>
      </div>`).join('') : `<p class="empty">No songs yet. Tap “Add a Song”.</p>`;
    items.forEach((it, i) => { if (!it.song_key) it.song_key = it.song?.default_key || ''; });
  };
  $('#items', el).addEventListener('change', e => {
    const box = e.target.closest('[data-i]'); if (!box || !e.target.dataset.f) return;
    items[+box.dataset.i][e.target.dataset.f] = e.target.value;
  });
  $('#items', el).addEventListener('input', e => {
    const box = e.target.closest('[data-i]'); if (!box || e.target.dataset.f !== 'notes') return;
    items[+box.dataset.i].notes = e.target.value;
  });
  $('#items', el).addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = +b.closest('[data-i]').dataset.i;
    if (b.dataset.act === 'rm') items.splice(i, 1);
    if (b.dataset.act === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    if (b.dataset.act === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
    drawItems();
  });
  const drawPick = () => {
    const q = $('#pq', el).value.trim().toLowerCase();
    const hits = songs.filter(s => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q)).slice(0, 40);
    $('#plist', el).innerHTML = hits.length ? hits.map(s => `<button type="button" class="row glass" data-sid="${s.id}">
      <div class="row-main"><div class="row-title">${esc(s.title)}</div><div class="row-sub">${esc(s.artist)}</div></div>${keyPill(s.default_key)}</button>`).join('')
      : `<p class="empty">${songs.length ? 'No match.' : 'Add songs in the Songs tab first.'}</p>`;
  };
  $('#addsong', el).onclick = () => { const p = $('#picker', el); p.hidden = !p.hidden; if (!p.hidden) { drawPick(); $('#pq', el).focus(); } };
  $('#pq', el).addEventListener('input', drawPick);
  $('#plist', el).addEventListener('click', e => {
    const b = e.target.closest('[data-sid]'); if (!b) return;
    const s = songs.find(x => x.id === b.dataset.sid);
    items.push({ song_id: s.id, song_key: s.default_key || '', notes: '', song: s });
    $('#picker', el).hidden = true; $('#pq', el).value = '';
    drawItems(); toast(`Added “${s.title}”`);
  });
  drawItems();
  const f = $('#vf', el);
  f.onsubmit = async e => {
    e.preventDefault();
    if (!f.service_date.value) return ($('#verr', el).innerHTML = errBox('Please pick a date.'));
    await busy($('#save', el), async () => {
      try {
        const saved = await api.services.save({ id: svc?.id, service_date: f.service_date.value, title: f.title.value.trim() || 'Sunday Service', notes: f.notes.value.trim() }, items);
        closeSheet(); toast('Service saved!');
        if (location.hash === `#/services/${saved.id}`) route(); else location.hash = `#/services/${saved.id}`;
      } catch (err) { $('#verr', el).innerHTML = errBox(err.message); }
    });
  };
}

// ── MESSAGES ───────────────────────────────────────────────────────
async function viewMessages() {
  const rid = frame({ tab: 'messages', title: 'Messages', actions: isAdmin() ? `<button class="btn btn-primary btn-sm" id="add">${I.plus}<span>New</span></button>` : '' });
  $('#add')?.addEventListener('click', () => messageEditor());
  const [msgs, team] = await load(rid, () => Promise.all([api.messages.list(), api.team.list()]));
  const names = Object.fromEntries(team.map(t => [t.id, t.id === state.profile.id ? 'You' : t.full_name]));
  const m = fill(rid, msgs.length ? `<div class="stack">${msgs.map(x => `<div class="glass card">${msgCard(x, names)}
      ${isAdmin() ? `<button class="btn btn-danger-ghost btn-sm" data-del="${x.id}">${I.trash}<span>Delete</span></button>` : ''}</div>`).join('')}</div>`
    : `<p class="empty">No messages yet.</p>`);
  m?.addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!(await askYesNo('Delete this message for everyone?', 'Yes, Delete It', true))) return;
    try { await api.messages.remove(b.dataset.del); toast('Message deleted.'); route(); } catch (err) { toast(err.message, 'bad'); }
  });
}

async function messageEditor(pre = {}) {
  let team = [];
  try { team = (await api.team.list()).filter(t => t.role !== 'pending' && t.id !== state.profile.id); }
  catch (e) { return toast(e.message, 'bad'); }
  const rolesInUse = sortRoles([...new Set(team.flatMap(t => t.positions || []))]);
  const idsFor = r => team.filter(t => (t.positions || []).includes(r)).map(t => t.id);
  const picked = new Set();
  let mode = 'all';
  sheet('Send a message', `
    <form id="mf" class="stack" novalidate>
      <div class="field"><span>Who should get it?</span>
        <div class="seg two" role="radiogroup" aria-label="Who should get it">
          <button type="button" class="seg-btn on" data-mode="all" role="radio" aria-checked="true">Everyone</button>
          <button type="button" class="seg-btn" data-mode="pick" role="radio" aria-checked="false">Choose People</button>
        </div>
      </div>
      <div id="pick" class="pick-box" hidden>
        ${rolesInUse.length ? `<p class="muted small">Tap a role to pick everyone who has it:</p>
          <div class="chip-row">${rolesInUse.map(r => `<button type="button" class="chip" data-role="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join('')}</div>
          <p class="muted small">…or tap people one at a time:</p>`
        : `<p class="muted small">Tip: give people roles (Bass, Vocals…) on the Team Members page so you can pick them by role.</p>`}
        <div class="people-pick">${team.length ? team.map(t => `<label class="pick-row">
            <input type="checkbox" value="${t.id}">
            <span class="row-main"><span class="row-title">${esc(t.full_name || t.email)}</span>
            ${(t.positions || []).length ? `<span class="row-sub">${esc(sortRoles(t.positions).join(' · '))}</span>` : ''}</span></label>`).join('')
          : `<p class="empty">No one else is on the team yet.</p>`}</div>
      </div>
      <div id="pickcount" class="pick-count" aria-live="polite"></div>
      <label class="field"><span>Subject</span><input class="input" name="title" required value="${esc(pre.title || '')}" placeholder="e.g. Rehearsal moved to Thursday"></label>
      <label class="field"><span>Message</span><textarea class="input" name="body" rows="6">${esc(pre.body || '')}</textarea></label>
      <div id="merr"></div>
      <button class="btn btn-primary btn-block btn-lg" id="msend">${I.send}<span>Send to Everyone</span></button>
    </form>`, el => {
    const f = $('#mf', el);
    const sync = () => {
      $$('.pick-row input', el).forEach(i => { i.checked = picked.has(i.value); i.closest('.pick-row').classList.toggle('on', i.checked); });
      $$('.chip[data-role]', el).forEach(c => {
        const ids = idsFor(c.dataset.role), on = ids.length > 0 && ids.every(id => picked.has(id));
        c.classList.toggle('on', on); c.setAttribute('aria-pressed', on);
      });
      const n = picked.size;
      $('#pickcount', el).textContent = mode !== 'pick' ? '' : n
        ? `Sending to ${n} ${n === 1 ? 'person' : 'people'}: ${team.filter(t => picked.has(t.id)).map(t => t.full_name).join(', ')}`
        : 'Nobody picked yet.';
      $('#msend span', el).textContent = mode === 'all' ? 'Send to Everyone' : `Send to ${n} ${n === 1 ? 'Person' : 'People'}`;
    };
    $$('[data-mode]', el).forEach(b => b.onclick = () => {
      mode = b.dataset.mode;
      $$('[data-mode]', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      $('#pick', el).hidden = mode !== 'pick';
      sync();
    });
    el.addEventListener('change', e => {
      if (!e.target.matches('.pick-row input')) return;
      e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value);
      sync();
    });
    $$('.chip[data-role]', el).forEach(c => c.onclick = () => {
      const ids = idsFor(c.dataset.role), all = ids.every(id => picked.has(id));
      ids.forEach(id => all ? picked.delete(id) : picked.add(id));
      sync();
    });
    sync();
    f.onsubmit = async e => {
      e.preventDefault();
      if (!f.title.value.trim()) return ($('#merr', el).innerHTML = errBox('Please type a subject.'));
      if (mode === 'pick' && !picked.size) return ($('#merr', el).innerHTML = errBox('Please pick at least one person, or choose Everyone.'));
      await busy($('#msend', el), async () => {
        try {
          await api.messages.post({ title: f.title.value.trim(), body: f.body.value.trim(), service_id: pre.service_id || null,
            author_name: state.profile.full_name, recipient_ids: mode === 'pick' ? [...picked] : null });
          closeSheet();
          toast(mode === 'pick' ? `Sent to ${picked.size} ${picked.size === 1 ? 'person' : 'people'}!` : 'Sent to the team!');
          if (location.hash === '#/messages') route(); else location.hash = '#/messages';
        } catch (err) { $('#merr', el).innerHTML = errBox(err.message); }
      });
    };
  });
}

// ── ME / SETTINGS ──────────────────────────────────────────────────
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function viewMe() {
  const rid = frame({ tab: 'me', title: 'Me' });
  const p = state.profile;
  const size = store.get('textSize') || 'normal';
  let secret = null;
  if (isAdmin()) { try { secret = await api.teamSecretStatus(); } catch {} }
  const m = fill(rid, `
    <section class="glass card">
      <div class="me-head"><div class="avatar">${esc(firstName(p.full_name)[0]?.toUpperCase() || '?')}</div>
        <div><div class="row-title">${esc(p.full_name || 'No name')}</div><div class="row-sub">${esc(p.email)}</div>
        <span class="role-tag ${p.role}">${p.role === 'admin' ? 'Leader' : 'Team Member'}</span>${roleChips(p.positions)}</div></div>
      <button class="btn btn-glass btn-block" id="rename">${I.edit}<span>Change My Name</span></button>
    </section>

    <section class="glass card">
      <div class="eyebrow">Text Size</div>
      <div class="seg" role="radiogroup" aria-label="Text size">
        ${[['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra Large']].map(([v, l]) => `<button role="radio" aria-checked="${size === v}" class="seg-btn ${size === v ? 'on' : ''}" data-size="${v}">${l}</button>`).join('')}
      </div>
    </section>

    <section class="glass card">
      <div class="eyebrow">Put the App on Your Phone or Computer</div>
      ${isStandalone() ? `<p class="ok-line">${I.check} The app is installed on this device.</p>` : `
        ${installPrompt ? `<button class="btn btn-primary btn-block" id="install">${I.phone}<span>Install the App</span></button>` : ''}
        ${isIOS() ? `<ol class="howto"><li>Tap the <b>Share</b> button at the bottom of Safari (the square with an arrow pointing up).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. The app now sits on your home screen!</li></ol>`
          : `<ol class="howto"><li><b>Android:</b> tap the <b>⋮</b> menu in Chrome, then <b>Install app</b> or <b>Add to Home screen</b>.</li><li><b>Computer:</b> click the install icon at the right end of the address bar in Chrome or Edge.</li></ol>`}`}
    </section>

    ${isAdmin() ? `<section class="glass card">
      <div class="eyebrow">Leader Settings</div>
      <a class="btn btn-glass btn-block" href="#/team">${I.people}<span>Team Members</span></a>
      <button class="btn btn-glass btn-block" id="secret">${I.lock}<span>${secret ? 'Change' : 'Set Up'} Church CCLI Login</span></button>
      <p class="muted small">${secret ? `New members unlock the app with <b>${esc(secret.ccli_email)}</b>. Last changed ${esc(timeAgo(secret.updated_at))}. If the church changes its CCLI password, update it here too.`
        : `<b>Not set up yet.</b> New members can't join until you add the church CCLI login here.`}</p>
    </section>` : ''}

    <button class="btn btn-danger-ghost btn-block btn-lg" id="out">Sign Out</button>
    <p class="muted small center">${esc(CONFIG.CHURCH_NAME)} · ${esc(CONFIG.TEAM_NAME)}</p>`);
  if (!m) return;
  $$('[data-size]', m).forEach(b => b.onclick = () => { store.set('textSize', b.dataset.size); applyTextSize(); viewMe(); });
  $('#install')?.addEventListener('click', async () => { await installPrompt.prompt(); installPrompt = null; viewMe(); });
  $('#out').onclick = async () => { if (await askYesNo('Sign out of the app?', 'Yes, Sign Out')) { await api.signOut(); state.profile = null; viewLogin(); } };
  $('#rename').onclick = () => sheet('Change my name', `<form id="nf" class="stack"><label class="field"><span>Your name</span><input class="input" name="n" value="${esc(p.full_name)}" required></label>
    <button class="btn btn-primary btn-block">Save</button></form>`, el => {
    const f = $('#nf', el);
    f.onsubmit = async e => { e.preventDefault(); const n = f.n.value.trim(); if (!n) return;
      try { await api.updateMyName(n); state.profile.full_name = n; closeSheet(); toast('Name saved!'); viewMe(); } catch (err) { toast(err.message, 'bad'); } };
  });
  $('#secret')?.addEventListener('click', () => sheet('Church CCLI login', `
    <p class="muted">Type the church's SongSelect (CCLI) email and password. New members must type this same login once to join. The password is scrambled before it's saved, so no one can read it back, not even leaders.</p>
    <form id="cf" class="stack" novalidate>
      <label class="field"><span>Church CCLI email</span><input class="input" type="email" name="e" required value="${esc(secret?.ccli_email || '')}" autocomplete="off"></label>
      ${pwField('p', 'Church CCLI password', 'off')}
      <div id="cerr"></div>
      <button class="btn btn-primary btn-block">Save</button>
    </form>`, el => {
    bindPwToggles(el);
    const f = $('#cf', el);
    f.onsubmit = async e => {
      e.preventDefault();
      if (!f.e.value.trim() || !f.p.value) return ($('#cerr', el).innerHTML = errBox('Please type both the email and password.'));
      await busy(f.querySelector('.btn-primary'), async () => {
        try { await api.setTeamSecret(f.e.value.trim(), f.p.value); closeSheet(); toast('Church CCLI login saved!'); viewMe(); }
        catch (err) { $('#cerr', el).innerHTML = errBox(err.message); }
      });
    };
  }));
}

async function viewTeam() {
  if (!isAdmin()) { location.hash = '#/me'; return; }
  const rid = frame({ tab: 'me', title: 'Team Members', back: '#/me' });
  const team = await load(rid, () => api.team.list());
  const group = (label, list, empty) => `<h2 class="section-h">${label} <span class="count">${list.length}</span></h2>
    <div class="stack">${list.length ? list.map(t => `<div class="glass card person">
      <div class="me-head"><div class="avatar sm">${esc((t.full_name || '?')[0].toUpperCase())}</div>
        <div class="row-main"><div class="row-title">${esc(t.full_name || '(no name)')}${t.id === state.profile.id ? ' <span class="muted small">(you)</span>' : ''}</div>
        <div class="row-sub">${esc(t.email)}</div>
        ${roleChips(t.positions) || '<div class="muted small">No roles yet</div>'}</div></div>
      <div class="stack">
        <button class="btn btn-glass btn-block" data-roles="${t.id}">${I.music}<span>Set Roles</span></button>
        ${t.id === state.profile.id ? '' : t.role === 'pending' ? `<button class="btn btn-primary btn-block" data-role="member" data-id="${t.id}">Let Them In</button>`
          : t.role === 'member' ? `<button class="btn btn-glass btn-block" data-role="admin" data-id="${t.id}">Make Leader</button>`
          : `<button class="btn btn-glass btn-block" data-role="member" data-id="${t.id}">Remove as Leader</button>`}
        ${t.id !== state.profile.id && t.role !== 'pending' ? `<button class="btn btn-danger-ghost btn-block" data-role="pending" data-id="${t.id}">Remove Access</button>` : ''}
      </div></div>`).join('') : `<p class="empty">${empty}</p>`}</div>`;
  const m = fill(rid, `
    <p class="muted">Tap <b>Set Roles</b> to choose what each person does (Bass, Vocals, Pastor…). Leaders can edit songs and services; team members can view.</p>
    ${group('Leaders', team.filter(t => t.role === 'admin'), 'None')}
    ${group('Team', team.filter(t => t.role === 'member'), 'No one yet.')}
    ${group('Waiting / No Access', team.filter(t => t.role === 'pending'), 'No one is waiting.')}`);
  m?.addEventListener('click', async e => {
    const r = e.target.closest('[data-roles]');
    if (r) return rolesSheet(team.find(t => t.id === r.dataset.roles));
    const b = e.target.closest('[data-role]'); if (!b) return;
    const who = team.find(t => t.id === b.dataset.id);
    const q = { admin: `Make ${who.full_name} a leader? Leaders can add songs, plan services, message the team and manage people.`,
      member: who.role === 'admin' ? `Remove ${who.full_name} as a leader? They'll stay on the team.` : `Let ${who.full_name} into the team app?`,
      pending: `Remove ${who.full_name}'s access? They won't be able to see anything until they unlock again.` }[b.dataset.role];
    if (!(await askYesNo(q, 'Yes', b.dataset.role === 'pending'))) return;
    try { await api.team.setRole(who.id, b.dataset.role); toast('Done!'); viewTeam(); } catch (err) { toast(err.message, 'bad'); }
  });
}

function rolesSheet(person) {
  const chosen = new Set(person.positions || []);
  const btn = r => `<button type="button" class="role-btn" data-r="${esc(r)}" aria-pressed="false">${I.check}<span>${esc(r)}</span></button>`;
  sheet(`Roles for ${firstName(person.full_name)}`, `
    <p class="muted">Tap every role ${esc(firstName(person.full_name))} has. Tap again to remove it.</p>
    <div class="role-grid">${sortRoles([...new Set([...ROLES, ...chosen])]).map(btn).join('')}</div>
    <div class="add-role">
      <input class="input" id="newrole" maxlength="40" placeholder="Another role (e.g. Violin)" aria-label="Another role">
      <button type="button" class="btn btn-glass" id="addrole">${I.plus}<span>Add</span></button>
    </div>
    <button class="btn btn-primary btn-block btn-lg" id="saveroles">Save Roles</button>`, el => {
    const draw = () => $$('.role-btn', el).forEach(b => { const on = chosen.has(b.dataset.r); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('.role-grid', el).addEventListener('click', e => {
      const b = e.target.closest('.role-btn'); if (!b) return;
      chosen.has(b.dataset.r) ? chosen.delete(b.dataset.r) : chosen.add(b.dataset.r);
      draw();
    });
    const addRole = () => {
      const v = $('#newrole', el).value.trim().replace(/\s+/g, ' ');
      if (!v) return;
      const existing = $$('.role-btn', el).find(b => b.dataset.r.toLowerCase() === v.toLowerCase());
      if (existing) chosen.add(existing.dataset.r);
      else { $('.role-grid', el).insertAdjacentHTML('beforeend', btn(v)); chosen.add(v); }
      $('#newrole', el).value = '';
      draw();
    };
    $('#addrole', el).onclick = addRole;
    $('#newrole', el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } });
    $('#saveroles', el).onclick = e => busy(e.currentTarget, async () => {
      try {
        const list = sortRoles([...chosen]);
        await api.team.setPositions(person.id, list);
        if (person.id === state.profile.id) state.profile.positions = list;
        closeSheet(); toast('Roles saved!'); viewTeam();
      } catch (err) { toast(err.message, 'bad'); }
    });
    draw();
  });
}

// ── live updates ───────────────────────────────────────────────────
// Someone is mid-task: a pop-up is open, they're typing, or searching songs.
const userIsBusy = () => !!$('.sheet-wrap') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || !!$('#q')?.value;

async function refreshQuietly() {
  if (!state.profile || state.profile.role === 'pending') return;
  if (userIsBusy()) { state.stale = true; return; }
  state.stale = false;
  const y = window.scrollY;
  state.quiet = true;
  try { await route(); } finally { state.quiet = false; }
  window.scrollTo(0, y);
}

function applyPending() {
  if (state.updateReady && !userIsBusy()) { location.reload(); return; }
  if (state.stale) refreshQuietly();
}

let liveTimer = null;
function onLiveChange(table, payload) {
  if (!state.profile || state.profile.role === 'pending') return;
  if (table === 'messages' && payload.eventType === 'INSERT' && payload.new?.author_id !== state.profile.id) {
    if (location.hash !== '#/messages') state.unread = true;
    toast(`New message: ${payload.new?.title || 'from a leader'}`);
  }
  if (table === 'profiles' && (payload.new?.id === state.profile.id || payload.old?.id === state.profile.id)) {
    api.me().then(p => {
      const changed = p?.role !== state.profile.role;
      state.profile = p;
      if (changed) start(); else refreshQuietly();
    }).catch(() => {});
    return;
  }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(refreshQuietly, 700);   // bundle quick bursts of changes into one refresh
}

let stopLive = null;
function startLive() {
  if (stopLive || !state.profile || state.profile.role === 'pending') return;
  stopLive = api.subscribe(onLiveChange);
}
function stopLiveUpdates() { if (stopLive) { stopLive(); stopLive = null; } }

// Coming back to the app (phone unlocked, switched apps): catch up on anything missed.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.updateReady) return applyPending();
  refreshQuietly();
});

// ── router & start ─────────────────────────────────────────────────
const routes = [
  [/^\/songs$/, viewSongs], [/^\/songs\/([\w-]+)$/, viewSong],
  [/^\/services$/, viewServices], [/^\/services\/([\w-]+)$/, viewService],
  [/^\/messages$/, viewMessages], [/^\/me$/, viewMe], [/^\/team$/, viewTeam],
];
function route() {
  if (!state.profile || state.profile.role === 'pending') return;
  closeSheet();
  const path = location.hash.replace(/^#/, '');
  for (const [re, fn] of routes) { const m = path.match(re); if (m) return fn(m[1]).catch(console.error); }
  return viewHome().catch(console.error);
}
function applyTextSize() { document.documentElement.dataset.size = store.get('textSize') || 'normal'; }

async function start() {
  const session = await api.session();
  if (!session) { state.profile = null; return viewLogin(); }
  try { state.profile = await api.me(); }
  catch (e) { authShell(`${errBox(e.message)}<button class="btn btn-primary btn-block" onclick="location.reload()">Try Again</button>`); return; }
  if (!state.profile) return viewLogin();
  if (state.profile.role === 'pending') { stopLiveUpdates(); return viewUnlock(); }
  startLive();
  route();
}

applyTextSize();
api.onAuth(event => {
  if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordSheet, 300);
  if (event === 'SIGNED_OUT') { stopLiveUpdates(); state.profile = null; viewLogin(); }
});
window.addEventListener('hashchange', route);
start();

// ── automatic app updates ──────────────────────────────────────────
// When a new version is published, open apps switch to it by themselves
// (right away, or as soon as the person finishes what they're typing).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || state.updateReady) return;   // first install: nothing to update
    state.updateReady = true;
    if (userIsBusy()) toast('The app has an update. It will load when you finish.');
    else location.reload();
  });
}
