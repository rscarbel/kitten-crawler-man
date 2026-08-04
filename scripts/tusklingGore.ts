/**
 * The eight pieces a Tuskling comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered Tuskling's injuries are
 * recognisably the same ones a dismembered rat has. What is here is the shape
 * of each piece and the hide on it.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. Eight cells
 * tumbling past at 16 px must not read as eight identical pink blobs, so the
 * set spreads across a broad skull whose four tusks break its outline in four
 * directions (nothing else in the bestiary drops a shape with spikes on every
 * side), a heavy wide slab of trunk with the pale belly panel on it, a long
 * straight arm ending in a splayed three-finger hand, a short bent L ending in
 * a blunt hoof block, a pale ribbed arc, a coiled length of gut, a single long
 * ivory crescent — the severed tusk, the one piece a player will recognise as
 * this creature's and no other's — and the lower jaw with the rear pair still
 * socketed in it.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell; the bake re-centres each piece's ink there before writing.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { AMBIENT_ALPHA, BONE_SHADOW, drawWound, grownOutline, paintGoreMass } from './goreWound.js';
import { TWO_PI, type Pt, deg, hash1, lerp, ovalOutline, rgba, traceOutline } from './ratArt.js';

// ── Tuskling tones, as seen on a severed piece ───────────────────────────────

/**
 * Darker than the tones the living creature is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and hide painted
 * at its standing brightness comes out reading as a pale pink pebble.
 */
const HIDE_MID = '#a85c64';
const HIDE_DARK = '#4a2028';
const HIDE_LIGHT = '#cd8a8b';
const BELLY_MID = '#c48f8a';
const BELLY_LIGHT = '#e0b6ab';
const TUSK_MID = '#bdb191';
const TUSK_DARK = '#4f4835';
const TUSK_LIGHT = '#e2d8ba';
const HOOF_MID = '#2f2630';
const HOOF_DARK = '#141016';
const HOOF_LIGHT = '#4e4149';
/**
 * Not `BONE_CORTICAL`: at near-white the ribcage becomes the only piece in the
 * set with any contrast, which makes it read as a fishbone rather than as one
 * piece of a creature the other seven also came off.
 */
const BONE_MID = '#cfc4a8';
const BONE_LIGHT = '#e7ddc4';
const GUT_MID = '#8a5049';
const GUT_DARK = '#40201d';
const GUT_LIGHT = '#ad6f63';
const OUTLINE_INK = '#150810';
const EYE_DEAD = '#8b8079';

const HIDE_TONE = { mid: HIDE_MID, dark: HIDE_DARK, light: HIDE_LIGHT } as const;
const TUSK_TONE = { mid: TUSK_MID, dark: TUSK_DARK, light: TUSK_LIGHT } as const;
const HOOF_TONE = { mid: HOOF_MID, dark: HOOF_DARK, light: HOOF_LIGHT } as const;
const BONE_TONE = { mid: BONE_MID, dark: BONE_SHADOW, light: BONE_LIGHT } as const;
const GUT_TONE = { mid: GUT_MID, dark: GUT_DARK, light: GUT_LIGHT } as const;

type Tone = { readonly mid: string; readonly dark: string; readonly light: string };

function paintMass(ctx: Ctx, trace: (grow: number) => void, tone: Tone): void {
  paintGoreMass(ctx, trace, tone, OUTLINE_INK);
}

/** Traces a polygon outline grown outward from its own centroid. */
function tracerFor(ctx: Ctx, outline: readonly Pt[]): (grow: number) => void {
  return (grow: number): void => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

const BLOTCH_COUNT = 11;
const BLOTCH_ALPHA = 0.42;
const BLOTCH_MIN = 0.12;
const BLOTCH_RANGE = 0.2;
const BLOTCH_SQUASH = 0.7;

/** Blotching over a piece of hide, clipped to it. */
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
  ctx.globalAlpha = 1;
  ctx.restore();
}

const SEGMENT_WOBBLE = 0.07;
const SEGMENT_LOBES = 2.3;

/** Tapered capsules threaded through a bent limb, as one closed outline. */
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

/**
 * The spine of one tusk, sampled along a quadratic — shared by the skull piece
 * and the severed-tusk piece so the two agree about what a tusk is shaped like.
 */
const TUSK_SPINE_STEPS = 9;

function tuskSpine(root: Pt, control: Pt, tip: Pt): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= TUSK_SPINE_STEPS; i++) {
    const t = i / TUSK_SPINE_STEPS;
    const inv = 1 - t;
    points.push({
      x: inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
      y: inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
    });
  }
  return points;
}

function tuskHalves(rootHalf: number, tipHalf: number): number[] {
  return Array.from({ length: TUSK_SPINE_STEPS + 1 }, (_unused, i) =>
    lerp(rootHalf, tipHalf, (i / TUSK_SPINE_STEPS) ** 2),
  );
}

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

/** Where the two bites fall, as fractions of the way round the trunk's outline. */
const TOP_BITE_FROM = 0.09;
const TOP_BITE_UNTIL = 0.2;
const END_BITE_FROM = 0.31;
const END_BITE_UNTIL = 0.41;

/** Teeth along the jaw's biting edge. */
const JAW_TEETH = 5;

const PIECE_SEED_BASE = 4231;
const SEED_STEP = 883;

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be
 * applied to another and every piece would bake off-centre in its cell.
 */
export function tusklingGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * SEED_STEP;

  const skullSeed = nextSeed();
  const skullMottleSeed = nextSeed();
  const skullWoundSeed = nextSeed();
  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      // Flatter than it is wide, so the piece is not one more round lump, and
      // the tusks run well past it: four spikes off a wedge is the only
      // silhouette in the set that cannot be confused with a slab of meat.
      const SKULL_HALF_WIDTH = 0.145;
      const SKULL_HALF_DEPTH = 0.095;

      // The four tusks go down first so the skull mass covers their roots and
      // only the ivory that clears the jaw breaks the outline.
      // All four swept toward one end of the skull, not radiating from its
      // centre: four spikes spaced evenly around a round body is a crab, and a
      // crab is what a reviewer named this piece when they were symmetric.
      const tusks: ReadonlyArray<readonly [Pt, Pt, Pt, number, number]> = [
        [{ x: 0.04, y: 0.07 }, { x: 0.26, y: 0.0 }, { x: 0.29, y: -0.16 }, 0.03, 0.005],
        [{ x: 0.02, y: 0.09 }, { x: 0.2, y: 0.07 }, { x: 0.21, y: -0.07 }, 0.026, 0.005],
        [{ x: 0.08, y: 0.0 }, { x: 0.24, y: 0.12 }, { x: 0.21, y: 0.24 }, 0.021, 0.004],
        [{ x: 0.03, y: -0.02 }, { x: 0.17, y: 0.1 }, { x: 0.15, y: 0.2 }, 0.017, 0.004],
      ];
      for (const [root, control, tip, rootHalf, tipHalf] of tusks) {
        const outline = chainOutline(
          tuskSpine(root, control, tip),
          tuskHalves(rootHalf, tipHalf),
          skullSeed,
        );
        paintMass(ctx, tracerFor(ctx, outline), TUSK_TONE);
      }

      const skull = ovalOutline(0, 0, SKULL_HALF_WIDTH, SKULL_HALF_DEPTH, 0, skullSeed, 0.07);
      const trace = tracerFor(ctx, skull);
      paintMass(ctx, trace, HIDE_TONE);
      mottleHide(ctx, trace, skullMottleSeed, SKULL_HALF_WIDTH);

      ctx.beginPath();
      ctx.ellipse(SKULL_HALF_WIDTH * 0.1, -SKULL_HALF_DEPTH * 0.35, 0.021, 0.017, 0, 0, TWO_PI);
      ctx.fillStyle = OUTLINE_INK;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(SKULL_HALF_WIDTH * 0.1, -SKULL_HALF_DEPTH * 0.35, 0.013, 0.01, 0, 0, TWO_PI);
      ctx.fillStyle = EYE_DEAD;
      ctx.fill();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -SKULL_HALF_WIDTH * 0.85, y: SKULL_HALF_DEPTH * 0.3 },
        radius: 0.062,
        squash: 0.55,
        angle: deg(86),
        bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
        runAngle: deg(184),
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
      const TRUNK_HALF_WIDTH = 0.205;
      const TRUNK_HALF_HEIGHT = 0.098;

      const outline = ovalOutline(0, 0, TRUNK_HALF_WIDTH, TRUNK_HALF_HEIGHT, 0, torsoSeed, 0.09);
      // A convex lump reads as a rock, and every other convex piece in the set
      // scores as the same shape as it. Two bites — a deep one out of the top
      // edge and a shallower one out of the trailing end — give the outline
      // concavities nothing else here has. Placed by fraction of the way round
      // rather than by index, because the outline's own length is a constant
      // private to `ratArt` and moving it would slide the bites off the piece.
      const bitten = outline.map((p, i) => {
        const around = i / outline.length;
        if (around > TOP_BITE_FROM && around < TOP_BITE_UNTIL) {
          return { x: p.x * 0.9, y: p.y * 0.34 };
        }
        if (around > END_BITE_FROM && around < END_BITE_UNTIL) {
          return { x: p.x * 0.62, y: p.y * 0.75 };
        }
        return p;
      });
      const trace = tracerFor(ctx, bitten);
      paintMass(ctx, trace, HIDE_TONE);
      mottleHide(ctx, trace, torsoMottleSeed, TRUNK_HALF_WIDTH);

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = rgba(BELLY_MID, 0.85);
      ctx.beginPath();
      ctx.ellipse(
        TRUNK_HALF_WIDTH * 0.15,
        TRUNK_HALF_HEIGHT * 0.25,
        TRUNK_HALF_WIDTH * 0.5,
        TRUNK_HALF_HEIGHT * 0.55,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.fillStyle = rgba(BELLY_LIGHT, 0.5);
      ctx.beginPath();
      ctx.ellipse(
        TRUNK_HALF_WIDTH * 0.2,
        TRUNK_HALF_HEIGHT * 0.1,
        TRUNK_HALF_WIDTH * 0.26,
        TRUNK_HALF_HEIGHT * 0.24,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -TRUNK_HALF_WIDTH * 0.62, y: -TRUNK_HALF_HEIGHT * 0.1 },
        radius: 0.062,
        squash: 0.62,
        angle: deg(98),
        bones: [
          { at: { x: -0.012, y: 0.01 }, size: 0.3 },
          { at: { x: 0.016, y: -0.012 }, size: 0.24 },
        ],
        runAngle: deg(184),
        seed: torsoWoundSeed,
        hide: HIDE_DARK,
      });

      // A splintered rib standing out of the bitten edge, painted last so the
      // wound's blood cannot bury it. Every other piece in the set carries one
      // hard high-contrast landmark — white bone, a black hoof, fingers,
      // segment ridges — and the trunk had none: an amorphous pink slab reads
      // as a slice of ham at 16 px, not as a body part.
      const shard: Pt[] = [
        { x: TRUNK_HALF_WIDTH * 0.05, y: -TRUNK_HALF_HEIGHT * 0.15 },
        { x: TRUNK_HALF_WIDTH * 0.22, y: -TRUNK_HALF_HEIGHT * 1.1 },
        { x: TRUNK_HALF_WIDTH * 0.38, y: -TRUNK_HALF_HEIGHT * 2.05 },
      ];
      paintMass(
        ctx,
        tracerFor(ctx, chainOutline(shard, [0.03, 0.02, 0.007], torsoSeed)),
        BONE_TONE,
      );
    },
  };

  const armSeed = nextSeed();
  const armWoundSeed = nextSeed();
  const arm: GorePiece = {
    state: 'gore_arm',
    paint: (ctx) => {
      const spine: Pt[] = [
        { x: -0.2, y: -0.05 },
        { x: -0.1, y: -0.02 },
        { x: 0.0, y: 0.005 },
        { x: 0.1, y: 0.02 },
        { x: 0.17, y: 0.03 },
      ];
      const halves = [0.04, 0.036, 0.031, 0.027, 0.023];
      const outline = chainOutline(spine, halves, armSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      mottleHide(ctx, trace, armSeed + 5, 0.13);

      // The splayed hand is what tells a straight arm apart from a straight leg.
      const palm = { x: 0.2, y: 0.035 };
      const palmOutline = ovalOutline(palm.x, palm.y, 0.06, 0.048, deg(10), armSeed, 0.08);
      paintMass(ctx, tracerFor(ctx, palmOutline), HIDE_TONE);
      ctx.strokeStyle = HIDE_DARK;
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.026;
      for (let i = 0; i < 3; i++) {
        const angle = deg(-30 + i * 30);
        ctx.beginPath();
        ctx.moveTo(palm.x + 0.02, palm.y);
        ctx.lineTo(palm.x + 0.02 + Math.cos(angle) * 0.08, palm.y + Math.sin(angle) * 0.08);
        ctx.stroke();
      }

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -0.215, y: -0.055 },
        radius: 0.045,
        squash: 0.44,
        angle: deg(74),
        bones: [{ at: { x: 0, y: 0 }, size: 0.36 }],
        runAngle: deg(196),
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
      // Short and sharply bent — the stubby leg of the description, and the
      // shape that keeps it apart from the long straight arm.
      // A hard hock, not a gentle curve: bent where the arm is straight is the
      // only thing keeping two tapered pink tubes apart at 16 px.
      const spine: Pt[] = [
        { x: -0.15, y: -0.11 },
        { x: -0.06, y: -0.08 },
        { x: 0.02, y: -0.02 },
        { x: 0.03, y: 0.08 },
        { x: 0.06, y: 0.14 },
      ];
      const halves = [0.075, 0.068, 0.058, 0.048, 0.04];
      const outline = chainOutline(spine, halves, legSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      mottleHide(ctx, trace, legSeed + 3, 0.1);

      const hoof = ovalOutline(0.085, 0.195, 0.058, 0.042, deg(70), legSeed, 0.05);
      paintMass(ctx, tracerFor(ctx, hoof), HOOF_TONE);
      ctx.strokeStyle = HOOF_DARK;
      ctx.lineWidth = 0.011;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0.06, 0.225);
      ctx.lineTo(0.115, 0.2);
      ctx.stroke();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -0.17, y: -0.13 },
        radius: 0.052,
        squash: 0.5,
        angle: deg(48),
        bones: [{ at: { x: 0, y: 0 }, size: 0.38, hollow: true }],
        runAngle: deg(228),
        seed: legWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const ribSeed = nextSeed();
  const ribcage: GorePiece = {
    state: 'gore_ribcage',
    paint: (ctx) => {
      const SPINE_HALF = 0.16;
      const RIB_COUNT = 5;
      // One straight spine with ribs hanging off it, each shorter than the last
      // and all curving the same way. Bars of equal length between two uprights
      // is a clamp, which is what this piece was named as when it had them.
      const spine: Pt[] = [
        { x: -0.09, y: -SPINE_HALF },
        { x: -0.06, y: 0 },
        { x: -0.05, y: SPINE_HALF },
      ];
      paintMass(ctx, tracerFor(ctx, chainOutline(spine, [0.026, 0.03, 0.024], ribSeed)), BONE_TONE);

      for (let i = 0; i < RIB_COUNT; i++) {
        const t = i / (RIB_COUNT - 1);
        const root = {
          x: lerp(-0.088, -0.05, t),
          y: lerp(-SPINE_HALF * 0.85, SPINE_HALF * 0.8, t),
        };
        const reach = lerp(0.26, 0.13, t);
        const rib: Pt[] = [
          root,
          { x: root.x + reach * 0.45, y: root.y - reach * 0.16 },
          { x: root.x + reach * 0.85, y: root.y + reach * 0.1 },
          { x: root.x + reach, y: root.y + reach * 0.38 },
        ];
        paintMass(
          ctx,
          tracerFor(ctx, chainOutline(rib, [0.017, 0.015, 0.013, 0.01], ribSeed + i)),
          BONE_TONE,
        );
      }

      // Bone with nothing on it reads as a comb. The gristle left between the
      // ribs is what makes it a piece of an animal.
      ctx.fillStyle = rgba(GUT_DARK, 0.62);
      ctx.beginPath();
      ctx.ellipse(0.01, SPINE_HALF * 0.15, 0.075, 0.07, deg(20), 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = rgba(GUT_MID, 0.5);
      ctx.beginPath();
      ctx.ellipse(-0.02, -SPINE_HALF * 0.35, 0.045, 0.04, deg(-15), 0, TWO_PI);
      ctx.fill();
    },
  };

  const gutSeed = nextSeed();
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      // A tube coiled through one and a quarter turns, not a closed ring. A ring
      // is a rounded blob with a dot in it, which is the same silhouette as a
      // skull or a slab of trunk once the distinctness gate normalises scale;
      // an open spiral has a tail sticking out of it and nothing else does.
      const COIL_R = 0.115;
      const TURNS = 0.72;
      const STEPS = 22;
      const spine: Pt[] = [];
      const halves: number[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const angle = t * TWO_PI * TURNS + deg(150);
        const radius = COIL_R * lerp(1, 0.5, t);
        const tail = t > 0.82 ? (t - 0.82) / 0.18 : 0;
        spine.push({
          x: Math.cos(angle) * radius * 1.2 + tail * COIL_R * 1.5,
          y: Math.sin(angle) * radius + tail * COIL_R * 0.8,
        });
        halves.push(lerp(0.048, 0.03, t));
      }
      const outline = chainOutline(spine, halves, gutSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, GUT_TONE);

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(GUT_DARK, 0.5);
      ctx.lineWidth = 0.01;
      ctx.lineCap = 'round';
      for (let i = 2; i < spine.length; i += 3) {
        const here = spine[i];
        const prev = spine[i - 1];
        const angle = Math.atan2(here.y - prev.y, here.x - prev.x) + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(here.x + Math.cos(angle) * 0.05, here.y + Math.sin(angle) * 0.05);
        ctx.lineTo(here.x - Math.cos(angle) * 0.05, here.y - Math.sin(angle) * 0.05);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(GUT_LIGHT, AMBIENT_ALPHA * 1.5);
      ctx.beginPath();
      ctx.ellipse(-COIL_R * 0.5, -COIL_R * 0.4, COIL_R * 0.4, COIL_R * 0.22, deg(-20), 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    },
  };

  const tuskSeed = nextSeed();
  const tuskWoundSeed = nextSeed();
  const tusk: GorePiece = {
    state: 'gore_tusk',
    paint: (ctx) => {
      const spine = tuskSpine({ x: -0.14, y: 0.16 }, { x: 0.06, y: 0.04 }, { x: 0.02, y: -0.19 });
      const outline = chainOutline(spine, tuskHalves(0.038, 0.007), tuskSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, TUSK_TONE);

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(TUSK_DARK, 0.35);
      ctx.lineWidth = 0.008;
      for (let i = 1; i < spine.length - 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(spine[i].x - 0.03, spine[i].y - 0.03);
        ctx.lineTo(spine[i].x + 0.03, spine[i].y + 0.03);
        ctx.stroke();
      }
      ctx.restore();

      // Snapped at the root, not sliced: a tusk comes out with the gum on it.
      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -0.15, y: 0.175 },
        radius: 0.05,
        squash: 0.55,
        angle: deg(126),
        bones: [{ at: { x: 0, y: 0 }, size: 0.3 }],
        runAngle: deg(120),
        seed: tuskWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const jawSeed = nextSeed();
  const jawWoundSeed = nextSeed();
  const jaw: GorePiece = {
    state: 'gore_jaw',
    paint: (ctx) => {
      // The lower jaw with the rear pair still socketed in it. What was here
      // instead was a ragged flap of hide, and a pale sliver with a few hairs
      // on it reads as nothing at all — at sixteen pixels it was a smudge. A
      // jaw is nameable, and the tusks in it name the creature it came off.
      const JAW_HALF = 0.135;
      const spine: Pt[] = [
        { x: -JAW_HALF, y: -0.055 },
        { x: -JAW_HALF * 0.45, y: 0.045 },
        { x: JAW_HALF * 0.45, y: 0.045 },
        { x: JAW_HALF, y: -0.055 },
      ];
      const outline = chainOutline(spine, [0.028, 0.042, 0.042, 0.028], jawSeed);
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);

      for (const side of [-1, 1]) {
        const root = { x: side * JAW_HALF * 0.72, y: -0.02 };
        const control = { x: side * JAW_HALF * 1.5, y: -0.11 };
        const tip = { x: side * JAW_HALF * 1.15, y: -0.21 };
        const tuskOutline = chainOutline(
          tuskSpine(root, control, tip),
          tuskHalves(0.024, 0.005),
          jawSeed + side,
        );
        paintMass(ctx, tracerFor(ctx, tuskOutline), TUSK_TONE);
      }

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(HIDE_DARK, 0.6);
      ctx.lineWidth = 0.012;
      ctx.lineCap = 'round';
      for (let i = 0; i < JAW_TEETH; i++) {
        const across = lerp(-JAW_HALF * 0.55, JAW_HALF * 0.55, (i + 0.5) / JAW_TEETH);
        ctx.beginPath();
        ctx.moveTo(across, 0.005);
        ctx.lineTo(across, -0.035);
        ctx.stroke();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0, y: 0.075 },
        radius: 0.052,
        squash: 0.42,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.34, hollow: true }],
        runAngle: deg(90),
        seed: jawWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  return [head, torso, arm, leg, ribcage, entrails, tusk, jaw];
}
