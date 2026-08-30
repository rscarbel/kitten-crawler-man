/**
 * The Cat's Magic Missile as two painted figures: the bolt in flight and the
 * impact it detonates into.
 *
 * Two figures rather than one because the two cells are nothing alike — the
 * bolt is a wide, short cell anchored near its leading edge so the tail has
 * room to stream behind it, and the impact is a large square anchored at its
 * centre. Sharing a cell would make every bolt in the air cost the impact's
 * footprint.
 *
 * The four level-banded tiers plus the level-10 sub-missile are the *states*,
 * exactly as they were the sheet's rows: `magicMissileArt.ts` still owns what
 * each band looks like and which levels it covers, and this module only places
 * each band's painter at its cell's own anchor.
 *
 * The art invariants live in `scripts/gates-magic-missile.ts`, which the review
 * harness runs: `npm run render:magic-missile`.
 */

import {
  EXPLOSION_FRAME_COUNT,
  EXPLOSION_FRAME_SIZE,
  EXPLOSION_TILE_OFFSET,
  MISSILE_TIERS,
  PROJECTILE_FRAME_COUNT,
  PROJECTILE_FRAME_HEIGHT,
  PROJECTILE_FRAME_WIDTH,
  PROJECTILE_TILE_X,
  PROJECTILE_TILE_Y,
  type ProjectileVariant,
  TILE_SCALE,
  drawMagicMissileExplosion,
  drawMagicMissileProjectile,
} from './magicMissileArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/**
 * Row order is the order the sheets baked, which is also the order the tiers
 * escalate in. The sub-missile trails the four tiers because it is the level-10
 * shrapnel rather than a band of its own.
 */
export const MISSILE_VARIANTS: readonly ProjectileVariant[] = [...MISSILE_TIERS, 'sub_missile'];

/**
 * A state name resolved back to the variant that paints it. A `Map` rather than
 * an index into a record because the state reaching `paintFrame` is a plain
 * string the type system has stopped tracking, and an unknown one has to answer
 * `undefined` rather than a variant that does not exist.
 */
const VARIANT_BY_STATE = new Map<string, ProjectileVariant>(
  MISSILE_VARIANTS.map((variant) => [variant, variant]),
);

function frameCountsFor(frames: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const variant of MISSILE_VARIANTS) counts[variant] = frames;
  return counts;
}

export const MAGIC_MISSILE_PROJECTILE_FIGURE: FigureDef = {
  id: 'magic_missile_projectile',
  frameWidth: PROJECTILE_FRAME_WIDTH,
  frameHeight: PROJECTILE_FRAME_HEIGHT,
  tileX: PROJECTILE_TILE_X,
  tileY: PROJECTILE_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(frameCountsFor(PROJECTILE_FRAME_COUNT)),
  paintFrame: (ctx, state, frame) => {
    const variant = VARIANT_BY_STATE.get(state);
    if (variant === undefined) return;
    drawMagicMissileProjectile(ctx, PROJECTILE_TILE_X, PROJECTILE_TILE_Y, variant, frame);
  },
};

export const MAGIC_MISSILE_EXPLOSION_FIGURE: FigureDef = {
  id: 'magic_missile_explosion',
  frameWidth: EXPLOSION_FRAME_SIZE,
  frameHeight: EXPLOSION_FRAME_SIZE,
  tileX: EXPLOSION_TILE_OFFSET,
  tileY: EXPLOSION_TILE_OFFSET,
  tileScale: TILE_SCALE,
  states: figureStates(frameCountsFor(EXPLOSION_FRAME_COUNT)),
  paintFrame: (ctx, state, frame) => {
    const variant = VARIANT_BY_STATE.get(state);
    if (variant === undefined) return;
    drawMagicMissileExplosion(ctx, EXPLOSION_TILE_OFFSET, EXPLOSION_TILE_OFFSET, variant, frame);
  },
};

export const MAGIC_MISSILE_FIGURES: readonly FigureDef[] = [
  MAGIC_MISSILE_PROJECTILE_FIGURE,
  MAGIC_MISSILE_EXPLOSION_FIGURE,
];
