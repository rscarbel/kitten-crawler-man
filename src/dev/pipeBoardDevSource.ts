/**
 * A stand-in for the bathroom system behind the pipe board, for the review
 * scenes, the UI gallery and the render script: it holds one board, turns
 * its tiles, and can put it into the states worth looking at (the opening
 * scramble, half solved and leaking, every fixture full but still leaking,
 * one turn from solved, solved).
 */

import {
  answerMasks,
  cellCoord,
  createPipeBoard,
  currentMask,
  resetToScramble,
  traceFlow,
  turnTile,
  type PipeBoard,
  type PipeBoardLayout,
  type TurnDirection,
} from '../systems/cloggedBathroom/pipeBoard';
import type { BathroomCue } from '../audio/bathroomSoundCues';
import type { PipeBoardSource } from '../ui/screens/dialogs/pipeBoardSurface';

const SIDE_COUNT = 4;
const STEP_X: readonly number[] = [0, 1, 0, -1];
const STEP_Y: readonly number[] = [-1, 0, 1, 0];
const OPPOSITE_SIDE = 2;
/** Half solved: tiles within this share of the answer's flow depth are turned right. */
const MID_SOLVE_DEPTH_SHARE = 0.5;

export class DevPipeBoardSource implements PipeBoardSource {
  isPipeBoardOpen = true;
  pipeBoard: PipeBoard | null;
  pipeBoardGenerationProgress = 0;
  pipeBoardSolved = false;
  explainerRequests = 0;
  readonly cues: BathroomCue[] = [];

  constructor(layout: PipeBoardLayout | null) {
    this.pipeBoard = layout === null ? null : createPipeBoard(layout);
  }

  turnPipeTile(cell: number, direction: TurnDirection): boolean {
    if (this.pipeBoard === null) return false;
    return turnTile(this.pipeBoard, cell, direction);
  }

  playPipeBoardCue(cue: BathroomCue): void {
    this.cues.push(cue);
  }

  onPipeBoardSolved(): void {
    this.pipeBoardSolved = true;
  }

  closePipeBoard(): void {
    this.isPipeBoardOpen = false;
  }

  openPipeBoardExplainer(): void {
    this.explainerRequests++;
  }

  restartPipeBoard(): void {
    if (this.pipeBoard !== null) resetToScramble(this.pipeBoard);
  }
}

/** Turns `cell` clockwise until it shows `mask`; bolted tiles are left alone. */
function turnTo(board: PipeBoard, cell: number, mask: number): void {
  for (let quarter = 0; quarter < SIDE_COUNT; quarter++) {
    if (currentMask(board, cell) === mask) return;
    if (!turnTile(board, cell, 'clockwise')) return;
  }
}

/** Steps from the main along the answer, per cell. */
export function answerDepths(board: PipeBoardLayout): number[] {
  const masks = answerMasks(board);
  const depths = new Array<number>(board.tiles.length).fill(-1);
  const start = board.inletRow * board.size;
  depths[start] = 0;
  const queue = [start];
  for (const cell of queue) {
    const { x, y } = cellCoord(board.size, cell);
    for (let side = 0; side < SIDE_COUNT; side++) {
      if ((masks[cell] & (1 << side)) === 0) continue;
      const nx = x + STEP_X[side];
      const ny = y + STEP_Y[side];
      if (nx < 0 || ny < 0 || nx >= board.size || ny >= board.size) continue;
      const next = ny * board.size + nx;
      const facing = 1 << ((side + OPPOSITE_SIDE) % SIDE_COUNT);
      if (depths[next] >= 0 || (masks[next] & facing) === 0) continue;
      depths[next] = depths[cell] + 1;
      queue.push(next);
    }
  }
  return depths;
}

export function solveAll(board: PipeBoard): void {
  const masks = answerMasks(board);
  board.tiles.forEach((_tile, cell) => turnTo(board, cell, masks[cell]));
}

/** The near half of the answer turned right, so water floods part way and leaks at its edge. */
export function solveNearHalf(board: PipeBoard): void {
  const masks = answerMasks(board);
  const depths = answerDepths(board);
  const reach = Math.max(...depths) * MID_SOLVE_DEPTH_SHARE;
  depths.forEach((depth, cell) => {
    if (depth >= 0 && depth <= reach) turnTo(board, cell, masks[cell]);
  });
}

/**
 * Solved, then a few dead ends knocked off their answer: every fixture still
 * fills, but the knocked tiles' feeders leak. Returns false when no such
 * arrangement was found.
 */
export function fullButLeaking(board: PipeBoard, wanted = 2): boolean {
  solveAll(board);
  let knocked = 0;
  for (let cell = 0; cell < board.tiles.length && knocked < wanted; cell++) {
    if (board.tiles[cell].bolted) continue;
    const before = board.rotations[cell];
    turnTile(board, cell, 'clockwise');
    const trace = traceFlow(board);
    const allFull = trace.counts.fixturesFull === trace.counts.fixturesTotal;
    if (allFull && trace.counts.leaks > 0) {
      knocked++;
      continue;
    }
    board.rotations[cell] = before;
  }
  return knocked > 0;
}

/** Solved but for one tile, which needs one clockwise turn; returns that tile. */
export function oneTurnFromSolved(board: PipeBoard): number | null {
  solveAll(board);
  for (let cell = 0; cell < board.tiles.length; cell++) {
    const tile = board.tiles[cell];
    if (tile.bolted || tile.kind === 'cross') continue;
    turnTile(board, cell, 'anticlockwise');
    if (!traceFlow(board).won) return cell;
    turnTile(board, cell, 'clockwise');
  }
  return null;
}

/** The next tile a solver would turn, or null when the board shows its answer. */
export function nextSolverTurn(board: PipeBoard): number | null {
  const masks = answerMasks(board);
  const depths = answerDepths(board);
  let best: number | null = null;
  board.tiles.forEach((tile, cell) => {
    if (tile.bolted || currentMask(board, cell) === masks[cell]) return;
    if (best === null || depths[cell] < depths[best]) best = cell;
  });
  return best;
}
