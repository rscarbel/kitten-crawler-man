/**
 * The spit attack's two effect figures: the glob in flight and the sticky
 * puddle it lands in.
 *
 * Both are painted centred on their own tile anchor, which is why their anchors
 * sit at the middle of the cell rather than at a pair of feet — a projectile is
 * placed by where it *is*, and it is drawn rotated about that point.
 */

import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawSpitProjectile, drawSpitTrapIdle, drawSpitTrapSplat } from './grotesqueSpiderSpitArt';

/** Cell geometry frozen from the sheets these replace; proved by the parity run. */
const PROJECTILE_FRAME_W = 96;
const PROJECTILE_FRAME_H = 64;
const PROJECTILE_TILE_X = 48;
const PROJECTILE_TILE_Y = 32;
const TRAP_FRAME_W = 256;
const TRAP_FRAME_H = 256;
const TRAP_TILE_X = 128;
const TRAP_TILE_Y = 128;
const TILE_SCALE = 64;

const PROJECTILE_FRAMES = 8;
const TRAP_FRAMES = 8;

/** The glob's only state: a wobble loop, drawn rotated to its flight angle. */
export type SpitProjectileState = 'fly';
/** The puddle's two states: landing, then sitting. */
export type SpitTrapState = 'splat' | 'idle';

export const GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE: FigureDef = {
  id: 'grotesque_spider_spit_projectile',
  frameWidth: PROJECTILE_FRAME_W,
  frameHeight: PROJECTILE_FRAME_H,
  tileX: PROJECTILE_TILE_X,
  tileY: PROJECTILE_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ fly: PROJECTILE_FRAMES }),
  paintFrame: (ctx, state, frame) => {
    if (state !== 'fly') return;
    drawSpitProjectile(ctx, PROJECTILE_TILE_X, PROJECTILE_TILE_Y, TILE_SCALE, frame);
  },
};

export const GROTESQUE_SPIDER_SPIT_TRAP_FIGURE: FigureDef = {
  id: 'grotesque_spider_spit_trap',
  frameWidth: TRAP_FRAME_W,
  frameHeight: TRAP_FRAME_H,
  tileX: TRAP_TILE_X,
  tileY: TRAP_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ splat: TRAP_FRAMES, idle: TRAP_FRAMES }),
  paintFrame: (ctx, state, frame) => {
    if (state === 'splat') {
      drawSpitTrapSplat(ctx, TRAP_TILE_X, TRAP_TILE_Y, TILE_SCALE, frame);
      return;
    }
    if (state === 'idle') drawSpitTrapIdle(ctx, TRAP_TILE_X, TRAP_TILE_Y, TILE_SCALE, frame);
  },
};

export const GROTESQUE_SPIDER_SPIT_EFFECT_FIGURES: readonly FigureDef[] = [
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
];

export { PROJECTILE_FRAMES as SPIT_PROJECTILE_FRAMES, TRAP_FRAMES as SPIT_TRAP_FRAMES };
