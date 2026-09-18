import { NextResponse } from 'next/server';
import { getTweets, getTweetsSince } from '@/lib/store';

/**
 * GET /api/tweets
 *
 * Returns stored tweets from database/S3 cache.
 * Makes 0 external API calls so you have 100% control over your TwitterAPI.io credits.
 * Credits are ONLY consumed when you turn ON your filter rule in TwitterAPI.io.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
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
