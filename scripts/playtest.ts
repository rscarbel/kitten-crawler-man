/**
 * Opens the game at a named playtest preset — a floor, a spawn landmark and a
 * fully kitted party — so a change can be exercised where it matters without
 * replaying the floors above it.
 *
 * Usage: npm run playtest --spider      (npm turns this into a config flag)
 *        npm run playtest -- spider     (plain argument, same result)
 *        npm run playtest               (lists the presets and exits)
 *
 * A preset that reads flags takes them either way:
 *        npm run playtest -- briar-hollow-assault --walls=fortified --trebuchets=4
 *        npm run playtest --briar-hollow-assault --walls=wood
 * `--walls` is fence, wood, stone or fortified (or 1–4 in that order);
 * `--trebuchets` is how many loaded engines stand inside the ring.
 *
 * Presets live in src/dev/playtestPresets.ts; the browser side of the handoff is
 * `?playtest=<id>` in src/game.ts.
 */

import { execFileSync, spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAYTEST_PRESETS } from '../src/dev/playtestPresets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** The Express dev server's port — see server/index.ts. */
const SERVER_PORT = 3000;
/** How long to wait for the server to start listening before giving up. */
const SERVER_START_TIMEOUT_MS = 20_000;
const SERVER_POLL_INTERVAL_MS = 150;

const PRESET_IDS = PLAYTEST_PRESETS.map((preset) => preset.id);

function usage(): string {
  const rows = PLAYTEST_PRESETS.map((preset) => `  ${preset.id.padEnd(10)} ${preset.description}`);
  return [
    'Usage: npm run playtest --<id>   (or: npm run playtest -- <id>)',
    '',
    'Presets:',
    ...rows,
  ].join('\n');
}

/**
 * The requested preset id.
 *
 * `npm run playtest --spider` never reaches argv: npm reads an unknown `--flag`
 * as one of its own config settings and exports it as `npm_config_spider=true`.
 * That form is the one the workflow is built around, so both it and a plain
 * argument have to be understood.
 */
function requestedPresetId(): string | null {
  const fromArgs = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  if (fromArgs !== undefined) return fromArgs;

  for (const id of PRESET_IDS) {
    // npm writes a dashed flag's name with underscores: `--briar-hollow-assault`
    // arrives as `npm_config_briar_hollow_assault`.
    const underscored = id.replace(/-/g, '_');
    if (process.env[`npm_config_${id}`] !== undefined) return id;
    if (process.env[`npm_config_${underscored}`] !== undefined) return id;
  }
  return null;
}

/** The flags a preset may read, handed on to the browser as query parameters of the same name. */
const PRESET_FLAGS = ['walls', 'trebuchets'] as const;

/**
 * `--name=value` from the arguments, or npm's `npm_config_name` when the flag
 * was given before the `--` and npm took it as one of its own settings.
 */
function flagValue(name: string): string | null {
  const prefix = `--${name}=`;
  const fromArgs = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (fromArgs !== undefined) return fromArgs.slice(prefix.length);
  return process.env[`npm_config_${name}`] ?? null;
}

/** The preset flags that were given, as a query string to append (`&walls=stone`), or ''. */
function flagQuery(): string {
  const parts: string[] = [];
  for (const name of PRESET_FLAGS) {
    const value = flagValue(name);
    if (value !== null) parts.push(`&${name}=${encodeURIComponent(value)}`);
  }
  return parts.join('');
}

function portIsInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await portIsInUse(SERVER_PORT)) return true;
    await delay(SERVER_POLL_INTERVAL_MS);
  }
  return false;
}

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] };
  try {
    execFileSync(opener.command, opener.args, { stdio: 'ignore' });
  } catch {
    console.log(`Could not open a browser automatically — go to ${url}`);
  }
}

async function main(): Promise<void> {
  const presetId = requestedPresetId();
  if (presetId === null) {
    console.log(usage());
    process.exit(1);
  }
  if (!PRESET_IDS.includes(presetId)) {
    console.error(`Unknown playtest preset: "${presetId}"\n\n${usage()}`);
    process.exit(1);
  }

  if (await portIsInUse(SERVER_PORT)) {
    console.error(
      `Port ${SERVER_PORT} is already in use. Run \`npm run kill\` first, so the ` +
        `browser gets this build rather than whatever is already serving.`,
    );
    process.exit(1);
  }

  console.log('Building...');
  execFileSync('node', ['scripts/build.js', '--dev-boot'], { cwd: PROJECT_ROOT, stdio: 'inherit' });

  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  const stopServer = () => server.kill('SIGTERM');
  process.on('SIGINT', stopServer);
  process.on('SIGTERM', stopServer);
  server.on('exit', (code) => process.exit(code ?? 0));

  if (!(await waitForServer())) {
    console.error(`Server did not start listening on port ${SERVER_PORT}.`);
    stopServer();
    process.exit(1);
  }

  const url = `http://localhost:${SERVER_PORT}/?playtest=${presetId}${flagQuery()}`;
  console.log(`Playtesting "${presetId}" — ${url}`);
  openBrowser(url);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
