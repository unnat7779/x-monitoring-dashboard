import WebSocket from 'ws';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Load environment variables from .env.local if present
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
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

const API_KEY = process.env.TWITTERAPI_IO_KEY || '';
const WS_URL = process.env.TWITTERAPI_WS_URL || 'wss://ws.twitterapi.io/twitter/tweet/websocket';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://x-monitoring-dashboard.vercel.app/api/twitter-webhook';
const HTTP_PORT = parseInt(process.env.LISTENER_PORT || process.env.PORT || '3000', 10);

const PING_INTERVAL_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MANUAL_ON_DEFAULT_MS = 5 * 60 * 1000; // 5 minutes

// ── Market Hours Clock (IST: UTC+5:30) ──────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MIN = 9 * 60;          // 9:00 AM IST
const MARKET_CLOSE_MIN = 15 * 60 + 30;   // 3:30 PM IST

function istMinuteOfDay(now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isMarketHours(now = Date.now()) {
  const m = istMinuteOfDay(now);
  return m >= MARKET_OPEN_MIN && m < MARKET_CLOSE_MIN;
}

let ws = null;
let reconnectDelay = 1000;
let pingInterval = null;
let tweetsSeen = 0;
let manualOnUntil = 0;
let manualCutoffTimer = null;
let stateCheckInterval = null;

function shouldBeConnected() {
  const now = Date.now();
  if (now < manualOnUntil) return true;
  return isMarketHours(now);
}

function getStatusDescription() {
  const now = Date.now();
  if (now < manualOnUntil) {
    const remSec = Math.max(0, Math.ceil((manualOnUntil - now) / 1000));
    return `Manual ON active (${remSec}s remaining before sleep)`;
  }
  if (isMarketHours(now)) {
    return 'Market Hours Auto-ON (9:00 AM - 3:30 PM IST)';
  }
  return 'Sleeping (Off-hours). Zero bandwidth, zero Vercel/Pusher usage.';
}

const maskedKey = API_KEY
  ? `${API_KEY.slice(0, 6)}…${API_KEY.slice(-4)}`
  : '(missing!)';

console.log('═══════════════════════════════════════════════════════════════');
console.log('⚡ X Monitor — TwitterAPI.io Controlled Stream Bridge');
console.log(`   Schedule: 9:00 AM – 3:30 PM IST (Auto-ON) | 5-min Manual ON`);
console.log(`   Target:   ${WEBHOOK_URL}?key=${maskedKey}`);
console.log(`   API key:  ${maskedKey}`);
console.log('═══════════════════════════════════════════════════════════════');

if (!API_KEY) {
  console.error('✖ TWITTERAPI_IO_KEY is not set. Add it to .env.local and restart.');
  process.exit(1);
}

async function forwardToWebhook(payload) {
  if (!shouldBeConnected()) {
    console.log('[stream] Tweet received while sleeping — skipped forward to preserve credits.');
    return;
  }

  try {
    const targetUrl = `${WEBHOOK_URL}?key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json().catch(() => ({}));
    tweetsSeen++;
    console.log(`⚡ [stream] Tweet #${tweetsSeen} forwarded to Vercel/Pusher: HTTP ${res.status}`, result);
  } catch (err) {
    console.error('✖ [stream] Failed to forward tweet to webhook:', err.message);
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`[stream] Connecting to ${WS_URL}… [${getStatusDescription()}]`);

  ws = new WebSocket(WS_URL, {
    headers: {
      'x-api-key': API_KEY,
    },
  });

  ws.on('open', () => {
    console.log(`✅ [stream] Connected & authenticated to TwitterAPI.io WebSocket. [${getStatusDescription()}]`);
    reconnectDelay = 1000;
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.ping();
      }
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

      console.log(`⚡ [stream] Incoming tweet from TwitterAPI.io stream…`);
      await forwardToWebhook(payload);
    } catch (err) {
      console.error('[stream] Error processing payload:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingInterval);
    ws = null;

    if (!shouldBeConnected()) {
      console.log(`🔕 [stream] WebSocket closed. Backend is now sleeping.`);
      return;
    }

    console.warn(
      `[stream] Socket closed (${code}): ${reason || 'connection lost'}. ` +
        `Reconnecting in ${Math.round(reconnectDelay / 1000)}s…`
    );
    setTimeout(() => {
      if (shouldBeConnected()) connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[stream] Socket error:', err.message);
  });
}

function disconnect(reason = 'off-hours') {
  clearInterval(pingInterval);
  pingInterval = null;
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
  console.log(`🔕 [stream] Disconnected WebSocket (${reason}). System sleeping.`);
}

function reconcileState(trigger = '') {
  const active = shouldBeConnected();
  if (active && (!ws || ws.readyState === WebSocket.CLOSED)) {
    console.log(`🔔 [stream] State check [${trigger}]: Should be active. Connecting…`);
    connect();
  } else if (!active && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.log(`🔕 [stream] State check [${trigger}]: Outside market hours and manual window expired. Sleeping…`);
    disconnect(trigger);
  }
}

// ── Manual ON / OFF Trigger Logic ───────────────────────────────────────
function triggerManualOn(durationMs = MANUAL_ON_DEFAULT_MS) {
  manualOnUntil = Date.now() + durationMs;
  if (manualCutoffTimer) clearTimeout(manualCutoffTimer);

  console.log(
    `⚡ [stream] MANUAL ON ACTIVATED! Running for ${Math.round(durationMs / 60000)} minutes ` +
      `(until ${new Date(manualOnUntil).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST).`
  );

  connect();

  // Exact 5-minute auto cut-off timer
  manualCutoffTimer = setTimeout(() => {
    console.log('⏰ [stream] Manual ON 5-minute cut-off expired.');
    manualOnUntil = 0;
    reconcileState('manual_cutoff_expired');
  }, durationMs + 250);
}

function triggerManualOff() {
  console.log('🛑 [stream] Manual OFF received.');
  manualOnUntil = 0;
  if (manualCutoffTimer) {
    clearTimeout(manualCutoffTimer);
    manualCutoffTimer = null;
  }
  reconcileState('manual_off');
}

// ── Local Control HTTP Server ───────────────────────────────────────────
// Allows the Chrome extension to signal Manual ON / OFF directly.
const server = http.createServer((req, res) => {
  // Enable CORS so extension background script can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/api/manual-on') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let duration = MANUAL_ON_DEFAULT_MS;
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.duration) duration = Number(parsed.duration);
        if (parsed.mode === 'off') {
          triggerManualOff();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, mode: 'off' }));
          return;
        }
      } catch {}
      triggerManualOn(duration);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: 'on', until: manualOnUntil }));
    });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/api/manual-off' || url.pathname === '/manual-off')) {
    triggerManualOff();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: 'off' }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/status')) {
    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        marketHours: isMarketHours(now),
        manualOn: now < manualOnUntil,
        manualOnRemainingSec: Math.max(0, Math.ceil((manualOnUntil - now) / 1000)),
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        state: getStatusDescription(),
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🌐 [stream] Control server listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`   Control endpoints: POST /api/manual-on, POST /api/manual-off, GET /api/status`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠ [stream] Port ${HTTP_PORT} already in use. Control HTTP server disabled, will rely on timer & Pusher.`);
  } else {
    console.error('✖ [stream] Control server error:', err.message);
  }
});

// Periodic check every 15s to switch on/off cleanly at 9:00 AM and 3:30 PM IST
stateCheckInterval = setInterval(() => {
  reconcileState('periodic_check');
}, 15000);

// Initial start check
reconcileState('initial_boot');

// Clean shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[stream] ${sig} received — shutting down.`);
    clearInterval(pingInterval);
    clearInterval(stateCheckInterval);
    if (manualCutoffTimer) clearTimeout(manualCutoffTimer);
    try { ws?.close(); } catch {}
    try { server.close(); } catch {}
    process.exit(0);
  });
}
