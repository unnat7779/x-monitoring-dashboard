import { NextResponse } from 'next/server';
import { getTweets } from '@/lib/store';
import { isMarketHours, getMarketStatus } from '@/lib/marketHours';

/**
 * GET /api/tweets — the feed the extension polls.
 *
 * Cost controls, in order:
 *  1. The extension itself only polls 9:00–15:30 IST (or during a 5-min ON).
 *  2. Any un-forced request outside the window gets a tiny, CDN-cached answer
 *     (s-maxage) so the function is not even invoked for stray clients.
 *  3. Inside the window, ETag / 304 keeps unchanged polls at zero bytes.
 *
 * `?force=1` bypasses (2). The extension always sends it, because the CDN
 * key is the URL: without it a "closed" answer cached at 08:59 could be
 * served back at 09:00, and a manual ON at night could never see data.
 */
export const dynamic = 'force-dynamic';

// The panel shows at most 5 posts; a full day can hold hundreds. Send only the
// newest few so a changed feed never costs more than a few KB per poll.
const FEED_LIMIT = 50;

const OFF_HOURS_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'X-Market-Hours': 'closed',
};

// DJB2 over the top IDs — cheap, stable, and changes when a row expires too.
function feedHash(tweets) {
  const key = tweets.slice(0, 20).map((t) => t.id).join(',');
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return String(hash);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // Reject unauthenticated callers before doing any real work.
    // The extension sends this client identifier; random scanners don't.
    const pollToken = process.env.POLL_TOKEN;
    const providedToken = searchParams.get('token') || request.headers.get('x-poll-token');
    const clientId = searchParams.get('client') || request.headers.get('x-client-id');
    const isAuthorized =
      clientId === 'x-monitor-extension-client' ||
      (pollToken && providedToken === pollToken) ||
      !pollToken;

    if (pollToken && !isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';

    if (!force && !isMarketHours()) {
      return NextResponse.json(
        {
          tweets: [],
          count: 0,
          marketHours: false,
          message: 'Outside market hours (9:00 AM - 3:30 PM IST Daily). Backend in power-save mode.',
          marketStatus: getMarketStatus(),
        },
        { headers: OFF_HOURS_HEADERS }
      );
    }

    const tweets = (await getTweets()).slice(0, FEED_LIMIT);
    const hash = feedHash(tweets);
    const etag = `"${hash}"`;
    const clientTag = request.headers.get('if-none-match');

    if (clientTag && (clientTag === etag || clientTag === hash)) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'X-Feed-Hash': hash, 'Cache-Control': 'no-cache' },
      });
    }

    const now = new Date().toISOString();
    return NextResponse.json(
      { tweets, count: tweets.length, timestamp: now, feedHash: hash },
      {
        headers: {
          'Cache-Control': 'no-cache',
          ETag: etag,
          'X-Feed-Hash': hash,
          'X-Feed-Timestamp': now,
        },
      }
    );
  } catch (err) {
    console.error('[tweets] Error fetching tweets:', err);
    return NextResponse.json(
      { tweets: [], count: 0, error: 'Failed to fetch tweets' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
