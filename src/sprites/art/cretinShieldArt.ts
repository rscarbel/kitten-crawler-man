/**
 * The Cretins' Shield: a translucent amber dome over whichever ally it
 * protects.
 *
 * It must never be mistaken for Carl's Protective Shell, a flat ring on the
 * floor five tiles across, blue or at full power a saturated orange-to-gold.
 * The two differ in shape — an upright dome hugging one body against a disc
 * round a crowd, a honeycomb lattice against a plain ring — and in colour: the
 * full-power Shell covers the same hues as amber, so the dome is a muted honey
 * separated from it by saturation and value (`SHIELD_AMBER` in
 * `cretinArt.ts`). A player told "the big rock guy shielded you" should look
 * at themselves and see a bell jar of honey.
 *
 * Coordinates are tile units with the origin on the ground at the centre of the
 * protected figure's feet, +Y down; the caller translates and scales by a tile.
 *
 * The painter composes with the caller's `globalAlpha` rather than assigning
 * over it, so a caller fading the dome fades it rather than flashing it back.
 */

import { type Pt, clamp01, lerp, mix, rgba } from './carlArt';
import { SHIELD_AMBER, SHIELD_AMBER_DEEP, SHIELD_AMBER_HOT, TWO_PI } from './cretinArt';

type Ctx = CanvasRenderingContext2D;

/** Half the dome's width at its base, tiles: wide enough to clear Carl's shoulders. */
export const DOME_HALF_WIDTH = 0.8;
/** Dome height, tiles: over Carl's head with a little room. */
export const DOME_HEIGHT = 1.8;
/** The base ellipse's half-depth: the floor seen from above. */
const DOME_BASE_DEPTH = 0.17;

const INTERIOR_CENTRE_ALPHA = 0.035;
const INTERIOR_EDGE_ALPHA = 0.22;
const LATTICE_ALPHA = 0.26;
const LATTICE_WIDTH = 0.02;
const HEX_SIZE = 0.19;
const RIM_WIDTH = 0.034;
const RIM_ALPHA = 0.95;
const HOT_RIM_WIDTH = 0.013;
const SPECULAR_ALPHA = 0.75;
const SPECULAR_TINT = '#fff3c4';
/** How far the glint slides round the cap over a hold loop, radians. */
const SPECULAR_DRIFT = 0.05;
const RIM_PULSE_SWELL = 0.6;
const BASE_RING_WIDTH = 0.03;
/** The floor ring sits under the rim in brightness: the dome, not the ring, carries the shape. */
const BASE_RING_ALPHA = 0.55;
/** The shimmer band sweeping up the lattice, as a share of the dome's height. */
const SHIMMER_HALF_BAND = 0.18;
const MOTES = 6;
const MOTE_RADIUS = 0.018;

/** What a frame of the dome shows. */
export interface ShieldLook {
  /** Height grown to, 0..1. */
  readonly rise: number;
  /** Overall strength, 0..1. */
  readonly strength: number;
  /** Loop phase of the shimmer and the motes, 0..1. */
  readonly phase: number;
  /** Share of the lattice cells already gone, top first, 0..1 (the fade). */
  readonly breakup: number;
  /** A bright ring pulsing out from the base (the appear), 0..1. */
  readonly flash: number;
  /** Rim brightness swell, 0..1: the dome's heartbeat while it holds. */
  readonly pulse: number;
}

function traceDome(ctx: Ctx, halfWidth: number, height: number): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, halfWidth, height, 0, Math.PI, TWO_PI);
  ctx.ellipse(0, 0, halfWidth, DOME_BASE_DEPTH, 0, 0, Math.PI);
  ctx.closePath();
}

function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Honeycomb centres covering the dome, row by row from the base up. */
function hexCentres(halfWidth: number, height: number): Pt[] {
  const centres: Pt[] = [];
  const rowStep = HEX_SIZE * 1.5;
  const colStep = HEX_SIZE * Math.sqrt(3);
  let row = 0;
  for (let y = DOME_BASE_DEPTH; y > -height - HEX_SIZE; y -= rowStep) {
    const offset = row % 2 === 0 ? 0 : colStep / 2;
    for (let x = -halfWidth - colStep; x <= halfWidth + colStep; x += colStep) {
      centres.push({ x: x + offset, y });
    }
    row++;
  }
  return centres;
}

function traceHex(ctx: Ctx, centre: Pt, size: number): void {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TWO_PI + Math.PI / 6;
    const x = centre.x + Math.cos(a) * size;
    const y = centre.y + Math.sin(a) * size;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Paints the dome in the state `look` describes. */
export function drawCretinShield(ctx: Ctx, look: ShieldLook): void {
  const strength = clamp01(look.strength);
  if (strength <= 0) return;
  const rise = clamp01(look.rise);
  const halfWidth = DOME_HALF_WIDTH * lerp(0.72, 1, rise);
  const height = Math.max(0.05, DOME_HEIGHT * rise);
  const baseAlpha = ctx.globalAlpha;

  ctx.save();
  try {
    // The floor ring's back half goes down first, under everything, and fainter.
    ctx.lineWidth = BASE_RING_WIDTH;
    ctx.strokeStyle = rgba(SHIELD_AMBER_DEEP, 0.55 * strength);
    ctx.beginPath();
    ctx.ellipse(0, 0, halfWidth, DOME_BASE_DEPTH, 0, Math.PI, TWO_PI);
    ctx.stroke();

    ctx.save();
    try {
      traceDome(ctx, halfWidth, height);
      ctx.clip();
      // A glass dome is clearest where you look straight through it and
      // densest at its edges, where the eye grazes the surface.
      ctx.save();
      ctx.translate(0, -height * 0.42);
      ctx.scale(halfWidth, height * 0.62);
      const body = ctx.createRadialGradient(-0.15, -0.2, 0, 0, 0, 1.25);
      body.addColorStop(0, rgba(SHIELD_AMBER, INTERIOR_CENTRE_ALPHA * strength));
      body.addColorStop(0.6, rgba(SHIELD_AMBER, INTERIOR_CENTRE_ALPHA * 1.6 * strength));
      body.addColorStop(1, rgba(SHIELD_AMBER_DEEP, INTERIOR_EDGE_ALPHA * strength));
      ctx.fillStyle = body;
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();

      // The band enters below the base and leaves above the crown, so the
      // frame after the last starts with it out of sight again: no pop at the
      // loop's seam.
      const bandReach = height * SHIMMER_HALF_BAND;
      const shimmerY = lerp(DOME_BASE_DEPTH + bandReach, -height - bandReach, look.phase);
      ctx.lineWidth = LATTICE_WIDTH;
      for (const [index, centre] of hexCentres(halfWidth, height).entries()) {
        const heightShare = clamp01(-centre.y / height);
        const gone =
          look.breakup > 0 && heightShare + hash(index, 3) * 0.35 > 1.2 - look.breakup * 1.4;
        if (gone) continue;
        const nearBand = clamp01(1 - Math.abs(centre.y - shimmerY) / (height * SHIMMER_HALF_BAND));
        // The honeycomb gathers toward the dome's edges and fades where you
        // look straight through at whoever is inside: over the body it is
        // noise at 32 px.
        const edgeShare = clamp01(Math.abs(centre.x) / halfWidth + heightShare * heightShare * 0.8);
        const alpha = LATTICE_ALPHA * strength * (0.55 + 0.9 * nearBand) * lerp(0.2, 1, edgeShare);
        ctx.strokeStyle = rgba(nearBand > 0.5 ? SHIELD_AMBER_HOT : SHIELD_AMBER, alpha);
        ctx.beginPath();
        traceHex(ctx, centre, HEX_SIZE * 0.92);
        ctx.stroke();
        if (nearBand > 0.6) {
          ctx.fillStyle = rgba(SHIELD_AMBER, 0.1 * strength * nearBand);
          ctx.fill();
        }
      }
    } finally {
      ctx.restore();
    }

    ctx.lineCap = 'round';
    // While it is still rising the rim is a soft glow rather than a hard line,
    // or it cuts across the face of whoever is inside.
    const rimFirmness = lerp(0.35, 1, rise * rise);
    ctx.lineWidth = RIM_WIDTH * (1 + RIM_PULSE_SWELL * look.pulse);
    ctx.strokeStyle = rgba(
      mix(SHIELD_AMBER, SHIELD_AMBER_HOT, 0.4 * look.pulse),
      RIM_ALPHA * strength * rimFirmness,
    );
    ctx.beginPath();
    ctx.ellipse(0, 0, halfWidth, height, 0, Math.PI, TWO_PI);
    ctx.stroke();
    ctx.lineWidth = HOT_RIM_WIDTH;
    ctx.strokeStyle = rgba(SHIELD_AMBER_HOT, 0.85 * strength);
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      halfWidth - RIM_WIDTH * 0.3,
      height - RIM_WIDTH * 0.3,
      0,
      Math.PI * 1.05,
      Math.PI * 1.55,
    );
    ctx.stroke();

    // The specular window: what makes it glass rather than a drawn arch.
    ctx.lineWidth = RIM_WIDTH * 1.1;
    const glint = SPECULAR_DRIFT * Math.sin(look.phase * TWO_PI);
    ctx.strokeStyle = rgba(SPECULAR_TINT, SPECULAR_ALPHA * strength);
    ctx.beginPath();
    // A short warm glint high on the cap, not a streak down the side, which
    // reads as a scratch on a glass jar.
    ctx.ellipse(
      0,
      -height * 0.02,
      halfWidth * 0.74,
      height * 0.86,
      0,
      Math.PI * 1.27 + glint,
      Math.PI * 1.4 + glint,
    );
    ctx.stroke();

    ctx.lineWidth = BASE_RING_WIDTH * 1.2;
    ctx.strokeStyle = rgba(SHIELD_AMBER, BASE_RING_ALPHA * strength);
    ctx.beginPath();
    ctx.ellipse(0, 0, halfWidth, DOME_BASE_DEPTH, 0, 0, Math.PI);
    ctx.stroke();

    if (look.flash > 0) {
      const spread = lerp(0.6, 1.25, 1 - look.flash);
      ctx.lineWidth = BASE_RING_WIDTH * 1.6;
      ctx.strokeStyle = rgba(SHIELD_AMBER, 0.9 * look.flash);
      ctx.beginPath();
      ctx.ellipse(0, 0, halfWidth * spread, DOME_BASE_DEPTH * spread, 0, 0, TWO_PI);
      ctx.stroke();
    }

    for (let i = 0; i < MOTES; i++) {
      const climb = (look.phase + i / MOTES) % 1;
      const x = (hash(i, 7) * 2 - 1) * halfWidth * 0.6;
      const y = lerp(-0.1, -height * 0.9, climb);
      const fade = Math.sin(climb * Math.PI);
      ctx.fillStyle = rgba(SHIELD_AMBER_HOT, 0.8 * strength * fade);
      ctx.beginPath();
      ctx.arc(x, y, MOTE_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
  } finally {
    ctx.restore();
    ctx.globalAlpha = baseAlpha;
  }
}
