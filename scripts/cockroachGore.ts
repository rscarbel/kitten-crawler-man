/**
 * The eight pieces a cockroach comes apart into.
 *
 * The cut face itself is not here — `scripts/goreWound.ts` owns that, and every
 * wound below routes through it so a dismembered roach's injuries are
 * recognisably the same ones a dismembered rat has. What is here is the shape of
 * each piece and the shell on it.
 *
 * The pieces are chosen for **silhouette**, not for anatomy. What has to be true
 * is that eight cells tumbling past at sixteen screen pixels do not read as
 * eight identical brown flecks, so the set is spread across: a small capsule
 * trailing two long whips (the head — nothing else in the bestiary drops a shape
 * with two filaments on it), a broad shallow fan carrying the species' own dark
 * mark (the shield), a long straight leaf with veins down it (one tegmen), a
 * fat banded oval (the abdomen), a thin bent Z of a limb, a wide V of two limbs
 * still joined at a torn coxa, a squat chunk with a coil of gut hanging out of
 * it (the thorax), and a blunt wedge ending in two prongs (the rear tip).
 *
 * Every random value is drawn **at construction**, never inside `paint`: the
 * bake measures each piece before it paints it for real, so a piece that rolls
 * its own noise while painting comes out a different shape each pass and the
 * measured cell no longer fits the art in it.
 *
 * All drawing is in tile units with the origin at the centre of the piece's own
 * cell.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import {
  ABDOMEN_BASE,
  ABDOMEN_DARK,
  ABDOMEN_LIGHT,
  CHESTNUT_BASE,
  CHESTNUT_DARK,
  CHESTNUT_LIGHT,
  INK,
  LEG_BUILDS,
  OCELLUS,
  PRONOTUM_MARGIN,
  PRONOTUM_MARK,
  TEGMEN_BASE,
  TEGMEN_DARK,
  TEGMEN_LIGHT,
  TWO_PI,
  along,
  deg,
  drawSpineRow,
  easeInOut,
  filamentOutline,
  hash1,
  hump,
  lerp,
  mix,
  ovalOutline,
  pronotumOutline,
  ramp,
  rgba,
  segmentOutline,
  traceOutline,
  type Pt,
} from './cockroachArt';
import { appendGoreLoop, drawWound, grownOutline, paintGoreMass } from './goreWound';

// ── Tones, as seen on a severed piece ────────────────────────────────────────

/**
 * Darker than the tones the living animal is painted in. A piece is lit only
 * ambiently — it is spinning, so no directional key is valid — and shell painted
 * at its standing brightness comes out reading as a pale wood chip.
 */
const SHELL_TONE = {
  mid: mix(CHESTNUT_BASE, CHESTNUT_DARK, 0.2),
  dark: CHESTNUT_DARK,
  light: CHESTNUT_LIGHT,
} as const;
const WING_TONE = {
  mid: mix(TEGMEN_BASE, TEGMEN_DARK, 0.2),
  dark: TEGMEN_DARK,
  light: TEGMEN_LIGHT,
} as const;
const BELLY_TONE = {
  mid: mix(ABDOMEN_BASE, ABDOMEN_DARK, 0.15),
  dark: ABDOMEN_DARK,
  light: ABDOMEN_LIGHT,
} as const;
const MARGIN_PIECE_TONE = {
  mid: PRONOTUM_MARGIN,
  dark: mix(PRONOTUM_MARGIN, CHESTNUT_DARK, 0.6),
  light: mix(PRONOTUM_MARGIN, '#ffffff', 0.3),
} as const;
/**
 * The gut coil hanging out of the torn thorax.
 *
 * Insect haemolymph is really a pale greenish cream, and that is what this was.
 * It measured as a quarter of the thorax piece in a hue that appears nowhere
 * else on the animal, and a blind reviewer called the piece a mushroom with eggs
 * under it. Held to the creature's own warm browns it reads as viscera.
 */
const HAEMOLYMPH_TONE = {
  mid: '#8a6338',
  dark: '#3e2a17',
  light: '#bb8b52',
} as const;

export interface CockroachGorePiece {
  /** Manifest state name; the runtime spawns these in exactly this order. */
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

function tracer(ctx: Ctx, outline: readonly Pt[]): (grow: number) => void {
  return (grow: number) => {
    traceOutline(ctx, grow === 0 ? outline : grownOutline(outline, grow));
  };
}

/**
 * A warm light stroke laid down before the piece's own fill, so only its outer
 * band survives. The same measurement that forced one onto the living animal
 * applies here: the darkest pieces baked with a median edge luminance *below*
 * the dungeon floor's, and a piece with no edge is a piece nobody can name.
 */
const PIECE_HALO_TONE = '#d59457';
const PIECE_HALO_ALPHA = 0.5;
const PIECE_HALO_WIDTH = 0.02;

function paintPiece(
  ctx: Ctx,
  outline: readonly Pt[],
  tone: { readonly mid: string; readonly dark: string; readonly light: string },
): void {
  traceOutline(ctx, outline);
  ctx.strokeStyle = rgba(PIECE_HALO_TONE, PIECE_HALO_ALPHA);
  ctx.lineWidth = PIECE_HALO_WIDTH;
  ctx.stroke();
  paintGoreMass(ctx, tracer(ctx, outline), tone, INK);
}

/** Wet shine over a piece of shell, clipped to it. Chitin stays glossy dead. */
const SHEEN_COUNT = 3;
const SHEEN_ALPHA = 0.22;
const SHEEN_RX = 0.05;
const SHEEN_RY = 0.02;

function sheenOver(ctx: Ctx, outline: readonly Pt[], seed: number, spread: number): void {
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.fillStyle = rgba(CHESTNUT_LIGHT, SHEEN_ALPHA);
  for (let i = 0; i < SHEEN_COUNT; i++) {
    const x = (hash1(seed + i * 3.1) - 0.5) * 2 * spread;
    const y = (hash1(seed + i * 5.7 + 19) - 0.5) * 2 * spread;
    ctx.beginPath();
    ctx.ellipse(x, y, SHEEN_RX, SHEEN_RY, hash1(seed + i) * Math.PI, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Shifts a whole outline, so a part built in body space can be re-centred. */
function moved(outline: readonly Pt[], dx: number, dy: number): Pt[] {
  return outline.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// ── Piece geometry ───────────────────────────────────────────────────────────

const HEAD_PIECE_RX = 0.075;
const HEAD_PIECE_RY = 0.06;
/** Torn short of the living animal's reach, and the two are deliberately uneven. */
const HEAD_PIECE_ANTENNA: readonly number[] = [0.17, 0.12];
const HEAD_PIECE_ANTENNA_SAMPLES = 12;
const HEAD_PIECE_ANTENNA_SPLAY = deg(38);
const HEAD_PIECE_ANTENNA_CURVE = deg(70);
const HEAD_PIECE_ANTENNA_HALF_ROOT = 0.014;
const HEAD_PIECE_ANTENNA_HALF_TIP = 0.004;
const HEAD_PIECE_EYE_RX = 0.024;
const HEAD_PIECE_EYE_RY = 0.032;
const HEAD_PIECE_OCELLUS_R = 0.009;

const SHIELD_MARK_INSET = 0.8;
const SHIELD_LOBE_RX = 0.055;
const SHIELD_LOBE_RY = 0.036;
const SHIELD_LOBE_OUT = 0.044;
const SHIELD_LOBE_TILT = deg(22);
const SHIELD_WEDGE_HALF_REAR = 0.005;
const SHIELD_WEDGE_HALF_FRONT = 0.022;
const SHIELD_CRACK_ALPHA = 0.6;
const SHIELD_CRACK_WIDTH = 0.005;

const WING_VEINS = 5;
const WING_VEIN_ALPHA = 0.42;
const WING_VEIN_WIDTH = 0.005;
/** The wing's own cut is smaller than the rest: at the shared radius the piece
 * baked as more blood than wing. */
const WING_WOUND_RADIUS = 0.03;
const WING_STEPS = 22;
const WING_HALF_LENGTH = 0.2;
const WING_HALF_WIDTH = 0.105;
/** How far down the blade its widest point sits; over 1 pushes it toward the root. */
const WING_BELLY_SKEW = 1.35;
const WING_TAPER_FROM = 0.55;
const WING_TIP_NARROWING = 0.78;
/** A tear taken out of the trailing edge, so it is not a clean leaf. */
const WING_TEAR_AT = 0.68;
const WING_TEAR_SPAN = 0.16;
const WING_TEAR_DEPTH = 0.075;

const BELLY_RX = 0.105;
const BELLY_RY = 0.19;
const BELLY_SEGMENTS = 6;
const BELLY_SEGMENT_ALPHA = 0.38;
const BELLY_SEGMENT_WIDTH = 0.006;

const LIMB_PIECE = LEG_BUILDS[2];
/** The joined pair is a front pair: the hind pair made the widest piece in the set. */
const PAIR_LIMB = LEG_BUILDS[0];
const LIMB_SPINE_LENGTH = 0.024;
const LIMB_FEMUR_HALF = 0.026;
const LIMB_TIBIA_HALF = 0.016;
const LIMB_TARSUS_HALF = 0.008;

const PAIR_COXA_R = 0.05;
const PAIR_SPREAD = deg(52);

const THORAX_RX = 0.095;
const THORAX_RY = 0.055;
const THORAX_GUT_LOOPS = 2;
const THORAX_GUT_POINTS = 14;
const THORAX_GUT_R = 0.05;
const THORAX_GUT_BAND = 0.02;
/**
 * Where each gut loop hangs, in tile units from the chunk's own centre. Placed
 * clear of the shell rather than as a share of it: overlapping the chunk the two
 * loops only fattened its outline, and the piece then scored as the same shape
 * as the shield. Hanging off one corner it is a tadpole, which nothing else in
 * the set is.
 */
const THORAX_GUT_CENTRES: readonly Pt[] = [
  { x: 0.072, y: 0.108 },
  { x: 0.128, y: 0.162 },
];
/** The stub of gut still inside the chunk, which is what ties the coil to it. */
const THORAX_GUT_STALK_HALF = 0.019;

const TIP_LENGTH = 0.1;
const TIP_HALF_ROOT = 0.082;
const TIP_HALF_TIP = 0.034;
const TIP_CERCUS_LENGTH = 0.125;
const TIP_CERCUS_HALF_ROOT = 0.018;
const TIP_CERCUS_HALF_TIP = 0.004;
const TIP_CERCUS_SPLAY = deg(64);

/** Radius of every wound face, as a share of the piece it is cut into. */
const WOUND_RADIUS_SMALL = 0.045;
const WOUND_RADIUS_MID = 0.058;
const WOUND_RADIUS_LARGE = 0.07;
/**
 * An insect has no bones — its skeleton is the shell that is already drawn
 * around every one of these pieces — so no wound below carries any.
 */
const NO_BONES = [] as const;

export function cockroachGorePieces(): readonly CockroachGorePiece[] {
  const headOutline = ovalOutline(0, 0, HEAD_PIECE_RX, HEAD_PIECE_RY, 0, 1.3);
  const headAntennae = HEAD_PIECE_ANTENNA.map((length, i) => {
    const side = i === 0 ? 1 : -1;
    const step = length / HEAD_PIECE_ANTENNA_SAMPLES;
    const spine: Pt[] = [{ x: HEAD_PIECE_RX * 0.5 * side, y: -HEAD_PIECE_RY * 0.4 }];
    for (let s = 1; s <= HEAD_PIECE_ANTENNA_SAMPLES; s++) {
      const t = s / HEAD_PIECE_ANTENNA_SAMPLES;
      const angle =
        -Math.PI / 2 + (HEAD_PIECE_ANTENNA_SPLAY + HEAD_PIECE_ANTENNA_CURVE * t * t) * side;
      spine.push(along(spine[spine.length - 1], angle, step));
    }
    return filamentOutline(spine, HEAD_PIECE_ANTENNA_HALF_ROOT, HEAD_PIECE_ANTENNA_HALF_TIP);
  });

  const head: CockroachGorePiece = {
    state: 'gore_head',
    paint: (ctx) => {
      for (const antenna of headAntennae) paintPiece(ctx, antenna, SHELL_TONE);
      paintPiece(ctx, headOutline, SHELL_TONE);
      for (const side of [-1, 1]) {
        paintPiece(
          ctx,
          ovalOutline(
            HEAD_PIECE_RX * 0.52 * side,
            -HEAD_PIECE_RY * 0.1,
            HEAD_PIECE_EYE_RX,
            HEAD_PIECE_EYE_RY,
            deg(14) * side,
            2.2,
            0.01,
          ),
          { mid: '#20120a', dark: '#000000', light: '#7a6a4e' },
        );
        ctx.fillStyle = rgba(OCELLUS, 0.8);
        ctx.beginPath();
        ctx.arc(HEAD_PIECE_RX * 0.22 * side, -HEAD_PIECE_RY * 0.5, HEAD_PIECE_OCELLUS_R, 0, TWO_PI);
        ctx.fill();
      }
      sheenOver(ctx, headOutline, 3.9, HEAD_PIECE_RX);
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0, y: HEAD_PIECE_RY * 0.75 },
        radius: WOUND_RADIUS_SMALL,
        squash: 0.55,
        angle: 0,
        bones: NO_BONES,
        runAngle: Math.PI / 2,
        seed: 811,
        hide: CHESTNUT_DARK,
      });
    },
  };

  const shieldOutline = pronotumOutline();
  const shieldCentre = shieldOutline.reduce(
    (sum, p) => ({ x: sum.x + p.x / shieldOutline.length, y: sum.y + p.y / shieldOutline.length }),
    { x: 0, y: 0 },
  );
  const shield = moved(shieldOutline, -shieldCentre.x, -shieldCentre.y);
  const shieldMark = shield.map((p) => ({
    x: p.x * SHIELD_MARK_INSET,
    y: p.y * SHIELD_MARK_INSET,
  }));

  const pronotum: CockroachGorePiece = {
    state: 'gore_pronotum',
    paint: (ctx) => {
      paintPiece(ctx, shield, MARGIN_PIECE_TONE);
      ctx.save();
      traceOutline(ctx, shieldMark);
      ctx.clip();
      ctx.fillStyle = PRONOTUM_MARK;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          SHIELD_LOBE_OUT * side,
          0,
          SHIELD_LOBE_RX,
          SHIELD_LOBE_RY,
          SHIELD_LOBE_TILT * side,
          0,
          TWO_PI,
        );
        ctx.fill();
      }
      // The pale median wedge, the same one the living shield carries. Without
      // it the piece bakes as a cream dome with a dark smear and a blind
      // reviewer named it a mushroom cap.
      ctx.fillStyle = PRONOTUM_MARGIN;
      ctx.beginPath();
      ctx.moveTo(-SHIELD_WEDGE_HALF_REAR, SHIELD_LOBE_RY * 0.2);
      ctx.lineTo(SHIELD_WEDGE_HALF_REAR, SHIELD_LOBE_RY * 0.2);
      ctx.lineTo(SHIELD_WEDGE_HALF_FRONT, -SHIELD_LOBE_RY * 2.4);
      ctx.lineTo(-SHIELD_WEDGE_HALF_FRONT, -SHIELD_LOBE_RY * 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // A split across the plate, which is both what killed it and the thing
      // that stops this piece reading as an intact beetle seen from above.
      ctx.strokeStyle = rgba(INK, SHIELD_CRACK_ALPHA);
      ctx.lineWidth = SHIELD_CRACK_WIDTH;
      ctx.beginPath();
      ctx.moveTo(-SHIELD_LOBE_OUT * 1.6, -SHIELD_LOBE_RY * 0.9);
      ctx.lineTo(-SHIELD_LOBE_OUT * 0.2, SHIELD_LOBE_RY * 0.2);
      ctx.lineTo(SHIELD_LOBE_OUT * 1.5, SHIELD_LOBE_RY * 1.1);
      ctx.stroke();
      // Cut into the plate's rear corner, not over the mark: the mark is the
      // only reason this piece is nameable, and a wound on top of it leaves a
      // cream dome with a red splat, which reads as a mushroom cap.
      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: -SHIELD_LOBE_OUT * 2.1, y: SHIELD_LOBE_RY * 1.9 },
        radius: WOUND_RADIUS_SMALL,
        squash: 0.7,
        angle: deg(20),
        bones: NO_BONES,
        runAngle: deg(145),
        seed: 1277,
        hide: CHESTNUT_DARK,
      });
    },
  };

  // Built as its own leaf rather than lifted off the living animal: the body's
  // tegmen is drawn against a midline it no longer has, and re-centred on its own
  // it flattens into a plank. A severed wing is a long pointed blade with a bite
  // out of its trailing edge, and the point is what stops it scoring as the
  // abdomen.
  const wing = ((): Pt[] => {
    const leading: Pt[] = [];
    const trailing: Pt[] = [];
    for (let i = 0; i <= WING_STEPS; i++) {
      const t = i / WING_STEPS;
      const y = lerp(-WING_HALF_LENGTH, WING_HALF_LENGTH, t);
      const belly = Math.sin(Math.PI * Math.min(1, t * WING_BELLY_SKEW));
      const taper = 1 - easeInOut(ramp(t, WING_TAPER_FROM, 1)) * WING_TIP_NARROWING;
      const bitten = Math.abs(t - WING_TEAR_AT) < WING_TEAR_SPAN ? WING_TEAR_DEPTH : 0;
      leading.push({ x: -WING_HALF_WIDTH * (0.35 + 0.3 * belly) * taper, y });
      trailing.push({ x: (WING_HALF_WIDTH * (0.5 + 0.5 * belly) - bitten) * taper, y });
    }
    return [...trailing, ...leading.reverse()];
  })();

  const tegmen: CockroachGorePiece = {
    state: 'gore_tegmen',
    paint: (ctx) => {
      paintPiece(ctx, wing, WING_TONE);
      ctx.save();
      traceOutline(ctx, wing);
      ctx.clip();
      ctx.strokeStyle = rgba(TEGMEN_DARK, WING_VEIN_ALPHA);
      ctx.lineWidth = WING_VEIN_WIDTH;
      ctx.lineCap = 'round';
      const top = Math.min(...wing.map((p) => p.y));
      const bottom = Math.max(...wing.map((p) => p.y));
      for (let i = 0; i < WING_VEINS; i++) {
        const across = (i + 0.5) / WING_VEINS;
        ctx.beginPath();
        ctx.moveTo(lerp(-0.05, 0.12, across), top + 0.01);
        ctx.quadraticCurveTo(
          lerp(-0.02, 0.1, across),
          (top + bottom) / 2,
          lerp(-0.03, 0.05, across),
          bottom - 0.01,
        );
        ctx.stroke();
      }
      ctx.restore();
      drawWound(ctx, {
        kind: 'clean',
        centre: { x: -0.02, y: Math.min(...wing.map((p) => p.y)) + 0.03 },
        radius: WING_WOUND_RADIUS,
        squash: 0.5,
        angle: deg(-8),
        bones: NO_BONES,
        runAngle: deg(-95),
        seed: 433,
        hide: TEGMEN_DARK,
      });
    },
  };

  const bellyOutline = ovalOutline(0, 0, BELLY_RX, BELLY_RY, 0, 5.1);

  const abdomen: CockroachGorePiece = {
    state: 'gore_abdomen',
    paint: (ctx) => {
      paintPiece(ctx, bellyOutline, BELLY_TONE);
      ctx.save();
      traceOutline(ctx, bellyOutline);
      ctx.clip();
      ctx.strokeStyle = rgba(ABDOMEN_DARK, BELLY_SEGMENT_ALPHA);
      ctx.lineWidth = BELLY_SEGMENT_WIDTH;
      for (let i = 1; i <= BELLY_SEGMENTS; i++) {
        const y = lerp(-BELLY_RY, BELLY_RY, i / (BELLY_SEGMENTS + 1));
        ctx.beginPath();
        ctx.moveTo(-BELLY_RX, y);
        ctx.quadraticCurveTo(0, y + BELLY_RY * 0.09, BELLY_RX, y);
        ctx.stroke();
      }
      ctx.restore();
      sheenOver(ctx, bellyOutline, 8.3, BELLY_RX * 0.7);
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0, y: -BELLY_RY * 0.72 },
        radius: WOUND_RADIUS_LARGE,
        squash: 0.45,
        angle: 0,
        bones: NO_BONES,
        runAngle: deg(-90),
        seed: 97,
        hide: ABDOMEN_DARK,
      });
    },
  };

  /** One hind limb, folded into the Z a dead insect's leg always sets into. */
  const limbJoints = ((): { hip: Pt; knee: Pt; ankle: Pt; foot: Pt } => {
    const hip: Pt = { x: -LIMB_PIECE.femur * 0.5, y: -LIMB_PIECE.tibia * 0.45 };
    const knee = along(hip, deg(44), LIMB_PIECE.femur);
    const ankle = along(knee, deg(-62), LIMB_PIECE.tibia);
    const foot = along(ankle, deg(52), LIMB_PIECE.tarsus * 1.5);
    return { hip, knee, ankle, foot };
  })();

  const leg: CockroachGorePiece = {
    state: 'gore_leg',
    paint: (ctx) => {
      paintPiece(
        ctx,
        segmentOutline(limbJoints.hip, limbJoints.knee, LIMB_FEMUR_HALF, LIMB_TIBIA_HALF, 0.006),
        SHELL_TONE,
      );
      paintPiece(
        ctx,
        segmentOutline(
          limbJoints.knee,
          limbJoints.ankle,
          LIMB_TIBIA_HALF,
          LIMB_TARSUS_HALF,
          -0.006,
        ),
        SHELL_TONE,
      );
      paintPiece(
        ctx,
        segmentOutline(
          limbJoints.ankle,
          limbJoints.foot,
          LIMB_TARSUS_HALF,
          LIMB_TARSUS_HALF * 0.5,
          0,
        ),
        SHELL_TONE,
      );
      drawSpineRow(ctx, limbJoints.knee, limbJoints.ankle, 6, LIMB_SPINE_LENGTH, -1, 41);
      drawWound(ctx, {
        kind: 'clean',
        centre: limbJoints.hip,
        radius: WOUND_RADIUS_SMALL,
        squash: 0.6,
        angle: deg(38),
        bones: NO_BONES,
        runAngle: deg(-142),
        seed: 613,
        hide: CHESTNUT_DARK,
      });
    },
  };

  /** Two limbs still joined at a torn scrap of coxa: a wide, shallow V. */
  const pairLimbs = [-1, 1].map((side) => {
    const hip: Pt = { x: 0, y: -PAIR_COXA_R * 0.2 };
    const knee = along(hip, Math.PI / 2 - PAIR_SPREAD * side, PAIR_LIMB.femur);
    const ankle = along(knee, Math.PI / 2 - PAIR_SPREAD * side * 2.1, PAIR_LIMB.tibia);
    return { hip, knee, ankle, side };
  });

  const legPair: CockroachGorePiece = {
    state: 'gore_legpair',
    paint: (ctx) => {
      for (const limb of pairLimbs) {
        paintPiece(
          ctx,
          segmentOutline(limb.hip, limb.knee, LIMB_FEMUR_HALF, LIMB_TIBIA_HALF, 0.005 * limb.side),
          SHELL_TONE,
        );
        paintPiece(
          ctx,
          segmentOutline(limb.knee, limb.ankle, LIMB_TIBIA_HALF, LIMB_TARSUS_HALF, 0),
          SHELL_TONE,
        );
        drawSpineRow(ctx, limb.knee, limb.ankle, 5, LIMB_SPINE_LENGTH, limb.side, 57 + limb.side);
      }
      paintPiece(
        ctx,
        ovalOutline(0, -PAIR_COXA_R * 0.4, PAIR_COXA_R, PAIR_COXA_R * 0.72, 0, 6.4),
        SHELL_TONE,
      );
      drawWound(ctx, {
        kind: 'crushed',
        centre: { x: 0, y: -PAIR_COXA_R * 0.5 },
        radius: WOUND_RADIUS_MID,
        squash: 0.62,
        angle: deg(-6),
        bones: NO_BONES,
        runAngle: deg(-90),
        seed: 1499,
        hide: CHESTNUT_DARK,
      });
    },
  };

  const thoraxOutline = ovalOutline(0, -THORAX_RY * 0.2, THORAX_RX, THORAX_RY, 0, 9.7, 0.05);
  /** The gut coil, drawn as two loops in one path so it has a hole through it. */
  const gutLoops = Array.from({ length: THORAX_GUT_LOOPS }, (_unused, loop) => {
    const centre = THORAX_GUT_CENTRES[loop];
    const radius = THORAX_GUT_R * (loop === 0 ? 1 : 0.7);
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let i = 0; i < THORAX_GUT_POINTS; i++) {
      const angle = (i / THORAX_GUT_POINTS) * TWO_PI;
      const wobble = 1 + Math.sin(angle * 3 + loop) * 0.08;
      outer.push({
        x: centre.x + Math.cos(angle) * (radius + THORAX_GUT_BAND) * wobble,
        y: centre.y + Math.sin(angle) * (radius + THORAX_GUT_BAND) * wobble,
      });
      inner.push({
        x: centre.x + Math.cos(angle) * (radius - THORAX_GUT_BAND) * wobble,
        y: centre.y + Math.sin(angle) * (radius - THORAX_GUT_BAND) * wobble,
      });
    }
    return { outer, inner };
  });

  const thorax: CockroachGorePiece = {
    state: 'gore_thorax',
    paint: (ctx) => {
      for (const loop of gutLoops) {
        const trace = (grow: number): void => {
          ctx.beginPath();
          appendGoreLoop(ctx, grow === 0 ? loop.outer : grownOutline(loop.outer, grow));
          appendGoreLoop(ctx, loop.inner);
        };
        paintGoreMass(ctx, trace, HAEMOLYMPH_TONE, INK);
      }
      paintPiece(
        ctx,
        segmentOutline(
          { x: 0, y: 0 },
          THORAX_GUT_CENTRES[0],
          THORAX_GUT_STALK_HALF,
          THORAX_GUT_STALK_HALF,
          0,
        ),
        HAEMOLYMPH_TONE,
      );
      paintPiece(ctx, thoraxOutline, SHELL_TONE);
      sheenOver(ctx, thoraxOutline, 12.1, THORAX_RX * 0.7);
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: THORAX_RX * 0.35, y: THORAX_RY * 0.5 },
        radius: WOUND_RADIUS_MID,
        squash: 0.7,
        angle: deg(38),
        bones: NO_BONES,
        runAngle: deg(60),
        seed: 331,
        hide: CHESTNUT_DARK,
      });
    },
  };

  const tipOutline = segmentOutline(
    { x: 0, y: -TIP_LENGTH / 2 },
    { x: 0, y: TIP_LENGTH / 2 },
    TIP_HALF_ROOT,
    TIP_HALF_TIP,
    0,
  );

  const rearTip: CockroachGorePiece = {
    state: 'gore_cerci',
    paint: (ctx) => {
      for (const side of [-1, 1]) {
        const root: Pt = { x: TIP_HALF_TIP * 0.8 * side, y: TIP_LENGTH * 0.42 };
        const tip = along(root, Math.PI / 2 + TIP_CERCUS_SPLAY * side, TIP_CERCUS_LENGTH);
        paintPiece(
          ctx,
          segmentOutline(root, tip, TIP_CERCUS_HALF_ROOT, TIP_CERCUS_HALF_TIP, 0.004 * side),
          BELLY_TONE,
        );
      }
      paintPiece(ctx, tipOutline, BELLY_TONE);
      ctx.save();
      traceOutline(ctx, tipOutline);
      ctx.clip();
      ctx.strokeStyle = rgba(ABDOMEN_DARK, BELLY_SEGMENT_ALPHA);
      ctx.lineWidth = BELLY_SEGMENT_WIDTH;
      const TIP_SEGMENTS = 3;
      for (let i = 1; i <= TIP_SEGMENTS; i++) {
        const y = lerp(-TIP_LENGTH / 2, TIP_LENGTH / 2, i / (TIP_SEGMENTS + 1));
        ctx.beginPath();
        ctx.moveTo(-TIP_HALF_ROOT, y);
        ctx.quadraticCurveTo(0, y + hump(i / (TIP_SEGMENTS + 1)) * 0.008, TIP_HALF_ROOT, y);
        ctx.stroke();
      }
      ctx.restore();
      drawWound(ctx, {
        kind: 'torn',
        centre: { x: 0, y: -TIP_LENGTH * 0.42 },
        radius: WOUND_RADIUS_MID,
        squash: 0.4,
        angle: 0,
        bones: NO_BONES,
        runAngle: deg(-90),
        seed: 1721,
        hide: ABDOMEN_DARK,
      });
    },
  };

  return [head, pronotum, tegmen, abdomen, leg, legPair, thorax, rearTip];
}
