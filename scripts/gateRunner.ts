import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where every gate run leaves its complete output. A passing run prints one
 * line, so this file is the only place the detail survives; a failing run
 * points at it so an agent can read more without re-running a slow suite.
 */
export const GATE_LOG_DIR = '.gate-logs';
const DURATION_DIR = join('node_modules', '.cache', 'gates', 'durations');

const MS_PER_SECOND = 1000;
const FAILURE_EXCERPT_MAX_LINES = 80;
const FAILURE_TAIL_LINES = 25;
const SUSPICIOUS_PASS_MAX_LINES = 10;
const EXIT_CODE_FROM_SIGNAL = 1;

/**
 * Lines worth keeping from a failed run's output. Several gates only summarise
 * as "N failure(s)" or "N level(s) failed", so this is broader than the pass
 * check below.
 */
const FAILURE_MARKER =
  /\bFAIL|\bMISSED\b|\bERROR\b|\b\w*Error\b|error TS\d+|^\s*\d+:\d+\s+error\b|[✗✘❌]|\bfailures?\b|\bfailed\b|\bTHREW\b/;
/**
 * A line that means a check failed. Seen in a run that exited 0, it means the
 * script reported a failure without turning it into an exit code. Kept to the
 * explicit markers because passing gates print "0 failures" and the like.
 */
const DEFINITE_FAILURE_MARKER = /\bFAIL|\bMISSED\b|[✗✘❌]/;
const ANSI_ESCAPE = new RegExp('\\u001b\\[[0-9;]*m', 'g');

export interface TaskResult {
  name: string;
  ok: boolean;
  exitCode: number;
  ms: number;
  output: string;
  logPath: string;
}

export interface RunTaskOptions {
  /** Mirrors the child's output live as well as capturing it. */
  stream?: boolean;
  env?: NodeJS.ProcessEnv;
}

const logFileName = (name: string) => `${name.replace(/[^\w.-]+/g, '-')}.log`;
const durationFile = (name: string) => join(DURATION_DIR, `${logFileName(name)}.ms`);

/** Runs one command to completion, capturing stdout and stderr together. */
export function runTask(
  name: string,
  command: readonly string[],
  options: RunTaskOptions = {},
): Promise<TaskResult> {
  if (command.length === 0) throw new Error(`gate ${name}: empty command`);
  const [program, ...args] = command;
  mkdirSync(GATE_LOG_DIR, { recursive: true });
  const logPath = join(GATE_LOG_DIR, logFileName(name));
  const started = Date.now();
  const chunks: Buffer[] = [];

  return new Promise((resolve) => {
    const child = spawn(program, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...options.env },
    });
    const collect = (chunk: Buffer) => {
      chunks.push(chunk);
      if (options.stream === true) process.stdout.write(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (exitCode: number, extra = '') => {
      const output = Buffer.concat(chunks).toString('utf8').replace(ANSI_ESCAPE, '') + extra;
      const ms = Date.now() - started;
      writeFileSync(logPath, output);
      recordDuration(name, ms);
      resolve({ name, ok: exitCode === 0, exitCode, ms, output, logPath });
    };
    child.on('error', (error) => {
      finish(EXIT_CODE_FROM_SIGNAL, `\n${error.message}\n`);
    });
    child.on('close', (code, signal) => {
      finish(code ?? EXIT_CODE_FROM_SIGNAL, signal === null ? '' : `\nkilled by ${signal}\n`);
    });
  });
}

function recordDuration(name: string, ms: number) {
  try {
    mkdirSync(DURATION_DIR, { recursive: true });
    writeFileSync(durationFile(name), String(ms));
  } catch {
    // A missing timing only costs scheduling order, never a result.
  }
}

/** The last recorded wall time of a gate, or `undefined` if it has never run here. */
export function lastDuration(name: string): number | undefined {
  try {
    const ms = Number(readFileSync(durationFile(name), 'utf8'));
    return Number.isFinite(ms) ? ms : undefined;
  } catch {
    return undefined;
  }
}

const seconds = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)}s`;

function failureExcerpt(output: string): string[] {
  const lines = output.split('\n');
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  if (lines.length <= FAILURE_EXCERPT_MAX_LINES) return lines;

  const tailStart = lines.length - FAILURE_TAIL_LINES;
  const markerBudget = FAILURE_EXCERPT_MAX_LINES - FAILURE_TAIL_LINES;
  const markerLines = lines
    .slice(0, tailStart)
    .filter((line) => FAILURE_MARKER.test(line))
    .slice(0, markerBudget);
  const omitted = tailStart - markerLines.length;
  return [...markerLines, `  … ${omitted} more lines in the log …`, ...lines.slice(tailStart)];
}

/**
 * One line for a pass; the failing lines plus the end of the output for a
 * failure. A pass that printed failure markers is flagged, because a gate that
 * reports a broken check yet exits 0 would otherwise vanish behind the
 * one-line summary.
 */
export function summarize(result: TaskResult): string {
  const header = `${result.ok ? '✓' : '✗'} ${result.name} (${seconds(result.ms)})`;
  if (result.ok) {
    const suspicious = result.output
      .split('\n')
      .filter((line) => DEFINITE_FAILURE_MARKER.test(line))
      .slice(0, SUSPICIOUS_PASS_MAX_LINES);
    if (suspicious.length === 0) return header;
    return [
      `${header} — exited 0 but printed failure markers; read ${result.logPath}`,
      ...suspicious.map((line) => `    ${line}`),
    ].join('\n');
  }
  return [
    `${header} — exit ${result.exitCode}; full log: ${result.logPath}`,
    ...failureExcerpt(result.output).map((line) => `    ${line}`),
  ].join('\n');
}

/** Whether a gate should mirror its child's full output, set by `GATE_VERBOSE=1`. */
export const verboseRequested = () => process.env.GATE_VERBOSE === '1';
