/**
 * The validation gates in one command: format, typecheck (game and scripts),
 * lint, `check:ui-style` and `check:audio`, run in parallel after formatting,
 * one line each when they pass.
 *
 *   npm run check        the inner loop: cached lint, cached format, and the
 *                        native TypeScript compiler when it is installed
 *   npm run check:full   the sign-off: stable `tsc` and an uncached lint
 *   npm run check:ci     as `check:full`, but verifies formatting instead of
 *                        writing it
 *
 * The cached lint only re-lints files whose content changed, so a type change
 * in one file that breaks a type-aware rule in an untouched file is missed
 * until `check:full` runs; that is why the full run exists.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runTask, summarize, type TaskResult } from './gateRunner.js';

type Mode = 'fast' | 'full' | 'ci';

const MS_PER_SECOND = 1000;
const BIN = join('node_modules', '.bin');
const CACHE = join('node_modules', '.cache');
const ESLINT_CACHE_DIR = join(CACHE, 'eslint') + '/';
const TSC_CACHE_DIR = join(CACHE, 'tsc');
const NATIVE_TSC = join(BIN, 'tsgo');

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
const mode: Mode = modeArg === 'full' || modeArg === 'ci' ? modeArg : 'fast';
const useNativeCompiler = mode === 'fast' && existsSync(NATIVE_TSC);

const bin = (tool: string) => join(BIN, tool);

function formatCommand(): string[] {
  const base = [bin('prettier'), '--ignore-unknown'];
  if (mode === 'ci') return [...base, '--check', '.'];
  return [...base, '--write', '--cache', '--cache-strategy', 'content', '--log-level', 'warn', '.'];
}

function typecheckCommand(project: string, cacheName: string): string[] {
  if (useNativeCompiler) return [NATIVE_TSC, '--noEmit', '-p', project];
  if (mode === 'fast') {
    const buildInfo = join(TSC_CACHE_DIR, `${cacheName}.tsbuildinfo`);
    return [bin('tsc'), '--noEmit', '-p', project, '--incremental', '--tsBuildInfoFile', buildInfo];
  }
  return [bin('tsc'), '--noEmit', '-p', project];
}

function lintCommand(): string[] {
  if (mode !== 'fast') rmSync(ESLINT_CACHE_DIR, { recursive: true, force: true });
  return [
    bin('eslint'),
    '--cache',
    '--cache-strategy',
    'content',
    '--cache-location',
    ESLINT_CACHE_DIR,
    'src',
  ];
}

const started = Date.now();
const results: TaskResult[] = [];

const format = await runTask('format', formatCommand());
console.log(summarize(format));
results.push(format);

const compilerLabel = useNativeCompiler ? 'tsgo' : 'tsc';
const parallel = await Promise.all([
  runTask(`typecheck:src (${compilerLabel})`, typecheckCommand('tsconfig.json', 'src')),
  runTask(
    `typecheck:scripts (${compilerLabel})`,
    typecheckCommand('tsconfig.scripts.json', 'scripts'),
  ),
  runTask(mode === 'fast' ? 'lint (cached)' : 'lint', lintCommand()),
  runTask('check:ui-style', [bin('tsx'), 'scripts/check-ui-style.ts', '--strict']),
  runTask('check:audio', [bin('tsx'), 'scripts/check-audio.ts']),
]);
for (const result of parallel) console.log(summarize(result));
results.push(...parallel);

const failed = results.filter((result) => !result.ok).map((result) => result.name);
const elapsed = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
if (failed.length === 0) {
  console.log(`check ${mode} passed in ${elapsed}s`);
} else {
  console.log(`check ${mode} FAILED in ${elapsed}s: ${failed.join(', ')}`);
  process.exitCode = 1;
}
