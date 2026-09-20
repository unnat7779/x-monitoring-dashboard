// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Background Service Worker (MV3)
// Polls the X Monitoring backend on Vercel (continuous, persistent),
// deduplicates, notifies, badges, and pushes data to the panel window.
// ═══════════════════════════════════════════════════════════════════════════

// Local backend only — no hosted service required.
// 127.0.0.1 is tried first: on some machines `localhost` resolves to ::1 while
// Next.js binds IPv4 only, which makes the `localhost` spelling fail outright.
const PROD_ENDPOINT = 'https://x-monitoring-dashboard.vercel.app/api/tweets';
const LOCAL_ENDPOINTS = [
  PROD_ENDPOINT,
  'http://127.0.0.1:3000/api/tweets',
  'http://localhost:3000/api/tweets',
];
const POLL_INTERVAL_MS = 1500;
const BACKOFF_MAX_MS = 15000;
const ALARM_NAME = 'xmonitor-heartbeat';
const MAX_HISTORY = 200;

// ── In-Memory State (rebuilt on wake from chrome.storage.local) ──────────
let seenIds = new Set();
let tweetHistory = [];
let isPaused = false;
let monitorMode = 'auto'; // 'auto' | 'on' | 'off'
let manualOnTimestamp = 0; // When user switched to 'on'
let lastAutoStartedDate = ''; // Prevents duplicate 9am auto-starts on the same day
let unreadCount = 0;
let panelWindowId = null;
let panelPort = null;
let pollTimerId = null;
let activeEndpoint = LOCAL_ENDPOINTS[0];
let customApiUrl = '';        // optional override, set from the panel/options
let consecutiveFailures = 0;
let currentIntervalMs = POLL_INTERVAL_MS;
let backendUp = false;

// ── Monitored Accounts Metadata (for notification titles) ────────────────
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
  sharaddubey_: 'Sharad Dubey',
  lakshmanroy1: 'Lakshman Roy',
  shukla_tarun: 'Tarun Shukla',
};

function getAccountName(username) {
  const key = (username || '').toLowerCase().replace(/[@\s]/g, '');
  return ACCOUNT_META[key] || username || 'Unknown';
}

function getApiUrl() {
  return customApiUrl || activeEndpoint;
}

function endpointCandidates() {
  return customApiUrl ? [customApiUrl] : LOCAL_ENDPOINTS;
}

// ── Market Hours (9:00 AM - 3:30 PM IST Daily) ───────────────────────────
function getIstTime(date = new Date()) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istDate = new Date(utcMs + 5.5 * 3600000);
  const day = istDate.getDay();
  const minutes = istDate.getHours() * 60 + istDate.getMinutes();
  const isMarketDay = true; // Daily (Monday to Sunday)
  const dateStr = istDate.toDateString();
  return { istDate, day, minutes, isMarketDay, isWeekday: isMarketDay, dateStr };
}

function isMarketHours(date = new Date()) {
  const { minutes } = getIstTime(date);
  return minutes >= 540 && minutes <= 930;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE — chrome.storage.local
// ═══════════════════════════════════════════════════════════════════════════

async function loadState() {
  try {
    const data = await chrome.storage.local.get([
      'seenIds',
      'tweetHistory',
      'isPaused',
      'monitorMode',
      'manualOnTimestamp',
      'unreadCount',
      'customApiUrl',
    ]);
    if (typeof data.manualOnTimestamp === 'number') {
      manualOnTimestamp = data.manualOnTimestamp;
    }
    if (Array.isArray(data.seenIds)) {
      seenIds = new Set(data.seenIds);
    }
    // Deliberately NOT restoring data.tweetHistory. It is only a cache of a
    // server we can re-read within ~1.5s, and painting it at startup is what
    // made hours-old posts appear live behind a healthy-looking green dot.
    // The panel now starts empty and fills from the first successful poll.
    tweetHistory = [];

    // Purge the persisted copy too. panel.js calls loadFromStorage() on boot
    // and paints this key DIRECTLY, bypassing the worker entirely — so leaving
    // it behind would repaint the old posts the instant a panel opens, no
    // matter what the worker does.
    try {
      await chrome.storage.local.remove('tweetHistory');
    } catch (e) {
      console.warn('[X-Monitor BG] Could not purge cached tweetHistory:', e);
    }
    
    if (data.monitorMode && ['auto', 'on', 'off'].includes(data.monitorMode)) {
      monitorMode = data.monitorMode;
    } else {
      monitorMode = 'auto';
    }
    isPaused = (monitorMode === 'off');

    // Always reset unreadCount on startup — the tweetHistory that those
    // unreads referred to has been purged, so a stale badge is misleading.
    unreadCount = 0;
    if (typeof data.customApiUrl === 'string') {
      customApiUrl = data.customApiUrl;
    }
    console.log(
      `[X-Monitor BG] State loaded: ${seenIds.size} seen IDs, feed starts empty, mode=${monitorMode}, paused=${isPaused}`
    );
  } catch (err) {
    console.error('[X-Monitor BG] Failed to load state:', err);
  }
}

async function saveState() {
  try {
    await chrome.storage.local.set({
      seenIds: [...seenIds].slice(-MAX_HISTORY * 2),
      tweetHistory: tweetHistory.slice(0, MAX_HISTORY),
      isPaused,
      monitorMode,
      manualOnTimestamp,
      unreadCount,
      customApiUrl,
    });
  } catch (err) {
    console.error('[X-Monitor BG] Failed to save state:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POLLING — fetch tweets from Vercel / local backend
// ═══════════════════════════════════════════════════════════════════════════

let lastFeedHash = '';
let _loggedFirstPoll = false;

// Try each candidate endpoint until one answers. The winner is remembered so
// subsequent polls go straight to it.
async function fetchFromCandidates(headers) {
  const candidates = endpointCandidates();
  const ordered = [activeEndpoint, ...candidates.filter((u) => u !== activeEndpoint)];
  let lastErr = null;

  for (const url of ordered) {
    try {
      const shouldForce = monitorMode === 'on' || isMarketHours();
      const fullUrl = shouldForce ? `${url}${url.includes('?') ? '&' : '?'}force=1` : url;
      const res = await fetch(fullUrl, { headers, cache: 'no-store' });
      activeEndpoint = url;
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No reachable local backend');
}

function onPollSuccess() {
  consecutiveFailures = 0;
  currentIntervalMs = POLL_INTERVAL_MS;
  if (!backendUp) {
    backendUp = true;
    console.log(`[X-Monitor BG] Local backend reachable at ${getApiUrl()}`);
    notifyPanelStatus();
  }
}

// The local server is simply not running sometimes (laptop just booted, or the
// user stopped it). Back off instead of hammering it 40x a minute with
// connection errors, and recover immediately once it answers again.
function onPollFailure(err) {
  consecutiveFailures += 1;
  currentIntervalMs = Math.min(
    BACKOFF_MAX_MS,
    POLL_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFailures, 4))
  );
  if (backendUp || consecutiveFailures === 1) {
    backendUp = false;
    console.warn(
      `[X-Monitor BG] Backend unreachable (${err.message}). ` +
        `Retrying every ${Math.round(currentIntervalMs / 1000)}s.`
    );
    notifyPanelStatus();
  }
}

function notifyPanelStatus() {
  if (!panelPort) return;
  try {
    panelPort.postMessage({
      type: 'BACKEND_STATUS',
      connected: backendUp,
      apiUrl: getApiUrl(),
    });
  } catch (e) {
    panelPort = null;
  }
}

async function pollTweets() {
  if (isPaused || monitorMode === 'off') return;

  // Reduce Vercel credit usage outside market hours (9:00 AM - 3:30 PM IST Daily)
  // Only applies when monitorMode is 'auto'
  if (monitorMode === 'auto') {
    if (!isMarketHours()) {
      currentIntervalMs = 5 * 60 * 1000; // Poll only once every 5 minutes off-market
      return;
    }
  }
  // Ensure we snap back to fast polling the moment market hours resume or when forced ON
  currentIntervalMs = POLL_INTERVAL_MS;

  try {
    const headers = {};
    if (monitorMode === 'on' || isMarketHours()) {
      headers['X-Force-Poll'] = '1';
    }
    if (lastFeedHash) {
      headers['If-None-Match'] = `"${lastFeedHash}"`;
    }
    const res = await fetchFromCandidates(headers);
    onPollSuccess();
    if (!_loggedFirstPoll) {
      _loggedFirstPoll = true;
      console.log(`[X-Monitor BG] First poll -> HTTP ${res.status} from ${getApiUrl()}`);
    }
    if (res.status === 304) return; // Feed has not changed — 0 bytes payload!
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();

    const tweets = data.tweets || [];
    const serverFeedHash = data.feedHash || '';

    // A healthy backend returning an empty feed means the store genuinely is
    // empty (e.g. a fresh local install). Previously we returned early here,
    // which left months-old cached tweets on screen next to a green "connected"
    // dot — looking live when nothing was arriving. Clear them instead.
    if (tweets.length === 0) {
      if (tweetHistory.length > 0) {
        console.log('[X-Monitor BG] Backend feed is empty — clearing stale cached tweets');
        tweetHistory = [];
        seenIds.clear();
        lastFeedHash = '';
        await saveState();
        if (panelPort) {
          try {
            panelPort.postMessage({ type: 'HISTORY_CLEARED' });
          } catch (e) {
            panelPort = null;
          }
        }
      }
      return;
    }

    // Quick check: if feed hash hasn't changed, nothing new to do
    if (serverFeedHash && serverFeedHash === lastFeedHash) return;
    lastFeedHash = serverFeedHash;

    // Normalize incoming tweets to match panel expectations
    const normalizedTweets = tweets.map((t) => ({
      id: String(t.id || t.tweetId || ''),
      text: t.text || t.full_text || '',
      created_at: t.created_at || t.createdAt || new Date().toISOString(),
      createdAt: t.createdAt || t.created_at || new Date().toISOString(),
      author: {
        id: t.author?.id || t.user?.id || '',
        name: t.author?.name || t.user?.name || 'Unknown',
        username: t.author?.username || t.user?.username || t.user?.screen_name || 'unknown',
        profile_image_url: t.author?.profile_image_url || t.user?.profile_image_url || null,
        avatar: t.author?.profile_image_url || t.user?.profile_image_url || null,
        verified: Boolean(t.author?.verified || t.user?.verified || t.user?.is_blue_verified),
      },
      media: t.media || t.entities?.media || [],
    }));

    // Find genuinely new tweets
    const isFirstLoad = seenIds.size === 0;
    const newTweets = normalizedTweets.filter((t) => t.id && !seenIds.has(t.id));

    // Mark all fetched tweets as seen
    for (const t of normalizedTweets) {
      if (t.id) seenIds.add(t.id);
    }

    // Trim seenIds to prevent unbounded growth
    if (seenIds.size > MAX_HISTORY * 3) {
      const arr = [...seenIds];
      seenIds = new Set(arr.slice(arr.length - MAX_HISTORY * 2));
    }

    // Adopt newest tweets up to MAX_HISTORY (strictly within past 1 hour)
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();
    tweetHistory = normalizedTweets
      .filter((t) => {
        const ts = new Date(t.created_at || t.createdAt).getTime();
        return Number.isNaN(ts) || now - ts <= ONE_HOUR_MS;
      })
      .slice(0, MAX_HISTORY);
    console.log(
      `[X-Monitor BG] Feed updated: ${tweetHistory.length} tweets (<= 1h) ` +
        `(${newTweets.length} new) — newest: ` +
        `@${tweetHistory[0]?.author?.username} "${(tweetHistory[0]?.text || '').slice(0, 45)}"`
    );

    // Save state
    await saveState();

    // Push to panel if connected
    if (panelPort) {
      try {
        panelPort.postMessage({
          type: 'NEW_TWEETS',
          tweets: tweetHistory,
          newCount: isFirstLoad ? 0 : newTweets.length,
          feedHash: serverFeedHash,
        });
      } catch (e) {
        console.warn('[X-Monitor BG] Panel port send failed:', e);
        panelPort = null;
      }
    }

    // Desktop notification + badge (skip on first load to avoid notification storm)
    if (!isFirstLoad && newTweets.length > 0) {
      unreadCount += newTweets.length;
      updateBadge();

      const firstNew = newTweets[0];
      const authorName = getAccountName(
        firstNew.author?.username || firstNew.author?.name
      );
      const bodyText =
        newTweets.length === 1
          ? (firstNew.text || '').slice(0, 140)
          : `${newTweets.length} new posts from ${[...new Set(newTweets.map((t) => getAccountName(t.author?.username || t.author?.name)))].join(', ')}`;

      try {
        chrome.notifications.create(`xmon-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: newTweets.length === 1 ? `${authorName} posted` : `${newTweets.length} new posts`,
          message: bodyText,
          priority: 2,
        });
      } catch (e) {
        console.warn('[X-Monitor BG] Notification failed:', e);
      }
    }
  } catch (err) {
    onPollFailure(err);
  }
}

function updateBadge() {
  try {
    if (unreadCount > 0) {
      chrome.action.setBadgeText({ text: String(unreadCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // Action API might be unavailable in some contexts
  }
}

function clearBadge() {
  unreadCount = 0;
  updateBadge();
}

// ═══════════════════════════════════════════════════════════════════════════
// POLLING LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

function startPolling() {
  if (pollTimerId) return;
  console.log(`[X-Monitor BG] Starting poll loop (${POLL_INTERVAL_MS}ms base interval)`);

  const tick = async () => {
    await pollTweets();
    // Only reschedule if we were not stopped while the poll was in flight.
    if (pollTimerId !== null) {
      pollTimerId = setTimeout(tick, currentIntervalMs);
    }
  };

  pollTimerId = setTimeout(tick, 0);
}

function stopPolling() {
  if (pollTimerId !== null) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
    console.log('[X-Monitor BG] Polling stopped');
  }
}

function restartPolling() {
  stopPolling();
  startPolling();
}

function applyMonitorMode(mode, reason = '', explicitTimestamp = 0) {
  if (!['auto', 'on', 'off'].includes(mode)) return monitorMode;
  monitorMode = mode;
  isPaused = (mode === 'off');
  if (mode === 'on') {
    manualOnTimestamp = explicitTimestamp || manualOnTimestamp || Date.now();
  } else {
    manualOnTimestamp = 0;
  }
  console.log(`[X-Monitor BG] Mode set to: ${monitorMode}${reason ? ` (${reason})` : ''}`);
  saveState();

  if (monitorMode === 'off') {
    stopPolling();
  } else if (monitorMode === 'on') {
    currentIntervalMs = POLL_INTERVAL_MS;
    startPolling();
    pollTweets();
  } else {
    // 'auto'
    currentIntervalMs = POLL_INTERVAL_MS;
    startPolling();
    pollTweets();
  }

  if (panelPort) {
    try {
      panelPort.postMessage({ type: 'MODE_CHANGED', mode: monitorMode, manualOnTimestamp, reason });
    } catch (e) {
      panelPort = null;
    }
  }
  return monitorMode;
}

// ── Auto Schedule Checker (9:00 AM auto-start & 5-min post-market auto-off) ──
function checkAutoSchedule() {
  const { minutes, dateStr } = getIstTime();

  // Rule 1: At 9:00 AM IST (Daily), automatically start polling even if toggle was OFF
  if (minutes >= 540 && minutes <= 930) {
    if (lastAutoStartedDate !== dateStr) {
      lastAutoStartedDate = dateStr;
      if (monitorMode === 'off') {
        console.log('[X-Monitor BG] 9:00 AM IST market open — auto-starting monitoring.');
        applyMonitorMode('on', 'market_open_9am');
        return;
      }
    }
  }

  // Rule 2: If toggle was left ON, turn it OFF in 5 minutes after market hours (3:35 PM IST)
  // or 5 minutes after turning ON outside market hours
  if (monitorMode === 'on') {
    const inCoreMarket = minutes >= 540 && minutes <= 930;
    if (!inCoreMarket) {
      // Allow 5-min post-market grace window (3:30 PM - 3:35 PM IST daily)
      const inPostMarketGrace = minutes >= 930 && minutes < 935;
      if (!inPostMarketGrace) {
        const elapsed = Date.now() - manualOnTimestamp;
        // If it ran through market close, minutes >= 935 triggers auto-off.
        // If turned on manually outside market hours, elapsed >= 5 mins triggers auto-off.
        const isPostMarketCutoff = minutes >= 935 && minutes < 940;
        if (isPostMarketCutoff || elapsed >= 5 * 60 * 1000) {
          console.log('[X-Monitor BG] 5-minute post-market limit reached — auto-turning OFF toggle.');
          applyMonitorMode('off', 'auto_off_5min');
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALARMS — keep service worker alive and polling
// ═══════════════════════════════════════════════════════════════════════════

function setupHeartbeat() {
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 0.5,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkAutoSchedule();
    if (!isPaused && monitorMode !== 'off' && !pollTimerId) {
      console.log('[X-Monitor BG] Heartbeat alarm revived polling');
      startPolling();
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOATING PANEL WINDOW MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 650;

async function openOrFocusPanel() {
  clearBadge();
  saveState();

  if (panelWindowId !== null) {
    try {
      const win = await chrome.windows.get(panelWindowId);
      if (win) {
        await chrome.windows.update(panelWindowId, { focused: true });
        return;
      }
    } catch (e) {
      panelWindowId = null;
    }
  }

  let left = 100;
  let top = 100;
  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin && currentWin.left !== undefined) {
      left = Math.max(0, currentWin.left + currentWin.width - PANEL_WIDTH - 20);
      top = Math.max(0, currentWin.top + 60);
    }
  } catch (e) {
    // fallback to defaults
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

chrome.action.onClicked.addListener(async () => {
  await openOrFocusPanel();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) {
    panelWindowId = null;
    panelPort = null;
    console.log('[X-Monitor BG] Panel window closed');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PORT-BASED COMMUNICATION (with panel window)
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'panel') {
    console.log('[X-Monitor BG] Panel port connected');
    panelPort = port;
    checkAutoSchedule();

    // Send current state immediately
    port.postMessage({
      type: 'INIT',
      tweets: tweetHistory,
      isPaused,
      monitorMode,
      manualOnTimestamp,
      connected: backendUp,
      apiUrl: getApiUrl(),
    });

    // Ensure polling is running
    if (!isPaused && monitorMode !== 'off') startPolling();

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PING') {
        if (!isPaused && monitorMode !== 'off' && !pollTimerId) startPolling();
      } else if (msg.type === 'SET_MODE') {
        applyMonitorMode(msg.mode, 'panel_port', msg.manualOnTimestamp);
      }
    });

    port.onDisconnect.addListener(() => {
      // Reading lastError swallows the benign "page moved into back/forward
      // cache" notice that Chrome otherwise logs as an unchecked error.
      void chrome.runtime.lastError;
      console.log('[X-Monitor BG] Panel port disconnected');
      panelPort = null;
    });
  }

  if (port.name === 'content-keepalive') {
    // Content scripts keep the service worker alive via ping. We don't need
    // to track individual ports — just use pings to revive polling if needed.
    port.onMessage.addListener((msg) => {
      if (msg.type === 'PING') {
        if (!isPaused && !pollTimerId) startPolling();
      }
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // bfcache disconnects are expected
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ONE-OFF MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATUS':
      sendResponse({
        isPaused,
        monitorMode,
        tweetCount: tweetHistory.length,
        seenCount: seenIds.size,
        panelOpen: panelWindowId !== null,
        connected: backendUp,
        apiUrl: getApiUrl(),
        failures: consecutiveFailures,
      });
      return true;

    case 'SET_MODE': {
      const mode = applyMonitorMode(msg.mode);
      sendResponse({ success: true, mode });
      return true;
    }

    case 'CLEAR_HISTORY':
      seenIds.clear();
      tweetHistory = [];
      clearBadge();
      saveState();
      if (panelPort) {
        try {
          panelPort.postMessage({ type: 'HISTORY_CLEARED' });
        } catch (e) {}
      }
      sendResponse({ cleared: true });
      return true;

    case 'CLEAR_BADGE':
      clearBadge();
      saveState();
      sendResponse({ cleared: true });
      return true;

    case 'TEST_NOTIFICATION':
      chrome.notifications.create(`xmon-test-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'X Monitor — Test',
        message: 'Notifications are working perfectly! 🎉',
        priority: 2,
      });
      sendResponse({ sent: true });
      return true;

    case 'GET_TWEETS':
      sendResponse({ tweets: tweetHistory });
      return true;

    default:
      return false;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  await openOrFocusPanel();
});

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════

// Single init — the IIFE runs unconditionally at script load, which Chrome
// guarantees on startup and install. No need for separate event listeners.
(async function init() {
  console.log('[X-Monitor BG] Service worker initialized');
  await loadState();
  setupHeartbeat();
  updateBadge();
  if (!isPaused) startPolling();
})();

