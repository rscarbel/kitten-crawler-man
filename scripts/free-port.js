/**
 * Clears out this project's dev processes: whatever is listening on the game
 * server port, plus any stale `npm run dev` / build trees left running from a
 * previous session. Suspended processes are woken before being signalled, since
 * a stopped process holds its socket but never handles SIGTERM.
 *
 * Usage: npm run kill           (defaults to the game server's port 3000)
 *        npm run kill -- 8080   (esbuild's `npm run serve` port)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 3000;
const TERM_GRACE_MS = 2000;
const POLL_INTERVAL_MS = 100;

/** Command lines that identify a dev process belonging to this project. */
const DEV_PROCESS_PATTERNS = [
  /\bnpm\b.*\brun\b\s+(dev|serve|server|build)\b/,
  /\bscripts\/build(-zip)?\.js\b/,
  /\bserver\/index\.ts\b/,
  /\btsx\b.*\bserver\//,
];

const portArg = process.argv[2];
const port = portArg === undefined ? DEFAULT_PORT : Number(portArg);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Not a valid port: ${portArg}`);
  process.exit(1);
}

function listenerPids() {
  try {
    const out = execFileSync('lsof', ['-t', `-i:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    return parsePidList(out);
  } catch {
    // lsof exits non-zero when nothing matches, which is not an error here.
    return [];
  }
}

function parsePidList(text) {
  return text
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function processTable() {
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  const rows = new Map();
  for (const line of out.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match === null) continue;
    const [, pid, ppid, cmd] = match;
    rows.set(Number(pid), { ppid: Number(ppid), cmd });
  }
  return rows;
}

function workingDirectory(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * Walks up from this script through its npm wrapper shells so the sweep never
 * kills the very command the user just ran.
 */
function selfAndAncestors(table) {
  const chain = new Set();
  let pid = process.pid;
  while (pid > 1 && !chain.has(pid)) {
    chain.add(pid);
    const row = table.get(pid);
    if (row === undefined) break;
    pid = row.ppid;
  }
  return chain;
}

function staleProjectPids() {
  const table = processTable();
  const protectedPids = selfAndAncestors(table);
  const stale = [];

  for (const [pid, { cmd }] of table) {
    if (protectedPids.has(pid)) continue;
    if (!DEV_PROCESS_PATTERNS.some((pattern) => pattern.test(cmd))) continue;

    // A command line alone can match another checkout of the same scripts, so
    // the process must also be rooted in this project directory.
    const cwd = workingDirectory(pid);
    const belongsToProject =
      cwd === null
        ? cmd.includes(PROJECT_ROOT)
        : cwd === PROJECT_ROOT || cwd.startsWith(`${PROJECT_ROOT}/`);
    if (!belongsToProject) continue;

    stale.push(pid);
  }

  return stale;
}

function describe(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '(unknown)';
  }
}

function signal(pid, sig) {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid) {
  return signal(pid, 0);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const listeners = listenerPids();
const stale = staleProjectPids().filter((pid) => !listeners.includes(pid));
const targets = [...listeners, ...stale];

if (targets.length === 0) {
  console.log(`Port ${port} is free and no stale project processes are running.`);
  process.exit(0);
}

for (const pid of listeners) {
  console.log(`Killing pid ${pid} on port ${port}: ${describe(pid)}`);
}
for (const pid of stale) {
  console.log(`Killing stale pid ${pid}: ${describe(pid)}`);
}

for (const pid of targets) {
  // A suspended process never handles SIGTERM, so wake it up first.
  signal(pid, 'SIGCONT');
  signal(pid, 'SIGTERM');
}

let waited = 0;
while (waited < TERM_GRACE_MS && targets.some(isAlive)) {
  sleepSync(POLL_INTERVAL_MS);
  waited += POLL_INTERVAL_MS;
}

const survivors = targets.filter(isAlive);
for (const pid of survivors) {
  console.log(`pid ${pid} ignored SIGTERM, sending SIGKILL`);
  signal(pid, 'SIGKILL');
}

if (survivors.length > 0) {
  sleepSync(POLL_INTERVAL_MS * 2);
}

const stillRunning = targets.filter(isAlive);
const stillListening = listenerPids();

if (stillListening.length > 0) {
  console.error(`Port ${port} is still in use by ${stillListening.join(', ')}.`);
  process.exit(1);
}

if (stillRunning.length > 0) {
  console.error(`Could not kill: ${stillRunning.join(', ')}.`);
  process.exit(1);
}

console.log(`Port ${port} is free. Killed ${targets.length} process(es).`);
