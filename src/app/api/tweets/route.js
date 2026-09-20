import { NextResponse } from 'next/server';
import { getTweets, getTweetsSince } from '@/lib/store';
import { isMarketHours, getMarketStatus } from '@/lib/marketHours';

/**
 * GET /api/tweets
 *
 * Returns stored tweets from database/S3 cache.
 * Active window: 9:00 AM - 3:30 PM IST (Daily) to minimize Vercel usage.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force =
      searchParams.get('force') === '1' ||
      searchParams.get('force') === 'true' ||
      request.headers.get('x-force-poll') === '1';

    const marketActive = isMarketHours();

    // If outside market hours and NOT manually forced, return off-hours response with Edge caching
    // so Vercel CDN serves it without invoking the Serverless Function.
    if (!marketActive && !force) {
      return NextResponse.json(
        {
          tweets: [],
          count: 0,
          marketHours: false,
          message: 'Outside market hours (9:00 AM - 3:30 PM IST Daily). Backend in power-save mode.',
          marketStatus: getMarketStatus(),
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
            'X-Market-Hours': 'closed',
          },
        }
      );
    }
    const since = searchParams.get('since');
    const account = searchParams.get('account');

    let tweets = since ? await getTweetsSince(since) : await getTweets();

    // Filter by account if specified
    if (account && account !== 'all') {
      tweets = tweets.filter(
        (t) => t.author?.username?.toLowerCase() === account.toLowerCase()
      );
    }

    // Compute a lightweight feed hash from the top tweet IDs so clients can
    // detect changes without comparing full payloads.
    const feedHash = tweets
      .slice(0, 20)
      .map((t) => t.id)
      .join(',');
    // Simple DJB2-style hash
    let hash = 5381;
    for (let i = 0; i < feedHash.length; i++) {
      hash = ((hash << 5) + hash + feedHash.charCodeAt(i)) >>> 0;
    }

    const hashStr = String(hash);
    const clientHash = request.headers.get('if-none-match') || searchParams.get('hash');

    // If client already has this exact feed version, return 304 Not Modified (0 bytes payload!)
    if (clientHash && (clientHash === hashStr || clientHash === `"${hashStr}"`)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': `"${hashStr}"`,
          'X-Feed-Hash': hashStr,
          'Cache-Control': 'no-cache',
        },
      });
    }

    const now = new Date().toISOString();

    return NextResponse.json(
      {
        tweets,
        count: tweets.length,
        timestamp: now,
        feedHash: hashStr,
      },
      {
        headers: {
          'Cache-Control': 'no-cache',
          'ETag': `"${hashStr}"`,
          'X-Feed-Hash': hashStr,
          'X-Feed-Timestamp': now,
        },
      }
    );
  } catch (err) {
    console.error('[tweets] Error fetching tweets:', err);
    return NextResponse.json(
      { tweets: [], count: 0, error: 'Failed to fetch tweets' },
      { status: 500 }
    );
  }
}
