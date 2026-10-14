/**
 * Assembles Carl from his parts in draw order, one entry point per view.
 *
 * Carl is the man from the surface who went down into the dungeon in a leather
 * jacket, a pair of heart-print boxer shorts and nothing else — no trousers, no
 * shoes. Everything painted here serves that silhouette: a jacket that ends at
 * the waist, bare legs, and the bare feet the Smush stomp lands with.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 *
 * The parts are composed on a scratch surface of the painter's own rather than
 * straight into the caller's context, because three things here are functions
 * of the *finished* silhouette and cannot be built part by part:
 *
 * - the outline, which belongs round the outside of the whole figure only —
 *   drawn per part, every arm over the chest and every hem over a thigh gets an
 *   ink line and the figure reads as a paper doll;
 * - the shadow each overlapping part casts on whatever is already painted under
 *   it, whichever part that happens to be;
 * - the cool bounce light along the shadow-side edge, which is what keeps that
 *   edge from dissolving into the darkest dungeon floor.
 */

import { traceShortsOutline } from './boxers';
import type { CarlDressing, CarlLegPair, CarlShortsFlutter } from './carlParts';
import { FOOT_LEN, footContact, LEFT_FOOT_OUT, RIGHT_FOOT_OUT, type ToesPainter } from './feet';
import { drawHead, drawNeck, headAngle, traceSkull } from './head';
import {
  drawArm,
  drawArmWithoutHand,
  drawGripHand,
  drawLeg,
  GRIP_HAND_WIDTH,
  handGrip,
  handLength,
  legCover,
  type LegCoverSegment,
  type LegSegments,
  paintKneeAtCamera,
  UNSHADED,
} from './limbs';
import { type SolvedHand, type SolvedHands, solveHands } from './handSockets';
import { pt, TWO_PI } from './geometry';
import { drawGroundShadow } from './paint';
import {
  CONTACT_SHADOW_ALPHA,
  FAR_LIMB_SHADE,
  LIGHT,
  OUTLINE,
  RIM_ALPHA,
  RIM_LIGHT,
  SILHOUETTE_OUTLINE,
  SILHOUETTE_OUTLINE_ALPHA,
} from './palette';
import type { HeldProp } from './props';
import { scriptedPropReach, scriptedPropVisual } from '../../held/art/scriptedPropHeld';
import { compositeHeldItem, heldTransformAt } from '../../held/heldComposite';
import type { HeldVisualDef } from '../../held/heldVisualDef';
import type { HeldVisualTransform } from '../../held/heldPaint';
import type { HandleRadius } from '../../held/gripArchetypes';
import { HEAD_RX, HEAD_RY, HIP_HALF, THIGH_LENGTH } from './proportions';
import {
  aheadScreenSign,
  buildSkeleton,
  poseAsDrawn,
  type BodySide,
  type BoneChain,
  type CarlPose,
  type HandShape,
  type PalmGlow,
  type Skeleton,
  VIEWS,
  type ViewSpec,
} from './rig';
import { collarShape, torsoFrame, traceCollar, traceGarmentTorso } from './torso';
import { carlDressingFor } from '../../garments/human/carlDressing';
import { clamp01, lerp, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse } from '../softShade';
import {
  blitLayer,
  clear,
  crossOffsets,
  dilateInto,
  dilationOffsets,
  drawAtop,
  eraseWith,
  inFigureSpace,
  keepWithin,
  type Layer,
  type LayerBounds,
  layerBounds,
  laySlab,
  lightRim,
  makeLayer,
  maskedCopy,
  occludeAround,
  outlineInto,
  pixelStep,
  scratchPx,
  tint,
} from '../figureCompose';
import { HUMAN_CELL_PX_PER_UNIT } from '../human/figureScale';

type Ctx = CanvasRenderingContext2D;

const SHADOW_RX = 0.36;
const SHADOW_RY = 0.13;
/** A figure in the air casts a smaller, fainter shadow. */
const SHADOW_LIFT_FADE = 1.6;

/** Thumbs face inboard, toward the body, on both hands. */
const LEFT_THUMB = -1;
const RIGHT_THUMB = 1;

const SHADOW_FOLLOW = 0.6;
const SHADOW_LIFT_SHRINK = 0.55;

// ── The composing surface ────────────────────────────────────────────────────
//
// Composed on a surface of its own at the density the frame cache paints at;
// `figureCompose.ts` says why, and owns the machinery.

/**
 * How far past the extreme points it is sized round — the skeleton's joints,
 * the head, and whatever a held prop reaches — a figure's ink can run: a foot
 * runs a third of a unit past its ankle, and the hair and outline sit outside
 * the head's radius. Generous on purpose — ink outside the surface is lost.
 */
const LAYER_MARGIN = 0.42;
/**
 * Gear states its reach as the extreme points of its own ink — the cloak's
 * hem and flare, the spikes and smoke round the gauntlet — so past them there
 * is only a stroke laid along an edge and the outline round the silhouette.
 * Held to the body's generous margin instead, a flared cloak widens every
 * composing pass by the better part of a unit for ink that is not there.
 */
const GEAR_INK_MARGIN = 0.1;

/** Outline thickness, in cell pixels: one screen pixel at the 32 px tile. */
export const OUTLINE_PX = 2;
/** Directions the silhouette is dilated in to build the outline. */
const OUTLINE_SAMPLES = 8;

/** How far a part's cast shadow falls from its edge, away from the key light, in cell pixels. */
const CAST_DROP_PX = 2;
/**
 * The cast shadow's colour and weight. A cool, dark plum rather than black:
 * a shadow falling on warm skin or brown leather reads cooler than the lit
 * surface round it, and black just dirties it.
 */
export const CAST_SHADOW_TONE = '#2b1a2e';
const CAST_SHADOW_ALPHA = 0.55;

/** Width of the bounce rim on the shadow side, in cell pixels. */
const RIM_PX = 1;

/** Paints one attachment in figure space, from the skeleton the body was solved to. */
export type CarlAttachmentPainter = (
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
) => void;

/**
 * Anatomy and clothing a figure built on this rig grows past it — wings, a
 * tail, horns, trousers. They are painted inside the composition rather than
 * over the finished figure, so they share its silhouette outline, its rim and
 * the cast shadows between slabs; laid on afterwards they read as stickers.
 * Every hook is optional, and a pose composed without any is Carl unchanged.
 */
export interface CarlAttachments {
  /** Painted first, in the rearmost slab, under every limb. */
  readonly behind?: CarlAttachmentPainter;
  /** Painted over the legs and the shorts, under the garment's hem. */
  readonly overLegs?: CarlAttachmentPainter;
  /** Painted in a slab of its own over the torso and head, under the arms in front of him. */
  readonly over?: CarlAttachmentPainter;
  /** The extreme points the attachments' ink reaches, so the composing surface is sized round them. */
  readonly reach: (skeleton: Skeleton, view: ViewSpec, pose: CarlPose) => readonly Pt[];
}

/**
 * Options for composing the figure. Carl himself is always composed with the
 * defaults; the gates change the margin and the outline, and a figure built
 * on his rig passes its attachments.
 */
export interface CarlComposeOptions {
  /** Replaces {@link LAYER_MARGIN}, in figure units. */
  readonly layerMargin?: number;
  /** False leaves the silhouette outline off, so a gate can tell its ink from the parts'. */
  readonly silhouetteOutline?: boolean;
  readonly attachments?: CarlAttachments;
  /**
   * How thick a handle an equipment-chosen item in his grip has: a hand
   * holding one closes its fingers round it. Absent is a tool haft's.
   */
  readonly itemHandle?: HandleRadius;
  /**
   * Receives what lies in front of an equipment-chosen item — the fingers
   * over its handle and every part of him nearer the camera — painted in the
   * same space as the main context, which then holds everything behind it.
   * Nothing is painted here for a pose holding no such item.
   */
  readonly front?: Ctx;
  /**
   * Leaves a row's props out of the picture as if each were an
   * equipment-chosen item, its silhouette and outline kept: the parity gate
   * composites them afterwards and compares.
   */
  readonly deferProps?: boolean;
  /**
   * Replaces the dressing his pose's outfit would paint him in: the garment
   * envelope gate routes each garment's ink to a surface of its own.
   */
  readonly dressing?: (pose: CarlPose, view: ViewSpec) => CarlDressing;
}

/** The handle an equipment-chosen item is assumed to have when the caller does not say: a tool's. */
const DEFAULT_ITEM_HANDLE: HandleRadius = 'standard';

/** The skeleton's extreme points: every joint, and the head's box. */
function skeletonExtents(skeleton: Skeleton): Pt[] {
  return [
    skeleton.hip,
    skeleton.shoulderCentre,
    skeleton.leftArm.joint,
    skeleton.leftArm.end,
    skeleton.rightArm.joint,
    skeleton.rightArm.end,
    skeleton.leftLeg.joint,
    skeleton.leftLeg.end,
    skeleton.rightLeg.joint,
    skeleton.rightLeg.end,
    { x: skeleton.headCentre.x - HEAD_RX, y: skeleton.headCentre.y - HEAD_RY },
    { x: skeleton.headCentre.x + HEAD_RX, y: skeleton.headCentre.y + HEAD_RY },
  ];
}

/**
 * Every point past the skeleton the figure paints to: each prop a gripping
 * hand holds, by its own reach, the free end of any cord tethered to one, and
 * the glow round an open palm.
 * A worn garment standing off the body states its own reach through its
 * dressing's `reach`, with its own margin; anything else painted clear of the body adds its
 * extreme points here, or it is cut off at the surface's edge.
 */
function paintedExtents(skeleton: Skeleton, view: ViewSpec, pose: CarlPose): Pt[] {
  const extents: Pt[] = [];
  const hands = [
    { hand: 'left', chain: skeleton.leftArm, shape: pose.leftHandShape },
    { hand: 'right', chain: skeleton.rightArm, shape: pose.rightHandShape },
  ] as const;
  for (const { hand, chain, shape } of hands) {
    const prop = heldPropIn(pose, hand, shape);
    if (prop === undefined) continue;
    extents.push(...scriptedPropReach(handGrip(chain), prop, view));
    if (prop.tether) extents.push(prop.tether);
  }
  const palm = pose.palmGlow ? palmGlowCentre(skeleton, pose, pose.palmGlow) : null;
  if (palm !== null) {
    extents.push(
      { x: palm.x - PALM_GLOW_RADIUS, y: palm.y - PALM_GLOW_RADIUS },
      { x: palm.x + PALM_GLOW_RADIUS, y: palm.y + PALM_GLOW_RADIUS },
    );
  }
  return extents;
}

function carlPx(bounds: LayerBounds, cellPx: number): number {
  return scratchPx(bounds, cellPx, HUMAN_CELL_PX_PER_UNIT);
}

/** The direction a shadow falls in: straight away from the key light. */
const SHADOW_FALL: Pt = { x: -LIGHT.x, y: -LIGHT.y };

function fallBy(distance: number): Pt {
  return pixelStep(SHADOW_FALL, distance);
}

/** The whole-pixel offsets every compositing pass uses, at one surface's density. */
interface LayerOffsets {
  readonly cast: Pt;
  /** The long cast shadow of a part standing well off the body behind it. */
  readonly farCast: Pt;
  readonly rim: Pt;
  /** The outline's dilation, snapped to whole pixels for the same reason as {@link fallBy}. */
  readonly outline: readonly Pt[];
  readonly occlusion: readonly Pt[];
}

function layerOffsets(bounds: LayerBounds): LayerOffsets {
  return {
    cast: fallBy(carlPx(bounds, CAST_DROP_PX)),
    farCast: fallBy(carlPx(bounds, KNEE_CAST_DROP_PX)),
    rim: fallBy(carlPx(bounds, RIM_PX)),
    outline: dilationOffsets(carlPx(bounds, OUTLINE_PX), OUTLINE_SAMPLES),
    occlusion: crossOffsets(carlPx(bounds, OCCLUSION_PX)),
  };
}

/**
 * Lays `part` over `body`, casting its shadow onto whatever `body` already
 * holds beneath it. `scratch` is free to reuse afterwards.
 *
 * No lit sliver past the shadow here, unlike `castShadow` in `paint.ts`: the sliver is
 * a second tint and a second masked composite per slab, which is most of what
 * this pass costs, and at the 32 px tile a two-pixel shadow reads as contact
 * on its own. A part that needs one at a specific overlap paints it with
 * `castShadow`.
 */
function carlSlab(body: Layer, part: Layer, scratch: Layer, offsets: LayerOffsets): void {
  laySlab(body, part, scratch, offsets.cast, rgba(CAST_SHADOW_TONE, CAST_SHADOW_ALPHA));
}

/**
 * Darkens whatever `body` holds in a thin band all round `part`'s silhouette,
 * before `part` is laid over it.
 *
 * An arm hangs over or beside the jacket, leather on leather, and a cast
 * shadow falling down and to the right only separates one edge of it: the
 * sleeve's other edge merges into the jacket and the arm vanishes into the
 * torso — edge-on into its side, head-on into a box of a jacket. Contact shadow all round it — the occlusion where the arm nearly
 * touches the body — is what says the arm is a separate form lying on it. It
 * is a cool, half-strength shadow, not an ink line.
 */
function occludeCarl(
  body: Layer,
  part: Layer,
  scratch: Layer,
  offsets: LayerOffsets,
  alpha: number,
): void {
  occludeAround(body, part, scratch, offsets.occlusion, rgba(CAST_SHADOW_TONE, alpha));
}

/**
 * How strong the occlusion round the front arms is. Edge-on the sleeve lies on
 * the jacket's lit side and needs the stronger band to part from it; head-on
 * the arms hang beside the jacket's darker flanks, where a lighter band is
 * enough to part them and leave the torso reading as a V between them rather
 * than as a box.
 */
const OCCLUSION_ALPHA_EDGE_ON = 0.65;
const OCCLUSION_ALPHA_HEAD_ON = 0.45;
/**
 * Edge-on the two legs are bare skin on bare skin, and standing they overlap
 * from the shins to the feet: the near foot's heel sits over the far foot's
 * toes and the pair reads as one slab. The same contact shadow the arms get,
 * laid round the near leg, parts them — lighter, because skin in shade is
 * already a warm mid-tone and a full-strength band reads as a gap.
 */
const OCCLUSION_ALPHA_NEAR_LEG = 0.45;
/**
 * A knee driven at the camera stands well off the shorts and the thigh behind
 * it, so as well as the usual short cast shadow it throws a long one, and a
 * contact band all round parts its flesh from the white cotton it lies over.
 * Without them the lower leg sits flat on the shorts like a pink patch.
 */
const OCCLUSION_ALPHA_KNEE = 0.5;
const KNEE_CAST_DROP_PX = 7;
const KNEE_CAST_ALPHA = 0.45;

function castFar(body: Layer, part: Layer, scratch: Layer, offsets: LayerOffsets): void {
  clear(scratch);
  scratch.ctx.drawImage(part.surface, 0, 0);
  tint(scratch, rgba(CAST_SHADOW_TONE, KNEE_CAST_ALPHA));
  drawAtop(body, scratch, offsets.farCast.x, offsets.farCast.y);
}

/** Edge-on the near leg is the second slab: the far leg and far arm are painted before it. */
const PROFILE_NEAR_LEG_SLAB = 1;
/** The occlusion band's width, in cell pixels: one screen pixel at the 32 px tile. */
const OCCLUSION_PX = 2;

/**
 * Lights the rim of the silhouette on the side turned away from the key: every
 * pixel of the figure whose neighbour `RIM_PX` further along the shadow
 * direction is empty — and not inside `occluder`, the handles laid against
 * him once he is finished.
 */
function lightShadowRim(
  body: Layer,
  scratch: Layer,
  offsets: LayerOffsets,
  clearRim: (layer: Layer) => void,
  occluder?: Layer,
): void {
  lightRim(body, scratch, offsets.rim, rgba(RIM_LIGHT, RIM_ALPHA), clearRim, occluder);
}

// ── Draw order ───────────────────────────────────────────────────────────────

/**
 * The figure as an ordered list of slabs, back to front. Each slab after the
 * first casts a shadow on everything before it, so where a slab boundary falls
 * decides which overlaps get one: the near leg over the far one in profile,
 * the boxers over the thighs, the jacket over the boxers, and the near arms
 * over all of it. Every slab costs a tint and a masked composite of the whole
 * surface, so a boundary goes only where an overlap needs it.
 */
type SlabPainter = (ctx: Ctx) => void;

/**
 * The prop the pose has given `hand`, if that hand can hold it. Only a hand
 * posed `'grip'` has anything to hold onto — a prop drawn free-floating past
 * an open or relaxed hand would not look held.
 */
function heldPropIn(
  pose: CarlPose,
  hand: 'left' | 'right',
  handShape: HandShape | undefined,
): HeldProp | undefined {
  if (handShape !== 'grip') return undefined;
  return pose.heldProps?.find((candidate) => candidate.hand === hand);
}

/**
 * How far a knee has to stand toward the camera, in tile units, before the
 * knee, shin and foot are painted over the shorts. A walking knee never gets
 * this far forward; a chambered stomp, a knee strike or a sprinter's knee
 * drive does, and painted under the hem those read as a leg hanging down
 * behind the shorts instead of one coming at the viewer.
 */
const KNEE_FORWARD_DEPTH = 0.3;
/**
 * How far a hand has to be away from the camera, in tile units, before the
 * arm is painted behind the torso and head: about half his chest's depth, past
 * which the hand is on the far side of his body.
 */
const HAND_BEHIND_DEPTH = 0.12;

/** Head-on, how far a leg's knee and its nearest point stand toward the camera. */
interface LegDepth {
  readonly knee: number;
  readonly nearest: number;
}

/**
 * Ground-frame depth turned toward the camera: ahead of him is toward it in
 * the front view and away from it in the back view. A leg solved in the
 * picture plane has no depth and stands level with the body.
 */
function legDepth(chain: BoneChain, view: ViewSpec): LegDepth {
  const ahead = aheadScreenSign(view);
  const knee = (chain.groundJoint?.depth ?? 0) * ahead;
  const ankle = (chain.groundEnd?.depth ?? 0) * ahead;
  return { knee, nearest: Math.max(knee, ankle) };
}

function handIsBehind(depth: number | undefined, view: ViewSpec): boolean {
  if (depth === undefined) return false;
  return depth * aheadScreenSign(view) <= -HAND_BEHIND_DEPTH;
}

function shortsHalfWidth(view: ViewSpec): number {
  return HIP_HALF * view.girth * view.hipDepth;
}

/**
 * A knee driven at the camera whose thigh does not rise above the hip by more
 * than this share of its length has the leg of the shorts laid over it. The
 * floor is seen from above, so a thigh held out level or angled down shows its
 * top, which the loose leg of the shorts covers; a thigh chambered well up
 * shows its end instead, ringed by the opening.
 */
const THIGH_LEVEL_RISE = 0.25;
/**
 * The rig draws a thigh pointing at the camera as nearly no length on the
 * screen, with the knee at the hip, because depth fades out of the picture
 * toward hip height. Seen from above, the top of that thigh would show this
 * share of its length running down the screen, so the leg of the shorts over
 * it is solved on a thigh stood down at least that far: the hem hangs over
 * the top of the knee, and the knee and shin come out from under it.
 */
const THIGH_TOP_SEEN_SHARE = 0.55;
/** Wide and deep enough to hold any lower leg below the hip. */
const KNEE_CLIP_REACH = 2;

function thighHeldLevel(chain: BoneChain): boolean {
  return chain.root.y - chain.joint.y <= THIGH_LENGTH * THIGH_LEVEL_RISE;
}

function thighSeenFromAbove(chain: BoneChain): BoneChain {
  const seenDrop = THIGH_LENGTH * THIGH_TOP_SEEN_SHARE;
  const drop = chain.joint.y - chain.root.y;
  if (drop >= seenDrop) return chain;
  return { ...chain, joint: pt(chain.joint.x, chain.root.y + seenDrop) };
}

/**
 * Everything behind the front arms, as slabs back to front, and the front
 * arms themselves, which are always laid last.
 */
interface FigureSlabs {
  readonly body: SlabPainter[];
  readonly frontArms: SlabPainter;
  /** Whether each drawn arm is painted in the rearmost slab rather than with the front arms. */
  readonly armBehind: Readonly<Record<BodySide, boolean>>;
  /** Each drawn arm's shade, the body's for one behind him in profile. */
  readonly armShade: Readonly<Record<BodySide, number>>;
  /** Each drawn arm without its hand, with whatever it wears on the forearm. */
  readonly forearm: Readonly<Record<BodySide, SlabPainter>>;
  /** The body slab holding the near leg edge-on, which is laid with contact shadow all round it. */
  readonly nearLegSlab: number | null;
  /** The body slab holding a knee driven at the camera, laid with contact shadow and a long cast shadow. */
  readonly kneeSlab: number | null;
  /** Whether a garment hangs in a slab of its own over his back. */
  readonly backCovered: boolean;
}

function figureSlabs(
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  attachments: CarlAttachments | undefined,
  hands: SolvedHands,
  dressing: CarlDressing,
): FigureSlabs {
  const slabs = bodySlabs(skeleton, view, pose, attachments, hands, dressing);
  const behind = attachments?.behind;
  const over = attachments?.over;
  if (behind === undefined && over === undefined) return slabs;
  // The rearmost slab is widened rather than preceded, and the over slab
  // appended, so the slab indices the table below hands out stay true.
  const [rearmost, ...rest] = slabs.body;
  const withBehind: SlabPainter = (ctx) => {
    behind?.(ctx, skeleton, view, pose);
    rearmost(ctx);
  };
  const overSlabs: SlabPainter[] =
    over === undefined ? [] : [(ctx) => over(ctx, skeleton, view, pose)];
  return { ...slabs, body: [withBehind, ...rest, ...overSlabs] };
}

function bodySlabs(
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  attachments: CarlAttachments | undefined,
  hands: SolvedHands,
  dressing: CarlDressing,
): FigureSlabs {
  // Edge-on the figure's left arm is the far one, genuinely behind the torso,
  // and takes the body's shade. Head-on both arms hang in front of the jacket
  // unless the pose puts one behind him, and neither is shaded — the same rule
  // the legs follow: a shade there paints one hand a different colour of skin
  // from the other, and from his bare legs.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind || handIsBehind(pose.leftHandDepth, view);
  const rightBehind =
    !view.profile && (pose.rightArmBehind || handIsBehind(pose.rightHandDepth, view));
  const rightShade = rightBehind ? farArmShade : UNSHADED;
  const dressForearm = (ctx: Ctx, drawn: BodySide): void => {
    const chain = drawn === 'left' ? skeleton.leftArm : skeleton.rightArm;
    dressing.part(ctx, 'forearm', {
      piece: 'arm',
      drawn,
      chain,
      skeleton,
      view,
      pose,
      envelope: (envelopeCtx) => traceChain(envelopeCtx, chain),
    });
  };
  const toesOf =
    (drawn: BodySide): ToesPainter =>
    (ctx, toes) =>
      dressing.part(ctx, 'foot', {
        piece: 'toes',
        drawn,
        view,
        nails: toes.nails,
        instep: toes.instep,
        secondToe: toes.secondToe,
        ringAcross: toes.ringAcross,
        envelope: toes.trace,
      });
  const leftArm = (ctx: Ctx): void => {
    drawArm(
      ctx,
      skeleton.leftArm,
      pose.leftFist,
      farArmShade,
      LEFT_THUMB,
      view.profile,
      pose.leftHandShape,
      hands.left.wrap,
    );
    dressForearm(ctx, 'left');
  };
  const rightArm = (ctx: Ctx): void => {
    drawArm(
      ctx,
      skeleton.rightArm,
      pose.rightFist,
      rightShade,
      RIGHT_THUMB,
      view.profile,
      pose.rightHandShape,
      hands.right.wrap,
    );
    dressForearm(ctx, 'right');
  };
  const armBehind = { left: leftBehind, right: rightBehind };
  const armShade = { left: farArmShade, right: rightShade };
  const forearm = {
    left: (ctx: Ctx): void => {
      drawArmWithoutHand(ctx, skeleton.leftArm, farArmShade, LEFT_THUMB, view.profile);
      dressForearm(ctx, 'left');
    },
    right: (ctx: Ctx): void => {
      drawArmWithoutHand(ctx, skeleton.rightArm, rightShade, RIGHT_THUMB, view.profile);
      dressForearm(ctx, 'right');
    },
  };

  const dressLeg = (
    ctx: Ctx,
    side: BodySide,
    segments: LegSegments,
    piece: 'leg' | 'kneeAtCamera',
  ): void => {
    const left = side === 'left';
    const chain = left ? skeleton.leftLeg : skeleton.rightLeg;
    const footScale = (left ? pose.leftFootScale : pose.rightFootScale) ?? 1;
    dressing.part(ctx, 'leg', {
      piece,
      drawn: side,
      chain,
      segments,
      skeleton,
      view,
      pose,
      footPitch: left ? pose.leftFootPitch : pose.rightFootPitch,
      footScale,
      footOut: left ? LEFT_FOOT_OUT : RIGHT_FOOT_OUT,
      envelope: (envelopeCtx) => {
        traceLegAndFoot(envelopeCtx, chain, footScale);
        const nearness = left ? pose.leftLegNearness : pose.rightLegNearness;
        const outward = left ? LEFT_FOOT_OUT : RIGHT_FOOT_OUT;
        for (const segment of LEG_COVER_SEGMENTS) {
          legCover(envelopeCtx, chain, view, outward, nearness, segment, 1, 0).addToPath();
        }
      },
    });
  };
  const leg =
    (side: 'left' | 'right', segments: LegSegments) =>
    (ctx: Ctx): void => {
      const left = side === 'left';
      drawLeg(
        ctx,
        left ? skeleton.leftLeg : skeleton.rightLeg,
        left ? pose.leftFootPitch : pose.rightFootPitch,
        view,
        left ? LEFT_FOOT_OUT : RIGHT_FOOT_OUT,
        left ? pose.leftLegNearness : pose.rightLegNearness,
        left ? pose.leftFootScale : pose.rightFootScale,
        segments,
        toesOf(side),
        (left ? pose.leftFootPoint : pose.rightFootPoint) ?? 0,
      );
      dressLeg(ctx, side, segments, 'leg');
    };
  // Whatever hangs off his back is offered a place behind everything he is,
  // and, seen from behind, a slab of its own over his back.
  const backEnvelope = (ctx: Ctx): void => traceGarmentTorso(ctx, skeleton, pose, view);
  const cloakBehind = (ctx: Ctx): void => {
    dressing.part(ctx, 'back', { piece: 'behind', skeleton, view, pose, envelope: backEnvelope });
  };
  const backFacesCamera = view.showsBack && !view.profile;
  const cloakOver: SlabPainter[] =
    backFacesCamera && dressing.paints('back')
      ? [
          (ctx) =>
            dressing.part(ctx, 'back', {
              piece: 'over',
              skeleton,
              view,
              pose,
              envelope: backEnvelope,
            }),
        ]
      : [];
  const behindArms = (ctx: Ctx): void => {
    if (leftBehind) leftArm(ctx);
    if (rightBehind) rightArm(ctx);
  };

  // Edge-on the near leg stands in front of the far one and gets a slab of
  // its own, so it casts a shadow on it.
  const frontArms = (ctx: Ctx): void => {
    if (!leftBehind) leftArm(ctx);
    if (!rightBehind) rightArm(ctx);
  };
  if (view.profile) {
    return {
      body: [
        (ctx) => {
          cloakBehind(ctx);
          behindArms(ctx);
          leg('left', 'whole')(ctx);
        },
        leg('right', 'whole'),
        ...torsoSlabs(skeleton, view, pose, attachments, dressing),
      ],
      frontArms,
      armBehind,
      armShade,
      forearm,
      nearLegSlab: PROFILE_NEAR_LEG_SLAB,
      kneeSlab: null,
      backCovered: false,
    };
  }

  // Head-on the legs share a slab, painted far one first, so a leg kicked
  // away from the camera goes behind the one he stands on instead of over it.
  // A knee driven at the camera is nearer than the shorts its thigh vanishes
  // into, so its knee, shin and foot come forward into a slab over the shorts
  // and the jacket's hem.
  const legs = (['left', 'right'] as const)
    .map((side) => ({
      side,
      depth: legDepth(side === 'left' ? skeleton.leftLeg : skeleton.rightLeg, view),
    }))
    .sort((a, b) => a.depth.nearest - b.depth.nearest);
  const kneeForward = legs.filter((l) => l.depth.knee >= KNEE_FORWARD_DEPTH);
  const chainOf = (side: 'left' | 'right'): BoneChain =>
    side === 'left' ? skeleton.leftLeg : skeleton.rightLeg;
  const underHem = kneeForward.filter((l) => thighHeldLevel(chainOf(l.side)));
  const lowerLegAtCamera = (ctx: Ctx, side: 'left' | 'right', kneeDepth: number): void => {
    leg(side, 'lower')(ctx);
    const left = side === 'left';
    paintKneeAtCamera(
      ctx,
      chainOf(side),
      view,
      left ? LEFT_FOOT_OUT : RIGHT_FOOT_OUT,
      left ? pose.leftLegNearness : pose.rightLegNearness,
      kneeDepth / THIGH_LENGTH,
    );
    dressLeg(ctx, side, 'lower', 'kneeAtCamera');
  };
  const shortsOverKnee = (ctx: Ctx, side: 'left' | 'right'): void => {
    dressing.part(ctx, 'hips', {
      piece: 'legOver',
      skeleton,
      view,
      hip: skeleton.hip,
      halfWidth: shortsHalfWidth(view),
      flare: pose.jacketFlare,
      legs: {
        left: side === 'left' ? thighSeenFromAbove(skeleton.leftLeg) : skeleton.leftLeg,
        right: side === 'right' ? thighSeenFromAbove(skeleton.rightLeg) : skeleton.rightLeg,
      },
      flutter: { left: pose.leftBoxerFlutter, right: pose.rightBoxerFlutter },
      side,
      envelope: (envelopeCtx) =>
        traceChain(envelopeCtx, side === 'left' ? skeleton.leftLeg : skeleton.rightLeg),
    });
  };
  // One slab for the knee and the cloth laid back over it: a slab of its own
  // for the cloth would cast its hem's shadow for free but costs a whole-surface
  // composite, so the hem's shadow is painted by the shorts instead.
  const kneeForwardSlab: SlabPainter[] =
    kneeForward.length === 0
      ? []
      : [
          (ctx) => {
            for (const l of kneeForward) {
              const overHem = underHem.includes(l);
              if (!overHem) {
                dressing.part(ctx, 'hips', {
                  piece: 'legEndOn',
                  skeleton,
                  view,
                  leg: chainOf(l.side),
                  towardCamera: l.depth.knee / THIGH_LENGTH,
                  flutter: l.side === 'left' ? pose.leftBoxerFlutter : pose.rightBoxerFlutter,
                  envelope: (envelopeCtx) => traceChain(envelopeCtx, chainOf(l.side)),
                });
              }
              if (overHem) {
                // The knee of a thigh held out at the camera would draw above
                // the waistband; seen from above it sits in front of the shorts'
                // leg, low, so what shows of it starts at the hem.
                ctx.save();
                ctx.beginPath();
                ctx.rect(
                  skeleton.hip.x - KNEE_CLIP_REACH,
                  skeleton.hip.y,
                  KNEE_CLIP_REACH * 2,
                  KNEE_CLIP_REACH * 2,
                );
                ctx.clip();
                lowerLegAtCamera(ctx, l.side, l.depth.knee);
                ctx.restore();
                shortsOverKnee(ctx, l.side);
              } else lowerLegAtCamera(ctx, l.side, l.depth.knee);
            }
          },
        ];
  const body: SlabPainter[] = [
    (ctx) => {
      cloakBehind(ctx);
      behindArms(ctx);
      for (const l of legs) {
        leg(l.side, l.depth.knee >= KNEE_FORWARD_DEPTH ? 'thigh' : 'whole')(ctx);
      }
    },
    ...torsoSlabs(skeleton, view, pose, attachments, dressing),
    ...cloakOver,
    ...kneeForwardSlab,
  ];
  return {
    body,
    frontArms,
    armBehind,
    armShade,
    forearm,
    nearLegSlab: null,
    kneeSlab: kneeForwardSlab.length === 0 ? null : body.length - 1,
    backCovered: cloakOver.length > 0,
  };
}

/**
 * The leg's own silhouette, thigh and shin as the rig shapes them: a leg's
 * envelope holds its flesh as well as its bones, so cloth laid over the whole
 * leg stays inside it.
 */
const LEG_COVER_SEGMENTS: readonly LegCoverSegment[] = ['thigh', 'shin'];

/** A leg's bones, and a disc round the ankle as far as its foot reaches. */
function traceLegAndFoot(ctx: Ctx, chain: BoneChain, footScale: number): void {
  traceChain(ctx, chain);
  const reach = FOOT_LEN * footScale;
  ctx.moveTo(chain.end.x + reach, chain.end.y);
  ctx.arc(chain.end.x, chain.end.y, reach, 0, TWO_PI);
}

/** A limb's bones as an open path, root to joint to end: grown by a margin, its silhouette. */
function traceChain(ctx: Ctx, chain: BoneChain): void {
  ctx.beginPath();
  ctx.moveTo(chain.root.x, chain.root.y);
  ctx.lineTo(chain.joint.x, chain.joint.y);
  ctx.lineTo(chain.end.x, chain.end.y);
}

/**
 * The jacket's pieces in paint order — its body, then its collar and the
 * collar's lit lip — with the moments a shirt shows round the collar between
 * them.
 */
function dressTorso(
  ctx: Ctx,
  skeleton: Skeleton,
  pose: CarlPose,
  view: ViewSpec,
  dressing: CarlDressing,
): void {
  const torso = torsoFrame(skeleton, pose);
  const traceCollarBand = (envelopeCtx: Ctx): void =>
    traceCollar(envelopeCtx, collarShape(torso, view, 0));
  const solved = { skeleton, view, torso };
  dressing.part(ctx, 'torso', {
    ...solved,
    piece: 'jacket',
    envelope: (envelopeCtx) => traceGarmentTorso(envelopeCtx, skeleton, pose, view),
  });
  dressing.part(ctx, 'neck', { ...solved, piece: 'shirtUnder', envelope: traceCollarBand });
  dressing.part(ctx, 'torso', { ...solved, piece: 'collar', envelope: traceCollarBand });
  dressing.part(ctx, 'neck', { ...solved, piece: 'shirtLip', envelope: traceCollarBand });
  dressing.part(ctx, 'torso', { ...solved, piece: 'collarRim', envelope: null });
}

/** The boxers' slab, then the neck, jacket and head in one. */
function torsoSlabs(
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  attachments: CarlAttachments | undefined,
  dressing: CarlDressing,
): SlabPainter[] {
  return [
    (ctx) => {
      const hip = skeleton.hip;
      const halfWidth = shortsHalfWidth(view);
      const flare = pose.jacketFlare;
      const legs: CarlLegPair = { left: skeleton.leftLeg, right: skeleton.rightLeg };
      const flutter: CarlShortsFlutter = {
        left: pose.leftBoxerFlutter,
        right: pose.rightBoxerFlutter,
      };
      dressing.part(ctx, 'hips', {
        piece: 'shorts',
        skeleton,
        view,
        hip,
        halfWidth,
        flare,
        legs,
        flutter,
        envelope: (envelopeCtx) =>
          traceShortsOutline(envelopeCtx, hip, halfWidth, flare, view, legs, flutter),
      });
      attachments?.overLegs?.(ctx, skeleton, view, pose);
    },
    // The head shares the jacket's slab: it paints its own shadow under the
    // jaw, which is the only place it overlaps anything. A torso pitched far
    // enough away from the camera carries the head down behind the top of his
    // back, so the jacket is painted over it.
    (ctx) => {
      const head = (): void => {
        ctx.save();
        ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
        ctx.rotate(headAngle(pose));
        drawHead(ctx, pose, view, { hair: !dressing.hides('hair') });
        dressing.part(ctx, 'head', {
          piece: 'top',
          view,
          pose,
          envelope: (envelopeCtx) => traceSkull(envelopeCtx, view),
        });
        ctx.restore();
      };
      const headBehindBack = torsoPitchedAway(pose, view);
      drawNeck(ctx, skeleton, pose, view);
      if (headBehindBack) head();
      dressTorso(ctx, skeleton, pose, view, dressing);
      if (!headBehindBack) head();
    },
  ];
}

/**
 * Past this pitch away from the camera, in radians, the top of his back rises
 * over the base of his skull: a man bent forward, seen from behind, shows the
 * crown of his head over his shoulders and not his neck.
 */
const HEAD_BEHIND_BACK_PITCH = 0.45;

function torsoPitchedAway(pose: CarlPose, view: ViewSpec): boolean {
  if (view.profile) return false;
  return (pose.torsoPitch ?? 0) * aheadScreenSign(view) <= -HEAD_BEHIND_BACK_PITCH;
}

/**
 * A planted foot presses a small, dark patch of floor of its own. The body's
 * shadow is one soft pool under his hips, and on its own it leaves a foot at
 * the edge of it — the rear foot of a head-on stance, either foot of a wide
 * one — looking lifted off a floor it is standing on.
 */
const FOOT_CONTACT_ALPHA = 0.6;
/**
 * The patch runs well past the sole at each end and sits a little below it:
 * the foot and its outline cover the middle, so only the rim that shows round
 * them says the foot is pressing the floor.
 */
const FOOT_CONTACT_REACH = 1.3;
/**
 * Head-on a foot is drawn short and wide, so its sole's length says nothing
 * about how wide a patch it presses; this is the patch's narrowest half-width.
 */
const FOOT_CONTACT_MIN_HALF_WIDTH = 0.13;
const FOOT_CONTACT_DEPTH = 0.06;
const FOOT_CONTACT_DROP = 0.03;
/** Solid across most of the patch, so the thin rim that shows past the foot is dark. */
const FOOT_CONTACT_CORE = 0.6;
/**
 * A foot whose pose does not say whether it is planted counts as planted while
 * it is this close to the floor, in tile units: a standing row's feet sit on it
 * exactly, and a raised one is well clear.
 */
const ON_FLOOR_LIFT = 0.01;

function footPlanted(planted: boolean | undefined, foot: Pt): boolean {
  return planted ?? -foot.y <= ON_FLOOR_LIFT;
}

/** The floor contact of each planted foot, in figure space. */
function plantedFootContacts(skeleton: Skeleton, view: ViewSpec, pose: CarlPose) {
  const feet = [
    {
      planted: footPlanted(pose.leftFootPlanted, pose.leftFoot),
      ankle: skeleton.leftLeg.end,
      outward: LEFT_FOOT_OUT,
      scale: pose.leftFootScale ?? 1,
    },
    {
      planted: footPlanted(pose.rightFootPlanted, pose.rightFoot),
      ankle: skeleton.rightLeg.end,
      outward: RIGHT_FOOT_OUT,
      scale: pose.rightFootScale ?? 1,
    },
  ];
  return feet
    .filter((foot) => foot.planted)
    .map((foot) => footContact(foot.ankle, view, foot.outward, foot.scale));
}

function drawFootContacts(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  for (const contact of plantedFootContacts(skeleton, view, pose)) {
    fillSoftEllipse(
      ctx,
      contact.centre.x,
      contact.centre.y + FOOT_CONTACT_DROP,
      Math.max(contact.halfLength * FOOT_CONTACT_REACH, FOOT_CONTACT_MIN_HALF_WIDTH),
      FOOT_CONTACT_DEPTH,
      OUTLINE,
      FOOT_CONTACT_ALPHA,
      0,
      FOOT_CONTACT_CORE,
    );
  }
}

/**
 * A planted sole presses the floor, so no floor light bounces up under it:
 * the bounce rim is cleared from this far above each planted foot's contact
 * down, in tile units. Left on, a pale line runs along the bottom of the foot
 * and reads as the foam edge of a flip-flop.
 */
const SOLE_RIM_CLEAR_RISE = 0.05;
const SOLE_RIM_CLEAR_REACH = 1.6;
const SOLE_RIM_CLEAR_DEPTH = 0.2;

function clearSoleRims(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, pose: CarlPose): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = OUTLINE;
  for (const contact of plantedFootContacts(skeleton, view, pose)) {
    const halfWidth =
      Math.max(contact.halfLength, FOOT_CONTACT_MIN_HALF_WIDTH) * SOLE_RIM_CLEAR_REACH;
    ctx.fillRect(
      contact.centre.x - halfWidth,
      contact.centre.y - SOLE_RIM_CLEAR_RISE,
      halfWidth * 2,
      SOLE_RIM_CLEAR_DEPTH,
    );
  }
  ctx.restore();
}

/**
 * The Protective Shell's violet, so the glow in his palm is the dome's own
 * light before the dome appears: a pale core fading to the shell's deep rim.
 */
const PALM_GLOW_CORE = '#e4dcff';
const PALM_GLOW_RIM = '#7c3aed';
/** How far the glow spreads from the palm, in tile units: a little past the hand. */
const PALM_GLOW_RADIUS = 0.22;
/** Where the palm sits down the hand from the wrist, as a share of the hand's length. */
const PALM_AT = 0.45;
/** Where the glow turns from core to rim, as a share of its radius. */
const PALM_GLOW_CORE_SHARE = 0.25;
const PALM_GLOW_RIM_ALPHA = 0.45;
/** Fainter than this the glow changes no pixel, and its colour stops risk exponent notation. */
const MIN_PALM_GLOW = 0.02;

/** Where the pose's palm glow is centred, or null when it paints nothing. */
function palmGlowCentre(skeleton: Skeleton, pose: CarlPose, glow: PalmGlow): Pt | null {
  const left = glow.hand === 'left';
  const shape = left ? pose.leftHandShape : pose.rightHandShape;
  if (shape === 'grip') return null;
  if (clamp01(glow.strength) < MIN_PALM_GLOW) return null;
  const chain = left ? skeleton.leftArm : skeleton.rightArm;
  const fist = left ? pose.leftFist : pose.rightFist;
  const dx = chain.end.x - chain.joint.x;
  const dy = chain.end.y - chain.joint.y;
  const reach = Math.hypot(dx, dy);
  const along = reach > 0 ? (handLength(fist, shape) * PALM_AT) / reach : 0;
  return { x: chain.end.x + dx * along, y: chain.end.y + dy * along };
}

function drawPalmGlow(ctx: Ctx, skeleton: Skeleton, pose: CarlPose, glow: PalmGlow): void {
  const palm = palmGlowCentre(skeleton, pose, glow);
  if (palm === null) return;
  const strength = clamp01(glow.strength);
  const gradient = ctx.createRadialGradient(palm.x, palm.y, 0, palm.x, palm.y, PALM_GLOW_RADIUS);
  gradient.addColorStop(0, rgba(PALM_GLOW_CORE, strength));
  gradient.addColorStop(PALM_GLOW_CORE_SHARE, rgba(PALM_GLOW_RIM, strength * PALM_GLOW_RIM_ALPHA));
  gradient.addColorStop(1, rgba(PALM_GLOW_RIM, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(palm.x, palm.y, PALM_GLOW_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * A thing held in one or both hands, as the composition handles it: the slab
 * it sits directly in front of, the hands closed on it, and — for a row's own
 * prop — how to paint it into the cell.
 */
interface ComposedItem {
  readonly layer: number;
  readonly hands: readonly SolvedHand[];
  /** Paints its silhouette's share, for the outline; a row's prop is its own stand-in. */
  readonly standIn: SlabPainter;
  /** Paints a row's prop between the layers; absent for an equipment-chosen item. */
  readonly bake?: SlabPainter;
  /** Everything of him in front of it: built as the slabs are laid. */
  readonly mask: Layer;
}

/**
 * How far an equipment-chosen item's handle is stood in for along its axis,
 * each way from the grip, against the hand's width: enough to carry the
 * outline past the fingers onto the handle on both sides, so no outline is
 * drawn across a handle where it leaves the fist.
 */
const STAND_IN_REACH_SHARE = 1;

/** The handle near a fist, as the silhouette counts it while the item itself is unknown. */
function handleStandIn(hand: SolvedHand): SlabPainter {
  return (ctx) => {
    const reach = GRIP_STAND_IN_REACH;
    const along = { x: hand.axis.x * reach, y: hand.axis.y * reach };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = hand.handleRadius * 2;
    ctx.beginPath();
    ctx.moveTo(hand.centre.x - along.x, hand.centre.y - along.y);
    ctx.lineTo(hand.centre.x + along.x, hand.centre.y + along.y);
    ctx.stroke();
    ctx.restore();
  };
}

const GRIP_STAND_IN_REACH = GRIP_HAND_WIDTH * STAND_IN_REACH_SHARE;

/** A row's prop as the compositor draws it: its held visual, and the transform from its hand's socket. */
export interface CarlPropDraw {
  readonly def: HeldVisualDef;
  readonly transform: HeldVisualTransform;
}

function propDraw(
  hand: SolvedHand,
  prop: HeldProp,
  view: ViewSpec,
  shaded: boolean,
  chain: BoneChain,
): CarlPropDraw {
  const visual = scriptedPropVisual(prop);
  const painterHaftAngle = handGrip(chain).haftAngle + (prop.angle ?? 0);
  const transform = heldTransformAt({ ...hand, shaded }, 1, 0, {
    view,
    prop,
    painterHaftAngle,
    gripCentre: hand.centre,
  });
  return { def: visual.def, transform };
}

/** A row's prop, painted at its hand's socket by the one compositor every held item goes through. */
function propPainter(
  hand: SolvedHand,
  prop: HeldProp,
  view: ViewSpec,
  shaded: boolean,
  chain: BoneChain,
): SlabPainter {
  const { def, transform } = propDraw(hand, prop, view, shaded, chain);
  return (ctx) => compositeHeldItem(ctx, def, transform, 'painted');
}

/**
 * The row's own props on a pose, each as the compositor draws it, in figure
 * units: what a cell bakes between its layers, for a gate that composites
 * them itself.
 */
export function carlPropDraws(
  authored: CarlPose,
  view: ViewSpec,
  options: CarlComposeOptions = {},
): CarlPropDraw[] {
  const pose = poseAsDrawn(authored, view);
  const skeleton = buildSkeleton(pose, view);
  const dressing = options.dressing?.(pose, view) ?? carlDressingFor(pose, view);
  const hands = solveHands(pose, skeleton, options.itemHandle ?? DEFAULT_ITEM_HANDLE);
  const slabs = figureSlabs(skeleton, view, pose, options.attachments, hands, dressing);
  const draws: CarlPropDraw[] = [];
  for (const hand of [hands.left, hands.right]) {
    const prop = hand.prop;
    if (hand.occupant !== 'prop' || prop === undefined) continue;
    const shaded = slabs.armShade[hand.drawnSide] > 0;
    draws.push(propDraw(hand, prop, view, shaded, chainOfDrawn(skeleton, hand.drawnSide)));
  }
  return draws;
}

function chainOfDrawn(skeleton: Skeleton, side: BodySide): BoneChain {
  return side === 'left' ? skeleton.leftArm : skeleton.rightArm;
}

/** The slab index a drawn arm is painted in. */
function armLayer(slabs: FigureSlabs, side: BodySide): number {
  return slabs.armBehind[side] ? 0 : slabs.body.length;
}

/**
 * The slab a held thing sits directly in front of: the slab of the arm whose
 * hand holds it, or, on a two-handed haft, of the hand further up it, toward
 * the head — in profile with the far fist at the butt, the near arm, so the
 * haft lies over him.
 */
function heldLayerOf(hands: SolvedHands, slabs: FigureSlabs, hand: SolvedHand): number {
  const butt = hands.twoHandButt;
  if (butt === undefined) return armLayer(slabs, hand.drawnSide);
  return armLayer(slabs, butt === 'left' ? 'right' : 'left');
}

/** One of his hands as the composition puts a held thing in it, by the drawn pose's side. */
export interface CarlHandSocket extends SolvedHand {
  /** The slab the thing it holds sits directly in front of, 0 the rearmost. */
  readonly layer: number;
  /** Painted in the body's shade, as an arm behind him in profile is. */
  readonly shaded: boolean;
  /** Its arm is painted behind his torso. */
  readonly behind: boolean;
}

/** Both hands of a drawn pose as sockets, and on a two-handed haft the drawn side at its butt. */
export interface CarlHandSockets {
  readonly left: CarlHandSocket;
  readonly right: CarlHandSocket;
  readonly twoHandButt?: BodySide;
  /** The slab index of the arms laid in front of everything else: one past the body's last. */
  readonly frontLayer: number;
  /** Whether a garment hangs over his back in this view, covering whatever is stowed there. */
  readonly backCovered: boolean;
}

/**
 * His hands on one pose in one view, solved exactly as the painter solves
 * them when it composes him — the same skeleton, the same slabs — so a socket
 * can never disagree with the cell it describes.
 */
export function carlHandSockets(
  authored: CarlPose,
  view: ViewSpec,
  options: CarlComposeOptions = {},
): CarlHandSockets {
  const pose = poseAsDrawn(authored, view);
  const skeleton = buildSkeleton(pose, view);
  const dressing = options.dressing?.(pose, view) ?? carlDressingFor(pose, view);
  const hands = solveHands(pose, skeleton, options.itemHandle ?? DEFAULT_ITEM_HANDLE);
  const slabs = figureSlabs(skeleton, view, pose, options.attachments, hands, dressing);
  const socket = (hand: SolvedHand): CarlHandSocket => ({
    ...hand,
    layer: heldLayerOf(hands, slabs, hand),
    shaded: slabs.armShade[hand.drawnSide] > 0,
    behind: slabs.armBehind[hand.drawnSide],
  });
  return {
    left: socket(hands.left),
    right: socket(hands.right),
    frontLayer: slabs.body.length,
    backCovered: slabs.backCovered,
    ...(hands.twoHandButt === undefined ? {} : { twoHandButt: hands.twoHandButt }),
  };
}

/**
 * Every held thing the composition has to put between his layers, deepest
 * first. A two-handed haft sits with the hand further up it, toward the
 * head: in profile with the far fist at the butt, that is the near arm, and
 * the haft lies over him.
 */
function composedItems(
  hands: SolvedHands,
  slabs: FigureSlabs,
  skeleton: Skeleton,
  view: ViewSpec,
  bounds: LayerBounds,
  deferProps: boolean,
): ComposedItem[] {
  const items: ComposedItem[] = [];
  const both = [hands.left, hands.right];
  const butt = hands.twoHandButt;
  if (butt !== undefined && both.every((hand) => hand.occupant === 'item')) {
    items.push({
      layer: heldLayerOf(hands, slabs, hands.left),
      hands: both,
      standIn: (ctx) => both.forEach((hand) => handleStandIn(hand)(ctx)),
      mask: makeLayer(bounds),
    });
  } else {
    for (const hand of both) {
      if (hand.occupant === 'empty') continue;
      const layer = heldLayerOf(hands, slabs, hand);
      const prop = hand.prop;
      if (hand.occupant === 'prop' && prop !== undefined) {
        const paint = propPainter(
          hand,
          prop,
          view,
          slabs.armShade[hand.drawnSide] > 0,
          chainOfDrawn(skeleton, hand.drawnSide),
        );
        items.push({
          layer,
          hands: [hand],
          standIn: paint,
          ...(deferProps ? {} : { bake: paint }),
          mask: makeLayer(bounds),
        });
        continue;
      }
      items.push({ layer, hands: [hand], standIn: handleStandIn(hand), mask: makeLayer(bounds) });
    }
  }
  return items.sort((a, b) => a.layer - b.layer);
}

/** Lays one slab's part into every item mask it stands in front of. */
function maskInFront(items: readonly ComposedItem[], part: Layer, index: number): void {
  for (const item of items) if (index > item.layer) item.mask.ctx.drawImage(part.surface, 0, 0);
}

function drawFigure(
  ctx: Ctx,
  view: ViewSpec,
  authored: CarlPose,
  options: CarlComposeOptions,
): void {
  const pose = poseAsDrawn(authored, view);
  const skeleton = buildSkeleton(pose, view);
  const dressing = options.dressing?.(pose, view) ?? carlDressingFor(pose, view);
  // The lower foot decides it: a runner always has one foot high in the air,
  // and his shadow only shrinks when the other has left the floor too.
  const lift = Math.max(0, -Math.max(pose.leftFoot.y, pose.rightFoot.y));
  const shadowFade = clamp01(1 - lift * SHADOW_LIFT_FADE);
  drawGroundShadow(
    ctx,
    skeleton.hip.x * SHADOW_FOLLOW,
    SHADOW_RX * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    SHADOW_RY * lerp(SHADOW_LIFT_SHRINK, 1, shadowFade),
    CONTACT_SHADOW_ALPHA * shadowFade,
  );
  drawFootContacts(ctx, skeleton, view, pose);

  const bodyReach = [...skeletonExtents(skeleton), ...paintedExtents(skeleton, view, pose)];
  const bounds = layerBounds(ctx, [
    { points: bodyReach, margin: options.layerMargin ?? LAYER_MARGIN },
    { points: dressing.reach(skeleton, view), margin: options.layerMargin ?? GEAR_INK_MARGIN },
    {
      points: options.attachments?.reach(skeleton, view, pose) ?? [],
      margin: options.layerMargin ?? GEAR_INK_MARGIN,
    },
  ]);
  const offsets = layerOffsets(bounds);
  const body = makeLayer(bounds);
  const part = makeLayer(bounds);
  const scratch = makeLayer(bounds);

  const hands = solveHands(pose, skeleton, options.itemHandle ?? DEFAULT_ITEM_HANDLE);
  const slabs = figureSlabs(skeleton, view, pose, options.attachments, hands, dressing);
  const items = composedItems(hands, slabs, skeleton, view, bounds, options.deferProps === true);
  slabs.body.forEach((paintSlab, index) => {
    if (index === 0) {
      inFigureSpace(body, bounds, paintSlab);
      return;
    }
    clear(part);
    inFigureSpace(part, bounds, paintSlab);
    maskInFront(items, part, index);
    if (index === slabs.nearLegSlab) {
      occludeCarl(body, part, scratch, offsets, OCCLUSION_ALPHA_NEAR_LEG);
    }
    if (index === slabs.kneeSlab) {
      occludeCarl(body, part, scratch, offsets, OCCLUSION_ALPHA_KNEE);
      castFar(body, part, scratch, offsets);
    }
    carlSlab(body, part, scratch, offsets);
  });
  clear(part);
  inFigureSpace(part, bounds, slabs.frontArms);
  maskInFront(items, part, slabs.body.length);
  occludeCarl(
    body,
    part,
    scratch,
    offsets,
    view.profile ? OCCLUSION_ALPHA_EDGE_ON : OCCLUSION_ALPHA_HEAD_ON,
  );
  carlSlab(body, part, scratch, offsets);

  if (items.length > 0) {
    finishHolding(
      ctx,
      { slabs, view, skeleton, pose, dressing, bounds, offsets, body, part, scratch },
      items,
      options,
    );
    return;
  }

  lightShadowRim(body, scratch, offsets, (layer) =>
    inFigureSpace(layer, bounds, (layerCtx) => clearSoleRims(layerCtx, skeleton, view, pose)),
  );
  // The outline is built on the part surface, which is free once every slab is laid.
  const finished = options.silhouetteOutline === false ? body : part;
  // Head-on the arms hang a pixel or two off the jacket's and the shorts'
  // sides, so that outline closes its gaps; edge-on the near arm lies over the
  // body instead, and its contact shadow parts it.
  if (finished === part) {
    outlineInto(
      part,
      body,
      scratch,
      offsets.outline,
      SILHOUETTE_OUTLINE,
      rgba(SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA),
      !view.profile,
    );
  }
  paintOverFinished(finished, bounds, skeleton, view, pose, dressing);
  blitLayer(ctx, finished, bounds);
}

/**
 * The palm glow, and anything worn on a forearm that drifts past his
 * silhouette, laid over the finished, outlined figure.
 */
function paintOverFinished(
  finished: Layer,
  bounds: LayerBounds,
  skeleton: Skeleton,
  view: ViewSpec,
  pose: CarlPose,
  dressing: CarlDressing,
): void {
  if (pose.palmGlow) {
    const glow = pose.palmGlow;
    inFigureSpace(finished, bounds, (layer) => drawPalmGlow(layer, skeleton, pose, glow));
  }
  if (dressing.paints('forearm')) {
    inFigureSpace(finished, bounds, (layer) =>
      dressing.part(layer, 'forearm', {
        piece: 'overFinished',
        skeleton,
        view,
        pose,
        envelope: null,
      }),
    );
  }
}

/** The composing surfaces and the solved figure, handed on to finish a figure that holds something. */
interface Composition {
  readonly slabs: FigureSlabs;
  readonly view: ViewSpec;
  readonly skeleton: Skeleton;
  readonly pose: CarlPose;
  readonly dressing: CarlDressing;
  readonly bounds: LayerBounds;
  readonly offsets: LayerOffsets;
  readonly body: Layer;
  readonly part: Layer;
  readonly scratch: Layer;
}

/**
 * Finishes a figure holding something. The outline and the rim are built on
 * the whole silhouette — his body and what stands in for each held thing — so
 * a held thing sits inside his outline instead of on it, and no outline is
 * drawn across a handle where it leaves a fist. Each outline pixel then goes
 * to the layer that owns it: one round a held thing's stand-in alone is
 * dropped, unless the thing is a row's own prop, which keeps the outline the
 * figure gives it. A row's props are painted between the layers here, deepest
 * first, each followed by whatever of him lies in front of it; what lies in
 * front of an equipment-chosen item goes to `options.front`.
 */
function finishHolding(
  ctx: Ctx,
  composition: Composition,
  items: readonly ComposedItem[],
  options: CarlComposeOptions,
): void {
  const { slabs, view, skeleton, pose, dressing, bounds, offsets, body, part, scratch } =
    composition;
  const standIns = makeLayer(bounds);
  const keepsRing = makeLayer(bounds);
  keepsRing.ctx.drawImage(body.surface, 0, 0);
  for (const item of items) {
    inFigureSpace(standIns, bounds, item.standIn);
    const rowsOwnProp = item.hands.every((hand) => hand.occupant === 'prop');
    if (rowsOwnProp) inFigureSpace(keepsRing, bounds, item.standIn);
    for (const hand of item.hands) {
      const wrap = hand.wrap;
      if (wrap === undefined) continue;
      const chain = chainOfDrawn(skeleton, hand.drawnSide);
      // The handle lies on the palm's side of the forearm, so with the back
      // of the hand to the camera the forearm is in front of it.
      const forearmInFront = wrap.palmInFront && armLayer(slabs, hand.drawnSide) === item.layer;
      inFigureSpace(item.mask, bounds, (maskCtx) => {
        if (forearmInFront) slabs.forearm[hand.drawnSide](maskCtx);
        drawGripHand(maskCtx, chain, wrap, UNSHADED, 'front');
      });
    }
  }

  lightShadowRim(
    body,
    scratch,
    offsets,
    (layer) =>
      inFigureSpace(layer, bounds, (layerCtx) => clearSoleRims(layerCtx, skeleton, view, pose)),
    standIns,
  );

  const silhouette = makeLayer(bounds);
  silhouette.ctx.drawImage(body.surface, 0, 0);
  silhouette.ctx.drawImage(standIns.surface, 0, 0);
  const ring = part;
  const outlined = options.silhouetteOutline !== false;
  clear(ring);
  if (outlined) {
    outlineInto(
      ring,
      silhouette,
      scratch,
      offsets.outline,
      SILHOUETTE_OUTLINE,
      rgba(SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA),
      !view.profile,
    );
    eraseWith(ring, silhouette);
    dilateInto(scratch, keepsRing, offsets.outline);
    keepWithin(ring, scratch);
  }

  const whole = silhouette;
  clear(whole);
  whole.ctx.drawImage(ring.surface, 0, 0);
  whole.ctx.drawImage(body.surface, 0, 0);
  paintOverFinished(whole, bounds, skeleton, view, pose, dressing);

  for (const item of items) {
    dilateInto(scratch, item.mask, offsets.outline);
    keepWithin(scratch, ring);
    item.mask.ctx.drawImage(scratch.surface, 0, 0);
  }

  const out = keepsRing;
  clear(out);
  out.ctx.drawImage(whole.surface, 0, 0);
  const runtimeMask = standIns;
  clear(runtimeMask);
  for (const item of items) {
    const bake = item.bake;
    if (bake === undefined) {
      runtimeMask.ctx.drawImage(item.mask.surface, 0, 0);
      continue;
    }
    inFigureSpace(out, bounds, bake);
    maskedCopy(scratch, whole, item.mask);
    out.ctx.drawImage(scratch.surface, 0, 0);
  }
  blitLayer(ctx, out, bounds);
  const front = options.front;
  if (front === undefined) return;
  maskedCopy(scratch, out, runtimeMask);
  blitLayer(front, scratch, bounds);
}
/** Carl seen head-on, walking toward the camera. */
export function drawCarlFront(ctx: Ctx, pose: CarlPose, options: CarlComposeOptions = {}): void {
  drawFigure(ctx, VIEWS.front, pose, options);
}

/** Carl seen from behind, walking away. */
export function drawCarlBack(ctx: Ctx, pose: CarlPose, options: CarlComposeOptions = {}): void {
  drawFigure(ctx, VIEWS.back, pose, options);
}

/** Carl in profile. Always drawn facing +X; the runtime mirrors for the left. */
export function drawCarlSide(ctx: Ctx, pose: CarlPose, options: CarlComposeOptions = {}): void {
  drawFigure(ctx, VIEWS.side, pose, options);
}
