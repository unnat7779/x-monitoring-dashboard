#!/usr/bin/env node
import 'dotenv/config';
import Pusher from 'pusher';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local if not loaded by dotenv
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const appId = process.env.PUSHER_APP_ID;
const key = process.env.PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.PUSHER_CLUSTER || 'ap2';

if (!appId || !key || !secret) {
  console.error('\n❌ Missing Pusher credentials in .env.local!');
  console.error('Please configure:');
  console.error('  PUSHER_APP_ID=...');
  console.error('  PUSHER_KEY=...');
  console.error('  PUSHER_SECRET=...');
  console.error('  PUSHER_CLUSTER=ap2\n');
  process.exit(1);
}

const pusher = new Pusher({
  appId,
  key,
  secret,
  cluster,
  useTLS: true,
});

const sampleTweet = {
  id: `test-${Date.now()}`,
  text: '🚀 [TEST] Real-time Pusher test event from X Monitoring CLI!',
  created_at: new Date().toISOString(),
  author: {
    username: 'NDTVProfit',
    name: 'NDTV Profit',
  },
};

console.log(`\n📡 Triggering event on channel "x-monitor" via Pusher cluster "${cluster}"...`);

pusher
  .trigger('x-monitor', 'new-tweets', { tweets: [sampleTweet] })
  .then((response) => {
    console.log('✅ Event successfully sent to Pusher!');
    console.log('Sample tweet dispatched:', sampleTweet);
    console.log('\nIf your Chrome extension is open with the same PUSHER_KEY, it should have received this immediately!');
  })
  .catch((err) => {
    console.error('❌ Failed to send event to Pusher:', err.message || err);
  });
