// ═══════════════════════════════════════════════════════════════════════════
// Tweet Store — LOCAL FIRST
//
// Tweets are persisted to a plain JSON file on disk. No cloud storage is
// required. S3 remains available as an OPTIONAL mirror, used only when
// USE_S3=true and credentials are present — the AWS SDK is imported lazily
// so the dependency can be removed entirely if you never enable it.
//
// Why not /tmp: macOS purges /tmp periodically and Render's filesystem is
// ephemeral, so the old fallback lost history on every restart.
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

const MAX_TWEETS = 500;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour (3,600,000 ms)

function isExpired(tweet, maxAgeMs = MAX_AGE_MS) {
  if (!tweet) return true;
  const rawTime = tweet.created_at || tweet.createdAt || tweet.received_at;
  if (!rawTime) return false;
  const ts = new Date(rawTime).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > maxAgeMs;
}

// ── Storage location ─────────────────────────────────────────────────────
// Override with LOCAL_STORE_PATH to put the archive anywhere you like.
const STORE_PATH =
  process.env.LOCAL_STORE_PATH ||
  (process.env.VERCEL ? join('/tmp', 'tweets.json') : join(process.cwd(), '.data', 'tweets.json'));

// ── Optional S3 mirror (off by default) ──────────────────────────────────
const USE_S3 = String(process.env.USE_S3 || '').toLowerCase() === 'true';
const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME || '';
const S3_FILE_KEY = process.env.AWS_S3_KEY || 'tweets.json';
const S3_REGION =
  process.env.S3_BUCKET_REGION || process.env.AWS_S3_REGION || process.env.AWS_REGION || 'ap-south-1';
const S3_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

const s3Enabled = () => USE_S3 && Boolean(S3_KEY_ID && S3_SECRET && S3_BUCKET);

let _s3Client = null;
async function getS3Client() {
  if (!s3Enabled()) return null;
  if (_s3Client) return _s3Client;
  try {
    // Lazy import — nothing from the AWS SDK is loaded unless S3 is on.
    const { S3Client } = await import('@aws-sdk/client-s3');
    _s3Client = new S3Client({
      region: S3_REGION,
      credentials: { accessKeyId: S3_KEY_ID, secretAccessKey: S3_SECRET },
    });
    return _s3Client;
  } catch (err) {
    console.warn('[store:s3] SDK unavailable, staying local-only:', err.message);
    return null;
  }
}

// ── In-memory cache ──────────────────────────────────────────────────────
// The Next.js process only READS. The stream listener is the only writer,
// so a short TTL is enough for the dashboard to see new tweets promptly.
let memoryCache = null;
let lastFetchTime = 0;
let lastKnownMtime = 0;
const CACHE_TTL_MS = 500;

function ensureDir() {
  try {
    const dir = dirname(STORE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[store] Could not create data directory:', err.message);
  }
}

function readLocal() {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const raw = readFileSync(STORE_PATH, 'utf-8');
    if (!raw.trim()) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[store] Failed to read local store:', err.message);
    // Corrupt file: keep whatever is in memory rather than wiping history.
    return memoryCache || [];
  }
}

// Atomic write — write to a temp file, then rename. A crash mid-write can
// never leave a half-written tweets.json behind.
function writeLocal(tweets) {
  ensureDir();
  const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(tweets, null, 2), 'utf-8');
    renameSync(tmpPath, STORE_PATH);
    return true;
  } catch (err) {
    console.error('[store] Failed to write local store:', err.message);
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
    return false;
  }
}

/**
 * Read all stored tweets (within 1 hour), newest first.
 */
export async function getTweets() {
  const now = Date.now();
  if (memoryCache && now - lastFetchTime < CACHE_TTL_MS) {
    return memoryCache.filter((t) => !isExpired(t));
  }

  const tweets = readLocal();
  const pruned = tweets.filter((t) => !isExpired(t));

  // If the local file has no fresh tweets but an S3 mirror exists, seed from it once.
  if (pruned.length === 0 && s3Enabled()) {
    const seeded = await _seedFromS3();
    const seededPruned = seeded.filter((t) => !isExpired(t));
    if (seededPruned.length) {
      memoryCache = seededPruned;
      writeLocal(seededPruned);
      if (seeded.length !== seededPruned.length) {
        _mirrorToS3(seededPruned).catch(() => {});
      }
      return seededPruned;
    }
  }

  // If local had expired tweets, clean local disk and mirror clean state to S3
  if (tweets.length !== pruned.length) {
    writeLocal(pruned);
    if (s3Enabled()) {
      _mirrorToS3(pruned).catch(() => {});
    }
  }

  memoryCache = pruned;
  lastFetchTime = now;
  return memoryCache;
}

async function _seedFromS3() {
  try {
    const s3 = await getS3Client();
    if (!s3) return [];
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const response = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_FILE_KEY })
    );
    const body = await response.Body.transformToString();
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err?.name !== 'NoSuchKey' && err?.$metadata?.httpStatusCode !== 404) {
      console.warn('[store:s3] Seed read failed:', err.message);
    }
    return [];
  }
}

/**
 * Add new tweets. Deduplicates by id, prunes data older than 1 hour,
 * keeps the newest MAX_TWEETS.
 * Returns the full combined list.
 */
export async function addTweets(newTweets) {
  if (!Array.isArray(newTweets) || newTweets.length === 0) {
    return (memoryCache || readLocal()).filter((t) => !isExpired(t));
  }

  // Re-read from disk first so concurrent writers don't clobber each other.
  const existing = readLocal();
  const validExisting = existing.filter((t) => !isExpired(t));
  const existingIds = new Set(validExisting.map((t) => t.id));

  const unique = newTweets.filter((t) => t && t.id && !existingIds.has(t.id) && !isExpired(t));
  if (unique.length === 0) {
    if (existing.length !== validExisting.length) {
      writeLocal(validExisting);
      if (s3Enabled()) _mirrorToS3(validExisting).catch(() => {});
    }
    memoryCache = validExisting;
    lastFetchTime = Date.now();
    return validExisting;
  }

  const combined = [...unique, ...validExisting].slice(0, MAX_TWEETS);
  memoryCache = combined;
  lastFetchTime = Date.now();

  writeLocal(combined);
  console.log(`[store] Saved ${unique.length} new tweet(s) — ${combined.length} total on disk (all <= 1h old)`);

  // Optional S3 mirror, fire-and-forget so it never delays ingestion.
  if (s3Enabled()) {
    _mirrorToS3(combined).catch(() => {});
  }

  return combined;
}

/**
 * Prune all tweets older than maxAgeMs (default 1 hour) from memory, disk, and S3.
 */
export async function pruneOldTweets(maxAgeMs = MAX_AGE_MS) {
  const existing = readLocal();
  const fresh = existing.filter((t) => !isExpired(t, maxAgeMs));
  writeLocal(fresh);
  memoryCache = fresh;
  lastFetchTime = Date.now();
  if (s3Enabled()) {
    await _mirrorToS3(fresh);
  }
  return {
    deleted: existing.length - fresh.length,
    remaining: fresh.length,
  };
}

async function _mirrorToS3(tweets) {
  try {
    const s3 = await getS3Client();
    if (!s3) return;
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: S3_FILE_KEY,
        Body: JSON.stringify(tweets, null, 2),
        ContentType: 'application/json',
      })
    );
  } catch (err) {
    console.warn('[store:s3] Mirror write failed (local copy is unaffected):', err.message);
  }
}

/**
 * Tweets created after a given ISO timestamp.
 */
export async function getTweetsSince(sinceISO) {
  const tweets = await getTweets();
  if (!sinceISO) return tweets;
  const since = new Date(sinceISO).getTime();
  if (Number.isNaN(since)) return tweets;
  return tweets.filter((t) => new Date(t.created_at).getTime() > since);
}

/**
 * Where the archive lives — surfaced by the health endpoint.
 */
export function getStoreInfo() {
  return {
    path: STORE_PATH,
    exists: existsSync(STORE_PATH),
    s3Mirror: s3Enabled(),
    maxTweets: MAX_TWEETS,
  };
}
