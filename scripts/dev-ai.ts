#!/usr/bin/env tsx
/**
 * `npm run dev:ai`: the game with its AI, from one command.
 *
 * 1. Local storage for the AI server: DynamoDB Local (:8000) and MinIO
 *    (:9000), started with the server's `npm run infra:up` when either port
 *    is closed.
 * 2. The model provider named in the server's `.env`: for `openai-compat` on
 *    Ollama, the server's `scripts/ollama-dev.sh` (tuned settings, fast model
 *    warmed); for another OpenAI-compatible server, a reachability check; for
 *    `bedrock`, `aws sts get-caller-identity` on its `AWS_PROFILE`.
 * 3. The server's SDK workspace, which the server itself imports, built if its
 *    `dist/` is missing.
 * 4. The AI server (`npm run dev`, :3001) and the game (`npm run dev`, :3000)
 *    as child processes with prefixed output, waited on until both answer.
 *
 * Ctrl-C stops both. The server checkout is `$AI_SERVER_DIR`, by default
 * `../game-server-llm`.
 *
 *   npm run dev:ai
 *   npm run dev:ai -- --restart-ollama   replace a running Ollama with a tuned one
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_AI_SERVER_DIR = '../game-server-llm';
const SERVER_DIR = path.resolve(GAME_DIR, process.env.AI_SERVER_DIR ?? DEFAULT_AI_SERVER_DIR);

/** `server/index.ts` listens here; it is not configurable. */
const GAME_PORT = 3000;
const DEFAULT_AI_SERVER_PORT = 3001;
const DEFAULT_AI_SERVER_URL = `http://localhost:${DEFAULT_AI_SERVER_PORT}`;
const DEFAULT_HTTP_PORT = 80;
const DEFAULT_HTTPS_PORT = 443;
const DYNAMODB_PORT = 8000;
const MINIO_PORT = 9000;
const LOCALHOST = '127.0.0.1';
/** Ollama's own port: an OpenAI-compatible base URL on it is taken to be Ollama. */
const OLLAMA_PORT = 11434;

const PORT_PROBE_TIMEOUT_MS = 1_000;
/** A cold `tsx watch` plus the game's first build can take this long on a slow machine. */
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 500;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const PROVIDER_PROBE_TIMEOUT_MS = 5_000;
/** How long the children get to exit on Ctrl-C before they are killed outright. */
const STOP_GRACE_MS = 5_000;
const MS_PER_SECOND = 1000;
const EXIT_FAILURE = 1;
/** The exit code a shell reports for a process ended by Ctrl-C. */
const EXIT_INTERRUPTED = 130;

const RESTART_OLLAMA = process.argv.includes('--restart-ollama');

// ── output ──────────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
} as const;
type Color = Exclude<keyof typeof ANSI, 'reset'>;

function paint(color: Color, text: string): string {
  return USE_COLOR ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function ok(message: string): void {
  console.log(`${paint('green', '✓')} ${message}`);
}

function info(message: string): void {
  console.log(`${paint('dim', '…')} ${message}`);
}

function warn(message: string): void {
  console.log(`${paint('yellow', '!')} ${message}`);
}

class SetupError extends Error {}

function fail(message: string): never {
  throw new SetupError(message);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: LOCALHOST, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Runs a setup command with its output shown, failing the launch when it fails. */
function runStep(label: string, command: string, args: readonly string[], cwd: string): void {
  info(label);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error !== undefined) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? 'signal'})`);
}

/** Runs a check quietly; true when it exits 0. */
function succeeds(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

async function answers(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The server's settings: its `.env` over the defaults in its `.env.example`. */
function readServerEnv(): Record<string, string> {
  const read = (file: string): Record<string, string> => {
    const full = path.join(SERVER_DIR, file);
    return existsSync(full) ? dotenv.parse(readFileSync(full)) : {};
  };
  if (!existsSync(path.join(SERVER_DIR, '.env'))) {
    fail(`${path.join(SERVER_DIR, '.env')} is missing; run cp .env.example .env there first`);
  }
  return { ...read('.env.example'), ...read('.env') };
}

function readGameEnv(): Record<string, string> {
  const file = path.join(GAME_DIR, '.env');
  return existsSync(file) ? dotenv.parse(readFileSync(file)) : {};
}

/** An unset or empty value counts as absent, as it does in the server's own config. */
function setting(env: Record<string, string>, key: string, fallback: string): string {
  const value = env[key] ?? '';
  return value.length > 0 ? value : fallback;
}

// ── steps ───────────────────────────────────────────────────────────────────

function checkServerCheckout(): void {
  if (!existsSync(path.join(SERVER_DIR, 'package.json'))) {
    fail(
      `no AI server checkout at ${SERVER_DIR}; clone game-server-llm there or set AI_SERVER_DIR`,
    );
  }
  if (!existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    fail(`${SERVER_DIR} has no node_modules; run npm install && npm run setup there first`);
  }
}

async function ensureInfra(): Promise<void> {
  const [dynamo, minio] = await Promise.all([isPortOpen(DYNAMODB_PORT), isPortOpen(MINIO_PORT)]);
  if (dynamo && minio) {
    ok(`DynamoDB :${DYNAMODB_PORT} and MinIO :${MINIO_PORT} are up`);
    return;
  }
  if (!succeeds('docker', ['info'])) {
    fail('Docker is not running (DynamoDB Local and MinIO need it); start Docker Desktop');
  }
  runStep(
    'starting DynamoDB Local and MinIO (npm run infra:up)',
    'npm',
    ['run', 'infra:up'],
    SERVER_DIR,
  );
}

interface ProviderSummary {
  readonly name: string;
  readonly fast: string;
  readonly smart: string;
}

async function ensureProvider(env: Record<string, string>): Promise<ProviderSummary> {
  const provider = setting(env, 'LLM_PROVIDER', 'openai-compat');
  if (provider === 'bedrock') {
    const profile = setting(env, 'AWS_PROFILE', 'default');
    info(`checking AWS credentials (profile ${profile})`);
    if (!succeeds('aws', ['sts', 'get-caller-identity', '--profile', profile])) {
      fail(
        `aws sts get-caller-identity --profile ${profile} failed; run aws sso login --profile ${profile}`,
      );
    }
    ok(`AWS credentials for ${profile}`);
    const fast = setting(env, 'BEDROCK_MODEL_FAST', '(unset)');
    return { name: 'bedrock', fast, smart: setting(env, 'BEDROCK_MODEL_SMART', fast) };
  }
  if (provider !== 'openai-compat') fail(`unknown LLM_PROVIDER "${provider}" in the server .env`);

  const fast = setting(env, 'OPENAI_COMPAT_MODEL_FAST', '(unset)');
  const smart = setting(env, 'OPENAI_COMPAT_MODEL_SMART', fast);
  const baseUrl = setting(env, 'OPENAI_COMPAT_BASE_URL', `http://localhost:${OLLAMA_PORT}/v1`);
  const isOllama =
    setting(env, 'OPENAI_COMPAT_API', 'auto') === 'ollama' ||
    new URL(baseUrl).port === String(OLLAMA_PORT);
  if (isOllama) {
    const args = ['scripts/ollama-dev.sh', ...(RESTART_OLLAMA ? ['--restart'] : [])];
    runStep('starting Ollama with tuned settings', 'bash', args, SERVER_DIR);
    return { name: 'ollama', fast, smart };
  }
  const modelsUrl = `${baseUrl.replace(/\/+$/, '')}/models`;
  if (!(await answers(modelsUrl, PROVIDER_PROBE_TIMEOUT_MS))) {
    fail(`the OpenAI-compatible server at ${baseUrl} is not answering (${modelsUrl})`);
  }
  ok(`OpenAI-compatible server at ${baseUrl}`);
  return { name: 'openai-compat', fast, smart };
}

function ensureSdk(): void {
  if (existsSync(path.join(SERVER_DIR, 'packages', 'sdk', 'dist', 'index.js'))) {
    ok('SDK is built');
    return;
  }
  runStep('building the SDK (npm run build:sdk)', 'npm', ['run', 'build:sdk'], SERVER_DIR);
}

async function ensurePortsFree(ports: readonly number[]): Promise<void> {
  for (const port of ports) {
    if (await isPortOpen(port)) {
      fail(
        `port ${port} is already in use; stop what is on it (npm run kill -- ${port}) and retry`,
      );
    }
  }
}

/** The port a URL reaches, or null when it is not a URL at all. */
function portOf(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port !== '') return Number(parsed.port);
    return parsed.protocol === 'https:' ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT;
  } catch {
    return null;
  }
}

function checkGameEnv(serverPort: number): void {
  const env = readGameEnv();
  const gameAiUrl = setting(env, 'AI_SERVER_URL', DEFAULT_AI_SERVER_URL);
  const gameAiPort = portOf(gameAiUrl);
  if (gameAiPort !== serverPort) {
    warn(
      `AI_SERVER_URL in .env is ${gameAiUrl}, but the AI server's PORT is ${serverPort}: the game will look for the AI in the wrong place`,
    );
  }
  if (setting(env, 'AI_ENABLED', 'false') !== 'true') {
    warn('AI_ENABLED is not true in .env: the game will build without its AI');
  }
  const appId = setting(env, 'AI_APP_ID', '');
  if (appId.length === 0 || appId.startsWith('replace-with')) {
    warn('AI_APP_ID is not set in .env: player tokens will not be accepted (use kitten-crawler)');
  }
}

// ── child processes ─────────────────────────────────────────────────────────

interface Service {
  readonly label: string;
  readonly color: Color;
  readonly cwd: string;
  readonly healthUrl: string;
  child: ChildProcess | null;
  exited: boolean;
}

const LABEL_WIDTH = Math.max('ai'.length, 'game'.length);

function pipeWithPrefix(service: Service, stream: NodeJS.ReadableStream | null): void {
  if (stream === null) return;
  const prefix = paint(service.color, `[${service.label.padEnd(LABEL_WIDTH)}]`);
  createInterface({ input: stream }).on('line', (line) => {
    console.log(`${prefix} ${line}`);
  });
}

/** `onExit` hears every exit, during startup or after it; a child is only ever stopped on purpose by `stopAll`. */
function start(service: Service, onExit: () => void): void {
  // Its own process group, so stopping it reaches the watcher and the server under npm too.
  const child = spawn('npm', ['run', 'dev'], {
    cwd: service.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: USE_COLOR ? '1' : '0' },
  });
  service.child = child;
  pipeWithPrefix(service, child.stdout);
  pipeWithPrefix(service, child.stderr);
  child.once('exit', () => {
    service.exited = true;
    onExit();
  });
}

function signalGroup(service: Service, signal: NodeJS.Signals): void {
  const pid = service.child?.pid;
  if (pid === undefined || service.exited) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

async function stopAll(services: readonly Service[]): Promise<void> {
  for (const service of services) signalGroup(service, 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && services.some((service) => !service.exited)) {
    await sleep(HEALTH_POLL_MS);
  }
  for (const service of services) signalGroup(service, 'SIGKILL');
}

async function waitForHealth(services: readonly Service[]): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const pending = new Set(services);
  while (pending.size > 0) {
    for (const service of [...pending]) {
      if (service.exited) fail(`the ${service.label} process exited during startup`);
      if (await answers(service.healthUrl, HEALTH_REQUEST_TIMEOUT_MS)) pending.delete(service);
    }
    if (pending.size === 0) return;
    if (Date.now() > deadline) {
      const names = [...pending].map((service) => service.label).join(' and ');
      fail(`${names} did not answer within ${HEALTH_TIMEOUT_MS / MS_PER_SECOND}s`);
    }
    await sleep(HEALTH_POLL_MS);
  }
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  checkServerCheckout();
  const serverEnv = readServerEnv();
  const serverPort = Number(setting(serverEnv, 'PORT', String(DEFAULT_AI_SERVER_PORT)));
  const serverUrl = `http://localhost:${serverPort}`;
  const gameUrl = `http://localhost:${GAME_PORT}`;

  await ensureInfra();
  const provider = await ensureProvider(serverEnv);
  ensureSdk();
  checkGameEnv(serverPort);
  await ensurePortsFree([serverPort, GAME_PORT]);

  const services: Service[] = [
    {
      label: 'ai',
      color: 'cyan',
      cwd: SERVER_DIR,
      healthUrl: `${serverUrl}/.well-known/jwks.json`,
      child: null,
      exited: false,
    },
    {
      label: 'game',
      color: 'magenta',
      cwd: GAME_DIR,
      healthUrl: `${gameUrl}/.well-known/jwks.json`,
      child: null,
      exited: false,
    },
  ];

  let stopping = false;
  const shutdown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${paint('dim', '… stopping the AI server and the game')}`);
    await stopAll(services);
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(EXIT_INTERRUPTED));
  process.on('SIGTERM', () => void shutdown(0));
  // Closing the terminal window sends SIGHUP; the detached children would otherwise outlive it.
  process.on('SIGHUP', () => void shutdown(0));

  info(`starting the AI server (${SERVER_DIR}) and the game`);
  for (const service of services) {
    start(service, () => {
      if (stopping) return;
      console.error(`${paint('red', '✗')} the ${service.label} process exited; stopping`);
      void shutdown(EXIT_FAILURE);
    });
  }
  try {
    await waitForHealth(services);
  } catch (error) {
    console.error(`${paint('red', '✗')} ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(EXIT_FAILURE);
    return;
  }

  const models = `fast: ${provider.fast}, smart: ${provider.smart}`;
  console.log('');
  console.log(`  ${paint('bold', 'Game')}        → ${gameUrl}`);
  console.log(`  ${paint('bold', 'Console')}     → ${serverUrl}/console`);
  console.log(
    `  ${paint('bold', 'AI provider')} → ${provider.name} (${models}) ${paint('green', '✓')}`,
  );
  console.log(
    paint('dim', `  Record an AI replay: ${gameUrl}/?ai-record, then F8. Ctrl-C stops everything.`),
  );
  console.log('');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${paint('red', '✗')} ${message}`);
  process.exit(EXIT_FAILURE);
});
