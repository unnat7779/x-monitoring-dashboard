/**
 * X Monitor — Cloudflare Edge Shield
 *
 * Sits between TwitterAPI.io and the Vercel backend. During Indian market
 * hours (9:00 AM – 3:35 PM IST) requests are proxied to Vercel. Outside
 * that window the worker swallows the request at the edge — Vercel is
 * never invoked, so zero serverless credits are consumed.
 *
 * IST = UTC+5:30 (no DST), so we use a fixed offset.
 */

const VERCEL_ORIGIN = 'https://x-monitoring-dashboard.vercel.app';

// IST market window (minutes since midnight)
const MARKET_OPEN_MIN  = 9 * 60;        // 09:00
const MARKET_CLOSE_MIN = 15 * 60 + 35;  // 15:35 (5-min grace after 15:30 close)
const IST_OFFSET_MS    = 5.5 * 60 * 60 * 1000;

function istMinuteOfDay(now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isMarketHours() {
  const m = istMinuteOfDay();
  return m >= MARKET_OPEN_MIN && m < MARKET_CLOSE_MIN;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only gate the webhook route; pass everything else through untouched
    if (!url.pathname.startsWith('/api/twitter-webhook')) {
      return fetch(`${VERCEL_ORIGIN}${url.pathname}${url.search}`, request);
    }

    // ── Outside market hours: absorb at edge, Vercel cost = $0 ──────────
    if (!isMarketHours()) {
      const m = istMinuteOfDay();
      const h = Math.floor(m / 60);
      const min = m % 60;
      return new Response(
        JSON.stringify({
          status: 'ignored',
          reason: 'outside_market_hours',
          edge: 'cloudflare',
          ist_time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
          market_window: '09:00 – 15:35 IST',
          message: 'Request absorbed at Cloudflare edge. Vercel was NOT invoked.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // ── During market hours: proxy to Vercel ────────────────────────────
    const vercelUrl = `${VERCEL_ORIGIN}${url.pathname}${url.search}`;
    const proxyRequest = new Request(vercelUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    return fetch(proxyRequest);
  },
};
