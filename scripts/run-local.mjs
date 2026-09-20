// ═══════════════════════════════════════════════════════════════════════════
// Local runner — starts the whole stack on this machine.
//
//   1. scripts/stream-listener.mjs  → TwitterAPI.io WebSocket → .data/tweets.json
//   2. next start (or next dev)     → dashboard + /api/tweets for the extension
//
// Guards against the stale-build trap: `next start` serves whatever was last
// compiled into .next, so an out-of-date build silently keeps serving OLD code
// (for us: the pre-migration version that read tweets from S3). We compare the
// build stamp against the newest source file and rebuild when it's behind.
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = process.env.PORT || '3000';

const COLORS = { stream: '\x1b[36m', next: '\x1b[35m', build: '\x1b[33m', sys: '\x1b[32m', off: '\x1b[0m' };
const log = (tag, line) => process.stdout.write(`${COLORS[tag] || ''}[${tag}]${COLORS.off} ${line}\n`);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// ── Is the compiled build behind the source? ─────────────────────────────
function newestMtime(dir, newest = 0) {
  let result = newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result = newestMtime(full, result);
    } else {
      const m = statSync(full).mtimeMs;
      if (m > result) result = m;
    }
  }
  return result;
}

function buildStatus() {
  const buildId = join(ROOT, '.next', 'BUILD_ID');
  if (!existsSync(buildId)) return { needsBuild: true, reason: 'no build found' };

  const buildTime = statSync(buildId).mtimeMs;
  let srcTime = 0;
  try {
    srcTime = newestMtime(join(ROOT, 'src'));
  } catch { /* no src dir — unusual, just trust the build */ }

  for (const f of ['next.config.mjs', 'package.json']) {
    const p = join(ROOT, f);
    if (existsSync(p)) srcTime = Math.max(srcTime, statSync(p).mtimeMs);
  }

  if (srcTime > buildTime) {
    const hrs = Math.round((srcTime - buildTime) / 3600000);
    return {
      needsBuild: true,
      reason: `build is ${hrs >= 1 ? `~${hrs}h` : 'minutes'} older than your source`,
    };
  }
  return { needsBuild: false };
}

function runBuild() {
  return new Promise((done) => {
    const child = spawn(npx, ['next', 'build'], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pipe = (s) => s.on('data', (c) => {
      for (const line of c.toString().split('\n')) if (line.trim()) log('build', line);
    });
    pipe(child.stdout);
    pipe(child.stderr);
    child.on('exit', (code) => done(code === 0));
    child.on('error', () => done(false));
  });
}

// ── Supervised children ──────────────────────────────────────────────────
const children = new Map();
let shuttingDown = false;

function start(tag, command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, PORT, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) log(tag, line);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code, signal) => {
    children.delete(tag);
    if (shuttingDown) return;
    log('sys', `${tag} exited (${signal || code}) — restarting in 3s`);
    setTimeout(() => { if (!shuttingDown) start(tag, command, args); }, 3000);
  });

  children.set(tag, child);
  return child;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('sys', `${signal} — stopping…`);
  for (const [tag, child] of children) {
    try { child.kill('SIGTERM'); } catch {}
    log('sys', `stopped ${tag}`);
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Port preflight ───────────────────────────────────────────────────────
// If an OLD instance is still holding the port, `next start` cannot bind and
// the supervisor restarts it forever while the zombie keeps answering — from
// whatever build it was compiled with. Every layer looks healthy and the
// extension quietly reads stale data. Refuse to start in that situation.
async function preflightPort() {
  const expected = join(ROOT, '.data', 'tweets.json');
  let health;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/twitter-webhook`, {
      signal: AbortSignal.timeout(2500),
    });
    health = await res.json();
  } catch {
    return true; // nothing listening (or not ours yet) — safe to start
  }

  const servedPath = health?.store?.path;
  if (servedPath === expected) {
    log('sys', `⚠️  Port ${PORT} already has a healthy instance of THIS project.`);
    log('sys', '   Another `npm run local` is probably running in a different');
    log('sys', '   terminal. Close that one, or this will fight it for the port.');
  } else {
    log('sys', '═══════════════════════════════════════════════════════');
    log('sys', `✖ Port ${PORT} is held by a DIFFERENT server.`);
    log('sys', `   It serves store: ${servedPath || '(unknown / old build)'}`);
    log('sys', `   This project expects: ${expected}`);
    log('sys', '');
    log('sys', '   That is almost certainly a stale `next start` from an earlier');
    log('sys', '   run. It will keep answering the extension with OLD data while');
    log('sys', '   this instance fails to bind the port. Kill it first:');
    log('sys', '');
    log('sys', `     lsof -ti tcp:${PORT} | xargs kill -9`);
    log('sys', '');
    log('sys', '═══════════════════════════════════════════════════════');
  }
  return false;
}

// ── Boot ─────────────────────────────────────────────────────────────────
log('sys', '═══════════════════════════════════════════════════════');
log('sys', 'X Monitor — running fully local (no hosted services)');
log('sys', `Dashboard : http://127.0.0.1:${PORT}`);
log('sys', `Feed API  : http://127.0.0.1:${PORT}/api/tweets`);
log('sys', `Archive   : ${join(ROOT, '.data', 'tweets.json')}`);
log('sys', '═══════════════════════════════════════════════════════');

// The listener is independent of Next — start it first so no tweet is missed
// while a build runs.
start('stream', process.execPath, [join(ROOT, 'scripts', 'stream-listener.mjs')]);

const status = buildStatus();
let nextMode = 'start';

if (status.needsBuild) {
  log('sys', `⚠️  ${status.reason} — rebuilding before serving.`);
  log('sys', '   (Serving a stale build would return OLD data to the extension.)');
  const ok = await runBuild();
  if (ok) {
    log('sys', '✓ Build complete.');
  } else {
    nextMode = 'dev';
    log('sys', '✖ Build failed — falling back to `next dev`, which always');
    log('sys', '  compiles from current source. Fix the build when you can.');
  }
}

const portFree = await preflightPort();
if (!portFree) {
  log('sys', 'Not starting Next.js. The stream listener keeps running, so no');
  log('sys', 'tweets are lost — fix the port and restart when ready.');
} else {
  log('sys', `Starting Next.js in ${nextMode} mode on port ${PORT}…`);
  start('next', npx, ['next', nextMode, '--port', PORT]);
}
