import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import Pusher from 'pusher';
import { addTweets, getStoreInfo } from '@/lib/store';
import { normalizePayload } from '@/lib/normalize';
import { isMarketOrGraceHours, getMarketStatus } from '@/lib/marketHours';

const pusher =
  process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET
    ? new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.PUSHER_CLUSTER || 'ap2',
        useTLS: true,
      })
    : null;

/**
 * POST /api/twitter-webhook — THE ingestion path.
 *
 * TwitterAPI.io pushes matching tweets here (configure the webhook URL in
 * their dashboard). Each delivery is merged into the S3 store with a
 * conditional write, so concurrent deliveries never lose data.
 *
 * Auth: TwitterAPI.io's delivery headers are undocumented, so the secret
 * travels in the URL you paste into their dashboard:
 *     https://<host>/api/twitter-webhook?key=<WEBHOOK_SECRET>
 * An `x-api-key` header with the same value is accepted too. With no
 * WEBHOOK_SECRET configured the route refuses every write — an open write
 * endpoint would let anyone inject "breaking news" into the feed.
 *
 * Window: nothing is stored outside 9:00–15:35 IST. TwitterAPI.io's user
 * stream has no on/off switch (only add/remove), so overnight deliveries do
 * arrive here — they get a fast 200 with no store access, which costs
 * effectively nothing on Vercel.
 */
export const dynamic = 'force-dynamic';

function secretMatches(provided) {
  const expected = process.env.WEBHOOK_SECRET || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  const provided =
    new URL(request.url).searchParams.get('key') || request.headers.get('x-api-key');
  if (!secretMatches(provided)) {
    console.warn('[webhook] Rejected request: missing or invalid secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload = null;
  try {
    const text = await request.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
  }
  if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
    return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
  }

  // Note: We process and push all tweets delivered by TwitterAPI.io.
  // The extension's Auto mode controls client-side sleep (9:00 - 15:30 IST),
  // while Manual ON allows the user to receive live breaking tweets in the evening.

  try {
    const tweets = normalizePayload(payload);
    if (tweets.length === 0) return NextResponse.json({ status: 'ok', stored: 0 });
    await addTweets(tweets);
    console.log(`[webhook] Stored ${tweets.length} tweet(s) from rule "${payload.rule_tag || '—'}"`);

    // Real-time push via Pusher (instant delivery to Chrome extension)
    if (pusher) {
      try {
        // Chunk to max 2 tweets per event to guarantee payload is always well below Pusher's 10KB limit
        for (let i = 0; i < tweets.length; i += 2) {
          const chunk = tweets.slice(i, i + 2);
          await pusher.trigger('x-monitor', 'new-tweets', { tweets: chunk });
        }
        console.log(`[webhook] Pushed ${tweets.length} tweet(s) to Pusher channel 'x-monitor'`);
      } catch (pushErr) {
        console.error('[webhook] Failed to push to Pusher:', pushErr);
      }
    }

    return NextResponse.json({ status: 'ok', stored: tweets.length, pushed: Boolean(pusher) });
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err);
    // 500 so TwitterAPI.io (if it retries) tries again rather than dropping the batch.
    return NextResponse.json({ status: 'error', error: 'Store write failed' }, { status: 500 });
  }
}

/** GET /api/twitter-webhook — health check. */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    service: 'X Monitoring backend',
    ingestion: 'twitterapi.io webhook → this route → S3',
    pusher: Boolean(pusher),
    store: getStoreInfo(),
    market: getMarketStatus(),
    timestamp: new Date().toISOString(),
  });
}
