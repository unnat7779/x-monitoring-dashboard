import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

let apiKey = process.env.TWITTERAPI_IO_KEY || '';
const envPath = resolve(process.cwd(), '.env.local');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^TWITTERAPI_IO_KEY=(.*)$/);
    if (match) apiKey = match[1].trim();
  }
}

const WS_URL = 'wss://ws.twitterapi.io/twitter/tweet/websocket';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://x-monitoring-dashboard.onrender.com/api/twitter-webhook';

console.log('═══════════════════════════════════════════════════════════════');
console.log('⚡ TwitterAPI.io Stream Starter WebSocket Bridge');
console.log(`🔑 API Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-5)}`);
console.log(`🎯 Forwarding to: ${WEBHOOK_URL}`);
console.log('═══════════════════════════════════════════════════════════════');

let ws = null;
let reconnectDelay = 1000;
let pingInterval = null;

function connect() {
  console.log(`[stream] Connecting to ${WS_URL}...`);

  ws = new WebSocket(WS_URL, {
    headers: {
      'x-api-key': apiKey,
    },
  });

  ws.on('open', () => {
    console.log('✅ [stream] WebSocket connected & authenticated successfully with Stream Starter!');
    reconnectDelay = 1000;

    // Send periodic ping every 30s to keep socket alive
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      
      // Handle connection handshake / heartbeat
      if (payload.status === 'connected' || payload.event_type === 'connected') {
        console.log(`[stream] Connection confirmed for user ${payload.user_id}`);
        return;
      }

      if (payload.event_type === 'ping' || payload.ping) {
        return;
      }

      console.log('⚡ [stream] New real-time tweet incoming!');

      // Forward to webhook endpoint
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => ({}));
      console.log(`[stream] Webhook synced successfully: status=${res.status}`, result);
    } catch (err) {
      console.error('[stream] Error processing incoming tweet payload:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`[stream] WebSocket closed (code ${code}): ${reason || 'Connection lost'}. Reconnecting in ${reconnectDelay / 1000}s...`);
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on('error', (err) => {
    console.error('[stream] WebSocket error:', err.message);
  });
}

connect();
