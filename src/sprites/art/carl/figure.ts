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

import { drawShorts, drawShortsLegEndOn, drawShortsLegOver } from './boxers';
import { footContact, LEFT_FOOT_OUT, RIGHT_FOOT_OUT } from './feet';
import {
  cloakInFront,
  drawCloak,
  drawGauntlet,
  drawGauntletSmoke,
  footAccents,
  gauntletSmokes,
  gearOf,
  gearReach,
} from './gear';
import { drawHead, drawNeck, headAngle } from './head';
import {
  drawArm,
  drawLeg,
  handGrip,
  handLength,
  type LegSegments,
  paintKneeAtCamera,
  UNSHADED,
} from './limbs';
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
import { type HeldProp, PROP_ART } from './props';
import { HEAD_RX, HEAD_RY, HIP_HALF, THIGH_LENGTH } from './proportions';
import {
  aheadScreenSign,
  buildSkeleton,
  poseAsDrawn,
  type BoneChain,
  type CarlPose,
  type HandShape,
  type PalmGlow,
  type Skeleton,
  VIEWS,
  type ViewSpec,
} from './rig';
import { drawJacket } from './torso';
import { clamp01, lerp, type Pt, rgba } from '../carlArt';
import { fillSoftEllipse } from '../softShade';
import { allocCanvas, type CanvasSurface, surfaceContext } from '../../../core/canvasSurface';
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

/**
 * The composing surface has one scratch pixel per pixel of the surface the
 * figure is finally painted into, whatever density that is. The frame cache
 * sets that density — the cell's own pixels on a full bake, half of them on a
 * low-end display's — and composing at any other density only resamples the
 * finished figure once more on the way in: finer, and the cell is a blurred
 * downsample of it; coarser, and a blurred upsample.
 *
 * Reading the density off the transform is not reading caller state: it is
 * the scale the figure is being painted at, which a painter drawing straight
 * into its context honours by construction. The composing surface honours it
 * the same way, and every effect below is sized in cell pixels and turned into
 * scratch pixels by it, so the output is the same figure at any density.
 */
const DEGENERATE_DENSITY = 1e-3;

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

/** The figure-space rectangle the composing surface covers, and its density. */
interface LayerBounds {
  readonly minX: number;
  readonly minY: number;
  /** In scratch pixels. */
  readonly width: number;
  readonly height: number;
  /** Scratch pixels per figure unit. */
  readonly pxPerUnit: number;
}

/**
 * Options for composing the figure. Only a gate passes any: the shipped
 * figure is always composed with the defaults.
 */
export interface CarlComposeOptions {
  /** Replaces {@link LAYER_MARGIN}, in figure units. */
  readonly layerMargin?: number;
  /** False leaves the silhouette outline off, so a gate can tell its ink from the parts'. */
  readonly silhouetteOutline?: boolean;
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * The surface round `extents`, at the density `ctx` is painting at.
 *
 * The surface's pixel grid is laid on the target's own: its origin is snapped
 * to a whole target pixel. Left fractional, it slides a sub-pixel with every
 * hand that moves, every edge of the figure is rasterised a little
 * differently, and a standing idle shimmers from frame to frame.
 */
function layerBounds(ctx: Ctx, reaches: readonly InkReach[]): LayerBounds {
  const transform = ctx.getTransform();
  const pxPerUnit = Math.max(Math.hypot(transform.a, transform.b), DEGENERATE_DENSITY);
  const gridX = fraction(transform.e);
  const gridY = fraction(transform.f);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { points, margin } of reaches) {
    for (const p of points) {
      left = Math.min(left, p.x - margin);
      top = Math.min(top, p.y - margin);
      right = Math.max(right, p.x + margin);
      bottom = Math.max(bottom, p.y + margin);
    }
  }
  const snap = (value: number, grid: number): number =>
    (Math.floor(value * pxPerUnit + grid) - grid) / pxPerUnit;
  const minX = snap(left, gridX);
  const minY = snap(top, gridY);
  const width = Math.ceil((right - minX) * pxPerUnit);
  const height = Math.ceil((bottom - minY) * pxPerUnit);
  return { minX, minY, width, height, pxPerUnit };
}

/** Points a figure's ink reaches toward, and how far past them it can still run. */
interface InkReach {
  readonly points: readonly Pt[];
  readonly margin: number;
}

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
 * Worn gear standing off the body states its own reach through `gearReach`,
 * with its own margin; anything else painted clear of the body adds its
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
    extents.push(...PROP_ART[prop.kind].reach(handGrip(chain), prop, view));
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

/** How many cell pixels one scratch pixel of `bounds` is. */
function scratchPx(bounds: LayerBounds, cellPx: number): number {
  return Math.max(1, Math.round((cellPx * bounds.pxPerUnit) / HUMAN_CELL_PX_PER_UNIT));
}

/** The direction a shadow falls in: straight away from the key light. */
const SHADOW_FALL: Pt = { x: -LIGHT.x, y: -LIGHT.y };

/**
 * `SHADOW_FALL` scaled to `distance` scratch pixels and snapped to whole ones.
 * Every layer-to-layer blit here lands on the pixel grid: a fractional offset
 * makes the rasteriser resample the whole surface, which in node-canvas cost
 * several times the rest of the painter put together.
 */
function fallBy(distance: number): Pt {
  return { x: Math.round(SHADOW_FALL.x * distance), y: Math.round(SHADOW_FALL.y * distance) };
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
  const outlinePx = scratchPx(bounds, OUTLINE_PX);
  const occlusionPx = scratchPx(bounds, OCCLUSION_PX);
  return {
    cast: fallBy(scratchPx(bounds, CAST_DROP_PX)),
    farCast: fallBy(scratchPx(bounds, KNEE_CAST_DROP_PX)),
    rim: fallBy(scratchPx(bounds, RIM_PX)),
    outline: Array.from({ length: OUTLINE_SAMPLES }, (_unused, i) => {
      const angle = (i / OUTLINE_SAMPLES) * TWO_PI;
      return {
        x: Math.round(Math.cos(angle) * outlinePx),
        y: Math.round(Math.sin(angle) * outlinePx),
      };
    }),
    occlusion: [
      { x: occlusionPx, y: 0 },
      { x: -occlusionPx, y: 0 },
      { x: 0, y: occlusionPx },
      { x: 0, y: -occlusionPx },
    ],
  };
}

interface Layer {
  readonly surface: CanvasSurface;
  readonly ctx: Ctx;
}

function makeLayer(bounds: LayerBounds): Layer {
  const surface = allocCanvas(bounds.width, bounds.height);
  return { surface, ctx: surfaceContext(surface) };
}

/** Runs `paint` on a layer in figure units, leaving the layer's own state as it found it. */
function inFigureSpace(layer: Layer, bounds: LayerBounds, paint: (ctx: Ctx) => void): void {
  const { ctx } = layer;
  ctx.save();
  try {
    ctx.scale(bounds.pxPerUnit, bounds.pxPerUnit);
    ctx.translate(-bounds.minX, -bounds.minY);
    paint(ctx);
  } finally {
    ctx.restore();
  }
}

/** Replaces every pixel's colour with `colour`, multiplying its alpha by the colour's own. */
function tint(layer: Layer, colour: string): void {
  const { ctx, surface } = layer;
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.restore();
}

function clear(layer: Layer): void {
  layer.ctx.clearRect(0, 0, layer.surface.width, layer.surface.height);
}

/**
 * Draws `source` onto `target` only where `target` already has ink.
 *
 * Any fade belongs in `source`'s own alpha (see {@link tint}), not in
 * `globalAlpha`: a masked composite under a global alpha takes node-canvas's
 * slow path and cost more than the whole rest of the figure.
 */
function drawAtop(target: Layer, source: Layer, dx: number, dy: number): void {
  const { ctx } = target;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(source.surface, dx, dy);
  ctx.restore();
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
function laySlab(body: Layer, part: Layer, scratch: Layer, offsets: LayerOffsets): void {
  clear(scratch);
  scratch.ctx.drawImage(part.surface, 0, 0);
  tint(scratch, rgba(CAST_SHADOW_TONE, CAST_SHADOW_ALPHA));
  drawAtop(body, scratch, offsets.cast.x, offsets.cast.y);
  body.ctx.drawImage(part.surface, 0, 0);
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
function occludeAround(
  body: Layer,
  part: Layer,
  scratch: Layer,
  offsets: LayerOffsets,
  alpha: number,
): void {
  clear(scratch);
  for (const offset of offsets.occlusion) scratch.ctx.drawImage(part.surface, offset.x, offset.y);
  tint(scratch, rgba(CAST_SHADOW_TONE, alpha));
  drawAtop(body, scratch, 0, 0);
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
 * direction is empty.
 */
function lightShadowRim(
  body: Layer,
  scratch: Layer,
  offsets: LayerOffsets,
  clearRim: (layer: Layer) => void,
): void {
  clear(scratch);
  const { ctx } = scratch;
  ctx.drawImage(body.surface, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(body.surface, -offsets.rim.x, -offsets.rim.y);
  ctx.restore();
  tint(scratch, rgba(RIM_LIGHT, RIM_ALPHA));
  clearRim(scratch);
  drawAtop(body, scratch, 0, 0);
}

/**
 * Builds the finished figure with its outline into `out`: the silhouette
 * dilated by {@link OUTLINE_PX}, tinted and faded to the outline's alpha, with
 * the figure laid over it so only the outside ring shows.
 *
 * Head-on (`closeGaps`) the ring is the dilation minus its own erosion back by
 * the same amount — the silhouette *closed* — rather than minus the silhouette
 * itself. There the arms hang a pixel or two off the jacket's and the shorts'
 * sides, and the plain difference fills that sliver with outline: the very ink
 * line between arm and body the outline must never draw. Closed, the sliver
 * stays open to the floor. Edge-on the near arm lies over the body instead,
 * and its contact shadow parts it. `scratch` is free to reuse afterwards.
 */
function outlineInto(
  out: Layer,
  body: Layer,
  scratch: Layer,
  offsets: LayerOffsets,
  closeGaps: boolean,
): void {
  clear(out);
  const { ctx } = out;
  for (const offset of offsets.outline) ctx.drawImage(body.surface, offset.x, offset.y);

  if (closeGaps) {
    clear(scratch);
    const closed = scratch.ctx;
    closed.drawImage(out.surface, 0, 0);
    closed.save();
    closed.globalCompositeOperation = 'destination-in';
    for (const offset of offsets.outline) closed.drawImage(out.surface, -offset.x, -offset.y);
    closed.restore();
  }

  tint(out, SILHOUETTE_OUTLINE);
  ctx.save();
  if (closeGaps) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(scratch.surface, 0, 0);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = rgba(SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA);
  ctx.fillRect(0, 0, out.surface.width, out.surface.height);
  ctx.restore();
  ctx.drawImage(body.surface, 0, 0);
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
 * Paints whichever `HeldProp` the pose has given `hand`, at that hand's grip.
 * Called before the arm itself, so the fist's fingers close over the haft on
 * top of the prop rather than the prop lying over a finished hand.
 */
function drawHeldProp(
  ctx: Ctx,
  pose: CarlPose,
  hand: 'left' | 'right',
  chain: BoneChain,
  handShape: HandShape | undefined,
  view: ViewSpec,
  behindHand: boolean,
): void {
  const prop = heldPropIn(pose, hand, handShape);
  if (prop === undefined) return;
  PROP_ART[prop.kind].paint(ctx, handGrip(chain), prop, view, behindHand);
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
  /** The body slab holding the near leg edge-on, which is laid with contact shadow all round it. */
  readonly nearLegSlab: number | null;
  /** The body slab holding a knee driven at the camera, laid with contact shadow and a long cast shadow. */
  readonly kneeSlab: number | null;
}

function figureSlabs(skeleton: Skeleton, view: ViewSpec, pose: CarlPose): FigureSlabs {
  // Edge-on the figure's left arm is the far one, genuinely behind the torso,
  // and takes the body's shade. Head-on both arms hang in front of the jacket
  // unless the pose puts one behind him, and neither is shaded — the same rule
  // the legs follow: a shade there paints one hand a different colour of skin
  // from the other, and from his bare legs.
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  const leftBehind = view.profile || pose.leftArmBehind || handIsBehind(pose.leftHandDepth, view);
  const rightBehind =
    !view.profile && (pose.rightArmBehind || handIsBehind(pose.rightHandDepth, view));
  const leftArm = (ctx: Ctx): void => {
    drawHeldProp(ctx, pose, 'left', skeleton.leftArm, pose.leftHandShape, view, leftBehind);
    drawArm(
      ctx,
      skeleton.leftArm,
      pose.leftFist,
      farArmShade,
      LEFT_THUMB,
      view.profile,
      pose.leftHandShape,
    );
    drawGauntlet(ctx, pose, view, 'left', skeleton.leftArm);
  };
  const rightArm = (ctx: Ctx, shade: number): void => {
    drawHeldProp(ctx, pose, 'right', skeleton.rightArm, pose.rightHandShape, view, rightBehind);
    drawArm(
      ctx,
      skeleton.rightArm,
      pose.rightFist,
      shade,
      RIGHT_THUMB,
      view.profile,
      pose.rightHandShape,
    );
    drawGauntlet(ctx, pose, view, 'right', skeleton.rightArm);
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
        footAccents(pose, view, side),
        (left ? pose.leftFootPoint : pose.rightFootPoint) ?? 0,
      );
    };
  // Facing the camera or edge-on the cloak hangs behind everything he is;
  // seen from behind it lies over his back, in a slab of its own.
  const cloakBehind = (ctx: Ctx): void => {
    if (!cloakInFront(view)) drawCloak(ctx, skeleton, pose, view);
  };
  const cloakOver: SlabPainter[] =
    gearOf(pose).cloak === true && cloakInFront(view)
      ? [(ctx) => drawCloak(ctx, skeleton, pose, view)]
      : [];
  const behindArms = (ctx: Ctx): void => {
    if (leftBehind) leftArm(ctx);
    if (rightBehind) rightArm(ctx, farArmShade);
  };

  // Edge-on the near leg stands in front of the far one and gets a slab of
  // its own, so it casts a shadow on it.
  const frontArms = (ctx: Ctx): void => {
    if (!leftBehind) leftArm(ctx);
    if (!rightBehind) rightArm(ctx, UNSHADED);
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
        ...torsoSlabs(skeleton, view, pose),
      ],
      frontArms,
      nearLegSlab: PROFILE_NEAR_LEG_SLAB,
      kneeSlab: null,
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
  };
  const shortsOverKnee = (ctx: Ctx, side: 'left' | 'right'): void => {
    drawShortsLegOver(
      ctx,
      skeleton.hip,
      shortsHalfWidth(view),
      pose.jacketFlare,
      view,
      {
        left: side === 'left' ? thighSeenFromAbove(skeleton.leftLeg) : skeleton.leftLeg,
        right: side === 'right' ? thighSeenFromAbove(skeleton.rightLeg) : skeleton.rightLeg,
      },
      { left: pose.leftBoxerFlutter, right: pose.rightBoxerFlutter },
      side,
    );
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
                drawShortsLegEndOn(
                  ctx,
                  chainOf(l.side),
                  l.depth.knee / THIGH_LENGTH,
                  l.side === 'left' ? pose.leftBoxerFlutter : pose.rightBoxerFlutter,
                );
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
    ...torsoSlabs(skeleton, view, pose),
    ...cloakOver,
    ...kneeForwardSlab,
  ];
  return {
    body,
    frontArms,
    nearLegSlab: null,
    kneeSlab: kneeForwardSlab.length === 0 ? null : body.length - 1,
  };
}

/** The boxers' slab, then the neck, jacket and head in one. */
function torsoSlabs(skeleton: Skeleton, view: ViewSpec, pose: CarlPose): SlabPainter[] {
  return [
    (ctx) =>
      drawShorts(
        ctx,
        skeleton.hip,
        shortsHalfWidth(view),
        pose.jacketFlare,
        view,
        { left: skeleton.leftLeg, right: skeleton.rightLeg },
        { left: pose.leftBoxerFlutter, right: pose.rightBoxerFlutter },
      ),
    // The head shares the jacket's slab: it paints its own shadow under the
    // jaw, which is the only place it overlaps anything. A torso pitched far
    // enough away from the camera carries the head down behind the top of his
    // back, so the jacket is painted over it.
    (ctx) => {
      const head = (): void => {
        ctx.save();
        ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
        ctx.rotate(headAngle(pose));
        drawHead(ctx, pose, view);
        ctx.restore();
      };
      const headBehindBack = torsoPitchedAway(pose, view);
      drawNeck(ctx, skeleton, pose, view);
      if (headBehindBack) head();
      drawJacket(ctx, skeleton, pose, view);
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

function drawFigure(
  ctx: Ctx,
  view: ViewSpec,
  authored: CarlPose,
  options: CarlComposeOptions,
): void {
  const pose = poseAsDrawn(authored, view);
  const skeleton = buildSkeleton(pose, view);
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
    { points: gearReach(skeleton, pose, view), margin: options.layerMargin ?? GEAR_INK_MARGIN },
  ]);
  const offsets = layerOffsets(bounds);
  const body = makeLayer(bounds);
  const part = makeLayer(bounds);
  const scratch = makeLayer(bounds);

  const slabs = figureSlabs(skeleton, view, pose);
  slabs.body.forEach((paintSlab, index) => {
    if (index === 0) {
      inFigureSpace(body, bounds, paintSlab);
      return;
    }
    clear(part);
    inFigureSpace(part, bounds, paintSlab);
    if (index === slabs.nearLegSlab) {
      occludeAround(body, part, scratch, offsets, OCCLUSION_ALPHA_NEAR_LEG);
    }
    if (index === slabs.kneeSlab) {
      occludeAround(body, part, scratch, offsets, OCCLUSION_ALPHA_KNEE);
      castFar(body, part, scratch, offsets);
    }
    laySlab(body, part, scratch, offsets);
  });
  clear(part);
  inFigureSpace(part, bounds, slabs.frontArms);
  occludeAround(
    body,
    part,
    scratch,
    offsets,
    view.profile ? OCCLUSION_ALPHA_EDGE_ON : OCCLUSION_ALPHA_HEAD_ON,
  );
  laySlab(body, part, scratch, offsets);

  lightShadowRim(body, scratch, offsets, (layer) =>
    inFigureSpace(layer, bounds, (layerCtx) => clearSoleRims(layerCtx, skeleton, view, pose)),
  );
  // The outline is built on the part surface, which is free once every slab is laid.
  const finished = options.silhouetteOutline === false ? body : part;
  if (finished === part) outlineInto(part, body, scratch, offsets, !view.profile);
  if (pose.palmGlow) {
    const glow = pose.palmGlow;
    inFigureSpace(finished, bounds, (layer) => drawPalmGlow(layer, skeleton, pose, glow));
  }
  if (gauntletSmokes(pose)) {
    inFigureSpace(finished, bounds, (layer) => drawGauntletSmoke(layer, pose, view, skeleton));
  }

  ctx.drawImage(
    finished.surface,
    bounds.minX,
    bounds.minY,
    bounds.width / bounds.pxPerUnit,
    bounds.height / bounds.pxPerUnit,
  );
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
