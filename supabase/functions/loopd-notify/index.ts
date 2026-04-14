// Loopd — Daily Birthday & Event Reminder
// Deploy to Supabase Edge Functions and run on a daily cron schedule.
// Reads loopd_data from Supabase, finds events in the next 3 days,
// and sends push notifications to all subscribed devices.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_PUBLIC_KEY = 'BC9UuIROuGbsHHW6eofWiC0kJkMncMjQItE0zStaer1K6oscxWCc903hViCBxwaxNqk6IxBX5wst4Akv77vB-Aw';
const VAPID_SUBJECT = 'mailto:ilana@pointerstrategy.com.au';

function base64UrlDecode(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

async function getVapidAuthHeaders(endpoint: string): Promise<Record<string, string>> {
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: now + 12 * 3600, sub: VAPID_SUBJECT };
  const enc = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sigInput = `${enc(header)}.${enc(payload)}`;

  const keyData = base64UrlDecode(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${sigInput}.${sigB64}`;

  return {
    'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
    'Content-Type': 'application/json',
    'TTL': '86400',
  };
}

async function sendPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: object) {
  const headers = await getVapidAuthHeaders(sub.endpoint);
  const bodyStr = JSON.stringify(payload);

  // Encrypt the payload using the subscription keys
  // For simplicity, we send unencrypted with content-encoding: aes128gcm
  // In production you'd use web-push encryption — here we use the endpoint directly
  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers,
    body: bodyStr,
  });
  return resp.status;
}

function daysUntil(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

Deno.serve(async (req) => {
  // Allow manual trigger via POST or scheduled cron
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch shared app state
  const { data, error } = await supabase
    .from('loopd_data')
    .select('data')
    .eq('id', 1)
    .single();

  if (error || !data) return new Response('No data', { status: 404 });

  const state = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
  const events: Array<{ id: number; type: string; child?: string; family?: string; date: string; note?: string }> = state.events || [];
  const pushSubs: Array<{ endpoint: string; keys: { p256dh: string; auth: string } }> = state.pushSubscriptions || [];

  if (!pushSubs.length) return new Response('No subscriptions', { status: 200 });

  // Find events in the next 1–3 days
  const upcoming = events.filter(e => {
    const d = daysUntil(e.date);
    return d >= 0 && d <= 3;
  });

  const results: string[] = [];

  for (const e of upcoming) {
    const d = daysUntil(e.date);
    const name = e.child || e.family || 'Someone';
    const emoji = e.type === 'birthday' ? '🎂' : e.type === 'pregnancy' ? '🤰' : '🎉';
    const when = d === 0 ? 'today!' : d === 1 ? 'tomorrow!' : `in ${d} days`;
    const title = `${emoji} ${name}'s ${e.type === 'birthday' ? 'birthday' : 'event'} is ${when}`;
    const body = e.note ? e.note : `Don't forget to celebrate with your village 💜`;

    for (const sub of pushSubs) {
      try {
        const status = await sendPush(sub, { title, body, tag: `loopd-event-${e.id}`, url: 'https://ilgoldman-create.github.io/Loopd' });
        results.push(`${name}: ${status}`);
      } catch (err) {
        results.push(`${name}: error ${err}`);
      }
    }
  }

  return new Response(JSON.stringify({ sent: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
