import { isFiniteNumber, isRecord } from '../../core/util/guards';

/**
 * Where one exercise ball is in its life. It rests against a wall until he
 * kicks it, rolls until he dies, then slows to a stop where it is and stays.
 * Positions and velocities are the ball's centre in world pixels.
 */
export type ExerciseBallState =
  | { readonly phase: 'resting' }
  | {
      readonly phase: 'rolling';
      readonly x: number;
      readonly y: number;
      readonly vx: number;
      readonly vy: number;
    }
  | {
      readonly phase: 'stopping';
      readonly x: number;
      readonly y: number;
      readonly vx: number;
      readonly vy: number;
      readonly framesLeft: number;
    }
  | { readonly phase: 'stopped'; readonly x: number; readonly y: number };

/** Point-in-time gym state, restorable any number of times. */
export interface GymRoomCheckpoint {
  /** Per rack, per slot: frames until it refills, 0 for a filled slot. */
  racks: number[][];
  /** Per bench: frames until it is back, 0 for one on the floor. */
  benches: number[];
  squatRackStrippedFrames: number[];
  consoleShutoffFrames: number[];
  /** Per kettlebell rack: frames until it is stocked again, 0 for a stocked one. */
  kettlebellRackHeavedFrames: number[];
  /** Per resting spot, in the layout's order. */
  exerciseBalls: ExerciseBallState[];
  boomboxHp: number;
  sealed: boolean;
  defeated: boolean;
  mirrorCracked: boolean;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function parseExerciseBall(value: unknown): ExerciseBallState | undefined {
  if (!isRecord(value)) return undefined;
  const { phase, x, y, vx, vy, framesLeft } = value;
  if (phase === 'resting') return { phase };
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  if (phase === 'stopped') return { phase, x, y };
  if (!isFiniteNumber(vx) || !isFiniteNumber(vy)) return undefined;
  if (phase === 'rolling') return { phase, x, y, vx, vy };
  if (phase === 'stopping' && isFiniteNumber(framesLeft)) {
    return { phase, x, y, vx, vy, framesLeft };
  }
  return undefined;
}

/** Reads a saved gym checkpoint back from untrusted JSON; undefined when it is malformed. */
export function parseGymRoomCheckpoint(value: unknown): GymRoomCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { racks, benches, squatRackStrippedFrames, consoleShutoffFrames } = value;
  const { kettlebellRackHeavedFrames, exerciseBalls } = value;
  const { boomboxHp, sealed, defeated, mirrorCracked } = value;
  if (!Array.isArray(racks) || !racks.every(isNumberArray)) return undefined;
  if (!isNumberArray(benches) || !isNumberArray(squatRackStrippedFrames)) return undefined;
  if (!isNumberArray(consoleShutoffFrames) || typeof boomboxHp !== 'number') return undefined;
  if (!isNumberArray(kettlebellRackHeavedFrames) || !Array.isArray(exerciseBalls)) return undefined;
  if (typeof sealed !== 'boolean' || typeof defeated !== 'boolean') return undefined;
  if (typeof mirrorCracked !== 'boolean') return undefined;
  const balls: ExerciseBallState[] = [];
  for (const entry of exerciseBalls) {
    const ball = parseExerciseBall(entry);
    if (ball === undefined) return undefined;
    balls.push(ball);
  }
  return {
    racks: racks.filter(isNumberArray),
    benches,
    squatRackStrippedFrames,
    consoleShutoffFrames,
    kettlebellRackHeavedFrames,
    exerciseBalls: balls,
    boomboxHp,
    sealed,
    defeated,
    mirrorCracked,
  };
}
