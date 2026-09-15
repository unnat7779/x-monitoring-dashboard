import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const STORE_PATH = join('/tmp', 'x-monitor-tweets.json');
const MAX_TWEETS = 500;
const S3_FILE_KEY = process.env.AWS_S3_KEY || 'tweets.json';

// In-memory cache for fast reads
let memoryCache = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1000; // 1 second cache for instant updates

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME || 'x-monitoring-tweets-prod';
const S3_REGION = process.env.S3_BUCKET_REGION || process.env.AWS_S3_REGION || 'ap-south-1';
const S3_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

/**
 * Initialize S3 client with env vars or production defaults
 */
function getS3Client() {
  if (!S3_KEY_ID || !S3_SECRET || !S3_BUCKET) {
    return null;
  }
  return new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_KEY_ID,
      secretAccessKey: S3_SECRET,
    },
  });
}

/**
 * Helper to convert S3 stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Read all stored tweets from S3 (with local fallback).
 * Returns an array sorted newest-first.
 */
export async function getTweets() {
  const now = Date.now();
  if (memoryCache && now - lastFetchTime < CACHE_TTL_MS) {
    return memoryCache;
  }

  const s3 = getS3Client();
  const bucket = S3_BUCKET;

  if (s3 && bucket) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: S3_FILE_KEY,
      });
      const response = await s3.send(command);
      const bodyContents = await response.Body.transformToString();
      const tweets = JSON.parse(bodyContents);
      if (Array.isArray(tweets)) {
        memoryCache = tweets;
        lastFetchTime = now;
        return tweets;
      }
    } catch (err) {
      console.error('[store:s3] S3 fetch error:', err);
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        // First run: file doesn't exist yet on S3
        memoryCache = [];
        lastFetchTime = now;
        return [];
      }
    }
  }

  // Fallback to local /tmp storage
  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      memoryCache = Array.isArray(data) ? data : [];
      lastFetchTime = now;
      return memoryCache;
    }
  } catch (err) {
    console.error('[store:local] Failed to read local storage:', err);
  }

  return memoryCache || [];
}

/**
 * Add new tweets to the store.
 * Deduplicates by tweet id, keeps only the most recent MAX_TWEETS.
 * Writes to S3 and updates local fallback.
 */
export async function addTweets(newTweets) {
  const existing = await getTweets();
  const existingIds = new Set(existing.map((t) => t.id));

  const unique = newTweets.filter((t) => !existingIds.has(t.id));
  if (unique.length === 0) return existing;

  const combined = [...unique, ...existing].slice(0, MAX_TWEETS);
  memoryCache = combined;
  lastFetchTime = Date.now();

  // 1. Write to S3 if configured
  const s3 = getS3Client();
  const bucket = S3_BUCKET;

  if (s3 && bucket) {
    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: S3_FILE_KEY,
        Body: JSON.stringify(combined, null, 2),
        ContentType: 'application/json',
      });
      await s3.send(command);
      console.log(`[store:s3] Successfully synced ${combined.length} tweets to s3://${bucket}/${S3_FILE_KEY}`);
    } catch (err) {
      console.error('[store:s3] Failed to write to S3:', err.message);
    }
  }

  // 2. Always write to /tmp for local backup
  try {
    writeFileSync(STORE_PATH, JSON.stringify(combined, null, 2), 'utf-8');
  } catch (err) {
    console.error('[store:local] Failed to write to /tmp:', err);
  }

  return combined;
}

/**
 * Get tweets created after a given ISO timestamp.
 */
export async function getTweetsSince(sinceISO) {
  const tweets = await getTweets();
  if (!sinceISO) return tweets;

  const sinceDate = new Date(sinceISO).getTime();
  return tweets.filter((t) => new Date(t.created_at).getTime() > sinceDate);
}
