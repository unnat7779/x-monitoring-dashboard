/**
 * Indian market window: 9:00 AM – 3:30 PM IST, every day.
 * Half-open [09:00, 15:30) — identical to the check in extension/background.js,
 * so client and server always agree on the boundary second.
 * IST has no DST, so a fixed UTC+5:30 offset is exact.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;
export const MARKET_OPEN_MIN = 9 * 60;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;
export const PURGE_MIN = 8 * 60 + 55; // daily wipe of yesterday's posts

/** Minutes since IST midnight for the given instant. */
export function istMinuteOfDay(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function isMarketHours(date = new Date(), extraMinutes = 0) {
  const m = istMinuteOfDay(date);
  return m >= MARKET_OPEN_MIN && m < MARKET_CLOSE_MIN + extraMinutes;
}

/**
 * Market window plus a 5-minute tail (until 15:35 IST). The stream listener
 * stays connected this long so posts made in the last seconds before close,
 * and during a manual ON pressed just before close, are still captured.
 */
export function isMarketOrGraceHours(date = new Date()) {
  return isMarketHours(date, 5);
}

/**
 * Retention boundary: epoch ms of the most recent 08:55 IST at or before
 * `now`. A post is kept only if it was created at or after this instant, so
 * at 08:55:00 every morning yesterday's posts disappear everywhere at once —
 * no cron needed, every layer computes the same answer.
 */
export function retentionCutoff(now = Date.now()) {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  let cutoff = istMidnight + PURGE_MIN * 60000;
  if (cutoff > istNow) cutoff -= DAY_MS;
  return cutoff - IST_OFFSET_MS;
}

export function getMarketStatus(date = new Date()) {
  return {
    isMarketHours: isMarketHours(date),
    window: '9:00 AM - 3:30 PM IST (Daily)',
    retention: 'since 8:55 AM IST today',
    timezone: 'Asia/Kolkata (UTC+5:30)',
  };
}
