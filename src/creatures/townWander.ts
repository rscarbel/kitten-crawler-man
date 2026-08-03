/**
 * Shared wander behavior for ambient, non-combatant figures: stroll to a random
 * point at a per-agent speed, pause on arrival, then repeat. Generalized from
 * the Desperado Club's patrons so both club patrons and overworld townsfolk run
 * one implementation (and share one set of tuning knobs) rather than diverging
 * copies.
 */

import { TILE_SIZE } from '../core/constants';
import { SOUTHWARD_PROBE_DROP } from '../map/collisionAnchors';

/** Mutable position/target/pause state every wandering agent must expose. */
export interface WanderState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** World-pixels advanced per frame while walking. */
  speed: number;
  /** Frames left to stand still; counts down before movement resumes. */
  pause: number;
}

export interface WanderParams {
  /** Supplies the next destination once the current one is reached (or blocked). */
  pickTarget: () => { x: number; y: number };
  /** Distance (px) within which the target counts as reached. */
  arriveDist: number;
  /** Pause frames drawn on arrival: inclusive min, exclusive max. */
  pauseMin: number;
  pauseMax: number;
  /**
   * Optional walkability gate in world pixels. When the next step would land on
   * an unwalkable point the agent abandons its target and picks a new one,
   * rather than walking through a wall.
   */
  isWalkable?: (x: number, y: number) => boolean;
}

/** The frame's motion, so callers can derive facing and animation state. */
export interface WanderStep {
  /** Vector to the current target, measured before this frame's move (px). */
  dx: number;
  dy: number;
  /** True when the agent actually advanced this frame. */
  moving: boolean;
  /**
   * World pixels actually covered this frame, zero when standing. A walk cycle
   * driven off this rather than off elapsed frames keeps cadence tied to speed,
   * which is what stops a slow figure moonwalking.
   */
  distance: number;
}

function retarget(state: WanderState, params: WanderParams): void {
  const target = params.pickTarget();
  state.targetX = target.x;
  state.targetY = target.y;
  state.pause = params.pauseMin + Math.floor(Math.random() * (params.pauseMax - params.pauseMin));
}

/**
 * Advances one frame of wander: counts down a pause, steps toward the target,
 * or retargets on arrival / when blocked. Mutates `state` in place and writes
 * the frame's motion into `out` for the caller to translate into facing and
 * animation. The caller owns `out` so a crowd of agents allocates nothing.
 */
export function stepWander(state: WanderState, params: WanderParams, out: WanderStep): void {
  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;
  out.dx = dx;
  out.dy = dy;
  out.moving = false;
  out.distance = 0;

  if (state.pause > 0) {
    state.pause--;
    return;
  }

  const dist = Math.hypot(dx, dy);
  if (dist < params.arriveDist) {
    retarget(state, params);
    return;
  }

  const stepX = (dx / dist) * state.speed;
  const stepY = (dy / dist) * state.speed;

  // Probe from the soles when stepping south. The callbacks all convert a world
  // point to a tile with the centre offset, so dropping the probe point instead
  // of changing every one of them makes them test the feet — see
  // `collisionAnchors`. Without it a townsperson walking down into a building
  // stops with their waist at the wall and their legs on top of it.
  const probeY = state.y + stepY + (stepY > 0 ? TILE_SIZE * SOUTHWARD_PROBE_DROP : 0);
  if (params.isWalkable && !params.isWalkable(state.x + stepX, probeY)) {
    retarget(state, params);
    return;
  }

  state.x += stepX;
  state.y += stepY;
  out.moving = true;
  out.distance = Math.hypot(stepX, stepY);
}
