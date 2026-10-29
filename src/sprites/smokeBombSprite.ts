/**
 * The smoke bomb in the air: a round fired-clay pot, its cork stopper and the
 * thin smoke leaking past the cork as it tumbles. The palette is the held
 * prop's and the item icon's, so the pot in the bag, in his fist and in the
 * air is one object.
 *
 * The picture is taken from its arguments alone (age, spin, seed), so a
 * review render replays any frame exactly.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/rendering/canvasSurface';
import { tone } from './art/itemIcons/iconPaint';
import { gradientStopRgba, hashUnit } from './flameStamps';

/** What a smoke bomb in flight looks like this frame. */
export interface SmokeBombFlightOptions {
  /** Frames since it left the hand; drives the smoke leaking off the cork. */
  readonly ageFrames: number;
  /** Turns of spin so far, in radians. */
  readonly spin: number;
  /** Fixes the smoke's sway so two pots in the air differ. */
  readonly seed: number;
}

const FULL_TURN = Math.PI * 2;
const POT_RADIUS_TILES = 0.21;

const CLAY = '#bf6a3d';
const CLAY_SHADOW = tone(CLAY, -0.42);
const CLAY_LIT = tone(CLAY, 0.22);
/** The line where the form turns from the light: darker than the shadow, but soft, as matte clay is. */
const TERMINATOR_INK = tone(CLAY, -0.55);
/** Floor light bounced onto the underside: warm, faint and confined to a thin rim. */
const REFLECTED_LIGHT = '#c98a62';
const REFLECTED_ALPHA = 0.45;
/** Unglazed clay has no hard shine, only a broad pale bloom on the lit side. */
const BLOOM_INK = tone(CLAY, 0.38);
const BLOOM_ALPHA = 0.55;
const OUTLINE_INK = '#1b120c';

/**
 * How far the lit lens is pushed toward the light, per unit radius. The lit
 * side is the pot's own outline shifted up-left, so the terminator is one
 * curved line across the form.
 */
const LIT_SHIFT_X = -0.28;
const LIT_SHIFT_Y = -0.34;
const TERMINATOR_WIDTH_SHARE = 0.11;
/** How far the reflected rim's cut-out is pushed toward the light; small, so the rim stays thin. */
const RIM_SHIFT_X = -0.1;
const RIM_SHIFT_Y = -0.16;
const BLOOM_X = -0.36;
const BLOOM_Y = -0.4;
const BLOOM_RADIUS_SHARE = 0.38;
const OUTLINE_WIDTH_SHARE = 0.12;

/** The pot is baked at this many times its on-screen size, then drawn down, so its edges are smooth. */
const BAKE_SUPERSAMPLE = 4;
/** Room round the baked pot for its outline, in on-screen pixels. */
const BAKE_PAD_PX = 1;

/**
 * The groove a potter scores round the shoulder, circling the neck's root. It
 * turns with the pot, so the spin reads; how far toward the neck it sits, as a
 * share of the radius, and how much of its circle is seen edge-on.
 */
const GROOVE_TOWARD_NECK = 0.5;
const GROOVE_TILT_SHARE = 0.3;
const GROOVE_INK = 'rgba(74, 33, 18, 0.45)';
const GROOVE_RIDGE_INK = 'rgba(234, 180, 138, 0.4)';
/** The groove's lit lip sits this far down-pot of the cut, per unit radius. */
const GROOVE_RIDGE_OFFSET = 0.09;
const GROOVE_WIDTH_PX = 1;

/** Where the neck leaves the pot, as a share of its radius; inside the rim so the pot overlaps its foot. */
const NECK_ROOT_SHARE = 0.8;
const NECK_WIDTH_SHARE = 0.46;
const NECK_LENGTH_SHARE = 0.3;
const LIP_WIDTH_SHARE = 0.66;
const LIP_HEIGHT_SHARE = 0.14;
const NECK_CLAY = '#a85a33';
const NECK_SHADE_INK = tone(NECK_CLAY, -0.4);
/** The stubby cork standing proud of the lip. */
const CORK_WIDTH_SHARE = 0.5;
const CORK_HEIGHT_SHARE = 0.36;
const CORK = '#dcb97f';
const CORK_SHADE_INK = tone(CORK, -0.32);
/** The cork's top face, seen a little from above, is the palest thing on the pot. */
const CORK_TOP_INK = tone(CORK, 0.25);
const CORK_TOP_SHARE = 0.32;

/** Smoke shed off the cork: one puff every few frames, each rising, swelling and fading as it goes. */
const PUFF_COUNT = 6;
const PUFF_INTERVAL_FRAMES = 2.5;
const PUFF_LIFE_FRAMES = PUFF_COUNT * PUFF_INTERVAL_FRAMES;
/** How fast a puff rises, as a share of a tile per frame. */
const PUFF_RISE_TILES = 0.022;
/** Sideways drift of a puff at the end of its life, as a share of a tile. */
const PUFF_SWAY_TILES = 0.08;
const PUFF_SWAY_RATE = 0.35;
const PUFF_BIRTH_RADIUS_TILES = 0.035;
const PUFF_DEATH_RADIUS_TILES = 0.085;
const PUFF_PEAK_ALPHA = 0.7;
/** Each puff's belly sits a little down-right of its lit top, in the puff's own radius. */
const PUFF_SHADE_SHIFT = 0.3;
const PUFF_LIT_GREY = 214;
const PUFF_SHADE_GREY = 132;
/** A fresh puff fades in over its first frames rather than popping out of the cork. */
const PUFF_FADE_IN_SHARE = 0.15;

const bakedPots = new Map<number, CanvasSurface>();

/** Pots are baked per whole on-screen pixel of radius and drawn to the exact size. */
function bakedPot(radius: number): { surface: CanvasSurface; drawRadius: number } {
  const key = Math.max(1, Math.ceil(radius));
  let surface = bakedPots.get(key);
  if (surface === undefined) {
    surface = bakePot(key);
    bakedPots.set(key, surface);
  }
  return { surface, drawRadius: radius * ((key + BAKE_PAD_PX) / key) };
}

/**
 * The clay pot under a fixed upper-left light. Its shading never turns with
 * the spin, because the light does not, so it is baked once per size; only
 * the groove, neck and cork, which are on the clay, turn with it.
 */
function bakePot(radius: number): CanvasSurface {
  const extent = (radius + BAKE_PAD_PX) * BAKE_SUPERSAMPLE;
  const size = Math.ceil(extent * 2);
  const surface = allocCanvas('props', size, size);
  const ctx = surfaceContext(surface);
  const r = radius * BAKE_SUPERSAMPLE;
  const c = size / 2;
  const tracePot = (dx: number, dy: number): void => {
    ctx.beginPath();
    ctx.arc(c + dx * r, c + dy * r, r, 0, FULL_TURN);
  };

  tracePot(0, 0);
  ctx.lineWidth = r * OUTLINE_WIDTH_SHARE * 2;
  ctx.strokeStyle = OUTLINE_INK;
  ctx.stroke();
  ctx.fillStyle = CLAY_SHADOW;
  ctx.fill();

  ctx.save();
  tracePot(0, 0);
  ctx.clip();

  tracePot(LIT_SHIFT_X, LIT_SHIFT_Y);
  const litFill = ctx.createLinearGradient(c - r, c - r, c + r * LIT_SHIFT_X, c + r * LIT_SHIFT_Y);
  litFill.addColorStop(0, CLAY_LIT);
  litFill.addColorStop(1, CLAY);
  ctx.fillStyle = litFill;
  ctx.fill();
  ctx.strokeStyle = TERMINATOR_INK;
  ctx.lineWidth = r * TERMINATOR_WIDTH_SHARE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c + BLOOM_X * r, c + BLOOM_Y * r, r * BLOOM_RADIUS_SHARE, 0, FULL_TURN);
  ctx.globalAlpha = BLOOM_ALPHA;
  ctx.fillStyle = BLOOM_INK;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c, c, r, 0, FULL_TURN);
  ctx.arc(c + RIM_SHIFT_X * r, c + RIM_SHIFT_Y * r, r, 0, FULL_TURN);
  ctx.globalAlpha = REFLECTED_ALPHA;
  ctx.fillStyle = REFLECTED_LIGHT;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  ctx.restore();
  return surface;
}

/**
 * The neck, lip and cork in the neck's frame (origin at the pot's centre, -Y
 * up the neck), returning the top of the cork, where the smoke leaks out.
 */
function paintNeckAndCork(
  ctx: CanvasRenderingContext2D,
  radius: number,
): { tipX: number; tipY: number } {
  const rootY = -radius * NECK_ROOT_SHARE;
  const neckHalf = (radius * NECK_WIDTH_SHARE) / 2;
  const neckTop = rootY - radius * NECK_LENGTH_SHARE;
  const lipHalf = (radius * LIP_WIDTH_SHARE) / 2;
  const lipTop = neckTop - radius * LIP_HEIGHT_SHARE;
  const corkHalf = (radius * CORK_WIDTH_SHARE) / 2;
  const corkTop = lipTop - radius * CORK_HEIGHT_SHARE;
  const corkTopFace = radius * CORK_HEIGHT_SHARE * CORK_TOP_SHARE;

  ctx.fillStyle = OUTLINE_INK;
  ctx.fillRect(-corkHalf - 1 / 2, corkTop - 1 / 2, corkHalf * 2 + 1, lipTop - corkTop + 1);
  ctx.fillRect(-lipHalf - 1 / 2, lipTop - 1 / 2, lipHalf * 2 + 1, neckTop - lipTop + 1);
  ctx.fillRect(-neckHalf - 1 / 2, neckTop, neckHalf * 2 + 1, rootY - neckTop);

  ctx.fillStyle = CORK;
  ctx.fillRect(-corkHalf, corkTop, corkHalf * 2, lipTop - corkTop);
  ctx.fillStyle = CORK_TOP_INK;
  ctx.fillRect(-corkHalf, corkTop, corkHalf * 2, corkTopFace);
  ctx.fillStyle = CORK_SHADE_INK;
  ctx.fillRect(0, corkTop + corkTopFace, corkHalf, lipTop - corkTop - corkTopFace);

  ctx.fillStyle = NECK_CLAY;
  ctx.fillRect(-neckHalf, neckTop, neckHalf * 2, rootY - neckTop);
  ctx.fillRect(-lipHalf, lipTop, lipHalf * 2, neckTop - lipTop);
  ctx.fillStyle = NECK_SHADE_INK;
  ctx.fillRect(0, neckTop, neckHalf, rootY - neckTop);
  ctx.fillRect(0, lipTop, lipHalf, neckTop - lipTop);
  return { tipX: 0, tipY: corkTop };
}

/** The groove's near half, turned with the pot; its lit lip shows on the pot side of the cut. */
function paintGroove(ctx: CanvasRenderingContext2D, radius: number, spin: number): void {
  const halfChord = radius * Math.sqrt(1 - GROOVE_TOWARD_NECK * GROOVE_TOWARD_NECK);
  const grooveY = -radius * GROOVE_TOWARD_NECK;
  ctx.save();
  ctx.rotate(spin);
  ctx.lineWidth = GROOVE_WIDTH_PX;
  ctx.strokeStyle = GROOVE_INK;
  ctx.beginPath();
  ctx.ellipse(0, grooveY, halfChord, halfChord * GROOVE_TILT_SHARE, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = GROOVE_RIDGE_INK;
  ctx.beginPath();
  ctx.ellipse(
    0,
    grooveY + radius * GROOVE_RIDGE_OFFSET,
    halfChord,
    halfChord * GROOVE_TILT_SHARE,
    0,
    0,
    Math.PI,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * The smoke leaking past the cork: puffs shed at a steady beat from the cork's
 * top, each rising up the screen, swelling, drifting aside and fading, with a
 * pale lit top over a darker belly so the thread has body against any floor.
 */
function paintLeakingSmoke(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  tileSize: number,
  opts: SmokeBombFlightOptions,
): void {
  const newestBirth = Math.floor(opts.ageFrames / PUFF_INTERVAL_FRAMES);
  const previousAlpha = ctx.globalAlpha;
  for (const pass of ['shade', 'lit'] as const) {
    const grey = pass === 'shade' ? PUFF_SHADE_GREY : PUFF_LIT_GREY;
    for (let back = PUFF_COUNT - 1; back >= 0; back--) {
      const birth = newestBirth - back;
      if (birth < 0) continue;
      const age = opts.ageFrames - birth * PUFF_INTERVAL_FRAMES;
      const life = age / PUFF_LIFE_FRAMES;
      if (life >= 1) continue;
      const fadeIn = Math.min(1, life / PUFF_FADE_IN_SHARE);
      const alpha = PUFF_PEAK_ALPHA * fadeIn * (1 - life);
      if (alpha <= 0) continue;
      const swayPhase = hashUnit(birth, opts.seed) * FULL_TURN;
      const sway = Math.sin(age * PUFF_SWAY_RATE + swayPhase) * PUFF_SWAY_TILES * tileSize * life;
      const radius =
        tileSize *
        (PUFF_BIRTH_RADIUS_TILES + (PUFF_DEATH_RADIUS_TILES - PUFF_BIRTH_RADIUS_TILES) * life);
      const shift = pass === 'shade' ? radius * PUFF_SHADE_SHIFT : 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradientStopRgba(grey, grey, grey, alpha);
      ctx.beginPath();
      ctx.arc(
        tipX + sway + shift,
        tipY - age * PUFF_RISE_TILES * tileSize + shift,
        radius,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  }
  ctx.globalAlpha = previousAlpha;
}

/**
 * A round clay smoke bomb with a cork stopper, centred on screen point (x, y)
 * and turned by `spin`, smoke leaking off the cork. The light stays upper left
 * however it turns: the pot's matte shading is baked once, and only the
 * shoulder groove, neck and cork turn with it.
 */
export function drawSmokeBombFlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  opts: SmokeBombFlightOptions,
): void {
  const radius = size * POT_RADIUS_TILES;
  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.rotate(opts.spin);
  const cork = paintNeckAndCork(ctx, radius);
  ctx.restore();

  const { surface, drawRadius } = bakedPot(radius);
  ctx.drawImage(surface, -drawRadius, -drawRadius, drawRadius * 2, drawRadius * 2);
  paintGroove(ctx, radius, opts.spin);
  ctx.restore();

  const cos = Math.cos(opts.spin);
  const sin = Math.sin(opts.spin);
  const tipX = x + cos * cork.tipX - sin * cork.tipY;
  const tipY = y + sin * cork.tipX + cos * cork.tipY;
  paintLeakingSmoke(ctx, tipX, tipY, size, opts);
}
