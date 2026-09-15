// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Panel Window Script
// Connects to background via long-lived port, renders tweet feed,
// handles keepalive pings, and provides full UI interaction.
// ═══════════════════════════════════════════════════════════════════════════

// ── Monitored Accounts Metadata ──────────────────────────────────────────
const MONITORED_ACCOUNTS = [
  { handle: 'NDTVProfitIndia', name: 'NDTV Profit', category: 'Financial Media', tag: 'FINANCIAL NEWS', color: '#10b981', verified: true },
  { handle: 'NDTVProfit', name: 'NDTV Profit', category: 'Financial Media', tag: 'FINANCIAL NEWS', color: '#10b981', verified: true },
  { handle: 'CNBCTV18News', name: 'CNBC-TV18', category: 'Financial Media', tag: 'BUSINESS NEWS', color: '#0284c7', verified: true },
  { handle: 'CNBCTV18Live', name: 'CNBC-TV18 Live', category: 'Financial Media', tag: 'LIVE WIRE', color: '#0369a1', verified: true },
  { handle: 'ETNOWlive', name: 'ET NOW', category: 'Financial Media', tag: 'MARKETS & DEALS', color: '#f59e0b', verified: true },
  { handle: 'ZeeBusiness', name: 'Zee Business', category: 'Financial Media', tag: 'MARKETS HINDI', color: '#ef4444', verified: true },
  { handle: 'moneycontrolcom', name: 'Moneycontrol', category: 'Financial Media', tag: 'FINANCE & STOCKS', color: '#10b981', verified: true },
  { handle: 'livemint', name: 'Livemint', category: 'Financial Media', tag: 'ECONOMY & BIZ', color: '#f97316', verified: true },
  { handle: 'bsindia', name: 'Business Standard', category: 'Financial Media', tag: 'PRINT & DIGITAL', color: '#e11d48', verified: true },
  { handle: 'business', name: 'Bloomberg', category: 'Financial Media', tag: 'GLOBAL MARKETS', color: '#8b5cf6', verified: true },
  { handle: 'ANI', name: 'ANI News', category: 'News Wire', tag: 'NEWS AGENCY', color: '#ef4444', verified: true },
  { handle: 'LiveLawIndia', name: 'Live Law', category: 'News Wire', tag: 'LEGAL & COURTS', color: '#f43f5e', verified: true },
  { handle: 'YatinMota', name: 'Yatin Mota', category: 'Journalists & Analysts', tag: 'MARKETS & DEALS', color: '#34d399', verified: true },
  { handle: 'darshanvmehta1', name: 'Darshan Mehta', category: 'Journalists & Analysts', tag: 'MARKETS & DEALS', color: '#38bdf8', verified: true },
  { handle: 'SoumeetSarkar', name: 'Soumeet Sarkar', category: 'Journalists & Analysts', tag: 'IT & TECH DEALS', color: '#c084fc', verified: true },
  { handle: 'SharadDubey_', name: 'Sharad Dubey', category: 'Journalists & Analysts', tag: 'EQUITY RESEARCH', color: '#fbbf24', verified: true },
  { handle: 'LakshmanRoy1', name: 'Lakshman Roy', category: 'Journalists & Analysts', tag: 'POLICY & BUDGET', color: '#ec4899', verified: true },
  { handle: 'shukla_tarun', name: 'Tarun Shukla', category: 'Journalists & Analysts', tag: 'INVESTIGATIVE', color: '#a855f7', verified: true },
];

function getAccountMeta(handleOrName) {
  const clean = (handleOrName || '').toLowerCase().replace(/[@\s]/g, '');
  const cleanNoUnderscore = clean.replace(/_/g, '');
  const match = MONITORED_ACCOUNTS.find(
    (acc) =>
      acc.handle.toLowerCase() === clean ||
      acc.handle.toLowerCase().replace(/_/g, '') === cleanNoUnderscore ||
      acc.name.toLowerCase().replace(/\s/g, '') === clean ||
      acc.name.toLowerCase().includes(clean)
  );
  if (match) return match;
  return {
    handle: (handleOrName || 'unknown').replace(/[@\s]/g, ''),
    name: handleOrName || 'Unknown',
    category: 'Monitored',
    tag: 'LIVE FEED',
    color: '#38bdf8',
    verified: true,
  };
}

function resolveAccountForTweet(tweet) {
  const { author, text } = tweet;
  const rawUsername = author?.username || '';
  const rawName = author?.name || '';
  
  // If we already have a known author, return it
  if (rawUsername && rawUsername.toLowerCase() !== 'unknown') {
    const meta = getAccountMeta(rawUsername);
    if (meta.handle.toLowerCase() !== 'unknown') return meta;
  }
  if (rawName && rawName.toLowerCase() !== 'unknown') {
    const meta = getAccountMeta(rawName);
    if (meta.handle.toLowerCase() !== 'unknown') return meta;
  }

  // Smart fallback by text keywords if author is unknown or unparsed
  const textLower = (text || '').toLowerCase();
  if (textLower.includes('rupa yadav') || textLower.includes('moneycontrol') || textLower.includes('mc_')) {
    return getAccountMeta('moneycontrolcom');
  }
  if (textLower.includes('ndtv') || textLower.includes('ndtvprofit')) {
    return getAccountMeta('NDTVProfit');
  }
  if (textLower.includes('yatin') || textLower.includes('yatinmota')) {
    return getAccountMeta('yatinmota');
  }
  if (textLower.includes('darshan') || textLower.includes('darshanvmehta')) {
    return getAccountMeta('darshanvmehta1');
  }
  if (textLower.includes('soumeet') || textLower.includes('soumeetsarkar')) {
    return getAccountMeta('soumeet_sarkar');
  }
  if (textLower.includes('livelaw') || textLower.includes('supreme court') || textLower.includes('high court')) {
    return getAccountMeta('LiveLawIndia');
  }

  return getAccountMeta(rawUsername || rawName || 'Unknown');
}

// ── State ────────────────────────────────────────────────────────────────
let state = {
  maxCount: 3,
  rawTweets: [],
};

let expandedPostId = null;
let renderedTweetSignature = '';
const COLLAPSED_HEIGHT_LIMIT = 64;

// ── Port Connection ──────────────────────────────────────────────────────
let port = null;
let keepaliveTimerId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// ── Local Sync (no network) ──────────────────────────────────────────────
// The background service worker owns the TwitterAPI.io WebSocket and persists
// every ingested batch to chrome.storage.local. The panel paints from there on
// open and listens for changes, so it stays current even if the port is dead.
// The panel makes NO network requests — there is no backend to poll.
const PORT_SILENCE_THRESHOLD_MS = 30000; // 30s quiet → re-read persisted state
const PORT_SILENCE_CHECK_MS = 15000;
const STORAGE_SYNC_DELAY_MS = 1200; // let the port win before storage applies

let lastPortDataTime = 0;
let storageSyncTimerId = null;
let portIsHealthy = false;

function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'panel' });
    reconnectAttempts = 0;
    portIsHealthy = true;
    console.log('[X-Monitor Panel] Port connected');

    port.onMessage.addListener(handlePortMessage);

    port.onDisconnect.addListener(() => {
      console.log('[X-Monitor Panel] Port disconnected');
      port = null;
      portIsHealthy = false;
      stopKeepalive();
      loadFromStorage(); // fall back to whatever the worker last persisted
      scheduleReconnect();
    });

    startKeepalive();
  } catch (err) {
    console.error('[X-Monitor Panel] Failed to connect port:', err);
    portIsHealthy = false;
    loadFromStorage();
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  console.log(`[X-Monitor Panel] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts})`);
  setTimeout(connectPort, delay);
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimerId = setInterval(() => {
    if (port) {
      try {
        port.postMessage({ type: 'PING' });
      } catch (e) {
        console.warn('[X-Monitor Panel] Keepalive ping failed');
        port = null;
        portIsHealthy = false;
        stopKeepalive();
        loadFromStorage();
        scheduleReconnect();
      }
    }
  }, 20000);
}

function stopKeepalive() {
  if (keepaliveTimerId) {
    clearInterval(keepaliveTimerId);
    keepaliveTimerId = null;
  }
}

// ── Apply / Load Tweets ──────────────────────────────────────────────────
function applyTweets(tweets, { force = false, announce = false } = {}) {
  const incoming = Array.isArray(tweets) ? tweets : [];
  const hadTweets = state.rawTweets.length > 0;
  const previousTopId = state.rawTweets[0]?.id;

  state.rawTweets = incoming;
  renderFeed(force);
  updatePostCount();

  // Only announce when the top post actually changed, so a port message and a
  // storage change describing the same batch can never double-chime.
  if (announce && hadTweets && incoming[0]?.id && incoming[0].id !== previousTopId) {
    showToast('New breaking post received');
    playChime();
  }
}

async function loadFromStorage(options) {
  try {
    const data = await chrome.storage.local.get('tweetHistory');
    if (Array.isArray(data.tweetHistory) && data.tweetHistory.length > 0) {
      applyTweets(data.tweetHistory, options);
    }
  } catch (e) {
    // Extension context may be invalid
  }
}

// ── Storage Sync Fallback ────────────────────────────────────────────────
// The worker writes tweetHistory before it posts to the port, so wait briefly
// and only apply here if the port did not deliver the batch itself.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.tweetHistory) return;
    const next = changes.tweetHistory.newValue;

    if (storageSyncTimerId) clearTimeout(storageSyncTimerId);
    storageSyncTimerId = setTimeout(() => {
      storageSyncTimerId = null;
      if (portIsHealthy && Date.now() - lastPortDataTime < STORAGE_SYNC_DELAY_MS) return;
      applyTweets(next, { announce: true });
    }, STORAGE_SYNC_DELAY_MS);
  });
} catch (e) {
  // Extension context may be invalid
}

// ── Port Silence Watchdog ────────────────────────────────────────────────
// A long silence means the worker was probably killed. Re-read persisted
// state locally; reconnection is handled by the port's disconnect handler.
setInterval(() => {
  if (Date.now() - lastPortDataTime > PORT_SILENCE_THRESHOLD_MS) {
    loadFromStorage();
  }
}, PORT_SILENCE_CHECK_MS);

// ── Handle Incoming Port Messages ────────────────────────────────────────
function handlePortMessage(msg) {
  lastPortDataTime = Date.now();

  if (msg.type === 'INIT' || msg.type === 'NEW_TWEETS') {
    portIsHealthy = true;
  }

  switch (msg.type) {
    case 'INIT':
      state.rawTweets = msg.tweets || [];
      renderFeed(true);
      updatePostCount();
      break;

    case 'NEW_TWEETS':
      state.rawTweets = msg.tweets || [];
      renderFeed();
      updatePostCount();
      if (msg.newCount > 0) {
        showToast(msg.newCount === 1
          ? 'New breaking post received'
          : `${msg.newCount} new posts received`
        );
        playChime();
      }
      // Clear badge since panel is open
      try {
        chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
      } catch (e) { /* extension context may be invalid */ }
      break;

    case 'HISTORY_CLEARED':
      state.rawTweets = [];
      renderedTweetSignature = '';
      renderFeed(true);
      updatePostCount();
      break;
  }
}

// ── UI Elements ──────────────────────────────────────────────────────────
const feedContainer = document.getElementById('feed-container');
const postCountLabel = document.getElementById('post-count-label');
const updateToast = document.getElementById('update-toast');
const toastMessage = document.getElementById('toast-message');
const toastClose = document.getElementById('toast-close');
const btnCount3 = document.getElementById('btn-count-3');
const btnCount5 = document.getElementById('btn-count-5');


// ── Audio Chime ──────────────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    // Audio not available
  }
}

// ── Count Toggle ─────────────────────────────────────────────────────────
btnCount3.addEventListener('click', () => {
  btnCount3.classList.add('active');
  btnCount5.classList.remove('active');
  state.maxCount = 3;
  renderFeed(true);
});

btnCount5.addEventListener('click', () => {
  btnCount5.classList.add('active');
  btnCount3.classList.remove('active');
  state.maxCount = 5;
  renderFeed(true);
});

// ── Toast ────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message) {
  toastMessage.textContent = message || 'New breaking post received';
  updateToast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => updateToast.classList.add('hidden'), 3500);
}

toastClose.addEventListener('click', () => {
  updateToast.classList.add('hidden');
  if (toastTimer) clearTimeout(toastTimer);
});

// ── Post Count ───────────────────────────────────────────────────────────
function updatePostCount() {
  const count = state.rawTweets.length;
  if (count === 0) {
    postCountLabel.textContent = 'Connecting...';
  } else {
    postCountLabel.textContent = `${count} posts indexed`;
  }
}

// ── Render Feed ──────────────────────────────────────────────────────────
function renderFeed(force = false) {
  const displayList = state.rawTweets.slice(0, state.maxCount);
  const currentSignature = `${state.maxCount}-${displayList.map((t) => t.id).join(',')}`;

  if (!force && currentSignature === renderedTweetSignature) {
    updateTimestampsOnly();
    return;
  }

  renderedTweetSignature = currentSignature;

  if (displayList.length === 0) {
    feedContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">𝕏</div>
        <p>${state.rawTweets.length === 0 ? 'Waiting for tweets...' : 'No posts matching this filter'}</p>
      </div>
    `;
    return;
  }

  feedContainer.innerHTML = displayList.map((tweet, i) => createTweetCardHTML(tweet, i)).join('');

  // Attach copy listeners
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-text');
      navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      btn.innerHTML = `<span>Copied!</span>`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>Copy</span>
        `;
      }, 1500);
    });
  });

  // Attach read-more listeners
  document.querySelectorAll('.read-more-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      expandedPostId = expandedPostId === id ? null : id;
      measureAndApplyCardOverflow();

      if (expandedPostId) {
        const targetCard = document.getElementById(`card-${expandedPostId}`);
        if (targetCard) {
          setTimeout(() => {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 60);
        }
      }
    });
  });

  measureAndApplyCardOverflow();
}

// ── Card Overflow Logic ──────────────────────────────────────────────────
function measureAndApplyCardOverflow() {
  document.querySelectorAll('.tweet-card').forEach((card) => {
    const id = card.id.replace('card-', '');
    const innerEl = document.getElementById(`inner-${id}`);
    const bodyEl = document.getElementById(`body-${id}`);
    const btnEl = document.getElementById(`rm-btn-${id}`);
    if (!innerEl || !bodyEl || !btnEl) return;

    const naturalHeight = innerEl.scrollHeight;
    const hasOverflow = naturalHeight > COLLAPSED_HEIGHT_LIMIT;

    if (!hasOverflow) {
      btnEl.style.display = 'none';
      bodyEl.className = 'tweet-body-text';
    } else {
      btnEl.style.display = 'inline-flex';
      const isExpanded = expandedPostId === id;

      if (isExpanded) {
        bodyEl.className = 'tweet-body-text expanded';
        btnEl.classList.add('expanded');
        btnEl.setAttribute('aria-expanded', 'true');
        btnEl.querySelector('.rm-label').textContent = 'Show less';
      } else {
        bodyEl.className = 'tweet-body-text collapsed';
        btnEl.classList.remove('expanded');
        btnEl.setAttribute('aria-expanded', 'false');
        btnEl.querySelector('.rm-label').textContent = 'Read more';
      }
    }
  });
}

// Observe resize for dynamic overflow recalculation
if (typeof ResizeObserver !== 'undefined') {
  const resizeObserver = new ResizeObserver(() => {
    measureAndApplyCardOverflow();
  });
  resizeObserver.observe(feedContainer);
}

// ── Timestamp Updates ────────────────────────────────────────────────────
function updateTimestampsOnly() {
  document.querySelectorAll('.time-ago').forEach((el) => {
    const dateStr = el.getAttribute('data-created');
    if (dateStr) el.textContent = formatTweetTime(dateStr);
  });
}

// Update timestamps every 15s
setInterval(updateTimestampsOnly, 15000);

// ── Create Tweet Card HTML ───────────────────────────────────────────────
function createTweetCardHTML(tweet, index) {
  const { author, text, media, id } = tweet;
  // Live stream tweets carry `createdAt`; tweets cached by earlier builds
  // (and the web dashboard shape) carry `created_at`.
  const created_at = tweet.createdAt || tweet.created_at;
  const rawUsername = author?.username || '';
  const meta = resolveAccountForTweet(tweet);

  const formattedTime = formatTweetTime(created_at);
  const cleanId = String(id || '').split('?')[0];
  const tweetUrl = `https://x.com/${meta.handle || rawUsername}/status/${cleanId}`;

  const mediaHTML =
    media && media.length > 0
      ? `<div class="media-preview"><img src="${media[0].preview_url || media[0].url}" alt="Tweet media"></div>`
      : '';

  const verifiedHTML = meta.verified
    ? `
    <svg viewBox="0 0 24 24" class="verified-icon" fill="currentColor">
      <path d="m8.6 22.5-1.9-3.2-3.6-.8.4-3.7L1 12l2.5-2.8-.4-3.7 3.6-.8 1.9-3.2L12 2.9l3.4-1.4 1.9 3.2 3.6.8-.4 3.7L23 12l-2.5 2.8.4 3.7-3.6.8-1.9 3.2-3.4-1.4-3.4 1.4zm2.85-6.55 6.35-6.35-1.4-1.45-4.95 4.95-2.15-2.15-1.4 1.4 3.55 3.6z" />
    </svg>
  `
    : '';

  const highlightedText = highlightEntities(text);

  return `
    <article class="tweet-card" id="card-${id}" style="animation-delay: ${index * 0.04}s">
      <div class="card-stripe" style="background-color: ${meta.color};"></div>

      <div class="card-header">
        <div class="author-info">
          <div class="author-names">
            <div class="name-row">
              <span class="author-name">${meta.name}</span>
              ${verifiedHTML}
            </div>
            <span class="author-handle">@${meta.handle}</span>
          </div>
        </div>

        <div class="meta-right">
          <span class="time-ago" data-created="${created_at}">${formattedTime}</span>
        </div>
      </div>

      <div class="tweet-body-wrap" id="body-wrap-${id}">
        <div class="tweet-body-text" id="body-${id}">
          <p class="tweet-body-inner" id="inner-${id}">${highlightedText}</p>
        </div>
        <button type="button" class="read-more-btn" id="rm-btn-${id}" data-id="${id}" aria-expanded="false" aria-controls="body-${id}" style="display: none;">
          <span class="rm-label">Read more</span>
          <span class="chevron">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
      </div>
      ${mediaHTML}

      <div class="card-footer">
        <button class="copy-btn" data-text="${escapeHTML(text)}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>Copy</span>
        </button>

        <a href="${tweetUrl}" target="_blank" class="open-x-link">
          <span>See on 𝕏</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </article>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTweetTime(dateStr) {
  try {
    const d = new Date(dateStr);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    let rel = 'now';
    if (diff < 60) rel = `${diff}s`;
    else if (diff < 3600) rel = `${Math.floor(diff / 60)}m`;
    else if (diff < 86400) rel = `${Math.floor(diff / 3600)}h`;
    else rel = `${Math.floor(diff / 86400)}d`;
    return `${rel} • ${timeStr}`;
  } catch {
    return 'now';
  }
}

function highlightEntities(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(#WATCH|#BREAKING|#BlockDealAlert)/gi, '<span class="highlight-breaking">$1</span>')
    .replace(/(@\w+)/g, '<span class="highlight-entity">$1</span>')
    .replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" class="highlight-entity">$1</a>');
}

function escapeHTML(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

// Clear badge when panel opens
try {
  chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
} catch (e) { /* extension context may be invalid */ }

// Paint immediately from the state the worker last persisted, then open the
// live port. The panel never touches the network.
lastPortDataTime = Date.now(); // grace period before the silence watchdog runs
loadFromStorage({ force: true });
connectPort();

console.log('[X-Monitor Panel] Initialized (port + chrome.storage.local sync, no polling)');

