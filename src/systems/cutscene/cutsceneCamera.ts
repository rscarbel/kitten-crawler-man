/** A point in the world, in pixels, in the same frame as a body's `x`/`y`. */
export interface CutscenePoint {
  readonly x: number;
  readonly y: number;
}

type CameraState =
  | { readonly kind: 'free' }
  | {
      readonly kind: 'panning';
      readonly from: CutscenePoint;
      readonly to: CutscenePoint;
      readonly frames: number;
      elapsed: number;
    }
  | { readonly kind: 'held'; readonly at: CutscenePoint }
  | {
      readonly kind: 'returning';
      readonly from: CutscenePoint;
      readonly frames: number;
      elapsed: number;
    };

const FREE: CameraState = { kind: 'free' };

/** Smoothstep's cubic, 3t² − 2t³: zero slope at both ends. */
const SMOOTHSTEP_SQUARE_WEIGHT = 3;
const SMOOTHSTEP_CUBE_WEIGHT = 2;

/** Slow out of the start and into the end, so a pan reads as a camera move rather than a slide. */
function easeInOut(t: number): number {
  return t * t * (SMOOTHSTEP_SQUARE_WEIGHT - SMOOTHSTEP_CUBE_WEIGHT * t);
}

function lerpPoint(from: CutscenePoint, to: CutscenePoint, t: number): CutscenePoint {
  const eased = easeInOut(Math.min(1, Math.max(0, t)));
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}

/**
 * Where a cutscene points the camera: a pan to a point, a hold there, and a
 * return to whoever the party is following. The scene asks {@link focus} when
 * it frames the view and follows the leader whenever it answers null.
 *
 * Advanced only by {@link tick}, which the director runs on world ticks, so a
 * pan stops where it is under the pause menu.
 */
export class CutsceneCamera {
  private state: CameraState = FREE;

  /** Starts a pan from wherever the camera is now to `to`, over `frames` world ticks. */
  panTo(to: CutscenePoint, frames: number, leader: CutscenePoint): void {
    const from = this.focus(leader) ?? leader;
    this.state =
      frames <= 0
        ? { kind: 'held', at: to }
        : { kind: 'panning', from, to: { x: to.x, y: to.y }, frames, elapsed: 0 };
  }

  /** Stops the camera where it is now and keeps it there until told otherwise. */
  hold(leader: CutscenePoint): void {
    const at = this.focus(leader) ?? leader;
    this.state = { kind: 'held', at: { x: at.x, y: at.y } };
  }

  /** Lerps from wherever the camera is now back onto the leader, then lets it follow them again. */
  returnToLeader(frames: number, leader: CutscenePoint): void {
    const from = this.focus(leader);
    if (from === null || frames <= 0) {
      this.state = FREE;
      return;
    }
    this.state = { kind: 'returning', from, frames, elapsed: 0 };
  }

  /** Gives the camera straight back to the leader, mid-move or not. */
  release(): void {
    this.state = FREE;
  }

  /** Whether a pan or a return is still under way. */
  get isMoving(): boolean {
    return this.state.kind === 'panning' || this.state.kind === 'returning';
  }

  tick(): void {
    const state = this.state;
    switch (state.kind) {
      case 'free':
      case 'held':
        return;
      case 'panning':
        state.elapsed++;
        if (state.elapsed >= state.frames) this.state = { kind: 'held', at: state.to };
        return;
      case 'returning':
        state.elapsed++;
        if (state.elapsed >= state.frames) this.state = FREE;
        return;
      default: {
        const unhandled: never = state;
        throw new Error(`unhandled camera state ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** The point to centre on, or null to follow `leader` as usual. */
  focus(leader: CutscenePoint): CutscenePoint | null {
    const state = this.state;
    switch (state.kind) {
      case 'free':
        return null;
      case 'held':
        return state.at;
      case 'panning':
        return lerpPoint(state.from, state.to, state.elapsed / state.frames);
      case 'returning':
        return lerpPoint(state.from, leader, state.elapsed / state.frames);
      default: {
        const unhandled: never = state;
        throw new Error(`unhandled camera state ${JSON.stringify(unhandled)}`);
      }
    }
  }
}
