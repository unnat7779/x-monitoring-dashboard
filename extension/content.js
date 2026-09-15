// ═══════════════════════════════════════════════════════════════════════════
// X Monitor — Content Script (Keep-Alive)
// Maintains a long-lived port to the background service worker to prevent
// it from being killed by Chrome's MV3 idle timeout (~30s).
// This script does NOT interact with or modify page content in any way.
// ═══════════════════════════════════════════════════════════════════════════

const PING_INTERVAL_MS = 20000; // 20 seconds
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

let port = null;
let pingTimerId = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'content-keepalive' });
    reconnectDelay = INITIAL_RECONNECT_DELAY; // reset on success

    port.onDisconnect.addListener(() => {
      port = null;
      stopPing();
      scheduleReconnect();
    });

    // We don't need to listen for messages from background in content script
    startPing();
  } catch (err) {
    // Extension context may be invalidated (e.g. extension updated/removed)
    port = null;
    scheduleReconnect();
  }
}

function startPing() {
  stopPing();
  pingTimerId = setInterval(() => {
    if (port) {
      try {
        port.postMessage({ type: 'PING' });
      } catch (e) {
        // Port died
        port = null;
        stopPing();
        scheduleReconnect();
      }
    }
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimerId) {
    clearInterval(pingTimerId);
    pingTimerId = null;
  }
}

function scheduleReconnect() {
  setTimeout(() => {
    // Check if extension context is still valid before reconnecting
    try {
      if (chrome.runtime?.id) {
        connect();
      }
    } catch (e) {
      // Extension context invalidated — stop trying
    }
  }, reconnectDelay);

  // Exponential backoff
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
}

// Start the keep-alive connection
connect();
