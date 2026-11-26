// Demo backend — runs entirely on this device so you can try the app
// before setting up Supabase. Any email/password works. Nothing is shared.
const KEY = 'cmc-demo-v1';
const id = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sundayIn = weeks => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + weeks * 7); return ymd(d); };
const clone = o => JSON.parse(JSON.stringify(o));
const wait = () => new Promise(r => setTimeout(r, 120));

function seed() {
  const s = (title, artist, ccli_number, default_key, tempo, time_signature = '4/4', notes = '') =>
    ({ id: id(), title, artist, ccli_number, default_key, tempo, time_signature, songselect_url: '', notes, created_at: new Date().toISOString() });
  const songs = [
    s('Goodness of God', 'Bethel Music', '7117726', 'Ab', 63, '6/8', 'Women lead verse 1.'),
    s('Build My Life', 'Housefires', '7070345', 'G', 68),
    s('Way Maker', 'Sinach', '7115744', 'E', 68),
    s('10,000 Reasons (Bless the Lord)', 'Matt Redman', '6016351', 'G', 73),
    s('Great Are You Lord', 'All Sons & Daughters', '6460220', 'G', 74),
    s('How Great Is Our God', 'Chris Tomlin', '4348399', 'C', 78),
    s('Amazing Grace (My Chains Are Gone)', 'Chris Tomlin', '4768151', 'G', 68, '3/4'),
  ];
  const me = { id: id(), full_name: '', email: '', role: 'admin', created_at: new Date().toISOString() };
  const team = [
    me,
    { id: id(), full_name: 'Linda (Co-Leader)', email: 'linda@example.com', role: 'admin' },
    { id: id(), full_name: 'Harold — Bass', email: 'harold@example.com', role: 'member' },
    { id: id(), full_name: 'Grace — Vocals', email: 'grace@example.com', role: 'member' },
    { id: id(), full_name: 'Tom — Drums', email: 'tom@example.com', role: 'pending' },
  ];
  const svc1 = { id: id(), service_date: sundayIn(0), title: 'Sunday Service', notes: 'Please arrive by 8:30 AM for sound check.', created_at: new Date().toISOString(),
    items: [
      { id: id(), song_id: songs[2].id, song_key: 'D', position: 0, notes: 'Start soft, keys only' },
      { id: id(), song_id: songs[0].id, song_key: 'G', position: 1, notes: '' },
      { id: id(), song_id: songs[4].id, song_key: 'G', position: 2, notes: 'Repeat bridge twice' },
    ] };
  const svc2 = { id: id(), service_date: sundayIn(1), title: 'Sunday Service', notes: '', created_at: new Date().toISOString(),
    items: [
      { id: id(), song_id: songs[1].id, song_key: 'G', position: 0, notes: '' },
      { id: id(), song_id: songs[3].id, song_key: 'G', position: 1, notes: '' },
    ] };
  const messages = [
    { id: id(), title: 'Rehearsal moved to Thursday', body: 'Hi team! This week rehearsal is Thursday at 7 PM instead of Wednesday. See you there!', service_id: null, author_name: 'Linda (Co-Leader)', created_at: new Date(Date.now() - 36e5 * 5).toISOString() },
  ];
  return { songs, services: [svc1, svc2], messages, team, meId: me.id };
}

export function createDemoApi() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  let listeners = [];
  const emit = ev => listeners.forEach(cb => cb(ev, db.signedIn ? {} : null));
  const songById = sid => db.songs.find(s => s.id === sid);
  const withSongs = svc => ({ ...clone(svc), items: svc.items.slice().sort((a, b) => a.position - b.position)
    .map(it => ({ ...clone(it), song: clone(songById(it.song_id) || { title: '(deleted song)' }) })) });
  const me = () => db.team.find(t => t.id === db.meId);

  return {
    async session() { return db.signedIn ? { demo: true } : null; },
    onAuth(cb) { listeners.push(cb); },
    async signIn(email) {
      await wait();
      const m = me();
      if (!m.full_name) m.full_name = (email.split('@')[0] || 'Leader').replace(/^\w/, c => c.toUpperCase());
      m.email = email;
      db.signedIn = true; save(); emit('SIGNED_IN');
    },
    async signUp(name, email) { await wait(); const m = me(); m.full_name = name; m.email = email; db.signedIn = true; save(); return { needsEmailConfirm: false }; },
    async signOut() { db.signedIn = false; save(); emit('SIGNED_OUT'); },
    async resetPassword() { await wait(); },
    async updatePassword() { await wait(); },
    async me() { return clone(me()); },
    async joinTeam() { await wait(); me().role = me().role === 'admin' ? 'admin' : 'member'; save(); },
    async setTeamSecret(email) { await wait(); db.secret = { ccli_email: email, updated_at: new Date().toISOString() }; save(); },
    async teamSecretStatus() { return db.secret || null; },
    async updateMyName(n) { me().full_name = n; save(); },

    songs: {
      list: async () => { await wait(); return clone(db.songs).sort((a, b) => a.title.localeCompare(b.title)); },
      get: async sid => { await wait(); const s = songById(sid); if (!s) throw new Error('Song not found.'); return clone(s); },
      save: async s => {
        await wait();
        if (s.id) { Object.assign(songById(s.id), s); save(); return clone(songById(s.id)); }
        const n = { ...s, id: id(), created_at: new Date().toISOString() }; db.songs.push(n); save(); return clone(n);
      },
      saveMany: async list => { await wait(); list.forEach(s => db.songs.push({ songselect_url: '', notes: '', ...s, id: id(), created_at: new Date().toISOString() })); save(); return list.length; },
      remove: async sid => {
        db.songs = db.songs.filter(s => s.id !== sid);
        db.services.forEach(v => { v.items = v.items.filter(i => i.song_id !== sid); });
        save();
      },
    },
    services: {
      list: async () => { await wait(); return db.services.slice().sort((a, b) => a.service_date.localeCompare(b.service_date)).map(withSongs); },
      get: async sid => { await wait(); const v = db.services.find(x => x.id === sid); if (!v) throw new Error('Service not found.'); return withSongs(v); },
      save: async (svc, items) => {
        await wait();
        const its = items.map((it, i) => ({ id: id(), song_id: it.song_id, song_key: it.song_key || '', notes: it.notes || '', position: i }));
        let v = svc.id && db.services.find(x => x.id === svc.id);
        if (v) Object.assign(v, { service_date: svc.service_date, title: svc.title, notes: svc.notes, items: its });
        else { v = { id: id(), service_date: svc.service_date, title: svc.title, notes: svc.notes, items: its, created_at: new Date().toISOString() }; db.services.push(v); }
        save(); return clone(v);
      },
      remove: async sid => {
        db.services = db.services.filter(v => v.id !== sid);
        db.messages.forEach(m => { if (m.service_id === sid) m.service_id = null; });
        save();
      },
    },
    messages: {
      list: async () => { await wait(); return clone(db.messages).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      post: async m => { const n = { ...m, id: id(), created_at: new Date().toISOString() }; db.messages.push(n); save(); return clone(n); },
      remove: async mid => { db.messages = db.messages.filter(m => m.id !== mid); save(); },
    },
    team: {
      list: async () => { await wait(); return clone(db.team).sort((a, b) => a.full_name.localeCompare(b.full_name)); },
      setRole: async (tid, role) => {
        const t = db.team.find(x => x.id === tid);
        if (t.role === 'admin' && role !== 'admin' && db.team.filter(x => x.role === 'admin').length <= 1)
          throw new Error('There must always be at least one leader.');
        t.role = role; save();
      },
    },
  };
}
