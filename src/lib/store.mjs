// ═══════════════════════════════════════════════════════════════════════════
// Tweet Store — one JSON document, today's posts, newest first.
//
//   S3 mode (production; USE_S3=true + credentials)
//     The S3 object is the single shared store. Vercel both reads and writes
//     it, so nothing has to run on anyone's laptop.
//       reads  → conditional GET (ETag) behind a 1s in-memory TTL, so the
//                extension's 1.5s poll costs a 304 almost every time.
//       writes → read-modify-write guarded by a conditional PUT (If-Match).
//                Two webhook deliveries landing at the same instant cannot
//                clobber each other: the loser gets 412/409, re-reads, retries.
//
//   File mode (local dev only; USE_S3 unset)
//     Same API against .data/tweets.json. Never used on Vercel.
//
// Retention: posts from before 08:55 IST today are never returned or kept.
// The boundary is marketHours.retentionCutoff(), shared with the extension,
// so the daily wipe happens everywhere at the same second.
// ═══════════════════════════════════════════════════════════════════════════

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { retentionCutoff } from './marketHours.js';

const MAX_TWEETS = 1000; // comfortably a full market day across all accounts

// ── Config ───────────────────────────────────────────────────────────────
const STORE_PATH =
  process.env.LOCAL_STORE_PATH || join(process.cwd(), '.data', 'tweets.json');

const USE_S3 = String(process.env.USE_S3 || '').toLowerCase() === 'true';
const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME || '';
const S3_FILE_KEY = process.env.AWS_S3_KEY || 'tweets.json';
const S3_REGION =
  process.env.S3_BUCKET_REGION || process.env.AWS_S3_REGION || process.env.AWS_REGION || 'ap-south-1';
const S3_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

const S3_MODE = USE_S3 && Boolean(S3_KEY_ID && S3_SECRET && S3_BUCKET);

const READ_TTL_MS = 1000;      // coalesce bursts of polls into one S3 round-trip
const WRITE_ATTEMPTS = 6;      // conditional-PUT retries before giving up

// ── Helpers ──────────────────────────────────────────────────────────────
function tweetTime(tweet) {
  const raw = tweet?.created_at || tweet?.createdAt || tweet?.received_at;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(ts) ? null : ts;
}

/** True when the post predates today's 08:55 IST boundary. */
export function isExpired(tweet, now = Date.now()) {
  if (!tweet) return true;
  const ts = tweetTime(tweet);
  if (ts === null) return false; // unknown age — keep rather than silently drop
  return ts < retentionCutoff(now);
}

function fresh(tweets, now = Date.now()) {
  return tweets.filter((t) => !isExpired(t, now));
}

// Merge new posts into the current list: drop expired, dedupe by id, newest
// first, capped. Reports what changed so callers can skip no-op writes.
function merge(current, incoming, now = Date.now()) {
  const kept = fresh(current, now);
  const ids = new Set(kept.map((t) => t.id));
  const unique = (Array.isArray(incoming) ? incoming : []).filter(
    (t) => t && t.id && !ids.has(t.id) && !isExpired(t, now)
  );
  const list = [...unique, ...kept].slice(0, MAX_TWEETS);
  return { list, added: unique.length, pruned: current.length - kept.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// S3 MODE
// ═══════════════════════════════════════════════════════════════════════════

let _sdk = null;
let _client = null;
async function s3() {
  if (!_client) {
    _sdk = await import('@aws-sdk/client-s3');
    _client = new _sdk.S3Client({
      region: S3_REGION,
      credentials: { accessKeyId: S3_KEY_ID, secretAccessKey: S3_SECRET },
    });
  }
  return { client: _client, sdk: _sdk };
}

let cache = { tweets: [], etag: '', at: 0 };

const isNotModified = (err) =>
  err?.$metadata?.httpStatusCode === 304 || err?.name === '304' || err?.name === 'NotModified';
const isMissing = (err) =>
  err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound';
const isConflict = (err) =>
  err?.$metadata?.httpStatusCode === 412 ||
  err?.$metadata?.httpStatusCode === 409 ||
  err?.name === 'PreconditionFailed' ||
  err?.name === 'ConditionalRequestConflict';

// Straight from S3, no TTL. `ifNoneMatch` makes it conditional (throws 304).
async function s3Fetch(ifNoneMatch = '') {
  const { client, sdk } = await s3();
  const res = await client.send(
    new sdk.GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: S3_FILE_KEY,
      ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
    })
  );
  const parsed = JSON.parse(await res.Body.transformToString());
  return { tweets: Array.isArray(parsed) ? parsed : [], etag: res.ETag || '' };
}

async function s3Read() {
  const now = Date.now();
  if (now - cache.at < READ_TTL_MS) return fresh(cache.tweets, now);
  try {
    const got = await s3Fetch(cache.etag);
    cache = { tweets: got.tweets, etag: got.etag, at: Date.now() };
  } catch (err) {
    if (isNotModified(err)) {
      cache.at = Date.now();
    } else if (isMissing(err)) {
      cache = { tweets: [], etag: '', at: Date.now() };
    } else {
      console.warn('[store:s3] Read failed, serving cached copy:', err.message);
      cache.at = Date.now();
    }
  }
  return fresh(cache.tweets, now);
}

// Read-modify-write with optimistic concurrency. `transform(current)` returns
// { list, changed }. Writes only when changed; on conflict re-reads and retries.
async function s3Update(transform) {
  const { client, sdk } = await s3();
  let lastErr = null;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    let current = [];
    let etag = '';
    try {
      ({ tweets: current, etag } = await s3Fetch());
    } catch (err) {
      if (!isMissing(err)) throw err;
    }

    const { list, changed } = transform(current);
    if (!changed) {
      cache = { tweets: current, etag, at: Date.now() };
      return current;
    }

    try {
      const res = await client.send(
        new sdk.PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: S3_FILE_KEY,
          Body: JSON.stringify(list),
          ContentType: 'application/json',
          CacheControl: 'no-cache',
          // Succeed only if nobody wrote since we read (or it still doesn't exist).
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
        })
      );
      cache = { tweets: list, etag: res.ETag || '', at: Date.now() };
      return list;
    } catch (err) {
      lastErr = err;
      if (!isConflict(err)) throw err;
      await sleep(40 * attempt + Math.random() * 60); // someone else won — re-read
    }
  }
  throw lastErr || new Error('S3 conditional write kept conflicting');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE MODE (local dev)
// ═══════════════════════════════════════════════════════════════════════════

let fileCache = null;
let fileCacheAt = 0;

function readLocal() {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const raw = readFileSync(STORE_PATH, 'utf-8');
    if (!raw.trim()) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[store] Failed to read local store:', err.message);
    return fileCache || [];
  }
}

// Atomic: temp file + rename, so a crash never leaves half a file.
function writeLocal(tweets) {
  try {
    const dir = dirname(STORE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[store] Could not create data directory:', err.message);
  }
  const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(tweets, null, 2), 'utf-8');
    renameSync(tmpPath, STORE_PATH);
  } catch (err) {
    console.error('[store] Failed to write local store:', err.message);
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
  }
  fileCache = tweets;
  fileCacheAt = Date.now();
}

function fileRead() {
  const now = Date.now();
  if (fileCache && now - fileCacheAt < READ_TTL_MS) return fresh(fileCache, now);
  const all = readLocal();
  const kept = fresh(all, now);
  if (kept.length !== all.length) writeLocal(kept);
  else {
    fileCache = kept;
    fileCacheAt = now;
  }
  return kept;
}

function fileUpdate(transform) {
  const current = readLocal();
  const { list, changed } = transform(current);
  if (changed) writeLocal(list);
  else {
    fileCache = current;
    fileCacheAt = Date.now();
  }
  return changed ? list : current;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/** All of today's posts (since 08:55 IST), newest first. */
export async function getTweets() {
  return S3_MODE ? s3Read() : fileRead();
}

/**
 * Add posts. Dedupes by id, drops anything from before today's 08:55 IST,
 * keeps the newest MAX_TWEETS. Safe under concurrent callers in S3 mode.
 */
export async function addTweets(newTweets) {
  let added = 0;
  const transform = (current) => {
    const m = merge(current, newTweets);
    added = m.added;
    return { list: m.list, changed: m.added > 0 || m.pruned > 0 };
  };
  const list = S3_MODE ? await s3Update(transform) : fileUpdate(transform);
  if (added > 0) console.log(`[store] Saved ${added} new post(s) — ${list.length} today`);
  return list;
}

/** Physically remove everything from before today's 08:55 IST. */
export async function pruneOldTweets(now = Date.now()) {
  let deleted = 0;
  const transform = (current) => {
    const kept = fresh(current, now);
    deleted = current.length - kept.length;
    return { list: kept, changed: deleted > 0 };
  };
  const list = S3_MODE ? await s3Update(transform) : fileUpdate(transform);
  return { deleted, remaining: list.length };
}

/** Surfaced by the health endpoint. */
export function getStoreInfo() {
  return {
    backend: S3_MODE ? 's3' : 'file',
    location: S3_MODE ? `s3://${S3_BUCKET}/${S3_FILE_KEY}` : STORE_PATH,
    maxTweets: MAX_TWEETS,
    retention: 'since 08:55 IST today',
    retentionCutoff: new Date(retentionCutoff()).toISOString(),
  };
}
