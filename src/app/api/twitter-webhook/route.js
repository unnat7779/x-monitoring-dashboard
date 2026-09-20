import { NextResponse } from 'next/server';
import { addTweets, getStoreInfo } from '@/lib/store';
import { normalizePayload } from '@/lib/normalize';
import { isMarketHours, getMarketStatus } from '@/lib/marketHours';

/**
 * POST /api/twitter-webhook
 *
 * Kept for compatibility with TwitterAPI.io's hosted webhook delivery and for
 * manual curl testing. In the default LOCAL setup this route is NOT used:
 * scripts/stream-listener.mjs writes to the store in-process, so there is no
 * HTTP hop and ingestion keeps working even while Next.js is restarting.
 */
export async function POST(request) {
  try {
    if (!isMarketHours()) {
      return NextResponse.json({
        status: 'ok',
        stored: 0,
        note: 'outside_market_hours (Active 9:00 AM - 3:30 PM IST Daily)',
      });
    }

    // Optional API key check — only enforced when a key is actually supplied.
    const { searchParams } = new URL(request.url);
    const apiKey = searchParams.get('key') || request.headers.get('x-api-key');
    const expectedKey = process.env.TWITTERAPI_IO_KEY;

    if (apiKey && expectedKey && apiKey !== expectedKey) {
      console.warn('[webhook] Rejected request with invalid api key');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload = {};
    try {
      const text = await request.text();
      if (text) payload = JSON.parse(text);
    } catch {
      return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
    }

    if (!payload || Object.keys(payload).length === 0) {
      return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
    }

    const tweets = normalizePayload(payload);
    if (tweets.length === 0) {
      return NextResponse.json({ status: 'ok', stored: 0 });
    }

    await addTweets(tweets);
    console.log(`[webhook] Stored ${tweets.length} tweet(s) from rule "${payload.rule_tag || '—'}"`);

    return NextResponse.json({ status: 'ok', stored: tweets.length });
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err);
    // Still 200 so the sender does not retry a payload we cannot parse.
    return NextResponse.json({ status: 'ok', error: 'Processing error' });
  }
}

/**
 * GET /api/twitter-webhook — health check.
 */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    service: 'X Monitoring — local backend',
    mode: 'local',
    store: getStoreInfo(),
    timestamp: new Date().toISOString(),
  });
}
