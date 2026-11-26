// Cornerstone Worship sign-in guard (Supabase Edge Function).
// Sets up and checks Face ID / Touch ID (passkeys).
// Only this program can mark a sign-in as confirmed (it uses the service key, which never leaves Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { CHALLENGE_TTL_MS, authenticationOptions, checkAuthentication, checkRegistration, registrationOptions, siteFor } from './passkeys.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGINS') || 'https://thedove09.github.io').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

class Oops extends Error { constructor(public status: number, message: string) { super(message); } }

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const reply = (origin: string, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

function jwtClaims(jwt: string): Record<string, any> {
  const part = jwt.split('.')[1] || '';
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)));
}
const must = <T>({ data, error }: { data: T; error: any }): T => { if (error) throw error; return data; };

async function sessionConfirmed(userId: string, sessionId: string) {
  const row = must(await db.from('verified_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', userId).maybeSingle());
  return !!row;
}
async function confirmSession(userId: string, sessionId: string, method: 'passkey') {
  must(await db.from('verified_sessions').upsert({ session_id: sessionId, user_id: userId, method }, { onConflict: 'session_id' }));
}

Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  try {
    if (req.method !== 'POST') throw new Oops(405, 'Not allowed.');
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) throw new Oops(401, 'Please sign in again.');
    const sessionId: string = jwtClaims(jwt).session_id;
    if (!sessionId) throw new Oops(401, 'Please sign in again.');
    const body = await req.json().catch(() => ({}));
    const profile = must(await db.from('profiles').select('full_name').eq('id', user.id).maybeSingle()) as { full_name?: string } | null;

    switch (body.action) {
      // ── Face ID / Touch ID ───────────────────────────────────────
      case 'passkey-register-options':
      case 'passkey-register-verify':
      case 'passkey-login-options':
      case 'passkey-login-verify': {
        const site = siteFor(origin, ALLOWED_ORIGINS);
        if (!site) throw new Oops(400, 'Face ID / Touch ID only works in the official app.');
        const mine = (must(await db.from('passkeys').select('id, public_key, counter, transports').eq('user_id', user.id)) as any[]) || [];
        const saveChallenge = async (challenge: string, kind: string) => must(await db.from('passkey_challenges').upsert(
          { user_id: user.id, challenge, kind, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() }, { onConflict: 'user_id' }));
        const takeChallenge = async (kind: string) => {
          const ch = must(await db.from('passkey_challenges').select('*').eq('user_id', user.id).maybeSingle()) as any;
          must(await db.from('passkey_challenges').delete().eq('user_id', user.id));
          if (!ch || ch.kind !== kind || new Date(ch.expires_at).getTime() < Date.now()) throw new Oops(400, 'That took too long. Please try again.');
          return ch.challenge as string;
        };

        // Adding a device: allowed on the first one, or once this sign-in was confirmed with an existing one.
        const mayAdd = async () => mine.length === 0 || await sessionConfirmed(user.id, sessionId);
        if (body.action === 'passkey-register-options') {
          if (!(await mayAdd())) throw new Oops(403, 'Please sign in with Face ID / Touch ID first.');
          const options = await registrationOptions(site, { email: user.email || '', name: profile?.full_name || '' }, mine);
          await saveChallenge(options.challenge, 'register');
          return reply(origin, 200, options);
        }
        if (body.action === 'passkey-register-verify') {
          if (!(await mayAdd())) throw new Oops(403, 'Please sign in with Face ID / Touch ID first.');
          const challenge = await takeChallenge('register');
          const key = await checkRegistration(site, challenge, body.response).catch(e => { console.error(e); return null; });
          if (!key) throw new Oops(400, "That didn't work. Please try again.");
          must(await db.from('passkeys').insert({ ...key, user_id: user.id, device_name: String(body.deviceName || '').slice(0, 60) }));
          await confirmSession(user.id, sessionId, 'passkey');   // they just proved it on this phone, so stay signed in
          return reply(origin, 200, { ok: true });
        }
        if (body.action === 'passkey-login-options') {
          if (!mine.length) throw new Oops(400, 'Face ID / Touch ID isn\'t set up for this account yet.');
          const options = await authenticationOptions(site, mine);
          await saveChallenge(options.challenge, 'login');
          return reply(origin, 200, options);
        }
        // passkey-login-verify
        const challenge = await takeChallenge('login');
        const stored = mine.find(k => k.id === body.response?.id);
        if (!stored) throw new Oops(400, 'That Face ID / Touch ID key isn\'t on this account.');
        const result = await checkAuthentication(site, challenge, body.response, stored).catch(e => { console.error(e); return { ok: false, newCounter: 0 }; });
        if (!result.ok) throw new Oops(400, "That didn't work. Please try again.");
        must(await db.from('passkeys').update({ counter: result.newCounter, last_used_at: new Date().toISOString() }).eq('id', stored.id));
        await confirmSession(user.id, sessionId, 'passkey');
        return reply(origin, 200, { ok: true });
      }
      default:
        throw new Oops(400, 'Unknown request.');
    }
  } catch (e) {
    if (e instanceof Oops) return reply(origin, e.status, { error: e.message });
    console.error(e);
    return reply(origin, 500, { error: 'Something went wrong. Please try again.' });
  }
});
