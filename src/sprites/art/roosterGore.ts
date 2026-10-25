/**
 * The pieces a rooster comes apart into: the head with its comb, one of the
 * feathered human arms, a leg with its spur, the tail fan, and a scatter of
 * loose feathers.
 *
 * Each piece is painted by the living figure's own part painters, so a severed
 * arm is the same arm, and finished with the shared wound engine
 * (`goreWound.ts`) at its cut. The pieces are chosen for silhouette: a head
 * standing on its comb, a long arm with a fist, a zig-zag leg ending in toes, a
 * bunch of sickles with their tips fanned apart and a scatter of separate
 * feathers cannot be mistaken for each other tumbling past at the tile.
 *
 * Every piece is drawn in rig units about the centre of its own cell and
 * outlined as one silhouette, the same way the living figure is.
 */

import { deg, rgba } from './bipedArt';
import {
  blitLayer,
  dilationOffsets,
  inFigureSpace,
  layerBounds,
  makeLayer,
  outlineInto,
  scratchPx,
  withComposeLayers,
} from './figureCompose';
import { drawWound } from './goreWound';
import {
  ROOSTER_BUILD_SPECS,
  type Ramp,
  type RoosterBuild,
  type RoosterBuildSpec,
} from './rooster/builds';
import { drawHead } from './rooster/head';
import { drawArm, drawLeg, upperArmBack } from './rooster/limbs';
import { type Ctx, appendQuill } from './rooster/paint';
import {
  type BoneChain,
  type LegChain,
  type Pt,
  type RoosterSkeleton,
  buildRoosterSkeleton,
  cellPxPerRigUnit,
  pt,
  restingPose,
} from './rooster/rig';

export interface RoosterGorePiece {
  readonly state: string;
  readonly paint: (ctx: Ctx) => void;
}

const OUTLINE_PX = 1;
const OUTLINE_SAMPLES = 8;
const OUTLINE_ALPHA = 0.92;
/** How far past its own sketch a piece's ink can reach, in rig units. */
const PIECE_MARGIN = 0.3;
/** A severed piece's own size against the big build's, before the build's scale. */
const PIECE_EXTENT = 0.9;

/**
 * Paints `body` on a composing surface and rings it with the build's outline,
 * as the living figure is: a piece outlined part by part reads as stickers.
 */
function outlined(
  ctx: Ctx,
  build: RoosterBuildSpec,
  cellPxPerUnit: number,
  body: (layer: Ctx) => void,
): void {
  withComposeLayers(() => {
    const bounds = layerBounds(ctx, [
      {
        points: [pt(-PIECE_EXTENT, -PIECE_EXTENT), pt(PIECE_EXTENT, PIECE_EXTENT)],
        margin: PIECE_MARGIN,
      },
    ]);
    const layer = makeLayer(bounds);
    const out = makeLayer(bounds);
    const scratch = makeLayer(bounds);
    inFigureSpace(layer, bounds, body);
    outlineInto(
      out,
      layer,
      scratch,
      dilationOffsets(scratchPx(bounds, OUTLINE_PX, cellPxPerUnit), OUTLINE_SAMPLES),
      build.palette.outline,
      rgba(build.palette.outline, OUTLINE_ALPHA),
      false,
    );
    blitLayer(ctx, out, bounds);
  });
}

function restSkeleton(build: RoosterBuildSpec): RoosterSkeleton {
  return buildRoosterSkeleton(restingPose('side'), 'side', build);
}

/** Where a piece was cut, how big the cut is, which way its face turns and which way blood runs. */
interface StumpSpec {
  readonly centre: Pt;
  readonly radius: number;
  readonly angle: number;
  readonly runAngle: number;
  readonly seed: number;
}

/** A torn cut seen at an angle, with one bone in it. */
const STUMP_SQUASH = 0.55;
const STUMP_BONE_SIZE = 0.4;

/** The cut at a stump: the shared wound engine, ringed in this bird's own darkest feather. */
function stump(ctx: Ctx, spec: StumpSpec, build: RoosterBuildSpec): void {
  drawWound(ctx, {
    kind: 'torn',
    centre: spec.centre,
    radius: spec.radius,
    squash: STUMP_SQUASH,
    angle: spec.angle,
    bones: [{ at: pt(0, 0), size: STUMP_BONE_SIZE }],
    runAngle: spec.runAngle,
    seed: spec.seed,
    hide: build.palette.back.deep,
  });
}

/** The head stands tipped back on its stump, eye shut, beak agape. */
const HEAD_PIECE_CENTRE = pt(0, 0.05);
const HEAD_PIECE_TILT = deg(-24);
const HEAD_PIECE_BEAK_OPEN = 0.4;
const HEAD_PIECE_WATTLE_LAG = 0.5;
/**
 * The head is cut off with a ruff of its neck hackles, hanging from under the
 * skull to the stump: the head alone is a round blob, which at a minion's size
 * is the same shape as any other piece balled up.
 */
const HEAD_RUFF_STRANDS = 5;
const HEAD_RUFF_MIDDLE = 0.5;
const HEAD_RUFF_TOP = 0.08;
const HEAD_RUFF_SPAN = 0.16;
const HEAD_RUFF_LENGTH = 0.3;
const HEAD_RUFF_SPLAY = 0.06;
const HEAD_RUFF_HALF = 0.045;
const HEAD_RUFF_STEPS = 6;
const HEAD_STUMP: StumpSpec = {
  centre: pt(-0.04, 0.36),
  radius: 0.08,
  angle: deg(90),
  runAngle: deg(100),
  seed: 811,
};
/** The arm lies bent at the elbow, fist closed, cut at the shoulder. */
const ARM_PIECE: BoneChain = { root: pt(-0.55, -0.15), joint: pt(0, 0.12), end: pt(0.44, -0.1) };
const ARM_PIECE_SEED = 907;
const ARM_STUMP: StumpSpec = {
  centre: pt(-0.58, -0.22),
  radius: 0.14,
  angle: deg(60),
  runAngle: deg(200),
  seed: 823,
};
/** The leg folds at its ankle, toes half curled, cut at the top of the thigh. */
const LEG_PIECE: LegChain = {
  root: pt(-0.2, -0.55),
  hock: pt(-0.36, -0.05),
  ankle: pt(0.08, 0.28),
  pad: pt(0.08, 0.35),
  curl: 0.15,
  ahead: 0,
  planted: false,
};
const LEG_PIECE_SEED = 919;
const LEG_STUMP: StumpSpec = {
  centre: pt(-0.2, -0.62),
  radius: 0.14,
  angle: deg(10),
  runAngle: deg(-90),
  seed: 829,
};
/**
 * The tail cut loose: a few long sickle feathers lying spread from the cut,
 * each with its vane and shaft like the loose feathers'. Laid as the standing
 * fountain's filled arch it reads as a wing, a leaf or a cap; as thin green
 * strands, as a pulled-up plant; with copper feathers at the cut, as a foot.
 */
interface GoreSickle {
  /** The far tip, in tail lengths from the cut. */
  readonly tip: Pt;
  readonly half: number;
  readonly bend: number;
}
const TAIL_PIECE_ROOT = pt(0.42, 0.28);
const GORE_SICKLES: readonly GoreSickle[] = [
  { tip: pt(-1.0, -0.2), half: 0.075, bend: 0.3 },
  { tip: pt(-1.05, 0.16), half: 0.075, bend: 0.26 },
  { tip: pt(-0.85, 0.46), half: 0.07, bend: 0.22 },
  { tip: pt(-0.7, -0.5), half: 0.065, bend: 0.28 },
];
/**
 * A cockerel's short tail, cut off, is a round nub the size of his head and
 * the two pieces tumble as one shape; the piece keeps its sickles at least this long.
 */
const TAIL_PIECE_MIN_LENGTH = 1.3;
const TAIL_STUMP: StumpSpec = {
  centre: pt(0.42, 0.3),
  radius: 0.1,
  angle: deg(80),
  runAngle: deg(10),
  seed: 839,
};
const FEATHER_STEPS = 10;
const FEATHER_SHEEN_WIDTH = 0.4;
const FEATHER_SHAFT_WIDTH = 0.014;

interface LooseFeather {
  /** Where the bare quill ends, and the vane's far tip. */
  readonly root: Pt;
  readonly tip: Pt;
  /** The vane's widest half-width. */
  readonly half: number;
  /** Sideways bow of the shaft at its middle, as a share of its length. */
  readonly bend: number;
}

/**
 * A scatter of loose hackle feathers lying apart from each other. Each is long
 * and narrow with a bare quill, a split in its vane, its shaft drawn down the
 * middle and a puff of down at its base: broad and short they read as leaves,
 * and fanned from one point the set reads as a claw or a sprig.
 */
const LOOSE_FEATHERS: readonly LooseFeather[] = [
  { root: pt(-0.62, 0.36), tip: pt(0.06, 0.1), half: 0.065, bend: 0.1 },
  { root: pt(0.0, 0.44), tip: pt(0.64, 0.3), half: 0.06, bend: -0.12 },
  { root: pt(-0.56, -0.12), tip: pt(-0.12, -0.62), half: 0.065, bend: 0.14 },
  { root: pt(0.12, -0.08), tip: pt(0.6, -0.44), half: 0.06, bend: -0.1 },
];
/** The down at a feather's base: a few short soft wisps splayed back off the shaft. */
const DOWN_WISPS = 4;
const DOWN_LENGTH = 0.09;
const DOWN_HALF = 0.022;
const DOWN_SPLAY = deg(55);
const DOWN_ALPHA = 0.85;
/** The bare quill below the vane, as a share of the feather's length. */
const QUILL_SHARE = 0.2;
const MIDPOINT_SHARE = 0.5;
/** One side of a vane is broader than the other, as a real feather's is. */
const VANE_NARROW_SIDE = 0.65;
/** A gap where the barbs have parted, on the broad side, this far along the vane. */
const VANE_SPLIT_AT = 0.55;
const VANE_SPLIT_DEPTH = 0.7;
const VANE_SAMPLES = 10;

/** A point on the feather's shaft, `t` from 0 at the quill's end to 1 at the tip. */
function shaftAt(feather: LooseFeather, t: number): Pt {
  const dx = feather.tip.x - feather.root.x;
  const dy = feather.tip.y - feather.root.y;
  const bow = Math.sin(Math.PI * t) * feather.bend;
  return pt(feather.root.x + dx * t - dy * bow, feather.root.y + dy * t + dx * bow);
}

/** The vane's outline: broad side out from quill to tip, narrow side back. */
function appendVane(ctx: Ctx, feather: LooseFeather, widthShare: number): void {
  const dx = feather.tip.x - feather.root.x;
  const dy = feather.tip.y - feather.root.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = pt(-dy / length, dx / length);
  const side = (sign: number, share: number): Pt[] =>
    Array.from({ length: VANE_SAMPLES + 1 }, (_unused, k) => {
      const along = k / VANE_SAMPLES;
      const t = QUILL_SHARE + (1 - QUILL_SHARE) * along;
      const split = sign > 0 && Math.abs(along - VANE_SPLIT_AT) < 1 / VANE_SAMPLES / 2;
      const width =
        feather.half * widthShare * share * Math.sin(Math.PI * along) ** QUILL_SHARE_EXPONENT;
      const at = shaftAt(feather, t);
      const reach = split ? width * (1 - VANE_SPLIT_DEPTH) : width;
      return pt(at.x + normal.x * reach * sign, at.y + normal.y * reach * sign);
    });
  ctx.beginPath();
  const broad = side(1, 1);
  const narrow = side(-1, VANE_NARROW_SIDE).reverse();
  const outline = [...broad, ...narrow];
  ctx.moveTo(outline[0].x, outline[0].y);
  for (const p of outline.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}
function drawDown(ctx: Ctx, feather: LooseFeather, colour: string): void {
  const base = shaftAt(feather, QUILL_SHARE);
  const back = Math.atan2(feather.root.y - feather.tip.y, feather.root.x - feather.tip.x);
  for (let w = 0; w < DOWN_WISPS; w++) {
    const spread = (w / (DOWN_WISPS - 1)) * 2 - 1;
    const heading = back + spread * DOWN_SPLAY;
    const tip = pt(
      base.x + Math.cos(heading) * DOWN_LENGTH,
      base.y + Math.sin(heading) * DOWN_LENGTH,
    );
    const mid = pt((base.x + tip.x) * MIDPOINT_SHARE, (base.y + tip.y) * MIDPOINT_SHARE);
    ctx.beginPath();
    appendQuill(ctx, base, mid, tip, DOWN_HALF, FEATHER_STEPS);
    ctx.fillStyle = rgba(colour, DOWN_ALPHA);
    ctx.fill();
  }
}

/** One loose feather: its vane, the sheen down it, the down at its base and its shaft. */
function paintLooseFeather(ctx: Ctx, feather: LooseFeather, ramp: Ramp): void {
  appendVane(ctx, feather, 1);
  ctx.fillStyle = ramp.mid;
  ctx.fill();
  appendVane(ctx, feather, FEATHER_SHEEN_WIDTH);
  ctx.fillStyle = ramp.light;
  ctx.fill();
  drawDown(ctx, feather, ramp.rim);
  ctx.beginPath();
  const shaftStart = shaftAt(feather, 0);
  ctx.moveTo(shaftStart.x, shaftStart.y);
  for (let k = 1; k <= FEATHER_STEPS; k++) {
    const p = shaftAt(feather, k / FEATHER_STEPS);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = ramp.deep;
  ctx.lineWidth = FEATHER_SHAFT_WIDTH;
  ctx.stroke();
}

/** How full the vane is toward its ends: under 1 keeps it broad most of its length. */
const QUILL_SHARE_EXPONENT = 0.6;

/** The five pieces, at the build's own palette and proportions. */
export function roosterGorePieces(buildName: RoosterBuild): readonly RoosterGorePiece[] {
  const build = ROOSTER_BUILD_SPECS[buildName];
  const cellUnit = cellPxPerRigUnit(build);
  const rest = restSkeleton(build);

  const head: RoosterGorePiece = {
    state: 'gore_head',
    paint: (ctx) =>
      outlined(ctx, build, cellUnit, (layer) => {
        const skeleton: RoosterSkeleton = {
          ...rest,
          headCentre: HEAD_PIECE_CENTRE,
          headPitch: 0,
          headRoll: 0,
        };
        layer.save();
        layer.rotate(HEAD_PIECE_TILT);
        for (let i = 0; i < HEAD_RUFF_STRANDS; i++) {
          const across = i / (HEAD_RUFF_STRANDS - 1) - HEAD_RUFF_MIDDLE;
          const root = pt(across * HEAD_RUFF_SPAN, HEAD_RUFF_TOP);
          const tip = pt(root.x + across * HEAD_RUFF_SPLAY, HEAD_RUFF_TOP + HEAD_RUFF_LENGTH);
          layer.beginPath();
          appendQuill(
            layer,
            root,
            pt((root.x + tip.x) * HEAD_RUFF_MIDDLE, (root.y + tip.y) * HEAD_RUFF_MIDDLE),
            tip,
            HEAD_RUFF_HALF,
            HEAD_RUFF_STEPS,
          );
          layer.fillStyle = i % 2 === 0 ? build.palette.hackle.mid : build.palette.hackle.dark;
          layer.fill();
        }
        drawHead(layer, {
          skeleton,
          pose: {
            ...restingPose('side'),
            blink: 1,
            beakOpen: HEAD_PIECE_BEAK_OPEN,
            wattleLag: HEAD_PIECE_WATTLE_LAG,
          },
          build,
        });
        stump(layer, HEAD_STUMP, build);
        layer.restore();
      }),
  };

  const arm: RoosterGorePiece = {
    state: 'gore_arm',
    paint: (ctx) =>
      outlined(ctx, build, cellUnit, (layer) => {
        drawArm(
          layer,
          {
            chain: ARM_PIECE,
            backNormal: upperArmBack(ARM_PIECE, pt(0, 1)),
            fist: 1,
            shade: 0,
            facesAway: false,
          },
          build,
          ARM_PIECE_SEED,
        );
        stump(layer, ARM_STUMP, build);
      }),
  };

  const leg: RoosterGorePiece = {
    state: 'gore_leg',
    paint: (ctx) =>
      outlined(ctx, build, cellUnit, (layer) => {
        drawLeg(layer, LEG_PIECE, 'forward', build, 0, LEG_PIECE_SEED);
        stump(layer, LEG_STUMP, build);
      }),
  };

  const tail: RoosterGorePiece = {
    state: 'gore_tail',
    paint: (ctx) =>
      outlined(ctx, build, cellUnit, (layer) => {
        const length = Math.max(build.proportions.tailLength, TAIL_PIECE_MIN_LENGTH);
        const lay = (feathers: readonly GoreSickle[], ramp: Ramp): void => {
          for (const sickle of feathers) {
            const feather: LooseFeather = {
              root: TAIL_PIECE_ROOT,
              tip: pt(
                TAIL_PIECE_ROOT.x + sickle.tip.x * length,
                TAIL_PIECE_ROOT.y + sickle.tip.y * length,
              ),
              half: sickle.half,
              bend: sickle.bend,
            };
            paintLooseFeather(layer, feather, ramp);
          }
        };
        const { tail } = build.palette;
        // A step darker than the standing fountain's own ramp: black feathers
        // with the green only in their sheen. Green to the edge, a cut tail
        // lying on the floor reads as a sprig of leaves.
        const blackSickle: Ramp = {
          deep: tail.deep,
          dark: tail.deep,
          mid: tail.dark,
          light: tail.mid,
          // The rim is the down at each quill's base: in the sheen's green it
          // reads as buds on a stem.
          rim: tail.dark,
        };
        lay(GORE_SICKLES, blackSickle);
        stump(layer, TAIL_STUMP, build);
      }),
  };

  const feathers: RoosterGorePiece = {
    state: 'gore_feathers',
    paint: (ctx) =>
      outlined(ctx, build, cellUnit, (layer) => {
        LOOSE_FEATHERS.forEach((feather, i) => {
          paintLooseFeather(layer, feather, i % 2 === 0 ? build.palette.hackle : build.palette.arm);
        });
      }),
  };

  return [head, arm, leg, tail, feathers];
}
