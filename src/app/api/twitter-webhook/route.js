import { NextResponse } from 'next/server';
import { addTweets } from '@/lib/store';

/**
 * POST /api/twitter-webhook
 *
 * Receives incoming tweet payloads from TwitterAPI.io's webhook system.
 * Validates the request using x-api-key header, parses tweet data,
 * stores it, and responds with HTTP 200 immediately.
 */
export async function POST(request) {
  try {
    // 1. Optional API key validation (allow if key matches OR if request comes without key)
    const { searchParams } = new URL(request.url);
    const urlKey = searchParams.get('key');
    const headerKey = request.headers.get('x-api-key');
    const apiKey = urlKey || headerKey;
    
    const expectedKey = process.env.TWITTERAPI_IO_KEY;
    const validKeys = new Set([expectedKey].filter(Boolean));

    // If key is supplied, verify it matches any of the registered keys
    if (apiKey && !validKeys.has(apiKey)) {
      console.warn('[webhook] Unauthorized request — invalid api key provided:', apiKey);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse the request body safely
    let payload = {};
    try {
      const text = await request.text();
      if (text) payload = JSON.parse(text);
    } catch (e) {
      console.log('[webhook] Received invalid JSON or empty body ping.');
      return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
    }

    // If payload is empty, treat as validation ping
    if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
      return NextResponse.json({ status: 'ok', note: 'validation ping accepted' });
    }

    // 3. Extract raw tweets from any possible payload structure
    let rawTweets = [];
    if (Array.isArray(payload)) {
      rawTweets = payload;
    } else if (Array.isArray(payload.tweets)) {
      rawTweets = payload.tweets;
    } else if (Array.isArray(payload.data)) {
      rawTweets = payload.data;
    } else if (payload.data && typeof payload.data === 'object') {
      rawTweets = [payload.data];
    } else if (payload.tweet && typeof payload.tweet === 'object') {
      rawTweets = [payload.tweet];
    } else if (payload.id || payload.text || payload.tweetId) {
      rawTweets = [payload];
    }

    if (rawTweets.length === 0) {
      console.log('[webhook] Received event with no parseable tweets:', JSON.stringify(payload).slice(0, 200));
      return NextResponse.json({ status: 'ok', stored: 0 });
    }

    const normalizedTweets = rawTweets.map((tweet) => {
      const rawUserId = String(
        tweet.user?.id ||
        tweet.user_id ||
        tweet.x_user_id ||
        tweet.author_id ||
        tweet.author?.id ||
        ''
      );

      const KNOWN_USERS_BY_ID = {
        '68927629': { username: 'moneycontrolcom', name: 'Moneycontrol' },
        '420943164': { username: 'NDTVProfit', name: 'NDTV Profit' },
        '1255161552': { username: 'LiveLawIndia', name: 'Live Law' },
        '1933369219': { username: 'yatinmota', name: 'Yatin Mota' },
        '2859443173': { username: 'darshanvmehta1', name: 'Darshan Mehta' },
        '728571299228876800': { username: 'soumeet_sarkar', name: 'Soumeet Sarkar' },
      };

      // Intelligent username resolution
      let username =
        tweet.user?.username ||
        tweet.user?.screen_name ||
        tweet.user?.userName ||
        tweet.author?.username ||
        tweet.author?.userName ||
        tweet.author?.screen_name ||
        tweet.screen_name ||
        tweet.x_user_screen_name ||
        tweet.user_screen_name ||
        tweet.userName ||
        tweet.username ||
        '';

      let name =
        tweet.user?.name ||
        tweet.author?.name ||
        tweet.name ||
        tweet.x_user_name ||
        tweet.user_name ||
        tweet.display_name ||
        tweet.user?.screen_name ||
        'Unknown';

      // Match by Twitter User ID if available
      if (KNOWN_USERS_BY_ID[rawUserId]) {
        username = KNOWN_USERS_BY_ID[rawUserId].username;
        name = KNOWN_USERS_BY_ID[rawUserId].name;
      }

      // Fallback matching against known monitored accounts
      if (!username || username === 'unknown') {
        const textContent = (tweet.text || tweet.full_text || '').toLowerCase();
        const rawName = name.toLowerCase();
        if (rawName.includes('ani') || textContent.includes('ani')) {
          username = 'ANI';
          name = 'ANI';
        } else if (rawName.includes('yatin') || textContent.includes('yatin')) {
          username = 'YatinMota';
          name = 'Yatin Mota';
        } else if (rawName.includes('darshan') || textContent.includes('darshan')) {
          username = 'darshanvmehta1';
          name = 'Darshan Mehta';
        } else if (rawName.includes('soumeet') || textContent.includes('soumeet')) {
          username = 'soumeet_sarkar';
          name = 'Soumeet Sarkar';
        } else if (rawName.includes('moneycontrol') || textContent.includes('moneycontrol')) {
          username = 'moneycontrolcom';
          name = 'Moneycontrol';
        } else if (rawName.includes('ndtv') || textContent.includes('ndtv')) {
          username = 'NDTVProfit';
          name = 'NDTV Profit';
        } else if (rawName.includes('livelaw') || textContent.includes('livelaw')) {
          username = 'LiveLawIndia';
          name = 'Live Law';
        } else {
          username = name.replace(/\s+/g, '');
        }
      }

      let profileImage =
        tweet.user?.profile_image_url ||
        tweet.user?.profile_image_url_https ||
        tweet.user?.profileImageUrl ||
        tweet.author?.profile_image_url ||
        '';

      return {
        id: tweet.id || tweet.tweetId || `tweet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: tweet.text || tweet.full_text || '',
        created_at: tweet.created_at || tweet.createdAt || new Date().toISOString(),
        author: {
          id: tweet.user?.id || tweet.author?.id || `user-${username}`,
          name: name,
          username: username,
          profile_image_url: profileImage,
        },
        media: extractMedia(tweet),
        metrics: {
          likes: tweet.public_metrics?.like_count || tweet.favorite_count || tweet.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || tweet.retweet_count || 0,
          replies: tweet.public_metrics?.reply_count || tweet.reply_count || 0,
        },
        rule_id: payload.rule_id || '',
        rule_tag: payload.rule_tag || '',
        received_at: new Date().toISOString(),
      };
    });

    // 5. Store tweets (async S3 sync + local cache)
    await addTweets(normalizedTweets);

    console.log(
      `[webhook] Stored ${normalizedTweets.length} tweet(s) from rule "${payload.rule_tag}"`
    );

    // 6. Respond immediately with 200
    return NextResponse.json({ status: 'ok', stored: normalizedTweets.length });
  } catch (err) {
    console.error('[webhook] Error processing webhook:', err);
    // Still return 200 to prevent TwitterAPI.io from retrying
    return NextResponse.json({ status: 'ok', error: 'Processing error' });
  }
}

/**
 * GET /api/twitter-webhook
 * Health check endpoint for verification
 */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    service: 'X Monitoring Dashboard Webhook',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Extract media attachments from tweet data
 */
function extractMedia(tweet) {
  const media = [];

  // Handle standard entities.media
  if (tweet.entities?.media) {
    tweet.entities.media.forEach((m) => {
      media.push({
        type: m.type || 'photo',
        url: m.media_url_https || m.media_url || m.url,
        preview_url: m.media_url_https || m.media_url || m.url,
      });
    });
  }

  // Handle extended_entities.media (for videos, gifs)
  if (tweet.extended_entities?.media) {
    tweet.extended_entities.media.forEach((m) => {
      if (!media.find((existing) => existing.url === (m.media_url_https || m.url))) {
        media.push({
          type: m.type || 'photo',
          url: m.media_url_https || m.media_url || m.url,
          preview_url: m.media_url_https || m.media_url || m.url,
          video_url: m.video_info?.variants?.find((v) => v.content_type === 'video/mp4')?.url,
        });
      }
    });
  }

  // Handle includes.media (v2 API format)
  if (tweet.includes?.media) {
    tweet.includes.media.forEach((m) => {
      media.push({
        type: m.type || 'photo',
        url: m.url || m.preview_image_url,
        preview_url: m.preview_image_url || m.url,
      });
    });
  }

  // Handle mediaURLs (some TwitterAPI.io responses)
  if (tweet.mediaURLs || tweet.media_urls) {
    const urls = tweet.mediaURLs || tweet.media_urls || [];
    urls.forEach((url) => {
      if (!media.find((m) => m.url === url)) {
        media.push({
          type: 'photo',
          url,
          preview_url: url,
        });
      }
    });
  }

  return media;
}
