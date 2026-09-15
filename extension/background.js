// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Background Service Worker (MV3)
// Polls the X Monitoring Dashboard API hosted on Render (continuous, persistent),
// deduplicates, notifies, badges, and pushes data to the panel window.
// ═══════════════════════════════════════════════════════════════════════════

const PROD_API = 'https://x-monitoring-dashboard.onrender.com/api/tweets';
const LOCAL_API = 'http://localhost:3000/api/tweets';
const POLL_INTERVAL_MS = 2000;
const ALARM_NAME = 'xmonitor-heartbeat';
const MAX_HISTORY = 200;

// ── In-Memory State (rebuilt on wake from chrome.storage.local) ──────────
let seenIds = new Set();
let tweetHistory = [];
let isPaused = false;
let unreadCount = 0;
let panelWindowId = null;
let panelPort = null;
let contentPorts = new Map(); // tabId → port
let pollTimerId = null;
let apiSource = 'prod'; // 'prod' | 'local'

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
  return apiSource === 'local' ? LOCAL_API : PROD_API;
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
      'unreadCount',
      'apiSource',
    ]);
    if (Array.isArray(data.seenIds)) {
      seenIds = new Set(data.seenIds);
    }
    if (Array.isArray(data.tweetHistory)) {
      tweetHistory = data.tweetHistory;
    }
    if (typeof data.isPaused === 'boolean') {
      isPaused = data.isPaused;
    }
    if (typeof data.unreadCount === 'number') {
      unreadCount = data.unreadCount;
    }
    if (data.apiSource) {
      apiSource = data.apiSource;
    }
    console.log(
      `[X-Monitor BG] State loaded: ${seenIds.size} seen IDs, ${tweetHistory.length} tweets, paused=${isPaused}`
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
      unreadCount,
      apiSource,
    });
  } catch (err) {
    console.error('[X-Monitor BG] Failed to save state:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POLLING — fetch tweets from persistent Render server
// ═══════════════════════════════════════════════════════════════════════════

let lastFeedHash = '';

async function pollTweets() {
  if (isPaused) return;

  try {
    const res = await fetch(getApiUrl());
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const tweets = data.tweets || [];
    const serverFeedHash = data.feedHash || '';

    if (tweets.length === 0) return;

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

    // Adopt newest tweets up to MAX_HISTORY
    tweetHistory = normalizedTweets.slice(0, MAX_HISTORY);

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
    console.error('[X-Monitor BG] Poll error:', err.message);
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
  console.log(`[X-Monitor BG] Starting poll loop (${POLL_INTERVAL_MS}ms)`);
  pollTweets();
  pollTimerId = setInterval(pollTweets, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimerId) {
    clearInterval(pollTimerId);
    pollTimerId = null;
    console.log('[X-Monitor BG] Polling stopped');
  }
}

function restartPolling() {
  stopPolling();
  startPolling();
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
    if (!isPaused && !pollTimerId) {
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

    // Send current state immediately
    port.postMessage({
      type: 'INIT',
      tweets: tweetHistory,
      isPaused,
      connected: true,
    });

    // Ensure polling is running
    if (!isPaused) startPolling();

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PING') {
        if (!isPaused && !pollTimerId) startPolling();
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[X-Monitor BG] Panel port disconnected');
      panelPort = null;
    });
  }

  if (port.name === 'content-keepalive') {
    const tabId = port.sender?.tab?.id || `unknown-${Date.now()}`;
    contentPorts.set(tabId, port);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PING') {
        if (!isPaused && !pollTimerId) startPolling();
      }
    });

    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
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
        tweetCount: tweetHistory.length,
        seenCount: seenIds.size,
        panelOpen: panelWindowId !== null,
        connected: true,
        apiSource,
        apiUrl: getApiUrl(),
      });
      return true;

    case 'SET_PAUSED':
      isPaused = !!msg.paused;
      if (isPaused) {
        stopPolling();
      } else {
        startPolling();
      }
      saveState();
      if (panelPort) {
        try {
          panelPort.postMessage({ type: 'PAUSE_CHANGED', isPaused });
        } catch (e) {}
      }
      sendResponse({ isPaused });
      return true;

    case 'TOGGLE_API_SOURCE':
      apiSource = apiSource === 'prod' ? 'local' : 'prod';
      saveState();
      restartPolling();
      sendResponse({ apiSource, apiUrl: getApiUrl() });
      return true;

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

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  setupHeartbeat();
  if (!isPaused) startPolling();
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  setupHeartbeat();
  if (!isPaused) startPolling();
});

(async function init() {
  console.log('[X-Monitor BG] Service worker initialized');
  await loadState();
  setupHeartbeat();
  updateBadge();
  if (!isPaused) startPolling();
})();
