// Cornerstone Worship sign-in guard (Supabase Edge Function).
// Sends 6-digit sign-in codes from the church's Gmail and checks Face ID / Touch ID.
// Only this program can mark a sign-in as confirmed (it uses the service key, which never leaves Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.16';
import { CODE_TTL_MS, MAX_ATTEMPTS, codeEmail, hashCode, maskEmail, newCode, sameText, sendAllowed } from './codes.ts';
import { CHALLENGE_TTL_MS, authenticationOptions, checkAuthentication, checkRegistration, registrationOptions, siteFor } from './passkeys.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER') || 'cornerstoneautobot@gmail.com';
const GMAIL_APP_PASSWORD = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '');
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
async function confirmSession(userId: string, sessionId: string, method: 'email' | 'passkey') {
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
      // ── email codes ──────────────────────────────────────────────
      case 'send-code': {
        if (!GMAIL_APP_PASSWORD) throw new Oops(503, "Email codes aren't set up yet. A leader needs to add the Gmail App Password in Supabase.");
        const row = must(await db.from('login_codes').select('sent_at, hour_started, sends_this_hour').eq('user_id', user.id).maybeSingle());
        const allowed = sendAllowed(row as any);
        if (!allowed.ok) throw new Oops(429, allowed.reason);
        const code = newCode();
        const mail = codeEmail(code, profile?.full_name || '');
        const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
        try {
          await transport.sendMail({ from: `"Cornerstone Worship" <${GMAIL_USER}>`, to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
        } catch (e: any) {
          console.error('gmail send failed', e?.code, e?.responseCode, e?.message);
          const why = `${e?.code || ''} ${e?.responseCode || ''} ${e?.message || ''}`;
          if (/EAUTH|535|534|Username and Password not accepted|Application-specific password required|BadCredentials/i.test(why)) {
            throw new Oops(502, 'Gmail did not accept the App Password. Make a new App Password while signed in as ' + GMAIL_USER +
              ', then paste all 16 letters into the GMAIL_APP_PASSWORD secret in Supabase. (Gmail said: ' + String(e?.response || e?.message || '').slice(0, 120) + ')');
          }
          if (/ECONNECTION|ETIMEDOUT|ECONNREFUSED|ESOCKET|ENOTFOUND|connect|timeout|tls|certificate/i.test(why)) {
            throw new Oops(502, "The server couldn't connect to Gmail to send the email. (Details: " + String(e?.code || e?.message || '').slice(0, 120) + ')');
          }
          throw new Oops(502, "We couldn't send the email. (Details: " + String(e?.message || e).slice(0, 160) + ')');
        }
        must(await db.from('login_codes').upsert({
          user_id: user.id, code_hash: await hashCode(SERVICE_KEY, user.id, code),
          expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(), attempts: 0, sent_at: new Date().toISOString(),
          hour_started: allowed.hourStarted, sends_this_hour: allowed.sendsThisHour,
        }, { onConflict: 'user_id' }));
        return reply(origin, 200, { ok: true, to: maskEmail(user.email || '') });
      }
      case 'verify-code': {
        const code = String(body.code || '').replace(/\D/g, '');
        if (code.length !== 6) throw new Oops(400, 'Please type all 6 numbers.');
        const row = must(await db.from('login_codes').select('*').eq('user_id', user.id).maybeSingle()) as any;
        if (!row) throw new Oops(400, 'Please tap "Send a new code" first.');
        if (new Date(row.expires_at).getTime() < Date.now()) throw new Oops(400, 'That code has expired. Tap "Send a new code".');
        if (row.attempts >= MAX_ATTEMPTS) throw new Oops(429, 'Too many wrong tries. Tap "Send a new code".');
        if (!sameText(await hashCode(SERVICE_KEY, user.id, code), row.code_hash)) {
          must(await db.from('login_codes').update({ attempts: row.attempts + 1 }).eq('user_id', user.id));
          const left = MAX_ATTEMPTS - row.attempts - 1;
          throw new Oops(400, left > 0 ? `That code isn't right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Tap "Send a new code".');
        }
        must(await db.from('login_codes').delete().eq('user_id', user.id));
        await confirmSession(user.id, sessionId, 'email');
        return reply(origin, 200, { ok: true });
      }

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

        if (body.action === 'passkey-register-options') {
          if (!(await sessionConfirmed(user.id, sessionId))) throw new Oops(403, 'Please confirm your sign-in with an email code first.');
          const options = await registrationOptions(site, { email: user.email || '', name: profile?.full_name || '' }, mine);
          await saveChallenge(options.challenge, 'register');
          return reply(origin, 200, options);
        }
        if (body.action === 'passkey-register-verify') {
          if (!(await sessionConfirmed(user.id, sessionId))) throw new Oops(403, 'Please confirm your sign-in with an email code first.');
          const challenge = await takeChallenge('register');
          const key = await checkRegistration(site, challenge, body.response).catch(e => { console.error(e); return null; });
          if (!key) throw new Oops(400, "That didn't work. Please try again.");
          must(await db.from('passkeys').insert({ ...key, user_id: user.id, device_name: String(body.deviceName || '').slice(0, 60) }));
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
        if (!result.ok) throw new Oops(400, "That didn't work. Please try again or use an email code.");
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
