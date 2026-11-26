// Chord charts: read ChordPro or "chords above lyrics" text, change key, and draw it.
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

export const noteIndex = n => {
  const m = String(n || '').match(/^([A-G])([#b]?)/);
  if (!m) return -1;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (base + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12;
};
const isMinor = k => /m$/.test(k || '');

// Semitones to move from one key to another (shortest way, -5..+6).
export function semitones(fromKey, toKey) {
  const a = noteIndex(fromKey), b = noteIndex(toKey);
  if (a < 0 || b < 0) return 0;
  let d = (b - a + 12) % 12;
  return d > 6 ? d - 12 : d;
}

// The key you land on after moving `semis` from `key` (keeps major/minor).
export function shiftKey(key, semis) {
  const i = noteIndex(key);
  if (i < 0) return key;
  const minor = isMinor(key);
  const j = (i + semis + 120) % 12;
  // pick the spelling musicians normally use for that key
  const majorNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const minorNames = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  return minor ? minorNames[j] + 'm' : majorNames[j];
}

export function transposeChord(chord, semis, targetKey) {
  if (!semis) return chord;
  const names = FLAT_KEYS.has(targetKey) ? FLAT : SHARP;
  return chord.replace(/(^|\/|\()([A-G])([#b]?)/g, (_, pre, l, acc) => pre + names[(noteIndex(l + acc) + semis + 120) % 12]);
}

const CHORD_RE = /^\(?[A-G][#b]?(?:m(?!aj)|maj|min|dim|aug|sus|add|M)?[0-9]*(?:(?:sus|add|maj|M|b|#|no)?[0-9]+|sus)*(?:\/[A-G][#b]?)?\)?$/;
const FILLER_RE = /^(\||\/|-+|%|x\d+|\(?\d+x\)?|n\.?c\.?|\.+)$/i;
export const isChord = t => CHORD_RE.test(t);
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let chords = 0;
  for (const t of toks) {
    if (isChord(t)) chords++;
    else if (!FILLER_RE.test(t)) return false;
  }
  return chords > 0;
}
const SECTION_RE = /^\s*\[?\s*((?:verse|chorus|pre-?chorus|bridge|intro|outro|tag|ending|interlude|instrumental|turnaround|refrain|vamp|coda|misc|channel|breakdown)(?:\s*\d+[a-z]?)?(?:\s*\(.*\))?)\s*\]?\s*:?\s*$/i;
const META_RE = /^\s*(ccli|©|\(c\)|copyright|for use solely|words and music|music by|words by|all rights reserved|ccli license)/i;

// Turn a chart's text into lines: sections, chord+lyric chunks, plain lines, blanks.
export function parseChart(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let key = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, '    ').replace(/\s+$/, '');
    const dir = raw.match(/^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i);
    if (dir) {
      const [, name, val = ''] = dir;
      const n = name.toLowerCase();
      if (n === 'key' || n === 'k') key = key || val.trim();
      else if (['c', 'comment', 'ci', 'comment_italic', 'cb', 'comment_box'].includes(n)) out.push({ type: 'sec', text: val });
      else if (/^(soc|start_of_chorus)$/.test(n)) out.push({ type: 'sec', text: val || 'Chorus' });
      else if (/^(sov|start_of_verse|sob|start_of_bridge|start_of_part)$/.test(n) && val) out.push({ type: 'sec', text: val });
      continue;                                       // title/artist/end markers etc. are shown elsewhere
    }
    if (!raw.trim()) { out.push({ type: 'blank' }); continue; }
    const keyLine = raw.match(/^\s*key\s*[-:–]\s*([A-G][#b]?m?)\s*$/i);
    if (keyLine) { key = key || keyLine[1]; continue; }
    if (META_RE.test(raw)) { out.push({ type: 'meta', text: raw.trim() }); continue; }
    if (SECTION_RE.test(raw) && !/\[[A-G]/.test(raw)) { out.push({ type: 'sec', text: raw.trim().replace(/^\[|\]?:?$/g, '').replace(/\]$/, '') }); continue; }

    if (/\[[^\]]+\]/.test(raw)) {                     // ChordPro: [G]Amazing [C]grace
      const parts = raw.split(/\[([^\]]*)\]/);   // text, chord, text, chord, text…
      const chunks = parts[0] ? [{ c: '', t: parts[0] }] : [];
      for (let k = 1; k < parts.length; k += 2) chunks.push({ c: parts[k].trim(), t: parts[k + 1] || '' });
      out.push({ type: 'ln', chunks: chunks.filter(ch => ch.c || ch.t) });
      continue;
    }

    if (isChordLine(raw)) {                           // chords above lyrics
      const positions = []; const re = /\S+/g; let m;
      while ((m = re.exec(raw))) positions.push({ c: m[0], at: m.index });
      const next = lines[i + 1] !== undefined ? lines[i + 1].replace(/\t/g, '    ').replace(/\s+$/, '') : '';
      const nextIsLyric = next.trim() && !isChordLine(next) && !SECTION_RE.test(next) && !/^\s*\{/.test(next) && !META_RE.test(next);
      if (!nextIsLyric) {
        out.push({ type: 'ln', chordsOnly: true, chunks: positions.map(p => ({ c: isChord(p.c) ? p.c : '', t: isChord(p.c) ? '' : p.c })) });
        continue;
      }
      const lyric = next; i++;
      const chunks = [];
      if (positions[0].at > 0 && lyric.slice(0, positions[0].at).trim()) chunks.push({ c: '', t: lyric.slice(0, positions[0].at) });
      positions.forEach((p, k) => {
        const end = k + 1 < positions.length ? positions[k + 1].at : lyric.length;
        let t = p.at < lyric.length ? lyric.slice(p.at, Math.max(end, p.at)) : '';
        if (!isChord(p.c)) { if (t) chunks.push({ c: '', t }); return; }
        chunks.push({ c: p.c, t });
      });
      out.push({ type: 'ln', chunks });
      continue;
    }
    out.push({ type: 'ln', chunks: [{ c: '', t: raw }] });
  }
  // collapse runs of blank lines
  const clean = out.filter((l, k) => !(l.type === 'blank' && (k === 0 || out[k - 1].type === 'blank')));
  return { lines: clean, key };
}

// Guess the key a chart is written in: {key:} / "Key - G" line, else the first chord.
export function detectKey(text) {
  const { lines, key } = parseChart(text);
  if (key) return key;
  for (const l of lines) if (l.type === 'ln') for (const ch of l.chunks) if (ch.c) {
    const m = ch.c.match(/^\(?([A-G][#b]?)(m(?!aj))?/);
    if (m) return m[1] + (m[2] ? 'm' : '');
  }
  return '';
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Draw the chart as HTML in the target key. Words wrap neatly on small screens.
export function renderChart(text, fromKey, toKey, { chords = true } = {}) {
  const { lines } = parseChart(text);
  const semis = fromKey && toKey ? semitones(fromKey, toKey) : 0;
  const html = lines.map(l => {
    if (l.type === 'blank') return '<div class="cl-gap"></div>';
    if (l.type === 'sec') return `<div class="cl-sec">${esc(l.text)}</div>`;
    if (l.type === 'meta') return `<div class="cl-meta">${esc(l.text)}</div>`;
    if (l.chordsOnly && !chords) return '';
    const hasChords = chords && l.chunks.some(ch => ch.c);
    const pieces = [];
    for (const ch of l.chunks) {
      const c = chords && ch.c ? transposeChord(ch.c, semis, toKey) : '';
      // split the lyric into words so long lines wrap between words
      const words = (ch.t || '').match(/\S+\s*|\s+/g) || [''];
      words.forEach((w, k) => pieces.push({ c: k === 0 ? c : '', t: w }));
    }
    if (!hasChords) {
      const t = pieces.map(p => p.t).join('');
      return t.trim() ? `<div class="cl-ln cl-plain">${esc(t)}</div>` : '';
    }
    return `<div class="cl-ln">${pieces.map(p =>
      `<span class="cl-ch"><b>${p.c ? esc(p.c) : '&nbsp;'}</b><span>${esc(p.t) || '&nbsp;'}</span></span>`).join('')}</div>`;
  }).join('');
  return html;
}

// Guitar helper: capo positions that let you play with easy open chord shapes.
export function capoOptions(key) {
  const i = noteIndex(key);
  if (i < 0) return [];
  const minor = isMinor(key);
  const shapes = minor ? ['Am', 'Em', 'Dm'] : ['G', 'C', 'D', 'A', 'E'];
  const opts = [];
  for (let capo = 0; capo <= 7; capo++) {
    for (const s of shapes) if ((noteIndex(s) + capo) % 12 === i) opts.push({ capo, shape: s });
  }
  return opts.sort((a, b) => a.capo - b.capo).slice(0, 3);
}
