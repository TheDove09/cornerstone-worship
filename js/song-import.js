// Turns pasted lists, spreadsheet (CSV) files and SongSelect links into songs.
const MAJOR = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function normalizeKey(k) {
  const m = String(k || '').trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor)?$/);
  if (!m) return '';
  const key = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  return MAJOR.includes(key) ? key + (m[3] ? 'm' : '') : '';
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const titleCase = slug => slug.split('-').filter(Boolean)
  .map((w, i) => (i > 0 && SMALL.has(w)) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');

export function parseSongSelectUrl(u) {
  const m = String(u || '').match(/songselect\.ccli\.com\/songs\/(\d{3,9})(?:\/([a-z0-9-]+))?/i);
  if (!m) return null;
  return {
    ccli_number: m[1],
    title: m[2] ? titleCase(m[2].toLowerCase()) : '',
    songselect_url: `https://songselect.ccli.com/songs/${m[1]}${m[2] ? '/' + m[2] : ''}`,
  };
}

function parseDelimited(text, delim) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
}

const HEADERS = {
  title: /^(song\s*)?(title|name)$|^song$/i,
  artist: /author|artist|writer|composer/i,
  ccli_number: /ccli/i,
  default_key: /^(default\s*|original\s*|song\s*)?key$/i,
  tempo: /bpm|tempo/i,
};

function fromCells(cells) {
  const s = { title: '', artist: '', ccli_number: '', default_key: '', tempo: null, songselect_url: '' };
  // re-join numbers like "10,000" that a comma split apart
  const merged = [];
  for (const c of cells) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && /^\d{1,3}$/.test(prev) && /^\d{3}\b/.test(c)) merged[merged.length - 1] = prev + ',' + c;
    else merged.push(c);
  }
  const text = [];
  for (const c of merged) {
    const link = parseSongSelectUrl(c);
    if (link) { Object.assign(s, { ...link, title: s.title || link.title }); continue; }
    if (!s.ccli_number && /^#?\d{4,9}$/.test(c)) { s.ccli_number = c.replace('#', ''); continue; }
    if (!s.default_key && normalizeKey(c)) { s.default_key = normalizeKey(c); continue; }
    if (!s.tempo && /^\d{2,3}\s*bpm$/i.test(c)) { s.tempo = parseInt(c, 10); continue; }
    if (c) text.push(c);
  }
  if (text.length === 1 && !s.artist && / [-–—] /.test(text[0])) text.splice(0, 1, ...text[0].split(/ [-–—] /, 2));
  if (text[0]) s.title = text[0];
  if (text[1]) s.artist = text[1];
  return s;
}

export function parseSongs(text) {
  text = String(text || '').replace(/^﻿/, '').trim();
  if (!text) return [];
  const delim = text.includes('\t') ? '\t' : /\|/.test(text) ? '|' : ',';
  const rows = parseDelimited(text, delim);
  if (!rows.length) return [];

  const head = rows[0].map(c => c.toLowerCase());
  const map = {};
  for (const [field, re] of Object.entries(HEADERS)) {
    const i = head.findIndex(h => re.test(h));
    if (i >= 0 && !(field === 'title' && Object.values(map).includes(i))) map[field] = i;
  }
  const hasHeader = map.title !== undefined && Object.keys(map).length >= 2;

  const songs = hasHeader
    ? rows.slice(1).map(r => {
        const s = { title: r[map.title] || '', artist: r[map.artist] || '', ccli_number: (r[map.ccli_number] || '').replace(/\D/g, ''),
          default_key: normalizeKey(r[map.default_key]), tempo: parseInt(r[map.tempo], 10) || null, songselect_url: '' };
        return s;
      })
    : rows.map(fromCells);

  return songs.filter(s => s.title && s.title.length < 200)
    .map(s => ({ ...s, title: s.title.replace(/\s+/g, ' ').trim(), artist: (s.artist || '').replace(/\s+/g, ' ').trim() }));
}

// Splits new songs into ones to add and ones already in the app (same CCLI # or same title).
export function dedupe(newSongs, existing) {
  const seenNum = new Set(existing.map(s => s.ccli_number).filter(Boolean));
  const seenTitle = new Set(existing.map(s => s.title.toLowerCase()));
  const add = [], skipped = [];
  for (const s of newSongs) {
    const t = s.title.toLowerCase();
    if ((s.ccli_number && seenNum.has(s.ccli_number)) || seenTitle.has(t)) { skipped.push(s); continue; }
    if (s.ccli_number) seenNum.add(s.ccli_number);
    seenTitle.add(t);
    add.push(s);
  }
  return { add, skipped };
}
