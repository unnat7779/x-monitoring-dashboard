// ═══════════════════════════════════════════════════════════════════════════
// TwitterAPI.io → local store bridge
//
// Holds the WebSocket to TwitterAPI.io and persists every incoming tweet.
//
// DIRECT mode (default): writes into the local store in-process. No HTTP hop,
// no webhook endpoint, no running Next.js server required. Ingestion keeps
// working even while the dashboard is restarting or closed.
//
// WEBHOOK mode: set WEBHOOK_URL to POST payloads to a running server instead
// (the old Render behaviour). Only needed if the store lives somewhere else.
// ═══════════════════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Load .env.local (all keys, not just the API key) ─────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(PROJECT_ROOT, '.env.local'));

// Pin the store path to the project root so the listener and Next.js always
// agree, no matter which directory the process was launched from.
if (!process.env.LOCAL_STORE_PATH) {
  process.env.LOCAL_STORE_PATH = join(PROJECT_ROOT, '.data', 'tweets.json');
}

const { addTweets, getStoreInfo } = await import('../src/lib/store.mjs');
const { normalizePayload } = await import('../src/lib/normalize.mjs');
const { isMarketOrGraceHours } = await import('../src/lib/marketHours.js');

const API_KEY = process.env.TWITTERAPI_IO_KEY || '';
const WS_URL = process.env.TWITTERAPI_WS_URL || 'wss://ws.twitterapi.io/twitter/tweet/websocket';
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // empty = DIRECT mode
const MODE = WEBHOOK_URL ? 'webhook' : 'direct';

const PING_INTERVAL_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;

const maskedKey = API_KEY
  ? `${API_KEY.slice(0, 6)}…${API_KEY.slice(-4)}`
  : '(missing!)';

console.log('═══════════════════════════════════════════════════════════════');
console.log('⚡ X Monitor — local ingestion bridge');
console.log(`   Mode:     ${MODE.toUpperCase()}${MODE === 'direct' ? ' (no server needed)' : ` → ${WEBHOOK_URL}`}`);
console.log(`   API key:  ${maskedKey}`);
console.log(`   Store:    ${getStoreInfo().path}`);
console.log(`   S3:       ${getStoreInfo().s3Mirror ? 'mirroring enabled' : 'off (local only)'}`);
console.log('═══════════════════════════════════════════════════════════════');

if (!API_KEY) {
  console.error('✖ TWITTERAPI_IO_KEY is not set. Add it to .env.local and restart.');
  process.exit(1);
}

let ws = null;
let reconnectDelay = 1000;
let pingInterval = null;
let tweetsSeen = 0;
let intentionalDisconnect = false; // true when WE close the socket for off-hours
let marketCheckInterval = null;

async function persist(payload) {
  // Double-check: allow up to 3:35 PM IST (5 min post-market grace period)
  if (!isMarketOrGraceHours()) return;

  if (MODE === 'webhook') {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    console.log(`[stream] Forwarded to webhook: status=${res.status}`, result);
    return;
  }

  const tweets = normalizePayload(payload);
  if (tweets.length === 0) {
    console.log('[stream] Event contained no parseable tweets — ignored.');
    return;
  }
  await addTweets(tweets);
  tweetsSeen += tweets.length;
  for (const t of tweets) {
    const preview = (t.text || '').replace(/\s+/g, ' ').slice(0, 80);
    console.log(`   ↳ @${t.author.username}: ${preview}${preview.length >= 80 ? '…' : ''}`);
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // already connected
  }

  console.log(`[stream] Connecting to ${WS_URL}…`);
  intentionalDisconnect = false;

  ws = new WebSocket(WS_URL, { headers: { 'x-api-key': API_KEY } });

  ws.on('open', () => {
    console.log('✅ [stream] Connected and authenticated.');
    reconnectDelay = 1000;
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.ping();
    }, PING_INTERVAL_MS);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());

      if (payload.status === 'connected' || payload.event_type === 'connected') {
        console.log(`[stream] Handshake confirmed for user ${payload.user_id ?? '—'}`);
        return;
      }
      if (payload.event_type === 'ping' || payload.ping) return;

      console.log(`⚡ [stream] Incoming tweet event (${tweetsSeen} stored so far)`);
      await persist(payload);
    } catch (err) {
      console.error('[stream] Error processing payload:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingInterval);
    ws = null;

    // If WE disconnected intentionally for off-hours, don't auto-reconnect.
    // The market-hours scheduler will reconnect when it's time.
    if (intentionalDisconnect) {
      console.log('[stream] Socket closed (off-hours). Sleeping until market opens.');
      return;
    }

    console.warn(
      `[stream] Socket closed (${code}): ${reason || 'connection lost'}. ` +
        `Reconnecting in ${Math.round(reconnectDelay / 1000)}s…`
    );
    setTimeout(() => {
      // Only reconnect if still in market hours
      if (isMarketOrGraceHours()) {
        connect();
      } else {
        console.log('[stream] Market closed during reconnect wait. Sleeping.');
      }
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[stream] Socket error:', err.message);
  });
}

function disconnect() {
  intentionalDisconnect = true;
  clearInterval(pingInterval);
  pingInterval = null;
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

// ── Market Hours Scheduler ─────────────────────────────────────────────
// Checks every 30s whether we should be connected or disconnected.
// Fully disconnects the WebSocket outside 9:00 AM – 3:30 PM IST (Daily)
// so there is ZERO bandwidth, ZERO TwitterAPI.io usage, and ZERO S3 writes
// during off-hours.
let wasMarketOpen = false;

function checkMarketHours() {
  const nowOpen = isMarketOrGraceHours();

  if (nowOpen && !wasMarketOpen) {
    // Market just opened → connect
    console.log('🔔 [stream] Market hours started (9:00 AM IST) — connecting WebSocket…');
    wasMarketOpen = true;
    reconnectDelay = 1000;
    connect();
  } else if (!nowOpen && wasMarketOpen) {
    // Market + 5 min grace ended (3:35 PM IST) → disconnect
    console.log('🔕 [stream] Market + 5m grace ended (3:35 PM IST) — disconnecting WebSocket. Sleeping.');
    wasMarketOpen = false;
    disconnect();
  } else if (!nowOpen && !wasMarketOpen) {
    // Still off-hours — make sure we're disconnected
    if (ws) disconnect();
  }
}

// Clean shutdown so launchd restarts are quiet.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[stream] ${sig} received — closing socket.`);
    clearInterval(pingInterval);
    clearInterval(marketCheckInterval);
    try { ws?.close(); } catch {}
    process.exit(0);
  });
}

// ── Start ──────────────────────────────────────────────────────────────
// Initial check: connect immediately if within market hours, otherwise sleep.
wasMarketOpen = isMarketOrGraceHours();
if (wasMarketOpen) {
  console.log('[stream] Within market hours (or 5m grace) — connecting now.');
  connect();
} else {
  console.log('[stream] Outside market hours (9:00 AM - 3:35 PM IST Daily). Sleeping until market opens…');
}

// Check every 30 seconds for market hour transitions
marketCheckInterval = setInterval(checkMarketHours, 30_000);
