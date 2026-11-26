// 6-digit sign-in codes: made with a secure random generator, stored only as a
// keyed hash (HMAC-SHA-256), and compared in constant time.

export const CODE_TTL_MS = 10 * 60 * 1000;   // a code works for 10 minutes
export const MAX_ATTEMPTS = 5;               // then a new code is needed
export const RESEND_WAIT_MS = 45 * 1000;     // wait between "send a new code"
export const MAX_SENDS_PER_HOUR = 6;

export function newCode(): string {
  // Rejection sampling so every code from 000000 to 999999 is equally likely.
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

export async function hashCode(secret: string, userId: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`signin-code:${userId}:${code}`));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const shown = name.length <= 2 ? name[0] : name.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(3, name.length - shown.length))}@${domain}`;
}

// Decide whether a new code may be sent now. `row` is the person's current code row, if any.
export function sendAllowed(row: { sent_at: string; hour_started: string; sends_this_hour: number } | null, now = Date.now()):
  { ok: true; hourStarted: string; sendsThisHour: number } | { ok: false; reason: string } {
  if (!row) return { ok: true, hourStarted: new Date(now).toISOString(), sendsThisHour: 1 };
  const since = now - new Date(row.sent_at).getTime();
  if (since < RESEND_WAIT_MS) {
    return { ok: false, reason: `Please wait ${Math.ceil((RESEND_WAIT_MS - since) / 1000)} seconds before asking for another code.` };
  }
  const hourAgo = now - 60 * 60 * 1000;
  const sameHour = new Date(row.hour_started).getTime() > hourAgo;
  if (sameHour && row.sends_this_hour >= MAX_SENDS_PER_HOUR) {
    return { ok: false, reason: 'Too many codes have been sent. Please wait an hour, or ask a leader for help.' };
  }
  return sameHour
    ? { ok: true, hourStarted: row.hour_started, sendsThisHour: row.sends_this_hour + 1 }
    : { ok: true, hourStarted: new Date(now).toISOString(), sendsThisHour: 1 };
}

export function codeEmail(code: string, name: string) {
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text =
`Hi ${first},

Your Cornerstone Worship sign-in code is:

    ${spaced}

It works for 10 minutes. Type it into the app to finish signing in.

If you didn't just try to sign in, you can ignore this email. Your account is still safe, but it's a good idea to change your password.

— Cornerstone Mission Church Worship Team`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0b0f14;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f14;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16202a;border-radius:20px;border:1px solid #2a3a46;">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,'Times New Roman',serif;color:#f4f7f9;font-size:24px;">Cornerstone</td></tr>
<tr><td style="padding:0 28px 18px;font-family:Arial,Helvetica,sans-serif;color:#8ed4dc;font-size:12px;letter-spacing:3px;">WORSHIP TEAM</td></tr>
<tr><td style="padding:0 28px;font-family:Arial,Helvetica,sans-serif;color:#dfe6eb;font-size:18px;line-height:1.5;">Hi ${escapeHtml(first)},<br>Your sign-in code is:</td></tr>
<tr><td align="center" style="padding:22px 28px;">
  <div style="display:inline-block;background:#8dc63f;color:#0b1a05;border-radius:16px;padding:16px 26px;font-family:Arial,Helvetica,sans-serif;font-size:40px;font-weight:bold;letter-spacing:8px;">${spaced}</div>
</td></tr>
<tr><td style="padding:0 28px 26px;font-family:Arial,Helvetica,sans-serif;color:#b9c3cc;font-size:16px;line-height:1.5;">
It works for <b style="color:#f4f7f9;">10 minutes</b>. Type it into the app to finish signing in.<br><br>
If you didn't just try to sign in, you can ignore this email. Your account is still safe, but it's a good idea to change your password.</td></tr>
</table>
<p style="font-family:Arial,Helvetica,sans-serif;color:#6f7b86;font-size:12px;">Cornerstone Mission Church · Worship Team app</p>
</td></tr></table></body></html>`;
  return { subject: `${spaced} is your Cornerstone Worship code`, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
