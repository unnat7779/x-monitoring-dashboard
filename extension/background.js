// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Background Service Worker (MV3)
//
// Polls /api/tweets ONLY while it should:
//   • Auto mode  → 9:00 AM – 3:30 PM IST, every day. Zero requests otherwise.
//   • ON mode    → a 5-minute manual override, then back to Auto automatically.
//
// There is no OFF mode. Outside the window nothing runs: no timers, no fetches,
// so the Vercel backend is never invoked and burns no credits.
// ═══════════════════════════════════════════════════════════════════════════

const PROD_ENDPOINT = 'https://x-monitoring-dashboard.vercel.app/api/tweets';
// Production first (the last deliberate choice), local dev server as fallback.
// 127.0.0.1 before localhost: `localhost` can resolve to ::1 while Next binds v4.
const ENDPOINTS = [
  PROD_ENDPOINT,
  'http://127.0.0.1:3000/api/tweets',
  'http://localhost:3000/api/tweets',
];

const POLL_INTERVAL_MS = 10000;  // 10s default polling when Pusher is disconnected
const PUSHER_POLL_INTERVAL_MS = 60000; // 60s gentle safety net while Pusher is active
const BACKOFF_MAX_MS = 60000;    // back off up to 60s when backend is unreachable
const FETCH_TIMEOUT_MS = 10000;
const MAX_HISTORY = 50;              // the API sends at most this many anyway
const MANUAL_ON_MS = 5 * 60 * 1000;  // ON override length

// ── Pusher Real-Time Config ──────────────────────────────────────────────
// Free tier: 200,000 msgs/day, instant sub-500ms delivery.
// Once configured, updates arrive via WebSocket push instantly, and
// polling is reduced to a gentle 60s fallback to conserve Vercel credits.
let PUSHER_KEY = '48698da7e97d91ad655a';
let PUSHER_CLUSTER = 'ap2';
const PUSHER_CHANNEL = 'x-monitor';

let pusherWs = null;
let pusherConnected = false;
let pusherReconnectTimer = null;

// Market window, minutes since IST midnight. Half-open: [09:00, 15:30).
// Retention: everything since the most recent 08:55 IST — yesterday's posts
// vanish at 08:55 sharp, five minutes before the market opens.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const MARKET_OPEN_MIN = 9 * 60;
const MARKET_CLOSE_MIN = 15 * 60 + 30;
const PURGE_MIN = 8 * 60 + 55;

const ALARM_HEARTBEAT = 'xmonitor-heartbeat';     // 30s safety net
const ALARM_ON_EXPIRY = 'xmonitor-on-expiry';     // exact end of ON override
const ALARM_MARKET_EDGE = 'xmonitor-market-edge'; // exact next 8:55 / 9:00 / 15:30

// ── State (rebuilt from chrome.storage.local whenever the worker wakes) ──
let mode = 'auto';        // 'auto' | 'on'
let manualOnUntil = 0;    // epoch ms; 0 unless mode === 'on'
let seenIds = new Set();
let tweetHistory = [];
let unreadCount = 0;

let panelWindowId = null;
let panelPort = null;
let pollTimer = null;
let activeEndpoint = ENDPOINTS[0];
let consecutiveFailures = 0;
let currentIntervalMs = POLL_INTERVAL_MS;
let backendUp = false;
let lastFeedHash = '';

// ── Monitored accounts (notification titles) ─────────────────────────────
const ACCOUNT_META = {
  ndtvprofitindia: 'NDTV Profit',
  ndtvprofit: 'NDTV Profit',
  cnbctv18news: 'CNBC-TV18',
  cnbctv18live: 'CNBC-TV18 Live',
  etnowlive: 'ET NOW',
  zeebusiness: 'Zee Business',
  moneycontrolcom: 'Moneycontrol',
  livemint: 'Livemint',
  bsindia: 'Business Standard',
  business: 'Bloomberg',
  ani: 'ANI News',
  pti_news: 'PTI News',
  livelawindia: 'Live Law',
  yatinmota: 'Yatin Mota',
  darshanvmehta1: 'Darshan Mehta',
  soumeetsarkar: 'Soumeet Sarkar',
  soumeet_sarkar: 'Soumeet Sarkar',
  sharaddubey_: 'Sharad Dubey',
  lakshmanroy1: 'Lakshman Roy',
  shukla_tarun: 'Tarun Shukla',
};

function getAccountName(username) {
  const key = (username || '').toLowerCase().replace(/[@\s]/g, '');
  return ACCOUNT_META[key] || username || 'Unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKET CLOCK (IST has no DST, so a fixed offset is exact)
// ═══════════════════════════════════════════════════════════════════════════

function istMinuteOfDay(now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isMarketHours(now = Date.now()) {
  const m = istMinuteOfDay(now);
  return m >= MARKET_OPEN_MIN && m < MARKET_CLOSE_MIN;
}

// Epoch ms of the next scheduled instant strictly after `now`:
// 08:55 purge, 09:00 open or 15:30 close, whichever comes first.
function nextEdge(now = Date.now()) {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  const edges = [
    istMidnight + PURGE_MIN * 60000,
    istMidnight + MARKET_OPEN_MIN * 60000,
    istMidnight + MARKET_CLOSE_MIN * 60000,
    istMidnight + DAY_MS + PURGE_MIN * 60000,
  ];
  return edges.find((t) => t > istNow) - IST_OFFSET_MS;
}

// Epoch ms of the next 09:00 or 15:30 — what the panel shows as "resumes at".
function nextMarketEdge(now = Date.now()) {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  const edges = [
    istMidnight + MARKET_OPEN_MIN * 60000,
    istMidnight + MARKET_CLOSE_MIN * 60000,
    istMidnight + DAY_MS + MARKET_OPEN_MIN * 60000,
  ];
  return edges.find((t) => t > istNow) - IST_OFFSET_MS;
}

// Epoch ms of the most recent 08:55 IST at or before `now`.
function retentionCutoff(now = Date.now()) {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  let cutoff = istMidnight + PURGE_MIN * 60000;
  if (cutoff > istNow) cutoff -= DAY_MS;
  return cutoff - IST_OFFSET_MS;
}

// The single source of truth for "should we be hitting the backend right now".
function shouldPoll(now = Date.now()) {
  if (mode === 'on') return now < manualOnUntil;
  return isMarketHours(now);
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

const LEGACY_KEYS = ['isPaused', 'monitorMode', 'manualOnTimestamp', 'customApiUrl'];

async function loadState() {
  try {
    const data = await chrome.storage.local.get([
      'mode',
      'manualOnUntil',
      'seenIds',
      'tweetHistory',
      'unreadCount',
      'pusherKey',
      'pusherCluster',
    ]);
    if (typeof data.pusherKey === 'string' && data.pusherKey.trim()) {
      PUSHER_KEY = data.pusherKey.trim();
    }
    if (typeof data.pusherCluster === 'string' && data.pusherCluster.trim()) {
      PUSHER_CLUSTER = data.pusherCluster.trim();
    }
    if (data.mode === 'on' || data.mode === 'auto') mode = data.mode;
    if (typeof data.manualOnUntil === 'number') manualOnUntil = data.manualOnUntil;
    if (mode === 'on' && manualOnUntil <= Date.now()) {
      mode = 'auto';
      manualOnUntil = 0;
    }
    if (Array.isArray(data.seenIds)) seenIds = new Set(data.seenIds);
    // Restore the cache but never yesterday's posts — the panel paints this
    // key directly on open, so stale rows must not survive here.
    tweetHistory = Array.isArray(data.tweetHistory) ? data.tweetHistory.filter((t) => isFresh(t)) : [];
    unreadCount = typeof data.unreadCount === 'number' ? data.unreadCount : 0;
    chrome.storage.local.remove(LEGACY_KEYS).catch(() => {});
    console.log(
      `[X-Monitor BG] State loaded: mode=${mode}, ${tweetHistory.length} cached tweets, ${seenIds.size} seen IDs`
    );
  } catch (err) {
    console.error('[X-Monitor BG] Failed to load state:', err);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({
      mode,
      manualOnUntil,
      seenIds: [...seenIds].slice(-MAX_HISTORY * 2),
      tweetHistory: tweetHistory.slice(0, MAX_HISTORY),
      unreadCount,
    });
  } catch (err) {
    console.error('[X-Monitor BG] Failed to save state:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PANEL MESSAGING
// ═══════════════════════════════════════════════════════════════════════════

function statusPayload() {
  return {
    mode,
    manualOnUntil,
    polling: pollTimer !== null || pusherConnected,
    connected: backendUp || pusherConnected,
    pusherConnected,
    marketOpen: isMarketHours(),
    nextEdge: nextMarketEdge(),
    apiUrl: activeEndpoint,
  };
}

function pushToPanel(msg) {
  if (!panelPort) return;
  try {
    panelPort.postMessage(msg);
  } catch (e) {
    panelPort = null;
  }
}

function pushStatus(reason = '') {
  pushToPanel({ type: 'STATUS', ...statusPayload(), reason });
}

function pushFeed(newCount = 0) {
  pushToPanel({ type: 'FEED', tweets: tweetHistory, newCount });
}

// ═══════════════════════════════════════════════════════════════════════════
// TWEET NORMALISATION — the only shape the panel ever sees
// ═══════════════════════════════════════════════════════════════════════════

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HTTPS_URL = /^https:\/\/[^\s"'<>\\]+$/i;

function asText(v, max) {
  if (typeof v === 'number') v = String(v);
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function normalizeTweet(t) {
  if (!t || typeof t !== 'object') return null;
  const id = asText(t.id ?? t.tweetId, 64);
  if (!SAFE_ID.test(id)) return null;

  const ts = Date.parse(asText(t.created_at || t.createdAt, 64));
  const a = t.author || t.user || {};
  const mediaSrc = Array.isArray(t.media) ? t.media : [];
  const media = mediaSrc
    .map((m) => asText(m?.preview_url || m?.url, 512))
    .filter((u) => HTTPS_URL.test(u))
    .slice(0, 1)
    .map((url) => ({ url }));

  return {
    id,
    text: asText(t.text || t.full_text, 4000),
    created_at: new Date(Number.isNaN(ts) ? Date.now() : ts).toISOString(),
    author: {
      name: asText(a.name, 100) || 'Unknown',
      username: asText(a.username || a.screen_name, 50).replace(/^@/, '') || 'unknown',
      verified: Boolean(a.verified || a.is_blue_verified),
    },
    media,
  };
}

function isFresh(t, now = Date.now()) {
  const ts = Date.parse(t?.created_at || '');
  return !Number.isNaN(ts) && ts >= retentionCutoff(now);
}

// Drop yesterday's posts. Runs on every heartbeat and on the 08:55 alarm, so
// the panel is wiped on time even though nothing is polling at that hour.
function pruneHistory() {
  const now = Date.now();
  const kept = tweetHistory.filter((t) => isFresh(t, now));
  if (kept.length === tweetHistory.length) return;
  tweetHistory = kept;
  saveState();
  pushFeed(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════════════════════

// Try the remembered endpoint first, then the rest. `force=1` is always sent:
// this worker is the gatekeeper for when requests happen, and the query param
// makes sure the CDN's cached "market closed" response can never be served to
// us at 9:00:01 or during a manual ON window.
// `client` identifies authentic extension requests so random internet scanners can't drain invocations.
const CLIENT_AUTH = 'x-monitor-extension-client';
const POLL_TOKEN = '91cfc4bf72d6c68f78f02eac95fb7ed065bc3da2b56abb58';

async function fetchFeed(headers) {
  const ordered = [activeEndpoint, ...ENDPOINTS.filter((u) => u !== activeEndpoint)];
  let lastErr = null;
  for (const url of ordered) {
    try {
      const res = await fetch(`${url}?force=1&client=${CLIENT_AUTH}&token=${POLL_TOKEN}`, {
        headers: {
          ...headers,
          'x-client-id': CLIENT_AUTH,
          'x-poll-token': POLL_TOKEN,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      activeEndpoint = url;
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No reachable backend');
}

function onPollSuccess() {
  consecutiveFailures = 0;
  currentIntervalMs = POLL_INTERVAL_MS;
  if (!backendUp) {
    backendUp = true;
    console.log(`[X-Monitor BG] Backend reachable at ${activeEndpoint}`);
    pushStatus('backend_up');
  }
}

// Back off instead of hammering a dead backend; snap back on first success.
function onPollFailure(err) {
  consecutiveFailures += 1;
  currentIntervalMs = Math.min(
    BACKOFF_MAX_MS,
    POLL_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFailures, 4))
  );
  if (backendUp || consecutiveFailures === 1) {
    backendUp = false;
    console.warn(
      `[X-Monitor BG] Backend unreachable (${err.message}). Retrying every ${Math.round(currentIntervalMs / 1000)}s.`
    );
    pushStatus('backend_down');
  }
}

async function pollOnce() {
  try {
    const headers = {};
    if (lastFeedHash) headers['If-None-Match'] = `"${lastFeedHash}"`;

    const res = await fetchFeed(headers);
    onPollSuccess();
    if (res.status === 304) return; // unchanged — zero-byte response
    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = await res.json();
    const serverFeedHash = asText(data?.feedHash, 32);
    const now = Date.now();
    const incoming = (Array.isArray(data?.tweets) ? data.tweets : [])
      .map(normalizeTweet)
      .filter((t) => t && isFresh(t, now));

    // An empty feed from a healthy backend means the store really is empty.
    if (incoming.length === 0) {
      lastFeedHash = serverFeedHash;
      if (tweetHistory.length > 0) {
        tweetHistory = [];
        await saveState();
        pushFeed(0);
      }
      return;
    }

    if (serverFeedHash && serverFeedHash === lastFeedHash) return;
    lastFeedHash = serverFeedHash;

    const isFirstLoad = seenIds.size === 0;
    const newTweets = incoming.filter((t) => !seenIds.has(t.id));
    for (const t of incoming) seenIds.add(t.id);
    if (seenIds.size > MAX_HISTORY * 3) {
      seenIds = new Set([...seenIds].slice(-MAX_HISTORY * 2));
    }

    tweetHistory = incoming.slice(0, MAX_HISTORY);
    await saveState();
    pushFeed(isFirstLoad ? 0 : newTweets.length);

    if (!isFirstLoad && newTweets.length > 0) {
      console.log(
        `[X-Monitor BG] +${newTweets.length} new — @${newTweets[0].author.username}: "${newTweets[0].text.slice(0, 60)}"`
      );
      // Badge counts posts the user hasn't seen; a connected panel is showing them.
      if (!panelPort) {
        unreadCount += newTweets.length;
        updateBadge();
      }
      notifyNewTweets(newTweets);
    }
  } catch (err) {
    onPollFailure(err);
  }
}

function notifyNewTweets(newTweets) {
  const first = newTweets[0];
  const authors = [...new Set(newTweets.map((t) => getAccountName(t.author.username)))];
  try {
    chrome.notifications.create(`xmon-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: newTweets.length === 1 ? `${authors[0]} posted` : `${newTweets.length} new posts`,
      message:
        newTweets.length === 1
          ? first.text.slice(0, 140)
          : `${newTweets.length} new posts from ${authors.join(', ')}`,
      priority: 2,
    });
  } catch (e) {
    console.warn('[X-Monitor BG] Notification failed:', e);
  }
}

function updateBadge() {
  try {
    chrome.action.setBadgeText({ text: unreadCount > 0 ? String(unreadCount) : '' });
    if (unreadCount > 0) chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } catch (e) {
    // action API unavailable in some contexts
  }
}

function clearBadge() {
  unreadCount = 0;
  updateBadge();
}

// ═══════════════════════════════════════════════════════════════════════════
// PUSHER REAL-TIME WEBSOCKET (Sub-500ms Push Updates)
// ═══════════════════════════════════════════════════════════════════════════

function connectPusher() {
  if (!PUSHER_KEY) return;
  if (pusherWs && (pusherWs.readyState === WebSocket.OPEN || pusherWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (!shouldPoll()) return;

  try {
    const wsUrl = `wss://ws-${PUSHER_CLUSTER}.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0`;
    pusherWs = new WebSocket(wsUrl);

    pusherWs.onopen = () => {
      console.log('[X-Monitor Pusher] WebSocket opened');
    };

    pusherWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'pusher:connection_established') {
          pusherConnected = true;
          console.log(`[X-Monitor Pusher] Connected, subscribing to ${PUSHER_CHANNEL}...`);
          pusherWs.send(
            JSON.stringify({
              event: 'pusher:subscribe',
              data: { channel: PUSHER_CHANNEL },
            })
          );
          // With Pusher active, stop polling completely to burn 0 Vercel credits.
          // Pusher delivers all live posts in real time.
          // We run ONE single initial poll now to catch up on any missed history.
          stopPolling();
          pollOnce();
          pushStatus('pusher_connected');
        } else if (msg.event === 'pusher:ping') {
          pusherWs.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        } else if (msg.event === 'new-tweets') {
          const payload = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
          const tweets = Array.isArray(payload?.tweets)
            ? payload.tweets
            : payload?.tweet
            ? [payload.tweet]
            : [];
          if (tweets.length > 0) {
            handleRealtimeTweets(tweets);
          }
        }
      } catch (err) {
        console.warn('[X-Monitor Pusher] Parse error:', err);
      }
    };

    pusherWs.onclose = () => {
      pusherConnected = false;
      console.log('[X-Monitor Pusher] Disconnected — falling back to polling');
      currentIntervalMs = POLL_INTERVAL_MS;
      if (shouldPoll()) {
        startPolling();
        schedulePusherReconnect();
      }
      pushStatus('pusher_disconnected');
    };

    pusherWs.onerror = (err) => {
      console.warn('[X-Monitor Pusher] WebSocket error:', err);
      try { pusherWs.close(); } catch {}
    };
  } catch (err) {
    console.warn('[X-Monitor Pusher] Connection error:', err);
    schedulePusherReconnect();
  }
}

function disconnectPusher() {
  if (pusherReconnectTimer) {
    clearTimeout(pusherReconnectTimer);
    pusherReconnectTimer = null;
  }
  if (pusherWs) {
    try { pusherWs.close(); } catch {}
    pusherWs = null;
  }
  pusherConnected = false;
}

function schedulePusherReconnect() {
  if (pusherReconnectTimer) clearTimeout(pusherReconnectTimer);
  pusherReconnectTimer = setTimeout(() => {
    pusherReconnectTimer = null;
    if (shouldPoll()) connectPusher();
  }, 5000);
}

async function handleRealtimeTweets(rawTweets) {
  const now = Date.now();
  const incoming = rawTweets.map(normalizeTweet).filter((t) => t && isFresh(t, now));
  if (incoming.length === 0) return;

  const newTweets = incoming.filter((t) => !seenIds.has(t.id));
  if (newTweets.length === 0) return;

  for (const t of newTweets) seenIds.add(t.id);
  if (seenIds.size > MAX_HISTORY * 3) {
    seenIds = new Set([...seenIds].slice(-MAX_HISTORY * 2));
  }

  // Prepend newest incoming tweets to current history
  const merged = [...newTweets, ...tweetHistory];
  const unique = [];
  const tracked = new Set();
  for (const t of merged) {
    if (!tracked.has(t.id)) {
      tracked.add(t.id);
      unique.push(t);
    }
  }
  tweetHistory = unique.slice(0, MAX_HISTORY);
  await saveState();

  pushFeed(newTweets.length);
  console.log(
    `[X-Monitor Pusher] ⚡ Instant delivery: +${newTweets.length} — @${newTweets[0].author.username}: "${newTweets[0].text.slice(0, 60)}"`
  );

  if (!panelPort) {
    unreadCount += newTweets.length;
    updateBadge();
  }
  notifyNewTweets(newTweets);
}

// ── Poll loop lifecycle ───────────────────────────────────────────────────

// Each start bumps the generation; a tick that was mid-fetch when the loop was
// stopped (and possibly restarted) sees a stale generation and simply ends, so
// there is never more than one chain running.
let pollGeneration = 0;

function startPolling() {
  if (pollTimer !== null) return;
  currentIntervalMs = POLL_INTERVAL_MS;
  console.log(`[X-Monitor BG] Polling started (${mode}, ${POLL_INTERVAL_MS}ms)`);
  const gen = ++pollGeneration;

  const tick = async () => {
    if (gen !== pollGeneration) return;
    // Re-check on every iteration so the cutoff is exact, not "next heartbeat".
    if (!shouldPoll()) {
      stopPolling();
      reconcile('poll_tick');
      return;
    }
    await pollOnce();
    if (gen === pollGeneration && pollTimer !== null) {
      pollTimer = setTimeout(tick, currentIntervalMs);
    }
  };

  pollTimer = setTimeout(tick, 0);
  pushStatus('polling_started');
}

function stopPolling() {
  if (pollTimer === null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
  backendUp = false; // unknown until we poll again; don't show a stale green dot
  console.log('[X-Monitor BG] Polling stopped — backend idle');
  pushStatus('polling_stopped');
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

function setMode(next, reason = '') {
  if (next !== 'auto' && next !== 'on') return mode;
  const prevMode = mode;
  mode = next;
  if (mode === 'on') {
    // Pressing ON again restarts the 5-minute window.
    manualOnUntil = Date.now() + MANUAL_ON_MS;
    chrome.alarms.create(ALARM_ON_EXPIRY, { when: manualOnUntil + 250 });

    // Wake up local stream listener and Vercel backend for 5 minutes
    const wakeBody = JSON.stringify({ duration: MANUAL_ON_MS, mode: 'on' });
    fetch('http://127.0.0.1:3000/api/manual-on', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: wakeBody,
    }).catch(() => {});
    fetch('https://x-monitoring-dashboard.vercel.app/api/manual-on', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: wakeBody,
    }).catch(() => {});
  } else {
    manualOnUntil = 0;
    chrome.alarms.clear(ALARM_ON_EXPIRY);

    if (prevMode === 'on') {
      // Notify stream listener to sleep immediately if outside market hours
      fetch('http://127.0.0.1:3000/api/manual-off', { method: 'POST' }).catch(() => {});
      fetch('https://x-monitoring-dashboard.vercel.app/api/manual-on', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'off' }),
      }).catch(() => {});
    }
  }
  console.log(`[X-Monitor BG] Mode → ${mode}${reason ? ` (${reason})` : ''}`);
  saveState();
  reconcile(`mode_${reason || 'set'}`);
  pushStatus(reason);
  return mode;
}

// Bring the poll loop in line with the clock and the mode. Idempotent; called
// from every alarm, on panel connect, on mode change and on worker start.
function reconcile(reason = '') {
  if (mode === 'on' && Date.now() >= manualOnUntil) {
    setMode('auto', 'manual_on_expired');
    return;
  }
  if (shouldPoll()) {
    connectPusher();
    if (!pusherConnected) startPolling();
  } else {
    stopPolling();
    disconnectPusher();
  }
  pruneHistory();
  scheduleEdgeWake();
}

// Alarms are the durable wake-up (they survive the worker being killed) but
// packed extensions clamp them to >= 30s. When the edge is closer than that,
// add a plain timer as well so 9:00:00 really starts at 9:00:00.
let edgeTimer = null;
function scheduleEdgeWake() {
  const edge = nextEdge();
  chrome.alarms.create(ALARM_MARKET_EDGE, { when: edge + 500 });
  if (edgeTimer !== null) clearTimeout(edgeTimer);
  edgeTimer = null;
  const delay = edge - Date.now();
  if (delay <= 35000) {
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      reconcile('market_edge_timer');
    }, delay + 200);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (
    alarm.name === ALARM_HEARTBEAT ||
    alarm.name === ALARM_ON_EXPIRY ||
    alarm.name === ALARM_MARKET_EDGE
  ) {
    reconcile(alarm.name);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOATING PANEL WINDOW
// ═══════════════════════════════════════════════════════════════════════════

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 650;

async function openOrFocusPanel() {
  clearBadge();
  saveState();

  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch (e) {
      panelWindowId = null;
    }
  }

  let left = 100;
  let top = 100;
  try {
    const cur = await chrome.windows.getCurrent();
    if (cur && cur.left !== undefined) {
      left = Math.max(0, cur.left + cur.width - PANEL_WIDTH - 20);
      top = Math.max(0, cur.top + 60);
    }
  } catch (e) {
    // keep defaults
  }

  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'),
      type: 'popup',
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      left,
      top,
      focused: true,
    });
    panelWindowId = win.id;
  } catch (err) {
    console.error('[X-Monitor BG] Failed to create panel window:', err);
  }
}

chrome.action.onClicked.addListener(openOrFocusPanel);

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) {
    panelWindowId = null;
    panelPort = null;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  await openOrFocusPanel();
});

// ═══════════════════════════════════════════════════════════════════════════
// PORTS — panel (data + control) and content-script keep-alive
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return;

  if (port.name === 'panel') {
    panelPort = port;
    clearBadge();
    reconcile('panel_connect');
    port.postMessage({ type: 'INIT', tweets: tweetHistory, ...statusPayload() });

    // Catch-up: fetch freshest feed once upon opening the panel
    if (shouldPoll()) {
      pollOnce().catch(() => {});
    }

    port.onMessage.addListener((msg) => {
      if (msg?.type === 'SET_MODE') setMode(msg.mode, 'panel');
      // PING needs no handling — receiving it is what keeps the worker alive.
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // swallow the benign bfcache notice
      if (panelPort === port) panelPort = null;
    });
    return;
  }

  if (port.name === 'content-keepalive') {
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ONE-OFF MESSAGES (console debugging + panel fallback)
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case 'GET_STATUS':
      sendResponse({
        ...statusPayload(),
        tweetCount: tweetHistory.length,
        seenCount: seenIds.size,
        panelOpen: panelWindowId !== null,
        failures: consecutiveFailures,
        pusherConnected,
        pusherConfigured: Boolean(PUSHER_KEY),
      });
      return false;

    case 'SET_PUSHER_CONFIG':
      if (typeof msg.key === 'string') PUSHER_KEY = msg.key.trim();
      if (typeof msg.cluster === 'string') PUSHER_CLUSTER = msg.cluster.trim();
      chrome.storage.local.set({ pusherKey: PUSHER_KEY, pusherCluster: PUSHER_CLUSTER });
      disconnectPusher();
      if (shouldPoll()) connectPusher();
      sendResponse({ success: true, key: PUSHER_KEY, cluster: PUSHER_CLUSTER });
      return false;

    case 'SET_MODE':
      sendResponse({ success: true, mode: setMode(msg.mode, 'message') });
      return false;

    case 'CLEAR_HISTORY':
      seenIds.clear();
      tweetHistory = [];
      lastFeedHash = '';
      clearBadge();
      saveState();
      pushFeed(0);
      sendResponse({ cleared: true });
      return false;

    case 'CLEAR_BADGE':
      clearBadge();
      saveState();
      sendResponse({ cleared: true });
      return false;

    case 'TEST_NOTIFICATION':
      chrome.notifications.create(`xmon-test-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'X Monitor — Test',
        message: 'Notifications are working.',
        priority: 2,
      });
      sendResponse({ sent: true });
      return false;

    case 'GET_TWEETS':
      sendResponse({ tweets: tweetHistory });
      return false;

    default:
      return false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP — runs on every worker start (install, browser launch, wake-up)
// ═══════════════════════════════════════════════════════════════════════════

(async function init() {
  console.log('[X-Monitor BG] Service worker started');
  await loadState();
  updateBadge();
  // Creating an alarm that already exists just replaces it — safe to repeat.
  chrome.alarms.create(ALARM_HEARTBEAT, { periodInMinutes: 0.5 });
  if (mode === 'on') chrome.alarms.create(ALARM_ON_EXPIRY, { when: manualOnUntil + 250 });
  reconcile('init');
})();
