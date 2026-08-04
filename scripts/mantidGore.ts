/**
 * The eight pieces a mantis comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered mantis's injuries are
 * recognisably the same ones a dismembered rat or llama has. What is here is the
 * shape of each piece, the chitin on it, and the pale hemolymph that runs out of
 * a bug rather than the red that runs out of a mammal.
 *
 * **Hemolymph, not blood.** Insect haemolymph is a thin greenish-yellow, and it
 * is the one palette decision that keeps a pile of severed limbs reading as
 * *bug* instead of as generic meat. The shared wound engine still paints the cut
 * face — the muscle and the hollow of a leg segment are what make a wound read
 * as a wound at all — but everything that runs, pools or spatters out of it here
 * is hemolymph.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. Eight cells
 * tumbling past at 16 px must not read as eight identical chips, so the set is
 * spread across a hooked and spined raptorial arm (nothing else in the bestiary
 * drops anything remotely that shape), a triangular head trailing one antenna,
 * a long straight column (the pronotum), a fat segmented cone (the abdomen), a
 * ragged flat sheet (a wing case), a thin zigzag stick (a walking leg), a coiled
 * rope (the gut) and a curved shard (a broken plate of carapace).
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell. Every piece is painted from the live animal's own `MantidBuild`, so the
 * boss's pieces are his colour and the crony's are hers.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  TWO_PI,
  clamp01,
  deg,
  drawSpineRow,
  hash1,
  lerp,
  mix,
  rgba,
  segmentOutline,
  traceOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt.js';
import {
  AMBIENT_ALPHA,
  FLESH_AMBIENT_INSET,
  FLESH_OUTLINE_GROW,
  FLESH_RIM_INSET,
  FLESH_RIM_WIDTH,
  MUSCLE_DARK,
  MUSCLE_LIGHT,
  MUSCLE_MID,
  RIM_ALPHA,
  drawWound,
  grownOutline,
  type CutSpec,
} from './goreWound.js';

// ── Hemolymph ────────────────────────────────────────────────────────────────

/** Insect blood: thin, pale and greenish. Never red. */
const HEMOLYMPH = '#b9c66a';
const HEMOLYMPH_DARK = '#5d6a2a';
const HEMOLYMPH_GLOSS = 'rgba(240,248,190,0.55)';
/** The soft inner tissue behind a broken plate — paler and yellower than muscle. */
const VISCERA_MID = '#8f8f4a';
const VISCERA_DARK = '#464a1e';
const VISCERA_LIGHT = '#c3c079';

/**
 * How dark a piece is painted relative to the standing animal.
 *
 * A piece is lit only ambiently — it is spinning, so no directional key is
 * valid — and chitin painted at its standing brightness comes out reading as a
 * pale pebble.
 */
const PIECE_DARKEN = 0.35;

interface PieceTones {
  readonly mid: string;
  readonly dark: string;
  readonly light: string;
  readonly ink: string;
}

function chitinTones(build: MantidBuild): PieceTones {
  const { palette } = build;
  return {
    mid: mix(palette.base, palette.dark, PIECE_DARKEN),
    dark: palette.dark,
    light: mix(palette.light, palette.dark, PIECE_DARKEN * 0.6),
    ink: palette.ink,
  };
}

// ── Shared painting ──────────────────────────────────────────────────────────

/** A closed smooth loop appended to the *current* path, for even-odd holes. */
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

type Trace = (grow: number) => void;

function traceFor(ctx: Ctx, outline: readonly Pt[]): Trace {
  return (grow: number) => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

/**
 * The ambient fill and rotation-safe rim every piece receives.
 *
 * The occlusion runs toward the middle rather than down from a key light: the
 * piece spins, so any single light direction is wrong most of the time.
 */
function paintMass(ctx: Ctx, trace: Trace, tones: PieceTones): void {
  ctx.fillStyle = tones.ink;
  trace(FLESH_OUTLINE_GROW);
  ctx.fill();
  ctx.fillStyle = tones.mid;
  trace(0);
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(tones.dark, AMBIENT_ALPHA);
  ctx.fillRect(-1, -1, 2, 2);
  ctx.fillStyle = rgba(tones.light, AMBIENT_ALPHA * 1.4);
  trace(-FLESH_AMBIENT_INSET);
  ctx.fill();
  ctx.restore();

  ctx.save();
  trace(-FLESH_RIM_INSET);
  ctx.clip();
  ctx.strokeStyle = rgba(tones.light, RIM_ALPHA);
  ctx.lineWidth = FLESH_RIM_WIDTH;
  trace(-FLESH_RIM_INSET);
  ctx.stroke();
  ctx.restore();
}

function paintChitinMass(ctx: Ctx, trace: Trace, build: MantidBuild): void {
  paintMass(ctx, trace, chitinTones(build));
}

function paintVisceraMass(ctx: Ctx, trace: Trace): void {
  paintMass(ctx, trace, {
    mid: VISCERA_MID,
    dark: VISCERA_DARK,
    light: VISCERA_LIGHT,
    ink: '#221f10',
  });
}

/** Strength of the hemolymph wash laid over a cut face. */
const WOUND_WASH_ALPHA = 0.5;

/**
 * Shifts a finished wound from mammal red toward hemolymph olive.
 *
 * The shared wound engine paints in blood red, and that is right — the muscle,
 * the fat and the hollow of a cut segment are what make a wound read as a wound
 * at all, and re-deriving them per creature is exactly what `goreWound.ts`
 * exists to prevent. But a bug that bleeds red is a mammal, so the finished face
 * gets a translucent wash that lands the colour between the two: still legibly
 * an injury, no longer legibly a mammal's.
 */
function washWound(ctx: Ctx, centre: Pt, radius: number, angle: number, squash: number): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(angle);
  ctx.scale(1, squash);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  wash.addColorStop(0, rgba(HEMOLYMPH, WOUND_WASH_ALPHA));
  wash.addColorStop(0.7, rgba(HEMOLYMPH_DARK, WOUND_WASH_ALPHA * 0.8));
  wash.addColorStop(1, rgba(HEMOLYMPH_DARK, 0));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Every cut on this creature: the shared wound, then the hemolymph wash over it. */
function cutAndWash(ctx: Ctx, cut: CutSpec): void {
  drawWound(ctx, cut);
  washWound(ctx, cut.centre, cut.radius, cut.angle, cut.squash);
}

/**
 * Hemolymph running off the piece: a few thin runs and a spatter, all pale
 * green. Drawn outside the clip so it breaks the silhouette the way fluid does.
 */
function paintHemolymph(ctx: Ctx, from: Pt, runAngle: number, seed: number, reach: number): void {
  const RUNS = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < RUNS; i++) {
    const spread = (hash1(seed + i * 3.1) - 0.5) * deg(70);
    const angle = runAngle + spread;
    const len = reach * (0.5 + hash1(seed + i * 7.3) * 0.8);
    const width = 0.006 + hash1(seed + i * 5.7) * 0.008;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(
      from.x + Math.cos(angle) * len * 0.5 - Math.sin(angle) * len * 0.2,
      from.y + Math.sin(angle) * len * 0.5 + Math.cos(angle) * len * 0.2,
      from.x + Math.cos(angle) * len,
      from.y + Math.sin(angle) * len,
    );
    ctx.strokeStyle = rgba(i % 2 === 0 ? HEMOLYMPH : HEMOLYMPH_DARK, 0.85);
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(from.x + Math.cos(angle) * len, from.y + Math.sin(angle) * len, width * 0.9, 0, TWO_PI);
    ctx.fillStyle = rgba(HEMOLYMPH, 0.9);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(from.x, from.y, reach * 0.16, 0, TWO_PI);
  ctx.fillStyle = HEMOLYMPH_GLOSS;
  ctx.fill();
}

/** Segment creases across a piece, clipped to it — the cue that chitin is plated. */
function scoreSegments(
  ctx: Ctx,
  trace: Trace,
  build: MantidBuild,
  from: Pt,
  to: Pt,
  count: number,
  half: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  trace(0);
  ctx.clip();
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const cx = lerp(from.x, to.x, t);
    const cy = lerp(from.y, to.y, t);
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(angle) * half, cy + Math.cos(angle) * half);
    ctx.lineTo(cx + Math.sin(angle) * half, cy - Math.cos(angle) * half);
    ctx.strokeStyle = rgba(build.palette.ink, 0.4);
    ctx.lineWidth = 0.008;
    ctx.stroke();
  }
  ctx.restore();
}

export interface MantidGorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx, build: MantidBuild) => void;
}

const PIECE_SEED_BASE = 4231;

/**
 * The eight pieces, in the order `BodyPartGoreSystem` spawns them.
 *
 * Seeds are drawn **here**, at construction, and never from inside a `paint`
 * closure. The bake paints every piece three times — measure, re-measure after
 * re-centring, then render — and a counter advanced during painting would hand
 * each pass a different picture, so the offsets measured on one would be applied
 * to another and every piece would bake off-centre in its cell.
 */
export function mantidGorePieces(): readonly MantidGorePiece[] {
  let seedCounter = 0;
  const nextSeed = (): number => PIECE_SEED_BASE + seedCounter++ * 811;

  const armSeed = nextSeed();
  const armWoundSeed = nextSeed();
  /**
   * The severed raptorial arm, still folded shut. It is the most identifiable
   * thing this creature owns, so it is the first piece and it keeps its spines.
   */
  const raptorialArm: MantidGorePiece = {
    state: 'gore_raptorial_arm',
    paint: (ctx, build) => {
      const FEMUR_A: Pt = { x: -0.13, y: 0.06 };
      const FEMUR_B: Pt = { x: 0.12, y: -0.04 };
      const TIBIA_B: Pt = { x: -0.09, y: -0.12 };
      const femur = segmentOutline(FEMUR_A, FEMUR_B, 0.05, 0.028, 0.018);
      const tibia = segmentOutline(FEMUR_B, TIBIA_B, 0.026, 0.011, -0.014);

      paintChitinMass(ctx, traceFor(ctx, femur), build);
      paintChitinMass(ctx, traceFor(ctx, tibia), build);
      drawSpineRow(ctx, build, FEMUR_A, FEMUR_B, 6, 0.03, -1, armSeed);
      drawSpineRow(ctx, build, FEMUR_B, TIBIA_B, 6, 0.022, 1, armSeed + 2.7);

      // The terminal claw, so the piece still ends in a hook.
      ctx.beginPath();
      ctx.moveTo(TIBIA_B.x, TIBIA_B.y);
      ctx.quadraticCurveTo(TIBIA_B.x - 0.03, TIBIA_B.y - 0.03, TIBIA_B.x - 0.01, TIBIA_B.y - 0.06);
      ctx.strokeStyle = rgba(build.palette.ink, 0.95);
      ctx.lineWidth = 0.014;
      ctx.lineCap = 'round';
      ctx.stroke();

      cutAndWash(ctx, {
        kind: 'crushed',
        centre: FEMUR_A,
        radius: 0.05,
        squash: 0.85,
        angle: deg(160),
        bones: [{ at: { x: 0, y: 0 }, size: 0.34, hollow: true }],
        runAngle: deg(168),
        seed: armWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, FEMUR_A, deg(168), armWoundSeed, 0.11);
    },
  };

  const headSeed = nextSeed();
  const headWoundSeed = nextSeed();
  const head: MantidGorePiece = {
    state: 'gore_head',
    paint: (ctx, build) => {
      const HALF_W = 0.11;
      const TOP = -0.06;
      const CHIN = 0.07;
      const outline: Pt[] = [
        { x: -HALF_W, y: TOP },
        { x: -HALF_W * 0.85, y: CHIN * 0.3 },
        { x: -HALF_W * 0.3, y: CHIN },
        { x: HALF_W * 0.3, y: CHIN },
        { x: HALF_W * 0.85, y: CHIN * 0.3 },
        { x: HALF_W, y: TOP },
      ];
      paintChitinMass(ctx, traceFor(ctx, outline), build);

      // Both eyes, dulled. A dead compound eye loses its sheen and its
      // pseudopupil spreads — that is what makes the piece read as a *dead*
      // head rather than as a head that is still looking at you.
      for (const sign of [-1, 1]) {
        const ex = sign * HALF_W * 0.66;
        ctx.beginPath();
        ctx.ellipse(ex, TOP + 0.026, 0.036, 0.042, 0, 0, TWO_PI);
        ctx.fillStyle = mix(build.palette.eye, build.palette.eyeDark, 0.55);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex, TOP + 0.03, 0.02, 0.024, 0, 0, TWO_PI);
        ctx.fillStyle = rgba(build.palette.eyeDark, 0.8);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex, TOP + 0.026, 0.036, 0.042, 0, 0, TWO_PI);
        ctx.strokeStyle = rgba(build.palette.ink, 0.85);
        ctx.lineWidth = 0.007;
        ctx.stroke();
      }

      // A single trailing antenna. Two would be tidy; one says it was torn off.
      ctx.beginPath();
      ctx.moveTo(-HALF_W * 0.35, TOP);
      ctx.quadraticCurveTo(-HALF_W * 1.6, TOP - 0.09, -HALF_W * 1.1, TOP - 0.17);
      ctx.strokeStyle = rgba(build.palette.ink, 0.85);
      ctx.lineWidth = 0.008;
      ctx.lineCap = 'round';
      ctx.stroke();

      cutAndWash(ctx, {
        kind: 'torn',
        centre: { x: 0, y: CHIN * 0.85 },
        radius: 0.045,
        squash: 0.8,
        angle: deg(4),
        bones: [],
        runAngle: deg(96),
        seed: headWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, { x: 0, y: CHIN * 0.9 }, deg(96), headSeed, 0.1);
    },
  };

  const pronotumSeed = nextSeed();
  const pronotumWoundSeed = nextSeed();
  const pronotum: MantidGorePiece = {
    state: 'gore_pronotum',
    paint: (ctx, build) => {
      const A: Pt = { x: -0.02, y: 0.18 };
      const B: Pt = { x: 0.03, y: -0.17 };
      const outline = segmentOutline(A, B, 0.055, 0.032, 0.012);
      paintChitinMass(ctx, traceFor(ctx, outline), build);
      scoreSegments(ctx, traceFor(ctx, outline), build, A, B, 4, 0.06);

      // The dorsal keel that ran the length of it in life.
      ctx.save();
      traceFor(ctx, outline)(0);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = rgba(build.palette.light, 0.45);
      ctx.lineWidth = 0.01;
      ctx.stroke();
      ctx.restore();

      cutAndWash(ctx, {
        kind: 'clean',
        centre: A,
        radius: 0.052,
        squash: 0.85,
        angle: deg(8),
        bones: [{ at: { x: 0, y: 0 }, size: 0.42, hollow: true }],
        runAngle: deg(100),
        seed: pronotumWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, A, deg(100), pronotumSeed, 0.12);
    },
  };

  const abdomenSeed = nextSeed();
  const abdomenWoundSeed = nextSeed();
  const abdomen: MantidGorePiece = {
    state: 'gore_abdomen',
    paint: (ctx, build) => {
      const ROOT: Pt = { x: -0.15, y: 0.05 };
      const TIP: Pt = { x: 0.17, y: -0.05 };
      const STEPS = 14;
      const outline: Pt[] = [];
      const halfAt = (t: number): number =>
        t < 0.35 ? lerp(0.075, 0.098, t / 0.35) : lerp(0.098, 0.014, (t - 0.35) / 0.65);
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        outline.push({
          x: lerp(ROOT.x, TIP.x, t),
          y: lerp(ROOT.y, TIP.y, t) - halfAt(t),
        });
      }
      for (let i = STEPS; i >= 0; i--) {
        const t = i / STEPS;
        outline.push({
          x: lerp(ROOT.x, TIP.x, t),
          y: lerp(ROOT.y, TIP.y, t) + halfAt(t),
        });
      }
      paintChitinMass(ctx, traceFor(ctx, outline), build);
      scoreSegments(ctx, traceFor(ctx, outline), build, ROOT, TIP, 6, 0.1);

      cutAndWash(ctx, {
        kind: 'torn',
        centre: ROOT,
        radius: 0.072,
        squash: 0.78,
        angle: deg(-16),
        bones: [],
        runAngle: deg(-178),
        seed: abdomenWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, ROOT, deg(-178), abdomenSeed, 0.13);
    },
  };

  const wingSeed = nextSeed();
  const wingWoundSeed = nextSeed();
  const wingCase: MantidGorePiece = {
    state: 'gore_wing_case',
    paint: (ctx, build) => {
      const ROOT: Pt = { x: -0.17, y: 0.08 };
      const LEN = 0.36;
      const STEPS = 16;
      const angle = deg(-18);
      const outline: Pt[] = [];
      const edge = (t: number): number => Math.sin(clamp01(t * 1.12) * Math.PI * 0.6) * 0.08;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        outline.push({
          x: ROOT.x + Math.cos(angle) * LEN * t - Math.sin(angle) * edge(t) * 0.3,
          y: ROOT.y + Math.sin(angle) * LEN * t + Math.cos(angle) * edge(t) * 0.3,
        });
      }
      for (let i = STEPS; i >= 0; i--) {
        const t = i / STEPS;
        // A torn wing has to break its own silhouette or it reads as a leaf.
        const notch = Math.max(0, hash1(wingSeed + i) - 0.45) * 0.16;
        outline.push({
          x: ROOT.x + Math.cos(angle) * LEN * t + Math.sin(angle) * (edge(t) - notch),
          y: ROOT.y + Math.sin(angle) * LEN * t - Math.cos(angle) * (edge(t) - notch),
        });
      }
      paintChitinMass(ctx, traceFor(ctx, outline), build);

      ctx.save();
      traceFor(ctx, outline)(0);
      ctx.clip();
      const VEINS = 4;
      for (let v = 0; v < VEINS; v++) {
        const offset = lerp(-0.035, 0.045, v / (VEINS - 1));
        ctx.beginPath();
        ctx.moveTo(ROOT.x - Math.sin(angle) * offset, ROOT.y + Math.cos(angle) * offset);
        ctx.lineTo(
          ROOT.x + Math.cos(angle) * LEN - Math.sin(angle) * offset * 0.4,
          ROOT.y + Math.sin(angle) * LEN + Math.cos(angle) * offset * 0.4,
        );
        ctx.strokeStyle = rgba(build.palette.ink, v === 1 ? 0.45 : 0.22);
        ctx.lineWidth = v === 1 ? 0.009 : 0.005;
        ctx.stroke();
      }
      ctx.restore();

      cutAndWash(ctx, {
        kind: 'torn',
        centre: ROOT,
        radius: 0.036,
        squash: 0.7,
        angle: deg(72),
        bones: [],
        runAngle: deg(160),
        seed: wingWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, ROOT, deg(160), wingSeed, 0.08);
    },
  };

  const legSeed = nextSeed();
  const legWoundSeed = nextSeed();
  const walkingLeg: MantidGorePiece = {
    state: 'gore_leg',
    paint: (ctx, build) => {
      const HIP: Pt = { x: -0.14, y: 0.14 };
      const KNEE: Pt = { x: 0.05, y: -0.17 };
      const FOOT: Pt = { x: 0.16, y: 0.14 };
      const femur = segmentOutline(HIP, KNEE, 0.019, 0.014, 0.01);
      const tibia = segmentOutline(KNEE, FOOT, 0.014, 0.008, -0.008);
      paintChitinMass(ctx, traceFor(ctx, femur), build);
      paintChitinMass(ctx, traceFor(ctx, tibia), build);

      // The tarsus, still hooked. A bare stick would be a twig.
      ctx.beginPath();
      ctx.moveTo(FOOT.x, FOOT.y);
      ctx.quadraticCurveTo(FOOT.x + 0.04, FOOT.y + 0.03, FOOT.x + 0.03, FOOT.y + 0.07);
      ctx.strokeStyle = rgba(build.palette.ink, 0.9);
      ctx.lineWidth = 0.011;
      ctx.lineCap = 'round';
      ctx.stroke();

      cutAndWash(ctx, {
        kind: 'clean',
        centre: HIP,
        radius: 0.024,
        squash: 0.9,
        angle: deg(-58),
        bones: [{ at: { x: 0, y: 0 }, size: 0.5, hollow: true }],
        runAngle: deg(140),
        seed: legWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, HIP, deg(140), legSeed, 0.09);
    },
  };

  const gutSeed = nextSeed();
  const gut: MantidGorePiece = {
    state: 'gore_entrails',
    paint: (ctx) => {
      // A folded length of gut: one tapering tube doubled back on itself.
      //
      // Two earlier attempts got this wrong in the same way — they made a shape
      // with a centre. A stroked Archimedean coil is radially symmetric, which
      // is the visual grammar of a *pickup*, and in play it read as an item
      // lying on the ground. A rosette of lobes fixed the symmetry but still
      // resolved to a tidy cluster with a polygon of creases through it.
      //
      // A tube has no centre to find. It is built as a filled outline rather
      // than a stroke so it can *taper*: a constant-width stroke is a hose, and
      // the taper at the torn ends is most of what says this came out of
      // something. Segmented across its length, so it is gut and not a worm.
      const STEPS = 44;
      /** Half-width at the fattest point. The piece is small on purpose. */
      const FAT_HALF_WIDTH = 0.052;
      /** Share of the fat width the torn ends keep, so they read as cut, not pointed. */
      const END_WIDTH_SHARE = 0.3;
      const SEGMENT_COUNT = 7;
      const OUTLINE_WIDTH = 0.02;

      /**
       * The fold, as three control points and a hand-placed bend. Asymmetric by
       * construction: the two arms are different lengths and neither is level.
       */
      const A = { x: -0.115, y: 0.052 };
      const BEND_ONE = { x: -0.05, y: -0.12 };
      const MID = { x: 0.035, y: -0.028 };
      const BEND_TWO = { x: 0.135, y: 0.03 };
      const B = { x: 0.02, y: 0.098 };

      const quad = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => {
        const u = 1 - t;
        return {
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
          y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        };
      };
      const centreAt = (t: number): Pt =>
        t < 0.5 ? quad(A, BEND_ONE, MID, t * 2) : quad(MID, BEND_TWO, B, (t - 0.5) * 2);

      // Fattest a little past the middle rather than exactly at it — a profile
      // symmetric about its own midpoint reintroduces the tidiness the shape is
      // trying to escape.
      const halfWidthAt = (t: number): number => {
        const belly = Math.sin(Math.PI * Math.pow(t, 0.82));
        const wobble = 1 + (hash1(gutSeed + Math.floor(t * 11)) - 0.5) * 0.22;
        return FAT_HALF_WIDTH * lerp(END_WIDTH_SHARE, 1, belly) * wobble;
      };

      const centres: Pt[] = [];
      for (let i = 0; i <= STEPS; i++) centres.push(centreAt(i / STEPS));

      const normalAt = (i: number): Pt => {
        const prev = centres[Math.max(0, i - 1)];
        const next = centres[Math.min(STEPS, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return { x: 0, y: 1 };
        return { x: -dy / length, y: dx / length };
      };

      const outline: Pt[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const n = normalAt(i);
        const w = halfWidthAt(i / STEPS);
        outline.push({ x: centres[i].x + n.x * w, y: centres[i].y + n.y * w });
      }
      for (let i = STEPS; i >= 0; i--) {
        const n = normalAt(i);
        const w = halfWidthAt(i / STEPS);
        outline.push({ x: centres[i].x - n.x * w, y: centres[i].y - n.y * w });
      }

      const trace = traceFor(ctx, outline);

      trace(0);
      ctx.fillStyle = VISCERA_MID;
      ctx.fill();
      trace(0);
      ctx.strokeStyle = '#221f10';
      ctx.lineWidth = OUTLINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Everything below is clipped to the tube, so a crease or a highlight can
      // never escape the silhouette and read as a stray mark.
      ctx.save();
      trace(0);
      ctx.clip();

      // Segmentation: short bands across the tube, spaced unevenly.
      ctx.lineCap = 'round';
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const t = (i + 0.5) / SEGMENT_COUNT + (hash1(gutSeed + 60 + i) - 0.5) * 0.05;
        const index = Math.round(Math.min(1, Math.max(0, t)) * STEPS);
        const c = centres[index];
        const n = normalAt(index);
        const w = halfWidthAt(index / STEPS) * 1.2;
        ctx.beginPath();
        ctx.moveTo(c.x + n.x * w, c.y + n.y * w);
        ctx.lineTo(c.x - n.x * w, c.y - n.y * w);
        ctx.strokeStyle = rgba(VISCERA_DARK, 0.5);
        ctx.lineWidth = OUTLINE_WIDTH * 0.7;
        ctx.stroke();
      }

      // A wet run of light down one side of the tube. Offset to a single side of
      // the centre line rather than following it, so the tube reads as round.
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) {
        const n = normalAt(i);
        const w = halfWidthAt(i / STEPS) * 0.42;
        const x = centres[i].x + n.x * w;
        const y = centres[i].y + n.y * w;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(VISCERA_LIGHT, 0.45);
      ctx.lineWidth = FAT_HALF_WIDTH * 0.5;
      ctx.stroke();

      // Shading along the opposite side, which is what stops it reading flat.
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) {
        const n = normalAt(i);
        const w = halfWidthAt(i / STEPS) * 0.72;
        const x = centres[i].x - n.x * w;
        const y = centres[i].y - n.y * w;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(VISCERA_DARK, 0.45);
      ctx.lineWidth = FAT_HALF_WIDTH * 0.55;
      ctx.stroke();

      ctx.restore();

      // The torn ends get the wet dark of an opening rather than a flat cap.
      for (const end of [{ p: centres[0], t: 0 }, { p: centres[STEPS], t: 1 }]) {
        ctx.beginPath();
        ctx.arc(end.p.x, end.p.y, halfWidthAt(end.t) * 0.72, 0, TWO_PI);
        ctx.fillStyle = rgba(VISCERA_DARK, 0.8);
        ctx.fill();
      }

      paintHemolymph(ctx, B, deg(75), gutSeed, 0.085);
    },
  };

  const plateSeed = nextSeed();
  const plateWoundSeed = nextSeed();
  const plate: MantidGorePiece = {
    state: 'gore_carapace',
    paint: (ctx, build) => {
      // A shard of thoracic plate, snapped along a jagged edge with the soft
      // tissue that was behind it still clinging to the inside.
      const OUTER: Pt[] = [];
      const ARC_STEPS = 12;
      const R_OUT = 0.17;
      const R_IN = 0.09;
      for (let i = 0; i <= ARC_STEPS; i++) {
        const a = lerp(deg(-140), deg(20), i / ARC_STEPS);
        OUTER.push({ x: Math.cos(a) * R_OUT, y: Math.sin(a) * R_OUT * 0.85 });
      }
      for (let i = ARC_STEPS; i >= 0; i--) {
        const a = lerp(deg(-140), deg(20), i / ARC_STEPS);
        const jag = 1 + (hash1(plateSeed + i) - 0.5) * 0.5;
        OUTER.push({ x: Math.cos(a) * R_IN * jag, y: Math.sin(a) * R_IN * 0.85 * jag });
      }
      const trace = traceFor(ctx, OUTER);

      ctx.save();
      trace(0);
      ctx.clip();
      paintVisceraMass(ctx, (grow) => appendLoop(ctx, grownOutline(OUTER, grow)));
      ctx.restore();
      paintChitinMass(ctx, trace, build);

      ctx.save();
      trace(0);
      ctx.clip();
      ctx.fillStyle = rgba(MUSCLE_MID, 0.55);
      ctx.beginPath();
      ctx.ellipse(0, R_OUT * 0.35, R_OUT * 0.8, R_OUT * 0.25, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = rgba(MUSCLE_DARK, 0.5);
      ctx.beginPath();
      ctx.ellipse(-R_OUT * 0.2, R_OUT * 0.42, R_OUT * 0.35, R_OUT * 0.14, 0, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = rgba(MUSCLE_LIGHT, 0.35);
      ctx.lineWidth = 0.006;
      ctx.stroke();
      ctx.restore();

      cutAndWash(ctx, {
        kind: 'crushed',
        centre: { x: R_OUT * 0.55, y: R_OUT * 0.12 },
        radius: 0.038,
        squash: 0.75,
        angle: deg(30),
        bones: [],
        runAngle: deg(24),
        seed: plateWoundSeed,
        hide: build.palette.dark,
      });
      paintHemolymph(ctx, { x: R_OUT * 0.6, y: R_OUT * 0.14 }, deg(24), plateSeed, 0.1);
    },
  };

  return [raptorialArm, head, pronotum, abdomen, wingCase, walkingLeg, gut, plate];
}
