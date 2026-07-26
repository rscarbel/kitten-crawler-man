/**
 * The Bopca Protector: a stout, knee-high, green-tinted shag of a cook who
 * stands behind a safe room's counter and never leaves it.
 *
 * Short enough that only the head, shoulders and a sliver of apron clear the
 * counter slab, so the whole detail budget goes above the apron line. Three
 * things carry the character:
 *
 *  - The **shag coat**, drawn as layered tapered locks that hang still and swing
 *    as one mass when the body moves. It is the silhouette that reads as
 *    "Bopca"; the face is small at 32 px per tile.
 *  - The **beard**, which hangs long enough to run into the counter slab. A
 *    Bopca is a dwarf; the whiskers are half of what says so at this size.
 *  - The **eyes**, which track the player's world position. Cheap, and does more
 *    for believability than any amount of extra geometry.
 *  - The **brow**, which drops for `annoyed` and lifts for `pleased`. Whether the
 *    Bopca is talking to the human or the cat should be readable from the face
 *    alone, before a word of dialog appears.
 *
 * Drawn from a feet line rather than a tile corner: the caller stands the Bopca
 * behind a counter and then redraws the counter's front face over it, so the
 * sprite has to be positionable to sub-tile precision.
 */

import { GOLDEN_ANGLE_RAD } from '../utils';

/** What the Bopca is doing. Drives the arms, the bob rate, and the brow. */
export type BopcaState =
  | 'idle'
  | 'cooking'
  | 'serving'
  | 'leaning'
  | 'wipingHands'
  | 'readingNews'
  | 'annoyed'
  | 'pleased';

/**
 * Per-Bopca colouring. Seeded from the safe room index so two are never
 * identical, but always within the canon green-brown range.
 */
export interface BopcaPalette {
  coatLight: string;
  coatMid: string;
  coatDark: string;
  coatDarkest: string;
  skin: string;
  skinShade: string;
  tunic: string;
  tunicShade: string;
  apron: string;
  apronDark: string;
}

export interface BopcaDrawOptions {
  state: BopcaState;
  /** Frames since this Bopca was created — the phase source for every cycle. */
  animFrames: number;
  /** Where the Bopca is looking, each axis in −1…1. Drives the pupils and head tilt. */
  lookX: number;
  lookY: number;
  palette: BopcaPalette;
  /** True on the frames the eyes are shut. */
  blinking: boolean;
}

/**
 * Total drawn height, in tiles, toque included.
 *
 * Bopcas are dwarves, and a dwarf has to *read* as one standing next to a
 * crawler: well under a tile, where the player and every humanoid mob are drawn
 * a full tile tall. `BOPCA_FEET_COUNTER_FRACTION` is the number that has to
 * follow this one — shrink the figure without raising its feet and the counter
 * slab swallows everything but the toque.
 */
export const BOPCA_HEIGHT_TILE_FRACTION = 0.8;
/**
 * Shoulder-to-shoulder width, in tiles, before the shag coat widens it.
 *
 * Deliberately not scaled down as far as the height was: a dwarf is a short
 * humanoid, not a small one, so keeping some of the old width is what stops the
 * shorter figure reading as the same Bopca seen from further away.
 */
const BOPCA_BODY_WIDTH_TILE_FRACTION = 0.46;

// ── Vertical layout, as fractions of the total height, measured down from the
//    top of the toque. The apron line is where the counter cuts the body.
const TOQUE_TOP = 0;
const TOQUE_BASE = 0.19;
const SKULL_BOTTOM = 0.44;
const BROW_LINE = 0.24;
const EYE_LINE = 0.28;
const NOSE_TOP = 0.29;
const NOSE_BOTTOM = 0.37;
const MOUTH_LINE = 0.39;
/**
 * Deep enough that the beard runs *into* the counter slab rather than ending
 * above it. A beard that stopped short read as a goatee in every pose where an
 * arm came across the chest and hid the coat locks that had been standing in for
 * its lower half.
 */
const BEARD_BOTTOM = 0.72;
const SHOULDER_LINE = 0.46;
// Sits high on the chest: at this height the counter slab crosses the body just
// below the beard, and an apron any lower would never be seen in play.
const APRON_LINE = 0.52;
const HEM_LINE = 0.94;
const FOOT_LINE = 1;

// ── Horizontal layout, as fractions of the body width ─────────────────────────
const SKULL_HALF_WIDTH = 0.46;
const JAW_HALF_WIDTH = 0.38;
const EYE_OFFSET = 0.15;
const NOSE_HALF_WIDTH = 0.13;
const MOUTH_HALF_WIDTH = 0.11;
/** Half-width of the chin fall that closes the parting between the beard's lobes. */
const BEARD_CHIN_HALF_WIDTH = 0.22;
const SHOULDER_HALF_WIDTH = 0.62;
const ARM_HALF_WIDTH = 0.16;
const HAND_RADIUS = 0.15;

// ── Shag coat ─────────────────────────────────────────────────────────────────
/** Locks per depth layer. Three layers of this many is the whole coat. */
const SHAG_LOCKS_PER_LAYER = 14;
const SHAG_LAYER_COUNT = 3;
/** How far each layer sits behind the one in front, as a fraction of body width. */
const SHAG_LAYER_DEPTH_STEP = 0.07;
const SHAG_LOCK_BASE_LENGTH = 0.38;
const SHAG_LOCK_LENGTH_VARIANCE = 0.15;
const SHAG_LOCK_WIDTH = 0.11;
const SHAG_LOCK_TIP_WIDTH = 0.035;
/**
 * Radians the coat swings through when the Bopca is working at full tilt.
 *
 * Hair is dead weight: it only moves because the body under it moved, so every
 * lock swings off the *body's own bob*, in phase, trailing it by a few frames.
 * Giving each lock its own oscillator made the coat writhe on a motionless
 * figure — a bed of tentacles rather than a shag.
 */
const SHAG_SWAY_RADIANS = 0.11;
/** Frames the roots trail the body, before the extra trail a long lock adds. */
const SHAG_TRAIL_FRAMES = 4;
/** Extra trail at the tip of a full-length lock, so the mass unfurls rather than snapping. */
const SHAG_TIP_TRAIL_FRAMES = 7;
/**
 * How hard the body is throwing the coat around, per state. Standing still is
 * near enough zero — a Bopca leaning on its counter has hair that just hangs.
 */
const SHAG_MOTION_BY_STATE: Record<BopcaState, number> = {
  idle: 0.12,
  cooking: 1,
  serving: 0.55,
  leaning: 0.06,
  wipingHands: 0.7,
  readingNews: 0.06,
  annoyed: 0.1,
  pleased: 0.35,
};
/**
 * The arc the locks spring from, per side, measured from straight down.
 *
 * Kept well short of horizontal: locks that fan out sideways read as a sunburst
 * or a straw brim, not hair. Everything here hangs, and the outermost lock is
 * still angled downward.
 */
const SHAG_FAN_START_RADIANS = Math.PI * 0.05;
const SHAG_FAN_SWEEP_RADIANS = Math.PI * 0.28;
/**
 * How far a lock's tip curls away from its root direction, as a fraction of its
 * own length. Hair falls and then flicks; a straight taper reads as a spike.
 */
const SHAG_LOCK_CURL = 0.34;
/** Length a fully horizontal lock keeps, relative to a vertical one. */
const SHAG_LOCK_MIN_LENGTH_SCALE = 0.28;
/** How much of the fan's sweep the darker back layers use. */
const SHAG_BACK_LAYER_SWEEP_SCALE = 0.68;
/** The head's own hair, framing the face rather than hanging from the shoulders. */
const SHAG_HOOD_HALF_WIDTH = 0.62;
const SHAG_HOOD_TOP = 0.09;
const SHAG_HOOD_BOTTOM = 0.42;
const SHAG_HOOD_FACE_GAP = 0.42;
const SHAG_SIDEBURN_LOCKS = 5;
const SHAG_SIDEBURN_LENGTH = 0.24;

// ── Idle motion ───────────────────────────────────────────────────────────────
const BOB_RATE = 0.045;
const BOB_AMPLITUDE = 0.012;
const COOKING_BOB_RATE_MULTIPLIER = 3.2;
const COOKING_BOB_AMPLITUDE_MULTIPLIER = 1.8;
/** The toque rocks a frame behind the head, which is what sells it as loose cloth. */
const TOQUE_LAG_FRAMES = 6;
const TOQUE_ROCK_RADIANS = 0.09;
const APRON_COUNTERSWAY = 0.5;

// ── Face ──────────────────────────────────────────────────────────────────────
const EYE_RADIUS = 0.055;
const PUPIL_RADIUS = 0.03;
/** How far a pupil may travel from centre. Small eyes; a big range reads as googly. */
const PUPIL_TRAVEL = 0.022;
const BLINK_LID_HEIGHT = 0.014;
const BROW_THICKNESS = 0.035;
const BROW_NEUTRAL_TILT = 0.05;
/** Negative drops the brow's *inner* end, which is what makes a scowl a scowl. */
const BROW_ANNOYED_TILT = -0.42;
const BROW_PLEASED_TILT = 0.3;
const BROW_ANNOYED_DROP = 0.022;
const BROW_PLEASED_LIFT = 0.02;
const MOUTH_THICKNESS = 0.018;
const MOUTH_FROWN_CURVE = 0.03;
const MOUTH_SMILE_CURVE = -0.035;

// ── Toque ─────────────────────────────────────────────────────────────────────
/**
 * Wide and low rather than a tall pleated chef's hat: the folded linen toque of
 * the source art, and the only shape that still reads as a cook's hat when the
 * whole figure is barely a tile tall.
 */
const TOQUE_HALF_WIDTH = 0.44;
/** How far the folded crown flops to one side, as a fraction of its half-width. */
const TOQUE_TIP_LEAN = 0.5;
const TOQUE_FOLD_COUNT = 3;
const TOQUE_BAND_HEIGHT = 0.035;
const TOQUE_CROWN_BULGE = 1.15;

// ── Arms and props ────────────────────────────────────────────────────────────
const ARM_REST_DROP = 0.16;
const ARM_STIR_RADIUS = 0.1;
const ARM_STIR_RATE = 0.16;
const ARM_SERVE_REACH = 0.62;
const ARM_SERVE_RISE = 0.06;
const ARM_LEAN_SPREAD = 0.24;
const ARM_WIPE_RATE = 0.09;
const ARM_WIPE_TRAVEL = 0.1;
/** Where the hands wipe: just clear of the counter, or the gag is invisible. */
const ARM_WIPE_LINE = 0.6;
/**
 * How far off the centre line a chest-height hand has to sit to stay visible.
 *
 * The beard is drawn over the arms, so any pose that brings a hand in toward the
 * middle of the chest simply loses it behind the whiskers. Folded arms and
 * wiped hands still cross behind the beard — only the hands themselves clear it.
 */
const ARM_BEARD_CLEARANCE = 0.46;
const NEWSLETTER_WIDTH = 0.5;
const NEWSLETTER_HEIGHT = 0.3;
const NEWSLETTER_TILT = -0.16;
const NEWSLETTER_LINE_COUNT = 4;
const SERVING_BOWL_WIDTH = 0.28;
const SERVING_BOWL_HEIGHT = 0.12;

const NEWSLETTER_PAPER = '#ded3b4';
const NEWSLETTER_INK = 'rgba(60,50,36,0.55)';
const SERVING_BOWL_GLAZE = '#e8e0cc';
const SERVING_BOWL_CONTENT = '#c8863c';
const EYE_WHITE = '#efe6d2';
const PUPIL = '#2a2118';
const MOUTH_LINE_COLOR = '#4a2c20';
const NOSTRIL = 'rgba(60,32,22,0.5)';

/** The seeded coat hues, hand-picked so every one still reads as mossy green-brown. */
const COAT_HUES: ReadonlyArray<{
  light: string;
  mid: string;
  dark: string;
  darkest: string;
}> = [
  { light: '#7d7d52', mid: '#5f6040', dark: '#454630', darkest: '#2f3021' },
  { light: '#82784e', mid: '#635c3c', dark: '#48432c', darkest: '#312e1f' },
  { light: '#6f7f5c', mid: '#546146', dark: '#3d4733', darkest: '#293023' },
  { light: '#8a7f56', mid: '#6a6241', dark: '#4d4830', darkest: '#343021' },
  { light: '#74764f', mid: '#585a3c', dark: '#40422b', darkest: '#2b2c1d' },
];

/** Aprons in the teal family, per the source art. */
const APRON_HUES: ReadonlyArray<{ face: string; shade: string }> = [
  { face: '#5b8b95', shade: '#3f6b74' },
  { face: '#4f7f88', shade: '#376067' },
  { face: '#638f8a', shade: '#456d69' },
  { face: '#54818f', shade: '#3a626e' },
];

const SKIN_TONES: ReadonlyArray<{ base: string; shade: string }> = [
  { base: '#c99a76', shade: '#a87a58' },
  { base: '#bf8f6c', shade: '#9d7050' },
  { base: '#d2a582', shade: '#b08361' },
];

const TUNIC_LINEN = '#e6dcc0';
const TUNIC_LINEN_SHADE = '#c9bfa2';

/**
 * A Bopca's colouring, derived from a seed so each safe room's attendant is
 * visibly its own creature and always the same one across visits.
 */
export function bopcaPaletteForSeed(seed: number): BopcaPalette {
  const positive = Math.abs(Math.trunc(seed));
  const coat = COAT_HUES[positive % COAT_HUES.length];
  const apron = APRON_HUES[positive % APRON_HUES.length];
  const skin = SKIN_TONES[positive % SKIN_TONES.length];
  return {
    coatLight: coat.light,
    coatMid: coat.mid,
    coatDark: coat.dark,
    coatDarkest: coat.darkest,
    skin: skin.base,
    skinShade: skin.shade,
    tunic: TUNIC_LINEN,
    tunicShade: TUNIC_LINEN_SHADE,
    apron: apron.face,
    apronDark: apron.shade,
  };
}

/** True for the states where the Bopca is putting on a face for a human. */
function isSour(state: BopcaState): boolean {
  return state === 'annoyed';
}

function isWarm(state: BopcaState): boolean {
  return state === 'pleased' || state === 'serving';
}

/**
 * Draw a Bopca.
 *
 * @param cx    Screen-x of the body's centre line.
 * @param baseY Screen-y of the feet. The caller places this behind a counter.
 * @param ts    Tile size, from which height and width are derived.
 */
export function drawBopcaSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ts: number,
  opts: BopcaDrawOptions,
): void {
  const { state, animFrames, lookX, lookY, palette, blinking } = opts;
  const h = ts * BOPCA_HEIGHT_TILE_FRACTION;
  const w = ts * BOPCA_BODY_WIDTH_TILE_FRACTION;

  const cooking = state === 'cooking';
  const bobRate = cooking ? BOB_RATE * COOKING_BOB_RATE_MULTIPLIER : BOB_RATE;
  const bobAmplitude = cooking ? BOB_AMPLITUDE * COOKING_BOB_AMPLITUDE_MULTIPLIER : BOB_AMPLITUDE;
  const bob = Math.sin(animFrames * bobRate) * h * bobAmplitude;
  const laggedBob = Math.sin((animFrames - TOQUE_LAG_FRAMES) * bobRate) * h * bobAmplitude;
  const shagMotion = SHAG_MOTION_BY_STATE[state];

  /** Y of a layout fraction, with the body's bob already applied. */
  const y = (fraction: number) => baseY - h + h * fraction + bob;
  /** X of a horizontal fraction of the body width, right of centre for positive. */
  const x = (fraction: number) => cx + w * fraction;

  // Draw order is the whole trick: the coat is split around the body so the
  // back locks hang behind the tunic and the front locks fall over its
  // shoulders, which is what stops the figure reading as a flat cut-out.
  drawShagLocks(ctx, cx, baseY, h, w, palette, animFrames, bobRate, shagMotion, bob, 'back');
  drawTorso(ctx, x, y, w, h, palette, bob);
  drawApron(ctx, x, y, w, h, palette, bob);
  drawShagLocks(ctx, cx, baseY, h, w, palette, animFrames, bobRate, shagMotion, bob, 'front');
  // Arms last of the body: in the source art the forearm and whatever it is
  // holding sit *over* the coat, and a bowl hidden behind the beard is no use to
  // an animation whose whole job is to show that food was made.
  drawArms(ctx, x, y, w, h, palette, state, animFrames);
  drawBeardAndJaw(ctx, x, y, w, h, palette);
  drawShagHood(ctx, cx, baseY, h, w, palette, animFrames, bobRate, shagMotion, bob);
  drawFace(ctx, x, y, w, h, palette, state, lookX, lookY, blinking);
  drawToque(ctx, cx, baseY, h, w, palette, laggedBob, animFrames, bobRate);
}

/** Which side of the torso a pass of locks belongs on. */
type ShagPass = 'back' | 'front';

/**
 * The coat: fans of tapered, curling locks hanging off the shoulders, darkest at
 * the back, the whole mass swinging together off the body's bob.
 */
function drawShagLocks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  h: number,
  w: number,
  palette: BopcaPalette,
  animFrames: number,
  bobRate: number,
  motion: number,
  bob: number,
  pass: ShagPass,
): void {
  // Back pass gets the two dark layers, front pass the light one — so the light
  // locks are the ones catching the safe room's lamps.
  const layerColors = pass === 'back' ? [palette.coatDarkest, palette.coatDark] : [palette.coatMid];
  // Keeps the front pass's length seeds distinct from the back pass's, so the
  // light locks are not clones of the dark ones behind them.
  const layerOffset = pass === 'back' ? 0 : SHAG_LAYER_COUNT - 1;
  const shoulderY = baseY - h + h * SHOULDER_LINE + bob;

  ctx.lineCap = 'round';
  for (let layer = 0; layer < layerColors.length; layer++) {
    // Back layers hang from slightly higher and wider, so the front layer reads
    // as sitting in a nest of hair rather than pasted onto a flat shape.
    const depth = (layerColors.length - 1 - layer) * SHAG_LAYER_DEPTH_STEP;
    ctx.strokeStyle = layerColors[layer];

    for (let i = 0; i < SHAG_LOCKS_PER_LAYER; i++) {
      const alongFan = i / (SHAG_LOCKS_PER_LAYER - 1);
      // Mirrored halves, so the parting sits on the centre line where the face is.
      const toLeft = alongFan < 0.5;
      const acrossHalf = toLeft ? 1 - alongFan * 2 : (alongFan - 0.5) * 2;
      const side = toLeft ? -1 : 1;
      // The back layers fan narrower than the front one. Letting the darkest
      // locks reach widest made the two outermost read as separate dark hooks
      // sticking out of the character rather than as the back of a mass of hair.
      const layerSweep =
        SHAG_FAN_SWEEP_RADIANS * (pass === 'back' ? SHAG_BACK_LAYER_SWEEP_SCALE : 1);
      const fromVertical = SHAG_FAN_START_RADIANS + acrossHalf * layerSweep;

      // Golden-angle stepping so no two locks in a layer are the same length.
      // A fixed seed, not a phase — the locks no longer animate independently.
      const lengthSeedAngle = (i + (layer + layerOffset) * SHAG_LOCKS_PER_LAYER) * GOLDEN_ANGLE_RAD;
      const lengthJitter = (Math.sin(lengthSeedAngle) + 1) / 2;
      // Locks shorten as they angle away from vertical. Long locks out near the
      // horizontal read as spikes shooting out of the character's ears, which is
      // exactly what the first pass of this looked like.
      const verticality = Math.cos(fromVertical);
      const length =
        h *
        (SHAG_LOCK_BASE_LENGTH + lengthJitter * SHAG_LOCK_LENGTH_VARIANCE + depth) *
        (SHAG_LOCK_MIN_LENGTH_SCALE + (1 - SHAG_LOCK_MIN_LENGTH_SCALE) * verticality);

      // One driver for the entire coat — the body's own bob — with the longer
      // locks trailing further behind it, so the mass unfurls as a single piece.
      const trailFrames = SHAG_TRAIL_FRAMES + (length / h) * SHAG_TIP_TRAIL_FRAMES;
      const sway = Math.sin((animFrames - trailFrames) * bobRate) * SHAG_SWAY_RADIANS * motion;
      const angle = Math.PI / 2 - side * (fromVertical + sway);

      const rootX = cx + side * w * (SHAG_HOOD_HALF_WIDTH * acrossHalf * 0.9);
      const rootY = shoulderY - h * (depth + SHAG_LOCK_WIDTH * 0.5);
      const midX = rootX + Math.cos(angle) * length * 0.55;
      const midY = rootY + Math.sin(angle) * length * 0.55;
      // The tip curls further out than the root direction, so the lock reads as
      // falling hair with a flick at the end.
      // The curl fades out on the near-horizontal locks too: a lock already
      // pointing sideways only needs a little more to become a spike.
      const curl = side * SHAG_LOCK_CURL * verticality;
      const tipX = midX + Math.cos(angle + curl) * length * 0.5;
      const tipY = midY + Math.sin(angle + curl) * length * 0.5;

      // Two tapering strokes rather than one: a single stroke cannot narrow, and
      // a filled taper cannot follow the curl without a lot more geometry.
      ctx.lineWidth = w * SHAG_LOCK_WIDTH;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(midX, midY, (midX + tipX) / 2, (midY + tipY) / 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, w * SHAG_LOCK_TIP_WIDTH * 2);
      ctx.beginPath();
      ctx.moveTo((midX + tipX) / 2, (midY + tipY) / 2);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

/**
 * The head's own hair: a hood over the crown and down both cheeks, with a gap
 * left for the face. Drawn over the skull rather than behind it, so the face
 * sits *inside* the hair the way it does in the source art.
 */
function drawShagHood(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  h: number,
  w: number,
  palette: BopcaPalette,
  animFrames: number,
  bobRate: number,
  motion: number,
  bob: number,
): void {
  const top = baseY - h + h * SHAG_HOOD_TOP + bob;
  const bottom = baseY - h + h * SHAG_HOOD_BOTTOM + bob;
  const halfWidth = w * SHAG_HOOD_HALF_WIDTH;
  const faceHalfWidth = w * SHAG_HOOD_FACE_GAP;

  ctx.fillStyle = palette.coatMid;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, bottom);
  ctx.quadraticCurveTo(cx - halfWidth, top, cx, top);
  ctx.quadraticCurveTo(cx + halfWidth, top, cx + halfWidth, bottom);
  // Back down the inside, leaving the face uncovered between the two cheeks.
  ctx.lineTo(cx + faceHalfWidth, bottom);
  ctx.quadraticCurveTo(
    cx + faceHalfWidth,
    top + (bottom - top) * 0.3,
    cx,
    top + (bottom - top) * 0.22,
  );
  ctx.quadraticCurveTo(cx - faceHalfWidth, top + (bottom - top) * 0.3, cx - faceHalfWidth, bottom);
  ctx.closePath();
  ctx.fill();

  // Sideburn locks trailing off the cheeks into the beard, so the hood and the
  // beard read as one continuous coat rather than two separate shapes.
  // Sideburns hang off the head, so they take the same driver as the coat and
  // trail it by the same few frames rather than wandering on their own clock.
  const sway = Math.sin((animFrames - SHAG_TRAIL_FRAMES) * bobRate) * SHAG_SWAY_RADIANS * motion;
  ctx.strokeStyle = palette.coatDark;
  ctx.lineCap = 'round';
  ctx.lineWidth = w * SHAG_LOCK_WIDTH * 0.7;
  for (let i = 0; i < SHAG_SIDEBURN_LOCKS; i++) {
    const along = i / (SHAG_SIDEBURN_LOCKS - 1);
    for (const side of [-1, 1]) {
      const rootX = cx + side * halfWidth * (0.55 + along * 0.45);
      const rootY = top + (bottom - top) * (0.35 + along * 0.55);
      const length = h * SHAG_SIDEBURN_LENGTH * (0.6 + along * 0.6);
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.lineTo(rootX + side * Math.sin(sway) * length, rootY + Math.cos(sway) * length);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  x: (f: number) => number,
  y: (f: number) => number,
  w: number,
  h: number,
  palette: BopcaPalette,
  bob: number,
): void {
  const shoulderY = y(SHOULDER_LINE);
  const hemY = y(HEM_LINE);

  ctx.fillStyle = palette.tunic;
  ctx.beginPath();
  ctx.moveTo(x(-SHOULDER_HALF_WIDTH), shoulderY);
  ctx.lineTo(x(SHOULDER_HALF_WIDTH), shoulderY);
  ctx.lineTo(x(SHOULDER_HALF_WIDTH * 0.9), hemY);
  ctx.lineTo(x(-SHOULDER_HALF_WIDTH * 0.9), hemY);
  ctx.closePath();
  ctx.fill();

  // Shadow down the side the torso leans away from, so the bob has weight.
  ctx.fillStyle = palette.tunicShade;
  const shadeOnLeft = bob < 0;
  const shadeX = shadeOnLeft ? x(-SHOULDER_HALF_WIDTH) : x(SHOULDER_HALF_WIDTH * 0.72);
  ctx.fillRect(shadeX, shoulderY, w * (SHOULDER_HALF_WIDTH * 0.28), hemY - shoulderY);

  // Feet: bare, oversized, and almost entirely hidden by the counter. Drawn
  // anyway because the sprite is also used in the art review route.
  ctx.fillStyle = palette.skin;
  const footY = y(FOOT_LINE);
  ctx.beginPath();
  ctx.ellipse(x(-0.28), footY, w * 0.24, h * 0.03, 0, 0, Math.PI * 2);
  ctx.ellipse(x(0.28), footY, w * 0.24, h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawApron(
  ctx: CanvasRenderingContext2D,
  x: (f: number) => number,
  y: (f: number) => number,
  w: number,
  h: number,
  palette: BopcaPalette,
  bob: number,
): void {
  // The apron shifts opposite the torso, which is what gives the whole figure
  // the impression of mass rather than a rigid cut-out.
  const drift = -bob * APRON_COUNTERSWAY;
  const top = y(APRON_LINE) + drift;
  const bottom = y(HEM_LINE) + drift;
  const halfWidth = w * SHOULDER_HALF_WIDTH * 0.86;

  ctx.fillStyle = palette.apron;
  ctx.beginPath();
  ctx.moveTo(x(0) - halfWidth, top);
  ctx.lineTo(x(0) + halfWidth, top);
  ctx.lineTo(x(0) + halfWidth * 1.05, bottom);
  ctx.lineTo(x(0) - halfWidth * 1.05, bottom);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.apronDark;
  ctx.fillRect(x(0) - halfWidth, top, halfWidth * 2, h * 0.012);
  // Patch pocket, straight off the reference art.
  const pocketWidth = halfWidth * 0.5;
  ctx.fillRect(
    x(0) - halfWidth * 0.78,
    top + (bottom - top) * 0.28,
    pocketWidth,
    (bottom - top) * 0.4,
  );
}

function drawBeardAndJaw(
  ctx: CanvasRenderingContext2D,
  x: (f: number) => number,
  y: (f: number) => number,
  w: number,
  h: number,
  palette: BopcaPalette,
): void {
  // Jaw first: the beard is drawn over it and parts around the mouth, so the
  // skin has to already be there for the parting to show anything.
  ctx.fillStyle = palette.skin;
  ctx.beginPath();
  ctx.ellipse(
    x(0),
    y((BROW_LINE + SKULL_BOTTOM) / 2),
    w * SKULL_HALF_WIDTH,
    h * (SKULL_BOTTOM - BROW_LINE) * 0.7,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = palette.coatMid;
  const beardTop = y(NOSE_BOTTOM);
  const beardBottom = y(BEARD_BOTTOM);

  // The chin fall, filling the parting between the two side lobes. Without it
  // the apron shows through the gap as a bright wedge hanging off the mouth.
  ctx.beginPath();
  ctx.ellipse(
    x(0),
    y((MOUTH_LINE + BEARD_BOTTOM) / 2),
    w * BEARD_CHIN_HALF_WIDTH,
    h * (BEARD_BOTTOM - MOUTH_LINE) * 0.5,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x(side * MOUTH_HALF_WIDTH), beardTop);
    ctx.quadraticCurveTo(
      x(side * JAW_HALF_WIDTH * 1.3),
      beardTop + (beardBottom - beardTop) * 0.3,
      x(side * JAW_HALF_WIDTH * 0.5),
      beardBottom,
    );
    ctx.quadraticCurveTo(
      x(side * MOUTH_HALF_WIDTH * 0.4),
      beardBottom - (beardBottom - beardTop) * 0.2,
      x(side * MOUTH_HALF_WIDTH),
      beardTop,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Moustache. Kept off the mouth itself: the beard parts around the mouth in
  // the source art, and the mouth line is half the expression.
  ctx.fillStyle = palette.coatDark;
  ctx.beginPath();
  ctx.ellipse(
    x(0),
    y(MOUTH_LINE) - h * 0.012,
    w * JAW_HALF_WIDTH * 0.55,
    h * 0.022,
    0,
    Math.PI,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  x: (f: number) => number,
  y: (f: number) => number,
  w: number,
  h: number,
  palette: BopcaPalette,
  state: BopcaState,
  lookX: number,
  lookY: number,
  blinking: boolean,
): void {
  const sour = isSour(state);
  const warm = isWarm(state);
  const eyeY = y(EYE_LINE);

  for (const side of [-1, 1]) {
    const eyeX = x(side * EYE_OFFSET);
    ctx.fillStyle = EYE_WHITE;
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, w * EYE_RADIUS, h * EYE_RADIUS * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (blinking) {
      ctx.fillStyle = palette.skinShade;
      ctx.fillRect(
        eyeX - w * EYE_RADIUS,
        eyeY - h * BLINK_LID_HEIGHT,
        w * EYE_RADIUS * 2,
        h * BLINK_LID_HEIGHT * 2,
      );
    } else {
      ctx.fillStyle = PUPIL;
      ctx.beginPath();
      ctx.arc(
        eyeX + lookX * w * PUPIL_TRAVEL,
        eyeY + lookY * h * PUPIL_TRAVEL,
        w * PUPIL_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // Brow: one heavy overhanging bar per eye, tilted by mood. This is the single
  // clearest signal of whether the human or the cat is being served.
  const tilt = sour ? BROW_ANNOYED_TILT : warm ? BROW_PLEASED_TILT : BROW_NEUTRAL_TILT;
  const drop = sour ? h * BROW_ANNOYED_DROP : warm ? -h * BROW_PLEASED_LIFT : 0;
  const browY = y(BROW_LINE) + drop;
  ctx.fillStyle = palette.coatDarkest;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(x(side * EYE_OFFSET), browY);
    ctx.rotate(side * tilt);
    ctx.fillRect(
      -w * EYE_RADIUS * 1.6,
      -h * BROW_THICKNESS * 0.5,
      w * EYE_RADIUS * 3.2,
      h * BROW_THICKNESS,
    );
    ctx.restore();
  }

  // Broad flat nose. Skin on skin, so it needs its own shaded underside and a
  // lit bridge or it disappears entirely at a tile and a half tall.
  ctx.fillStyle = palette.skinShade;
  ctx.beginPath();
  ctx.moveTo(x(-NOSE_HALF_WIDTH * 0.5), y(NOSE_TOP));
  ctx.lineTo(x(NOSE_HALF_WIDTH * 0.5), y(NOSE_TOP));
  ctx.lineTo(x(NOSE_HALF_WIDTH), y(NOSE_BOTTOM));
  ctx.lineTo(x(-NOSE_HALF_WIDTH), y(NOSE_BOTTOM));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.skin;
  ctx.beginPath();
  ctx.moveTo(x(-NOSE_HALF_WIDTH * 0.35), y(NOSE_TOP));
  ctx.lineTo(x(NOSE_HALF_WIDTH * 0.35), y(NOSE_TOP));
  ctx.lineTo(x(NOSE_HALF_WIDTH * 0.6), y(NOSE_BOTTOM) - h * 0.012);
  ctx.lineTo(x(-NOSE_HALF_WIDTH * 0.6), y(NOSE_BOTTOM) - h * 0.012);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = NOSTRIL;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      x(side * NOSE_HALF_WIDTH * 0.55),
      y(NOSE_BOTTOM) - h * 0.006,
      w * 0.022,
      h * 0.008,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const curve = sour ? MOUTH_FROWN_CURVE : warm ? MOUTH_SMILE_CURVE : 0;
  ctx.strokeStyle = MOUTH_LINE_COLOR;
  ctx.lineWidth = Math.max(1, h * MOUTH_THICKNESS);
  ctx.beginPath();
  ctx.moveTo(x(-MOUTH_HALF_WIDTH), y(MOUTH_LINE));
  ctx.quadraticCurveTo(x(0), y(MOUTH_LINE) + h * curve, x(MOUTH_HALF_WIDTH), y(MOUTH_LINE));
  ctx.stroke();
}

function drawToque(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  h: number,
  w: number,
  palette: BopcaPalette,
  laggedBob: number,
  animFrames: number,
  bobRate: number,
): void {
  const top = baseY - h + h * TOQUE_TOP + laggedBob;
  const base = baseY - h + h * TOQUE_BASE + laggedBob;
  const halfWidth = w * TOQUE_HALF_WIDTH;
  const rock = Math.sin((animFrames - TOQUE_LAG_FRAMES) * bobRate) * TOQUE_ROCK_RADIANS;

  ctx.save();
  ctx.translate(cx, base);
  ctx.rotate(rock);

  // A soft folded crown that bulges past the band and flops to one side.
  const tipX = halfWidth * TOQUE_TIP_LEAN;
  const tipY = top - base;
  ctx.fillStyle = palette.tunic;
  ctx.beginPath();
  ctx.moveTo(-halfWidth, 0);
  ctx.bezierCurveTo(
    -halfWidth * TOQUE_CROWN_BULGE,
    tipY * 0.7,
    tipX - halfWidth * 0.6,
    tipY * 1.15,
    tipX,
    tipY,
  );
  ctx.bezierCurveTo(
    tipX + halfWidth * 0.7,
    tipY * 0.95,
    halfWidth * TOQUE_CROWN_BULGE,
    tipY * 0.55,
    halfWidth,
    0,
  );
  ctx.closePath();
  ctx.fill();

  // Fold creases, fanning from the band toward the flop.
  ctx.strokeStyle = palette.tunicShade;
  ctx.lineWidth = 1;
  for (let i = 1; i <= TOQUE_FOLD_COUNT; i++) {
    const along = i / (TOQUE_FOLD_COUNT + 1);
    const creaseX = -halfWidth + halfWidth * 2 * along;
    ctx.beginPath();
    ctx.moveTo(creaseX, 0);
    ctx.quadraticCurveTo(creaseX * 0.8 + tipX * 0.2, tipY * 0.45, tipX * along, tipY * 0.8);
    ctx.stroke();
  }

  ctx.fillStyle = palette.tunicShade;
  ctx.fillRect(-halfWidth, -h * TOQUE_BAND_HEIGHT, halfWidth * 2, h * TOQUE_BAND_HEIGHT * 2);
  ctx.restore();
}

/**
 * Hands and forearms. The pose is the state's whole tell above the counter, so
 * each one is a distinct silhouette rather than a variation on a wave.
 */
function drawArms(
  ctx: CanvasRenderingContext2D,
  x: (f: number) => number,
  y: (f: number) => number,
  w: number,
  h: number,
  palette: BopcaPalette,
  state: BopcaState,
  animFrames: number,
): void {
  const shoulderY = y(SHOULDER_LINE);

  /** One sleeve-and-hand, from the shoulder on `side` to a hand at (hx, hy). */
  const drawLimb = (side: number, hx: number, hy: number): void => {
    const shoulderX = x(side * SHOULDER_HALF_WIDTH * 0.8);
    ctx.strokeStyle = palette.tunic;
    ctx.lineWidth = w * ARM_HALF_WIDTH * 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    // Shaggy cuff where the sleeve ends — the arms are as hairy as the coat.
    ctx.fillStyle = palette.coatDark;
    ctx.beginPath();
    ctx.arc(
      hx - (hx - shoulderX) * 0.22,
      hy - (hy - shoulderY) * 0.22,
      w * HAND_RADIUS * 0.7,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.arc(hx, hy, w * HAND_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (state) {
    case 'cooking': {
      // Both hands over the back bench, the right one stirring a circle.
      const stir = animFrames * ARM_STIR_RATE;
      drawLimb(
        1,
        x(SHOULDER_HALF_WIDTH * 0.9) + Math.cos(stir) * w * ARM_STIR_RADIUS,
        y(SHOULDER_LINE + ARM_REST_DROP) + Math.sin(stir) * h * ARM_STIR_RADIUS,
      );
      drawLimb(-1, x(-SHOULDER_HALF_WIDTH * 0.95), y(SHOULDER_LINE + ARM_REST_DROP * 0.6));
      break;
    }
    case 'serving': {
      // One arm extended across the counter with a bowl on the palm.
      const handX = x(ARM_SERVE_REACH);
      const handY = y(SHOULDER_LINE + ARM_REST_DROP - ARM_SERVE_RISE);
      drawLimb(-1, x(-SHOULDER_HALF_WIDTH * 0.9), y(SHOULDER_LINE + ARM_REST_DROP));
      drawLimb(1, handX, handY);
      ctx.fillStyle = SERVING_BOWL_GLAZE;
      ctx.beginPath();
      ctx.ellipse(
        handX,
        handY - h * SERVING_BOWL_HEIGHT * 0.5,
        w * SERVING_BOWL_WIDTH * 0.5,
        h * SERVING_BOWL_HEIGHT * 0.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = SERVING_BOWL_CONTENT;
      ctx.beginPath();
      ctx.ellipse(
        handX,
        handY - h * SERVING_BOWL_HEIGHT * 0.7,
        w * SERVING_BOWL_WIDTH * 0.34,
        h * SERVING_BOWL_HEIGHT * 0.24,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }
    case 'leaning': {
      // Elbows planted wide on the counter, which is the posture of someone
      // who has been standing in the same spot for a very long time.
      for (const side of [-1, 1]) {
        drawLimb(
          side,
          x(side * (SHOULDER_HALF_WIDTH + ARM_LEAN_SPREAD)),
          y(SHOULDER_LINE + ARM_REST_DROP * 1.2),
        );
      }
      break;
    }
    case 'wipingHands': {
      const wipe = Math.sin(animFrames * ARM_WIPE_RATE) * w * ARM_WIPE_TRAVEL;
      for (const side of [-1, 1]) {
        drawLimb(side, x(side * ARM_BEARD_CLEARANCE) + wipe, y(ARM_WIPE_LINE));
      }
      break;
    }
    case 'readingNews': {
      const paperLeft = x(-NEWSLETTER_WIDTH * 0.5);
      const paperTop = y(SHOULDER_LINE + 0.04);
      for (const side of [-1, 1]) {
        drawLimb(side, x(side * NEWSLETTER_WIDTH * 0.55), y(SHOULDER_LINE + 0.1));
      }
      ctx.save();
      ctx.translate(paperLeft, paperTop);
      ctx.rotate(NEWSLETTER_TILT);
      ctx.fillStyle = NEWSLETTER_PAPER;
      ctx.fillRect(0, 0, w * NEWSLETTER_WIDTH, h * NEWSLETTER_HEIGHT);
      ctx.fillStyle = NEWSLETTER_INK;
      for (let line = 1; line <= NEWSLETTER_LINE_COUNT; line++) {
        const lineY = (h * NEWSLETTER_HEIGHT * line) / (NEWSLETTER_LINE_COUNT + 1);
        ctx.fillRect(w * NEWSLETTER_WIDTH * 0.1, lineY, w * NEWSLETTER_WIDTH * 0.8, 1);
      }
      ctx.restore();
      break;
    }
    case 'annoyed': {
      for (const side of [-1, 1]) {
        drawLimb(side, x(-side * ARM_BEARD_CLEARANCE), y(SHOULDER_LINE + ARM_REST_DROP));
      }
      break;
    }
    case 'pleased': {
      for (const side of [-1, 1]) {
        drawLimb(side, x(side * ARM_BEARD_CLEARANCE), y(SHOULDER_LINE + ARM_REST_DROP * 0.8));
      }
      break;
    }
    case 'idle': {
      for (const side of [-1, 1]) {
        drawLimb(side, x(side * SHOULDER_HALF_WIDTH * 0.85), y(SHOULDER_LINE + ARM_REST_DROP));
      }
      break;
    }
  }
  ctx.lineCap = 'butt';
}
