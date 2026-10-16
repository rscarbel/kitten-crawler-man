/**
 * Runs one verify or gates script and prints one line when it passes, or the
 * failing lines and the end of its output when it does not. The full output
 * always lands in `.gate-logs/<name>.log`. `GATE_VERBOSE=1` streams it live.
 *
 *   tsx scripts/gate.ts [--name=<label>] <command> [args…]
 *
 * The label defaults to the npm script being run. Anything npm appends after
 * `--` reaches the wrapped command untouched.
 */
import { runTask, summarize, verboseRequested } from './gateRunner.js';

const NAME_FLAG = '--name=';
const USAGE_EXIT_CODE = 2;

const argv = process.argv.slice(2);
const commandStart = argv.findIndex((arg) => !arg.startsWith('--'));
const ownFlags = commandStart === -1 ? argv : argv.slice(0, commandStart);
const command = commandStart === -1 ? [] : argv.slice(commandStart);

const nameFlag = ownFlags.find((flag) => flag.startsWith(NAME_FLAG));
const name =
  nameFlag?.slice(NAME_FLAG.length) ?? process.env.npm_lifecycle_event ?? command.join(' ');

if (command.length === 0) {
  console.error('usage: tsx scripts/gate.ts [--name=<label>] <command> [args…]');
  process.exit(USAGE_EXIT_CODE);
}

const result = await runTask(name, command, { stream: verboseRequested() });
console.log(summarize(result));
process.exitCode = result.exitCode;
