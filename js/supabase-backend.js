// Real backend: Supabase (login + database). Security is enforced on the
// server by the Row Level Security rules in supabase/schema.sql.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SONG_FIELDS = ['title', 'artist', 'ccli_number', 'default_key', 'tempo', 'time_signature', 'songselect_url', 'notes', 'chart', 'chart_key'];
// The song list skips the (long) chart text; a song's own page loads it.
const SONG_LIST_COLS = 'id, title, artist, ccli_number, default_key, tempo, time_signature, songselect_url, notes, created_at, has_chart, chart_key';
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

function friendly(error) {
  const m = error?.message || String(error);
  if (/invalid login/i.test(m)) return 'That email or password is not right. Please try again.';
  if (/email not confirmed/i.test(m)) return 'Please check your email and tap the confirmation link first.';
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Try signing in instead.';
  if (/password should be at least/i.test(m)) return 'Your password needs to be at least 8 characters long.';
  if (/failed to fetch|network/i.test(m)) return 'No internet connection. Please check your Wi-Fi or data and try again.';
  if (/row-level security|permission denied/i.test(m)) return 'Only a leader can do that.';
  return m;
}
const must = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };

function normalizeService(s) {
  const items = (s.service_songs || []).slice().sort((a, b) => a.position - b.position);
  const { service_songs, ...rest } = s;
  return { ...rest, items };
}

export function createSupabaseApi(cfg) {
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const appUrl = () => location.origin + location.pathname;
  const uid = async () => (await sb.auth.getUser()).data.user?.id;

  return {
    // Live updates: the server tells the app the moment team data changes.
    // The database's security rules still apply, so people only hear about rows they're allowed to see.
    subscribe(cb) {
      const ch = sb.channel('team-live');
      for (const table of ['messages', 'services', 'service_songs', 'songs', 'profiles']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, payload => cb(table, payload));
      }
      ch.subscribe();
      return () => { sb.removeChannel(ch); };
    },
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) {
      try { must(await sb.auth.signInWithPassword({ email, password })); }
      catch (e) { throw new Error(friendly(e)); }
    },
    async signUp(full_name, email, password) {
      const data = must(await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: appUrl() } }));
      return { needsEmailConfirm: !data.session };
    },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })); },
    async updatePassword(password) { must(await sb.auth.updateUser({ password })); },

    async me() {
      const id = await uid();
      if (!id) return null;
      return must(await sb.from('profiles').select('*').eq('id', id).single());
    },
    // Unlock with the CHURCH's CCLI login (checked on the server, never stored in plain text)
    async joinTeam(ccli_email, ccli_password) {
      const ok = must(await sb.rpc('join_team', { p_email: ccli_email, p_password: ccli_password }));
      if (!ok) throw new Error("That church CCLI email or password doesn't match. Please check with a leader.");
    },
    async setTeamSecret(ccli_email, ccli_password) {
      must(await sb.rpc('set_team_secret', { p_email: ccli_email, p_password: ccli_password }));
    },
    async teamSecretStatus() {
      const rows = must(await sb.rpc('team_secret_status'));
      return rows?.[0] || null;
    },
    async updateMyName(full_name) {
      const id = await uid();
      must(await sb.from('profiles').update({ full_name }).eq('id', id));
    },

    songs: {
      list: async () => must(await sb.from('songs').select(SONG_LIST_COLS).order('title')),
      get: async id => must(await sb.from('songs').select('*').eq('id', id).single()),
      save: async s => {
        const row = pick(s, SONG_FIELDS);
        if (s.id) return must(await sb.from('songs').update(row).eq('id', s.id).select().single());
        return must(await sb.from('songs').insert(row).select().single());
      },
      remove: async id => { must(await sb.from('songs').delete().eq('id', id)); },
      saveMany: async list => {
        let added = 0;
        for (let i = 0; i < list.length; i += 200) {
          const rows = must(await sb.from('songs').insert(list.slice(i, i + 200).map(s => pick(s, SONG_FIELDS))).select('id'));
          added += rows.length;
        }
        return added;
      },
    },

    services: {
      list: async () => must(await sb.from('services')
        .select('*, service_songs(id, position, song_key, song_id, song:songs(id, title, default_key))')
        .order('service_date')).map(normalizeService),
      get: async id => normalizeService(must(await sb.from('services')
        .select('*, service_songs(*, song:songs(*))').eq('id', id).single())),
      save: async (svc, items) => {
        const row = { service_date: svc.service_date, title: svc.title, notes: svc.notes || '' };
        const saved = svc.id
          ? must(await sb.from('services').update(row).eq('id', svc.id).select().single())
          : must(await sb.from('services').insert(row).select().single());
        must(await sb.from('service_songs').delete().eq('service_id', saved.id));
        if (items.length) {
          must(await sb.from('service_songs').insert(items.map((it, i) => ({
            service_id: saved.id, song_id: it.song_id, position: i, song_key: it.song_key || '', notes: it.notes || '',
          }))));
        }
        return saved;
      },
      remove: async id => { must(await sb.from('services').delete().eq('id', id)); },
    },

    messages: {
      list: async () => {
        const [msgs, hidden] = await Promise.all([
          sb.from('messages').select('*').order('created_at', { ascending: false }).limit(100),
          sb.from('hidden_messages').select('message_id'),
        ]);
        const gone = new Set(must(hidden).map(r => r.message_id));   // ones I deleted just for me
        return must(msgs).filter(m => !gone.has(m.id));
      },
      hideForMe: async id => { must(await sb.from('hidden_messages').insert({ message_id: id })); },
      post: async ({ title, body, service_id, author_name, recipient_ids }) =>
        must(await sb.from('messages').insert({ title, body, service_id: service_id || null, author_name,
          recipient_ids: recipient_ids && recipient_ids.length ? recipient_ids : null }).select().single()),
      remove: async id => { must(await sb.from('messages').delete().eq('id', id)); },
    },

    team: {
      list: async () => must(await sb.from('profiles').select('*').order('full_name')),
      setRole: async (id, role) => { must(await sb.from('profiles').update({ role }).eq('id', id)); },
      setPositions: async (id, positions) => { must(await sb.from('profiles').update({ positions }).eq('id', id)); },
    },
  };
}
