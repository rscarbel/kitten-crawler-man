/**
 * The protections a support caster lays on its allies: `fairy_ward`,
 * `fairy_aegis` and `overheal`.
 *
 * Each has to be told apart from the party's own amber Shield at a glance,
 * because the player's answer to all three is the same — kill whatever is
 * holding them up — and a ward mistaken for the crawler's own dome is a ward
 * the player never thinks to break.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import { statusRemainingFraction, type StatusEffect } from '../../core/StatusEffect';
import {
  bodyTop,
  drawGlow,
  hash01,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;

// -- fairy_ward: a blue hex dome ----------------------------------------------

const WARD_BLUE: Rgb = [70, 140, 255];
const WARD_PALE: Rgb = [190, 222, 255];

const HEX_SIDES = 6;
/** The dome is a hexagon a little wider than the figure, standing on its feet. */
const DOME_WIDTH_FRACTION = 0.85;
const DOME_HEIGHT_PAD_FRACTION = 0.1;
const DOME_FILL_ALPHA = 0.14;
const DOME_EDGE_ALPHA = 0.8;
const DOME_EDGE_WIDTH = 1.5;
/** A slow breathe, so a warded mob is visibly "live" even standing still. */
const DOME_PULSE_SPEED = 0.004;
const DOME_PULSE_DEPTH = 0.3;
/** A drained ward is drawn fainter, so the player can see a blow is getting through. */
const DOME_MIN_STRENGTH_ALPHA = 0.35;
/** Facet lines from the centre to alternate corners, the cue it is a lattice, not a bubble. */
const FACET_ALPHA = 0.35;

export function drawFairyWard(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  effect: StatusEffect,
): void {
  const strength = statusRemainingFraction(effect);
  const pulse = 1 - DOME_PULSE_DEPTH * (HALF + HALF * Math.sin(f.timeMs * DOME_PULSE_SPEED));
  const alphaScale =
    f.fade * pulse * (DOME_MIN_STRENGTH_ALPHA + (1 - DOME_MIN_STRENGTH_ALPHA) * strength);

  const radiusX = Math.max(f.width, f.height * HALF) * DOME_WIDTH_FRACTION;
  const radiusY = (f.height * (1 + DOME_HEIGHT_PAD_FRACTION)) / 2;
  const centerY = f.footY - radiusY;

  ctx.beginPath();
  for (let corner = 0; corner <= HEX_SIDES; corner++) {
    const angle = (corner / HEX_SIDES) * Math.PI * 2 + Math.PI / HEX_SIDES;
    const x = f.centerX + Math.cos(angle) * radiusX;
    const y = centerY + Math.sin(angle) * radiusY;
    if (corner === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.globalAlpha = DOME_FILL_ALPHA * alphaScale;
  ctx.fillStyle = rgba(WARD_BLUE, 1);
  ctx.fill();
  ctx.globalAlpha = DOME_EDGE_ALPHA * alphaScale;
  ctx.strokeStyle = rgba(WARD_PALE, 1);
  ctx.lineWidth = DOME_EDGE_WIDTH;
  ctx.stroke();

  ctx.globalAlpha = FACET_ALPHA * alphaScale;
  ctx.strokeStyle = rgba(WARD_BLUE, 1);
  ctx.beginPath();
  for (let corner = 0; corner < HEX_SIDES; corner += 2) {
    const angle = (corner / HEX_SIDES) * Math.PI * 2 + Math.PI / HEX_SIDES;
    ctx.moveTo(f.centerX, centerY);
    ctx.lineTo(f.centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY);
  }
  ctx.stroke();
}

// -- fairy_aegis: a light-blue aura -----------------------------------------

const AEGIS_BLUE: Rgb = [140, 200, 255];
const AEGIS_WHITE: Rgb = [225, 242, 255];
const AEGIS_COAT_ALPHA = 0.22;
const AEGIS_RIM_ALPHA = 0.75;
const AEGIS_MOTE_COUNT = 5;
const AEGIS_MOTE_RATE_PER_MS = 0.0008;
const AEGIS_MOTE_RISE_HEIGHTS = 1.1;
const AEGIS_MOTE_SPREAD = 0.6;
const AEGIS_MOTE_RADIUS_TILES = 0.07;
const AEGIS_MOTE_ALPHA = 0.7;

export function aegisBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(AEGIS_BLUE, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    blend: 'lighter',
    alpha: AEGIS_COAT_ALPHA * f.fade,
    rimColor: rgba(AEGIS_BLUE, 1),
    rimAlpha: AEGIS_RIM_ALPHA * f.fade,
  };
}

export function drawAegis(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  for (let i = 0; i < AEGIS_MOTE_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i, AEGIS_MOTE_RATE_PER_MS);
    const x = f.centerX + (hash01(key) - HALF) * 2 * f.width * AEGIS_MOTE_SPREAD;
    const y = f.footY - phase * f.height * AEGIS_MOTE_RISE_HEIGHTS;
    const alpha = AEGIS_MOTE_ALPHA * Math.sin(phase * Math.PI) * f.fade;
    drawGlow(ctx, AEGIS_WHITE, x, y, f.tileSize * AEGIS_MOTE_RADIUS_TILES, alpha);
  }
}

// -- overheal: a pale gold-green halo ------------------------------------------

const OVERHEAL_GOLD: Rgb = [214, 240, 140];
const OVERHEAL_RIM_ALPHA = 0.6;
const OVERHEAL_CROWN_RADIUS_FRACTION = 0.35;
const OVERHEAL_CROWN_ALPHA = 0.3;
const OVERHEAL_CROWN_RAISE_FRACTION = 0.05;

/**
 * Only a rim: the overheal's amount lives on the health bar, and a full coat
 * on top of that would drown the creature's own colours on every mob a wave
 * touched.
 */
export function overhealBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    rimColor: rgba(OVERHEAL_GOLD, 1),
    rimAlpha: OVERHEAL_RIM_ALPHA * f.fade,
  };
}

export function drawOverheal(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  drawGlow(
    ctx,
    OVERHEAL_GOLD,
    f.centerX,
    bodyTop(f) - f.height * OVERHEAL_CROWN_RAISE_FRACTION,
    f.width * OVERHEAL_CROWN_RADIUS_FRACTION,
    OVERHEAL_CROWN_ALPHA * f.fade,
  );
}
