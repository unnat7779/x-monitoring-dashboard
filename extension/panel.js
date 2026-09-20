// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Panel Window Script
//
// A pure view. The background worker owns every decision (when to poll, mode
// changes, the 5-minute ON window, the 08:55 daily purge). This file paints
// what the worker sends over a long-lived port and forwards button presses.
// It never touches the network and never writes state to storage.
// ═══════════════════════════════════════════════════════════════════════════

// ── Monitored accounts (display metadata) ────────────────────────────────
const MONITORED_ACCOUNTS = [
  { handle: 'NDTVProfitIndia', name: 'NDTV Profit', color: '#10b981' },
  { handle: 'NDTVProfit', name: 'NDTV Profit', color: '#10b981' },
  { handle: 'CNBCTV18News', name: 'CNBC-TV18', color: '#0284c7' },
  { handle: 'CNBCTV18Live', name: 'CNBC-TV18 Live', color: '#0369a1' },
  { handle: 'ETNOWlive', name: 'ET NOW', color: '#f59e0b' },
  { handle: 'ZeeBusiness', name: 'Zee Business', color: '#ef4444' },
  { handle: 'moneycontrolcom', name: 'Moneycontrol', color: '#10b981' },
  { handle: 'livemint', name: 'Livemint', color: '#f97316' },
  { handle: 'bsindia', name: 'Business Standard', color: '#e11d48' },
  { handle: 'business', name: 'Bloomberg', color: '#8b5cf6' },
  { handle: 'ANI', name: 'ANI News', color: '#ef4444' },
  { handle: 'PTI_News', name: 'PTI News', color: '#ef4444' },
  { handle: 'LiveLawIndia', name: 'Live Law', color: '#06b6d4' },
  { handle: 'yatinmota', name: 'Yatin Mota', color: '#c084fc' },
  { handle: 'darshanvmehta1', name: 'Darshan Mehta', color: '#c084fc' },
  { handle: 'SoumeetSarkar', name: 'Soumeet Sarkar', color: '#c084fc' },
  { handle: 'soumeet_sarkar', name: 'Soumeet Sarkar', color: '#c084fc' },
  { handle: 'SharadDubey_', name: 'Sharad Dubey', color: '#c084fc' },
  { handle: 'LakshmanRoy1', name: 'Lakshman Roy', color: '#c084fc' },
  { handle: 'shukla_tarun', name: 'Tarun Shukla', color: '#c084fc' },
];

function getAccountMeta(tweet) {
  const username = (tweet.author?.username || '').replace(/^@/, '');
  const key = username.toLowerCase();
  const match = MONITORED_ACCOUNTS.find((acc) => acc.handle.toLowerCase() === key);
  if (match) return match;
  return {
    handle: username || 'unknown',
    name: tweet.author?.name || username || 'Unknown',
    color: '#38bdf8',
  };
}

// ── Constants shared with the worker ─────────────────────────────────────
const MANUAL_ON_MS = 5 * 60 * 1000;
const COLLAPSED_HEIGHT_LIMIT = 64;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const PURGE_MIN = 8 * 60 + 55; // posts from before today's 08:55 IST are gone

// Epoch ms of the most recent 08:55 IST at or before `now` (same as worker).
function retentionCutoff(now = Date.now()) {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  let cutoff = istMidnight + PURGE_MIN * 60000;
  if (cutoff > istNow) cutoff -= DAY_MS;
  return cutoff - IST_OFFSET_MS;
}

// ── State ────────────────────────────────────────────────────────────────
const state = {
  maxCount: 3,
  rawTweets: [],
  mode: 'auto',        // 'auto' | 'on'
  manualOnUntil: 0,    // epoch ms while ON
  polling: false,      // worker's poll loop is running
  connected: false,    // last poll succeeded
  marketOpen: false,
  nextEdge: 0,         // epoch ms of next 9:00 / 15:30 IST
};

let expandedPostId = null;
let renderedSignature = '';

// ── DOM ──────────────────────────────────────────────────────────────────
const feedContainer = document.getElementById('feed-container');
const statusLabel = document.getElementById('post-count-label');
const statusDot = document.getElementById('status-dot');
const updateToast = document.getElementById('update-toast');
const toastMessage = document.getElementById('toast-message');
const toastClose = document.getElementById('toast-close');
const btnCount3 = document.getElementById('btn-count-3');
const btnCount5 = document.getElementById('btn-count-5');
const btnModeAuto = document.getElementById('btn-mode-auto');
const btnModeOn = document.getElementById('btn-mode-on');

// ═══════════════════════════════════════════════════════════════════════════
// PORT TO THE WORKER
// ═══════════════════════════════════════════════════════════════════════════

const KEEPALIVE_MS = 20000;
const SILENCE_LIMIT_MS = 75000; // no message this long → assume a stale port
const MAX_RECONNECT_DELAY = 30000;

let port = null;
let keepaliveTimer = null;
let reconnectAttempts = 0;
let lastPortMessageAt = Date.now();

function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'panel' });
    reconnectAttempts = 0;
    lastPortMessageAt = Date.now();
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      stopKeepalive();
      scheduleReconnect();
    });
    startKeepalive();
  } catch (err) {
    port = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  setTimeout(connectPort, delay);
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (!port) return;
    try {
      port.postMessage({ type: 'PING' });
    } catch (e) {
      port = null;
      stopKeepalive();
      scheduleReconnect();
    }
  }, KEEPALIVE_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
}

// A port can occasionally go quiet without ever firing onDisconnect. If the
// worker should be talking to us and hasn't, reconnect — INIT re-syncs us.
setInterval(() => {
  if (!port) return;
  const expectTraffic = state.polling || state.mode === 'on';
  if (expectTraffic && Date.now() - lastPortMessageAt > SILENCE_LIMIT_MS) {
    try { port.disconnect(); } catch (e) { /* already gone */ }
    port = null;
    stopKeepalive();
    connectPort();
  }
}, 15000);

function sendToWorker(msg) {
  if (port) {
    try {
      port.postMessage(msg);
      return;
    } catch (e) {
      port = null;
    }
  }
  try {
    chrome.runtime.sendMessage(msg);
  } catch (e) {
    // extension context may be invalid
  }
}

function handlePortMessage(msg) {
  lastPortMessageAt = Date.now();
  switch (msg.type) {
    case 'INIT':
      applyStatus(msg);
      applyTweets(msg.tweets, 0);
      break;
    case 'STATUS':
      applyStatus(msg);
      if (msg.reason === 'manual_on_expired') showToast('Manual ON ended — back to Auto');
      break;
    case 'FEED':
      applyTweets(msg.tweets, msg.newCount);
      break;
  }
}

function applyStatus(s) {
  if (s.mode === 'auto' || s.mode === 'on') state.mode = s.mode;
  if (typeof s.manualOnUntil === 'number') state.manualOnUntil = s.manualOnUntil;
  if (typeof s.polling === 'boolean') state.polling = s.polling;
  if (typeof s.connected === 'boolean') state.connected = s.connected;
  if (typeof s.marketOpen === 'boolean') state.marketOpen = s.marketOpen;
  if (typeof s.nextEdge === 'number') state.nextEdge = s.nextEdge;
  renderModeButtons();
  renderStatus();
  renderFeed();
}

function applyTweets(tweets, newCount) {
  const now = Date.now();
  state.rawTweets = (Array.isArray(tweets) ? tweets : []).filter((t) => isFresh(t, now));
  renderFeed();
  renderStatus();
  if (newCount > 0) {
    showToast(newCount === 1 ? 'New breaking post received' : `${newCount} new posts received`);
    playChime();
  }
}

// Instant first paint from what the worker last persisted; the port's INIT
// replaces it a moment later.
async function paintFromStorage() {
  try {
    const data = await chrome.storage.local.get(['tweetHistory', 'mode', 'manualOnUntil']);
    applyStatus({ mode: data.mode, manualOnUntil: data.manualOnUntil });
    if (Array.isArray(data.tweetHistory)) applyTweets(data.tweetHistory, 0);
  } catch (e) {
    // extension context may be invalid
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

function changeMode(mode) {
  // Optimistic paint; the worker's STATUS confirms (or corrects) it.
  state.mode = mode;
  state.manualOnUntil = mode === 'on' ? Date.now() + MANUAL_ON_MS : 0;
  renderModeButtons();
  renderStatus();
  renderFeed();
  sendToWorker({ type: 'SET_MODE', mode });
}

btnModeAuto.addEventListener('click', () => changeMode('auto'));
btnModeOn.addEventListener('click', () => changeMode('on'));

function remainingOnSeconds() {
  return Math.max(0, Math.ceil((state.manualOnUntil - Date.now()) / 1000));
}

function formatCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function renderModeButtons() {
  const on = state.mode === 'on';
  btnModeAuto.classList.toggle('active', !on);
  btnModeOn.classList.toggle('active', on);
  btnModeOn.textContent = on ? formatCountdown(remainingOnSeconds()) : 'ON';
}

// 1s tick: countdown on the ON button, and the empty-state line that shows it.
setInterval(() => {
  if (state.mode !== 'on') return;
  renderModeButtons();
  renderStatus();
  const sub = document.querySelector('.empty-state-sub[data-live-countdown]');
  if (sub) sub.textContent = emptyStateSub();
}, 1000);

// ═══════════════════════════════════════════════════════════════════════════
// COUNT TOGGLE / TOAST / CHIME
// ═══════════════════════════════════════════════════════════════════════════

btnCount3.addEventListener('click', () => setMaxCount(3));
btnCount5.addEventListener('click', () => setMaxCount(5));

function setMaxCount(n) {
  state.maxCount = n;
  btnCount3.classList.toggle('active', n === 3);
  btnCount5.classList.toggle('active', n === 5);
  renderFeed(true);
}

let toastTimer = null;
function showToast(message) {
  toastMessage.textContent = message;
  updateToast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => updateToast.classList.add('hidden'), 3500);
}
toastClose.addEventListener('click', () => {
  updateToast.classList.add('hidden');
  if (toastTimer) clearTimeout(toastTimer);
});

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
    // audio unavailable
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS FOOTER
// ═══════════════════════════════════════════════════════════════════════════

function formatIstClock(epochMs) {
  try {
    return new Date(epochMs).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return '9:00 am';
  }
}

function renderStatus() {
  const count = state.rawTweets.length;
  let text;
  let dot = 'status-dot';

  if (state.mode === 'on') {
    text = `Manual ON · ${formatCountdown(remainingOnSeconds())} left`;
    if (!state.connected) dot += ' error';
  } else if (!state.polling) {
    if (state.marketOpen) text = 'Starting…';
    else if (state.nextEdge) text = `Idle · resumes ${formatIstClock(state.nextEdge)} IST`;
    else text = 'Idle';
    dot += ' paused';
  } else if (!state.connected) {
    text = 'Backend unreachable — retrying';
    dot += ' error';
  } else {
    text = count === 0 ? 'Live — waiting for posts' : `${count} post${count === 1 ? '' : 's'} today`;
  }

  statusLabel.textContent = text;
  statusDot.className = dot;
}

// ═══════════════════════════════════════════════════════════════════════════
// FEED
// ═══════════════════════════════════════════════════════════════════════════

function isFresh(t, now = Date.now()) {
  const ts = Date.parse(t?.created_at || '');
  return !Number.isNaN(ts) && ts >= retentionCutoff(now);
}

function emptyStateSub() {
  if (state.mode === 'on') {
    return state.marketOpen
      ? `Auto-off in ${formatCountdown(remainingOnSeconds())}`
      : `Auto-off in ${formatCountdown(remainingOnSeconds())} · showing today's posts; new ones arrive 9:00 AM – 3:30 PM IST`;
  }
  return state.marketOpen ? '' : 'Market hours: Daily 9:00 AM – 3:30 PM (IST)';
}

function renderFeed(force = false) {
  const displayList = state.rawTweets.slice(0, state.maxCount);
  const signature = `${state.mode}-${state.marketOpen}-${state.maxCount}-${displayList.map((t) => t.id).join(',')}`;
  if (!force && signature === renderedSignature) {
    updateTimestampsOnly();
    return;
  }
  renderedSignature = signature;

  if (displayList.length === 0) {
    let title = 'Waiting for posts…';
    if (state.mode === 'auto' && !state.marketOpen) {
      title = 'New posts will display between 9:00 AM – 3:30 PM';
    }
    const sub = emptyStateSub();
    feedContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">𝕏</div>
        <p class="empty-state-title">${escapeHTML(title)}</p>
        ${sub ? `<span class="empty-state-sub" ${state.mode === 'on' ? 'data-live-countdown' : ''}>${escapeHTML(sub)}</span>` : ''}
      </div>
    `;
    return;
  }

  feedContainer.innerHTML = displayList.map(createTweetCardHTML).join('');

  feedContainer.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.text || '');
      btn.classList.add('copied');
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (label) label.textContent = 'Copy';
      }, 1500);
    });
  });

  feedContainer.querySelectorAll('.read-more-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      expandedPostId = expandedPostId === id ? null : id;
      measureAndApplyCardOverflow();
      if (expandedPostId) {
        const card = document.getElementById(`card-${expandedPostId}`);
        if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
      }
    });
  });

  measureAndApplyCardOverflow();
}

function measureAndApplyCardOverflow() {
  feedContainer.querySelectorAll('.tweet-card').forEach((card) => {
    const id = card.id.replace('card-', '');
    const innerEl = document.getElementById(`inner-${id}`);
    const bodyEl = document.getElementById(`body-${id}`);
    const btnEl = document.getElementById(`rm-btn-${id}`);
    if (!innerEl || !bodyEl || !btnEl) return;

    if (innerEl.scrollHeight <= COLLAPSED_HEIGHT_LIMIT) {
      btnEl.style.display = 'none';
      bodyEl.className = 'tweet-body-text';
      return;
    }
    btnEl.style.display = 'inline-flex';
    const isExpanded = expandedPostId === id;
    bodyEl.className = `tweet-body-text ${isExpanded ? 'expanded' : 'collapsed'}`;
    btnEl.classList.toggle('expanded', isExpanded);
    btnEl.setAttribute('aria-expanded', String(isExpanded));
    btnEl.querySelector('.rm-label').textContent = isExpanded ? 'Show less' : 'Read more';
  });
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(measureAndApplyCardOverflow).observe(feedContainer);
}

function updateTimestampsOnly() {
  feedContainer.querySelectorAll('.time-ago').forEach((el) => {
    const created = el.dataset.created;
    if (created) el.textContent = formatTweetTime(created);
  });
}

// Every 15s: refresh relative times, and at 08:55 drop yesterday's posts so
// the panel is wiped on time even with no polling at that hour.
setInterval(() => {
  const now = Date.now();
  const fresh = state.rawTweets.filter((t) => isFresh(t, now));
  if (fresh.length !== state.rawTweets.length) {
    state.rawTweets = fresh;
    renderFeed();
    renderStatus();
  } else {
    updateTimestampsOnly();
  }
}, 15000);

const VERIFIED_SVG = `
  <svg viewBox="0 0 24 24" class="verified-icon" fill="currentColor">
    <path d="m8.6 22.5-1.9-3.2-3.6-.8.4-3.7L1 12l2.5-2.8-.4-3.7 3.6-.8 1.9-3.2L12 2.9l3.4-1.4 1.9 3.2 3.6.8-.4 3.7L23 12l-2.5 2.8.4 3.7-3.6.8-1.9 3.2-3.4-1.4-3.4 1.4zm2.85-6.55 6.35-6.35-1.4-1.45-4.95 4.95-2.15-2.15-1.4 1.4 3.55 3.6z" />
  </svg>`;

// ── Card template — every dynamic value goes through escapeHTML ──────────
function createTweetCardHTML(tweet) {
  const meta = getAccountMeta(tweet);
  const id = escapeHTML(tweet.id);
  const created = escapeHTML(tweet.created_at);
  const handle = escapeHTML(meta.handle);
  const name = escapeHTML(meta.name);
  const color = /^#[0-9a-f]{6}$/i.test(meta.color) ? meta.color : '#38bdf8';
  const tweetUrl = escapeHTML(`https://x.com/${meta.handle}/status/${tweet.id}`);
  const mediaUrl = tweet.media?.[0]?.url;
  const mediaHTML = mediaUrl && /^https:\/\//i.test(mediaUrl)
    ? `<div class="media-preview"><img src="${escapeHTML(mediaUrl)}" alt="Tweet media"></div>`
    : '';

  return `
    <article class="tweet-card" id="card-${id}">
      <div class="card-stripe" style="background-color: ${color};"></div>

      <div class="card-header">
        <div class="author-info">
          <div class="author-names">
            <div class="name-row">
              <span class="author-name">${name}</span>
              ${tweet.author?.verified ? VERIFIED_SVG : ''}
            </div>
            <span class="author-handle">@${handle}</span>
          </div>
        </div>
        <div class="meta-right">
          <span class="time-ago" data-created="${created}">${escapeHTML(formatTweetTime(tweet.created_at))}</span>
        </div>
      </div>

      <div class="tweet-body-wrap">
        <div class="tweet-body-text" id="body-${id}">
          <p class="tweet-body-inner" id="inner-${id}">${highlightEntities(tweet.text)}</p>
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
        <button class="copy-btn" data-text="${escapeHTML(tweet.text)}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>Copy</span>
        </button>
        <a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" class="open-x-link">
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
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'now';
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  let rel = `${diff}s`;
  if (diff >= 86400) rel = `${Math.floor(diff / 86400)}d`;
  else if (diff >= 3600) rel = `${Math.floor(diff / 3600)}h`;
  else if (diff >= 60) rel = `${Math.floor(diff / 60)}m`;
  return `${rel} • ${timeStr}`;
}

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tokenise, then escape each piece. URLs are matched whole so an @mention
// inside one can never be wrapped separately and corrupt the href.
function highlightEntities(text) {
  return String(text ?? '')
    .split(/(https?:\/\/[^\s]+|@\w+|#\w+)/g)
    .map((part) => {
      const safe = escapeHTML(part);
      if (/^https?:\/\//i.test(part)) {
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="highlight-entity">${safe}</a>`;
      }
      if (/^#(WATCH|BREAKING|BlockDealAlert)$/i.test(part)) {
        return `<span class="highlight-breaking">${safe}</span>`;
      }
      if (part.startsWith('@')) return `<span class="highlight-entity">${safe}</span>`;
      return safe;
    })
    .join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

paintFromStorage();
connectPort();

// The extension being reloaded from chrome://extensions kills this window's
// runtime context but leaves the window open, silently frozen. Say so.
(function watchForInvalidatedContext() {
  const BANNER_ID = 'xm-stale-banner';
  setInterval(() => {
    let alive = false;
    try { alive = Boolean(chrome.runtime && chrome.runtime.id); } catch { /* dead */ }
    if (alive || document.getElementById(BANNER_ID)) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.innerHTML =
      '<strong>This window is disconnected.</strong><br>' +
      'The extension was reloaded. Close this window and click the ' +
      'X Monitor toolbar icon to reopen it. Posts shown below are stale.';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
      padding: '10px 14px', background: '#b91c1c', color: '#fff',
      font: '12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,.45)',
    });
    document.body.appendChild(banner);
    feedContainer.style.opacity = '0.45';
  }, 3000);
})();
