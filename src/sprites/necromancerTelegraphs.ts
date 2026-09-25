/**
 * The ground marks the necromancer's attacks announce themselves with, drawn
 * at runtime in world space: the sigils the dead rise from, the fan the soul
 * bolts will fly along, the cracks and the lit ground of a grave pulse, and the
 * mark where a blink will land.
 *
 * All of them are hollow-blue, the colour of every light he makes, so a player
 * who has learnt the lantern has learnt the warnings. Each takes a `progress`
 * from 0 (the telegraph opens) to 1 (the payload lands) and brightens toward
 * it, so the mark itself counts down.
 */

import { hollowSoulPalette, soulRgba } from './soulPalette';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const { core, mid, deep } = hollowSoulPalette;

/** How wide a raise sigil is, in tiles. */
const SIGIL_RADIUS_TILES = 0.42;
const SIGIL_SPOKES = 5;
/** The ground is seen at a slant: marks on it are squashed vertically. */
const GROUND_SQUASH = 0.45;
const SIGIL_TURN_PER_PROGRESS = 0.6;
/** The sigil opens at this share of its full size and grows to all of it. */
const SIGIL_START_SIZE = 0.6;
/** The soft glow round a sigil, as a multiple of its radius, and its peak opacity. */
const SIGIL_GLOW_REACH = 1.3;
const SIGIL_GLOW_ALPHA = 0.35;
/** The star's points sit just inside the ring. */
const SIGIL_STAR_INSET = 0.92;
/** Each star stroke steps this many points round, which draws a pentagram. */
const SIGIL_STAR_STEP = 2;
/**
 * The two strokes a sigil is drawn in: a wide dark under-stroke and a narrow
 * bright one over it. Widths are shares of the tile, floored in pixels so the
 * mark survives a small tile; alphas brighten from `from` to `to` as it runs.
 */
const SIGIL_UNDER = { width: 0.09, minPx: 2, from: 0.5, to: 0.9 } as const;
const SIGIL_OVER = { width: 0.04, minPx: 1, from: 0.55, to: 1 } as const;

/** Smoothstep's coefficients: zero slope at both ends. */
const SMOOTHSTEP_CUBIC = 3;
const SMOOTHSTEP_QUADRATIC = 2;

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (SMOOTHSTEP_CUBIC - SMOOTHSTEP_QUADRATIC * c);
}

/**
 * A raise sigil: a ring with a five-point star inside it, turning slowly and
 * brightening as the raise approaches. Centred on (x, y), the tile's centre.
 */
export function drawRaiseSigil(
  ctx: Ctx,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
): void {
  const t = ease(progress);
  const r = SIGIL_RADIUS_TILES * tileSize * (SIGIL_START_SIZE + (1 - SIGIL_START_SIZE) * t);
  const spin = progress * SIGIL_TURN_PER_PROGRESS * TWO_PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, GROUND_SQUASH);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * SIGIL_GLOW_REACH);
  glow.addColorStop(0, soulRgba(mid, SIGIL_GLOW_ALPHA * t));
  glow.addColorStop(1, soulRgba(deep, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * SIGIL_GLOW_REACH, 0, TWO_PI);
  ctx.fill();
  const trace = (): void => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TWO_PI);
    for (let i = 0; i <= SIGIL_SPOKES; i++) {
      const a = spin + ((i * SIGIL_STAR_STEP) / SIGIL_SPOKES) * TWO_PI;
      const px = Math.cos(a) * r * SIGIL_STAR_INSET;
      const py = Math.sin(a) * r * SIGIL_STAR_INSET;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  };
  ctx.strokeStyle = soulRgba(deep, SIGIL_UNDER.from + (SIGIL_UNDER.to - SIGIL_UNDER.from) * t);
  ctx.lineWidth = Math.max(SIGIL_UNDER.minPx, tileSize * SIGIL_UNDER.width);
  trace();
  ctx.stroke();
  ctx.strokeStyle = soulRgba(
    progress >= 1 ? core : mid,
    SIGIL_OVER.from + (SIGIL_OVER.to - SIGIL_OVER.from) * t,
  );
  ctx.lineWidth = Math.max(SIGIL_OVER.minPx, tileSize * SIGIL_OVER.width);
  trace();
  ctx.stroke();
  ctx.restore();
}

/** How far the bolt fan's guide lines reach, in tiles. */
const FAN_REACH_TILES = 4;
/**
 * The soul-bolt volley's shape: how many bolts, and the angle in radians
 * between neighbouring bolts. The creature fires its real bolts along these,
 * so the fan on the ground and the volley that follows it cannot disagree.
 */
export const NECROMANCER_VOLLEY_BOLTS = 3;
export const NECROMANCER_VOLLEY_SPREAD = 0.18;
/** A fan line's opacity at the lantern, and its width as a share of the tile. */
const FAN_ALPHA = 0.55;
const FAN_WIDTH = 0.05;

/**
 * The fan the volley will fly along: one faint line per bolt from the lantern
 * toward the target, drawing out to full length as the cast winds up.
 */
export function drawBoltFan(
  ctx: Ctx,
  fromX: number,
  fromY: number,
  angle: number,
  tileSize: number,
  progress: number,
): void {
  const t = ease(progress);
  const reach = FAN_REACH_TILES * tileSize * t;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < NECROMANCER_VOLLEY_BOLTS; i++) {
    const a = angle + (i - (NECROMANCER_VOLLEY_BOLTS - 1) / 2) * NECROMANCER_VOLLEY_SPREAD;
    const tx = fromX + Math.cos(a) * reach;
    const ty = fromY + Math.sin(a) * reach;
    const line = ctx.createLinearGradient(fromX, fromY, tx, ty);
    line.addColorStop(0, soulRgba(mid, FAN_ALPHA * t));
    line.addColorStop(1, soulRgba(mid, 0));
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, tileSize * FAN_WIDTH);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.restore();
}

const PULSE_CRACKS = 7;
const PULSE_CRACK_REACH_TILES = 0.55;
const PULSE_BAND_HALF_TILES = 0.35;
/** The band narrows toward the staff: its width there, as a share of its width at the target. */
const PULSE_BAND_STAFF_SHARE = 0.4;
/** The band's opacity at the staff and at the target, as it opens and at the payload. */
const PULSE_BAND_ALPHA = {
  staffFrom: 0.1,
  staffGain: 0.2,
  targetFrom: 0.15,
  targetGain: 0.35,
} as const;
/** How far each crack's direction is jittered off its even spacing, in radians. */
const PULSE_CRACK_JITTER = 0.7;
/** The shortest crack, as a share of the longest. */
const PULSE_CRACK_MIN_REACH = 0.5;
/** The cracks start this share of their length and grow to all of it. */
const PULSE_CRACK_START = 0.3;
/** How far a crack bends at its midpoint, in radians either way. */
const PULSE_CRACK_KINK = 0.8;
/** A crack's opacity starts at this share of its stroke's alpha. */
const PULSE_CRACK_START_ALPHA = 0.4;
/** Offsets into the hash, so each crack's angle, reach and kink are independent. */
const HASH_SEED_REACH = 9;
const HASH_SEED_KINK = 17;

/** The usual sine-hash constants: large and irregular enough to scatter a small integer. */
const HASH_SCALE = 127.1;
const HASH_OFFSET = 311.7;
const HASH_STRETCH = 43758.5453;

function hash01(seed: number): number {
  const s = Math.sin(seed * HASH_SCALE + HASH_OFFSET) * HASH_STRETCH;
  return s - Math.floor(s);
}

/**
 * A grave pulse's two marks: the ground lit in a band from the planted staff
 * to the target, and glowing cracks spreading over the target itself. Both
 * brighten through the channel, so the player can read how long is left.
 */
export function drawPulseTelegraph(
  ctx: Ctx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  tileSize: number,
  progress: number,
): void {
  const t = ease(progress);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * PULSE_BAND_HALF_TILES * tileSize;
  const ny = (dx / length) * PULSE_BAND_HALF_TILES * tileSize * GROUND_SQUASH;
  ctx.save();
  const band = ctx.createLinearGradient(fromX, fromY, toX, toY);
  band.addColorStop(0, soulRgba(mid, PULSE_BAND_ALPHA.staffFrom + PULSE_BAND_ALPHA.staffGain * t));
  band.addColorStop(
    1,
    soulRgba(mid, PULSE_BAND_ALPHA.targetFrom + PULSE_BAND_ALPHA.targetGain * t),
  );
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.moveTo(fromX + nx * PULSE_BAND_STAFF_SHARE, fromY + ny * PULSE_BAND_STAFF_SHARE);
  ctx.lineTo(toX + nx, toY + ny);
  ctx.lineTo(toX - nx, toY - ny);
  ctx.lineTo(fromX - nx * PULSE_BAND_STAFF_SHARE, fromY - ny * PULSE_BAND_STAFF_SHARE);
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < PULSE_CRACKS; i++) {
    const a = (i / PULSE_CRACKS) * TWO_PI + hash01(i) * PULSE_CRACK_JITTER;
    const r =
      PULSE_CRACK_REACH_TILES *
      tileSize *
      (PULSE_CRACK_MIN_REACH + (1 - PULSE_CRACK_MIN_REACH) * hash01(i + HASH_SEED_REACH)) *
      (PULSE_CRACK_START + (1 - PULSE_CRACK_START) * t);
    const kink = (hash01(i + HASH_SEED_KINK) - 0.5) * PULSE_CRACK_KINK;
    const midX = toX + Math.cos(a + kink) * r * 0.5;
    const midY = toY + Math.sin(a + kink) * r * 0.5;
    const endX = toX + Math.cos(a) * r;
    const endY = toY + Math.sin(a) * r;
    for (const [colour, width, alpha] of CRACK_STROKES) {
      ctx.strokeStyle = soulRgba(
        colour,
        alpha * (PULSE_CRACK_START_ALPHA + (1 - PULSE_CRACK_START_ALPHA) * t),
      );
      ctx.lineWidth = Math.max(1, tileSize * width);
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(midX, midY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A crack's two strokes: colour, width as a share of the tile, and opacity. */
const CRACK_STROKES: readonly (readonly [typeof deep | typeof core, number, number])[] = [
  [deep, 0.08, 0.8],
  [core, 0.03, 1],
];

const BLINK_MARK_RADIUS_TILES = 0.5;
/** The ring opens wide and tightens by this much as the blink approaches. */
const BLINK_MARK_START_SIZE = 1.4;
const BLINK_MARK_TIGHTEN = 0.6;
const BLINK_MARK_ALPHA = { from: 0.25, gain: 0.45 } as const;
/** The ring's stroke, and its dashes and gaps, as shares of the tile. */
const BLINK_MARK_WIDTH = 0.04;
const BLINK_MARK_DASH = 0.08;
const BLINK_MARK_GAP = 0.1;

/** Where a blink will land: a faint ring of motes that tightens as he goes. */
export function drawBlinkMark(
  ctx: Ctx,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
): void {
  const t = ease(progress);
  const r = BLINK_MARK_RADIUS_TILES * tileSize * (BLINK_MARK_START_SIZE - BLINK_MARK_TIGHTEN * t);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, GROUND_SQUASH);
  ctx.strokeStyle = soulRgba(mid, BLINK_MARK_ALPHA.from + BLINK_MARK_ALPHA.gain * t);
  ctx.lineWidth = Math.max(1, tileSize * BLINK_MARK_WIDTH);
  ctx.setLineDash([tileSize * BLINK_MARK_DASH, tileSize * BLINK_MARK_GAP]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}
