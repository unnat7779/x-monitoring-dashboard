// ═══════════════════════════════════════════════════════════════════════════
// Tweet Normalization — shared by the stream listener and the webhook route.
//
// TwitterAPI.io emits several payload shapes depending on plan and event
// type. Everything funnels through here so the extension and dashboard only
// ever see one consistent object.
// ═══════════════════════════════════════════════════════════════════════════

// Twitter user IDs are stable; handles are not. Resolve by ID when possible.
const KNOWN_USERS_BY_ID = {
  '68927629': { username: 'moneycontrolcom', name: 'Moneycontrol' },
  '420943164': { username: 'NDTVProfit', name: 'NDTV Profit' },
  '1255161552': { username: 'LiveLawIndia', name: 'Live Law' },
  '1933369219': { username: 'yatinmota', name: 'Yatin Mota' },
  '2859443173': { username: 'darshanvmehta1', name: 'Darshan Mehta' },
  '728571299228876800': { username: 'soumeet_sarkar', name: 'Soumeet Sarkar' },
};

// Last-resort matching when a payload carries neither a usable ID nor handle.
const NAME_HINTS = [
  [/\bani\b/, 'ANI', 'ANI News'],
  [/yatin/, 'YatinMota', 'Yatin Mota'],
  [/darshan/, 'darshanvmehta1', 'Darshan Mehta'],
  [/soumeet/, 'soumeet_sarkar', 'Soumeet Sarkar'],
  [/moneycontrol/, 'moneycontrolcom', 'Moneycontrol'],
  [/ndtv/, 'NDTVProfit', 'NDTV Profit'],
  [/livelaw/, 'LiveLawIndia', 'Live Law'],
  [/cnbc/, 'CNBCTV18News', 'CNBC-TV18'],
  [/zee\s*business/, 'ZeeBusiness', 'Zee Business'],
  [/livemint|mint/, 'livemint', 'Livemint'],
  [/business\s*standard/, 'bsindia', 'Business Standard'],
  [/bloomberg/, 'business', 'Bloomberg'],
  [/\bpti\b/, 'PTI_News', 'PTI News'],
  [/et\s*now/, 'ETNOWlive', 'ET NOW'],
];

/**
 * Pull the raw tweet objects out of whatever envelope arrived.
 */
export function extractRawTweets(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tweets)) return payload.tweets;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === 'object') return [payload.data];
  if (payload.tweet && typeof payload.tweet === 'object') return [payload.tweet];
  if (payload.id || payload.text || payload.tweetId) return [payload];
  return [];
}

function resolveAuthor(tweet) {
  const rawUserId = String(
    tweet.user?.id ||
      tweet.user_id ||
      tweet.x_user_id ||
      tweet.author_id ||
      tweet.author?.id ||
      ''
  );

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

  // Strongest signal: stable numeric user ID.
  if (KNOWN_USERS_BY_ID[rawUserId]) {
    username = KNOWN_USERS_BY_ID[rawUserId].username;
    name = KNOWN_USERS_BY_ID[rawUserId].name;
  }

  // Fall back to fuzzy matching on the display name only. The original code
  // also searched the tweet BODY, which misattributed any tweet that merely
  // mentioned "ANI" or "Moneycontrol" to that account.
  if (!username || username.toLowerCase() === 'unknown') {
    const haystack = String(name).toLowerCase();
    // Also test a punctuation-stripped form so "Live Law" matches /livelaw/.
    const compact = haystack.replace(/[^a-z0-9]/g, '');
    const hit = NAME_HINTS.find(([re]) => re.test(haystack) || re.test(compact));
    if (hit) {
      username = hit[1];
      name = hit[2];
    } else {
      username = String(name).replace(/\s+/g, '');
    }
  }

  const profileImage =
    tweet.user?.profile_image_url ||
    tweet.user?.profile_image_url_https ||
    tweet.user?.profileImageUrl ||
    tweet.author?.profile_image_url ||
    '';

  return {
    id: tweet.user?.id || tweet.author?.id || `user-${username}`,
    name,
    username,
    profile_image_url: profileImage,
  };
}

/**
 * Collect photo / video / GIF attachments from every shape seen in the wild.
 */
export function extractMedia(tweet) {
  const media = [];
  const push = (entry) => {
    if (!entry?.url) return;
    if (media.some((m) => m.url === entry.url)) return;
    media.push(entry);
  };

  (tweet.entities?.media || []).forEach((m) =>
    push({
      type: m.type || 'photo',
      url: m.media_url_https || m.media_url || m.url,
      preview_url: m.media_url_https || m.media_url || m.url,
    })
  );

  (tweet.extended_entities?.media || []).forEach((m) =>
    push({
      type: m.type || 'photo',
      url: m.media_url_https || m.media_url || m.url,
      preview_url: m.media_url_https || m.media_url || m.url,
      video_url: m.video_info?.variants?.find((v) => v.content_type === 'video/mp4')?.url,
    })
  );

  (tweet.includes?.media || []).forEach((m) =>
    push({
      type: m.type || 'photo',
      url: m.url || m.preview_image_url,
      preview_url: m.preview_image_url || m.url,
    })
  );

  (tweet.mediaURLs || tweet.media_urls || []).forEach((url) =>
    push({ type: 'photo', url, preview_url: url })
  );

  return media;
}

/**
 * Normalize one raw tweet into the canonical shape the extension renders.
 */
export function normalizeTweet(tweet, meta = {}) {
  return {
    id: String(
      tweet.id ||
        tweet.tweetId ||
        `tweet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    ),
    text: tweet.text || tweet.full_text || '',
    created_at: tweet.created_at || tweet.createdAt || new Date().toISOString(),
    author: resolveAuthor(tweet),
    media: extractMedia(tweet),
    metrics: {
      likes:
        tweet.public_metrics?.like_count ||
        tweet.favorite_count ||
        tweet.like_count ||
        0,
      retweets: tweet.public_metrics?.retweet_count || tweet.retweet_count || 0,
      replies: tweet.public_metrics?.reply_count || tweet.reply_count || 0,
    },
    rule_id: meta.rule_id || '',
    rule_tag: meta.rule_tag || '',
    received_at: new Date().toISOString(),
  };
}

/**
 * Envelope in, canonical tweet array out.
 */
export function normalizePayload(payload) {
  const raw = extractRawTweets(payload);
  if (raw.length === 0) return [];
  const meta = {
    rule_id: payload?.rule_id || '',
    rule_tag: payload?.rule_tag || '',
  };
  return raw.map((t) => normalizeTweet(t, meta));
}
