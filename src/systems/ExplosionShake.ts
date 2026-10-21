import { TILE_SIZE } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { ExplosionVariant } from '../sprites/dynamiteExplosion';
import { clamp } from '../utils';

/** Peak camera kick in px from a charge going off right on top of the listener. */
const PEAK_SHAKE_PX: Record<ExplosionVariant, number> = {
  dynamite: 9,
  black_powder: 6,
};
/**
 * However many charges go off together the camera never jumps further than
 * this — a chain of sticks should feel heavier than one, not unreadable.
 */
const MAX_SHAKE_PX = 14;
/** Frames a kick takes to die away: a little under half a second. */
const SHAKE_FRAMES = 26;
/** Inside this distance a blast lands at full strength. */
const FULL_STRENGTH_TILES = 2;
/**
 * Past this distance a blast is felt not at all. Roughly the edge of the view,
 * so a blast just off screen is a faint tremor and one further away is silence.
 */
const NO_STRENGTH_TILES = 14;
/**
 * The strength falls off as the square of how near the blast is, so a blast at
 * mid-screen is already well under half the kick of one underfoot.
 */
const PROXIMITY_FALLOFF_POWER = 2;
/**
 * Incommensurate wobble rates, so the offset traces a jitter rather than a
 * circle. Deterministic rather than `Math.random`, so a seeded simulation that
 * sets off a charge draws the same random stream with or without a camera.
 */
const WOBBLE_RATE_X = 2.1;
const WOBBLE_RATE_Y = 2.9;

const NO_OFFSET = { x: 0, y: 0 } as const;

/**
 * The camera kick from dynamite and black powder going off, wherever they came
 * from — a crawler's own throw or a goblin's. It listens for
 * `explosiveDetonated`, weighs each blast by how close it landed to `listener`,
 * and the scene adds {@link cameraOffset} after clamping like its other shakes.
 *
 * Advanced only from the world tick, so a paused world holds the kick where it
 * was rather than playing it out behind a menu.
 */
export class ExplosionShake {
  private framesLeft = 0;
  private peakPx = 0;
  private age = 0;
  private offset: { x: number; y: number } = NO_OFFSET;
  private readonly unsubscribe: () => void;

  constructor(
    bus: EventBus,
    private readonly listener: () => { x: number; y: number },
  ) {
    this.unsubscribe = bus.on('explosiveDetonated', ({ x, y, kind }) => this.kick(x, y, kind));
  }

  /** The px kick a blast of `kind` at (`x`, `y`) adds, before stacking. */
  static strengthAt(
    kind: ExplosionVariant,
    blastX: number,
    blastY: number,
    listenerX: number,
    listenerY: number,
  ): number {
    const distancePx = Math.hypot(blastX - listenerX, blastY - listenerY);
    const fullPx = FULL_STRENGTH_TILES * TILE_SIZE;
    const nonePx = NO_STRENGTH_TILES * TILE_SIZE;
    const proximity = clamp(1 - (distancePx - fullPx) / (nonePx - fullPx), 0, 1);
    return PEAK_SHAKE_PX[kind] * proximity ** PROXIMITY_FALLOFF_POWER;
  }

  private kick(x: number, y: number, kind: ExplosionVariant): void {
    const at = this.listener();
    const added = ExplosionShake.strengthAt(kind, x, y, at.x, at.y);
    if (added <= 0) return;
    this.peakPx = Math.min(MAX_SHAKE_PX, this.currentAmplitude() + added);
    this.framesLeft = SHAKE_FRAMES;
  }

  private currentAmplitude(): number {
    const remaining = this.framesLeft / SHAKE_FRAMES;
    return this.peakPx * remaining * remaining;
  }

  update(): void {
    this.age++;
    if (this.framesLeft <= 0) {
      this.offset = NO_OFFSET;
      return;
    }
    this.framesLeft--;
    const amplitude = this.currentAmplitude();
    this.offset = {
      x: Math.sin(this.age * WOBBLE_RATE_X) * amplitude,
      y: Math.cos(this.age * WOBBLE_RATE_Y) * amplitude,
    };
  }

  /** Camera displacement for this frame; the scene adds it after clamping. */
  get cameraOffset(): { x: number; y: number } {
    return this.offset;
  }

  /** A checkpoint restore must not resume a kick from the run that died. */
  reset(): void {
    this.framesLeft = 0;
    this.peakPx = 0;
    this.offset = NO_OFFSET;
  }

  dispose(): void {
    this.unsubscribe();
  }
}
