/**
 * Runs only the `verify:*` and `gates:*` scripts whose code depends on the
 * files that changed. Each gate's dependencies are its real import graph,
 * traced by esbuild from the script's entry file, so there is no mapping table
 * to keep up to date.
 *
 *   npm run verify:affected                       files changed vs HEAD, plus untracked
 *   npm run verify:affected -- src/a.ts src/b.ts  exactly these files
 *   npm run verify:affected -- --base=<ref>       files changed since <ref>
 *   npm run verify:affected -- --list             print the selection, run nothing
 *   npm run verify:affected -- --slow             include the multi-minute sweeps
 *   npm run verify:affected -- --all              every gate, whatever changed
 *
 * Gates are run longest-first (by their last recorded time on this machine)
 * across half the CPU cores, each printing its one-line `gate.ts` summary.
 * Files read at runtime rather than imported (images, audio, JSON loaded from
 * disk) are not in any import graph; `RUNTIME_ASSET_GATES` covers those.
 */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { CHILD_BUDGET_ENV } from './childUnits.js';
import { relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { lastDuration } from './gateRunner.js';

const MS_PER_SECOND = 1000;
const CPU_SHARE_FOR_GATES = 2;
const BYTES_PER_MEBIBYTE = 1_048_576;
const GIT_OUTPUT_MEBIBYTES = 64;
const MAX_BUFFER_BYTES = GIT_OUTPUT_MEBIBYTES * BYTES_PER_MEBIBYTE;

/** Sweeps that take minutes; they run only with `--slow` or by name. */
const SLOW_GATES: ReadonlySet<string> = new Set([
  'verify:floor-sweep',
  'verify:town-soak',
  'verify:plaza-perf',
  'verify:residency',
  'verify:town-residency',
]);

/** Gates that read a changed file from disk instead of importing it. */
const RUNTIME_ASSET_GATES: readonly { prefix: string; gates: readonly string[] }[] = [
  { prefix: 'src/images/', gates: ['verify:assets', 'verify:item-icons'] },
  { prefix: 'src/audio/', gates: ['verify:audio'] },
];

const SCRIPT_FILE = /scripts\/[\w./-]+\.ts/g;
const WRAPPER_SCRIPT = 'scripts/gate.ts';
const SELF_SCRIPT = 'verify:affected';
const ASSET_EXTENSIONS = ['.png', '.jpg', '.webp', '.mp3', '.ogg', '.wav', '.json', '.svg', '.ttf'];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const baseRef = args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length);
const explicitFiles = args.filter((arg) => !arg.startsWith('--'));

const git = (...gitArgs: string[]) =>
  execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES })
    .split('\n')
    .filter((line) => line !== '');

function changedFiles(): string[] {
  if (explicitFiles.length > 0) return explicitFiles.map((file) => relative('.', resolve(file)));
  if (baseRef !== undefined) return git('diff', '--name-only', `${baseRef}...HEAD`);
  return [
    ...git('diff', '--name-only', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard'),
  ];
}

function gateEntries(): Map<string, string[]> {
  const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
  const scripts =
    typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
      ? manifest.scripts
      : undefined;
  if (typeof scripts !== 'object' || scripts === null)
    throw new Error('package.json has no scripts');
  const entries = new Map<string, string[]>();
  for (const [name, command] of Object.entries(scripts)) {
    if (!/^(verify|gates):/.test(name) || name === SELF_SCRIPT || typeof command !== 'string')
      continue;
    const files = [...command.matchAll(SCRIPT_FILE)]
      .map((match) => match[0])
      .filter((file) => file !== WRAPPER_SCRIPT);
    if (files.length > 0) entries.set(name, files);
  }
  return entries;
}

/** Each entry script's transitive source files, as repo-relative paths. */
async function importGraphs(entryFiles: readonly string[]): Promise<Map<string, Set<string>>> {
  const result = await build({
    entryPoints: [...entryFiles],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outdir: 'node_modules/.cache/verify-affected',
    outbase: '.',
    logLevel: 'silent',
    loader: Object.fromEntries(ASSET_EXTENSIONS.map((extension) => [extension, 'empty'])),
  });
  const graphs = new Map<string, Set<string>>();
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.entryPoint === undefined) continue;
    graphs.set(output.entryPoint, new Set(Object.keys(output.inputs)));
  }
  return graphs;
}

function runGate(name: string): Promise<{ name: string; ok: boolean; text: string }> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    const child = spawn('npm', ['run', '-s', name], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, [CHILD_BUDGET_ENV]: String(childBudgetPerGate) },
    });
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', (code) => {
      done({ name, ok: code === 0, text: Buffer.concat(chunks).toString('utf8').trimEnd() });
    });
  });
}

const gateWorkers = Math.max(1, Math.floor(availableParallelism() / CPU_SHARE_FOR_GATES));
/**
 * How many children a gate that splits its work may run at once while others
 * run beside it: enough that every gate worker's children together fill the
 * cores once, not once per gate.
 */
const childBudgetPerGate = Math.max(1, Math.floor(availableParallelism() / gateWorkers));

async function runAll(names: readonly string[]) {
  const queue = [...names].sort((a, b) => (lastDuration(b) ?? 0) - (lastDuration(a) ?? 0));
  const workers = gateWorkers;
  const failed: string[] = [];
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const result = await runGate(name);
      console.log(result.text === '' ? `${result.ok ? '✓' : '✗'} ${name}` : result.text);
      if (!result.ok) failed.push(name);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return failed;
}

const started = Date.now();
const changed = changedFiles();
const entries = gateEntries();
const allEntryFiles = [...new Set([...entries.values()].flat())];
const graphs = await importGraphs(allEntryFiles);

const changedSet = new Set(changed);
const selected = new Set<string>();
for (const [name, files] of entries) {
  const touched = files.some((file) => {
    const graph = graphs.get(file);
    return graph !== undefined && [...graph].some((input) => changedSet.has(input));
  });
  if (touched || flag('all')) selected.add(name);
}
for (const { prefix, gates } of RUNTIME_ASSET_GATES) {
  if (changed.some((file) => file.startsWith(prefix))) for (const gate of gates) selected.add(gate);
}

const skippedSlow = [...selected].filter((name) => SLOW_GATES.has(name) && !flag('slow'));
const toRun = [...selected]
  .filter((name) => !skippedSlow.includes(name) && entries.has(name))
  .sort();

console.log(
  `${changed.length} changed file(s) → ${toRun.length} gate(s)` +
    (skippedSlow.length > 0 ? `; slow, skipped without --slow: ${skippedSlow.join(', ')}` : ''),
);
if (flag('list') || toRun.length === 0) {
  if (toRun.length > 0) console.log(toRun.join('\n'));
  process.exit(0);
}

const failed = await runAll(toRun);
const elapsed = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
if (failed.length === 0) {
  console.log(`verify:affected passed ${toRun.length} gate(s) in ${elapsed}s`);
} else {
  console.log(
    `verify:affected FAILED ${failed.length}/${toRun.length} in ${elapsed}s: ${failed.join(', ')}`,
  );
  process.exitCode = 1;
}
