/**
 * Runs a gate's independent units of work in child processes of the gate's
 * own script, a few at a time, so a gate whose units share nothing finishes in
 * the time of its largest few rather than the sum of them all.
 *
 * Each child is the same script, started with the arguments its unit is given
 * (`--unit=<id>` by default); it does that one unit and may hand back a result
 * by printing it with {@link printUnitResult}.
 * A child's output is held until it exits and then printed whole, so units
 * running side by side never interleave their lines.
 */

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const UNIT_FLAG = '--unit=';
const UNIT_RESULT_PREFIX = 'UNIT_RESULT ';
/**
 * The share of the cores a gate run on its own gives its children: half, so
 * the machine stays as usable as it is during a `verify:affected` run.
 */
const CPU_SHARE = 2;

/**
 * The environment variable a runner of several gates sets to cap how many
 * children each gate may run at once. `verify:affected` already runs gates
 * side by side, and every gate taking its standalone share as well would put
 * several heavy processes on each core.
 */
export const CHILD_BUDGET_ENV = 'GATE_CHILD_BUDGET';

/** The cap {@link CHILD_BUDGET_ENV} sets, or null when it is unset or not a positive count. */
function childBudget(): number | null {
  const raw = process.env[CHILD_BUDGET_ENV];
  if (raw === undefined) return null;
  const budget = Number.parseInt(raw, 10);
  return Number.isInteger(budget) && budget > 0 ? budget : null;
}

/** One child's run: how it exited and the result it printed, if any. */
export interface ChildUnitRun {
  readonly id: string;
  readonly exitCode: number;
  /** The parsed JSON the child printed with {@link printUnitResult}; undefined when it printed none. */
  readonly result: unknown;
}

/** The unit this process was started to run, or null for the parent run. */
export function unitArgument(argv: readonly string[] = process.argv): string | null {
  return argv.find((arg) => arg.startsWith(UNIT_FLAG))?.slice(UNIT_FLAG.length) ?? null;
}

/** Hands a unit's result back to the parent. Call once, from the child. */
export function printUnitResult(result: unknown): void {
  console.log(`${UNIT_RESULT_PREFIX}${JSON.stringify(result)}`);
}

function runChild(script: string, id: string, args: readonly string[]): Promise<ChildUnitRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Kept apart: a stderr write landing inside the result line would split it.
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('close', (code) => {
      let result: unknown = undefined;
      let unreadable = false;
      const shown: string[] = [];
      for (const line of Buffer.concat(stdout).toString('utf8').split('\n')) {
        if (!line.startsWith(UNIT_RESULT_PREFIX)) {
          shown.push(line);
          continue;
        }
        try {
          result = JSON.parse(line.slice(UNIT_RESULT_PREFIX.length));
        } catch {
          unreadable = true;
          shown.push(`unit ${id} printed a result that is not JSON: ${line}`);
        }
      }
      shown.push(Buffer.concat(stderr).toString('utf8'));
      const output = shown.join('\n').trimEnd();
      if (output !== '') console.log(output);
      const exitCode = code ?? 1;
      resolve(
        unreadable
          ? { id, exitCode: exitCode === 0 ? 1 : exitCode, result: undefined }
          : { id, exitCode, result },
      );
    });
  });
}

/** The arguments a child gets by default: the unit {@link unitArgument} reads, and `shared`. */
export function unitArguments(shared: readonly string[] = []): (id: string) => string[] {
  return (id) => [`${UNIT_FLAG}${id}`, ...shared];
}

/**
 * Runs every unit of `ids` in a child of `script` started with `argsFor(id)`,
 * at most half the machine's cores at a time (or the {@link CHILD_BUDGET_ENV}
 * cap, if lower), in the order given: list the
 * longest first, so the last to finish is a short one. The runs come back in
 * that order too, whichever finished first.
 */
export async function runUnitsInChildren(
  script: string,
  ids: readonly string[],
  argsFor: (id: string) => readonly string[] = unitArguments(),
): Promise<ReadonlyMap<string, ChildUnitRun>> {
  const runs = new Map<string, ChildUnitRun>();
  const ownShare = Math.floor(availableParallelism() / CPU_SHARE);
  const workers = Math.max(1, Math.min(ids.length, ownShare, childBudget() ?? ownShare));
  let next = 0;
  const work = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next];
      next++;
      runs.set(id, await runChild(script, id, argsFor(id)));
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  return new Map(
    ids.flatMap((id) => {
      const run = runs.get(id);
      return run === undefined ? [] : [[id, run] as const];
    }),
  );
}
