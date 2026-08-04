/**
 * The seven pieces a Dark Knight comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered knight's injuries are
 * recognisably the same ones a dismembered rat has. What is here is the shape
 * of each piece and the plate on it.
 *
 * Armour changes what a wound looks like in one specific way: plate **shears**
 * rather than tearing, so most of these use `CutSpec.kind: 'clean'` and the
 * flesh only shows at the joins, framed by a bright steel lip. That lip is what
 * separates "a severed armoured limb" from "a grey rock with blood on it".
 *
 * The pieces are chosen for **silhouette**, not for anatomy: seven cells
 * tumbling past at 16 px must not read as seven identical grey blobs. So the
 * set spreads across a tall flat-topped bucket (the helm — nothing else in the
 * bestiary drops that shape), a broad curved shell (the pauldron), a big
 * ridged slab (the breastplate), a small blunt fist (the gauntlet), a long
 * two-segment stick with a hard plate at its bend (the arm), a longer one
 * ending in a pointed shoe (the leg), and a stick with a flanged lump on one
 * end (the mace, which is not a body part at all and is the more distinctive
 * for it).
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. The runtime pivots on the frame's *measured ink centre*, so a piece
 * painted off-centre still tumbles in place.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  MACE_HAFT_LENGTH,
  MACE_HEAD_HALF_WIDTH,
  MACE_HEAD_LENGTH,
  deg,
  lerp,
  rgba,
  type Pt,
} from './darkKnightArt';
import {
  AMBIENT_ALPHA,
  BLOOD,
  BLOOD_DARK,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  RIM_ALPHA,
  drawWound,
  grownOutline,
} from './goreWound';

const TWO_PI = Math.PI * 2;

/**
 * Plate tones as seen on a severed piece — darker than the standing figure's.
 *
 * A piece is lit only ambiently (it is spinning, so no directional key is
 * valid), and armour painted at its standing brightness comes out reading as a
 * pale stone.
 */
const PLATE_MID = '#39435a';
const PLATE_DARK = '#171b26';
const PLATE_LIGHT = '#6b7a96';
/** The bright sheared edge where a plate has been cut through. */
const SHEAR_EDGE = '#c8d4e8';
const OUTLINE_INK = '#0a0c11';
const BRASS_TRIM = '#8a6a22';
const LEATHER_GRIP = '#3c2a19';
const VISOR_VOID = '#050507';
const EMBER_DEAD = '#5a2a12';

/** A hard-cornered closed outline — what most plate wants. */
function traceHard(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, index) => {
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

type Trace = (grow: number) => void;

/**
 * The ambient fill and rotation-safe rim every piece receives. The occlusion
 * runs toward the middle rather than down from a key light: the piece spins, so
 * any single light direction is wrong most of the time.
 */
function paintMass(ctx: Ctx, trace: Trace, mid: string, dark: string, light: string): void {
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

function paintPlateMass(ctx: Ctx, trace: Trace): void {
  paintMass(ctx, trace, PLATE_MID, PLATE_DARK, PLATE_LIGHT);
}

/**
 * The bright line of bare metal along a sheared edge. Without it a cut plate is
 * the same colour all the way round and reads as a shape that was always that
 * shape, rather than as one that has just been broken off something.
 */
function shearLine(ctx: Ctx, from: Pt, to: Pt): void {
  ctx.strokeStyle = SHEAR_EDGE;
  ctx.lineWidth = SHEAR_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

const SHEAR_WIDTH = 0.012;

/** Rivets and score marks, so a big flat plate is not an empty field. */
function rivets(ctx: Ctx, points: readonly Pt[], radius: number): void {
  ctx.fillStyle = rgba(PLATE_LIGHT, 0.75);
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TWO_PI);
    ctx.fill();
  }
}

/** A splash of blood over plate, for the pieces that took flesh with them. */
function bloodSplash(ctx: Ctx, trace: Trace, at: Pt, radius: number, seed: number): void {
  ctx.save();
  trace(0);
  ctx.clip();
  const SPLASH_BLOBS = 5;
  for (let i = 0; i < SPLASH_BLOBS; i++) {
    const angle = ((i * 2.399 + seed) % TWO_PI) - Math.PI;
    const reach = radius * lerp(0.25, 1, (i * 0.618 + seed) % 1);
    ctx.fillStyle = i % 2 === 0 ? BLOOD : BLOOD_DARK;
    ctx.beginPath();
    ctx.arc(
      at.x + Math.cos(angle) * reach,
      at.y + Math.sin(angle) * reach,
      radius * lerp(0.18, 0.42, (i * 0.371 + seed) % 1),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();
}

export interface GorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const PIECE_SEED_BASE = 5309;

/**
 * The seven pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, and never from inside a `paint`
 * closure: the bake paints every piece more than once, and a counter advanced
 * during painting would hand each pass a different picture.
 */
export function darkKnightGorePieces(): readonly GorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 811;

  const helmWoundSeed = nextSeed();
  const helm: GorePiece = {
    state: 'gore_helm',
    paint: (ctx) => {
      const HALF_W = 0.1;
      const HALF_H = 0.125;
      const outline: Pt[] = [
        { x: -HALF_W * 0.78, y: -HALF_H },
        { x: HALF_W * 0.78, y: -HALF_H },
        { x: HALF_W, y: -HALF_H * 0.55 },
        { x: HALF_W * 0.92, y: HALF_H * 0.5 },
        { x: HALF_W * 0.6, y: HALF_H },
        { x: -HALF_W * 0.6, y: HALF_H },
        { x: -HALF_W * 0.92, y: HALF_H * 0.5 },
        { x: -HALF_W, y: -HALF_H * 0.55 },
      ];
      const trace: Trace = (grow) => traceHard(ctx, grownOutline(outline, grow));
      paintPlateMass(ctx, trace);

      ctx.save();
      trace(0);
      ctx.clip();
      // The visor: the one feature that makes this cell unmistakably a head.
      // The embers behind it are out, which is the point of the piece.
      ctx.fillStyle = BRASS_TRIM;
      ctx.fillRect(-HALF_W * 0.11, -HALF_H, HALF_W * 0.22, HALF_H * 2);
      ctx.fillStyle = VISOR_VOID;
      ctx.fillRect(-HALF_W * 0.85, -HALF_H * 0.2, HALF_W * 1.7, HALF_H * 0.22);
      ctx.fillStyle = rgba(EMBER_DEAD, 0.8);
      ctx.fillRect(-HALF_W * 0.5, -HALF_H * 0.17, HALF_W * 0.22, HALF_H * 0.16);
      ctx.restore();

      // Torn off at the gorget, so the wound is on the underside.
      drawWound(ctx, {
        kind: 'clean',
        centre: { x: 0, y: HALF_H * 0.82 },
        radius: 0.05,
        squash: 0.55,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
        runAngle: deg(90),
        seed: helmWoundSeed,
        hide: PLATE_DARK,
      });
      shearLine(
        ctx,
        { x: -HALF_W * 0.62, y: HALF_H * 0.98 },
        { x: HALF_W * 0.62, y: HALF_H * 0.98 },
      );
    },
  };

  const pauldronWoundSeed = nextSeed();
  const pauldron: GorePiece = {
    state: 'gore_pauldron',
    paint: (ctx) => {
      // A long shallow crescent — wider than it is tall by nearly three to one,
      // which is the one proportion nothing else in the set has.
      const HALF_W = 0.155;
      const HALF_H = 0.056;
      // The lames are cut into the *outline*, not scored on top of it. Smooth,
      // this piece measured as a featureless lozenge and named as a slug.
      const LAME_STEPS = 3;
      const outline: Pt[] = [
        { x: -HALF_W, y: HALF_H * 0.5 },
        { x: -HALF_W * 0.88, y: -HALF_H * 0.55 },
        { x: -HALF_W * 0.2, y: -HALF_H },
        { x: HALF_W * 0.55, y: -HALF_H * 0.9 },
        { x: HALF_W, y: -HALF_H * 0.15 },
      ];
      for (let i = 0; i < LAME_STEPS; i++) {
        const t = i / LAME_STEPS;
        outline.push({ x: lerp(HALF_W, -HALF_W * 0.4, t), y: HALF_H });
        outline.push({ x: lerp(HALF_W, -HALF_W * 0.4, t + 1 / LAME_STEPS), y: HALF_H * 0.45 });
      }
      const trace: Trace = (grow) => traceHard(ctx, grownOutline(outline, grow));
      paintPlateMass(ctx, trace);

      ctx.save();
      trace(0);
      ctx.clip();
      // The lame seams are the whole read: a plain curved shell is a shield.
      ctx.strokeStyle = rgba(OUTLINE_INK, 0.85);
      ctx.lineWidth = 0.014;
      for (const y of [-HALF_H * 0.2, HALF_H * 0.45]) {
        ctx.beginPath();
        ctx.moveTo(-HALF_W, y);
        ctx.lineTo(HALF_W, y + HALF_H * 0.15);
        ctx.stroke();
      }
      ctx.restore();
      rivets(
        ctx,
        [
          { x: -HALF_W * 0.55, y: -HALF_H * 0.55 },
          { x: HALF_W * 0.35, y: -HALF_H * 0.5 },
        ],
        0.012,
      );

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -HALF_W * 0.62, y: HALF_H * 0.45 },
        radius: 0.042,
        squash: 0.85,
        angle: deg(20),
        bones: [{ at: { x: 0.1, y: 0 }, size: 0.4 }],
        runAngle: deg(160),
        seed: pauldronWoundSeed,
        hide: PLATE_DARK,
      });
    },
  };

  const breastplateWoundSeed = nextSeed();
  const breastplateSplashSeed = nextSeed();
  const breastplate: GorePiece = {
    state: 'gore_breastplate',
    paint: (ctx) => {
      const HALF_W = 0.125;
      const HALF_H = 0.14;
      const outline: Pt[] = [
        { x: -HALF_W, y: -HALF_H },
        { x: HALF_W, y: -HALF_H * 0.86 },
        { x: HALF_W * 0.88, y: HALF_H * 0.35 },
        { x: HALF_W * 0.5, y: HALF_H },
        { x: -HALF_W * 0.62, y: HALF_H * 0.92 },
        { x: -HALF_W * 0.94, y: HALF_H * 0.1 },
      ];
      const trace: Trace = (grow) => traceHard(ctx, grownOutline(outline, grow));
      paintPlateMass(ctx, trace);

      ctx.save();
      trace(0);
      ctx.clip();
      // The medial ridge, carried over from the standing figure so the piece is
      // identifiable as the front of him rather than as any flat plate.
      ctx.strokeStyle = rgba(PLATE_LIGHT, 0.8);
      ctx.lineWidth = 0.016;
      ctx.beginPath();
      ctx.moveTo(-HALF_W * 0.05, -HALF_H);
      ctx.lineTo(HALF_W * 0.05, HALF_H);
      ctx.stroke();
      ctx.restore();

      bloodSplash(ctx, trace, { x: HALF_W * 0.2, y: 0 }, 0.09, breastplateSplashSeed);
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: -HALF_W * 0.25, y: -HALF_H * 0.25 },
        radius: 0.055,
        squash: 0.95,
        angle: deg(-40),
        bones: [
          { at: { x: -0.35, y: 0.2 }, size: 0.3, hollow: true },
          { at: { x: 0.4, y: -0.1 }, size: 0.26, hollow: true },
        ],
        runAngle: deg(120),
        seed: breastplateWoundSeed,
        hide: PLATE_DARK,
      });
      shearLine(ctx, { x: HALF_W * 0.9, y: -HALF_H * 0.8 }, { x: HALF_W * 0.55, y: HALF_H * 0.95 });
    },
  };

  const gauntletWoundSeed = nextSeed();
  const gauntlet: GorePiece = {
    state: 'gore_gauntlet',
    paint: (ctx) => {
      // Half again its first size. Measured at 24×15 in-game pixels it was
      // below the size at which any shape can be told from any other.
      const HALF_W = 0.098;
      const HALF_H = 0.07;
      // Three knuckles cut into the *silhouette*, not painted on it. Studs on a
      // smooth shell left this piece 66% identical to the pauldron under the
      // distinctness gate; a bumped outline is what tells a fist from a shell
      // at sixteen pixels, and painted detail never will.
      const KNUCKLES = 3;
      // A flared cuff at the wrist end, then the knuckled fist. Cuff *and*
      // knuckles: with only one of the two the piece was still a lozenge.
      const outline: Pt[] = [
        { x: -HALF_W, y: -HALF_H * 1.15 },
        { x: -HALF_W * 0.72, y: -HALF_H * 0.45 },
        { x: -HALF_W * 0.2, y: -HALF_H * 0.9 },
        { x: HALF_W * 0.15, y: -HALF_H },
      ];
      for (let i = 0; i < KNUCKLES; i++) {
        const t = (i + 0.5) / KNUCKLES;
        const y = lerp(-HALF_H * 0.9, HALF_H * 0.9, t);
        outline.push({ x: HALF_W * 1.15, y: y - HALF_H * 0.22 });
        outline.push({ x: HALF_W * 0.68, y: y + HALF_H * 0.2 });
      }
      outline.push({ x: HALF_W * 0.2, y: HALF_H });
      outline.push({ x: -HALF_W * 0.2, y: HALF_H * 0.9 });
      outline.push({ x: -HALF_W * 0.72, y: HALF_H * 0.45 });
      outline.push({ x: -HALF_W, y: HALF_H * 1.15 });
      const trace: Trace = (grow) => traceHard(ctx, grownOutline(outline, grow));
      paintPlateMass(ctx, trace);
      rivets(
        ctx,
        [
          { x: HALF_W * 0.25, y: -HALF_H * 0.4 },
          { x: HALF_W * 0.45, y: 0 },
          { x: HALF_W * 0.3, y: HALF_H * 0.4 },
        ],
        0.011,
      );
      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -HALF_W * 0.72, y: 0 },
        radius: 0.032,
        squash: 0.7,
        angle: deg(90),
        bones: [
          { at: { x: -0.3, y: 0 }, size: 0.34 },
          { at: { x: 0.35, y: 0.1 }, size: 0.3 },
        ],
        runAngle: deg(180),
        seed: gauntletWoundSeed,
        hide: PLATE_DARK,
      });
    },
  };

  const armWoundSeed = nextSeed();
  const armElbowSeed = nextSeed();
  const arm: GorePiece = {
    state: 'gore_arm',
    paint: (ctx) => {
      const HALF_LEN = 0.14;
      const WIDTH = 0.038;
      // Bent at the elbow, which is what tells this stick from the leg's.
      const upper: Pt[] = [
        { x: -WIDTH, y: -HALF_LEN },
        { x: WIDTH, y: -HALF_LEN },
        { x: WIDTH * 1.5, y: 0 },
        { x: -WIDTH * 1.2, y: 0 },
      ];
      const lower: Pt[] = [
        { x: -WIDTH * 1.2, y: 0 },
        { x: WIDTH * 1.5, y: 0 },
        { x: WIDTH * 2.6, y: HALF_LEN },
        { x: WIDTH * 0.4, y: HALF_LEN },
      ];
      const traceUpper: Trace = (grow) => traceHard(ctx, grownOutline(upper, grow));
      const traceLower: Trace = (grow) => traceHard(ctx, grownOutline(lower, grow));
      paintPlateMass(ctx, traceUpper);
      paintPlateMass(ctx, traceLower);

      // The couter still strapped over the bend — the piece's identity.
      // Deliberately oversized. This bulge at the bend is the only thing that
      // separates this cell from the leg's — both are otherwise a plated stick
      // — and at sixteen pixels a subtle one is no cue at all.
      const couter: Pt[] = [
        { x: -WIDTH * 2.4, y: -WIDTH * 1.1 },
        { x: WIDTH * 2.9, y: -WIDTH * 0.9 },
        { x: WIDTH * 3.2, y: WIDTH * 1.5 },
        { x: -WIDTH * 2.2, y: WIDTH * 1.3 },
      ];
      paintPlateMass(ctx, (grow) => traceHard(ctx, grownOutline(couter, grow)));

      drawWound(ctx, {
        kind: 'clean',
        centre: { x: 0, y: -HALF_LEN * 0.94 },
        radius: 0.034,
        squash: 0.6,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.45, hollow: true }],
        runAngle: deg(-90),
        seed: armWoundSeed,
        hide: PLATE_DARK,
      });
      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: WIDTH * 1.5, y: HALF_LEN * 0.94 },
        radius: 0.03,
        squash: 0.6,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.4 }],
        runAngle: deg(90),
        seed: armElbowSeed,
        hide: PLATE_DARK,
      });
    },
  };

  const legWoundSeed = nextSeed();
  const legSplashSeed = nextSeed();
  const leg: GorePiece = {
    state: 'gore_leg',
    paint: (ctx) => {
      const HALF_LEN = 0.175;
      const WIDTH = 0.05;
      const shin: Pt[] = [
        { x: -WIDTH, y: -HALF_LEN },
        { x: WIDTH, y: -HALF_LEN },
        { x: WIDTH * 0.7, y: HALF_LEN * 0.55 },
        { x: -WIDTH * 0.7, y: HALF_LEN * 0.55 },
      ];
      const traceShin: Trace = (grow) => traceHard(ctx, grownOutline(shin, grow));
      paintPlateMass(ctx, traceShin);

      // A pointed sabaton on the end: the one shape in the set that ends in a
      // chisel, and the reason this cell cannot be mistaken for the arm.
      const foot: Pt[] = [
        { x: -WIDTH * 0.8, y: HALF_LEN * 0.45 },
        { x: WIDTH * 0.8, y: HALF_LEN * 0.45 },
        { x: WIDTH * 1.5, y: HALF_LEN * 0.8 },
        { x: WIDTH * 0.2, y: HALF_LEN },
        { x: -WIDTH * 1.4, y: HALF_LEN * 0.85 },
      ];
      paintPlateMass(ctx, (grow) => traceHard(ctx, grownOutline(foot, grow)));

      bloodSplash(ctx, traceShin, { x: 0, y: -HALF_LEN * 0.5 }, 0.06, legSplashSeed);
      drawWound(ctx, {
        kind: 'clean',
        centre: { x: 0, y: -HALF_LEN * 0.95 },
        radius: 0.045,
        squash: 0.6,
        angle: 0,
        bones: [{ at: { x: 0, y: 0 }, size: 0.5, hollow: true }],
        runAngle: deg(-90),
        seed: legWoundSeed,
        hide: PLATE_DARK,
      });
      shearLine(ctx, { x: -WIDTH, y: -HALF_LEN * 1.02 }, { x: WIDTH, y: -HALF_LEN * 1.02 });
    },
  };

  const GORE_MACE_HEAD_FLARE = 1.35;
  const mace: GorePiece = {
    state: 'gore_mace',
    paint: (ctx) => {
      // Scaled off the live weapon so the dropped mace is recognisably the one
      // he was swinging, rather than a second, smaller club.
      const SCALE = 0.5;
      const half = (MACE_HAFT_LENGTH + MACE_HEAD_LENGTH) * SCALE * 0.5;
      const width = 0.022;
      const shaft: Pt[] = [
        { x: -width, y: -half },
        { x: width, y: -half },
        { x: width * 0.8, y: half * 0.35 },
        { x: -width * 0.8, y: half * 0.35 },
      ];
      paintPlateMass(ctx, (grow) => traceHard(ctx, grownOutline(shaft, grow)));

      ctx.save();
      traceHard(ctx, shaft);
      ctx.clip();
      ctx.fillStyle = LEATHER_GRIP;
      ctx.fillRect(-width, -half, width * 2, half * 0.7);
      ctx.restore();

      // Widened past the live weapon's own ratio: on the body the head is read
      // in context, and alone on a tumbling cell it has to carry the whole
      // identity. Narrower, it named as a torch.
      const headHalf = MACE_HEAD_HALF_WIDTH * SCALE * GORE_MACE_HEAD_FLARE;
      const headTop = half * 0.3;
      const headBottom = half;
      // Two flange steps per side, the same stepped outline the live weapon
      // has. A smooth lump on a stick is a spade — that is what a blind naming
      // test called the first attempt at the standing figure's mace, and the
      // dropped one has less context to rescue it, not more.
      const FLANGE_STEPS = 2;
      const head: Pt[] = [{ x: -width * 1.6, y: headTop }];
      for (let i = 0; i < FLANGE_STEPS; i++) {
        const near = headTop + ((headBottom - headTop) * i) / FLANGE_STEPS;
        const far = headTop + ((headBottom - headTop) * (i + 0.65)) / FLANGE_STEPS;
        head.push({ x: -headHalf, y: near });
        head.push({ x: -headHalf, y: far });
        head.push({ x: -width * 1.9, y: far + (headBottom - headTop) * 0.08 });
      }
      head.push({ x: 0, y: headBottom });
      for (let i = FLANGE_STEPS - 1; i >= 0; i--) {
        const near = headTop + ((headBottom - headTop) * i) / FLANGE_STEPS;
        const far = headTop + ((headBottom - headTop) * (i + 0.65)) / FLANGE_STEPS;
        head.push({ x: width * 1.9, y: far + (headBottom - headTop) * 0.08 });
        head.push({ x: headHalf, y: far });
        head.push({ x: headHalf, y: near });
      }
      head.push({ x: width * 1.6, y: headTop });
      paintPlateMass(ctx, (grow) => traceHard(ctx, grownOutline(head, grow)));
      ctx.fillStyle = BRASS_TRIM;
      ctx.fillRect(-width * 1.8, headTop - width * 0.6, width * 3.6, width * 1.2);
    },
  };

  return [helm, pauldron, breastplate, gauntlet, arm, leg, mace];
}
