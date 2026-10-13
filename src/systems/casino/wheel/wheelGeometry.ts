import { boardUnits, type WheelBoard } from './wheelBoard';
import type { Rng } from '../../../sprites/person/rng';

/*
 * Angles are radians in the wheel's own frame, measured clockwise from the
 * leading edge of wedge 0. A wheel rotation R turns that frame clockwise on
 * screen, so the fixed pointer at the top reads wheel angle (-R) mod 2π.
 */

const FULL_TURN = Math.PI * 2;

/**
 * Share of a wedge's span kept clear at each edge when choosing where to land,
 * so the pointer never rests on a peg and the result is never in doubt.
 */
export const LANDING_EDGE_MARGIN_FRACTION = 0.15;

export const SPIN_MIN_EXTRA_TURNS = 5;
export const SPIN_MAX_EXTRA_TURNS = 7;
export const SPIN_MIN_DURATION_MS = 6500;
export const SPIN_MAX_DURATION_MS = 8500;
/**
 * Exponent of the ease-out. Higher means a harder launch and a longer crawl
 * over the last few pegs; at this power the opening speed is several times the
 * average while the final pegs pass slowly enough to count.
 */
export const SPIN_EASE_POWER = 3.5;

/** Wraps any angle into [0, 2π). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % FULL_TURN;
  return wrapped < 0 ? wrapped + FULL_TURN : wrapped;
}

function wedgeSpan(board: WheelBoard, index: number): number {
  return (board[index].units / boardUnits(board)) * FULL_TURN;
}

/** Leading edge of a wedge in the wheel frame. */
export function wedgeStartAngle(board: WheelBoard, index: number): number {
  const unitsBefore = board.slice(0, index).reduce((sum, wedge) => sum + wedge.units, 0);
  return (unitsBefore / boardUnits(board)) * FULL_TURN;
}

/** Trailing edge of a wedge in the wheel frame. */
export function wedgeEndAngle(board: WheelBoard, index: number): number {
  return wedgeStartAngle(board, index) + wedgeSpan(board, index);
}

/** Where a wedge's label is centred, in the wheel frame. */
export function wedgeCenterAngle(board: WheelBoard, index: number): number {
  return wedgeStartAngle(board, index) + wedgeSpan(board, index) / 2;
}

/** One peg on every wedge boundary, in the wheel frame. */
export function pegAngles(board: WheelBoard): number[] {
  return board.map((_, index) => wedgeStartAngle(board, index));
}

/** The wedge containing a wheel-frame angle. */
export function wedgeAtAngle(board: WheelBoard, angle: number): number {
  const target = normalizeAngle(angle);
  for (let index = board.length - 1; index > 0; index--) {
    if (target >= wedgeStartAngle(board, index)) return index;
  }
  return 0;
}

/** The wheel-frame angle under the pointer at a given rotation. */
export function angleUnderPointer(rotation: number): number {
  return normalizeAngle(-rotation);
}

/** The wedge under the pointer at a given rotation. */
export function wedgeAtPointer(board: WheelBoard, rotation: number): number {
  return wedgeAtAngle(board, angleUnderPointer(rotation));
}

/** The rotation, in [0, 2π), that puts a wheel-frame angle under the pointer. */
export function rotationForPointerAt(angle: number): number {
  return normalizeAngle(-angle);
}

/** A random wheel-frame angle strictly inside a wedge, clear of both pegs. */
export function landingAngle(board: WheelBoard, wedgeIndex: number, rng: Rng): number {
  const span = wedgeSpan(board, wedgeIndex);
  const margin = span * LANDING_EDGE_MARGIN_FRACTION;
  const usable = span - margin * 2;
  return wedgeStartAngle(board, wedgeIndex) + margin + rng() * usable;
}

/**
 * Pegs that sweep past the pointer as the wheel turns from one rotation to a
 * later one, for the clapper. Rotations are unwrapped, so a full turn counts
 * every peg once.
 */
export function pegCrossings(board: WheelBoard, fromRotation: number, toRotation: number): number {
  if (toRotation <= fromRotation) return 0;
  let crossings = 0;
  for (const peg of pegAngles(board)) {
    const pegRotation = rotationForPointerAt(peg);
    const turnsToEnd = Math.floor((toRotation - pegRotation) / FULL_TURN);
    const turnsToStart = Math.floor((fromRotation - pegRotation) / FULL_TURN);
    crossings += turnsToEnd - turnsToStart;
  }
  return crossings;
}

export interface WheelSpinPlan {
  readonly startRotation: number;
  /** Unwrapped final rotation; it puts the landing angle exactly under the pointer. */
  readonly endRotation: number;
  readonly durationMs: number;
  /** Unwrapped rotation `elapsedMs` into the spin; holds at `endRotation` once done. */
  angleAt(elapsedMs: number): number;
  /** Rotation speed in radians per millisecond, for the clapper and bulb chase. */
  velocityAt(elapsedMs: number): number;
}

/**
 * A hard launch from `startRotation` and a long ease-out that comes to rest
 * with `landing` (a wheel-frame angle from `landingAngle`) under the pointer
 * after several full turns.
 */
export function planSpin(startRotation: number, landing: number, rng: Rng): WheelSpinPlan {
  const extraTurns =
    SPIN_MIN_EXTRA_TURNS + Math.floor(rng() * (SPIN_MAX_EXTRA_TURNS - SPIN_MIN_EXTRA_TURNS + 1));
  const durationMs = SPIN_MIN_DURATION_MS + rng() * (SPIN_MAX_DURATION_MS - SPIN_MIN_DURATION_MS);
  const toLanding = normalizeAngle(rotationForPointerAt(landing) - startRotation);
  const travel = toLanding + extraTurns * FULL_TURN;
  const endRotation = startRotation + travel;

  return {
    startRotation,
    endRotation,
    durationMs,
    angleAt(elapsedMs) {
      if (elapsedMs >= durationMs) return endRotation;
      const progress = Math.max(0, elapsedMs) / durationMs;
      const eased = 1 - Math.pow(1 - progress, SPIN_EASE_POWER);
      return startRotation + travel * eased;
    },
    velocityAt(elapsedMs) {
      if (elapsedMs >= durationMs) return 0;
      const progress = Math.max(0, elapsedMs) / durationMs;
      return (travel * SPIN_EASE_POWER * Math.pow(1 - progress, SPIN_EASE_POWER - 1)) / durationMs;
    },
  };
}
