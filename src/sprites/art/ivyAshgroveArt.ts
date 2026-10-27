/**
 * Ivy Ashgrove, painted on the biped rig: a ranger of The Barracks
 * Mercenaries in a moss-green jerkin over riding trousers and soft boots, auburn
 * hair loose at the front and tied back behind, a leather quiver slung on her back with its strap across
 * her chest, a bracer on her bow arm and the hirelings' orange armband on her
 * drawing arm. This module holds her colours and the pieces past the rig's
 * own body, as `BipedAttachments` (`biped/figure.ts`); her rows are in
 * `ivyAshgroveFigure.ts`.
 *
 * At 32 px what reads is the silhouette: the bow standing taller than her
 * head, the fletchings over her right shoulder, her long hair, and the strap's
 * diagonal across the green.
 */

import { type BipedAttachments } from './biped/figure';
import { addCapsule, shadeForm } from './biped/paint';
import { FAR_LIMB_SHADE, type GlossRamp, type Ramp, receded } from './biped/palette';
import { drawnSide, type Skeleton, type ViewSpec } from './biped/rig';
import { mix, type Pt } from './bipedArt';
import { type CastHeadSpec, castHeadReach, paintCastHead } from './human/castHead';

type Ctx = CanvasRenderingContext2D;

// ── Colours ──────────────────────────────────────────────────────────────────

/** Fair skin with a little sun on it. */
export const IVY_SKIN: Ramp = {
  deep: '#5a3324',
  shadow: '#8a5440',
  dark: '#b4775a',
  mid: '#cf9575',
  base: '#e6b493',
  light: '#f3cfb1',
  rim: '#fae3cc',
};

/** Auburn, a deep red-brown that holds against the green jerkin and the dark floor. */
export const IVY_HAIR: Ramp = {
  deep: '#2a0f08',
  shadow: '#431a0e',
  dark: '#622614',
  mid: '#7d321a',
  base: '#9b4322',
  light: '#c06636',
  rim: '#db8a55',
};

/**
 * Moss-green waxed wool. Kept well off black, a step lighter than the dungeon
 * floor it is seen on, so the jerkin's form survives the dark.
 */
export const IVY_JERKIN: GlossRamp = {
  deep: '#131c11',
  shadow: '#1f2e1b',
  dark: '#2c4126',
  mid: '#3a5531',
  base: '#4b6d3d',
  light: '#6e9257',
  rim: '#93b47a',
  specular: '#a3c08b',
};

/**
 * Tan leather for the quiver, paler than her auburn hair so the tube beside it
 * reads as its own shape from behind rather than one slab with the hair.
 */
const QUIVER_LEATHER: Ramp = {
  deep: '#2a1a0c',
  shadow: '#4a3018',
  dark: '#6e4a26',
  mid: '#8c6234',
  base: '#ad7f48',
  light: '#cfa46c',
  rim: '#e6c494',
};
const QUIVER_RIM = '#3a2214';
const STRAP = '#3b2416';
const STRAP_LIGHT = '#6a4a32';
/** The fletchings in the quiver are the arrow's: grey goose and a red cock feather. */
const FLETCH = '#e9e6de';
const COCK_FEATHER = '#c23b28';

// ── The quiver ───────────────────────────────────────────────────────────────

/** The tube's half-width, mouth and foot. */
const QUIVER_HALF_AT_MOUTH = 0.085;
const QUIVER_HALF_AT_FOOT = 0.065;
const QUIVER_RIM_DEPTH = 0.03;
/**
 * From behind, where the tube lies on her back: the mouth over her right
 * shoulder blade and the foot down at her left hip, as offsets from the
 * middle of her shoulders, with her right toward +X.
 */
const BACK_MOUTH = { x: 0.3, y: -0.04 };
const BACK_FOOT = { x: 0.1, y: 0.52 };
/** Edge-on the tube stands off her back, mouth higher and further out than the foot. */
const PROFILE_MOUTH = { x: -0.25, y: -0.16 };
const PROFILE_FOOT = { x: -0.22, y: 0.42 };

/** How far the fletchings stand out of the quiver's mouth, and how they fan. */
const FLETCH_LENGTH = 0.17;
const FLETCH_HALF = 0.022;
const FLETCH_FAN: readonly number[] = [-0.3, 0, 0.3];
/** Radians each fletching leans out per unit of its place across the mouth: a loose sheaf, not a row. */
const FLETCH_FAN_TURN = 0.25;
/** A feather tapers to this share of its root's width. */
const FLETCH_TIP_SHARE = 0.6;

/** The strap's width across her chest. */
const STRAP_HALF = 0.018;
/** The lit edge along the strap's top: how far up it sits and how wide it is, as shares of the strap. */
const STRAP_LIGHT_LIFT = 0.5;
const STRAP_LIGHT_SHARE = 0.35;
/** Head-on, where the strap crosses: from her right shoulder by the neck to her left hip. */
const STRAP_SHOULDER_IN = 0.45;
const STRAP_SHOULDER_UP = 0.02;
const STRAP_HIP_OUT = 0.13;
const STRAP_HIP_UP = 0.05;
/** Edge-on it runs from the top of the shoulder down to the front of her waist. */
const PROFILE_STRAP_TOP = { x: 0.02, y: -0.03 };
const PROFILE_STRAP_FOOT = { x: 0.11, y: 0.44 };

/** Screen +X or −X: which way her own right lies in this view. */
function rightwardOf(view: ViewSpec): number {
  return view.mirrored ? -1 : 1;
}

/** Where the quiver lies, mouth and foot, in figure space. */
function quiverLine(skeleton: Skeleton, view: ViewSpec): { mouth: Pt; foot: Pt } {
  const centre = skeleton.shoulderCentre;
  if (view.profile) {
    return {
      mouth: { x: centre.x + PROFILE_MOUTH.x, y: centre.y + PROFILE_MOUTH.y },
      foot: { x: centre.x + PROFILE_FOOT.x, y: centre.y + PROFILE_FOOT.y },
    };
  }
  const right = rightwardOf(view);
  return {
    mouth: { x: centre.x + BACK_MOUTH.x * right, y: centre.y + BACK_MOUTH.y },
    foot: { x: centre.x + BACK_FOOT.x * right, y: centre.y + BACK_FOOT.y },
  };
}

/** Where along the quiver's axis, from its mouth outward, each fletching stands. */
function fletchings(mouth: Pt, foot: Pt): { root: Pt; tip: Pt }[] {
  const dx = mouth.x - foot.x;
  const dy = mouth.y - foot.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  return FLETCH_FAN.map((across) => {
    const root = {
      x: mouth.x - uy * across * QUIVER_HALF_AT_MOUTH * 2,
      y: mouth.y + ux * across * QUIVER_HALF_AT_MOUTH * 2,
    };
    const fan = across * FLETCH_FAN_TURN;
    const tx = ux * Math.cos(fan) - uy * Math.sin(fan);
    const ty = uy * Math.cos(fan) + ux * Math.sin(fan);
    return { root, tip: { x: root.x + tx * FLETCH_LENGTH, y: root.y + ty * FLETCH_LENGTH } };
  });
}

function paintQuiver(ctx: Ctx, skeleton: Skeleton, view: ViewSpec, shade: number): void {
  const { mouth, foot } = quiverLine(skeleton, view);
  fletchings(mouth, foot).forEach(({ root, tip }, index) => {
    ctx.fillStyle = mix(index === 1 ? COCK_FEATHER : FLETCH, QUIVER_LEATHER.shadow, shade);
    ctx.beginPath();
    addCapsule(ctx, root, tip, FLETCH_HALF, FLETCH_HALF * FLETCH_TIP_SHARE);
    ctx.fill();
  });
  const leather = receded(QUIVER_LEATHER, shade);
  shadeForm(
    ctx,
    () => {
      ctx.beginPath();
      addCapsule(ctx, mouth, foot, QUIVER_HALF_AT_MOUTH, QUIVER_HALF_AT_FOOT);
    },
    { from: foot, to: mouth },
    leather,
    { halfWidth: QUIVER_HALF_AT_MOUTH },
  );
  const tubeLength = Math.hypot(foot.x - mouth.x, foot.y - mouth.y);
  const rimShare = QUIVER_RIM_DEPTH / tubeLength;
  const rimEnd = {
    x: mouth.x + (foot.x - mouth.x) * rimShare,
    y: mouth.y + (foot.y - mouth.y) * rimShare,
  };
  ctx.fillStyle = mix(QUIVER_RIM, QUIVER_LEATHER.deep, shade);
  ctx.beginPath();
  addCapsule(ctx, mouth, rimEnd, QUIVER_HALF_AT_MOUTH, QUIVER_HALF_AT_MOUTH);
  ctx.fill();
}

function strokeStrap(ctx: Ctx, from: Pt, to: Pt): void {
  ctx.fillStyle = STRAP;
  ctx.beginPath();
  addCapsule(ctx, from, to, STRAP_HALF, STRAP_HALF);
  ctx.fill();
  const lift = STRAP_HALF * STRAP_LIGHT_LIFT;
  ctx.fillStyle = STRAP_LIGHT;
  ctx.beginPath();
  addCapsule(
    ctx,
    { x: from.x, y: from.y - lift },
    { x: to.x, y: to.y - lift },
    STRAP_HALF * STRAP_LIGHT_SHARE,
    STRAP_HALF * STRAP_LIGHT_SHARE,
  );
  ctx.fill();
}

/** The quiver's strap across her front: shoulder to hip head-on, shoulder to waist edge-on. */
function paintStrap(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const centre = skeleton.shoulderCentre;
  if (view.profile) {
    strokeStrap(
      ctx,
      { x: centre.x + PROFILE_STRAP_TOP.x, y: centre.y + PROFILE_STRAP_TOP.y },
      { x: centre.x + PROFILE_STRAP_FOOT.x, y: centre.y + PROFILE_STRAP_FOOT.y },
    );
    return;
  }
  const right = rightwardOf(view);
  const ownRight =
    drawnSide('right', view) === 'right' ? skeleton.rightShoulder : skeleton.leftShoulder;
  const shoulder = {
    x: centre.x + (ownRight.x - centre.x) * STRAP_SHOULDER_IN,
    y: ownRight.y - STRAP_SHOULDER_UP,
  };
  const hip = { x: skeleton.hip.x - right * STRAP_HIP_OUT, y: skeleton.hip.y - STRAP_HIP_UP };
  strokeStrap(ctx, shoulder, hip);
}

// ── The belt ─────────────────────────────────────────────────────────────────

const BELT = '#2e1c11';
const BELT_LIGHT = '#5a3b26';
const BUCKLE = '#c9b27a';
/** The belt's half-height, and how far either side of the spine it reaches head-on and edge-on. */
const BELT_HALF = 0.032;
const BELT_HALF_ACROSS = 0.17;
const BELT_HALF_DEEP = 0.13;
/** How far below the rig's waist joint the belt sits: at the narrowest of her. */
const BELT_DROP = 0.04;
const BUCKLE_HALF = 0.03;
/** The lit stripe along the belt's upper edge, as a share of its height. */
const BELT_LIGHT_SHARE = 0.35;

/**
 * A dark belt round her waist over the jerkin: the cinch the skirt flares
 * from. Drawn as a band across the torso at its own width there, head-on or
 * edge-on, with a brass buckle where it shows the front.
 */
function paintBelt(ctx: Ctx, skeleton: Skeleton, view: ViewSpec): void {
  const centre = { x: skeleton.waist.x, y: skeleton.waist.y + BELT_DROP };
  const across = view.profile ? BELT_HALF_DEEP : BELT_HALF_ACROSS;
  ctx.fillStyle = BELT;
  ctx.fillRect(centre.x - across, centre.y - BELT_HALF, across * 2, BELT_HALF * 2);
  ctx.fillStyle = BELT_LIGHT;
  ctx.fillRect(
    centre.x - across,
    centre.y - BELT_HALF,
    across * 2,
    BELT_HALF * 2 * BELT_LIGHT_SHARE,
  );
  if (view.showsBack) return;
  const buckleX = view.profile ? centre.x + across - BUCKLE_HALF : centre.x;
  ctx.fillStyle = BUCKLE;
  ctx.fillRect(buckleX - BUCKLE_HALF, centre.y - BELT_HALF, BUCKLE_HALF * 2, BELT_HALF * 2);
}

// ── The head ─────────────────────────────────────────────────────────────────

/**
 * Head-on her hair falls loose either side of her face, the read that says
 * woman at the tile; edge-on and from behind it is gathered in a ponytail, so
 * the profile keeps its face and the back is a tail rather than a slab of
 * hair standing above the skull.
 */
const IVY_HEAD_FACING: CastHeadSpec = { hairStyle: 'long', facialHair: 'none', hair: IVY_HAIR };
const IVY_HEAD_TURNED: CastHeadSpec = {
  hairStyle: 'ponytail',
  facialHair: 'none',
  hair: IVY_HAIR,
};

function headFor(view: ViewSpec): CastHeadSpec {
  return view.profile || view.showsBack ? IVY_HEAD_TURNED : IVY_HEAD_FACING;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function quiverReach(skeleton: Skeleton, view: ViewSpec): Pt[] {
  const { mouth, foot } = quiverLine(skeleton, view);
  const tips = fletchings(mouth, foot).map((fletch) => fletch.tip);
  const pad = QUIVER_HALF_AT_MOUTH;
  return [
    ...tips,
    { x: mouth.x - pad, y: mouth.y - pad },
    { x: mouth.x + pad, y: mouth.y + pad },
    { x: foot.x - pad, y: foot.y + pad },
    { x: foot.x + pad, y: foot.y + pad },
  ];
}

/**
 * Her attachments. Head-on and edge-on the quiver hangs behind her, so only
 * its mouth and the fletchings past her shoulder show; from behind it lies
 * over her back, beside her hair rather than under it.
 */
export const IVY_ATTACHMENTS: BipedAttachments = {
  behind: (ctx, skeleton, view) => {
    if (view.showsBack) return;
    paintQuiver(ctx, skeleton, view, view.profile ? 0 : FAR_LIMB_SHADE);
  },
  over: (ctx, skeleton, view, pose) => {
    paintBelt(ctx, skeleton, view);
    if (!view.showsBack) paintStrap(ctx, skeleton, view);
    paintCastHead(ctx, skeleton, view, pose, headFor(view));
    // Off to her right and over her hair: under it, the hair hides the tube
    // down her spine and the quiver reads only as two pale dots at the tile.
    if (view.showsBack) paintQuiver(ctx, skeleton, view, 0);
  },
  reach: (skeleton, view) => [...quiverReach(skeleton, view), ...castHeadReach(skeleton)],
};
