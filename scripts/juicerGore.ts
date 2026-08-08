/**
 * The eight pieces the Juicer comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered Juicer's injuries are
 * recognisably the same ones every other dismembered creature in the game has.
 * What is here is the shape of each piece and the hide on it.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. Eight cells
 * tumbling past at 16 px must not read as eight identical green blobs, so the
 * set spreads across a narrow crested skull with a blunt muzzle and an ear
 * disc, a wide V-shaped slab of trunk carrying the belly plates, an absurd
 * biceps spindle with a cut deltoid face on it, a straight forearm still
 * wearing its lifting wrap and ending in a splayed hand, a thick thigh with a
 * shorts cuff round it, a bent shin ending in a clawed foot, a coiled length of
 * gut spiralled in on itself, and the long banded tail — the one piece a
 * player will name cold as this creature's and no other's.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell; the bake re-centres each piece's ink there before writing.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import { AMBIENT_ALPHA, drawWound, grownOutline, paintGoreMass } from './goreWound.js';
import { TWO_PI, type Pt, deg, hash1, lerp, ovalOutline, rgba, traceOutline } from './ratArt.js';

// ── Juicer tones, as seen on a severed piece ─────────────────────────────────

/**
 * Darker than the tones the living creature is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and hide painted
 * at its standing brightness comes out reading as a pale green pebble.
 */
const HIDE_MID = '#4d7431';
const HIDE_DARK = '#182b18';
const HIDE_LIGHT = '#89ad4d';
const BELLY_MID = '#7ba647';
const BELLY_LIGHT = '#a8d06a';
const SHORTS_MID = '#4a1d62';
const SHORTS_DARK = '#1e0d2b';
const SHORTS_LIGHT = '#7c3c9a';
const WRAP_MID = '#5e3418';
const WRAP_DARK = '#241105';
const WRAP_LIGHT = '#96592a';
const CLAW_MID = '#8b7c58';
/**
 * Gut is blood, not skin. Painted at a dusty desaturated salmon it matched no
 * other cut face in the set — every stump `goreWound` draws is a saturated dark
 * red — and the entrails read as a piece from some other creature entirely.
 */
const GUT_MID = '#8c1f26';
const GUT_DARK = '#3a0a10';
const GUT_LIGHT = '#bc4038';
const OUTLINE_INK = '#0b1207';
const EYE_DEAD = '#8a8468';

const HIDE_TONE = { mid: HIDE_MID, dark: HIDE_DARK, light: HIDE_LIGHT } as const;
const SHORTS_TONE = { mid: SHORTS_MID, dark: SHORTS_DARK, light: SHORTS_LIGHT } as const;
const WRAP_TONE = { mid: WRAP_MID, dark: WRAP_DARK, light: WRAP_LIGHT } as const;

interface Tone {
  readonly mid: string;
  readonly dark: string;
  readonly light: string;
}

function paintMass(ctx: Ctx, trace: (grow: number) => void, tone: Tone): void {
  paintGoreMass(ctx, trace, tone, OUTLINE_INK);
}

/** Traces a polygon outline grown outward from its own centroid. */
function tracerFor(ctx: Ctx, outline: readonly Pt[]): (grow: number) => void {
  return (grow: number): void => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

const SPECK_COUNT = 10;
const SPECK_ALPHA = 0.4;
const SPECK_MIN = 0.1;
const SPECK_RANGE = 0.16;
const SPECK_SQUASH = 0.6;

/** Scale specks over a piece of hide, clipped to it. */
function speckleHide(ctx: Ctx, trace: (grow: number) => void, seed: number, spread: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  ctx.globalAlpha = SPECK_ALPHA;
  ctx.fillStyle = HIDE_DARK;
  for (let i = 0; i < SPECK_COUNT; i++) {
    const x = (hash1(seed + i * 3.7) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 7.1 + 31) - 0.5) * 2 * spread;
    const rx = spread * (SPECK_MIN + hash1(seed + i * 11.3) * SPECK_RANGE);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * SPECK_SQUASH, hash1(seed + i * 2.3) * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

const SEGMENT_WOBBLE = 0.06;
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

/** Samples a quadratic spine, shared by the tail piece and the skull's crest. */
const SPINE_STEPS = 10;

function quadSpine(root: Pt, control: Pt, tip: Pt): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= SPINE_STEPS; i++) {
    const t = i / SPINE_STEPS;
    const inv = 1 - t;
    points.push({
      x: inv * inv * root.x + 2 * inv * t * control.x + t * t * tip.x,
      y: inv * inv * root.y + 2 * inv * t * control.y + t * t * tip.y,
    });
  }
  return points;
}

function taperedHalves(rootHalf: number, tipHalf: number, curve: number): number[] {
  return Array.from({ length: SPINE_STEPS + 1 }, (_unused, i) =>
    lerp(rootHalf, tipHalf, (i / SPINE_STEPS) ** curve),
  );
}

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const PIECE_SEED_BASE = 7717;
const SEED_STEP = 641;

/** How many plates a torso or tail piece carries. Fewer than four is a stripe. */
const TORSO_PLATES = 4;
const TAIL_BANDS = 6;
const CREST_SPIKES = 4;
/** Stands the severed head on its muzzle, so its bounding box runs portrait. */
const HEAD_PIECE_TILT = deg(-74);
const FINGER_COUNT = 3;
/** Turns of strapping in a lifting wrap. */
const WRAP_TURNS = 3;
const FOOT_CLAWS = 3;
/** The gut's spiral: how many turns, how tight it starts, and how it opens. */
const GUT_SPIRAL_TURNS = 1.75;
const GUT_SPIRAL_STEPS = 48;
const GUT_SPIRAL_INNER = 0.26;
const GUT_SPIRAL_OPENING = 0.8;
const GUT_SPIRAL_SQUASH = 0.82;
const GUT_SPIRAL_WOBBLE = 0.09;
const GUT_WOBBLE_LOBES = 7.3;
/** The tube's own girth against the coil's radius, and its ink weight. */
const GUT_TUBE_GIRTH = 0.46;
const GUT_TUBE_INK = 0.012;
const GUT_SHEEN_ALPHA = 0.55;
const GUT_KINK_ALPHA = 0.45;
const GUT_KINKS = 5;
/** The thigh's girth at the shorts cuff and at the knee, against its length. */
const QUAD_ROOT_HALF = 0.42;
const QUAD_KNEE_HALF = 0.3;
/**
 * Where the quad's belly peaks, and how far above the top it starts swelling.
 *
 * The peak sits at the *middle* of the piece. Ridden up near the cuff the mass
 * is widest where the purple band already is and falls away to nothing by the
 * knee, which makes the whole piece a funnel with a cap on it — a bottle, or a
 * cup, and not a leg.
 */
const QUAD_BELLY_AT = 1.1;
const QUAD_BELLY_LEAD = 0.05;
/** How far the quad's belly stands proud of the taper under it. */
const QUAD_BELLY_SWELL = 0.36;

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be
 * applied to another and every piece would bake off-centre in its cell.
 */
export function juicerGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * SEED_STEP;

  const headSeed = nextSeed();
  const headSpeckSeed = nextSeed();
  const headWoundSeed = nextSeed();
  const head: GorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      // Narrow and deep, with the muzzle stub carried on one end and the crest
      // spikes off the top: an asymmetric wedge with spines on one edge only.
      // Spikes spaced evenly all round a round body is a sea urchin, and that
      // is what a symmetric version of this piece reads as.
      //
      // Stood on end, because every other piece in the set is longer than it is
      // tall. Aspect is the one thing the distinctness gate does not normalise
      // away, so a portrait piece cannot be confused with a landscape one
      // however similar the two blobs are.
      const SKULL_HALF_DEPTH = 0.155;
      const SKULL_HALF_HEIGHT = 0.1;
      ctx.save();
      ctx.rotate(HEAD_PIECE_TILT);

      const skull = ovalOutline(0, 0, SKULL_HALF_DEPTH, SKULL_HALF_HEIGHT, deg(-8), headSeed, 0.07);
      const skullTrace = tracerFor(ctx, skull);

      // Crest spikes go down first so the skull mass covers their roots.
      for (let i = 0; i < CREST_SPIKES; i++) {
        const t = (i + 0.5) / CREST_SPIKES;
        const rootX = lerp(-SKULL_HALF_DEPTH * 0.75, SKULL_HALF_DEPTH * 0.2, t);
        // Short and broad-based, and overlapping their neighbours. Slim spikes
        // spaced clear of each other are four fingers reaching off the skull.
        const height = SKULL_HALF_HEIGHT * (0.44 + hash1(headSeed + i * 5.1) * 0.34);
        const spike = chainOutline(
          quadSpine(
            { x: rootX, y: -SKULL_HALF_HEIGHT * 0.6 },
            { x: rootX - height * 0.2, y: -SKULL_HALF_HEIGHT - height * 0.5 },
            { x: rootX - height * 0.55, y: -SKULL_HALF_HEIGHT - height },
          ),
          taperedHalves(SKULL_HALF_HEIGHT * 0.42, SKULL_HALF_HEIGHT * 0.04, 1.7),
          headSeed + i,
        );
        paintMass(ctx, tracerFor(ctx, spike), HIDE_TONE);
      }

      paintMass(ctx, skullTrace, HIDE_TONE);
      speckleHide(ctx, skullTrace, headSpeckSeed, SKULL_HALF_DEPTH * 0.8);

      // The blunt muzzle. Short on purpose: carried further out it reads as a
      // beak, and a beaked piece is not the head of the creature that died.
      const muzzle = ovalOutline(
        SKULL_HALF_DEPTH * 0.86,
        SKULL_HALF_HEIGHT * 0.34,
        SKULL_HALF_DEPTH * 0.44,
        SKULL_HALF_HEIGHT * 0.46,
        deg(6),
        headSeed + 3,
        0.09,
      );
      const muzzleTrace = tracerFor(ctx, muzzle);
      paintMass(ctx, muzzleTrace, HIDE_TONE);
      ctx.save();
      muzzleTrace(0);
      ctx.clip();
      ctx.fillStyle = rgba(BELLY_MID, 0.8);
      ctx.beginPath();
      ctx.ellipse(
        SKULL_HALF_DEPTH * 0.9,
        SKULL_HALF_HEIGHT * 0.52,
        SKULL_HALF_DEPTH * 0.4,
        SKULL_HALF_HEIGHT * 0.3,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.restore();

      // The dead eye and the ear disc: the two marks that say "this was a face".
      // Inked like every other element in the set: a flat grey disc laid
      // straight onto hide is the only unoutlined mark on any of the pieces,
      // and it reads as a hole rather than as an eye.
      // The eye carries the whole piece. Drawn at a face's own proportions it is
      // under two pixels across once the runtime halves the piece, and without
      // it the silhouette is a green wedge with a stub on one end — which is a
      // severed hand, or a small fish, or anything at all except a head. It is
      // deliberately oversized, and the slit is what keeps it a lizard's.
      const EYE_HALF_DEPTH = SKULL_HALF_DEPTH * 0.34;
      const EYE_HALF_HEIGHT = SKULL_HALF_HEIGHT * 0.46;
      const eyeAt = { x: SKULL_HALF_DEPTH * 0.26, y: -SKULL_HALF_HEIGHT * 0.18 };
      ctx.fillStyle = OUTLINE_INK;
      ctx.beginPath();
      ctx.ellipse(eyeAt.x, eyeAt.y, EYE_HALF_DEPTH, EYE_HALF_HEIGHT, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = EYE_DEAD;
      ctx.beginPath();
      ctx.ellipse(eyeAt.x, eyeAt.y, EYE_HALF_DEPTH * 0.66, EYE_HALF_HEIGHT * 0.66, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = OUTLINE_INK;
      ctx.beginPath();
      ctx.ellipse(eyeAt.x, eyeAt.y, EYE_HALF_DEPTH * 0.22, EYE_HALF_HEIGHT * 0.58, 0, 0, TWO_PI);
      ctx.fill();

      // The jaw line, running back from the muzzle stub under the eye: a head
      // has a mouth in it, and the line is what stops the muzzle reading as a
      // thumb growing off a palm.
      ctx.strokeStyle = rgba(HIDE_DARK, 0.85);
      ctx.lineWidth = SKULL_HALF_HEIGHT * 0.13;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(SKULL_HALF_DEPTH * 1.22, SKULL_HALF_HEIGHT * 0.5);
      ctx.quadraticCurveTo(
        SKULL_HALF_DEPTH * 0.6,
        SKULL_HALF_HEIGHT * 0.62,
        -SKULL_HALF_DEPTH * 0.1,
        SKULL_HALF_HEIGHT * 0.44,
      );
      ctx.stroke();
      ctx.fillStyle = rgba(HIDE_DARK, 0.9);
      ctx.beginPath();
      ctx.ellipse(
        -SKULL_HALF_DEPTH * 0.24,
        SKULL_HALF_HEIGHT * 0.04,
        SKULL_HALF_DEPTH * 0.18,
        SKULL_HALF_HEIGHT * 0.3,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -SKULL_HALF_DEPTH * 0.82, y: SKULL_HALF_HEIGHT * 0.36 },
        radius: SKULL_HALF_HEIGHT * 0.72,
        squash: 0.62,
        angle: deg(72),
        bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
        runAngle: deg(140),
        seed: headWoundSeed,
        hide: HIDE_DARK,
      });
      ctx.restore();
    },
  };

  const torsoSpeckSeed = nextSeed();
  const torsoWoundSeed = nextSeed();
  const torsoNeckSeed = nextSeed();
  const torsoShoulderSeed = nextSeed();
  const torso: GorePiece = {
    state: 'gore_torso',
    paint: (ctx) => {
      // The severed chest of the bulkiest creature on the floor. It has to be
      // the largest piece in the set and it has to be *nameable*: a plain
      // tapering slab of hide is a haunch, a fillet or a shield, and the piece
      // is only a torso once the stumps it was cut from are on it — a deltoid
      // stump at each top corner, a neck stump between them, and the top of the
      // gym shorts across the bottom.
      const HALF_SPAN = 0.31;
      const HALF_HEIGHT = 0.21;
      const span = (share: number): number => HALF_SPAN * share;
      const drop = (share: number): number => HALF_HEIGHT * share;

      // The stumps go down first, so the trunk mass covers their roots and only
      // their outboard halves break the silhouette.
      const shoulders: Pt[] = [
        { x: span(-0.96), y: drop(-0.74) },
        { x: span(0.96), y: drop(-0.74) },
      ];
      for (const [index, at] of shoulders.entries()) {
        const side = index === 0 ? -1 : 1;
        const ball = ovalOutline(
          at.x + side * span(0.2),
          at.y,
          span(0.3),
          drop(0.44),
          side * deg(24),
          torsoShoulderSeed + index * 3,
          0.08,
        );
        paintMass(ctx, tracerFor(ctx, ball), HIDE_TONE);
        drawWound(ctx, {
          kind: 'clean',
          centre: { x: at.x + side * span(0.42), y: at.y - drop(0.06) },
          radius: drop(0.36),
          squash: 0.56,
          angle: side * deg(64),
          bones: [{ at: { x: 0, y: 0 }, size: 0.42 }],
          runAngle: deg(90),
          seed: torsoShoulderSeed + index,
          hide: HIDE_DARK,
        });
      }
      const neck = ovalOutline(
        span(0.04),
        drop(-1.0),
        span(0.26),
        drop(0.3),
        deg(-6),
        torsoNeckSeed,
        0.09,
      );
      paintMass(ctx, tracerFor(ctx, neck), HIDE_TONE);
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: span(0.04), y: drop(-1.2) },
        radius: drop(0.3),
        squash: 0.5,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.4, hollow: true }],
        runAngle: deg(90),
        seed: torsoNeckSeed + 1,
        hide: HIDE_DARK,
      });

      // The trunk itself: broad across the shoulder line, a real concavity at
      // each side of the waist, and square across the waistband at the bottom.
      const slab: Pt[] = [
        { x: span(-1.0), y: drop(-0.62) },
        { x: span(-0.72), y: drop(-0.92) },
        { x: span(-0.26), y: drop(-0.84) },
        { x: span(0.04), y: drop(-0.94) },
        { x: span(0.34), y: drop(-0.82) },
        { x: span(0.74), y: drop(-0.9) },
        { x: span(1.0), y: drop(-0.58) },
        { x: span(0.84), y: drop(0.02) },
        { x: span(0.58), y: drop(0.56) },
        { x: span(0.6), y: drop(0.98) },
        { x: span(-0.56), y: drop(0.98) },
        { x: span(-0.54), y: drop(0.56) },
        { x: span(-0.86), y: drop(0.0) },
      ];
      const trace = tracerFor(ctx, slab);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, torsoSpeckSeed, HALF_SPAN * 0.7);

      ctx.save();
      trace(0);
      ctx.clip();

      // The pectorals, then the ab column: the same pale plates the living
      // creature's chest carries, so the piece is identifiably *his* chest.
      for (const side of [-1, 1]) {
        const at = { x: span(side * 0.46), y: drop(-0.38) };
        ctx.fillStyle = BELLY_MID;
        ctx.beginPath();
        ctx.ellipse(at.x, at.y, span(0.42), drop(0.26), side * deg(-8), 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = BELLY_LIGHT;
        ctx.beginPath();
        ctx.ellipse(at.x, at.y - drop(0.08), span(0.28), drop(0.13), side * deg(-8), 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = rgba(HIDE_DARK, 0.65);
        ctx.lineWidth = drop(0.055);
        ctx.beginPath();
        ctx.moveTo(at.x - span(side * 0.42), at.y + drop(0.24));
        ctx.quadraticCurveTo(at.x, at.y + drop(0.36), at.x + span(side * 0.4), at.y + drop(0.12));
        ctx.stroke();
      }
      for (let i = 0; i < TORSO_PLATES; i++) {
        const t = (i + 0.5) / TORSO_PLATES;
        const y = lerp(drop(0.06), drop(0.62), t);
        const half = span(lerp(0.4, 0.24, t));
        for (const side of [-1, 1]) {
          ctx.fillStyle = BELLY_MID;
          ctx.beginPath();
          ctx.ellipse(side * half * 0.55, y, half * 0.46, drop(0.08), 0, 0, TWO_PI);
          ctx.fill();
        }
        ctx.strokeStyle = rgba(HIDE_DARK, 0.5);
        ctx.lineWidth = drop(0.045);
        ctx.beginPath();
        ctx.moveTo(-half * 1.05, y + drop(0.1));
        ctx.quadraticCurveTo(0, y + drop(0.16), half * 1.05, y + drop(0.1));
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(HIDE_DARK, 0.6);
      ctx.lineWidth = drop(0.05);
      ctx.beginPath();
      ctx.moveTo(0, drop(-0.6));
      ctx.lineTo(0, drop(0.66));
      ctx.stroke();

      // The waistband across the bottom edge — the one flash of purple in the
      // whole set, and the fastest thing in the piece to recognise.
      ctx.fillStyle = SHORTS_MID;
      ctx.fillRect(span(-1.1), drop(0.66), span(2.2), drop(0.6));
      ctx.fillStyle = SHORTS_LIGHT;
      ctx.fillRect(span(-1.1), drop(0.66), span(2.2), drop(0.12));
      ctx.fillStyle = rgba(SHORTS_DARK, 0.7);
      ctx.fillRect(span(-1.1), drop(0.94), span(2.2), drop(0.32));
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: span(-0.86), y: drop(0.14) },
        radius: drop(0.4),
        squash: 0.66,
        angle: deg(-14),
        bones: [
          { at: { x: -0.2, y: -0.3 }, size: 0.3 },
          { at: { x: 0.25, y: 0.3 }, size: 0.26 },
        ],
        runAngle: deg(180),
        seed: torsoWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const armSeed = nextSeed();
  const armSpeckSeed = nextSeed();
  const armWoundSeed = nextSeed();
  const arm: GorePiece = {
    state: 'gore_arm',
    paint: (ctx) => {
      // The whole arm, torn off at the shoulder: a deltoid ball at the stump
      // end, a biceps belly, and a hard bend at the elbow with the forearm
      // trailing off it.
      //
      // Drawn as a single smooth crescent it is shape-identical to the tail
      // piece — same aspect, same taper, same curve — and two pieces a player
      // cannot tell apart are one piece as far as the read is concerned. The
      // elbow's corner is what makes this one an arm.
      const LENGTH = 0.26;
      const ELBOW_AT = 0.62;
      const spine: Pt[] = [];
      for (let i = 0; i <= SPINE_STEPS; i++) {
        const t = i / SPINE_STEPS;
        // Two straight runs meeting at a corner, rather than one arc: an arm
        // bends at one place and is rigid either side of it.
        spine.push(
          t <= ELBOW_AT
            ? {
                x: lerp(-LENGTH, LENGTH * 0.34, t / ELBOW_AT),
                y: lerp(LENGTH * 0.62, -LENGTH * 0.42, t / ELBOW_AT),
              }
            : {
                x: lerp(LENGTH * 0.34, LENGTH * 1.16, (t - ELBOW_AT) / (1 - ELBOW_AT)),
                y: lerp(-LENGTH * 0.42, LENGTH * 0.34, (t - ELBOW_AT) / (1 - ELBOW_AT)),
              },
        );
      }
      const halves = Array.from({ length: SPINE_STEPS + 1 }, (_unused, i) => {
        const t = i / SPINE_STEPS;
        // The biceps belly peaks a third of the way along and pinches hard at
        // the elbow; the forearm swells again and tapers to the wrist.
        const biceps = Math.sin(Math.min(1, t / 0.34) * Math.PI) * 0.3;
        // Nearly as big as the biceps: a forearm that only whispers leaves one
        // bulb on a stalk, and one bulb on a stalk is a gourd, not an arm.
        const forearm = Math.max(0, Math.sin(((t - ELBOW_AT) / (1 - ELBOW_AT)) * Math.PI)) * 0.24;
        const pinch = 1 - 0.3 * Math.exp(-(((t - ELBOW_AT) / 0.1) ** 2));
        return LENGTH * (0.14 + biceps + forearm) * pinch;
      });
      const outline = chainOutline(spine, halves, armSeed);
      const trace = tracerFor(ctx, outline);

      // The deltoid ball, under the arm so only its outboard half shows.
      const deltoid = ovalOutline(
        -LENGTH * 0.98,
        LENGTH * 0.6,
        LENGTH * 0.34,
        LENGTH * 0.3,
        deg(-24),
        armSeed + 9,
        0.09,
      );
      paintMass(ctx, tracerFor(ctx, deltoid), HIDE_TONE);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, armSpeckSeed, LENGTH * 0.6);

      // The wrist end wears the same wrap and carries the same splayed hand the
      // severed forearm does. A limb piece that stops in a rounded stub has no
      // end a reader can name, and the wrap is the one hard non-green band that
      // says which end of it was the hand.
      const wristAlong = deg(24);
      const wrist = { x: LENGTH * 1.06, y: LENGTH * 0.24 };
      const wrap = chainOutline(
        quadSpine(
          { x: LENGTH * 0.86, y: LENGTH * 0.12 },
          { x: LENGTH * 0.96, y: LENGTH * 0.18 },
          { x: LENGTH * 1.06, y: LENGTH * 0.24 },
        ),
        taperedHalves(LENGTH * 0.2, LENGTH * 0.19, 1),
        armSeed + 5,
      );
      const wrapTrace = tracerFor(ctx, wrap);
      paintMass(ctx, wrapTrace, WRAP_TONE);
      ctx.save();
      wrapTrace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(WRAP_DARK, 0.7);
      ctx.lineWidth = LENGTH * 0.04;
      for (let turn = 1; turn <= WRAP_TURNS; turn++) {
        const at = lerp(0.88, 1.04, turn / (WRAP_TURNS + 1));
        ctx.beginPath();
        ctx.moveTo(LENGTH * at, LENGTH * 0.14 - LENGTH * 0.26);
        ctx.lineTo(LENGTH * (at + 0.04), LENGTH * 0.22 + LENGTH * 0.26);
        ctx.stroke();
      }
      ctx.restore();

      const palm = ovalOutline(
        wrist.x + LENGTH * 0.18,
        wrist.y + LENGTH * 0.1,
        LENGTH * 0.22,
        LENGTH * 0.2,
        wristAlong,
        armSeed + 7,
        0.08,
      );
      paintMass(ctx, tracerFor(ctx, palm), HIDE_TONE);
      for (let finger = 0; finger < FINGER_COUNT; finger++) {
        const spread = ((finger + 0.5) / FINGER_COUNT - 0.5) * 1.5;
        const digit = chainOutline(
          quadSpine(
            { x: wrist.x + LENGTH * 0.26, y: wrist.y + LENGTH * (0.12 + spread * 0.14) },
            { x: wrist.x + LENGTH * 0.42, y: wrist.y + LENGTH * (0.16 + spread * 0.3) },
            { x: wrist.x + LENGTH * 0.52, y: wrist.y + LENGTH * (0.2 + spread * 0.46) },
          ),
          taperedHalves(LENGTH * 0.08, LENGTH * 0.03, 1.2),
          armSeed + finger * 3 + 11,
        );
        paintMass(ctx, tracerFor(ctx, digit), HIDE_TONE);
      }

      ctx.save();
      trace(0);
      ctx.clip();
      // The lit crown of the biceps, so the bulge is a dome rather than a lobe
      // of outline, and a pale seam along the underside.
      ctx.fillStyle = rgba(BELLY_MID, 0.7);
      ctx.beginPath();
      ctx.ellipse(-LENGTH * 0.5, LENGTH * 0.24, LENGTH * 0.3, LENGTH * 0.16, deg(-38), 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(HIDE_DARK, 0.55);
      ctx.lineWidth = LENGTH * 0.07;
      ctx.beginPath();
      ctx.moveTo(LENGTH * 0.12, -LENGTH * 0.56);
      ctx.lineTo(LENGTH * 0.42, -LENGTH * 0.2);
      ctx.stroke();
      ctx.strokeStyle = rgba(BELLY_MID, 0.6);
      ctx.lineWidth = LENGTH * 0.09;
      ctx.beginPath();
      ctx.moveTo(-LENGTH * 0.72, LENGTH * 0.5);
      ctx.quadraticCurveTo(LENGTH * 0.2, -LENGTH * 0.12, LENGTH * 1.0, LENGTH * 0.3);
      ctx.stroke();
      ctx.restore();

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -LENGTH * 1.2, y: LENGTH * 0.72 },
        radius: LENGTH * 0.3,
        squash: 0.58,
        angle: deg(66),
        bones: [{ at: { x: 0, y: 0 }, size: 0.4 }],
        runAngle: deg(190),
        seed: armWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const forearmSeed = nextSeed();
  const forearmSpeckSeed = nextSeed();
  const forearmWoundSeed = nextSeed();
  const forearm: GorePiece = {
    state: 'gore_forearm',
    paint: (ctx) => {
      // Straight, slimmer than the upper arm, wearing the lifting wrap, and
      // ending in a splayed hand. The hand is what keeps it from reading as a
      // second copy of the biceps piece: fingers off one end is a silhouette
      // nothing else in the set has.
      const LENGTH = 0.2;
      const spine = quadSpine(
        { x: -LENGTH, y: -LENGTH * 0.1 },
        { x: 0, y: 0 },
        { x: LENGTH * 0.62, y: LENGTH * 0.14 },
      );
      const outline = chainOutline(
        spine,
        taperedHalves(LENGTH * 0.34, LENGTH * 0.19, 1),
        forearmSeed,
      );
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, forearmSpeckSeed, LENGTH * 0.5);

      // The wrap: a band of strapping at the wrist end.
      const wrap = chainOutline(
        quadSpine(
          { x: LENGTH * 0.2, y: LENGTH * 0.06 },
          { x: LENGTH * 0.42, y: LENGTH * 0.1 },
          { x: LENGTH * 0.62, y: LENGTH * 0.14 },
        ),
        taperedHalves(LENGTH * 0.25, LENGTH * 0.23, 1),
        forearmSeed + 2,
      );
      const wrapTrace = tracerFor(ctx, wrap);
      paintMass(ctx, wrapTrace, WRAP_TONE);
      ctx.save();
      wrapTrace(0);
      ctx.clip();
      ctx.strokeStyle = rgba(WRAP_DARK, 0.7);
      ctx.lineWidth = LENGTH * 0.04;
      for (let turn = 1; turn <= WRAP_TURNS; turn++) {
        const x = lerp(LENGTH * 0.22, LENGTH * 0.6, turn / (WRAP_TURNS + 1));
        ctx.beginPath();
        ctx.moveTo(x, LENGTH * 0.06 - LENGTH * 0.3);
        ctx.lineTo(x + LENGTH * 0.05, LENGTH * 0.14 + LENGTH * 0.3);
        ctx.stroke();
      }
      ctx.restore();

      // The hand: a palm block with three splayed fingers off it.
      const palm = ovalOutline(
        LENGTH * 0.82,
        LENGTH * 0.2,
        LENGTH * 0.24,
        LENGTH * 0.22,
        deg(12),
        forearmSeed + 5,
        0.08,
      );
      paintMass(ctx, tracerFor(ctx, palm), HIDE_TONE);
      for (let i = 0; i < FINGER_COUNT; i++) {
        const spread = ((i + 0.5) / FINGER_COUNT - 0.5) * 1.5;
        const finger = chainOutline(
          quadSpine(
            { x: LENGTH * 0.9, y: LENGTH * 0.2 + spread * LENGTH * 0.16 },
            { x: LENGTH * 1.08, y: LENGTH * 0.2 + spread * LENGTH * 0.3 },
            { x: LENGTH * 1.2, y: LENGTH * 0.22 + spread * LENGTH * 0.46 },
          ),
          taperedHalves(LENGTH * 0.09, LENGTH * 0.03, 1.2),
          forearmSeed + i * 3,
        );
        paintMass(ctx, tracerFor(ctx, finger), HIDE_TONE);
      }

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -LENGTH * 0.9, y: -LENGTH * 0.09 },
        radius: LENGTH * 0.3,
        squash: 0.55,
        angle: deg(84),
        bones: [
          { at: { x: -0.3, y: 0 }, size: 0.3 },
          { at: { x: 0.35, y: 0.1 }, size: 0.24 },
        ],
        runAngle: deg(200),
        seed: forearmWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const thighSeed = nextSeed();
  const thighSpeckSeed = nextSeed();
  const thighWoundSeed = nextSeed();
  const thigh: GorePiece = {
    state: 'gore_thigh',
    paint: (ctx) => {
      // The thigh, with the shorts cuff still round its top. The purple band is
      // the only saturated non-green mark in the set and it is what makes this
      // piece nameable at 16 px.
      //
      // A straight column of even thickness is a chair leg, and painted at the
      // upper arm's size it was also the *smaller* of the two — on a creature
      // whose legs are thicker than his arms. The quad's belly swells below the
      // cuff and the whole thing tapers hard into the knee.
      const LENGTH = 0.3;
      // Bowed hard, not near-straight. A fat piece on a straight axis is an
      // upright blob whose silhouette the distinctness gate cannot tell from
      // the severed skull's; a thigh with a real bend in it shares nothing with
      // anything else in the set.
      const spine = quadSpine(
        { x: -LENGTH * 0.34, y: -LENGTH },
        { x: LENGTH * 0.34, y: 0 },
        { x: LENGTH * 0.52, y: LENGTH },
      );
      const outline = chainOutline(
        spine,
        Array.from({ length: SPINE_STEPS + 1 }, (_unused, i) => {
          const t = i / SPINE_STEPS;
          const quad =
            Math.sin(Math.min(1, (t + QUAD_BELLY_LEAD) / QUAD_BELLY_AT) * Math.PI) *
            QUAD_BELLY_SWELL;
          return LENGTH * (lerp(QUAD_ROOT_HALF, QUAD_KNEE_HALF, t ** 1.4) + quad);
        }),
        thighSeed,
      );
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, thighSpeckSeed, LENGTH * 0.5);

      // The quad's own crown, so the belly is a dome and not a wide spot.
      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = rgba(BELLY_MID, 0.55);
      ctx.beginPath();
      ctx.ellipse(-LENGTH * 0.14, -LENGTH * 0.1, LENGTH * 0.22, LENGTH * 0.44, deg(-8), 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(HIDE_DARK, 0.5);
      ctx.lineWidth = LENGTH * 0.07;
      ctx.beginPath();
      ctx.moveTo(LENGTH * 0.16, -LENGTH * 0.3);
      ctx.quadraticCurveTo(LENGTH * 0.3, LENGTH * 0.2, LENGTH * 0.2, LENGTH * 0.72);
      ctx.stroke();
      ctx.restore();

      const cuff = ovalOutline(
        -LENGTH * 0.08,
        -LENGTH * 0.52,
        LENGTH * 0.46,
        LENGTH * 0.17,
        deg(-6),
        thighSeed + 4,
        0.06,
      );
      const cuffTrace = tracerFor(ctx, cuff);
      paintMass(ctx, cuffTrace, SHORTS_TONE);
      ctx.save();
      cuffTrace(0);
      ctx.clip();
      ctx.fillStyle = rgba(SHORTS_LIGHT, 0.8);
      ctx.fillRect(-LENGTH * 0.5, -LENGTH * 0.6, LENGTH, LENGTH * 0.08);
      ctx.restore();

      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: LENGTH * 0.14, y: LENGTH * 1.05 },
        radius: LENGTH * 0.3,
        squash: 0.5,
        angle: deg(4),
        bones: [{ at: { x: 0, y: 0 }, size: 0.44 }],
        runAngle: deg(90),
        seed: thighWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const shinSeed = nextSeed();
  const shinSpeckSeed = nextSeed();
  const shinWoundSeed = nextSeed();
  const shin: GorePiece = {
    state: 'gore_shin',
    paint: (ctx) => {
      // A bent L: the shin coming down and the broad clawed foot turning off
      // it. The corner is the identification — nothing else in the set has one.
      const LENGTH = 0.2;
      const spine = quadSpine(
        { x: -LENGTH * 0.3, y: -LENGTH },
        { x: -LENGTH * 0.12, y: -LENGTH * 0.1 },
        { x: -LENGTH * 0.05, y: LENGTH * 0.5 },
      );
      const outline = chainOutline(
        spine,
        taperedHalves(LENGTH * 0.34, LENGTH * 0.2, 1.1),
        shinSeed,
      );
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, shinSpeckSeed, LENGTH * 0.45);

      const foot: Pt[] = [
        { x: -LENGTH * 0.3, y: LENGTH * 0.42 },
        { x: LENGTH * 0.62, y: LENGTH * 0.5 },
        { x: LENGTH * 0.66, y: LENGTH * 0.78 },
        { x: -LENGTH * 0.34, y: LENGTH * 0.76 },
      ];
      const footTrace = tracerFor(ctx, foot);
      paintMass(ctx, footTrace, HIDE_TONE);
      for (let i = 0; i < FOOT_CLAWS; i++) {
        const y = lerp(LENGTH * 0.52, LENGTH * 0.74, (i + 0.5) / FOOT_CLAWS);
        ctx.fillStyle = CLAW_MID;
        ctx.beginPath();
        ctx.moveTo(LENGTH * 0.6, y - LENGTH * 0.05);
        ctx.lineTo(LENGTH * 0.9, y);
        ctx.lineTo(LENGTH * 0.6, y + LENGTH * 0.05);
        ctx.closePath();
        ctx.fill();
      }

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -LENGTH * 0.32, y: -LENGTH * 1.08 },
        radius: LENGTH * 0.28,
        squash: 0.52,
        angle: deg(-8),
        bones: [
          { at: { x: -0.25, y: 0 }, size: 0.34 },
          { at: { x: 0.4, y: 0.1 }, size: 0.2 },
        ],
        runAngle: deg(-90),
        seed: shinWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  const entrailsSeed = nextSeed();
  const entrails: GorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      // One length of tubing, spiralled in on itself and running off at the end.
      //
      // Built instead as three equal rings laid out on a circle it is a
      // three-lobed rosette — a red clover, a flower, a decal. Nothing about
      // that arrangement is tube-shaped: the loops are all the same size, they
      // meet at the same angles, and no length of gut connects any two of them.
      // A spiral is the opposite on every count. It is one continuous run of
      // constant girth whose turns nest inside each other, its free end trails
      // away from the mass, and the lit side of the tube runs along the whole
      // thing so the reader sees a pipe rather than a stack of rings.
      const RADIUS = 0.2;
      const spine: Pt[] = [];
      for (let i = 0; i <= GUT_SPIRAL_STEPS; i++) {
        const t = i / GUT_SPIRAL_STEPS;
        const angle = t * GUT_SPIRAL_TURNS * TWO_PI + entrailsSeed;
        const reach = RADIUS * lerp(GUT_SPIRAL_INNER, 1, t ** GUT_SPIRAL_OPENING);
        const wobble = 1 + GUT_SPIRAL_WOBBLE * Math.sin(t * GUT_WOBBLE_LOBES + entrailsSeed);
        spine.push({
          x: Math.cos(angle) * reach * wobble,
          y: Math.sin(angle) * reach * wobble * GUT_SPIRAL_SQUASH,
        });
      }

      const runTube = (width: number, colour: string, alpha: number, shift: Pt): void => {
        ctx.beginPath();
        spine.forEach((point, i) => {
          const x = point.x + shift.x;
          const y = point.y + shift.y;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = alpha >= 1 ? colour : rgba(colour, alpha);
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      };

      const girth = RADIUS * GUT_TUBE_GIRTH;
      runTube(girth + GUT_TUBE_INK * 2, OUTLINE_INK, 1, { x: 0, y: 0 });
      runTube(girth, GUT_MID, 1, { x: 0, y: 0 });
      runTube(girth * 0.5, GUT_DARK, AMBIENT_ALPHA * 1.4, {
        x: girth * 0.22,
        y: girth * 0.24,
      });
      // The specular run along the top of the pipe. Without it the coil is a
      // flat red ribbon whatever shape it is bent into.
      runTube(girth * 0.3, GUT_LIGHT, GUT_SHEEN_ALPHA, {
        x: -girth * 0.24,
        y: -girth * 0.26,
      });

      // Constrictions across the tube, so its length is segmented the way a gut
      // is rather than reading as one extruded noodle.
      ctx.strokeStyle = rgba(GUT_DARK, GUT_KINK_ALPHA);
      ctx.lineWidth = girth * 0.16;
      for (let i = 1; i < GUT_KINKS + 1; i++) {
        const at = Math.round((i / (GUT_KINKS + 1)) * GUT_SPIRAL_STEPS);
        const here = spine[at];
        const ahead = spine[Math.min(GUT_SPIRAL_STEPS, at + 1)];
        const angle = Math.atan2(ahead.y - here.y, ahead.x - here.x) + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(
          here.x - Math.cos(angle) * girth * 0.44,
          here.y - Math.sin(angle) * girth * 0.44,
        );
        ctx.lineTo(
          here.x + Math.cos(angle) * girth * 0.44,
          here.y + Math.sin(angle) * girth * 0.44,
        );
        ctx.stroke();
      }
    },
  };

  const tailSeed = nextSeed();
  const tailSpeckSeed = nextSeed();
  const tailWoundSeed = nextSeed();
  const tail: GorePiece = {
    state: 'gore_tail',
    paint: (ctx) => {
      // The longest, thinnest piece in the set by a wide margin, banded along
      // its length and curved. Nothing else the game drops is shaped like this,
      // which is exactly why it is the piece a player names cold.
      const LENGTH = 0.42;
      const spine = quadSpine(
        { x: -LENGTH, y: -LENGTH * 0.2 },
        { x: 0, y: LENGTH * 0.34 },
        { x: LENGTH, y: -LENGTH * 0.08 },
      );
      const outline = chainOutline(
        spine,
        taperedHalves(LENGTH * 0.19, LENGTH * 0.025, 1.5),
        tailSeed,
      );
      const trace = tracerFor(ctx, outline);
      paintMass(ctx, trace, HIDE_TONE);
      speckleHide(ctx, trace, tailSpeckSeed, LENGTH * 0.5);

      ctx.save();
      trace(0);
      ctx.clip();
      // The pale underside, then the bands across it.
      ctx.strokeStyle = rgba(BELLY_MID, 0.75);
      ctx.lineWidth = LENGTH * 0.07;
      ctx.beginPath();
      ctx.moveTo(spine[0].x, spine[0].y + LENGTH * 0.1);
      for (const p of spine) ctx.lineTo(p.x, p.y + LENGTH * 0.07);
      ctx.stroke();
      ctx.strokeStyle = rgba(HIDE_DARK, 0.55);
      ctx.lineWidth = LENGTH * 0.035;
      for (let i = 1; i <= TAIL_BANDS; i++) {
        const index = Math.round((i / (TAIL_BANDS + 1)) * SPINE_STEPS);
        const p = spine[index];
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - LENGTH * 0.2);
        ctx.lineTo(p.x + LENGTH * 0.04, p.y + LENGTH * 0.2);
        ctx.stroke();
      }
      ctx.restore();

      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -LENGTH * 1.02, y: -LENGTH * 0.22 },
        radius: LENGTH * 0.17,
        squash: 0.5,
        angle: deg(70),
        bones: [{ at: { x: 0, y: 0 }, size: 0.36, hollow: true }],
        runAngle: deg(180),
        seed: tailWoundSeed,
        hide: HIDE_DARK,
      });
    },
  };

  return [head, torso, arm, forearm, thigh, shin, entrails, tail];
}
