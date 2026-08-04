/**
 * The nine pieces a Troglodyte comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered troglodyte's injuries are
 * recognisably the same ones a dismembered rat has. What is here is the shape
 * of each piece and the hide on it.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. What has to be
 * true is that nine cells tumbling past at 16 px do not read as nine
 * identical dark blobs, so the set is spread across a broad wedge of skull with
 * its jaw hanging open (nothing else in the bestiary drops a shape with teeth
 * along two edges), a heavy slab of trunk with the pale belly panel on it, a
 * long stick ending in a splayed webbed rake (the arm), a bent L ending in a
 * flat webbed paddle (the leg), a pale ribbed arc, a coiled rope with a hole
 * through it, a toothed comb of horn spines on a strip of hide (the crest),
 * a long whip with a bulb on the end — the tongue, which is the one piece a
 * player will recognise as this creature's and no other's — and a banded C of
 * a tail, curved where the arm is straight and the leg is bent.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell — see `scripts/goreWound.ts` for what the runtime actually pivots on.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { TWO_PI, deg, hash1, lerp, ovalOutline, rgba, traceOutline, type Pt } from './ratArt';
import { TONGUE_LIGHT, TONGUE_MID, VENOM_LIGHT, VENOM_MID } from './trogTongue';
import {
  AMBIENT_ALPHA,
  BONE_SHADOW,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  MUSCLE_MID,
  appendGoreLoop,
  drawWound,
  grownOutline,
  paintGoreMass,
} from './goreWound';

// ── Troglodyte tones, as seen on a severed piece ─────────────────────────────

/**
 * Darker than the tones the living creature is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and hide painted
 * at its standing brightness comes out reading as a pale grey stone.
 */
const HIDE_MID = '#6d8071';
const HIDE_DARK = '#2b352e';
const HIDE_LIGHT = '#94a693';
const BELLY_MID = '#a8a888';
const BELLY_DARK = '#5b5d47';
const BELLY_LIGHT = '#c8c4a4';
const HORN_MID = '#8b8e75';
const HORN_DARK = '#3f4437';
const HORN_LIGHT = '#b6b89c';
/**
 * The severed tongue and its venom head take the *living* tongue's tones, so a
 * dismembered one is recognisably the thing that just poisoned the player. Only
 * the darkest is local, because a piece is lit ambiently and needs a deeper
 * shadow than a lit sprite does.
 */
const TONGUE_DARK = '#3d1d24';
/** Duller than the tongue's red, so the coil does not out-shout seven other pieces. */
const GUT_MID = '#7f5b53';
const GUT_DARK = '#3d241f';
const GUT_LIGHT = '#a1786e';
/**
 * Not `BONE_CORTICAL`: at near-white the ribcage was the only piece in the set
 * a reviewer could name at in-game size, purely because it was the only one
 * with any contrast — which meant it read as a fishbone rather than as one
 * piece of a creature the other seven also came off.
 */
const BONE_MID = '#cfc4a8';
const BONE_LIGHT = '#e7ddc4';
const OUTLINE_INK = '#0b100d';
const TOOTH_IVORY = '#ddd5bb';
const EYE_DEAD = '#7d8474';

/** The living creature's tones, dulled to what a piece of it looks like. */
const HIDE_TONE = { mid: HIDE_MID, dark: HIDE_DARK, light: HIDE_LIGHT } as const;
const HORN_TONE = { mid: HORN_MID, dark: HORN_DARK, light: HORN_LIGHT } as const;
const BONE_TONE = { mid: BONE_MID, dark: BONE_SHADOW, light: BONE_LIGHT } as const;
const GUT_TONE = { mid: GUT_MID, dark: GUT_DARK, light: GUT_LIGHT } as const;
const TONGUE_TONE = { mid: TONGUE_MID, dark: TONGUE_DARK, light: TONGUE_LIGHT } as const;
const VENOM_TONE = { mid: VENOM_MID, dark: TONGUE_DARK, light: VENOM_LIGHT } as const;

function paintMass(
  ctx: Ctx,
  trace: (grow: number) => void,
  tone: { readonly mid: string; readonly dark: string; readonly light: string },
): void {
  paintGoreMass(ctx, trace, tone, OUTLINE_INK);
}

function paintHide(ctx: Ctx, trace: (grow: number) => void): void {
  paintMass(ctx, trace, HIDE_TONE);
}

/** Blotching over a piece of hide, clipped to it, with a wet streak or two. */
const BLOTCH_COUNT = 12;
const BLOTCH_ALPHA = 0.45;
const SLIME_STREAKS = 5;
const SLIME_ALPHA = 0.3;

function mottleHide(ctx: Ctx, trace: (grow: number) => void, seed: number, spread: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.globalAlpha = BLOTCH_ALPHA;
  ctx.fillStyle = HIDE_DARK;
  for (let i = 0; i < BLOTCH_COUNT; i++) {
    const x = (hash1(seed + i * 3.7) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 7.1 + 31) - 0.5) * 2 * spread;
    const rx = spread * (BLOTCH_MIN + hash1(seed + i * 11.3) * BLOTCH_RANGE);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * BLOTCH_SQUASH, hash1(seed + i * 2.3) * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  // A few bright wet streaks over the blotching, because a matte piece of hide
  // reads as leather and this creature's whole identity is that it is slick.
  ctx.globalAlpha = SLIME_ALPHA;
  ctx.strokeStyle = HIDE_LIGHT;
  ctx.lineWidth = spread * SLIME_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < SLIME_STREAKS; i++) {
    const x = (hash1(seed + i * 5.3 + 71) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 9.1 + 13) - 0.5) * 2 * spread;
    const angle = hash1(seed + i * 4.7) * TWO_PI;
    const len = spread * SLIME_LENGTH;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.restore();
}

const BLOTCH_MIN = 0.12;
const BLOTCH_RANGE = 0.22;
const BLOTCH_SQUASH = 0.62;
const SLIME_WIDTH = 0.07;
const SLIME_LENGTH = 0.4;

/** A tapered capsule between two points, for limb segments and the tongue. */
function segmentOutline(
  a: Pt,
  b: Pt,
  halfA: number,
  halfB: number,
  seed: number,
  steps = SEGMENT_STEPS,
): Pt[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.cos(angle - Math.PI / 2);
  const ny = Math.sin(angle - Math.PI / 2);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const half = lerp(halfA, halfB, t) * (1 + SEGMENT_WOBBLE * Math.sin(t * SEGMENT_LOBES + seed));
    left.push({ x: x + nx * half, y: y + ny * half });
    right.push({ x: x - nx * half, y: y - ny * half });
  }
  return [...left, ...right.reverse()];
}

const SEGMENT_STEPS = 12;
const SEGMENT_WOBBLE = 0.1;
const SEGMENT_LOBES = 7;

/**
 * Pulls a run of an outline's points inward, carving a bite out of one side.
 *
 * A severed trunk is not a closed convex lump — something came off it, and the
 * hole that leaves is most of what says "this was torn from a body" rather than
 * "this is a rock". It is also the only thing that keeps the trunk's silhouette
 * from scoring as the same shape as every other rounded piece in the set.
 *
 * `at` and `span` are fractions of the way round the outline; `depth` is how
 * far in, as a fraction of the point's own distance from the centre.
 */
function bittenOutline(
  outline: readonly Pt[],
  at: number,
  span: number,
  depth: number,
  seed: number,
): Pt[] {
  let sx = 0;
  let sy = 0;
  for (const p of outline) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / outline.length;
  const cy = sy / outline.length;
  return outline.map((p, i) => {
    const around = i / outline.length;
    const offBite = Math.abs(((around - at + 1.5) % 1) - 0.5);
    if (offBite > span / 2) return p;
    // Deepest in the middle of the bite and ragged along it, so the edge reads
    // as torn rather than as a clean scoop taken out with a spoon.
    const into =
      depth *
      Math.sin((1 - offBite / (span / 2)) * (Math.PI / 2)) *
      (1 - BITE_RAGGED * hash1(seed + i * 3.1));
    return { x: lerp(p.x, cx, into), y: lerp(p.y, cy, into) };
  });
}

const BITE_RAGGED = 0.45;

/** A chain of tapered capsules through a run of points — for a bent limb. */
function chainOutline(points: readonly Pt[], halves: readonly number[], seed: number): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const nx = Math.cos(angle - Math.PI / 2);
    const ny = Math.sin(angle - Math.PI / 2);
    const half = halves[i] * (1 + SEGMENT_WOBBLE * Math.sin(i * SEGMENT_LOBES + seed));
    left.push({ x: here.x + nx * half, y: here.y + ny * half });
    right.push({ x: here.x - nx * half, y: here.y - ny * half });
  }
  return [...left, ...right.reverse()];
}

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const PIECE_SEED_BASE = 5309;
const SEED_STEP = 977;

/**
 * The nine pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, and never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be
 * applied to another and every piece would bake off-centre in its cell.
 */
export function trogGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * SEED_STEP;

  const skullSeed = nextSeed();
  const skullMottleSeed = nextSeed();
  const skullWoundSeed = nextSeed();
  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      const SKULL_HALF_LENGTH = 0.135;
      const SKULL_HALF_DEPTH = 0.075;
      const JAW_HALF_LENGTH = 0.12;
      const JAW_HALF_DEPTH = 0.03;
      /** How far the dead jaw has fallen open, in radians. */
      const JAW_HANG = deg(38);

      // The mandible, hinged at the back of the skull and hanging open. It is
      // the reason this piece is not one more rounded lump: two toothed edges
      // meeting at a point is a shape nothing else in the set has.
      ctx.save();
      ctx.translate(-SKULL_HALF_LENGTH * 0.7, SKULL_HALF_DEPTH * 0.5);
      ctx.rotate(JAW_HANG);
      const jaw = ovalOutline(
        JAW_HALF_LENGTH * 0.9,
        0,
        JAW_HALF_LENGTH,
        JAW_HALF_DEPTH,
        0,
        skullSeed + 3,
        0.12,
        22,
      );
      const traceJaw = (grow: number): void => traceOutline(ctx, grownOutline(jaw, grow));
      paintHide(ctx, traceJaw);
      drawToothRow(ctx, JAW_HALF_LENGTH * 0.2, -JAW_HALF_DEPTH * 0.6, JAW_HALF_LENGTH * 1.5, -1);
      ctx.restore();

      const skull = ovalOutline(0, 0, SKULL_HALF_LENGTH, SKULL_HALF_DEPTH, 0, skullSeed, 0.11, 26);
      const traceSkull = (grow: number): void => traceOutline(ctx, grownOutline(skull, grow));
      paintHide(ctx, traceSkull);
      mottleHide(ctx, traceSkull, skullMottleSeed, SKULL_HALF_LENGTH);
      drawToothRow(
        ctx,
        -SKULL_HALF_LENGTH * 0.1,
        SKULL_HALF_DEPTH * 0.55,
        SKULL_HALF_LENGTH * 1.6,
        1,
      );

      // The blind eye, still open. A dead eye on a severed head is what makes
      // the piece land as a head rather than as a boot.
      ctx.beginPath();
      ctx.ellipse(
        SKULL_HALF_LENGTH * 0.28,
        -SKULL_HALF_DEPTH * 0.34,
        SKULL_HALF_DEPTH * 0.34,
        SKULL_HALF_DEPTH * 0.28,
        0,
        0,
        TWO_PI,
      );
      ctx.fillStyle = OUTLINE_INK;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        SKULL_HALF_LENGTH * 0.28,
        -SKULL_HALF_DEPTH * 0.34,
        SKULL_HALF_DEPTH * 0.22,
        SKULL_HALF_DEPTH * 0.18,
        0,
        0,
        TWO_PI,
      );
      ctx.fillStyle = EYE_DEAD;
      ctx.fill();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -SKULL_HALF_LENGTH * 0.7, y: SKULL_HALF_DEPTH * 0.1 },
        radius: 0.05,
        squash: 0.5,
        angle: deg(94),
        bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
        runAngle: deg(176),
        seed: skullWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const torsoSeed = nextSeed();
  const torsoMottleSeed = nextSeed();
  const torsoWoundSeed = nextSeed();
  const torso: GorePiece = {
    state: 'gore_torso',
    paint: (ctx) => {
      const TRUNK_HALF_WIDTH = 0.165;
      const TRUNK_HALF_HEIGHT = 0.115;

      const trunk = bittenOutline(
        ovalOutline(0, 0, TRUNK_HALF_WIDTH, TRUNK_HALF_HEIGHT, 0, torsoSeed, 0.13, 34),
        BITE_AT,
        BITE_SPAN,
        BITE_DEPTH,
        torsoSeed + 7,
      );
      const traceTrunk = (grow: number): void => traceOutline(ctx, grownOutline(trunk, grow));
      paintHide(ctx, traceTrunk);
      mottleHide(ctx, traceTrunk, torsoMottleSeed, TRUNK_HALF_WIDTH);

      // The pale ventral panel, which is the one marking that identifies this
      // slab as the front of a body rather than a piece of anything else.
      ctx.save();
      traceTrunk(0);
      ctx.clip();
      const panel = ovalOutline(
        TRUNK_HALF_WIDTH * 0.25,
        TRUNK_HALF_HEIGHT * 0.15,
        TRUNK_HALF_WIDTH * 0.55,
        TRUNK_HALF_HEIGHT * 0.6,
        0,
        torsoSeed + 5,
        0.14,
        22,
      );
      traceOutline(ctx, panel);
      ctx.fillStyle = BELLY_MID;
      ctx.fill();
      ctx.globalAlpha = BELLY_BAND_ALPHA;
      ctx.strokeStyle = BELLY_DARK;
      ctx.lineWidth = BELLY_BAND_WIDTH;
      for (let i = 1; i <= BELLY_BANDS; i++) {
        const x = lerp(-TRUNK_HALF_WIDTH * 0.2, TRUNK_HALF_WIDTH * 0.7, i / (BELLY_BANDS + 1));
        ctx.beginPath();
        ctx.moveTo(x, -TRUNK_HALF_HEIGHT * 0.5);
        ctx.lineTo(x, TRUNK_HALF_HEIGHT * 0.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(BELLY_LIGHT, BELLY_SHEEN_ALPHA);
      ctx.beginPath();
      ctx.ellipse(
        TRUNK_HALF_WIDTH * 0.25,
        -TRUNK_HALF_HEIGHT * 0.25,
        TRUNK_HALF_WIDTH * 0.18,
        TRUNK_HALF_HEIGHT * 0.2,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.restore();

      // A second, larger tear across the top edge. One neat wound on a closed
      // grey lump reads as a stone with a blemish; the piece has to be visibly
      // *opened*.
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: TRUNK_HALF_WIDTH * 0.42, y: -TRUNK_HALF_HEIGHT * 0.62 },
        radius: 0.062,
        squash: 0.5,
        angle: deg(14),
        bones: [{ at: { x: 0.1, y: 0 }, size: 0.24 }],
        runAngle: deg(-56),
        seed: torsoWoundSeed + 1,
        hide: HIDE_DARK,
      });
      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -TRUNK_HALF_WIDTH * 0.4, y: -TRUNK_HALF_HEIGHT * 0.5 },
        radius: 0.056,
        squash: 0.62,
        angle: deg(-24),
        bones: [
          { at: { x: -0.35, y: 0.1 }, size: 0.26 },
          { at: { x: 0.4, y: -0.05 }, size: 0.22 },
        ],
        runAngle: deg(-108),
        seed: torsoWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const armSeed = nextSeed();
  const armWoundSeed = nextSeed();
  const arm: GorePiece = {
    state: 'gore_arm',
    paint: (ctx) => {
      const UPPER_END: Pt = { x: -0.01, y: -0.115 };
      const ELBOW: Pt = { x: 0.055, y: 0.005 };
      const WRIST: Pt = { x: 0.005, y: 0.105 };
      const FINGER_COUNT = 3;
      /** Long, splayed and rake-like — the opposite read to the leg's paddle. */
      const FINGER_LENGTH = 0.135;
      const FINGER_HALF = 0.011;
      const FINGER_FAN = deg(42);

      // The hand first, so the arm's own outline lands on top of the webbing.
      const fingerTips: Pt[] = [];
      for (let i = 0; i < FINGER_COUNT; i++) {
        const angle = deg(96) + lerp(-1, 1, i / (FINGER_COUNT - 1)) * FINGER_FAN;
        fingerTips.push({
          x: WRIST.x + Math.cos(angle) * FINGER_LENGTH,
          y: WRIST.y + Math.sin(angle) * FINGER_LENGTH,
        });
      }
      ctx.beginPath();
      ctx.moveTo(WRIST.x, WRIST.y);
      for (const tip of fingerTips) {
        ctx.lineTo(lerp(WRIST.x, tip.x, WEB_SHARE), lerp(WRIST.y, tip.y, WEB_SHARE));
      }
      ctx.closePath();
      ctx.fillStyle = OUTLINE_INK;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(WRIST.x, WRIST.y);
      for (const tip of fingerTips) {
        ctx.lineTo(
          lerp(WRIST.x, tip.x, WEB_SHARE * WEB_INSET),
          lerp(WRIST.y, tip.y, WEB_SHARE * WEB_INSET),
        );
      }
      ctx.closePath();
      ctx.fillStyle = BELLY_DARK;
      ctx.fill();
      for (const tip of fingerTips) {
        const finger = segmentOutline(WRIST, tip, FINGER_HALF, FINGER_HALF * 0.6, armSeed, 6);
        const traceFinger = (grow: number): void => traceOutline(ctx, grownOutline(finger, grow));
        paintHide(ctx, traceFinger);
      }
      for (const tip of fingerTips) {
        const claw = segmentOutline(
          tip,
          { x: tip.x + (tip.x - WRIST.x) * CLAW_REACH, y: tip.y + (tip.y - WRIST.y) * CLAW_REACH },
          FINGER_HALF * 0.8,
          FINGER_HALF * 0.15,
          armSeed + 2,
          5,
        );
        const traceClaw = (grow: number): void => traceOutline(ctx, grownOutline(claw, grow));
        paintMass(ctx, traceClaw, HORN_TONE);
      }

      const limb = chainOutline([UPPER_END, ELBOW, WRIST], [0.035, 0.028, 0.02], armSeed);
      const traceLimb = (grow: number): void => traceOutline(ctx, grownOutline(limb, grow));
      paintHide(ctx, traceLimb);
      mottleHide(ctx, traceLimb, armSeed, 0.09);

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: UPPER_END.x, y: UPPER_END.y + 0.014 },
        radius: 0.04,
        squash: 0.55,
        angle: deg(-72),
        bones: [{ at: { x: 0, y: 0 }, size: 0.4 }],
        runAngle: deg(-84),
        seed: armWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const legSeed = nextSeed();
  const legWoundSeed = nextSeed();
  const leg: GorePiece = {
    state: 'gore_leg',
    paint: (ctx) => {
      // Half again the arm's span and folded the other way, because at the size
      // these tumble at the only thing that separates two limbs is how long
      // they are and which way they bend.
      const HIP_END: Pt = { x: -0.115, y: -0.185 };
      const KNEE: Pt = { x: 0.105, y: -0.015 };
      const ANKLE: Pt = { x: -0.045, y: 0.145 };
      const TOE_COUNT = 3;
      const TOE_LENGTH = 0.055;
      const TOE_HALF = 0.012;
      const TOE_FAN = deg(52);

      const toeTips: Pt[] = [];
      for (let i = 0; i < TOE_COUNT; i++) {
        const angle = deg(112) + lerp(-1, 1, i / (TOE_COUNT - 1)) * TOE_FAN;
        toeTips.push({
          x: ANKLE.x + Math.cos(angle) * TOE_LENGTH,
          y: ANKLE.y + Math.sin(angle) * TOE_LENGTH,
        });
      }
      // The foot is drawn as one webbed paddle rather than as separate toes:
      // the flat splayed shape is what tells this piece apart from the arm,
      // which is the same stick with a splayed rake on the end.
      ctx.beginPath();
      ctx.moveTo(ANKLE.x, ANKLE.y);
      for (const tip of toeTips) ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fillStyle = OUTLINE_INK;
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ANKLE.x, ANKLE.y);
      for (const tip of toeTips) {
        ctx.lineTo(lerp(ANKLE.x, tip.x, FOOT_WEB_INSET), lerp(ANKLE.y, tip.y, FOOT_WEB_INSET));
      }
      ctx.closePath();
      ctx.fillStyle = BELLY_DARK;
      ctx.fill();
      ctx.restore();
      for (const tip of toeTips) {
        const toe = segmentOutline(ANKLE, tip, TOE_HALF, TOE_HALF * 0.6, legSeed, 6);
        const traceToe = (grow: number): void => traceOutline(ctx, grownOutline(toe, grow));
        paintHide(ctx, traceToe);
      }

      const limb = chainOutline([HIP_END, KNEE, ANKLE], [0.058, 0.036, 0.026], legSeed);
      const traceLimb = (grow: number): void => traceOutline(ctx, grownOutline(limb, grow));
      paintHide(ctx, traceLimb);
      mottleHide(ctx, traceLimb, legSeed, 0.1);

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: HIP_END.x + 0.012, y: HIP_END.y + 0.018 },
        radius: 0.052,
        squash: 0.6,
        angle: deg(-46),
        bones: [{ at: { x: 0, y: 0 }, size: 0.44 }],
        runAngle: deg(-140),
        seed: legWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const ribSeed = nextSeed();
  const ribWoundSeed = nextSeed();
  const ribcage: GorePiece = {
    state: 'gore_ribcage',
    paint: (ctx) => {
      const SPINE_HALF = 0.16;
      /** Rib *pairs* — one to each side of the spine, like a real basket. */
      const RIB_PAIRS = 4;
      const RIB_REACH = 0.115;
      const RIB_HALF = 0.012;
      /** How far the spine itself bows. A straight one is a fishbone. */
      const SPINE_BOW = 0.045;

      /** A point `t` of the way down the bowed spine, 0 at the neck end. */
      const spineAt = (t: number): Pt => ({
        x: Math.sin(t * Math.PI) * SPINE_BOW,
        y: lerp(-SPINE_HALF, SPINE_HALF, t),
      });

      // Ribs first, so the spine they hang off closes the basket's inner edge.
      //
      // In *pairs*, branching off the spine at a shallow angle and curving back
      // toward each other so the cavity between them is visible. Fanned from a
      // single point on one side — which is what the first pass drew — the
      // piece reads as a broom, and a blind naming test duly called it one.
      for (let pair = 0; pair < RIB_PAIRS; pair++) {
        const t = lerp(RIB_TOP, RIB_BOTTOM, pair / (RIB_PAIRS - 1));
        const root = spineAt(t);
        for (const side of [-1, 1]) {
          const sweep = deg(-90) + side * lerp(RIB_SPLAY_TOP, RIB_SPLAY_BOTTOM, t);
          // Uneven, and unevenly between the two sides: a smooth gradient of
          // identical spurs down a bar is a centipede, which is what a blind
          // naming test called this before the lengths were broken up.
          const jitter =
            RIB_LENGTH_JITTER[(pair * 2 + (side > 0 ? 1 : 0)) % RIB_LENGTH_JITTER.length];
          const reach = RIB_REACH * lerp(1, RIB_TAPER, t) * jitter;
          const elbow: Pt = {
            x: root.x + Math.cos(sweep) * reach * RIB_ELBOW_AT,
            y: root.y - Math.sin(sweep) * reach * RIB_ELBOW_AT * RIB_CURVE,
          };
          const tip: Pt = {
            x: elbow.x + Math.cos(sweep + side * RIB_HOOK) * reach * (1 - RIB_ELBOW_AT),
            y: elbow.y - Math.sin(sweep + side * RIB_HOOK) * reach * (1 - RIB_ELBOW_AT) * RIB_CURVE,
          };
          const rib = chainOutline(
            [root, elbow, tip],
            [RIB_HALF, RIB_HALF * 0.85, RIB_HALF * 0.6],
            ribSeed + pair * 2 + side,
          );
          const traceRib = (grow: number): void => traceOutline(ctx, grownOutline(rib, grow));
          paintMass(ctx, traceRib, BONE_TONE);
        }
      }

      // Bowed into a C, not a straight bar: a straight spine with things
      // sticking off one side is the same shape as the severed crest strip, and
      // at the size these tumble at that is the only thing telling them apart.
      // Thick enough to be the long axis of the piece rather than a hairline
      // buried under the ribs hanging off it.
      const spine = chainOutline(
        [spineAt(0), spineAt(0.5), spineAt(1)],
        [0.028, 0.032, 0.024],
        ribSeed,
      );
      const traceSpine = (grow: number): void => traceOutline(ctx, grownOutline(spine, grow));
      paintMass(ctx, traceSpine, BONE_TONE);

      // Shreds of muscle still on the bone, or this is a museum exhibit.
      ctx.save();
      ctx.globalAlpha = SHRED_ALPHA;
      ctx.fillStyle = MUSCLE_MID;
      for (let i = 0; i < SHRED_COUNT; i++) {
        const along = spineAt(hash1(ribSeed + i * 3.3 + 17));
        const x = along.x + hash1(ribSeed + i * 6.1) * RIB_REACH * 0.8;
        const y = along.y;
        ctx.beginPath();
        ctx.ellipse(x, y, SHRED_RX, SHRED_RY, hash1(ribSeed + i) * Math.PI, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: spineAt(0).x, y: -SPINE_HALF * 0.78 },
        radius: 0.036,
        squash: 0.5,
        angle: deg(90),
        bones: [{ at: { x: 0, y: 0 }, size: 0.5, hollow: true }],
        runAngle: deg(-96),
        seed: ribWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const gutSeed = nextSeed();
  const gutWoundSeed = nextSeed();
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      const COIL_RADIUS = 0.088;
      const ROPE_HALF = 0.042;
      /** The second, tighter loop, and how far below the first it sits. */
      const SMALL_LOOP_SHARE = 0.7;
      const SMALL_LOOP_DROP = 0.125;
      /** And how far across, so the pair lies diagonally rather than stacking. */
      const SMALL_LOOP_SIDE = 0.13;

      /**
       * Two loops of gut, not one ring.
       *
       * A single closed ring is caught between two things it cannot both be:
       * with a hole big enough to tell it from the trunk slab it silhouettes as
       * a letter O, and with the hole closed enough to read as viscera it
       * scores as the same mask as the slab. Two overlapping rings are neither.
       *
       * Filled by the **nonzero** rule with the inner loops wound backwards,
       * not by even-odd. Even-odd counts crossings, so where the two rings
       * overlap the parity comes out even and the overlap is left *unpainted* —
       * a crescent hole through the middle of the piece and an orphaned island
       * of fill inside it. Winding the holes the other way unions the rings and
       * still cuts both holes, which is the shape this is meant to be.
       */
      const loopAt = (
        cx: number,
        cy: number,
        scale: number,
        seed: number,
      ): { outer: Pt[]; inner: Pt[] } => ({
        outer: ovalOutline(
          cx,
          cy,
          (COIL_RADIUS + ROPE_HALF) * COIL_NARROW * scale,
          (COIL_RADIUS + ROPE_HALF) * scale,
          0,
          seed,
          0.16,
          26,
        ),
        inner: ovalOutline(
          cx,
          cy,
          (COIL_RADIUS - ROPE_HALF) * COIL_NARROW * scale,
          (COIL_RADIUS - ROPE_HALF) * scale,
          0,
          seed + 4,
          0.2,
          22,
        ),
      });
      const loops = [
        loopAt(0, 0, 1, gutSeed),
        loopAt(SMALL_LOOP_SIDE, SMALL_LOOP_DROP, SMALL_LOOP_SHARE, gutSeed + 11),
      ];
      const traceRing = (grow: number): void => {
        ctx.beginPath();
        for (const loop of loops) {
          appendGoreLoop(ctx, grownOutline(loop.outer, grow));
          appendGoreLoop(ctx, [...grownOutline(loop.inner, -grow)].reverse());
        }
      };
      ctx.save();
      const paintRing = (fill: string, grow: number): void => {
        traceRing(grow);
        ctx.fillStyle = fill;
        ctx.fill();
      };
      paintRing(OUTLINE_INK, FLESH_OUTLINE_GROW);
      paintRing(GUT_MID, 0);
      // The ambient inset has to be capped at *this band's* own thickness, not
      // taken at the flesh default. The band is narrower across than it is
      // tall, so an isotropic inset that fits the tall axis makes the two loops
      // cross on the narrow one — and an even-odd fill then puts the highlight
      // into the hole and leaves it out of the gut.
      const bandInset = Math.min(
        FLESH_AMBIENT_INSET,
        ROPE_HALF * COIL_NARROW * SMALL_LOOP_SHARE * BAND_INSET_SHARE,
      );
      ctx.globalAlpha = AMBIENT_ALPHA * COIL_HIGHLIGHT_GAIN;
      paintRing(GUT_LIGHT, -bandInset);
      ctx.restore();

      // Constrictions along the gut, which is what makes it a bowel rather
      // than a doughnut.
      ctx.save();
      traceRing(0);
      ctx.clip();
      ctx.globalAlpha = GUT_BAND_ALPHA;
      ctx.strokeStyle = GUT_DARK;
      ctx.lineWidth = GUT_BAND_WIDTH;
      for (let i = 0; i < GUT_BANDS; i++) {
        const angle = (i / GUT_BANDS) * TWO_PI + hash1(gutSeed + i) * GUT_BAND_JITTER;
        ctx.beginPath();
        ctx.moveTo(
          Math.cos(angle) * (COIL_RADIUS - ROPE_HALF * 1.4) * COIL_NARROW,
          Math.sin(angle) * (COIL_RADIUS - ROPE_HALF * 1.4),
        );
        ctx.lineTo(
          Math.cos(angle) * (COIL_RADIUS + ROPE_HALF * 1.4) * COIL_NARROW,
          Math.sin(angle) * (COIL_RADIUS + ROPE_HALF * 1.4),
        );
        ctx.stroke();
      }
      ctx.restore();

      // A second length of gut passing *over* the ring. One closed circle has
      // no crossings and reads as a doughnut; the overlap is the whole reason
      // this piece is legible as viscera.
      // The loose end trails out past the ring, which is what makes the piece
      // read as gut rather than as one more rounded lump the size of the trunk.
      const crossing = segmentOutline(
        { x: -COIL_RADIUS * COIL_NARROW * 1.1, y: COIL_RADIUS * 0.8 },
        { x: COIL_RADIUS * COIL_NARROW * 0.5, y: -COIL_RADIUS * COIL_TAIL_REACH },
        ROPE_HALF * 0.95,
        ROPE_HALF * 0.55,
        gutSeed + 9,
      );
      const traceCrossing = (grow: number): void => traceOutline(ctx, grownOutline(crossing, grow));
      paintMass(ctx, traceCrossing, GUT_TONE);

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0, y: -COIL_RADIUS * 0.98 },
        radius: 0.038,
        squash: 0.7,
        angle: 0,
        bones: [],
        runAngle: deg(-90),
        seed: gutWoundSeed,
        hide: GUT_DARK,
      });
    },
  };

  const crestSeed = nextSeed();
  const crestWoundSeed = nextSeed();
  const crest: GorePiece = {
    state: 'gore_crest',
    paint: (ctx) => {
      // Laid across the cell rather than up it. The ribcage is also a spine
      // with things sticking off it, and aspect is the only cue that survives
      // the size these tumble at.
      const STRIP_HALF = 0.155;
      const STRIP_THICK = 0.042;
      const SPINE_COUNT = CREST_PIECE_STOPS.length;
      const SPINE_MAX = 0.078;
      const SPINE_HALF = 0.023;

      for (let i = 0; i < SPINE_COUNT; i++) {
        const t = CREST_PIECE_STOPS[i];
        const root: Pt = { x: lerp(-STRIP_HALF, STRIP_HALF, t), y: 0 };
        const height = SPINE_MAX * CREST_PIECE_HEIGHTS[i];
        const tip: Pt = { x: root.x - height * CREST_RAKE, y: root.y - height };
        const spine = segmentOutline(root, tip, SPINE_HALF, SPINE_HALF * 0.12, crestSeed + i, 6);
        const traceSpine = (grow: number): void => traceOutline(ctx, grownOutline(spine, grow));
        paintMass(ctx, traceSpine, HORN_TONE);
      }

      const strip = segmentOutline(
        { x: -STRIP_HALF, y: STRIP_THICK * 0.4 },
        { x: STRIP_HALF, y: STRIP_THICK * 0.4 },
        STRIP_THICK,
        STRIP_THICK * 0.8,
        crestSeed,
        10,
      );
      const traceStrip = (grow: number): void => traceOutline(ctx, grownOutline(strip, grow));
      paintHide(ctx, traceStrip);
      mottleHide(ctx, traceStrip, crestSeed, STRIP_HALF * 0.5);

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -STRIP_HALF * 0.72, y: STRIP_THICK * 0.4 },
        radius: 0.052,
        squash: 0.45,
        angle: deg(8),
        bones: [],
        runAngle: deg(190),
        seed: crestWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const tongueSeed = nextSeed();
  const tongueWoundSeed = nextSeed();
  const tongue: GorePiece = {
    state: 'gore_tongue',
    paint: (ctx) => {
      const ROOT: Pt = { x: -0.085, y: -0.185 };
      const BEND: Pt = { x: 0.02, y: -0.01 };
      const CLUB: Pt = { x: 0.075, y: 0.185 };
      const CLUB_RADIUS = 0.048;

      const whip = chainOutline([ROOT, BEND, CLUB], [0.04, 0.03, 0.022], tongueSeed);
      const traceWhip = (grow: number): void => traceOutline(ctx, grownOutline(whip, grow));
      paintMass(ctx, traceWhip, TONGUE_TONE);

      // The venom club on the end. It is the whole reason this piece is
      // legible: a bare whip is a length of rope, and the bulb says which end
      // of it went into somebody.
      const club = ovalOutline(
        CLUB.x,
        CLUB.y,
        CLUB_RADIUS,
        CLUB_RADIUS * CLUB_SQUASH,
        deg(70),
        tongueSeed + 3,
        0.14,
        20,
      );
      const traceClub = (grow: number): void => traceOutline(ctx, grownOutline(club, grow));
      paintMass(ctx, traceClub, VENOM_TONE);

      ctx.save();
      traceClub(0);
      ctx.clip();
      ctx.globalAlpha = VENOM_BEAD_ALPHA;
      ctx.fillStyle = VENOM_LIGHT;
      for (let i = 0; i < VENOM_BEADS; i++) {
        const x = CLUB.x + (hash1(tongueSeed + i * 4.9) - 0.5) * CLUB_RADIUS * 1.6;
        const y = CLUB.y + (hash1(tongueSeed + i * 8.3 + 23) - 0.5) * CLUB_RADIUS * 1.6;
        ctx.beginPath();
        ctx.arc(x, y, CLUB_RADIUS * VENOM_BEAD_R, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();

      // Barbs down the last third — the hooks that hold a bite in.
      ctx.save();
      ctx.fillStyle = HORN_MID;
      for (let i = 0; i < BARB_COUNT; i++) {
        const t = lerp(BARB_FROM, 1, (i + 0.5) / BARB_COUNT);
        const along = { x: lerp(BEND.x, CLUB.x, t), y: lerp(BEND.y, CLUB.y, t) };
        const side = i % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(along.x, along.y);
        ctx.lineTo(along.x + BARB_LENGTH * side, along.y - BARB_LENGTH * 0.4);
        ctx.lineTo(along.x + BARB_LENGTH * 0.25 * side, along.y + BARB_LENGTH * 0.35);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: ROOT.x, y: ROOT.y + 0.016 },
        radius: 0.034,
        squash: 0.55,
        angle: deg(-78),
        bones: [],
        runAngle: deg(-96),
        seed: tongueWoundSeed,
        hide: TONGUE_DARK,
      });
    },
  };

  const tailSeed = nextSeed();
  const tailWoundSeed = nextSeed();
  const tail: GorePiece = {
    state: 'gore_tail',
    paint: (ctx) => {
      // A deep C laid across the cell. The arm and the leg are the other two
      // long pieces here: the arm is a straight stick and the leg a bent L, so
      // this one has to be neither — a continuous curve is the only long shape
      // left, and it is also what a shed tail actually does.
      const ROOT: Pt = { x: -0.055, y: -0.175 };
      const HAUNCH: Pt = { x: 0.115, y: -0.055 };
      const BEND: Pt = { x: 0.085, y: 0.105 };
      const TIP: Pt = { x: -0.075, y: 0.185 };
      const SPINE: readonly Pt[] = [ROOT, HAUNCH, BEND, TIP];
      const BAND_COUNT = 5;
      const SCUTE_COUNT = 4;
      const SCUTE_HEIGHT = 0.03;
      const SCUTE_HALF = 0.011;

      /** A point `t` of the way along the tail, and the heading there. */
      const alongTail = (t: number): { at: Pt; heading: number } => {
        const spanCount = SPINE.length - 1;
        const index = Math.min(spanCount - 1, Math.floor(t * spanCount));
        const within = t * spanCount - index;
        const from = SPINE[index];
        const to = SPINE[index + 1];
        return {
          at: { x: lerp(from.x, to.x, within), y: lerp(from.y, to.y, within) },
          heading: Math.atan2(to.y - from.y, to.x - from.x),
        };
      };

      const trunk = chainOutline(SPINE, [0.052, 0.036, 0.023, 0.007], tailSeed);
      const traceTrunk = (grow: number): void => traceOutline(ctx, grownOutline(trunk, grow));
      paintHide(ctx, traceTrunk);
      mottleHide(ctx, traceTrunk, tailSeed, 0.1);

      // Scutes along the outer edge of the curve, which is the edge a tail
      // carries them on and the one the silhouette actually shows.
      ctx.fillStyle = HORN_MID;
      ctx.strokeStyle = OUTLINE_INK;
      ctx.lineWidth = 0.004;
      for (let i = 0; i < SCUTE_COUNT; i++) {
        const t = lerp(0.08, 0.62, i / (SCUTE_COUNT - 1));
        const { at, heading } = alongTail(t);
        const out = heading - Math.PI / 2;
        const height = SCUTE_HEIGHT * lerp(1, 0.45, t);
        const half = SCUTE_HALF * lerp(1, 0.5, t);
        ctx.beginPath();
        ctx.moveTo(at.x + Math.cos(heading) * half, at.y + Math.sin(heading) * half);
        ctx.lineTo(at.x + Math.cos(out) * height, at.y + Math.sin(out) * height);
        ctx.lineTo(at.x - Math.cos(heading) * half, at.y - Math.sin(heading) * half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.save();
      traceTrunk(0);
      ctx.clip();
      ctx.globalAlpha = TAIL_BAND_ALPHA;
      ctx.strokeStyle = HIDE_DARK;
      ctx.lineWidth = TAIL_BAND_WIDTH;
      for (let i = 0; i < BAND_COUNT; i++) {
        const t = lerp(0.16, 0.86, i / (BAND_COUNT - 1));
        const { at, heading } = alongTail(t);
        const across = heading + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(
          at.x + Math.cos(across) * TAIL_BAND_REACH,
          at.y + Math.sin(across) * TAIL_BAND_REACH,
        );
        ctx.lineTo(
          at.x - Math.cos(across) * TAIL_BAND_REACH,
          at.y - Math.sin(across) * TAIL_BAND_REACH,
        );
        ctx.stroke();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: ROOT.x - 0.004, y: ROOT.y + 0.012 },
        radius: 0.05,
        squash: 0.62,
        angle: deg(-38),
        bones: [{ at: { x: 0, y: 0 }, size: 0.42 }],
        runAngle: deg(-128),
        seed: tailWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  return [head, torso, arm, leg, ribcage, entrails, crest, tongue, tail];
}

const TAIL_BAND_ALPHA = 0.55;
const TAIL_BAND_WIDTH = 0.005;
/** Past the tail's own half-width in both directions; the clip trims it. */
const TAIL_BAND_REACH = 0.06;

/**
 * A row of needle teeth along a jaw edge. `side` is +1 for teeth hanging down
 * from an upper jaw and −1 for a lower jaw's, which point up.
 */
function drawToothRow(ctx: Ctx, x: number, y: number, span: number, side: number): void {
  const count = TOOTH_ROW_COUNT;
  const pitch = span / count;
  ctx.fillStyle = TOOTH_IVORY;
  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = TOOTH_OUTLINE;
  for (let i = 0; i < count; i++) {
    const cx = x + (i + 0.5) * pitch - span / 2;
    const length = pitch * TOOTH_LENGTH_SHARE * (1 - Math.abs(i / (count - 1) - 0.5) * TOOTH_TAPER);
    ctx.beginPath();
    ctx.moveTo(cx - pitch * TOOTH_HALF_SHARE, y);
    ctx.lineTo(cx + pitch * TOOTH_HALF_SHARE, y);
    ctx.lineTo(cx, y + length * side);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

const TOOTH_ROW_COUNT = 6;
const TOOTH_LENGTH_SHARE = 1.3;
const TOOTH_HALF_SHARE = 0.34;
const TOOTH_TAPER = 0.8;
const TOOTH_OUTLINE = 0.004;
const WEB_SHARE = 0.68;
const WEB_INSET = 0.9;
const CLAW_REACH = 0.34;
const FOOT_WEB_INSET = 0.92;
const BELLY_BANDS = 3;
const BELLY_BAND_ALPHA = 0.4;
const BELLY_BAND_WIDTH = 0.008;
const BELLY_SHEEN_ALPHA = 0.35;
/** Where round the trunk the missing limb tore it open, and how far in. */
const BITE_AT = 0.62;
const BITE_SPAN = 0.42;
const BITE_DEPTH = 0.86;
const RIB_TOP = 0.12;
const RIB_BOTTOM = 0.88;
/** How far off square the ribs branch, at the top of the cage and at the bottom. */
const RIB_SPLAY_TOP = deg(52);
const RIB_SPLAY_BOTTOM = deg(24);
/** The lower ribs are shorter, which is what closes the basket at the bottom. */
const RIB_TAPER = 0.62;
const RIB_LENGTH_JITTER: readonly number[] = [1.14, 0.86, 0.94, 1.2, 1.05, 0.78, 0.9, 1.1];
/** Where along a rib it bends back toward its opposite number. */
const RIB_ELBOW_AT = 0.55;
const RIB_HOOK = deg(38);
const RIB_CURVE = 0.9;
const SHRED_COUNT = 6;
const SHRED_ALPHA = 0.55;
const SHRED_RX = 0.016;
const SHRED_RY = 0.009;
/** The coil stands taller than it is wide, unlike the trunk slab. */
const COIL_NARROW = 0.92;
const COIL_TAIL_REACH = 1.6;
/**
 * How much of the gut's own half-thickness the ambient inset may eat.
 *
 * Derived from the *nominal* band, but the two loops carry independent wobbles
 * that thin it further in places, so it has to leave headroom: at 0.7 the loops
 * still crossed at one bearing and the even-odd fill put the highlight into the
 * hole instead of onto the gut.
 */
const BAND_INSET_SHARE = 0.55;
const COIL_HIGHLIGHT_GAIN = 1.4;
const GUT_BANDS = 9;
const GUT_BAND_ALPHA = 0.45;
const GUT_BAND_WIDTH = 0.008;
const GUT_BAND_JITTER = 0.2;
/**
 * Uneven spacing and uneven heights along the torn strip. Regular spines of a
 * smoothly falling height read as a comb — which is what a blind naming test
 * called this piece before the numbers were broken up.
 */
const CREST_PIECE_STOPS: readonly number[] = [0.06, 0.24, 0.4, 0.58, 0.79, 0.94];
const CREST_PIECE_HEIGHTS: readonly number[] = [0.55, 1, 0.78, 1.15, 0.62, 0.4];
/** How far the spines rake back toward the nape rather than standing square. */
const CREST_RAKE = 0.45;
const CLUB_SQUASH = 0.62;
const VENOM_BEADS = 5;
const VENOM_BEAD_ALPHA = 0.5;
const VENOM_BEAD_R = 0.3;
const BARB_COUNT = 4;
const BARB_FROM = 0.35;
const BARB_LENGTH = 0.016;
