import type { StatusEffect } from '../../core/combat/StatusEffect';
import {
  drawEarthElementalShieldSprite,
  type EarthElementalShieldRow,
} from '../earthElementalSprite';
import {
  EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES,
  EARTH_ELEMENTAL_SHIELD_APPEAR_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_SHIELD_FADE_FRAMES,
  EARTH_ELEMENTAL_SHIELD_FADE_TICKS_PER_FRAME,
} from '../earthElementalTiming';
import type { StatusVisualFrame } from './statusPaint';

const SHIELD_APPEAR_TICKS =
  EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES * EARTH_ELEMENTAL_SHIELD_APPEAR_TICKS_PER_FRAME;
const SHIELD_FADE_TICKS =
  EARTH_ELEMENTAL_SHIELD_FADE_FRAMES * EARTH_ELEMENTAL_SHIELD_FADE_TICKS_PER_FRAME;

/**
 * The dome's cell is painted to cover the human crawler, whose drawn figure
 * stands about this many tiles from sole to crown. Anyone shorter gets a dome
 * shrunk by the ratio of their height to his.
 */
const DOME_FITTED_FIGURE_HEIGHT_TILES = 1.67;
/**
 * The cat is half his height, and a dome shrunk all the way to her reads as a
 * bead; this keeps it a bubble she sits inside.
 */
const MIN_DOME_SCALE = 0.6;
const MAX_DOME_SCALE = 1;

/**
 * Which row of the dome an absorbing ward plays, and how far into it: rising
 * over its first moments, breaking over its last — whether the clock ran out
 * or the pool was drained, which cuts the clock down to the break's length —
 * and pulsing in between.
 */
function domeRowFor(effect: StatusEffect): { row: EarthElementalShieldRow; ticks: number } {
  if (effect.ticksRemaining < SHIELD_FADE_TICKS) {
    return { row: 'fade', ticks: SHIELD_FADE_TICKS - effect.ticksRemaining };
  }
  const elapsed = effect.totalTicks - effect.ticksRemaining;
  if (elapsed < SHIELD_APPEAR_TICKS) return { row: 'appear', ticks: elapsed };
  return { row: 'hold', ticks: elapsed - SHIELD_APPEAR_TICKS };
}

/**
 * The amber Shield over whoever carries a ward, drawn after them so it sits
 * over the figure, standing on their feet rather than on their tile.
 */
export function drawShieldDome(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  effect: StatusEffect,
): void {
  const fittedHeightPx = DOME_FITTED_FIGURE_HEIGHT_TILES * f.tileSize;
  const scale = Math.max(MIN_DOME_SCALE, Math.min(MAX_DOME_SCALE, f.height / fittedHeightPx));
  const { row, ticks } = domeRowFor(effect);
  const tileLeft = f.centerX - f.tileSize / 2;
  const tileTop = f.footY - f.tileSize;
  drawEarthElementalShieldSprite(ctx, tileLeft, tileTop, f.tileSize, { row, ticks, scale });
}
