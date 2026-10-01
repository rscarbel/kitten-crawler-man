/**
 * GumGum's body as the crawlers find it behind the club: the orc from
 * `gumGumArt.ts`, in the same mustard coat-dress, patches and apron, lying on
 * her back where she was dropped. The body ends at the shoulders (the dialog
 * says so, and the Krasue takes heads), so the scene is read from everything
 * else: her clothes, her green hands and shins, the lost shoe, and the blood.
 *
 * Seen from above at the floor's foreshortening, like everything lying on the
 * ground, and painted once into a cached cell.
 *
 * Blood on stone reads as liquid from four cues, all of which the pool has: a
 * near-black deep middle thinning to a redder lip, a rounded lobed edge rather
 * than an ellipse, a dark meniscus line at that edge, and a cool specular
 * streak from the key light. Without the highlight any dark red shape reads as
 * paint.
 *
 * Grim but not gratuitous: the neck is a dark wet stump under a sodden collar,
 * and nothing more anatomical than that.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { mix, rgba, type Pt } from './carlArt';
import { fillSoftEllipse, withClip } from './softShade';
import { mulberry32, range, type Rng } from '../person/rng';
import {
  GUMGUM_APRON,
  GUMGUM_COAT,
  GUMGUM_HAIR,
  GUMGUM_PATCH_BLUE,
  GUMGUM_PATCH_GOLD,
  GUMGUM_SKIN,
} from './gumGumArt';

type Ctx = CanvasRenderingContext2D;

// ── Cell ─────────────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
const TILE_SCALE = 64;
const CELL_TILES_WIDE = 3;
const CELL_TILES_HIGH = 2;
const FRAME_WIDTH = TILE_SCALE * CELL_TILES_WIDE;
const FRAME_HEIGHT = TILE_SCALE * CELL_TILES_HIGH;
/** The alley tile sits in the middle of the cell, so the body and the pool spill evenly past it. */
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
const TILE_Y = (FRAME_HEIGHT - TILE_SCALE) / 2;
const ORIGIN_X = TILE_X + TILE_SCALE / 2;
const ORIGIN_Y = TILE_Y + TILE_SCALE / 2;

export const GUMGUM_CORPSE_STATE = 'corpse';

/**
 * How much a shape lying flat is squashed vertically: the floor tilt the rest
 * of the ground art is drawn at, so the pool lies on the cobbles instead of
 * standing up off them like a sign.
 */
const FLOOR_FORESHORTEN = 0.78;
/** Turned a little off the horizontal: a body square to the tile grid reads as placed, not dropped. */
const BODY_TURN = -0.14;
/** Nudged so the body and the pool together sit centred on the tile. */
const BODY_SHIFT: Pt = { x: 0.16, y: 0 };

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Death takes the warmth out of skin first: her green is pulled toward a cold
 * grey, enough that the hands read as lifeless beside the living figure but
 * still unmistakably hers.
 */
const DEAD_GREY = '#8a9088';
const DEATH_PALLOR = 0.35;
const SKIN_LIT = mix(GUMGUM_SKIN.light, DEAD_GREY, DEATH_PALLOR);
const SKIN_BASE = mix(GUMGUM_SKIN.base, DEAD_GREY, DEATH_PALLOR);
const SKIN_SHADE = mix(GUMGUM_SKIN.dark, DEAD_GREY, DEATH_PALLOR);
const LIGHT_TOWARD = '#ffffff';
const COAT_LIT_MIX = 0.2;
const COAT_SHADE_TOWARD = '#2a1a10';
const COAT_SHADE_MIX = 0.42;
const COAT_LIT = mix(GUMGUM_COAT, LIGHT_TOWARD, COAT_LIT_MIX);
const COAT_SHADE = mix(GUMGUM_COAT, COAT_SHADE_TOWARD, COAT_SHADE_MIX);
const APRON_SHADE_TOWARD = '#6a5a48';
const APRON_SHADE_MIX = 0.4;
const APRON_LIT = GUMGUM_APRON;
const APRON_SHADE = mix(GUMGUM_APRON, APRON_SHADE_TOWARD, APRON_SHADE_MIX);
const SHOE_LIT = '#4e3626';
const SHOE_SHADE = '#1c120b';
const STITCH = '#3a2814';
const OUTLINE = '#1e1014';
const CONTACT_SHADOW = '#0c0808';
const PAPER = '#ddd2b2';

/**
 * Blood, from the thinnest film at the pool's lip to the deep middle. Thin
 * blood is bright and saturated; a deep pool goes almost black. Both ends stay
 * red-brown, never purple — purple blood reads as a fantasy liquid.
 */
const BLOOD_FILM = '#8e1418';
const BLOOD_MID = '#5e0a0e';
const BLOOD_DEEP = '#2a0305';
const BLOOD_MENISCUS = '#190204';
/** The key light's reflection on wet blood: cool, nearly white. */
const BLOOD_SHEEN = '#f4dede';
const STUMP_WET = '#6a0c10';
const STUMP_CORE = '#1a0103';

// ── Geometry helpers ─────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;
/** The middle of a segment, as a share of its length. */
const LENS_MIDDLE = 0.5;
const HALF_PI = Math.PI / 2;

function p(x: number, y: number): Pt {
  return { x, y };
}

function along(from: Pt, to: Pt, share: number): Pt {
  return p(from.x + (to.x - from.x) * share, from.y + (to.y - from.y) * share);
}

/** A limb segment: round at both ends and tapering from `ra` to `rb`. */
function traceLimb(ctx: Ctx, a: Pt, b: Pt, ra: number, rb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.moveTo(a.x + Math.cos(angle - HALF_PI) * ra, a.y + Math.sin(angle - HALF_PI) * ra);
  ctx.lineTo(b.x + Math.cos(angle - HALF_PI) * rb, b.y + Math.sin(angle - HALF_PI) * rb);
  ctx.arc(b.x, b.y, rb, angle - HALF_PI, angle + HALF_PI);
  ctx.lineTo(a.x + Math.cos(angle + HALF_PI) * ra, a.y + Math.sin(angle + HALF_PI) * ra);
  ctx.arc(a.x, a.y, ra, angle + HALF_PI, angle + HALF_PI + Math.PI);
  ctx.closePath();
}

/**
 * A closed blob through `points` with every corner rounded off by quadratic
 * curves through the edge midpoints — the shape of a liquid or a cloth fold,
 * never a polygon's.
 */
function traceBlob(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length === 0) return;
  const first = points[0];
  const last = points[points.length - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  });
  ctx.closePath();
}

/** An irregular ring round `centre`, deterministic in `rng`. */
function lobedRing(
  rng: Rng,
  centre: Pt,
  rx: number,
  ry: number,
  points: number,
  wobble: number,
): Pt[] {
  const ring: Pt[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * TWO_PI;
    const reach = 1 + range(rng, -wobble, wobble);
    ring.push(p(centre.x + Math.cos(angle) * rx * reach, centre.y + Math.sin(angle) * ry * reach));
  }
  return ring;
}

/** A fill lit from the key light's side (upper left) across a form `half` wide about `centre`. */
function litAcross(ctx: Ctx, centre: Pt, half: number, lit: string, shade: string): CanvasGradient {
  const gradient = ctx.createLinearGradient(
    centre.x - half,
    centre.y - half,
    centre.x + half,
    centre.y + half,
  );
  gradient.addColorStop(0, lit);
  gradient.addColorStop(1, shade);
  return gradient;
}

// ── The pose, in floor units (tiles), shoulders toward −X ────────────────────

/**
 * She lies on her back with her shoulders toward −X, where her head should be.
 * The arms are out from her sides — the far one crooked up beside her, the near
 * one flung down into the blood — because a spread silhouette is the one a
 * player reads as "a body" at 32 px. The near knee has fallen outward, and that
 * foot's shoe is gone.
 *
 * Sized against the living figure: shoulders to soles a little over a tile and
 * a quarter, and as broad as she stands.
 */
const NECK = p(-0.56, 0);
const SHOULDER_X = -0.48;
const SHOULDER_HALF = 0.22;
const CHEST_X = -0.32;
const CHEST_HALF = 0.25;
const WAIST_X = -0.06;
const WAIST_HALF = 0.19;
const HEM_X = 0.4;
const HEM_HALF = 0.44;
/** The skirt's hem is ruffled into folds, some flung further than others. */
const HEM_FOLDS: readonly number[] = [0.0, 0.05, -0.01, 0.06, 0.0, 0.05, -0.02];
/** The hem bows out at its middle, the way a skirt fans when its wearer falls. */
const HEM_BOW = 0.05;

/** The arm roots sit just inside the shoulder line, so the sleeve caps tuck into the coat. */
const ARM_ROOT_INSET: Pt = { x: 0.04, y: 0.03 };
const FAR_SHOULDER = p(SHOULDER_X + ARM_ROOT_INSET.x, -SHOULDER_HALF + ARM_ROOT_INSET.y);
const FAR_ELBOW = p(-0.36, -0.52);
const FAR_HAND = p(-0.14, -0.6);
const NEAR_SHOULDER = p(SHOULDER_X + ARM_ROOT_INSET.x, SHOULDER_HALF - ARM_ROOT_INSET.y);
const NEAR_ELBOW = p(-0.66, 0.42);
const NEAR_HAND = p(-0.88, 0.52);

const FAR_HIP = p(0.34, -0.12);
const FAR_FOOT = p(0.84, -0.17);
const NEAR_HIP = p(0.34, 0.13);
const NEAR_KNEE = p(0.58, 0.34);
const NEAR_FOOT = p(0.84, 0.24);

const UPPER_ARM_R = 0.075;
const FOREARM_R = 0.064;
const WRIST_R = 0.046;
const THIGH_R = 0.08;
const SHIN_R = 0.064;
const ANKLE_R = 0.044;
const HAND_RX = 0.072;
const HAND_RY = 0.058;
const SHOE_RX = 0.07;
const SHOE_RY = 0.05;
const FOOT_RX = 0.062;
const FOOT_RY = 0.042;
const FOOT_TURN = 0.3;
/** A cuff is a little wider than the wrist it ends at. */
const CUFF_R_SHARE = 1.3;
/** How far the sleeve runs down the forearm before the green wrist shows. */
const SLEEVE_END_SHARE = 0.72;

/** The neck stump: a short stub of skin past the collar, ending in the wound. */
const NECK_STUB_LENGTH = 0.07;
const NECK_HALF = 0.095;
const NECK_END_TAPER = 0.92;
const COLLAR_DEPTH = 0.06;
const COLLAR_HALF = 0.17;
const WOUND_RX = 0.04;
const WOUND_RY = NECK_HALF * NECK_END_TAPER;
const WOUND_CORE_SHARE = 0.65;

interface Limb {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
  readonly rootR: number;
  readonly jointR: number;
  readonly endR: number;
}

const ARMS: readonly Limb[] = [
  {
    root: FAR_SHOULDER,
    joint: FAR_ELBOW,
    end: FAR_HAND,
    rootR: UPPER_ARM_R,
    jointR: FOREARM_R,
    endR: WRIST_R,
  },
  {
    root: NEAR_SHOULDER,
    joint: NEAR_ELBOW,
    end: NEAR_HAND,
    rootR: UPPER_ARM_R,
    jointR: FOREARM_R,
    endR: WRIST_R,
  },
];

const STRAIGHT_KNEE_SHARE = 0.5;
const LEGS: readonly Limb[] = [
  {
    root: FAR_HIP,
    joint: along(FAR_HIP, FAR_FOOT, STRAIGHT_KNEE_SHARE),
    end: FAR_FOOT,
    rootR: THIGH_R,
    jointR: SHIN_R,
    endR: ANKLE_R,
  },
  {
    root: NEAR_HIP,
    joint: NEAR_KNEE,
    end: NEAR_FOOT,
    rootR: THIGH_R,
    jointR: SHIN_R,
    endR: ANKLE_R,
  },
];

function torsoOutline(): Pt[] {
  const lastFold = HEM_FOLDS.length - 1;
  const hem: Pt[] = HEM_FOLDS.map((push, index) => {
    const t = index / lastFold;
    const y = -HEM_HALF + t * HEM_HALF * 2;
    const bow = Math.cos((t - LENS_MIDDLE) * Math.PI) * HEM_BOW;
    return p(HEM_X + push + bow, y);
  });
  return [
    p(SHOULDER_X, -SHOULDER_HALF),
    p(CHEST_X, -CHEST_HALF),
    p(WAIST_X, -WAIST_HALF),
    ...hem,
    p(WAIST_X, WAIST_HALF),
    p(CHEST_X, CHEST_HALF),
    p(SHOULDER_X, SHOULDER_HALF),
    p(SHOULDER_X - COLLAR_DEPTH, 0),
  ];
}

function traceTorso(ctx: Ctx): void {
  traceBlob(ctx, torsoOutline());
}

/** The apron: a bib down the chest, a tie at the waist, and a panel over the front of the skirt. */
const BIB_TOP_X = -0.4;
const BIB_HALF = 0.11;
const APRON_SKIRT_HALF = 0.21;
const APRON_HEM_X = 0.32;
/** The bib widens a little as it reaches the waist tie, and the panel again toward its hem. */
const BIB_WAIST_HALF = 0.121;
const APRON_SKIRT_TOP_X = WAIST_X + 0.02;
const APRON_HEM_HALF = 0.231;
/** The panel's hem bows forward at its middle, following the skirt under it. */
const APRON_HEM_BOW = 0.03;

function apronOutline(): Pt[] {
  return [
    p(BIB_TOP_X, -BIB_HALF),
    p(WAIST_X, -BIB_WAIST_HALF),
    p(APRON_SKIRT_TOP_X, -APRON_SKIRT_HALF),
    p(APRON_HEM_X, -APRON_HEM_HALF),
    p(APRON_HEM_X + APRON_HEM_BOW, 0),
    p(APRON_HEM_X, APRON_HEM_HALF),
    p(APRON_SKIRT_TOP_X, APRON_SKIRT_HALF),
    p(WAIST_X, BIB_WAIST_HALF),
    p(BIB_TOP_X, BIB_HALF),
  ];
}

function traceLimbChain(ctx: Ctx, limb: Limb, endR = limb.endR, endAt = limb.end): void {
  traceLimb(ctx, limb.root, limb.joint, limb.rootR, limb.jointR);
  traceLimb(ctx, limb.joint, endAt, limb.jointR, endR);
}

function limbAngle(limb: Limb): number {
  return Math.atan2(limb.end.y - limb.joint.y, limb.end.x - limb.joint.x);
}

/** The palm sits just past the wrist, in line with the forearm. */
const PALM_REACH = 0.6;

function palmOf(limb: Limb): Pt {
  const angle = limbAngle(limb);
  return p(
    limb.end.x + Math.cos(angle) * HAND_RX * PALM_REACH,
    limb.end.y + Math.sin(angle) * HAND_RX * PALM_REACH,
  );
}

function traceEllipse(ctx: Ctx, at: Pt, rx: number, ry: number, turn: number): void {
  // Without the moveTo, `ellipse` joins the previous subpath to its start with
  // a straight line, which the outline pass would stroke across the floor.
  ctx.moveTo(at.x + Math.cos(turn) * rx, at.y + Math.sin(turn) * rx);
  ctx.ellipse(at.x, at.y, rx, ry, turn, 0, TWO_PI);
  ctx.closePath();
}

function traceHand(ctx: Ctx, limb: Limb): void {
  const palm = palmOf(limb);
  traceEllipse(ctx, palm, HAND_RX, HAND_RY, limbAngle(limb));
}

/**
 * The neck between the collar and the cut, square-ended: with round caps a
 * stub this short is a disc, and a disc of green round a red wound reads as an
 * eye.
 */
function traceStump(ctx: Ctx): void {
  const collarSide = NECK.x + NECK_STUB_LENGTH;
  const cutHalf = NECK_HALF * NECK_END_TAPER;
  ctx.moveTo(collarSide, -NECK_HALF);
  ctx.lineTo(NECK.x, -cutHalf);
  ctx.lineTo(NECK.x, cutHalf);
  ctx.lineTo(collarSide, NECK_HALF);
  ctx.closePath();
}

function traceShoe(ctx: Ctx, at: Pt, turn: number, rx: number, ry: number): void {
  traceEllipse(ctx, at, rx, ry, turn);
}

/** The far foot's shoe sits just past the ankle. */
const SHOE_REACH = 0.04;
const FAR_SHOE = p(FAR_FOOT.x + SHOE_REACH, FAR_FOOT.y);
const NEAR_BARE_FOOT = p(NEAR_FOOT.x + SHOE_REACH, NEAR_FOOT.y);

// ── Outline ──────────────────────────────────────────────────────────────────

/** In floor units: about one screen pixel each side at the 32 px tile, like Carl's silhouette line. */
const OUTLINE_WIDTH = 0.06;
const OUTLINE_ALPHA = 0.85;

/** Every shape in the body's silhouette, for the outline pass under it. */
function traceSilhouette(ctx: Ctx): void {
  traceTorso(ctx);
  for (const limb of [...ARMS, ...LEGS]) traceLimbChain(ctx, limb);
  for (const limb of ARMS) traceHand(ctx, limb);
  traceStump(ctx);
  traceShoe(ctx, FAR_SHOE, 0, SHOE_RX, SHOE_RY);
  traceShoe(ctx, NEAR_BARE_FOOT, FOOT_TURN, FOOT_RX, FOOT_RY);
}

function strokeOutline(ctx: Ctx, trace: () => void): void {
  ctx.beginPath();
  trace();
  ctx.strokeStyle = rgba(OUTLINE, OUTLINE_ALPHA);
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── Blood ────────────────────────────────────────────────────────────────────

/**
 * The pool: one broad body spreading from the wound, and a few rounded lobes
 * where it ran on along the cobbles — under her shoulders, down past the flung
 * arm, and off to the side. Every lobe is drawn as part of one fill, so their
 * edges merge into a single liquid outline.
 */
interface Lobe {
  readonly centre: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly seed: number;
}

const POOL_POINTS = 16;
const POOL_WOBBLE = 0.12;
const POOL_LOBES: readonly Lobe[] = [
  { centre: p(-0.8, 0.04), rx: 0.42, ry: 0.4, seed: 0x6d6d },
  { centre: p(-0.5, 0.28), rx: 0.26, ry: 0.2, seed: 0x6d6e },
  { centre: p(-0.52, -0.22), rx: 0.22, ry: 0.18, seed: 0x6d6f },
  { centre: p(-1.12, 0.28), rx: 0.18, ry: 0.15, seed: 0x6d70 },
  { centre: p(-0.86, 0.5), rx: 0.17, ry: 0.13, seed: 0x6d71 },
];
/** Where the pool is deepest — right at the wound. */
const POOL_DEEP_CENTRE = p(-0.7, 0.02);
const POOL_REACH = 0.62;
const POOL_DEEP_STOP = 0.15;
const POOL_MID_STOP = 0.55;
const POOL_FILM_STOP = 0.88;
const MENISCUS_WIDTH = 0.026;
const MENISCUS_ALPHA = 0.75;
/**
 * A thin translucent film creeping past the meniscus, with the stones showing
 * through it: a pool cut off clean at its lip reads as a decal.
 */
const FILM_WIDTH = 0.05;
const FILM_ALPHA = 0.35;

function tracePool(ctx: Ctx): void {
  for (const lobe of POOL_LOBES) {
    traceBlob(
      ctx,
      lobedRing(mulberry32(lobe.seed), lobe.centre, lobe.rx, lobe.ry, POOL_POINTS, POOL_WOBBLE),
    );
  }
}

function paintPool(ctx: Ctx): void {
  const gradient = ctx.createRadialGradient(
    POOL_DEEP_CENTRE.x,
    POOL_DEEP_CENTRE.y,
    0,
    POOL_DEEP_CENTRE.x,
    POOL_DEEP_CENTRE.y,
    POOL_REACH,
  );
  gradient.addColorStop(0, BLOOD_DEEP);
  gradient.addColorStop(POOL_DEEP_STOP, BLOOD_DEEP);
  gradient.addColorStop(POOL_MID_STOP, BLOOD_MID);
  gradient.addColorStop(POOL_FILM_STOP, BLOOD_FILM);
  gradient.addColorStop(1, BLOOD_FILM);
  // The meniscus first, as a wider stroke under the fill: only its outer half
  // survives, so the lip darkens without the lobes' inner seams showing.
  ctx.beginPath();
  tracePool(ctx);
  ctx.strokeStyle = rgba(BLOOD_FILM, FILM_ALPHA);
  ctx.lineWidth = FILM_WIDTH * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = rgba(BLOOD_MENISCUS, MENISCUS_ALPHA);
  ctx.lineWidth = MENISCUS_WIDTH * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = gradient;
  ctx.fill('nonzero');
}

/**
 * The key light's reflection: soft streaks across the open part of the pool,
 * up and left of the wound and curved along the surface. These are what make
 * the pool wet.
 */
interface Streak {
  readonly from: Pt;
  readonly control: Pt;
  readonly to: Pt;
  readonly width: number;
  readonly alpha: number;
}

const SHEEN_STREAKS: readonly Streak[] = [
  { from: p(-1.04, -0.14), control: p(-0.96, -0.28), to: p(-0.74, -0.3), width: 0.036, alpha: 0.6 },
  {
    from: p(-1.12, 0.02),
    control: p(-1.11, -0.04),
    to: p(-1.08, -0.08),
    width: 0.026,
    alpha: 0.45,
  },
  { from: p(-0.98, 0.42), control: p(-0.9, 0.48), to: p(-0.8, 0.48), width: 0.02, alpha: 0.3 },
];

function paintSheen(ctx: Ctx): void {
  ctx.lineCap = 'round';
  for (const streak of SHEEN_STREAKS) {
    ctx.strokeStyle = rgba(BLOOD_SHEEN, streak.alpha);
    ctx.lineWidth = streak.width;
    ctx.beginPath();
    ctx.moveTo(streak.from.x, streak.from.y);
    ctx.quadraticCurveTo(streak.control.x, streak.control.y, streak.to.x, streak.to.y);
    ctx.stroke();
  }
}

const SPATTER_SEED = 0x51a7;
const SPATTER_COUNT = 11;
const SPATTER_MIN_REACH = 0.62;
const SPATTER_MAX_REACH = 0.9;
const SPATTER_MIN_R = 0.012;
const SPATTER_MAX_R = 0.026;
/** Drops thrown off at speed land as teardrops, stretched away from where they came from. */
const SPATTER_STRETCH = 1.8;
/** The spray went out away from the body, not back across it. */
const SPATTER_ARC_FROM = Math.PI * 0.55;
const SPATTER_ARC_TO = Math.PI * 1.45;

function paintSpatter(ctx: Ctx): void {
  const rng = mulberry32(SPATTER_SEED);
  ctx.fillStyle = BLOOD_MID;
  for (let i = 0; i < SPATTER_COUNT; i++) {
    const angle = range(rng, SPATTER_ARC_FROM, SPATTER_ARC_TO);
    const reach = range(rng, SPATTER_MIN_REACH, SPATTER_MAX_REACH);
    const radius = range(rng, SPATTER_MIN_R, SPATTER_MAX_R);
    const x = POOL_DEEP_CENTRE.x + Math.cos(angle) * reach;
    const y = POOL_DEEP_CENTRE.y + Math.sin(angle) * reach;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * SPATTER_STRETCH, radius, angle, 0, TWO_PI);
    ctx.fill();
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

const CONTACT_SHADOW_CENTRE = p(0.12, 0.03);
const CONTACT_SHADOW_RX = 0.82;
const CONTACT_SHADOW_RY = 0.4;
const CONTACT_SHADOW_ALPHA = 0.5;

/** The key light's direction across the floor: from the upper left, as on every figure. */
const LIGHT_FROM: Pt = { x: -0.62, y: -0.78 };
/** The lit and shaded sides of a limb sit this share of its radius in from its edges. */
const LIMB_TERMINATOR_SHARE = 0.9;

/**
 * Fills one limb segment shaded across its own axis, lit on whichever side
 * faces the key light. A gradient laid diagonally across the whole body instead
 * makes every limb the same colour as the patch of floor-space it happens to
 * cross, and the arms stop reading as round.
 */
function fillLimbSegment(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  ra: number,
  rb: number,
  lit: string,
  shade: string,
): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const normal = p(Math.cos(angle + HALF_PI), Math.sin(angle + HALF_PI));
  const facing = normal.x * LIGHT_FROM.x + normal.y * LIGHT_FROM.y >= 0 ? 1 : -1;
  const mid = along(a, b, LENS_MIDDLE);
  const reach = Math.max(ra, rb) * LIMB_TERMINATOR_SHARE * facing;
  const gradient = ctx.createLinearGradient(
    mid.x + normal.x * reach,
    mid.y + normal.y * reach,
    mid.x - normal.x * reach,
    mid.y - normal.y * reach,
  );
  gradient.addColorStop(0, lit);
  gradient.addColorStop(1, shade);
  ctx.beginPath();
  traceLimb(ctx, a, b, ra, rb);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function paintSleeve(ctx: Ctx, limb: Limb): void {
  const cuff = along(limb.joint, limb.end, SLEEVE_END_SHARE);
  fillLimbSegment(ctx, cuff, limb.end, limb.endR, limb.endR, SKIN_LIT, SKIN_SHADE);
  fillLimbSegment(
    ctx,
    limb.joint,
    cuff,
    limb.jointR,
    limb.endR * CUFF_R_SHARE,
    COAT_LIT,
    COAT_SHADE,
  );
  fillLimbSegment(ctx, limb.root, limb.joint, limb.rootR, limb.jointR, COAT_LIT, COAT_SHADE);
}

/**
 * Where each limb lies on the stones it throws a soft shadow down and to the
 * right, away from the key light — what lifts a limb off the floor instead of
 * leaving it printed on it.
 */
const LIMB_SHADOW_OFFSET: Pt = { x: 0.025, y: 0.035 };
const LIMB_SHADOW_ALPHA = 0.4;

function paintLimbShadows(ctx: Ctx): void {
  ctx.save();
  ctx.translate(LIMB_SHADOW_OFFSET.x, LIMB_SHADOW_OFFSET.y);
  ctx.beginPath();
  for (const limb of [...ARMS, ...LEGS]) traceLimbChain(ctx, limb);
  for (const limb of ARMS) traceHand(ctx, limb);
  ctx.fillStyle = rgba(CONTACT_SHADOW, LIMB_SHADOW_ALPHA);
  ctx.fill('nonzero');
  ctx.restore();
}

/**
 * Fingers half-curled: a dead hand is never flat and never a fist. Four short
 * strokes fanned past the palm.
 */
const FINGER_LENGTH = 0.05;
const FINGER_WIDTH = 0.022;
const FINGER_FAN = 0.22;
const FINGER_COUNT = 4;

function paintHand(ctx: Ctx, limb: Limb): void {
  const angle = limbAngle(limb);
  const palm = palmOf(limb);
  const knuckles = p(
    palm.x + Math.cos(angle) * HAND_RX * PALM_REACH,
    palm.y + Math.sin(angle) * HAND_RX * PALM_REACH,
  );
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineCap = 'round';
  ctx.lineWidth = FINGER_WIDTH;
  const middle = (FINGER_COUNT - 1) / 2;
  for (let finger = 0; finger < FINGER_COUNT; finger++) {
    const spread = angle + (finger - middle) * FINGER_FAN;
    ctx.beginPath();
    ctx.moveTo(knuckles.x, knuckles.y);
    ctx.lineTo(
      knuckles.x + Math.cos(spread) * FINGER_LENGTH,
      knuckles.y + Math.sin(spread) * FINGER_LENGTH,
    );
    ctx.stroke();
  }
  ctx.beginPath();
  traceHand(ctx, limb);
  ctx.fillStyle = litAcross(ctx, palm, HAND_RX, SKIN_LIT, SKIN_SHADE);
  ctx.fill();
}

function paintLeg(ctx: Ctx, limb: Limb): void {
  fillLimbSegment(ctx, limb.joint, limb.end, limb.jointR, limb.endR, SKIN_LIT, SKIN_SHADE);
  fillLimbSegment(ctx, limb.root, limb.joint, limb.rootR, limb.jointR, SKIN_LIT, SKIN_SHADE);
}

function paintShoe(ctx: Ctx, at: Pt, turn: number): void {
  ctx.beginPath();
  traceShoe(ctx, at, turn, SHOE_RX, SHOE_RY);
  ctx.fillStyle = litAcross(ctx, at, SHOE_RX, SHOE_LIT, SHOE_SHADE);
  ctx.fill();
}

/** The near foot, its shoe lost somewhere in the struggle: bare green, toes up. */
function paintBareFoot(ctx: Ctx): void {
  ctx.beginPath();
  traceShoe(ctx, NEAR_BARE_FOOT, FOOT_TURN, FOOT_RX, FOOT_RY);
  ctx.fillStyle = litAcross(ctx, NEAR_BARE_FOOT, FOOT_RX, SKIN_LIT, SKIN_SHADE);
  ctx.fill();
}

/** Skirt folds radiating from the waist to the ruffled hem. */
const SKIRT_FOLD_YS: readonly number[] = [-0.3, -0.14, 0.14, 0.3];
const SKIRT_FOLD_WAIST_SHARE = 0.65;
const SKIRT_FOLD_HEM_SHARE = 1.15;
const FOLD_WIDTH = 0.02;
const FOLD_ALPHA = 0.5;

interface Patch {
  readonly at: Pt;
  readonly halfW: number;
  readonly halfH: number;
  readonly tilt: number;
  readonly color: string;
}

/** The same two patches she wears standing: blue at the shoulder, rose low on the skirt. */
const PATCHES: readonly Patch[] = [
  { at: p(-0.38, -0.2), halfW: 0.065, halfH: 0.055, tilt: 0.3, color: GUMGUM_PATCH_BLUE },
  { at: p(0.26, 0.27), halfW: 0.07, halfH: 0.058, tilt: -0.2, color: GUMGUM_PATCH_GOLD },
];
const PATCH_STITCH_WIDTH = 0.009;
const PATCH_STITCH_DASH = [0.016, 0.012] as const;
const PATCH_STITCH_INSET = 0.8;

function paintPatch(ctx: Ctx, patch: Patch): void {
  ctx.save();
  ctx.translate(patch.at.x, patch.at.y);
  ctx.rotate(patch.tilt);
  ctx.fillStyle = patch.color;
  ctx.fillRect(-patch.halfW, -patch.halfH, patch.halfW * 2, patch.halfH * 2);
  ctx.strokeStyle = STITCH;
  ctx.lineWidth = PATCH_STITCH_WIDTH;
  ctx.setLineDash(PATCH_STITCH_DASH);
  ctx.strokeRect(
    -patch.halfW * PATCH_STITCH_INSET,
    -patch.halfH * PATCH_STITCH_INSET,
    patch.halfW * 2 * PATCH_STITCH_INSET,
    patch.halfH * 2 * PATCH_STITCH_INSET,
  );
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Lying on her back, the body is a rounded form across its width: lit along
 * the side toward the key light, rolling into shade along the far side, and the
 * belly catching the most light of all.
 */
function acrossBody(
  ctx: Ctx,
  half: number,
  lit: string,
  base: string,
  shade: string,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, -half, 0, half);
  gradient.addColorStop(0, lit);
  gradient.addColorStop(BODY_CROWN_STOP, base);
  gradient.addColorStop(1, shade);
  return gradient;
}

const BODY_CROWN_STOP = 0.45;
const BELLY_LIGHT = p(-0.08, -0.06);
const BELLY_LIGHT_RX = 0.36;
const BELLY_LIGHT_RY = 0.12;
const BELLY_LIGHT_ALPHA = 0.3;

function paintTorso(ctx: Ctx): void {
  ctx.beginPath();
  traceTorso(ctx);
  ctx.fillStyle = acrossBody(ctx, HEM_HALF, COAT_LIT, GUMGUM_COAT, COAT_SHADE);
  ctx.fill();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceTorso(ctx);
    },
    () => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(COAT_SHADE, FOLD_ALPHA);
      ctx.lineWidth = FOLD_WIDTH;
      for (const y of SKIRT_FOLD_YS) {
        ctx.beginPath();
        ctx.moveTo(WAIST_X, y * SKIRT_FOLD_WAIST_SHARE);
        ctx.lineTo(HEM_X + HEM_BOW, y * SKIRT_FOLD_HEM_SHARE);
        ctx.stroke();
      }
      for (const patch of PATCHES) paintPatch(ctx, patch);
    },
  );
}

/** The apron's pocket, with the corner of the folded papers the crawlers take off her. */
const POCKET_AT = p(0.16, 0.1);
const POCKET_HALF_W = 0.075;
const POCKET_HALF_H = 0.06;
const PAPER_HALF_W = 0.03;
const PAPER_HALF_H = 0.022;
const PAPER_TILT = -0.4;
const WAIST_TIE_WIDTH = 0.03;
const WAIST_TIE_REACH = 1.15;

function paintApron(ctx: Ctx): void {
  ctx.beginPath();
  traceBlob(ctx, apronOutline());
  ctx.fillStyle = acrossBody(ctx, APRON_SKIRT_HALF, APRON_LIT, APRON_LIT, APRON_SHADE);
  ctx.fill();
  fillSoftEllipse(
    ctx,
    BELLY_LIGHT.x,
    BELLY_LIGHT.y,
    BELLY_LIGHT_RX,
    BELLY_LIGHT_RY,
    LIGHT_TOWARD,
    BELLY_LIGHT_ALPHA,
  );
  ctx.strokeStyle = APRON_SHADE;
  ctx.lineWidth = WAIST_TIE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(WAIST_X, -WAIST_HALF * WAIST_TIE_REACH);
  ctx.lineTo(WAIST_X, WAIST_HALF * WAIST_TIE_REACH);
  ctx.stroke();
  ctx.fillStyle = rgba(APRON_SHADE, FOLD_ALPHA);
  ctx.fillRect(
    POCKET_AT.x - POCKET_HALF_W,
    POCKET_AT.y - POCKET_HALF_H,
    POCKET_HALF_W * 2,
    POCKET_HALF_H * 2,
  );
  ctx.save();
  ctx.translate(POCKET_AT.x - POCKET_HALF_W, POCKET_AT.y);
  ctx.rotate(PAPER_TILT);
  ctx.fillStyle = PAPER;
  ctx.fillRect(-PAPER_HALF_W, -PAPER_HALF_H, PAPER_HALF_W * 2, PAPER_HALF_H * 2);
  ctx.restore();
}

/**
 * Blood soaked into the cloth from the collar down: a sodden core at the
 * shoulders and a fainter tide line wicked further along the bib. Clipped to the
 * body, so it reads as a stain in the fabric rather than a shape on top.
 */
const SOAK_SEED = 0x50a4;
const SOAK_CENTRE = p(-0.5, 0);
const SOAK_RX = 0.13;
const SOAK_RY = 0.24;
const SOAK_POINTS = 10;
const SOAK_WOBBLE = 0.2;
const SOAK_ALPHA = 0.9;
const TIDE_ALPHA = 0.8;
const TIDE_REACH = 1.7;

function paintSoak(ctx: Ctx): void {
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceTorso(ctx);
    },
    () => {
      ctx.beginPath();
      traceBlob(
        ctx,
        lobedRing(
          mulberry32(SOAK_SEED),
          SOAK_CENTRE,
          SOAK_RX * TIDE_REACH,
          SOAK_RY,
          SOAK_POINTS,
          SOAK_WOBBLE,
        ),
      );
      ctx.fillStyle = rgba(BLOOD_MID, TIDE_ALPHA);
      ctx.fill();
      ctx.beginPath();
      traceBlob(
        ctx,
        lobedRing(
          mulberry32(SOAK_SEED + 1),
          SOAK_CENTRE,
          SOAK_RX,
          SOAK_RY,
          SOAK_POINTS,
          SOAK_WOBBLE,
        ),
      );
      ctx.fillStyle = rgba(BLOOD_DEEP, SOAK_ALPHA);
      ctx.fill();
    },
  );
}

/**
 * Claw marks: three rents raked across the apron and the coat under it, dark
 * with blood. On the pale apron they are the one mark at 32 px that says she
 * was attacked, not just struck down. Each is a torn lens — widest in the
 * middle where the claw bit deepest — and no two are the same length, so they
 * read as a rake of claws rather than a printed stripe.
 */
interface Claw {
  readonly from: Pt;
  readonly to: Pt;
  readonly half: number;
}

const CLAWS: readonly Claw[] = [
  { from: p(-0.34, -0.12), to: p(-0.04, 0.2), half: 0.024 },
  { from: p(-0.24, -0.22), to: p(0.1, 0.1), half: 0.032 },
  { from: p(-0.06, -0.24), to: p(0.14, -0.06), half: 0.02 },
];
/** The blood each rent bled into the cloth around it. */
const CLAW_BLEED_SHARE = 2.2;
const CLAW_BLEED_ALPHA = 0.4;
/** How far a lens's sides bow out past its half-width at the middle. */
const LENS_BULGE = 2;

function traceLens(ctx: Ctx, from: Pt, to: Pt, half: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const mid = along(from, to, LENS_MIDDLE);
  const normalX = Math.cos(angle + HALF_PI) * half * LENS_BULGE;
  const normalY = Math.sin(angle + HALF_PI) * half * LENS_BULGE;
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(mid.x + normalX, mid.y + normalY, to.x, to.y);
  ctx.quadraticCurveTo(mid.x - normalX, mid.y - normalY, from.x, from.y);
  ctx.closePath();
}

function paintClawMarks(ctx: Ctx): void {
  for (const claw of CLAWS) {
    ctx.beginPath();
    traceLens(ctx, claw.from, claw.to, claw.half * CLAW_BLEED_SHARE);
    ctx.fillStyle = rgba(BLOOD_MID, CLAW_BLEED_ALPHA);
    ctx.fill();
    ctx.beginPath();
    traceLens(ctx, claw.from, claw.to, claw.half);
    ctx.fillStyle = BLOOD_DEEP;
    ctx.fill();
  }
}

/** A few strands of her hair caught in the collar — the last of the bun. */
const HAIR_STRAND_WIDTH = 0.014;
const HAIR_FROM: Pt = { x: -0.53, y: -0.095 };
const HAIR_CONTROL: Pt = { x: -0.62, y: -0.18 };
const HAIR_TO: Pt = { x: -0.71, y: -0.124 };

/**
 * The stump, seen from above as she lies: a short band of green neck past a
 * sodden collar, ending in the cut. The cut faces away along the floor, so it
 * shows edge-on as a narrow ragged oval — wet dark red, a brighter raw lip on
 * the lit side, and blood running from it into the pool.
 */
const WOUND_RAGGED_SEED = 0x7c11;
const WOUND_RAGGED_POINTS = 12;
const WOUND_RAGGED_WOBBLE = 0.22;
const WOUND_LIP = '#a8323a';
const WOUND_LIP_WIDTH = 0.018;
const WOUND_LIP_ALPHA = 0.8;
/** The lip catches the light on the top (lit) side of the cut, from 200 to 340 degrees. */
const WOUND_LIP_FROM = Math.PI * 1.1;
const WOUND_LIP_TO = Math.PI * 1.9;

function paintNeck(ctx: Ctx): void {
  ctx.beginPath();
  traceEllipse(ctx, p(SHOULDER_X - COLLAR_DEPTH / 2, 0), COLLAR_DEPTH, COLLAR_HALF, 0);
  ctx.fillStyle = BLOOD_DEEP;
  ctx.fill();
  ctx.beginPath();
  traceStump(ctx);
  ctx.fillStyle = litAcross(ctx, NECK, NECK_HALF, SKIN_BASE, SKIN_SHADE);
  ctx.fill();
  ctx.beginPath();
  traceBlob(
    ctx,
    lobedRing(
      mulberry32(WOUND_RAGGED_SEED),
      NECK,
      WOUND_RX,
      WOUND_RY,
      WOUND_RAGGED_POINTS,
      WOUND_RAGGED_WOBBLE,
    ),
  );
  ctx.fillStyle = STUMP_WET;
  ctx.fill();
  fillSoftEllipse(
    ctx,
    NECK.x,
    NECK.y,
    WOUND_RX * WOUND_CORE_SHARE,
    WOUND_RY * WOUND_CORE_SHARE,
    STUMP_CORE,
    1,
  );
  ctx.strokeStyle = rgba(WOUND_LIP, WOUND_LIP_ALPHA);
  ctx.lineWidth = WOUND_LIP_WIDTH;
  ctx.beginPath();
  ctx.ellipse(NECK.x, NECK.y, WOUND_RX, WOUND_RY, 0, WOUND_LIP_FROM, WOUND_LIP_TO);
  ctx.stroke();
  ctx.strokeStyle = GUMGUM_HAIR.base;
  ctx.lineWidth = HAIR_STRAND_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(HAIR_FROM.x, HAIR_FROM.y);
  ctx.quadraticCurveTo(HAIR_CONTROL.x, HAIR_CONTROL.y, HAIR_TO.x, HAIR_TO.y);
  ctx.stroke();
}

function paintBody(ctx: Ctx): void {
  fillSoftEllipse(
    ctx,
    CONTACT_SHADOW_CENTRE.x,
    CONTACT_SHADOW_CENTRE.y,
    CONTACT_SHADOW_RX,
    CONTACT_SHADOW_RY,
    CONTACT_SHADOW,
    CONTACT_SHADOW_ALPHA,
  );
  paintLimbShadows(ctx);
  strokeOutline(ctx, () => traceSilhouette(ctx));
  for (const leg of LEGS) paintLeg(ctx, leg);
  paintShoe(ctx, FAR_SHOE, 0);
  paintBareFoot(ctx);
  paintTorso(ctx);
  paintApron(ctx);
  paintClawMarks(ctx);
  paintSoak(ctx);
  paintNeck(ctx);
  paintWaistBow(ctx);
  for (const arm of ARMS) {
    paintSleeve(ctx, arm);
    paintHand(ctx, arm);
  }
}

/**
 * The apron's bow at the front of her cinched waist, as she tied it that
 * morning: pale loops either side of the knot.
 */
const WAIST_BOW_LOOP_RX = 0.05;
const WAIST_BOW_LOOP_RY = 0.075;
const WAIST_BOW_KNOT_R = 0.025;

function paintWaistBow(ctx: Ctx): void {
  ctx.fillStyle = APRON_LIT;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    traceEllipse(
      ctx,
      p(WAIST_X, side * WAIST_BOW_LOOP_RY),
      WAIST_BOW_LOOP_RX,
      WAIST_BOW_LOOP_RY,
      0,
    );
    ctx.fill();
  }
  ctx.fillStyle = APRON_SHADE;
  ctx.beginPath();
  traceEllipse(ctx, p(WAIST_X, 0), WAIST_BOW_KNOT_R, WAIST_BOW_KNOT_R, 0);
  ctx.fill();
}

/**
 * One of her plaits, cut through and flung clear of the pool, its rose ribbon
 * still tied: with the head gone, it is the plainest sign of who this was.
 */
const CUT_PLAIT_FROM = p(-0.66, -0.2);
const CUT_PLAIT_CONTROL = p(-0.86, -0.46);
const CUT_PLAIT_TO = p(-1.12, -0.44);
const CUT_PLAIT_LOBES = 6;
const CUT_PLAIT_HALF = 0.034;
const CUT_PLAIT_LOBE_LENGTH = 0.05;
const CUT_PLAIT_TILT = 0.45;
const CUT_PLAIT_SEAM = 0.01;
const CUT_PLAIT_RIBBON = '#d0607a';
const CUT_PLAIT_RIBBON_RX = 0.035;
const CUT_PLAIT_RIBBON_RY = 0.02;
const CUT_PLAIT_TUFT = 0.06;

function quadAt(from: Pt, control: Pt, to: Pt, t: number): Pt {
  const u = 1 - t;
  return p(
    u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  );
}

interface PlaitLobe {
  readonly at: Pt;
  readonly turn: number;
}

/** The plait's lobes along its curve, each tilted alternately off the curve's direction. */
function cutPlaitLobes(): PlaitLobe[] {
  const lobes: PlaitLobe[] = [];
  for (let lobe = 0; lobe < CUT_PLAIT_LOBES; lobe++) {
    const t = (lobe + LENS_MIDDLE) / CUT_PLAIT_LOBES;
    const at = quadAt(CUT_PLAIT_FROM, CUT_PLAIT_CONTROL, CUT_PLAIT_TO, t);
    const ahead = quadAt(
      CUT_PLAIT_FROM,
      CUT_PLAIT_CONTROL,
      CUT_PLAIT_TO,
      Math.min(1, t + 1 / CUT_PLAIT_LOBES),
    );
    const along = Math.atan2(ahead.y - at.y, ahead.x - at.x);
    const tilt = (lobe % 2 === 0 ? 1 : -1) * CUT_PLAIT_TILT;
    lobes.push({ at, turn: along + tilt });
  }
  return lobes;
}

function paintCutPlait(ctx: Ctx): void {
  const lobes = cutPlaitLobes();
  strokeOutline(ctx, () => {
    for (const lobe of lobes) {
      traceEllipse(ctx, lobe.at, CUT_PLAIT_LOBE_LENGTH, CUT_PLAIT_HALF, lobe.turn);
    }
  });
  for (const lobe of lobes) {
    ctx.beginPath();
    traceEllipse(ctx, lobe.at, CUT_PLAIT_LOBE_LENGTH, CUT_PLAIT_HALF, lobe.turn);
    ctx.fillStyle = litAcross(ctx, lobe.at, CUT_PLAIT_HALF, GUMGUM_HAIR.light, GUMGUM_HAIR.shadow);
    ctx.fill();
    ctx.strokeStyle = GUMGUM_HAIR.deep;
    ctx.lineWidth = CUT_PLAIT_SEAM;
    ctx.stroke();
  }
  const angle = Math.atan2(
    CUT_PLAIT_TO.y - CUT_PLAIT_CONTROL.y,
    CUT_PLAIT_TO.x - CUT_PLAIT_CONTROL.x,
  );
  ctx.strokeStyle = GUMGUM_HAIR.mid;
  ctx.lineWidth = CUT_PLAIT_HALF;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(CUT_PLAIT_TO.x, CUT_PLAIT_TO.y);
  ctx.lineTo(
    CUT_PLAIT_TO.x + Math.cos(angle) * CUT_PLAIT_TUFT,
    CUT_PLAIT_TO.y + Math.sin(angle) * CUT_PLAIT_TUFT,
  );
  ctx.stroke();
  ctx.fillStyle = CUT_PLAIT_RIBBON;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    traceEllipse(
      ctx,
      p(
        CUT_PLAIT_TO.x + side * CUT_PLAIT_RIBBON_RX * Math.cos(angle + HALF_PI),
        CUT_PLAIT_TO.y + side * CUT_PLAIT_RIBBON_RX * Math.sin(angle + HALF_PI),
      ),
      CUT_PLAIT_RIBBON_RX,
      CUT_PLAIT_RIBBON_RY,
      angle + HALF_PI,
    );
    ctx.fill();
  }
}

function paintCorpse(ctx: Ctx): void {
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE * FLOOR_FORESHORTEN);
  ctx.translate(BODY_SHIFT.x, BODY_SHIFT.y);
  ctx.rotate(BODY_TURN);
  paintPool(ctx);
  paintSpatter(ctx);
  paintSheen(ctx);
  paintCutPlait(ctx);
  paintBody(ctx);
  ctx.restore();
}

export const GUMGUM_CORPSE_FIGURE: FigureDef = {
  id: 'gumgum_corpse',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates({ [GUMGUM_CORPSE_STATE]: 1 }),
  paintFrame: (ctx, state) => {
    if (state !== GUMGUM_CORPSE_STATE) return;
    paintCorpse(ctx);
  },
};
