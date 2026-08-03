/**
 * The eight pieces a Lava Llama comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered llama's injuries are
 * recognisably the same ones a dismembered rat has. What is here is the shape
 * of each piece and the fleece on it.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. What has to be true
 * is that eight cells tumbling past at 16 px do not read as eight identical red
 * blobs, so the set is spread across a long woolly column (the neck — no other
 * creature in the bestiary drops anything that shape), a wedge with two long
 * banana ears (the head), a big fleeced slab (the torso), a bent L (the
 * haunch), a thin stick ending in a split foot (the leg), a pale ribbed arc
 * (the ribcage), a coiled rope (the entrails), and a ragged flat sheet (the
 * fleece).
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell — see `scripts/goreWound.ts` for what the runtime actually pivots on.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  TWO_PI,
  deg,
  hash1,
  lerp,
  mix,
  ovalOutline,
  paintWool,
  rgba,
  traceOutline,
  type Pt,
} from './llamaArt';
import {
  AMBIENT_ALPHA,
  BLOOD,
  BLOOD_DARK,
  BONE_CORTICAL,
  BONE_SHADOW,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  MUSCLE_DARK,
  MUSCLE_LIGHT,
  MUSCLE_MID,
  RIM_ALPHA,
  SUBCUTANEOUS,
  drawWound,
  grownOutline,
} from './goreWound';

// ── Llama tones, as seen on a severed piece ──────────────────────────────────

/**
 * Darker than the tones the live animal is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and fleece
 * painted at its standing brightness comes out reading as a pale rock.
 */
const FLEECE_MID = '#8a6440';
const FLEECE_DARK = '#3a2718';
const FLEECE_LIGHT = '#b78f60';
const HOOF_HORN = '#241a15';
const OUTLINE_INK = '#140f0b';
const EYE_DEAD = '#79695d';
const TOOTH_IVORY = '#ddd0b0';
const GUT_MID = '#a86a5c';
const GUT_DARK = '#5d3229';
const GUT_LIGHT = '#c99384';

/**
 * Lays one closed smooth loop into the *current* path without opening a new one.
 *
 * `traceOutline` cannot be used where two loops must share a path — it begins
 * its own — and a path with two loops is the only way to punch a hole with an
 * even-odd fill.
 */
function appendLoop(ctx: Ctx, pts: readonly Pt[]): void {
  const last = pts[pts.length - 1];
  const first = pts[0];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
}

/**
 * The ambient fill and rotation-safe rim every piece receives.
 *
 * The occlusion runs toward the middle rather than down from a key light: the
 * piece spins, so any single light direction is wrong most of the time.
 */
function paintMass(
  ctx: Ctx,
  trace: (grow: number) => void,
  mid: string,
  dark: string,
  light: string,
): void {
  ctx.fillStyle = OUTLINE_INK;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = mid;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(dark, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(light, AMBIENT_ALPHA * 1.4);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.save();
  trace(-FLESH_RIM_INSET);
  ctx.clip();
  ctx.strokeStyle = rgba(light, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
  ctx.restore();
}

function paintFleeceMass(ctx: Ctx, trace: (grow: number) => void): void {
  paintMass(ctx, trace, FLEECE_MID, FLEECE_DARK, FLEECE_LIGHT);
}

function paintMeat(ctx: Ctx, trace: (grow: number) => void): void {
  paintMass(ctx, trace, MUSCLE_MID, MUSCLE_DARK, MUSCLE_LIGHT);
}

/** Crimped wool over a piece, clipped to it. This is what says "llama". */
const WOOL_STROKES = 30;
const WOOL_STROKE_LEN = 0.026;
const WOOL_CRIMP_SEGMENTS = 4;
const WOOL_CRIMP_AMPLITUDE = 0.4;

function scribbleFleece(
  ctx: Ctx,
  trace: (grow: number) => void,
  seed: number,
  spread: number,
): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.007;
  for (let i = 0; i < WOOL_STROKES; i++) {
    const x = (hash1(seed + i) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 3.1 + 11) - 0.5) * 2 * spread;
    const angle = hash1(seed + i * 7.7) * TWO_PI;
    const len = WOOL_STROKE_LEN * (0.6 + hash1(seed + i * 5.3) * 0.8);
    ctx.strokeStyle = rgba(i % 3 === 0 ? FLEECE_LIGHT : FLEECE_DARK, 0.55);
    // Waved rather than straight: a straight stroke is a guard hair and reads
    // as a rodent's coat, which is the one thing this set must not look like.
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const phase = hash1(seed + i * 2.9) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 1; step <= WOOL_CRIMP_SEGMENTS; step++) {
      const t = step / WOOL_CRIMP_SEGMENTS;
      const along = len * t;
      const across = Math.sin(phase + t * Math.PI * 2) * len * WOOL_CRIMP_AMPLITUDE * t;
      ctx.lineTo(x + cos * along - sin * across, y + sin * along + cos * across);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A tapered capsule between two points, for the neck and the limb segments. */
function segmentOutline(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfA: number,
  halfB: number,
  seed: number,
): Pt[] {
  const angle = Math.atan2(by - ay, bx - ax);
  const nx = Math.cos(angle - Math.PI / 2);
  const ny = Math.sin(angle - Math.PI / 2);
  const STEPS = 12;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = lerp(ax, bx, t);
    const y = lerp(ay, by, t);
    const half = lerp(halfA, halfB, t) * (1 + 0.1 * Math.sin(t * 7 + seed));
    left.push({ x: x + nx * half, y: y + ny * half });
    right.push({ x: x - nx * half, y: y - ny * half });
  }
  return [...left, ...right.reverse()];
}

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const PIECE_SEED_BASE = 7717;

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, and never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be
 * applied to another and every piece would bake off-centre in its cell.
 */
export function llamaGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 977;

  const headFleeceSeed = nextSeed();
  const headWoundSeed = nextSeed();
  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      const SKULL_HALF_LENGTH = 0.11;
      const SKULL_HALF_DEPTH = 0.055;
      /**
       * The ears are drawn longer than the animal wears them in life. They are
       * the only thing that makes this piece a *head* rather than one more
       * rounded lump, and the set has two other rounded lumps in it.
       */
      const EAR_LENGTH = 0.15;
      const EAR_HALF_WIDTH = 0.026;

      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(-SKULL_HALF_LENGTH * 0.45, -SKULL_HALF_DEPTH * 0.5);
        ctx.rotate(side * deg(24) - deg(78));
        const ear = ovalOutline(
          0,
          -EAR_LENGTH / 2,
          EAR_HALF_WIDTH,
          EAR_LENGTH / 2,
          0,
          3.3 + side,
          0.1,
          20,
        );
        const traceEar = (grow: number): void => traceOutline(ctx, grownOutline(ear, grow));
        paintFleeceMass(ctx, traceEar);
        ctx.restore();
      }

      const skull = ovalOutline(0, 0, SKULL_HALF_LENGTH, SKULL_HALF_DEPTH, deg(8), 5.5, 0.09, 22);
      const traceSkull = (grow: number): void => traceOutline(ctx, grownOutline(skull, grow));
      paintFleeceMass(ctx, traceSkull);
      scribbleFleece(ctx, traceSkull, headFleeceSeed, SKULL_HALF_LENGTH * 0.8);

      // A dead eye and the bared incisors. Both are tiny and both earn their
      // pixels: they are what turn a lump into a face at a glance.
      ctx.fillStyle = EYE_DEAD;
      ctx.beginPath();
      ctx.ellipse(-SKULL_HALF_LENGTH * 0.1, -SKULL_HALF_DEPTH * 0.3, 0.017, 0.014, 0, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(OUTLINE_INK, 0.9);
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      ctx.moveTo(-SKULL_HALF_LENGTH * 0.26, -SKULL_HALF_DEPTH * 0.42);
      ctx.lineTo(SKULL_HALF_LENGTH * 0.06, -SKULL_HALF_DEPTH * 0.16);
      ctx.stroke();

      ctx.fillStyle = TOOTH_IVORY;
      ctx.fillRect(SKULL_HALF_LENGTH * 0.62, SKULL_HALF_DEPTH * 0.1, 0.03, 0.012);

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -SKULL_HALF_LENGTH * 0.86, y: SKULL_HALF_DEPTH * 0.2 },
        radius: 0.042,
        squash: 0.85,
        angle: deg(160),
        bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
        runAngle: deg(172),
        seed: headWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const neckFleeceSeed = nextSeed();
  const neckTopWoundSeed = nextSeed();
  const neckBaseWoundSeed = nextSeed();
  /**
   * The neck, and the piece the whole set is built around. Nothing else in the
   * bestiary drops a long woolly column, so this one cell identifies the corpse
   * as a llama's from across the room — which is the entire point of gore that
   * is legible at 16 px.
   */
  const neck: GorePiece = {
    state: 'gore_neck',
    paint: (ctx) => {
      const HALF_LENGTH = 0.16;
      const outline = segmentOutline(0, -HALF_LENGTH, 0.03, HALF_LENGTH, 0.036, 0.055, 2.1);
      const trace = (grow: number): void => traceOutline(ctx, grownOutline(outline, grow));
      paintFleeceMass(ctx, trace);
      scribbleFleece(ctx, trace, neckFleeceSeed, HALF_LENGTH * 0.8);

      // Cut at both ends: a column severed only once reads as a club.
      drawWound(ctx, {
        kind: 'clean',
        centre: { x: 0, y: -HALF_LENGTH * 0.94 },
        radius: 0.034,
        squash: 0.6,
        angle: deg(-90),
        bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
        runAngle: deg(-104),
        seed: neckTopWoundSeed,
        hide: FLEECE_DARK,
      });
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0.03, y: HALF_LENGTH * 0.94 },
        radius: 0.05,
        squash: 0.6,
        angle: deg(90),
        bones: [{ at: { x: 0, y: 0 }, size: 0.45, hollow: true }],
        runAngle: deg(78),
        seed: neckBaseWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const torsoFleeceSeed = nextSeed();
  const torsoWoundSeed = nextSeed();
  const torso: GorePiece = {
    state: 'gore_torso',
    paint: (ctx) => {
      const HALF_W = 0.17;
      const HALF_H = 0.115;
      const outline = ovalOutline(0, 0, HALF_W, HALF_H, deg(-6), 11.7, 0.11, 24);
      const trace = (grow: number): void => traceOutline(ctx, grownOutline(outline, grow));
      paintFleeceMass(ctx, trace);
      scribbleFleece(ctx, trace, torsoFleeceSeed, HALF_W * 0.8);

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: HALF_W * 0.5, y: HALF_H * 0.1 },
        radius: 0.062,
        squash: 0.9,
        angle: deg(12),
        bones: [
          { at: { x: -0.2, y: 0 }, size: 0.3, hollow: true },
          { at: { x: 0.35, y: 0.25 }, size: 0.24 },
        ],
        runAngle: deg(24),
        seed: torsoWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const haunchFleeceSeed = nextSeed();
  const haunchWoundSeed = nextSeed();
  /** A bent L: the quarter with a stub of leg still on it. */
  const haunch: GorePiece = {
    state: 'gore_haunch',
    paint: (ctx) => {
      const stub = segmentOutline(0.02, 0.0, 0.09, 0.15, 0.03, 0.021, 4.4);
      const traceStub = (grow: number): void => traceOutline(ctx, grownOutline(stub, grow));
      paintFleeceMass(ctx, traceStub);

      const quarter = ovalOutline(-0.03, -0.06, 0.105, 0.085, deg(-14), 8.8, 0.12, 22);
      const traceQuarter = (grow: number): void => traceOutline(ctx, grownOutline(quarter, grow));
      paintFleeceMass(ctx, traceQuarter);
      scribbleFleece(ctx, traceQuarter, haunchFleeceSeed, 0.09);

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -0.09, y: -0.11 },
        radius: 0.048,
        squash: 0.85,
        angle: deg(-140),
        bones: [{ at: { x: 0, y: 0 }, size: 0.44 }],
        runAngle: deg(-146),
        seed: haunchWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const legFleeceSeed = nextSeed();
  const legWoundSeed = nextSeed();
  /**
   * A whole leg: a long thin stick ending in the two-toed foot. The split foot
   * is the cue — it is the only thing in the set that could not have come off a
   * hooved animal, and it is why this piece is a *llama's* leg.
   */
  const leg: GorePiece = {
    state: 'gore_leg',
    paint: (ctx) => {
      const TOP_Y = -0.165;
      const FOOT_Y = 0.135;
      const shank = segmentOutline(-0.015, TOP_Y, 0.02, FOOT_Y, 0.032, 0.016, 6.6);
      const traceShank = (grow: number): void => traceOutline(ctx, grownOutline(shank, grow));
      paintFleeceMass(ctx, traceShank);
      scribbleFleece(ctx, traceShank, legFleeceSeed, 0.05);

      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(0.02 + side * 0.013, FOOT_Y);
        ctx.rotate(side * deg(12));
        ctx.fillStyle = OUTLINE_INK;
        ctx.beginPath();
        ctx.ellipse(0, 0.018, 0.016, 0.03, 0, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = HOOF_HORN;
        ctx.beginPath();
        ctx.ellipse(0, 0.016, 0.012, 0.026, 0, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -0.015, y: TOP_Y * 0.96 },
        radius: 0.036,
        squash: 0.6,
        angle: deg(-90),
        bones: [{ at: { x: 0, y: 0 }, size: 0.5 }],
        runAngle: deg(-96),
        seed: legWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const ribWoundSeed = nextSeed();
  /** A stripped section of ribcage: pale arcs on dark meat, the set's one bright piece. */
  const ribcage: GorePiece = {
    state: 'gore_ribcage',
    paint: (ctx) => {
      const HALF_W = 0.13;
      const HALF_H = 0.095;
      const slab = ovalOutline(0, 0, HALF_W, HALF_H, deg(10), 14.2, 0.14, 22);
      const traceSlab = (grow: number): void => traceOutline(ctx, grownOutline(slab, grow));
      paintMeat(ctx, traceSlab);

      ctx.save();
      traceSlab(0);
      ctx.clip();
      const RIB_COUNT = 5;
      ctx.lineCap = 'round';
      for (let i = 0; i < RIB_COUNT; i++) {
        const t = (i + 0.5) / RIB_COUNT;
        const x = lerp(-HALF_W * 0.85, HALF_W * 0.85, t);
        ctx.strokeStyle = i % 2 === 0 ? BONE_CORTICAL : mix(BONE_CORTICAL, BONE_SHADOW, 0.45);
        ctx.lineWidth = 0.019;
        ctx.beginPath();
        ctx.moveTo(x, -HALF_H * 0.9);
        ctx.quadraticCurveTo(x + 0.03, 0, x - 0.01, HALF_H * 0.9);
        ctx.stroke();
      }
      // The spine end the ribs spring from, so they read as a cage rather than
      // as a row of unconnected white sticks.
      ctx.strokeStyle = mix(BONE_CORTICAL, BONE_SHADOW, 0.2);
      ctx.lineWidth = 0.026;
      ctx.beginPath();
      ctx.moveTo(-HALF_W, -HALF_H * 0.72);
      ctx.lineTo(HALF_W, -HALF_H * 0.5);
      ctx.stroke();
      ctx.fillStyle = rgba(BLOOD_DARK, 0.5);
      ctx.fillRect(-HALF_W, HALF_H * 0.3, HALF_W * 2, HALF_H);
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -HALF_W * 0.72, y: HALF_H * 0.42 },
        radius: 0.042,
        squash: 0.9,
        angle: deg(-160),
        bones: [{ at: { x: 0, y: 0 }, size: 0.34, hollow: true }],
        runAngle: deg(-168),
        seed: ribWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const entrailsWoundSeed = nextSeed();
  /** A coiled rope of gut — the only piece in the set with a hole through it. */
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      const COIL_RADIUS = 0.105;
      const TUBE_HALF_WIDTH = 0.032;
      const COIL_STEPS = 26;
      const outer: Pt[] = [];
      const inner: Pt[] = [];
      for (let i = 0; i <= COIL_STEPS; i++) {
        const angle = (i / COIL_STEPS) * TWO_PI;
        const wobble = 1 + 0.16 * Math.sin(angle * 3 + 1.2) + 0.08 * Math.sin(angle * 7);
        const radius = COIL_RADIUS * wobble;
        outer.push({
          x: Math.cos(angle) * (radius + TUBE_HALF_WIDTH),
          y: Math.sin(angle) * (radius + TUBE_HALF_WIDTH) * 0.85,
        });
        inner.push({
          x: Math.cos(angle) * (radius - TUBE_HALF_WIDTH),
          y: Math.sin(angle) * (radius - TUBE_HALF_WIDTH) * 0.85,
        });
      }
      // Both loops go into ONE path. `traceOutline` opens a path of its own, so
      // calling it twice discards the first loop and the even-odd fill has
      // nothing to subtract — the coil bakes as a solid pink blob.
      const traceRing = (grow: number): void => {
        ctx.beginPath();
        appendLoop(ctx, grownOutline(outer, grow));
        appendLoop(ctx, grownOutline(inner, -grow));
      };
      // Even-odd so the inner loop punches a hole rather than filling it: the
      // hole is the whole silhouette, and without it this is a red disc.
      ctx.fillStyle = OUTLINE_INK;
      traceRing(FLESH_OUTLINE_GROW);
      ctx.fill('evenodd');
      ctx.fillStyle = GUT_MID;
      traceRing(0);
      ctx.fill('evenodd');

      ctx.save();
      traceRing(0);
      ctx.clip('evenodd');
      ctx.fillStyle = rgba(GUT_DARK, AMBIENT_ALPHA * 1.6);
      ctx.fillRect(-1, -1, 2, 2);
      // Segmentation bands, which is what makes a ring of meat read as bowel.
      const BAND_COUNT = 12;
      ctx.strokeStyle = rgba(GUT_DARK, 0.6);
      ctx.lineWidth = 0.008;
      for (let i = 0; i < BAND_COUNT; i++) {
        const angle = (i / BAND_COUNT) * TWO_PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * COIL_RADIUS * 0.6, Math.sin(angle) * COIL_RADIUS * 0.5);
        ctx.lineTo(Math.cos(angle) * COIL_RADIUS * 1.6, Math.sin(angle) * COIL_RADIUS * 1.35);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(GUT_LIGHT, 0.5);
      ctx.lineWidth = 0.01;
      traceOutline(ctx, inner);
      ctx.stroke();
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -COIL_RADIUS * 0.95, y: -COIL_RADIUS * 0.55 },
        radius: 0.038,
        squash: 0.95,
        angle: deg(-150),
        bones: [],
        runAngle: deg(-158),
        seed: entrailsWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  const fleeceScribbleSeed = nextSeed();
  const fleeceWoundSeed = nextSeed();
  /**
   * A sheared-off sheet of fleece, folded so the wet underside shows.
   *
   * It carries the only large area of unbroken wool in the set, which is what
   * stops eight tumbling cells of meat from reading as generic debris rather
   * than as an animal that had a coat on it.
   */
  const fleece: GorePiece = {
    state: 'gore_fleece',
    paint: (ctx) => {
      const HALF_W = 0.155;
      const HALF_H = 0.09;
      const sheet: Pt[] = [];
      const SHEET_STEPS = 16;
      for (let i = 0; i < SHEET_STEPS; i++) {
        const angle = (i / SHEET_STEPS) * TWO_PI;
        const ragged = 1 + 0.24 * Math.sin(angle * 5 + 1.7) + 0.13 * Math.sin(angle * 9);
        sheet.push({ x: Math.cos(angle) * HALF_W * ragged, y: Math.sin(angle) * HALF_H * ragged });
      }
      const traceSheet = (grow: number): void => traceOutline(ctx, grownOutline(sheet, grow));

      // The one piece painted with the live animal's own wool engine: a flat
      // sheet of hide is the only shape on which the lock fringe reads, and it
      // is what makes this cell unmistakably fleece rather than a brown chip.
      paintWool(ctx, {
        outline: sheet,
        blobs: [],
        base: 'saddle',
        seed: fleeceScribbleSeed,
        fringe: 0.026,
        strokes: 46,
        strokeLen: 0.03,
        flowFrom: { x: 0, y: 0 },
        shade: 0.3,
        crimp: 1,
      });

      ctx.save();
      traceSheet(0);
      ctx.clip();
      ctx.fillStyle = rgba(SUBCUTANEOUS, 0.85);
      ctx.beginPath();
      ctx.moveTo(HALF_W * 0.1, -HALF_H);
      ctx.quadraticCurveTo(HALF_W * 0.8, -HALF_H * 0.2, HALF_W, HALF_H);
      ctx.lineTo(HALF_W * 1.2, -HALF_H * 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(BLOOD, 0.55);
      ctx.lineWidth = 0.008;
      ctx.beginPath();
      ctx.moveTo(HALF_W * 0.1, -HALF_H);
      ctx.quadraticCurveTo(HALF_W * 0.8, -HALF_H * 0.2, HALF_W, HALF_H);
      ctx.stroke();
      ctx.restore();

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -HALF_W * 0.55, y: HALF_H * 0.3 },
        radius: 0.04,
        squash: 0.9,
        angle: deg(-150),
        bones: [{ at: { x: 0, y: 0 }, size: 0.3, hollow: true }],
        runAngle: deg(-158),
        seed: fleeceWoundSeed,
        hide: FLEECE_DARK,
      });
    },
  };

  return [head, neck, torso, haunch, leg, ribcage, entrails, fleece];
}
