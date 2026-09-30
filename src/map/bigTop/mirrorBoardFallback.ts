/**
 * One committed board per difficulty, for the rare world whose generator runs
 * out of attempts without accepting a board.
 *
 * Each was found by the generator itself and then frozen here as data, so it
 * is a real board of its tier rather than a hand-drawn approximation. They
 * come from a world seed no gate sweeps, so the gate's sweep never meets them
 * as ordinary generated boards. The mirror-board gate assesses every one
 * against its tier's contract, so a retuned tier that one of these no longer
 * meets turns the gate red.
 */

import type { MirrorBoard, MirrorBoardDifficulty } from './mirrorBoard';

/**
 * The world seed these boards were generated from: `generateBoardNow` with
 * this seed and each difficulty reproduces them.
 */
export const MIRROR_BOARD_FALLBACK_WORLD_SEED = 0xfa11bac;

const EASY_FALLBACK: MirrorBoard = {
  width: 36,
  height: 14,
  dividerX: 17,
  entries: { human: { x: 14, y: 12 }, cat: { x: 20, y: 12 } },
  exits: { human: { x: 11, y: 1 }, cat: { x: 24, y: 1 } },
  limelights: [
    { colour: 'blue', lane: 'human', tile: { x: 0, y: 11 }, heading: 'east' },
    { colour: 'red', lane: 'cat', tile: { x: 35, y: 8 }, heading: 'west' },
  ],
  mirrors: [
    {
      id: 'mirror_0',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 5, y: 5 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 1,
    },
    {
      id: 'mirror_1',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 33, y: 5 },
      cycle: ['NW', 'NE'],
      initialIndex: 1,
      solutionIndex: 0,
    },
    {
      id: 'mirror_2',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 30, y: 8 },
      cycle: ['SE', 'NE'],
      initialIndex: 1,
      solutionIndex: 0,
    },
    {
      id: 'mirror_3',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 5, y: 11 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 0,
      solutionIndex: 3,
    },
    {
      id: 'mirror_4',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 12, y: 11 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 1,
    },
    {
      id: 'mirror_5',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 30, y: 11 },
      cycle: ['NW', 'NE'],
      initialIndex: 1,
      solutionIndex: 0,
    },
  ],
  splitters: [],
  windows: [
    { x: 17, y: 5 },
    { x: 17, y: 11 },
  ],
  stars: [
    { id: 'star_blue', kind: 'blue', tile: { x: 33, y: 0 } },
    { id: 'star_red', kind: 'red', tile: { x: 12, y: 13 } },
    { id: 'star_encore', kind: 'encore', tile: { x: 0, y: 5 } },
  ],
  pillars: [],
};

const NORMAL_FALLBACK: MirrorBoard = {
  width: 36,
  height: 14,
  dividerX: 17,
  entries: { human: { x: 14, y: 12 }, cat: { x: 20, y: 12 } },
  exits: { human: { x: 11, y: 1 }, cat: { x: 24, y: 1 } },
  limelights: [
    { colour: 'blue', lane: 'human', tile: { x: 0, y: 4 }, heading: 'east' },
    { colour: 'red', lane: 'cat', tile: { x: 35, y: 9 }, heading: 'west' },
  ],
  mirrors: [
    {
      id: 'mirror_0',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 2, y: 2 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 1,
    },
    {
      id: 'mirror_1',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 30, y: 2 },
      cycle: ['SW', 'SE'],
      initialIndex: 1,
      solutionIndex: 0,
    },
    {
      id: 'mirror_2',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 2, y: 4 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 2,
      solutionIndex: 3,
    },
    {
      id: 'mirror_3',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 4, y: 4 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 3,
    },
    {
      id: 'mirror_4',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 34, y: 4 },
      cycle: ['NW', 'SE'],
      initialIndex: 1,
      solutionIndex: 1,
    },
    {
      id: 'mirror_5',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 10, y: 9 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 2,
      solutionIndex: 0,
    },
    {
      id: 'mirror_6',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 19, y: 9 },
      cycle: ['SE', 'NW'],
      initialIndex: 0,
      solutionIndex: 1,
    },
    {
      id: 'mirror_7',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 30, y: 9 },
      cycle: ['NE', 'SW'],
      initialIndex: 1,
      solutionIndex: 0,
    },
  ],
  splitters: [{ tile: { x: 10, y: 2 }, diagonal: 'backslash' }],
  windows: [{ x: 17, y: 9 }],
  stars: [
    { id: 'star_blue', kind: 'blue', tile: { x: 19, y: 0 } },
    { id: 'star_twin', kind: 'twin', tile: { x: 17, y: 2 } },
    { id: 'star_encore', kind: 'encore', tile: { x: 0, y: 2 } },
  ],
  pillars: [
    { x: 8, y: 11 },
    { x: 11, y: 10 },
  ],
};

const HARD_FALLBACK: MirrorBoard = {
  width: 36,
  height: 14,
  dividerX: 17,
  entries: { human: { x: 14, y: 12 }, cat: { x: 20, y: 12 } },
  exits: { human: { x: 11, y: 1 }, cat: { x: 24, y: 1 } },
  limelights: [
    { colour: 'blue', lane: 'human', tile: { x: 0, y: 4 }, heading: 'east' },
    { colour: 'red', lane: 'cat', tile: { x: 35, y: 4 }, heading: 'west' },
  ],
  mirrors: [
    {
      id: 'mirror_0',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 12, y: 2 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 1,
      solutionIndex: 1,
    },
    {
      id: 'mirror_1',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 5, y: 4 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 0,
      solutionIndex: 2,
    },
    {
      id: 'mirror_2',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 31, y: 4 },
      cycle: ['NW', 'SE'],
      initialIndex: 0,
      solutionIndex: 1,
    },
    {
      id: 'mirror_3',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 9, y: 5 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 3,
    },
    {
      id: 'mirror_4',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 11, y: 5 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 2,
      solutionIndex: 1,
    },
    {
      id: 'mirror_5',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 23, y: 5 },
      cycle: ['NW', 'SW'],
      initialIndex: 1,
      solutionIndex: 0,
    },
    {
      id: 'mirror_6',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 5, y: 7 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 1,
      solutionIndex: 0,
    },
    {
      id: 'mirror_7',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 31, y: 7 },
      cycle: ['SW', 'NW'],
      initialIndex: 0,
      solutionIndex: 1,
    },
    {
      id: 'mirror_8',
      kind: 'pivot_mirror',
      owner: 'human',
      tile: { x: 12, y: 9 },
      cycle: ['NE', 'SE', 'SW', 'NW'],
      initialIndex: 3,
      solutionIndex: 1,
    },
    {
      id: 'mirror_9',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 22, y: 9 },
      cycle: ['SW', 'NW'],
      initialIndex: 0,
      solutionIndex: 1,
    },
    {
      id: 'mirror_10',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 31, y: 10 },
      cycle: ['SE', 'NE'],
      initialIndex: 1,
      solutionIndex: 1,
    },
    {
      id: 'mirror_11',
      kind: 'swivel_mirror',
      owner: 'cat',
      tile: { x: 23, y: 12 },
      cycle: ['NE', 'SE'],
      initialIndex: 0,
      solutionIndex: 0,
    },
  ],
  splitters: [
    { tile: { x: 11, y: 7 }, diagonal: 'slash' },
    { tile: { x: 22, y: 7 }, diagonal: 'slash' },
  ],
  windows: [
    { x: 17, y: 5 },
    { x: 17, y: 9 },
  ],
  stars: [
    { id: 'star_blue', kind: 'blue', tile: { x: 23, y: 0 } },
    { id: 'star_red', kind: 'red', tile: { x: 12, y: 13 } },
    { id: 'star_twin', kind: 'twin', tile: { x: 17, y: 7 } },
    { id: 'star_encore', kind: 'encore', tile: { x: 35, y: 12 } },
  ],
  pillars: [
    { x: 1, y: 3 },
    { x: 19, y: 6 },
    { x: 29, y: 3 },
  ],
};

export const MIRROR_BOARD_FALLBACKS: Readonly<Record<MirrorBoardDifficulty, MirrorBoard>> = {
  easy: EASY_FALLBACK,
  normal: NORMAL_FALLBACK,
  hard: HARD_FALLBACK,
};
