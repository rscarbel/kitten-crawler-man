/**
 * Shared wander behavior for ambient, non-combatant figures: stroll to a random
 * point at a per-agent speed, pause on arrival, then repeat. Generalized from
 * the Desperado Club's patrons so both club patrons and overworld townsfolk run
 * one implementation (and share one set of tuning knobs) rather than diverging
 * copies.
 */

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
}

function retarget(state: WanderState, params: WanderParams): void {
  const target = params.pickTarget();
  state.targetX = target.x;
  state.targetY = target.y;
  state.pause = params.pauseMin + Math.floor(Math.random() * (params.pauseMax - params.pauseMin));
}

/**
 * Advances one frame of wander: counts down a pause, steps toward the target,
 * or retargets on arrival / when blocked. Mutates `state` in place and returns
 * the frame's motion for the caller to translate into facing and animation.
 */
export function stepWander(state: WanderState, params: WanderParams): WanderStep {
  const dx = state.targetX - state.x;
  const dy = state.targetY - state.y;

  if (state.pause > 0) {
    state.pause--;
    return { dx, dy, moving: false };
  }

  const dist = Math.hypot(dx, dy);
  if (dist < params.arriveDist) {
    retarget(state, params);
    return { dx, dy, moving: false };
  }

  const stepX = (dx / dist) * state.speed;
  const stepY = (dy / dist) * state.speed;

  if (params.isWalkable && !params.isWalkable(state.x + stepX, state.y + stepY)) {
    retarget(state, params);
    return { dx, dy, moving: false };
  }

  state.x += stepX;
  state.y += stepY;
  return { dx, dy, moving: true };
}
