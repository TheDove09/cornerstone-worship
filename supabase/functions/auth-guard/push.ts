// Phone notifications (Web Push). Notifications are encrypted for each phone,
// signed with the app's VAPID key, and delivered by Apple / Google.
import webpush from 'npm:web-push@3.6.7';

export type PhoneSub = { endpoint: string; p256dh: string; auth: string };
export type PushResult = 'sent' | 'gone' | 'failed';

export async function sendPush(sub: PhoneSub, payload: unknown, vapid: { subject: string; publicKey: string; privateKey: string }): Promise<PushResult> {
  // web-push prepares the encrypted message; the built-in fetch sends it.
  const d = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    { TTL: 60 * 60 * 24, urgency: 'high', vapidDetails: vapid },
  );
  try {
    const res = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body });
    if (res.status === 404 || res.status === 410) return 'gone';            // phone turned notifications off / app removed
    if (!res.ok) { console.error('push failed', res.status, (await res.text()).slice(0, 200)); return 'failed'; }
    return 'sent';
  } catch (e) {
    console.error('push error', e);
    return 'failed';
  }
}

// Keep notification text short and plain.
export function messagePayload(m: { id: string; title: string; body: string; author_name: string; service_id: string | null }) {
  const body = (m.body || '').replace(/\s+/g, ' ').trim();
  return {
    title: m.title.slice(0, 80),
    body: `${m.author_name ? m.author_name + ': ' : ''}${body}`.slice(0, 180) || 'Tap to read.',
    url: m.service_id ? `./#/services/${m.service_id}` : './#/messages',
    tag: `msg-${m.id}`,
  };
}
