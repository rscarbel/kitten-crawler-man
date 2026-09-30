#!/usr/bin/env tsx
/**
 * Headless gate on the difficulty-change guard: a guarded pick in the Settings
 * tab waits for the restart confirmation, and an unguarded one applies at once.
 *
 * Run: npm run verify:difficulty-guard
 *      npm run verify:difficulty-guard -- --fault=unguarded-difficulty   (must fail)
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';

const FAULT_FLAG = '--fault=';
const KNOWN_FAULT = 'unguarded-difficulty';

installCanvasGlobals();
installSilentAudioGlobals();

/**
 * Just enough Web Audio and DOM for `AudioManager` to be constructed: the pause
 * menu only draws its Settings tab when it holds a real one. Nothing here makes
 * a sound; every buffer stays unloaded, so `play` returns without output.
 */
function installSilentAudioGlobals(): void {
  const ignore = (): void => {
    return;
  };
  const silentNode = { connect: ignore, disconnect: ignore };
  class SilentAudioContext {
    readonly state = 'suspended';
    readonly currentTime = 0;
    readonly destination = silentNode;
    createGain() {
      return { ...silentNode, gain: { value: 0 } };
    }
    createMediaElementSource() {
      return silentNode;
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
  }
  class SilentAudio {
    src = '';
    loop = false;
    volume = 1;
    pause = ignore;
    play(): Promise<void> {
      return Promise.resolve();
    }
  }
  const eventTarget = { addEventListener: ignore, removeEventListener: ignore };
  const globals: AudioShimGlobals = globalThis;
  globals.AudioContext = SilentAudioContext;
  globals.Audio = SilentAudio;
  globals.document = {
    ...eventTarget,
    hidden: false,
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`difficulty guard check cannot create <${tag}>`);
      return createCanvas(1, 1);
    },
  };
  globals.window = { ...eventTarget, devicePixelRatio: 1 };
}

interface AudioShimGlobals {
  AudioContext?: unknown;
  Audio?: unknown;
  document?: unknown;
  window?: unknown;
}

const faultArg = process.argv.find((arg) => arg.startsWith(FAULT_FLAG));
const faultName = faultArg?.slice(FAULT_FLAG.length) ?? null;
if (faultName !== null && faultName !== KNOWN_FAULT) {
  console.error(`unknown fault "${faultName}"; the only fault is ${KNOWN_FAULT}`);
  process.exit(2);
}
const fault = faultName === KNOWN_FAULT ? KNOWN_FAULT : null;

// Loaded after the globals are in place: the settings and render modules read
// `window` as they load.
const { runDifficultyGuardChecks } = await import('./difficultyGuardChecks.js');
const failures = runDifficultyGuardChecks(fault);

if (failures.length > 0) {
  console.error(`verify:difficulty-guard FAILED${fault === null ? '' : ` (fault: ${fault})`}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`verify:difficulty-guard passed${fault === null ? '' : ` (fault: ${fault})`}`);
