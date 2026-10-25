/**
 * The rooster painter: one painter for every rooster build.
 *
 * A boss-sized fighting cock standing upright on bird legs, with a man's
 * enormous arms growing where his wings would be. His body is a rooster's —
 * a deep puffed breast, a short back, a tall fountain of glossy black sickle
 * feathers — and his head is a rooster's held high, with an upright scarlet
 * comb, wattles under a short hooked beak and a fierce orange eye. The arms are
 * human: huge round deltoids, peaked biceps and thick forearms covered in close
 * copper feathers, ending in big scaly yellow hands. The builds in
 * `rooster/builds.ts` are the same species drawn bigger or smaller, prouder or
 * more battered.
 *
 * The parts live in `rooster/` by concern: the rig and the pose (`rig.ts`), the
 * paint primitives (`paint.ts`), the limbs (`limbs.ts`), the trunk, plumage and
 * kit (`body.ts`) and the head (`head.ts`). This module composes them.
 *
 * No part draws its own outline. The parts are painted in three slabs, back to
 * front, on a surface of the painter's own (`figureCompose.ts`); each slab
 * casts a shadow on the ones under it, and the outline and the rim light are
 * built from the finished silhouette. Drawn per part, every arm laid over the
 * chest gets an ink ring and the figure reads as cut-out paper. Because the
 * figure composes at whatever density it is painted at, its `FigureDef` sets
 * `skipSupersample`.
 *
 * Coordinates are rig units with the origin on the ground between the feet and
 * +Y down; the caller translates to that point and scales by cell pixels per rig
 * unit. The profile is drawn facing +X; the runtime mirrors it for the other
 * direction.
 */

import { rgba } from './bipedArt';
import {
  blitLayer,
  clear,
  crossOffsets,
  dilationOffsets,
  inFigureSpace,
  type InkReach,
  layerBounds,
  laySlab,
  lightRim,
  makeLayer,
  occludeAround,
  outlineInto,
  pixelStep,
  scratchPx,
  withComposeLayers,
} from './figureCompose';
import { ROOSTER_BUILD_SPECS, type RoosterBuild, type RoosterBuildSpec } from './rooster/builds';
import {
  drawBelt,
  drawCape,
  drawShoulderHackles,
  drawSweatband,
  drawTail,
  drawTrunk,
} from './rooster/body';
import { drawHead, headReach } from './rooster/head';
import { type ArmPaint, type LegFacing, drawArm, drawLeg, upperArmBack } from './rooster/limbs';
import { type Ctx, LIGHT, softSpot } from './rooster/paint';
import {
  type BoneChain,
  type Pt,
  type RoosterPose,
  type RoosterSkeleton,
  type RoosterView,
  VIEWS,
  add,
  buildRoosterSkeleton,
  headRotation,
  pt,
} from './rooster/rig';

export { ROOSTER_BUILDS, ROOSTER_BUILD_SPECS, type RoosterBuild } from './rooster/builds';
export {
  type ArmAngles,
  ELBOW_IN,
  ELBOW_OUT,
  type FootPose,
  HEAD_ON_HAND_HANG,
  LEG_MAX_REACH,
  legReachDemand,
  PROFILE_HAND_HANG,
  type Pt,
  type RoosterPose,
  type RoosterView,
  VIEWS,
  SHOULDER_HALF,
  SHOULDER_Y,
  buildRoosterSkeleton,
  cellPxPerRigUnit,
  headToFigure,
  mixPt,
  tilesPerRigUnit,
  ROOSTER_TILE_SCALE,
  pt,
  restingPose,
  standingFoot,
} from './rooster/rig';
export { beakTipOffset, eyeOffset } from './rooster/head';
export { fistCentre, handAngle } from './rooster/limbs';

// ── Composition constants, in cell pixels at the figure's own cell scale ──────

/** The silhouette ring: one cell pixel, which at the game's own tile scale is one screen pixel. */
const OUTLINE_PX = 1;
const OUTLINE_SAMPLES = 8;
const OUTLINE_ALPHA = 0.92;
/**
 * A sliver of floor between a hanging arm and the barrel stays floor, not
 * outline: the outline is built off the silhouette closed shut, then cut back.
 */
const OUTLINE_CLOSES_GAPS = true;
const CAST_DROP_PX = 1;
const CAST_SHADOW_TONE = '#120604';
const CAST_SHADOW_ALPHA = 0.5;
const OCCLUSION_PX = 1;
const OCCLUSION_ALPHA = 0.32;
const RIM_PX = 1;
const RIM_ALPHA = 0.55;
/** Shadows fall away from the key light. */
const SHADOW_FALL: Pt = { x: -LIGHT.x, y: -LIGHT.y };

/** How far a far limb edge-on is pushed toward its own shadow. */
const FAR_LIMB_SHADE = 0.32;
/** A soft disc of shadow on the floor under him. */
const GROUND_SHADOW_RX = 0.75;
const GROUND_SHADOW_RY = 0.16;
const GROUND_SHADOW_ALPHA = 0.42;
/** How far past the joints the composing surface reaches, for feathers, fists and comb. */
const REACH_MARGIN = 0.42;
/** How far the tail fountain's ink runs from its root: back and up edge-on, across head-on. */
const TAIL_REACH_BACK = 1.15;
const TAIL_REACH_UP = 1.1;
const TAIL_REACH_DOWN = 0.45;
const TAIL_REACH_ACROSS = 0.9;

/** Feather variety is drawn from fixed seeds, so a cell is the same picture every bake. */
const SEED_LEFT_LEG = 101;
const SEED_RIGHT_LEG = 211;
const SEED_LEFT_ARM = 307;
const SEED_RIGHT_ARM = 401;

function armPaint(
  chain: BoneChain,
  fallbackBack: Pt,
  fist: number,
  shade: number,
  facesAway: boolean,
): ArmPaint {
  return { chain, backNormal: upperArmBack(chain, fallbackBack), fist, shade, facesAway };
}

function legFacingOf(view: RoosterView): LegFacing {
  if (view === 'side') return 'forward';
  return view === 'front' ? 'camera' : 'away';
}

/** Every point the figure's ink reaches toward, so the composing surface holds all of it. */
function inkReaches(skeleton: RoosterSkeleton, build: RoosterBuildSpec): InkReach[] {
  const spec = VIEWS[skeleton.view];
  const tailScale = build.proportions.tailLength;
  const tailReach = spec.profile
    ? [
        add(skeleton.tailRoot, -TAIL_REACH_BACK * tailScale, -TAIL_REACH_UP * tailScale),
        add(skeleton.tailRoot, -TAIL_REACH_BACK * tailScale, TAIL_REACH_DOWN),
      ]
    : [
        add(skeleton.tailRoot, -TAIL_REACH_ACROSS * tailScale, -TAIL_REACH_UP * tailScale),
        add(skeleton.tailRoot, TAIL_REACH_ACROSS * tailScale, -TAIL_REACH_UP * tailScale),
        add(skeleton.tailRoot, -TAIL_REACH_ACROSS * tailScale, TAIL_REACH_DOWN),
        add(skeleton.tailRoot, TAIL_REACH_ACROSS * tailScale, TAIL_REACH_DOWN),
      ];
  const limbs = [skeleton.leftArm, skeleton.rightArm].flatMap((chain) => [
    chain.root,
    chain.joint,
    chain.end,
  ]);
  const legs = [skeleton.leftLeg, skeleton.rightLeg].flatMap((leg) => [
    leg.root,
    leg.hock,
    leg.ankle,
    leg.pad,
  ]);
  const headSpan = headReach(build);
  const head = [
    add(skeleton.headCentre, -headSpan, -headSpan),
    add(skeleton.headCentre, headSpan, headSpan),
  ];
  return [
    {
      points: [...limbs, ...legs, ...tailReach, ...head, skeleton.bodyCentre, pt(0, 0)],
      margin: REACH_MARGIN,
    },
  ];
}

function drawGroundShadow(ctx: Ctx, skeleton: RoosterSkeleton, build: RoosterBuildSpec): void {
  const centreX = (skeleton.leftLeg.pad.x + skeleton.rightLeg.pad.x) / 2;
  const girth = build.proportions.bodyGirth;
  softSpot(
    ctx,
    pt(centreX, 0),
    GROUND_SHADOW_RX * girth,
    GROUND_SHADOW_RY,
    0,
    '#000000',
    GROUND_SHADOW_ALPHA,
  );
}

type Slab = (ctx: Ctx) => void;

/**
 * The parts in slabs, back to front, for the view being painted. Each slab
 * casts its shadow on everything laid before it. The arms are the front slab
 * in every view, over the cape and the head, so their deltoids and biceps are
 * never hidden; a few hackle tips laid over each deltoid's top are what root
 * them in the feathered shoulder.
 */
function slabsFor(skeleton: RoosterSkeleton, pose: RoosterPose, build: RoosterBuildSpec): Slab[] {
  const spec = VIEWS[skeleton.view];
  const facing = legFacingOf(skeleton.view);
  const head = (ctx: Ctx): void => {
    ctx.save();
    try {
      ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
      ctx.rotate(headRotation(skeleton));
      drawHead(ctx, { skeleton, pose, build });
    } finally {
      ctx.restore();
    }
  };
  const capeAndHead = (ctx: Ctx): void => {
    drawCape(ctx, skeleton, pose, build);
    drawSweatband(ctx, skeleton, build);
    head(ctx);
  };

  if (spec.profile) {
    const back = pt(-1, 0);
    const nearArm: Slab = (ctx) => {
      drawArm(
        ctx,
        armPaint(skeleton.rightArm, back, pose.rightFist, 0, false),
        build,
        SEED_RIGHT_ARM,
      );
      drawShoulderHackles(ctx, skeleton, skeleton.rightShoulder, build);
    };
    const rear: Slab = (ctx) => {
      drawArm(
        ctx,
        armPaint(skeleton.leftArm, back, pose.leftFist, FAR_LIMB_SHADE, false),
        build,
        SEED_LEFT_ARM,
      );
      drawLeg(ctx, skeleton.leftLeg, facing, build, FAR_LIMB_SHADE, SEED_LEFT_LEG);
      drawTail(ctx, skeleton, pose, build);
    };
    const trunk: Slab = (ctx) => {
      drawTrunk(ctx, skeleton, pose, build);
      drawBelt(ctx, skeleton, pose, build);
      drawLeg(ctx, skeleton.rightLeg, facing, build, 0, SEED_RIGHT_LEG);
    };
    return [rear, trunk, capeAndHead, nearArm];
  }

  const outward = (chain: BoneChain): Pt => pt(Math.sign(chain.root.x - skeleton.hip.x) || 1, 0);
  const fromBehind = !spec.showsFace;
  const leftArm = (ctx: Ctx): void =>
    drawArm(
      ctx,
      armPaint(
        skeleton.leftArm,
        outward(skeleton.leftArm),
        pose.leftFist,
        0,
        fromBehind && !pose.leftArmBehind,
      ),
      build,
      SEED_LEFT_ARM,
    );
  const rightArm = (ctx: Ctx): void =>
    drawArm(
      ctx,
      armPaint(
        skeleton.rightArm,
        outward(skeleton.rightArm),
        pose.rightFist,
        0,
        fromBehind && !pose.rightArmBehind,
      ),
      build,
      SEED_RIGHT_ARM,
    );
  // Head-on, a tail shorter than the big build's never clears his outline:
  // what peeks past it is a few px of green at a shoulder or between the
  // shoulder blades, which reads as a strap, a collar or a backpack, so it is
  // left out. Edge-on it is the shape that says rooster.
  const shortTail = build.proportions.tailLength < 1;
  const tailBehind = spec.showsFace || shortTail;
  const rear: Slab = (ctx) => {
    if (tailBehind && !shortTail) drawTail(ctx, skeleton, pose, build);
    if (pose.leftArmBehind) leftArm(ctx);
    if (pose.rightArmBehind) rightArm(ctx);
  };
  const trunk: Slab = (ctx) => {
    drawLeg(ctx, skeleton.leftLeg, facing, build, 0, SEED_LEFT_LEG);
    drawLeg(ctx, skeleton.rightLeg, facing, build, 0, SEED_RIGHT_LEG);
    drawTrunk(ctx, skeleton, pose, build);
    drawBelt(ctx, skeleton, pose, build);
  };
  const arms: Slab = (ctx) => {
    if (!pose.leftArmBehind) {
      leftArm(ctx);
      drawShoulderHackles(ctx, skeleton, skeleton.leftShoulder, build);
    }
    if (!pose.rightArmBehind) {
      rightArm(ctx);
      drawShoulderHackles(ctx, skeleton, skeleton.rightShoulder, build);
    }
  };
  const top: Slab = (ctx) => {
    if (tailBehind) {
      if (pose.headOverArms) {
        drawCape(ctx, skeleton, pose, build);
        drawSweatband(ctx, skeleton, build);
        return;
      }
      capeAndHead(ctx);
      return;
    }
    // From behind the fountain springs from his rump and arches out past his
    // shoulders, and the hackle cape falls over its root: drawn over the cape
    // and head, the fountain swallows the neck and he reads as a plant in a pot.
    drawTail(ctx, skeleton, pose, build);
    capeAndHead(ctx);
  };
  return pose.headOverArms && tailBehind
    ? [rear, trunk, top, arms, head]
    : [rear, trunk, top, arms];
}

/**
 * Paints one rooster in one view. `cellPxPerUnit` is how many cell pixels one
 * rig unit spans, whatever density the cell itself is being painted at: every
 * whole-pixel effect (the outline, the rim, the cast shadows) is sized in cell
 * pixels so the figure is the same picture at every density.
 */
export function drawRooster(
  ctx: Ctx,
  build: RoosterBuild,
  view: RoosterView,
  pose: RoosterPose,
  cellPxPerUnit: number,
): void {
  const spec = ROOSTER_BUILD_SPECS[build];
  const skeleton = buildRoosterSkeleton(pose, view, spec);
  drawGroundShadow(ctx, skeleton, spec);
  withComposeLayers(() => compose(ctx, skeleton, pose, spec, cellPxPerUnit));
}

function compose(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
  cellPxPerUnit: number,
): void {
  const slabs = slabsFor(skeleton, pose, build);
  const bounds = layerBounds(ctx, inkReaches(skeleton, build));
  const px = (cellPx: number): number => scratchPx(bounds, cellPx, cellPxPerUnit);
  const body = makeLayer(bounds);
  const part = makeLayer(bounds);
  const scratch = makeLayer(bounds);
  const cast = pixelStep(SHADOW_FALL, px(CAST_DROP_PX));
  const castTone = rgba(CAST_SHADOW_TONE, CAST_SHADOW_ALPHA);

  const [first, ...rest] = slabs;
  inFigureSpace(body, bounds, first);
  rest.forEach((slab, index) => {
    clear(part);
    inFigureSpace(part, bounds, slab);
    if (index > 0) {
      occludeAround(
        body,
        part,
        scratch,
        crossOffsets(px(OCCLUSION_PX)),
        rgba(CAST_SHADOW_TONE, OCCLUSION_ALPHA),
      );
    }
    laySlab(body, part, scratch, cast, castTone);
  });

  lightRim(body, scratch, pixelStep(LIGHT, px(RIM_PX)), rgba(build.palette.hackle.rim, RIM_ALPHA));
  outlineInto(
    part,
    body,
    scratch,
    dilationOffsets(px(OUTLINE_PX), OUTLINE_SAMPLES),
    build.palette.outline,
    rgba(build.palette.outline, OUTLINE_ALPHA),
    OUTLINE_CLOSES_GAPS,
  );
  blitLayer(ctx, part, bounds);
}
