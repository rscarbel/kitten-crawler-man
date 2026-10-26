/**
 * One committed board per difficulty, for the rare world whose generator runs
 * out of attempts without accepting a board.
 *
 * Each was found by the generator itself and then frozen here as data, so it
 * is a real board of its tier rather than a hand-drawn approximation. They
 * come from a world seed no gate sweeps, so the sweep never meets them as
 * ordinary generated boards. The pipe-board gate assesses every one against
 * its tier's contract and regenerates it byte for byte, so a retuned tier or
 * generator that no longer produces one of these turns the gate red; rewrite
 * this file with `npm run verify:pipe-board -- --write-fallbacks`.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type { PipeBoardLayout } from './pipeBoard';

/**
 * The world seed these boards were generated from: `generatePipeBoardNow`
 * with this seed and each difficulty reproduces them.
 */
export const PIPE_BOARD_FALLBACK_WORLD_SEED = 0xfa11b0a2;

const EASY_FALLBACK: PipeBoardLayout = {
  size: 5,
  inletRow: 2,
  fixtures: [
    { edge: 'top', index: 2, kind: 'toilet' },
    { edge: 'top', index: 4, kind: 'sink' },
    { edge: 'bottom', index: 3, kind: 'sink' },
  ],
  tiles: [
    { kind: 'tee', answer: 2, scramble: 2, bolted: false, decoy: true },
    { kind: 'elbow', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 3, scramble: 3, bolted: true, decoy: false },
    { kind: 'tee', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 3, bolted: true, decoy: false },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'cap', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 3, scramble: 0, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 2, bolted: false, decoy: false },
    { kind: 'tee', answer: 2, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 2, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 2, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 0, scramble: 0, bolted: false, decoy: true },
  ],
};

const NORMAL_FALLBACK: PipeBoardLayout = {
  size: 6,
  inletRow: 3,
  fixtures: [
    { edge: 'top', index: 0, kind: 'toilet' },
    { edge: 'right', index: 3, kind: 'sink' },
    { edge: 'bottom', index: 1, kind: 'sink' },
    { edge: 'bottom', index: 5, kind: 'toilet' },
  ],
  tiles: [
    { kind: 'elbow', answer: 0, scramble: 3, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 2, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'cap', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'cap', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'elbow', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'tee', answer: 2, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'elbow', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 0, scramble: 3, bolted: false, decoy: false },
    { kind: 'elbow', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'tee', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 3, bolted: false, decoy: true },
    { kind: 'elbow', answer: 1, scramble: 2, bolted: false, decoy: false },
    { kind: 'tee', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 1, scramble: 2, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 3, bolted: false, decoy: false },
    { kind: 'cap', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'tee', answer: 3, scramble: 3, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
  ],
};

const HARD_FALLBACK: PipeBoardLayout = {
  size: 7,
  inletRow: 3,
  fixtures: [
    { edge: 'top', index: 1, kind: 'toilet' },
    { edge: 'top', index: 5, kind: 'toilet' },
    { edge: 'bottom', index: 1, kind: 'sink' },
    { edge: 'bottom', index: 3, kind: 'toilet' },
    { edge: 'bottom', index: 5, kind: 'sink' },
  ],
  tiles: [
    { kind: 'cap', answer: 1, scramble: 2, bolted: false, decoy: false },
    { kind: 'tee', answer: 2, scramble: 0, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'tee', answer: 0, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'cap', answer: 2, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'elbow', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'tee', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'cap', answer: 2, scramble: 0, bolted: false, decoy: false },
    { kind: 'tee', answer: 3, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 2, scramble: 2, bolted: false, decoy: true },
    { kind: 'tee', answer: 3, scramble: 3, bolted: false, decoy: true },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'tee', answer: 3, scramble: 3, bolted: false, decoy: true },
    { kind: 'elbow', answer: 2, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'elbow', answer: 0, scramble: 3, bolted: false, decoy: false },
    { kind: 'cross', answer: 0, scramble: 0, bolted: true, decoy: false },
    { kind: 'tee', answer: 0, scramble: 2, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 0, scramble: 2, bolted: false, decoy: false },
    { kind: 'tee', answer: 0, scramble: 3, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 3, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 2, bolted: false, decoy: false },
    { kind: 'cap', answer: 0, scramble: 0, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'elbow', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 0, scramble: 2, bolted: false, decoy: false },
    { kind: 'straight', answer: 1, scramble: 0, bolted: false, decoy: false },
    { kind: 'elbow', answer: 2, scramble: 0, bolted: false, decoy: false },
    { kind: 'cap', answer: 2, scramble: 2, bolted: false, decoy: true },
    { kind: 'straight', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'straight', answer: 0, scramble: 1, bolted: false, decoy: false },
    { kind: 'tee', answer: 1, scramble: 1, bolted: false, decoy: true },
    { kind: 'tee', answer: 3, scramble: 1, bolted: false, decoy: false },
    { kind: 'cap', answer: 3, scramble: 0, bolted: false, decoy: false },
  ],
};

export const PIPE_BOARD_FALLBACKS: Readonly<Record<Difficulty, PipeBoardLayout>> = {
  easy: EASY_FALLBACK,
  normal: NORMAL_FALLBACK,
  hard: HARD_FALLBACK,
};
