/**
 * The Grotesque Spider painter: a lab-bred mutant brood-mother, seen from
 * directly above and facing +Y.
 *
 * Anatomy first, so the wrongness reads as wrong: a hard carapace with a fovea
 * and radial striae, a narrow waist, a heavy abdomen swollen well past the
 * carapace's length with a stretched, translucent egg sac showing the clutch
 * inside, chelicerae with long bone fangs, pedipalps, and eight near-black,
 * tapering legs whose knees splay out past the body. Then the lab's work on
 * top: a withered, over-long left leg bent the wrong way and ending in an
 * almost-hand, a right rear leg cut below the knee and stitched shut, a
 * jaundiced slit-pupilled eye among smaller human ones on the carapace, a
 * stapled seam down its front that splits open into a second, lamprey maw,
 * tumours bulging from the abdomen, and bristles gone patchy over raw skin.
 *
 * Her face leads. The dark chitin plate carrying ember-lit eyes, wet
 * highlights and long bone fangs is the highest-contrast region on her; the
 * clutch sits dim and wet in a small window at the rear, mid-toned eggs with
 * only pinpoint glints. A bright clutch pulls the eye to her tail and she
 * reads as walking backwards.
 *
 * The light is soft and overhead, hanging a little behind her, with a rim, and
 * every shadow she casts — body and legs — is painted into the figure so it
 * turns with her; nothing exposes a light fixed in the world.
 *
 * What to paint comes from `grotesqueSpiderRig.ts`; this module only draws a
 * solved pose. It knows nothing about animation.
 */

import { clamp01, lerp, mix, rgba } from './carlArt';
import { fillSoftEllipse, withClip } from './softShade';
import { paintEggSac } from './spiderEggArt';
import {
  abdomenCentreDistance,
  abdomenTailDistance,
  alongAbdomen,
  ABDOMEN_HALF_LENGTH,
  ABDOMEN_HALF_WIDTH,
  CEPH_HALF_LENGTH,
  CEPH_HALF_WIDTH,
  cephDrawScale,
  cephToFigure,
  FANG_TIP_Y,
  MAW_CENTRE_Y,
  MAW_MAX_RADIUS,
  ovipositorTip,
  perspectiveScale,
  project,
  solveSpiderPose,
  SPLIT_MAX_ANGLE,
  SPLIT_MAX_SHIFT,
  SPLIT_PIVOT_Y,
  type GrotesqueSpiderPose,
  type P2,
  type P3,
  type SolvedLeg,
  type SpiderSolve,
} from './grotesqueSpiderRig';

export type {
  GrotesqueSpiderAttackRow,
  GrotesqueSpiderPose,
  GrotesqueSpiderState,
  SpiderAttackStage,
} from './grotesqueSpiderRig';
export {
  getSpiderLegTip,
  SPIDER_LEGS,
  spiderGlobAtMouth,
  spiderMawOpen,
  type SpiderLegDesc,
} from './grotesqueSpiderRig';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;
const QUARTER_TURN = Math.PI * HALF;

/** Where the pivot sits inside the tile she stands on. */
export const SPIDER_BODY_CENTRE_RATIO = 0.5;
/** Far enough past her widest reach, in tiles, to cover every pixel of any cell. */
const CELL_REACH_TILES = 4;
const PALLOR_ALPHA = 0.45;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Necrotic hide and chitin, not candy: bruised grey-violet skin blotched with
 * brown and bile, raw wet flesh where the lab cut her open, bone-yellow claws
 * and fangs, a clutch of dim olive eggs, and jaundiced eyes that glow. The hide
 * is a cool grey-violet so it parts from the warm brown lab floor by hue as
 * well as by value, and every dark part carries a pale rim or an outline, so
 * no part of her merges into the floor or into another.
 */
const PALETTE = {
  outline: '#0c0909',
  hideDark: '#120e10',
  hideMid: '#2a2428',
  hideLight: '#66595c',
  hideRim: '#c9bd9c',
  bruiseBile: '#7c6c24',
  bruiseNecrotic: '#4a2c44',
  bruiseSlate: '#2c3240',
  bruiseRot: '#4e3222',
  mottleGrey: '#7a6f72',
  hideVein: '#1c0c12',
  hideVeinBile: '#b4a23c',
  gloss: '#f4eedc',
  carapaceDark: '#0f0b0c',
  carapaceMid: '#332a2a',
  carapaceLight: '#6a5d55',
  carapaceRim: '#d6c8a2',
  legDark: '#221c1c',
  legRidge: '#8e8070',
  legRim: '#d8c49c',
  legKnee: '#dccca2',
  legHair: '#080606',
  legBristle: '#9a8d74',
  witheredDark: '#2a2420',
  witheredRidge: '#8a7e70',
  seam: '#8e3c3a',
  flesh: '#8a2c30',
  fleshDark: '#420e12',
  fleshWet: '#d68a7c',
  staple: '#dfe3e8',
  cavity: '#080503',
  cavityWall: '#3a1712',
  cavityWet: '#8a5a4a',
  membrane: '#3c3634',
  egg: '#4c5034',
  eggShade: '#282a18',
  eggCrown: '#646846',
  eggGlint: '#f4ecd4',
  embryo: '#2e2010',
  bone: '#f2e4b4',
  boneDark: '#6e5a2c',
  fangRoot: '#1e1612',
  metalLight: '#f4f8fc',
  metal: '#9aa2ac',
  metalDark: '#3a4048',
  venomDark: '#384808',
  venom: '#4a5e0a',
  venomLight: '#8aaa18',
  venomGlow: '#aace24',
  venomCore: '#d8f040',
  eyeWhite: '#f2e9da',
  eyeShade: '#b8a696',
  lid: '#6e5a58',
  blood: '#a81c2c',
  pupil: '#0a0608',
  throat: '#2a0306',
  glowHot: '#ffc050',
  glow: '#ff3a18',
  /**
   * A deep ember red, far dimmer than the throat's furnace glow, so the lit
   * eyes lead her face without ever reading as the screech's light.
   */
  eyeGlow: '#c63a1c',
  spittle: '#f0e8d2',
  slime: '#e8dcc0',
  shadow: '#000000',
  deadEgg: '#7a7050',
  deadEggDark: '#28221a',
  ichorEdge: '#141a04',
  ichor: '#2a340e',
  ichorLight: '#3c4a18',
  ichorGloss: '#e4f0b8',
  dust: '#e4d8c2',
  dustShade: '#a8967a',
  floorChip: '#6e6254',
  corpse: '#2e2a2c',
} as const;

// ── Line weights, in tiles ───────────────────────────────────────────────────

/** A one-and-a-half pixel outline at the 64 px bake, under one at 32 px in game. */
const OUTLINE_WIDTH = 0.038;
const RIM_WIDTH = 0.045;
const RIM_ALPHA = 0.6;
/**
 * The abdomen's rim is a dull, wide bronze edge: it is her biggest shape and
 * a mid-dark one, and without an edge it melts into the brown lab floor at
 * game size. Kept dimmer than the carapace's rim, or her tail out-shines her
 * face and she reads as walking backwards.
 */
const HIDE_RIM_ALPHA = 0.5;
const HIDE_RIM_WIDTH_SCALE = 2.2;

// ── Small helpers ────────────────────────────────────────────────────────────

/** A stable 0–1 value per integer, for deterministic variety. */
function hash01(n: number): number {
  const HASH_SCALE = 43758.5453;
  const HASH_MULTIPLIER = 12.9898;
  const raw = Math.sin(n * HASH_MULTIPLIER) * HASH_SCALE;
  return raw - Math.floor(raw);
}

/** A tapered capsule from `a` (width `wa`) to `b` (width `wb`), as a path. */
function capsulePath(ctx: Ctx, a: P2, b: P2, wa: number, wb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa * HALF, angle + QUARTER_TURN, angle - QUARTER_TURN);
  ctx.arc(b.x, b.y, wb * HALF, angle - QUARTER_TURN, angle + QUARTER_TURN);
  ctx.closePath();
}

function strokeLine(ctx: Ctx, a: P2, b: P2, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function fillCircle(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0), 0, TWO_PI);
  ctx.fill();
}

/** The point `t` along a quadratic Bézier from `a` through control `c` to `b`. */
function quadraticPoint(a: P2, c: P2, b: P2, t: number): P2 {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

function pointAlong(a: P2, b: P2, t: number): P2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// ── Shadows and the floor ────────────────────────────────────────────────────

const BODY_SHADOW_ALPHA = 0.6;
const BODY_SHADOW_RX = 1.0;
const BODY_SHADOW_RY = 1.6;
/** The body shadow's centre, behind the waist: most of her mass is abdomen. */
const BODY_SHADOW_BACK = 0.36;
/** The body shadow's size and where it sits behind the waist, for the gates. */
export const SPIDER_BODY_SHADOW = {
  rx: BODY_SHADOW_RX,
  ry: BODY_SHADOW_RY,
  back: BODY_SHADOW_BACK,
} as const;
const BODY_SHADOW_CORE = 0.55;
const LEG_SHADOW_ALPHA = 0.26;
/** A leg this high casts no shadow worth drawing: it has spread and faded. */
const LEG_SHADOW_FADE_HEIGHT = 2.2;
const FOOT_CONTACT_RADIUS = 0.07;
const FOOT_CONTACT_ALPHA = 0.6;
const PLANTED_HEIGHT = 0.02;

/** Joint widths, root to tip, of each leg kind, in tiles: thick at the femur, fine at the tarsus. */
const NORMAL_LEG_WIDTHS: readonly number[] = [0.27, 0.15, 0.064, 0.022];
const WITHERED_LEG_WIDTHS: readonly number[] = [0.22, 0.14, 0.1, 0.08, 0.045];
const STUMP_WIDTHS: readonly number[] = [0.27, 0.16, 0.13];

function legWidths(leg: SolvedLeg): readonly number[] {
  if (leg.desc.kind === 'withered') return WITHERED_LEG_WIDTHS;
  if (leg.desc.kind === 'stump') return STUMP_WIDTHS;
  return NORMAL_LEG_WIDTHS;
}

/**
 * Where a raised point's shadow falls: straight down, pushed back toward her
 * tail by its height. The light hangs a little behind her, so a lifted leg
 * visibly leaves its shadow; lit from dead overhead, the two sit almost on
 * top of each other and a raised leg reads as a standing one. The light turns
 * with her, as every shadow she casts is painted in her own frame.
 */
const SHADOW_CAST_BACK = 0.6;

/**
 * Only height above a standing leg's knees is cast back: every standing leg's
 * shadow cast back by its full height lies beside it as a second set of legs.
 */
const SHADOW_CAST_FROM_HEIGHT = 1;

function shadowOf(p: P3): P2 {
  return { x: p.x, y: p.y - Math.max(0, p.h - SHADOW_CAST_FROM_HEIGHT) * SHADOW_CAST_BACK };
}

function drawLegShadow(ctx: Ctx, leg: SolvedLeg): void {
  const widths = legWidths(leg);
  for (let i = 1; i < leg.joints.length; i++) {
    const a = shadowOf(leg.joints[i - 1]);
    const b = shadowOf(leg.joints[i]);
    const height = (leg.joints[i - 1].h + leg.joints[i].h) * HALF;
    const alpha = LEG_SHADOW_ALPHA * (1 - clamp01(height / LEG_SHADOW_FADE_HEIGHT));
    if (alpha <= 0) continue;
    ctx.fillStyle = rgba(PALETTE.shadow, alpha);
    capsulePath(ctx, a, b, widths[i - 1] * leg.desc.girth, widths[i] * leg.desc.girth);
    ctx.fill();
  }
  const tip = leg.joints[leg.joints.length - 1];
  if (leg.desc.kind !== 'stump' && tip.h < PLANTED_HEIGHT) {
    fillSoftEllipse(
      ctx,
      tip.x,
      tip.y,
      FOOT_CONTACT_RADIUS,
      FOOT_CONTACT_RADIUS,
      PALETTE.shadow,
      FOOT_CONTACT_ALPHA,
    );
  }
}

/**
 * The floor fractured round each foreleg driven into it: a crushed crater and
 * cracks running out from it, each a jagged line that kinks at random and
 * tapers to nothing, with chips of broken floor kicked out round the rim. Evenly spaced straight cracks with
 * forks at their ends read at game size as twigs, bird tracks or a skeleton's
 * ribs; a fracture is irregular and dies out.
 */
const CRACK_COUNT = 7;
const CRACK_LENGTH = 0.42;
const CRACK_LENGTH_RANGE = 0.3;
const CRACK_STEPS = 5;
const CRACK_KINK = 0.5;
const CRACK_ROOT_WIDTH = 0.08;
const CRACK_TIP_WIDTH = 0.012;
const CRACK_ALPHA = 0.9;
/** The lit lip along one side of each crack, where the broken edge catches the light. */
const CRACK_LIP_OFFSET = 0.022;
const CRACK_LIP_ALPHA = 0.3;
/** Cracks start at the crater's rim, not its centre, as the floor there is crushed rather than split. */
const CRATER_RADIUS = 0.2;
const CRATER_RIM_ALPHA = 0.55;
/** Pale crushed floor round the pit, so the impact reads as a hole punched into the ground. */
const CRUSHED_FLOOR_SCALE = 1.8;
const CRUSHED_FLOOR_ALPHA = 0.45;
const CRATER_RIM_WIDTH = 0.035;
const CRACK_SEED_STRIDE = 17;
const DEBRIS_CHIPS = 8;
const DEBRIS_MIN_SIZE = 0.05;
const DEBRIS_SIZE_RANGE = 0.04;
const DEBRIS_REACH = 0.5;
const DEBRIS_CORNERS = 4;
const DEBRIS_SHADOW_OFFSET = 0.02;
const DEBRIS_SHADOW_ALPHA = 0.6;

/** One crack as a run of points, from the crater's rim out. */
function crackPoints(from: P2, angle: number, length: number, seed: number): P2[] {
  const points: P2[] = [from];
  let heading = angle;
  let at = from;
  for (let step = 1; step <= CRACK_STEPS; step++) {
    heading += (hash01(seed + step) - HALF) * CRACK_KINK;
    const run = (length / CRACK_STEPS) * lerp(HALF, 1 + HALF, hash01(seed + step + CRACK_STEPS));
    at = { x: at.x + Math.cos(heading) * run, y: at.y + Math.sin(heading) * run };
    points.push(at);
  }
  return points;
}

/** A crack stroked segment by segment, thinning from root to tip. */
function strokeCrack(ctx: Ctx, points: readonly P2[], rootWidth: number, fade: number): void {
  for (let i = 1; i < points.length; i++) {
    const width = lerp(rootWidth, CRACK_TIP_WIDTH, i / (points.length - 1));
    const a = points[i - 1];
    const b = points[i];
    strokeLine(
      ctx,
      { x: a.x, y: a.y - CRACK_LIP_OFFSET },
      { x: b.x, y: b.y - CRACK_LIP_OFFSET },
      rgba(PALETTE.dust, CRACK_LIP_ALPHA * fade),
      width,
    );
    strokeLine(ctx, a, b, rgba(PALETTE.outline, CRACK_ALPHA * fade), width);
  }
}

function drawDebrisChip(ctx: Ctx, at: P2, size: number, seed: number, fade: number): void {
  const chip = (dx: number, dy: number): void => {
    ctx.beginPath();
    for (let corner = 0; corner < DEBRIS_CORNERS; corner++) {
      const a = (corner / DEBRIS_CORNERS) * TWO_PI + hash01(seed + corner) * HALF;
      const reach = size * lerp(HALF, 1, hash01(seed + corner + DEBRIS_CORNERS));
      const x = at.x + dx + Math.cos(a) * reach;
      const y = at.y + dy + Math.sin(a) * reach;
      if (corner === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = rgba(PALETTE.outline, DEBRIS_SHADOW_ALPHA * fade);
  chip(0, -DEBRIS_SHADOW_OFFSET);
  ctx.fill();
  ctx.fillStyle = rgba(hash01(seed) > HALF ? PALETTE.dustShade : PALETTE.floorChip, fade);
  chip(0, 0);
  ctx.fill();
}

function drawSlamCracks(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.embed <= 0) return;
  const fade = solve.embed;
  ctx.lineCap = 'round';
  for (const leg of solve.legs) {
    if (leg.desc.pair !== 0) continue;
    const tip = leg.joints[leg.joints.length - 1];
    const seed = leg.index * CRACK_SEED_STRIDE * CRACK_COUNT;
    fillSoftEllipse(
      ctx,
      tip.x,
      tip.y,
      CRATER_RADIUS * CRUSHED_FLOOR_SCALE,
      CRATER_RADIUS * CRUSHED_FLOOR_SCALE,
      PALETTE.dustShade,
      CRUSHED_FLOOR_ALPHA * fade,
    );
    fillSoftEllipse(ctx, tip.x, tip.y, CRATER_RADIUS, CRATER_RADIUS, PALETTE.outline, fade);
    ctx.strokeStyle = rgba(PALETTE.dustShade, CRATER_RIM_ALPHA * fade);
    ctx.lineWidth = CRATER_RIM_WIDTH;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, CRATER_RADIUS, Math.PI, TWO_PI);
    ctx.stroke();
    for (let i = 0; i < CRACK_COUNT; i++) {
      const crackSeed = seed + i * CRACK_SEED_STRIDE;
      const angle = ((i + hash01(crackSeed)) / CRACK_COUNT) * TWO_PI;
      const length = (CRACK_LENGTH + hash01(crackSeed + 1) * CRACK_LENGTH_RANGE) * fade;
      const from = {
        x: tip.x + Math.cos(angle) * CRATER_RADIUS * HALF,
        y: tip.y + Math.sin(angle) * CRATER_RADIUS * HALF,
      };
      const points = crackPoints(from, angle, length, crackSeed);
      strokeCrack(ctx, points, CRACK_ROOT_WIDTH, fade);
    }
    for (let i = 0; i < DEBRIS_CHIPS; i++) {
      const chipSeed = seed + i * DEBRIS_CORNERS * 2 + CRACK_SEED_STRIDE;
      const angle = hash01(chipSeed) * TWO_PI;
      const reach = lerp(CRATER_RADIUS, DEBRIS_REACH, hash01(chipSeed + 1)) * fade;
      const size = DEBRIS_MIN_SIZE + hash01(chipSeed + 2) * DEBRIS_SIZE_RANGE;
      drawDebrisChip(
        ctx,
        { x: tip.x + Math.cos(angle) * reach, y: tip.y + Math.sin(angle) * reach },
        size,
        chipSeed,
        fade,
      );
    }
  }
}

/**
 * The ichor pool, in tiles, laid out from the point the tear reaches her tail:
 * [how far behind it, how far aside, radius], each blob lobed on its own. It
 * pours out behind her and runs off to one side in uneven lobes. A pool
 * centred on her, round or symmetric, sits round the abdomen like a hat brim
 * or a leaf; one that runs away from the tear reads as spilled.
 */
const SPILL_BLOBS: readonly (readonly [number, number, number])[] = [
  [-0.7, 0.0, 0.8],
  [-0.35, -0.75, 0.42],
  [0.05, -0.55, 0.38],
  [0.28, -0.15, 0.36],
  [0.32, 0.36, 0.26],
  [-0.9, 0.85, 0.24],
  [0.42, -0.72, 0.2],
  [0.55, 0.08, 0.15],
];
/** Where the pool pours from, as a share of the abdomen's length from the waist: the tear's tail end. */
const SPILL_SOURCE_SHARE = 0.9;
/** A freshly spilled pool is this share of its full size; it spreads to all of it. */
const SPILL_START_SIZE = 0.3;
const SPILL_BLOB_POINTS = 24;
const SPILL_BLOB_LOBES: readonly (readonly [number, number])[] = [
  [3, 0.06],
  [5, 0.035],
];
const SPILL_EDGE_WIDTH = 0.05;
const SPILL_ALPHA = 0.92;
/** A lighter, shallower sheet of ichor inside each blob, set toward the tail-facing light. */
const SPILL_LIGHT_SHARE = 0.55;
const SPILL_LIGHT_SHIFT = 0.25;
const SPILL_LIGHT_ALPHA = 0.45;
const SPILL_LIT_BLOBS = 3;
/** Wet highlights on the pool: [blob, angle, length], hard streaks rather than a soft cloud. */
const SPILL_GLINTS: readonly (readonly [number, number, number])[] = [
  [0, 2.4, 0.22],
  [1, 0.5, 0.24],
  [2, -0.6, 0.16],
  [3, -0.3, 0.18],
  [4, 0.9, 0.12],
];
const SPILL_GLINT_WIDTH = 0.04;
const SPILL_GLINT_ALPHA = 0.95;
const SPILL_SEED = 151;

/**
 * Dead eggs poured out of the torn sac: how far past her tail each has rolled,
 * and how far aside, in tiles at a full spill. A loose, fanned trail rather
 * than a ring, so it reads as having come out of her.
 */
const DEAD_EGG_SPREAD: readonly (readonly [number, number])[] = [
  [0.05, -0.1],
  [0.14, -0.36],
  [0.26, -0.56],
  [0.3, 0.06],
  [0.42, -0.26],
  [0.18, 0.3],
  [0.46, -0.62],
  [0.02, -0.72],
  [0.36, 0.32],
  [0.52, -0.04],
];
const DEAD_EGG_RADIUS = 0.1;
/** Where along the abdomen the dead eggs pour out: the tear's tail end. */
const DEAD_EGG_START_SHARE = 0.85;
const DEAD_EGG_ASPECT = 0.78;
/** How far the spill carries the furthest dead egg past where it poured out, against its spread. */
const DEAD_EGG_ROLL = 0.9;
/** Eggs appear over the first two-thirds of the spill, one after another. */
const DEAD_EGG_APPEAR_RATE = 1.5;

function spillBlobPath(ctx: Ctx, x: number, y: number, r: number, seed: number): void {
  for (let i = 0; i <= SPILL_BLOB_POINTS; i++) {
    const a = (i / SPILL_BLOB_POINTS) * TWO_PI;
    let k = 1;
    SPILL_BLOB_LOBES.forEach(([frequency, depth], lobe) => {
      k += Math.sin(a * frequency + hash01(seed + lobe) * TWO_PI) * depth;
    });
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    else ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
  }
  ctx.closePath();
}

function drawDeathSpill(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.spill <= 0) return;
  const tail = abdomenTailDistance(solve);
  const source = alongAbdomen(solve, tail * SPILL_SOURCE_SHARE);
  const backX = Math.sin(solve.abdomen.angle);
  const backY = -Math.cos(solve.abdomen.angle);
  const size = lerp(SPILL_START_SIZE, 1, solve.spill);
  const blobs = SPILL_BLOBS.map(([back, aside, radius], i) => ({
    x: source.x + (backX * back - backY * aside) * size,
    y: source.y + (backY * back + backX * aside) * size,
    r: radius * size,
    seed: SPILL_SEED + i * SPILL_BLOB_LOBES.length,
  }));
  const union = (grow: number): void => {
    ctx.beginPath();
    for (const blob of blobs) spillBlobPath(ctx, blob.x, blob.y, blob.r + grow, blob.seed);
  };
  const alpha = SPILL_ALPHA * solve.spill;
  // Every blob is filled in one path, so where they overlap they merge into
  // one pool instead of stacking into darker rings.
  ctx.fillStyle = rgba(PALETTE.ichorEdge, alpha);
  union(SPILL_EDGE_WIDTH);
  ctx.fill('nonzero');
  ctx.fillStyle = rgba(PALETTE.ichor, alpha);
  union(0);
  ctx.fill('nonzero');
  ctx.fillStyle = rgba(PALETTE.ichorLight, SPILL_LIGHT_ALPHA * solve.spill);
  ctx.beginPath();
  // One shallow sheet on each of the biggest blobs only: a light patch on
  // every lobe turns the pool into a cauliflower or a bush.
  for (const blob of blobs.slice(0, SPILL_LIT_BLOBS)) {
    spillBlobPath(
      ctx,
      blob.x + backX * blob.r * SPILL_LIGHT_SHIFT,
      blob.y + backY * blob.r * SPILL_LIGHT_SHIFT,
      blob.r * SPILL_LIGHT_SHARE,
      blob.seed + 1,
    );
  }
  ctx.fill('nonzero');
  for (const [index, angle, length] of SPILL_GLINTS) {
    const blob = blobs[index];
    const cx = blob.x + backX * blob.r * SPILL_LIGHT_SHIFT;
    const cy = blob.y + backY * blob.r * SPILL_LIGHT_SHIFT;
    const dx = Math.cos(angle) * length * size * HALF;
    const dy = Math.sin(angle) * length * size * HALF;
    strokeLine(
      ctx,
      { x: cx - dx, y: cy - dy },
      { x: cx + dx, y: cy + dy },
      rgba(PALETTE.ichorGloss, SPILL_GLINT_ALPHA * solve.spill),
      SPILL_GLINT_WIDTH,
    );
  }
  const shown = Math.ceil(DEAD_EGG_SPREAD.length * clamp01(solve.spill * DEAD_EGG_APPEAR_RATE));
  const start = tail * DEAD_EGG_START_SHARE;
  for (let i = 0; i < shown; i++) {
    const [back, aside] = DEAD_EGG_SPREAD[i];
    const at = alongAbdomen(solve, start + back * DEAD_EGG_ROLL * solve.spill);
    const x = at.x + aside * solve.spill;
    const y = at.y;
    const tilt = hash01(i) * Math.PI;
    ctx.fillStyle = PALETTE.deadEggDark;
    ctx.beginPath();
    ctx.ellipse(
      x,
      y,
      DEAD_EGG_RADIUS + OUTLINE_WIDTH,
      DEAD_EGG_RADIUS * DEAD_EGG_ASPECT + OUTLINE_WIDTH,
      tilt,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = PALETTE.deadEgg;
    ctx.beginPath();
    ctx.ellipse(x, y, DEAD_EGG_RADIUS, DEAD_EGG_RADIUS * DEAD_EGG_ASPECT, tilt, 0, TWO_PI);
    ctx.fill();
  }
}

function drawGroundLayer(ctx: Ctx, solve: SpiderSolve): void {
  drawDeathSpill(ctx, solve);
  const shadowCentre = { x: solve.waist.x, y: solve.waist.y - BODY_SHADOW_BACK };
  fillSoftEllipse(
    ctx,
    shadowCentre.x,
    shadowCentre.y,
    BODY_SHADOW_RX,
    BODY_SHADOW_RY,
    PALETTE.shadow,
    BODY_SHADOW_ALPHA,
    solve.abdomen.angle * HALF,
    BODY_SHADOW_CORE,
  );
  drawSlamCracks(ctx, solve);
  for (const leg of solve.legs) drawLegShadow(ctx, leg);
  // The egg's shadow lies on the floor straight below it, apart from the egg
  // itself: that gap is what reads as an egg hanging in the air.
  const held = solve.heldEgg;
  if (held !== null) {
    const shadow = shadowOf(held.at);
    fillSoftEllipse(
      ctx,
      shadow.x,
      shadow.y,
      held.radius,
      held.radius * EGG_SHADOW_ASPECT,
      PALETTE.shadow,
      LEG_SHADOW_ALPHA,
    );
  }
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/**
 * A leg rising past the height a standing leg's segments ride at loses its
 * pale rim and most of its sheen, fully gone this much higher. Its height is
 * carried by the gap to its cast shadow; a raised leg lit pale along its whole
 * length reads at game size as a tusk.
 */
const LEG_RESTING_HEIGHT = 0.6;
const LEG_RAISE_RISE = 0.8;
const RAISED_SHEEN_DIM = 0.7;
const RAISED_KNEE_GLINT_DIM = 0.6;
/**
 * A raised leg's tarsus ends in a longer, harder-hooked claw: held up, the
 * foot is a weapon, and a blunt tip on a raised limb is the end of a tusk.
 */
const RAISED_CLAW_LENGTH = 0.18;
const RAISED_CLAW_WIDTH = 0.055;
const RAISED_CLAW_HOOK = 1.5;
/**
 * A soft sheen down the middle of each segment rather than a hard crest line:
 * a highlight line along a dark limb, beside its rim, is two stripes down a
 * pipe.
 */
const LEG_SHEEN_LENGTH_SHARE = 0.34;
const LEG_SHEEN_WIDTH_SHARE = 0.28;
const LEG_SHEEN_ALPHA = 0.5;
/**
 * A pale rim down the tail-facing edge of every segment. The legs are the
 * darkest thing on her and the lab floor is dark too: without it they vanish
 * at 32 px. It stops short of both joints, so each segment's rim is its own
 * stroke; one unbroken from root to claw reads as polished tubing.
 */
const LEG_RIM_WIDTH = 0.045;
const LEG_RIM_ALPHA = 0.9;
/** Where along each segment the rim runs, as [from, to] shares. */
const LEG_RIM_DASHES: readonly (readonly [number, number])[] = [[0.12, 0.82]];

/**
 * Each segment swells somewhere along its length rather than tapering
 * straight, and its two edges swell differently, so no two segments are the
 * same tube. How far past a straight taper the swell reaches, and how much that
 * varies from segment to segment, as shares of the segment's width.
 */
const SEGMENT_PROFILE_STEPS = 10;
const SEGMENT_SWELL = 0.22;
const SEGMENT_SWELL_JITTER = 0.18;
/** Where along the segment the swell peaks is pushed toward the root or the tip by up to this. */
const SEGMENT_SWELL_SKEW = 0.45;
const SEGMENT_EDGE_WOBBLE = 0.1;
/** How much one leg is thicker or thinner than another of its kind. */
const LEG_GIRTH_JITTER = 0.1;
/** Spaces the hash seeds of one leg's segments so no two legs share a profile. */
const LEG_SEED_STRIDE = 13;

/**
 * Bristles fringing the femur and tibia on both edges: [count per edge, base
 * length, extra length range], in tiles. The metatarsus is left bare: its hairs
 * would stand past the foot, the part of her that already reaches furthest. Long and dense enough to break the
 * leg's outline into a hairy silhouette at 32 px; a share of them is left out
 * so the fringe comes in tufts rather than as an even comb.
 */
const LEG_HAIR: readonly (readonly [number, number, number])[] = [
  [18, 0.11, 0.11],
  [14, 0.09, 0.09],
];
const LEG_HAIR_WIDTH = 0.034;
/** Hairs lean down the leg toward its tip, as real setae do. */
const LEG_HAIR_LEAN = 0.5;
const LEG_HAIR_BALD_SHARE = 0.22;
/**
 * A share of the bristles are pale, catching the light: a fringe of dark hair
 * on a dark leg over a dark floor only thickens the leg, where pale setae
 * among it read as hair.
 */
const LEG_PALE_BRISTLE_SHARE = 0.4;
/** Where along a segment the fringe runs. */
const LEG_HAIR_FROM = 0.08;
const LEG_HAIR_TO = 0.92;

/**
 * The knee is a lumpy swelling along the leg, pushed out on the outside of the
 * bend, with a second smaller lump behind it; the other joints are only the
 * segments' own rounded ends. A round bead at every joint reads as a ball
 * joint on a machine.
 */
const KNEE_KNOB_ALONG = 0.95;
const KNEE_KNOB_ACROSS = 0.6;
const KNOB_BEND_OFFSET = 0.22;
const KNOB_SECOND_SCALE = 0.7;
const KNOB_SECOND_BACK = 0.8;
/** The knee is the leg's second joint, between femur and tibia. */
const KNEE_JOINT = 1;
/** A soft sheen across the top of the knee, the highest point of the leg; a hard dot there reads as a rivet. */
const KNEE_GLINT_SCALE = 0.7;
const KNEE_GLINT_ALPHA = 0.75;

const CLAW_LENGTH = 0.11;
const CLAW_WIDTH = 0.04;
const CLAW_HOOK = 0.9;
/** The withered leg's claw is an almost-hand: three hooked fingers. */
const HAND_FINGER_SPREAD = 0.55;
const HAND_FINGER_LENGTH = 0.15;
const HAND_FINGER_WIDTH = 0.04;
const HAND_FINGER_HOOK = 1.3;
const HAND_FINGERS = 3;

/**
 * The stump's end: a swollen, cauterised knot of flesh wider than the limb,
 * sewn with heavy black stitches, and a steel cap bolted over the cut with a
 * single bright glint. The knot is what makes it a cut limb and not a peg; the
 * glint is what makes the cap metal. The knot stays dark: a bright red ring
 * round a pale cap is an eye.
 */
const STUMP_KNOT_SCALE = 0.95;
const STUMP_KNOT_LENGTH = 0.65;
const STUMP_STITCH_WIDTH = 0.032;
const STUMP_STITCHES = 2;
const STUMP_CAP_RADIUS = 0.1;
const STUMP_CAP_REACH = 0.55;
const STUMP_CAP_ASPECT = 0.62;
const STUMP_GLINT_RADIUS = 0.026;

interface LegColours {
  readonly dark: string;
  readonly ridge: string;
}

const NORMAL_COLOURS: LegColours = { dark: PALETTE.legDark, ridge: PALETTE.legRidge };
const WITHERED_COLOURS: LegColours = { dark: PALETTE.witheredDark, ridge: PALETTE.witheredRidge };

/** A hooked, tapering claw from `at`, pointing along `angle`. */
function drawHook(
  ctx: Ctx,
  at: P2,
  angle: number,
  length: number,
  width: number,
  hook: number,
): void {
  const tip = {
    x: at.x + Math.cos(angle) * length,
    y: at.y + Math.sin(angle) * length,
  };
  const bend = {
    x: at.x + Math.cos(angle - hook * HALF) * length * HALF,
    y: at.y + Math.sin(angle - hook * HALF) * length * HALF,
  };
  const side = { x: -Math.sin(angle) * width * HALF, y: Math.cos(angle) * width * HALF };
  ctx.beginPath();
  ctx.moveTo(at.x + side.x, at.y + side.y);
  ctx.quadraticCurveTo(bend.x, bend.y, tip.x, tip.y);
  ctx.quadraticCurveTo(bend.x - side.x, bend.y - side.y, at.x - side.x, at.y - side.y);
  ctx.closePath();
  ctx.fillStyle = PALETTE.bone;
  ctx.fill();
  ctx.strokeStyle = PALETTE.boneDark;
  ctx.lineWidth = OUTLINE_WIDTH * HALF;
  ctx.stroke();
}

/** The shape one segment's edges swell to, fixed per segment by its seed. */
interface SegmentProfile {
  readonly swell: number;
  readonly skew: number;
  readonly wobblePhase: number;
}

function segmentProfile(seed: number): SegmentProfile {
  return {
    swell: SEGMENT_SWELL + (hash01(seed) - HALF) * SEGMENT_SWELL_JITTER * 2,
    skew: (hash01(seed + 1) - HALF) * SEGMENT_SWELL_SKEW * 2,
    wobblePhase: hash01(seed + 2) * TWO_PI,
  };
}

/**
 * The half-width of a segment at `t` along it, on one `side`. It swells to a
 * peak somewhere along its length and the two edges wobble apart, but it meets
 * the straight taper exactly at both ends, so neighbouring segments join.
 */
function segmentHalfWidth(
  t: number,
  side: number,
  wa: number,
  wb: number,
  profile: SegmentProfile,
): number {
  const skewed = clamp01(t + profile.skew * t * (1 - t));
  const envelope = Math.sin(skewed * Math.PI);
  const wobble = 1 + side * SEGMENT_EDGE_WOBBLE * Math.sin(t * TWO_PI + profile.wobblePhase);
  return lerp(wa, wb, t) * HALF * (1 + profile.swell * envelope * wobble);
}

/** A segment's outline, swollen and uneven, grown by `grow` on every side. */
function segmentPath(
  ctx: Ctx,
  a: P2,
  b: P2,
  wa: number,
  wb: number,
  profile: SegmentProfile,
  grow: number,
): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const edge = (t: number, side: number): P2 => {
    const w = segmentHalfWidth(t, side, wa, wb, profile) + grow;
    const along = pointAlong(a, b, t);
    return { x: along.x + nx * w * side, y: along.y + ny * w * side };
  };
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa * HALF + grow, angle + QUARTER_TURN, angle - QUARTER_TURN);
  for (let k = 1; k < SEGMENT_PROFILE_STEPS; k++) {
    const p = edge(k / SEGMENT_PROFILE_STEPS, -1);
    ctx.lineTo(p.x, p.y);
  }
  ctx.arc(b.x, b.y, wb * HALF + grow, angle - QUARTER_TURN, angle + QUARTER_TURN);
  for (let k = SEGMENT_PROFILE_STEPS - 1; k > 0; k--) {
    const p = edge(k / SEGMENT_PROFILE_STEPS, 1);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** Tapered bristles standing off both edges of one segment, in tufts. */
function drawLegHair(
  ctx: Ctx,
  a: P2,
  b: P2,
  wa: number,
  wb: number,
  profile: SegmentProfile,
  hair: readonly [number, number, number],
  seed: number,
): void {
  const [count, baseLength, lengthRange] = hair;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  for (const side of [-1, 1]) {
    for (let k = 0; k < count; k++) {
      const hairSeed = seed + k * 2 + (side > 0 ? 1 : 0);
      if (hash01(hairSeed * LEG_SEED_STRIDE) < LEG_HAIR_BALD_SHARE) continue;
      ctx.fillStyle =
        hash01(hairSeed + LEG_SEED_STRIDE) < LEG_PALE_BRISTLE_SHARE
          ? PALETTE.legBristle
          : PALETTE.legHair;
      const t = lerp(LEG_HAIR_FROM, LEG_HAIR_TO, (k + hash01(hairSeed) * HALF) / count);
      const reach = segmentHalfWidth(t, side, wa, wb, profile);
      const normal = angle + side * QUARTER_TURN;
      const along = pointAlong(a, b, t);
      const root = {
        x: along.x + Math.cos(normal) * reach * HALF,
        y: along.y + Math.sin(normal) * reach * HALF,
      };
      const out = angle + side * (QUARTER_TURN - LEG_HAIR_LEAN);
      const length = reach * HALF + baseLength + hash01(hairSeed + 1) * lengthRange;
      const tip = { x: root.x + Math.cos(out) * length, y: root.y + Math.sin(out) * length };
      const half = LEG_HAIR_WIDTH * HALF;
      ctx.beginPath();
      ctx.moveTo(root.x - Math.cos(angle) * half, root.y - Math.sin(angle) * half);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(root.x + Math.cos(angle) * half, root.y + Math.sin(angle) * half);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** A joint knob's centre: pushed out on the outside of the bend it sits in. */
function knobCentre(before: P2, at: P2, after: P2, width: number): P2 {
  const inLength = Math.hypot(at.x - before.x, at.y - before.y);
  const outLength = Math.hypot(after.x - at.x, after.y - at.y);
  if (inLength < Number.EPSILON || outLength < Number.EPSILON) return at;
  const bendX = (at.x - before.x) / inLength - (after.x - at.x) / outLength;
  const bendY = (at.y - before.y) / inLength - (after.y - at.y) / outLength;
  const bend = Math.hypot(bendX, bendY);
  if (bend < Number.EPSILON) return at;
  const push = width * KNOB_BEND_OFFSET;
  return { x: at.x + (bendX / bend) * push, y: at.y + (bendY / bend) * push };
}

interface JointKnob {
  readonly main: P2;
  readonly second: P2;
  readonly along: number;
  readonly across: number;
  readonly angle: number;
}

function kneeKnob(before: P2, at: P2, after: P2, width: number): JointKnob {
  const main = knobCentre(before, at, after, width);
  const angle = Math.atan2(after.y - before.y, after.x - before.x);
  const along = width * KNEE_KNOB_ALONG;
  const back = along * KNOB_SECOND_BACK;
  const second = { x: main.x - Math.cos(angle) * back, y: main.y - Math.sin(angle) * back };
  return { main, second, along, across: width * KNEE_KNOB_ACROSS, angle };
}

function fillKnob(ctx: Ctx, knob: JointKnob, grow: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(
    knob.main.x,
    knob.main.y,
    knob.along + grow,
    knob.across + grow,
    knob.angle,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    knob.second.x,
    knob.second.y,
    knob.along * KNOB_SECOND_SCALE + grow,
    knob.across * KNOB_SECOND_SCALE + grow,
    knob.angle,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/** A lit line down the tail-facing edge of a segment, just inside its outline. */
function drawLegRim(ctx: Ctx, a: P2, b: P2, widthA: number, widthB: number, alpha: number): void {
  if (alpha <= 0) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < Number.EPSILON) return;
  let nx = -(b.y - a.y) / length;
  let ny = (b.x - a.x) / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  for (const [fromShare, toShare] of LEG_RIM_DASHES) {
    const from = pointAlong(a, b, fromShare);
    const to = pointAlong(a, b, toShare);
    const insetA = Math.max(lerp(widthA, widthB, fromShare) * HALF - LEG_RIM_WIDTH, 0);
    const insetB = Math.max(lerp(widthA, widthB, toShare) * HALF - LEG_RIM_WIDTH, 0);
    strokeLine(
      ctx,
      { x: from.x + nx * insetA, y: from.y + ny * insetA },
      { x: to.x + nx * insetB, y: to.y + ny * insetB },
      rgba(PALETTE.legRim, alpha),
      LEG_RIM_WIDTH,
    );
  }
}

function drawStumpEnd(ctx: Ctx, from: P2, cap: P2, width: number): void {
  const angle = Math.atan2(cap.y - from.y, cap.x - from.x);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const across = { x: -along.y, y: along.x };
  const knot = width * STUMP_KNOT_SCALE;
  const knotLength = knot * STUMP_KNOT_LENGTH;
  ctx.fillStyle = PALETTE.outline;
  ctx.beginPath();
  ctx.ellipse(cap.x, cap.y, knotLength + OUTLINE_WIDTH, knot + OUTLINE_WIDTH, angle, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = PALETTE.fleshDark;
  ctx.beginPath();
  ctx.ellipse(cap.x, cap.y, knotLength, knot, angle, 0, TWO_PI);
  ctx.fill();
  for (let i = 0; i < STUMP_STITCHES; i++) {
    const offset = ((i + HALF) / STUMP_STITCHES - HALF) * knot;
    const centre = { x: cap.x + across.x * offset, y: cap.y + across.y * offset };
    strokeLine(
      ctx,
      { x: centre.x - along.x * knotLength, y: centre.y - along.y * knotLength },
      { x: centre.x + along.x * knotLength, y: centre.y + along.y * knotLength },
      PALETTE.outline,
      STUMP_STITCH_WIDTH,
    );
  }
  const capAt = {
    x: cap.x + along.x * knotLength * STUMP_CAP_REACH,
    y: cap.y + along.y * knotLength * STUMP_CAP_REACH,
  };
  ctx.fillStyle = PALETTE.outline;
  ctx.beginPath();
  ctx.ellipse(
    capAt.x,
    capAt.y,
    STUMP_CAP_RADIUS * STUMP_CAP_ASPECT + OUTLINE_WIDTH * HALF,
    STUMP_CAP_RADIUS + OUTLINE_WIDTH * HALF,
    angle,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = PALETTE.metalDark;
  ctx.beginPath();
  ctx.ellipse(
    capAt.x,
    capAt.y,
    STUMP_CAP_RADIUS * STUMP_CAP_ASPECT,
    STUMP_CAP_RADIUS,
    angle,
    0,
    TWO_PI,
  );
  ctx.fill();
  fillCircle(
    ctx,
    capAt.x - across.x * STUMP_GLINT_RADIUS,
    capAt.y - across.y * STUMP_GLINT_RADIUS,
    STUMP_GLINT_RADIUS,
    PALETTE.metalLight,
  );
}

function legGirthVariation(index: number): number {
  return 1 + (hash01(index * LEG_SEED_STRIDE + 1) - HALF) * LEG_GIRTH_JITTER * 2;
}

function drawLeg(ctx: Ctx, leg: SolvedLeg): void {
  const points = leg.joints.map(project);
  const scales = leg.joints.map((joint) => perspectiveScale(joint.h));
  const girth = leg.desc.girth * legGirthVariation(leg.index);
  const widths = legWidths(leg).map((w, i) => w * girth * scales[i]);
  const withered = leg.desc.kind === 'withered';
  const stump = leg.desc.kind === 'stump';
  const colours = withered ? WITHERED_COLOURS : NORMAL_COLOURS;
  const segments = points.length - 1;
  const seedOf = (i: number): number => (leg.index * segments + i) * LEG_SEED_STRIDE;
  const profiles = Array.from({ length: segments }, (_, i) => segmentProfile(seedOf(i)));
  const knee =
    segments > KNEE_JOINT
      ? kneeKnob(points[0], points[KNEE_JOINT], points[2], widths[KNEE_JOINT])
      : null;

  if (!stump) {
    for (let i = 0; i < Math.min(LEG_HAIR.length, segments); i++) {
      drawLegHair(
        ctx,
        points[i],
        points[i + 1],
        widths[i],
        widths[i + 1],
        profiles[i],
        LEG_HAIR[i],
        seedOf(i),
      );
    }
  }
  ctx.fillStyle = PALETTE.outline;
  for (let i = 0; i < segments; i++) {
    segmentPath(
      ctx,
      points[i],
      points[i + 1],
      widths[i],
      widths[i + 1],
      profiles[i],
      OUTLINE_WIDTH,
    );
    ctx.fill();
  }
  if (knee !== null) fillKnob(ctx, knee, OUTLINE_WIDTH, PALETTE.outline);

  const raisedOf = (i: number): number => {
    const height = (leg.joints[i].h + leg.joints[i + 1].h) * HALF;
    return clamp01((height - LEG_RESTING_HEIGHT) / LEG_RAISE_RISE);
  };
  for (let i = 0; i < segments; i++) {
    const a = points[i];
    const b = points[i + 1];
    const raised = raisedOf(i);
    // Near-black inside, a rim of light down the edge that faces her tail —
    // the light hangs behind her, as her cast shadows say — and a soft sheen
    // down the crest: a dark limb with one lit edge reads as round and stays
    // a single clean stroke against the floor at 32 px.
    ctx.fillStyle = colours.dark;
    segmentPath(ctx, a, b, widths[i], widths[i + 1], profiles[i], 0);
    ctx.fill();
    drawLegRim(ctx, a, b, widths[i], widths[i + 1], LEG_RIM_ALPHA * (1 - raised));
    const middle = pointAlong(a, b, HALF);
    fillSoftEllipse(
      ctx,
      middle.x,
      middle.y,
      Math.hypot(b.x - a.x, b.y - a.y) * LEG_SHEEN_LENGTH_SHARE,
      Math.min(widths[i], widths[i + 1]) * LEG_SHEEN_WIDTH_SHARE,
      colours.ridge,
      LEG_SHEEN_ALPHA * (1 - raised * RAISED_SHEEN_DIM),
      Math.atan2(b.y - a.y, b.x - a.x),
    );
  }
  const tipRaised = raisedOf(segments - 1);
  if (knee !== null) {
    const raised = Math.max(raisedOf(0), raisedOf(KNEE_JOINT));
    fillKnob(ctx, knee, 0, colours.dark);
    fillSoftEllipse(
      ctx,
      knee.main.x,
      knee.main.y,
      knee.along * KNEE_GLINT_SCALE,
      knee.across * KNEE_GLINT_SCALE,
      PALETTE.legKnee,
      KNEE_GLINT_ALPHA * (1 - raised * RAISED_KNEE_GLINT_DIM),
      knee.angle,
    );
  }

  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const tipAngle = Math.atan2(tip.y - before.y, tip.x - before.x);
  if (stump) {
    drawStumpEnd(ctx, before, tip, widths[widths.length - 1]);
  } else if (withered) {
    for (let f = 0; f < HAND_FINGERS; f++) {
      const fan = (f / (HAND_FINGERS - 1) - HALF) * HAND_FINGER_SPREAD * 2;
      drawHook(
        ctx,
        tip,
        tipAngle + fan,
        HAND_FINGER_LENGTH,
        HAND_FINGER_WIDTH,
        HAND_FINGER_HOOK * leg.desc.side,
      );
    }
  } else {
    drawHook(
      ctx,
      tip,
      tipAngle,
      lerp(CLAW_LENGTH, RAISED_CLAW_LENGTH, tipRaised),
      lerp(CLAW_WIDTH, RAISED_CLAW_WIDTH, tipRaised),
      lerp(CLAW_HOOK, RAISED_CLAW_HOOK, tipRaised) * leg.desc.side,
    );
  }
}

// ── Abdomen ──────────────────────────────────────────────────────────────────

const ABDOMEN_OUTLINE_POINTS = 72;
/**
 * The abdomen is a heavy teardrop: broad behind the waist, widest just ahead
 * of its middle, tapering to a blunt point at the spinnerets. The taper is
 * what makes it a tail; an even oval reads as a second head.
 */
const ABDOMEN_FRONT_PINCH = 0.12;
const ABDOMEN_REAR_TAPER = 0.38;
/** The tail draws out past the oval into a blunt point at the spinnerets. */
const ABDOMEN_TAIL_POINT = 0.04;
const ABDOMEN_TAIL_SHARPNESS = 6;
const ABDOMEN_LUMPS: readonly (readonly [number, number, number])[] = [
  [3, 0.03, 0.7],
  [5, 0.02, 2.1],
  [7, 0.012, 4.4],
];
/**
 * Tumours swelling out of her flanks: [angle round the outline, radians;
 * height, in abdomen radii; half-width, radians]. Lopsided on purpose: a
 * smooth symmetric abdomen reads as a fruit.
 */
const ABDOMEN_TUMOURS: readonly (readonly [number, number, number])[] = [
  [2.55, 0.09, 0.3],
  [5.75, 0.07, 0.26],
  [3.9, 0.05, 0.2],
];
const DEFLATE_WRINKLE_FREQUENCY = 11;
const DEFLATE_WRINKLE_DEPTH = 0.045;

/** A point on the abdomen's outline at `theta`; local +y points at the waist. */
function abdomenPoint(theta: number, rx: number, ry: number, deflate: number): P2 {
  let r = 1;
  for (const [frequency, amplitude, phase] of ABDOMEN_LUMPS) {
    r += Math.sin(theta * frequency + phase) * amplitude;
  }
  for (const [at, height, halfWidth] of ABDOMEN_TUMOURS) {
    const offset = Math.atan2(Math.sin(theta - at), Math.cos(theta - at)) / halfWidth;
    r += height * Math.exp(-offset * offset);
  }
  r -= deflate * DEFLATE_WRINKLE_DEPTH * (1 + Math.sin(theta * DEFLATE_WRINKLE_FREQUENCY));
  const front = Math.max(0, Math.sin(theta));
  const rear = Math.max(0, -Math.sin(theta));
  const width = 1 - ABDOMEN_FRONT_PINCH * front * front - ABDOMEN_REAR_TAPER * rear * rear;
  const length = 1 + ABDOMEN_TAIL_POINT * rear ** ABDOMEN_TAIL_SHARPNESS;
  return { x: Math.cos(theta) * rx * r * width, y: Math.sin(theta) * ry * r * length };
}

function abdomenOutlinePath(ctx: Ctx, rx: number, ry: number, deflate: number): void {
  ctx.beginPath();
  for (let i = 0; i <= ABDOMEN_OUTLINE_POINTS; i++) {
    const p = abdomenPoint((i / ABDOMEN_OUTLINE_POINTS) * TWO_PI, rx, ry, deflate);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/**
 * Bruises blotching the hide, in abdomen radii: big, overlapping, and in
 * several sick colours, so the hide reads as rotting skin rather than as a
 * pattern.
 */
const BRUISES: readonly {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
  readonly colour: string;
  readonly alpha: number;
}[] = [
  { x: -0.6, y: 0.2, rx: 0.34, ry: 0.24, angle: 0.4, colour: PALETTE.bruiseBile, alpha: 0.5 },
  { x: 0.55, y: -0.05, rx: 0.3, ry: 0.4, angle: -0.3, colour: PALETTE.bruiseNecrotic, alpha: 0.6 },
  { x: -0.5, y: -0.6, rx: 0.3, ry: 0.22, angle: 0.8, colour: PALETTE.bruiseSlate, alpha: 0.6 },
  { x: 0.35, y: 0.55, rx: 0.3, ry: 0.18, angle: 0.2, colour: PALETTE.bruiseRot, alpha: 0.6 },
  { x: -0.72, y: -0.2, rx: 0.18, ry: 0.3, angle: 0, colour: PALETTE.bruiseNecrotic, alpha: 0.55 },
  { x: 0.1, y: 0.8, rx: 0.34, ry: 0.14, angle: 0.1, colour: PALETTE.bruiseBile, alpha: 0.35 },
];

/**
 * Small blotches freckling the whole hide, placed by hash: pale dead patches,
 * rot-brown and bile spots. Each is two or three pixels across at 32 px, the
 * smallest mark that still reads as skin texture rather than noise.
 */
const MOTTLE_COUNT = 18;
const MOTTLE_MIN_RADIUS = 0.06;
const MOTTLE_RADIUS_RANGE = 0.08;
const MOTTLE_MIN_ALPHA = 0.35;
const MOTTLE_ALPHA_RANGE = 0.25;
/** Keeps mottles clear of the outline, where the rim already carries the edge. */
const MOTTLE_REACH = 0.85;
const MOTTLE_SEED = 97;
const MOTTLE_COLOURS: readonly string[] = [
  PALETTE.mottleGrey,
  PALETTE.bruiseRot,
  PALETTE.bruiseBile,
  PALETTE.mottleGrey,
  PALETTE.bruiseNecrotic,
];

/**
 * Veins swelling under the hide, each a trunk with one fork: [start x, start
 * y, bend x, bend y, end x, end y, fork share, fork end x, fork end y], in
 * abdomen radii. Dark engorged veins, and a couple gone bile-pale.
 */
const HIDE_VEINS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [-0.95, 0.35, -0.6, 0.6, -0.15, 0.9, 0.5, -0.55, 0.9],
  [0.92, 0.3, 0.72, 0.62, 0.3, 0.86, 0.45, 0.72, 0.85],
  [-0.9, -0.5, -0.72, -0.25, -0.78, 0.1, 0.55, -0.45, -0.1],
  [0.88, -0.45, 0.8, -0.1, 0.62, 0.2, 0.4, 0.95, 0.0],
];
const HIDE_BILE_VEINS = 2;
const HIDE_VEIN_WIDTH = 0.04;
const HIDE_VEIN_TIP_SHARE = 0.55;
const HIDE_VEIN_ALPHA = 0.8;
const HIDE_BILE_VEIN_ALPHA = 0.6;

/**
 * A wet sheen on the hide's crown, toward the waist where it rides highest: a
 * soft sheet and one hard glint. Without it the hide reads as dry felt.
 */
const HIDE_SHEEN = { x: 0.12, y: 0.5, rx: 0.34, ry: 0.16, angle: -0.35, alpha: 0.3 } as const;
const HIDE_GLINT = { x: 0.22, y: 0.56, r: 0.035, alpha: 0.5 } as const;

/** The egg-sac panel, in abdomen radii: a stretched window over the rear of her back. */
const SAC_CENTRE_Y = -0.2;
const SAC_RX = 0.46;
const SAC_RY = 0.52;
/**
 * The clutch, in sac radii: [u, v, size], listed tail first so each egg nearer
 * the waist is painted over the one behind it. Few enough and big enough to
 * count at game size, packed so they press on each other with only slivers of
 * wet cavity between: many small eggs average into one mottled patch at 32 px,
 * and eggs spaced apart leave dark holes between them that read as a face.
 */
const SAC_EGGS: readonly (readonly [number, number, number])[] = [
  [-0.28, -0.52, 0.29],
  [0.24, -0.56, 0.25],
  [0.54, -0.18, 0.23],
  [-0.56, -0.04, 0.26],
  [-0.05, -0.12, 0.33],
  [0.36, 0.24, 0.29],
  [-0.3, 0.44, 0.28],
  [0.16, 0.63, 0.22],
];
/** Eggs are ovoid, longer along her body than across it. */
const EGG_ASPECT = 1.08;
/** How far the eggs are pushed tailward, in sac radii, across one full shove. */
const EGG_SHOVE_TRAVEL = 0.9;
const EGG_PULSE_SIZE = 0.1;
const EGG_PULSE_PHASE_STEP = 0.137;
/** A dark wet gap round every egg, so neighbours never merge into one pale mass. */
const EGG_GAP = 0.014;
/** Each egg's crown is lit a little toward the waist, where the membrane rides highest. */
const EGG_CROWN_OFFSET = 0.3;
const EGG_SHADE_STOP = 0.72;
/** One hard glint per egg: wet shell, and a cue to count them by. */
const EGG_GLINT_SHARE = 0.11;
const EGG_GLINT_OFFSET = 0.35;
/**
 * A dark curled embryo showing through every egg's shell, sitting low in it:
 * pale discs with nothing inside read as cookies or seeds, and something
 * curled up in each is what makes them eggs about to hatch.
 */
const EMBRYO_CURL_SHARE = 0.38;
const EMBRYO_CURL_ARC = Math.PI * 1.3;
const EMBRYO_WIDTH_SHARE = 0.3;
const EMBRYO_DROP = 0.12;
const EMBRYO_ALPHA = 0.7;
const EMBRYO_SEED = 41;
/** An emptied sac shows far fewer eggs through it: most of the clutch is on the floor. */
const EMPTIED_EGG_FADE = 0.45;
/** The cavity is lit from its centre out to raw red walls. */
const CAVITY_WALL_STOP = 0.4;
/** The wet arc round the cavity's tail-facing wall, where the light is: [from, to] radians. */
const CAVITY_WET_FROM = Math.PI * 1.1;
const CAVITY_WET_TO = Math.PI * 1.9;
const CAVITY_WET_INSET = 0.82;
const CAVITY_WET_WIDTH = 0.035;
const CAVITY_WET_ALPHA = 0.55;

/**
 * The membrane stretched over the cavity, torn open in the middle: a
 * translucent pale sheet round the edge of the window with a ragged hole
 * through which the eggs show. How far out the hole reaches, as a share of the
 * window, and how ragged its edge is.
 */
const MEMBRANE_ALPHA = 0.55;
const MEMBRANE_HOLE_SHARE = 0.64;
const MEMBRANE_HOLE_POINTS = 28;
const MEMBRANE_TEAR_DEPTH = 0.2;
const MEMBRANE_TEAR_RAGGED = 0.12;
const MEMBRANE_LIP_WIDTH = 0.03;
const MEMBRANE_LIP_ALPHA = 0.6;
const MEMBRANE_SEED = 211;
/** Pale sickly veins across the membrane band: [angle round the window, length share]. */
const MEMBRANE_VEINS: readonly (readonly [number, number])[] = [
  [0.4, 0.9],
  [1.5, 0.7],
  [2.7, 0.85],
  [3.9, 0.75],
  [5.2, 0.9],
];
const MEMBRANE_VEIN_WIDTH = 0.026;
const MEMBRANE_VEIN_ALPHA = 0.4;
const MEMBRANE_VEIN_CURL = 0.35;
/** The window's edge is raw wet flesh where the surgeon cut her open. */
const SAC_SEAM_WIDTH = 0.028;
/**
 * The seam is half-sunk into the dark: a saturated red ring round the window
 * is the loudest colour on her back and turns the window into a second face.
 */
const SAC_SEAM_ALPHA = 0.5;
const SAC_SEAM_WET_WIDTH = 0.018;
const SAC_SEAM_WET_ALPHA = 0.3;
const SAC_STAPLES = 5;
/** The stretch of the window's edge, as angles round it, that the staples close. */
const SAC_STAPLED_FROM = 2.3;
const SAC_STAPLED_TO = 4.1;
const STAPLE_TANGENT_STEP = 0.05;
const STAPLE_LENGTH = 0.1;
const STAPLE_WIDTH = 0.024;

/** A staple straddling a seam at `at`, across a seam running along `angle`. */
function drawStaple(ctx: Ctx, at: P2, angle: number): void {
  const across = angle + QUARTER_TURN;
  const dx = Math.cos(across) * STAPLE_LENGTH * HALF;
  const dy = Math.sin(across) * STAPLE_LENGTH * HALF;
  strokeLine(
    ctx,
    { x: at.x - dx, y: at.y - dy },
    { x: at.x + dx, y: at.y + dy },
    PALETTE.outline,
    STAPLE_WIDTH + OUTLINE_WIDTH * HALF,
  );
  strokeLine(
    ctx,
    { x: at.x - dx, y: at.y - dy },
    { x: at.x + dx, y: at.y + dy },
    PALETTE.staple,
    STAPLE_WIDTH,
  );
}

/**
 * The window's outline: a lopsided, off-centre blob rather than an oval. A
 * clean oval centred on her back, rimmed, is the same shape as her big eye,
 * and the two stack into a face.
 */
const SAC_OUTLINE_POINTS = 48;
const SAC_LOBES: readonly (readonly [number, number, number])[] = [
  [2, 0.12, 0.5],
  [3, 0.08, 1.9],
  [5, 0.035, 0.3],
];
const SAC_OFFSET_X = -0.14;

function sacPoint(theta: number, cy: number, sx: number, sy: number): P2 {
  let r = 1;
  for (const [frequency, amplitude, phase] of SAC_LOBES) {
    r += Math.sin(theta * frequency + phase) * amplitude;
  }
  return { x: SAC_OFFSET_X * sx + Math.cos(theta) * sx * r, y: cy + Math.sin(theta) * sy * r };
}

function sacPath(ctx: Ctx, cy: number, sx: number, sy: number): void {
  ctx.beginPath();
  sacContour(ctx, cy, sx, sy);
}

function sacContour(ctx: Ctx, cy: number, sx: number, sy: number): void {
  for (let i = 0; i <= SAC_OUTLINE_POINTS; i++) {
    const p = sacPoint((i / SAC_OUTLINE_POINTS) * TWO_PI, cy, sx, sy);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** The torn hole in the membrane: jagged, with alternate points biting back. */
function membraneHoleContour(ctx: Ctx, cy: number, sx: number, sy: number): void {
  for (let i = 0; i <= MEMBRANE_HOLE_POINTS; i++) {
    const k = i % MEMBRANE_HOLE_POINTS;
    const theta = (k / MEMBRANE_HOLE_POINTS) * TWO_PI;
    const tooth = k % 2 === 0 ? 1 : 1 - MEMBRANE_TEAR_DEPTH;
    const ragged = 1 + (hash01(k + MEMBRANE_SEED) - HALF) * MEMBRANE_TEAR_RAGGED * 2;
    const edge = sacPoint(theta, cy, sx, sy);
    const centre = { x: SAC_OFFSET_X * sx, y: cy };
    const share = MEMBRANE_HOLE_SHARE * tooth * ragged;
    const x = lerp(centre.x, edge.x, share);
    const y = lerp(centre.y, edge.y, share);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawSacEggs(
  ctx: Ctx,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  solve: SpiderSolve,
): void {
  const fade = 1 - solve.abdomen.deflate * EMPTIED_EGG_FADE;
  SAC_EGGS.forEach(([u, v, size], i) => {
    const shoved = v - solve.eggShove * EGG_SHOVE_TRAVEL * 2;
    const wrapped = ((((shoved + 1) % 2) + 2) % 2) - 1;
    const pulse = Math.sin((solve.eggPulse + i * EGG_PULSE_PHASE_STEP) * TWO_PI);
    const r = size * (1 + pulse * EGG_PULSE_SIZE);
    const x = cx + u * sx;
    const y = cy + wrapped * sy;
    const erx = r * sx;
    const ery = r * sx * EGG_ASPECT;
    ctx.fillStyle = rgba(PALETTE.cavity, fade);
    ctx.beginPath();
    ctx.ellipse(x, y, erx + EGG_GAP, ery + EGG_GAP, 0, 0, TWO_PI);
    ctx.fill();
    // A shaded, glossy ovoid lit from above like everything else on her:
    // pale at its crown, yellowed down to a dirty rim.
    const shell = ctx.createRadialGradient(x, y + ery * EGG_CROWN_OFFSET, 0, x, y, ery);
    shell.addColorStop(0, rgba(PALETTE.eggCrown, fade));
    shell.addColorStop(EGG_SHADE_STOP, rgba(PALETTE.egg, fade));
    shell.addColorStop(1, rgba(PALETTE.eggShade, fade));
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(x, y, erx, ery, 0, 0, TWO_PI);
    ctx.fill();
    const curl = hash01(i + EMBRYO_SEED) * TWO_PI;
    ctx.strokeStyle = rgba(PALETTE.embryo, EMBRYO_ALPHA * fade);
    ctx.lineWidth = erx * EMBRYO_WIDTH_SHARE;
    ctx.beginPath();
    ctx.arc(x, y - ery * EMBRYO_DROP, erx * EMBRYO_CURL_SHARE, curl, curl + EMBRYO_CURL_ARC);
    ctx.stroke();
    fillCircle(
      ctx,
      x - erx * EGG_GLINT_OFFSET,
      y + ery * EGG_GLINT_OFFSET,
      erx * EGG_GLINT_SHARE,
      rgba(PALETTE.eggGlint, fade),
    );
  });
}

/** The furthest the sac window's lobes push its outline past its radii. */
const SAC_LOBE_REACH = SAC_LOBES.reduce((total, [, amplitude]) => total + amplitude, 1);

/**
 * The disc the egg-sac window fits inside for a solve, in the figure frame and
 * in tiles: where a gate looks for the clutch.
 */
export function spiderSacWindow(solve: SpiderSolve): {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
} {
  const rx = ABDOMEN_HALF_WIDTH * solve.abdomen.scale;
  const ry = ABDOMEN_HALF_LENGTH * solve.abdomen.scale;
  const sx = SAC_RX * rx * solve.abdomen.swell;
  const sy = SAC_RY * ry * solve.abdomen.swell;
  const localX = SAC_OFFSET_X * sx;
  const localY = SAC_CENTRE_Y * ry - abdomenCentreDistance(solve);
  const cos = Math.cos(solve.abdomen.angle);
  const sin = Math.sin(solve.abdomen.angle);
  return {
    x: solve.waist.x + localX * cos - localY * sin,
    y: solve.waist.y + localX * sin + localY * cos,
    radius: Math.max(sx, sy) * SAC_LOBE_REACH,
  };
}

function drawEggSac(ctx: Ctx, rx: number, ry: number, solve: SpiderSolve): void {
  const { swell } = solve.abdomen;
  const cy = SAC_CENTRE_Y * ry;
  const sx = SAC_RX * rx * swell;
  const sy = SAC_RY * ry * swell;
  const cx = SAC_OFFSET_X * sx;
  const cavity = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(sx, sy));
  cavity.addColorStop(0, PALETTE.cavity);
  cavity.addColorStop(CAVITY_WALL_STOP, PALETTE.cavity);
  cavity.addColorStop(1, PALETTE.cavityWall);
  ctx.fillStyle = cavity;
  sacPath(ctx, cy, sx, sy);
  ctx.fill();

  withClip(
    ctx,
    () => sacPath(ctx, cy, sx, sy),
    () => {
      // A wet sheen round the inside of the cavity wall: an emptied window
      // with a dry black inside reads as a hole punched through her.
      ctx.strokeStyle = rgba(PALETTE.cavityWet, CAVITY_WET_ALPHA);
      ctx.lineWidth = CAVITY_WET_WIDTH;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        sx * CAVITY_WET_INSET,
        sy * CAVITY_WET_INSET,
        0,
        CAVITY_WET_FROM,
        CAVITY_WET_TO,
      );
      ctx.stroke();
      drawSacEggs(ctx, cx, cy, sx, sy, solve);
      const membrane = (): void => {
        ctx.beginPath();
        sacContour(ctx, cy, sx, sy);
        membraneHoleContour(ctx, cy, sx, sy);
      };
      ctx.fillStyle = rgba(PALETTE.membrane, MEMBRANE_ALPHA);
      membrane();
      ctx.fill('evenodd');
      ctx.save();
      try {
        membrane();
        ctx.clip('evenodd');
        ctx.strokeStyle = rgba(PALETTE.hideVeinBile, MEMBRANE_VEIN_ALPHA);
        ctx.lineWidth = MEMBRANE_VEIN_WIDTH;
        for (const [theta, length] of MEMBRANE_VEINS) {
          const edge = sacPoint(theta, cy, sx, sy);
          const inner = sacPoint(theta + MEMBRANE_VEIN_CURL, cy, sx, sy);
          const reach = 1 - (1 - MEMBRANE_HOLE_SHARE) * length;
          ctx.beginPath();
          ctx.moveTo(edge.x, edge.y);
          ctx.quadraticCurveTo(
            lerp(cx, inner.x, reach),
            lerp(cy, inner.y, reach),
            lerp(cx, edge.x, MEMBRANE_HOLE_SHARE),
            lerp(cy, edge.y, MEMBRANE_HOLE_SHARE),
          );
          ctx.stroke();
        }
      } finally {
        ctx.restore();
      }
      ctx.strokeStyle = rgba(PALETTE.membrane, MEMBRANE_LIP_ALPHA);
      ctx.lineWidth = MEMBRANE_LIP_WIDTH;
      ctx.beginPath();
      membraneHoleContour(ctx, cy, sx, sy);
      ctx.stroke();
    },
  );

  ctx.strokeStyle = PALETTE.fleshDark;
  ctx.lineWidth = SAC_SEAM_WIDTH + OUTLINE_WIDTH;
  sacPath(ctx, cy, sx, sy);
  ctx.stroke();
  ctx.strokeStyle = rgba(PALETTE.flesh, SAC_SEAM_ALPHA);
  ctx.lineWidth = SAC_SEAM_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = rgba(PALETTE.fleshWet, SAC_SEAM_WET_ALPHA);
  ctx.lineWidth = SAC_SEAM_WET_WIDTH;
  ctx.stroke();
  // Staples down one side only, where the surgeon closed the cut: a ring of
  // them all the way round frames the window like an eye's lashes.
  for (let i = 0; i < SAC_STAPLES; i++) {
    const a = lerp(SAC_STAPLED_FROM, SAC_STAPLED_TO, (i + HALF) / SAC_STAPLES);
    const at = sacPoint(a, cy, sx, sy);
    const ahead = sacPoint(a + STAPLE_TANGENT_STEP, cy, sx, sy);
    drawStaple(ctx, at, Math.atan2(ahead.y - at.y, ahead.x - at.x));
  }
}

/** The mottled, veined, wet skin over the whole abdomen, under the sac window. */
function drawHideTexture(ctx: Ctx, rx: number, ry: number): void {
  for (const bruise of BRUISES) {
    fillSoftEllipse(
      ctx,
      bruise.x * rx,
      bruise.y * ry,
      bruise.rx * rx,
      bruise.ry * ry,
      bruise.colour,
      bruise.alpha,
      bruise.angle,
    );
  }
  for (let i = 0; i < MOTTLE_COUNT; i++) {
    const seed = i * MOTTLE_SEED;
    const angle = hash01(seed) * TWO_PI;
    const reach = Math.sqrt(hash01(seed + 1)) * MOTTLE_REACH;
    const radius = MOTTLE_MIN_RADIUS + hash01(seed + 2) * MOTTLE_RADIUS_RANGE;
    fillSoftEllipse(
      ctx,
      Math.cos(angle) * reach * rx,
      Math.sin(angle) * reach * ry,
      radius * rx,
      radius * ry,
      MOTTLE_COLOURS[i % MOTTLE_COLOURS.length],
      MOTTLE_MIN_ALPHA + hash01(seed + 3) * MOTTLE_ALPHA_RANGE,
      0,
      HALF,
    );
  }
  ctx.lineCap = 'round';
  HIDE_VEINS.forEach(([x1, y1, bx, by, x2, y2, forkAt, fx, fy], i) => {
    const bile = i < HIDE_BILE_VEINS;
    ctx.strokeStyle = bile
      ? rgba(PALETTE.hideVeinBile, HIDE_BILE_VEIN_ALPHA)
      : rgba(PALETTE.hideVein, HIDE_VEIN_ALPHA);
    ctx.lineWidth = HIDE_VEIN_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x1 * rx, y1 * ry);
    ctx.quadraticCurveTo(bx * rx, by * ry, x2 * rx, y2 * ry);
    ctx.stroke();
    const fork = {
      x: lerp(lerp(x1, bx, forkAt), lerp(bx, x2, forkAt), forkAt) * rx,
      y: lerp(lerp(y1, by, forkAt), lerp(by, y2, forkAt), forkAt) * ry,
    };
    ctx.lineWidth = HIDE_VEIN_WIDTH * HIDE_VEIN_TIP_SHARE;
    ctx.beginPath();
    ctx.moveTo(fork.x, fork.y);
    ctx.lineTo(fx * rx, fy * ry);
    ctx.stroke();
  });
  fillSoftEllipse(
    ctx,
    HIDE_SHEEN.x * rx,
    HIDE_SHEEN.y * ry,
    HIDE_SHEEN.rx * rx,
    HIDE_SHEEN.ry * ry,
    PALETTE.gloss,
    HIDE_SHEEN.alpha,
    HIDE_SHEEN.angle,
  );
  fillCircle(
    ctx,
    HIDE_GLINT.x * rx,
    HIDE_GLINT.y * ry,
    HIDE_GLINT.r,
    rgba(PALETTE.gloss, HIDE_GLINT.alpha),
  );
}

/**
 * The torn sac: a long, ragged split down the membrane toward her tail, its
 * lips peeled back pink and wet, dead eggs showing in the dark inside. Long
 * and narrow along her body, with an uneven edge on each side: a short wide
 * opening reads as a mouth, and one with straight sides as a cut-out wedge.
 */
const TEAR_POINTS = 17;
/** How far each alternate point bites back into the tear, as a share of its width. */
const TEAR_TOOTH_DEPTH = 0.45;
/** Under one, the tear is blunt at its ends rather than drawn to points. */
const TEAR_ENVELOPE_POWER = 0.6;
const TEAR_FROM_Y = 0.35;
const TEAR_TO_Y = -1.15;
const TEAR_HALF_WIDTH = 0.8;
const TEAR_RAGGED = 0.3;
const TEAR_SKEW = 0.12;
/** Dead eggs showing in the gash: [share down it, share across it], clustered rather than in file. */
const TEAR_EGGS: readonly (readonly [number, number])[] = [
  [0.3, -0.35],
  [0.38, 0.3],
  [0.52, -0.05],
  [0.62, -0.45],
  [0.66, 0.38],
  [0.78, 0.02],
];
const TEAR_EGG_SIZE = 0.085;
const TEAR_LIP_WIDTH = 0.05;

function tearPath(ctx: Ctx, sx: number, sy: number, cy: number, open: number): void {
  ctx.beginPath();
  for (const side of [1, -1]) {
    for (let k = 0; k <= TEAR_POINTS; k++) {
      const i = side > 0 ? k : TEAR_POINTS - k;
      const t = i / TEAR_POINTS;
      const y = cy + lerp(TEAR_FROM_Y, TEAR_TO_Y, t) * sy;
      // Alternate points bite in and out: a torn membrane has flaps and
      // notches, where a smooth edge reads as a cut-out shape.
      const tooth = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? 1 : 1 - TEAR_TOOTH_DEPTH;
      const ragged = 1 - TEAR_RAGGED + hash01(i * 2 + (side > 0 ? 0 : 1)) * TEAR_RAGGED * 2;
      const envelope = Math.sin(t * Math.PI) ** TEAR_ENVELOPE_POWER;
      const x =
        (side * envelope * TEAR_HALF_WIDTH * ragged * tooth + TEAR_SKEW * Math.sin(t * TWO_PI)) *
        sx *
        open;
      if (k === 0 && side > 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function drawRupture(ctx: Ctx, rx: number, ry: number, solve: SpiderSolve): void {
  if (solve.rupture <= 0) return;
  const cy = SAC_CENTRE_Y * ry;
  const sx = SAC_RX * rx * solve.abdomen.swell;
  const sy = SAC_RY * ry * solve.abdomen.swell;
  const open = solve.rupture;
  ctx.save();
  try {
    ctx.translate(SAC_OFFSET_X * sx, 0);
    drawTear(ctx, sx, sy, cy, open);
  } finally {
    ctx.restore();
  }
}

function drawTear(ctx: Ctx, sx: number, sy: number, cy: number, open: number): void {
  tearPath(ctx, sx, sy, cy, open);
  ctx.fillStyle = PALETTE.fleshDark;
  ctx.fill();
  ctx.strokeStyle = PALETTE.flesh;
  ctx.lineWidth = TEAR_LIP_WIDTH;
  ctx.stroke();
  for (const [down, across] of TEAR_EGGS) {
    const y = cy + lerp(TEAR_FROM_Y, TEAR_TO_Y, down) * sy;
    const x =
      across * Math.sin(down * Math.PI) * sx * TEAR_HALF_WIDTH * open +
      TEAR_SKEW * Math.sin(down * TWO_PI) * sx * open;
    fillCircle(ctx, x, y, (TEAR_EGG_SIZE + OUTLINE_WIDTH * HALF) * open, PALETTE.deadEggDark);
    fillCircle(ctx, x, y, TEAR_EGG_SIZE * open, PALETTE.deadEgg);
  }
}

/** One raw, weeping patch where the bristles have rubbed away: [x, y, rx, ry] in abdomen radii. */
const WEEPING_PATCH = { x: 0.74, y: 0.18, rx: 0.1, ry: 0.14 } as const;
const WEEPING_ALPHA = 0.9;
const WEEPING_CORE = 0.55;
/** The raw wet middle of the weeping patch, as a share of its size. */
const WEEPING_WET_SHARE = 0.55;
/** Bristle angles, in radians, left bald: around the weeping patch and one scar. */
const BALD_ARCS: readonly (readonly [number, number])[] = [
  [0.05, 0.45],
  [3.9, 4.3],
];
const BRISTLE_COUNT = 84;
const BRISTLE_BASE_LENGTH = 0.07;
const BRISTLE_LENGTH_RANGE = 0.06;
const BRISTLE_WIDTH = 0.028;
/** At rest the bristles lie back toward her tail; raised, they stand straight out. */
const BRISTLE_LIE_BACK = 0.75;

function isBald(theta: number): boolean {
  return BALD_ARCS.some(([from, to]) => theta >= from && theta <= to);
}

function drawBristles(ctx: Ctx, rx: number, ry: number, solve: SpiderSolve): void {
  const standing = clamp01(solve.bristle - 1);
  const lean = BRISTLE_LIE_BACK * (1 - standing);
  ctx.lineCap = 'round';
  for (let i = 0; i < BRISTLE_COUNT; i++) {
    const theta = (i / BRISTLE_COUNT) * TWO_PI + hash01(i) * 0.05;
    if (isBald(theta)) continue;
    const p = abdomenPoint(theta, rx, ry, solve.abdomen.deflate);
    // Lean toward the tail: rotate the outward normal toward -y.
    const side = Math.cos(theta) >= 0 ? 1 : -1;
    const out = theta - side * lean * HALF;
    const length =
      (BRISTLE_BASE_LENGTH + hash01(i + BRISTLE_COUNT) * BRISTLE_LENGTH_RANGE) * solve.bristle;
    strokeLine(
      ctx,
      { x: p.x - Math.cos(theta) * BRISTLE_WIDTH, y: p.y - Math.sin(theta) * BRISTLE_WIDTH },
      { x: p.x + Math.cos(out) * length, y: p.y + Math.sin(out) * length },
      PALETTE.outline,
      BRISTLE_WIDTH,
    );
  }
}

/**
 * Three short, tapering spinnerets fanned out past her tail. Two round knobs
 * read as a fruit's stem; a fan of points reads as the end of an animal.
 */
const SPINNERET_ANGLES: readonly number[] = [-0.45, 0, 0.45];
const SPINNERET_LENGTH = 0.09;
const SPINNERET_BASE = 0.07;
const SPINNERET_TIP = 0.025;

function drawSpinnerets(ctx: Ctx, ry: number): void {
  const tail = { x: 0, y: -ry * (1 + ABDOMEN_TAIL_POINT) + SPINNERET_LENGTH * HALF };
  for (const angle of SPINNERET_ANGLES) {
    const tip = {
      x: tail.x + Math.sin(angle) * SPINNERET_LENGTH,
      y: tail.y - Math.cos(angle) * SPINNERET_LENGTH,
    };
    ctx.fillStyle = PALETTE.outline;
    capsulePath(
      ctx,
      tail,
      tip,
      SPINNERET_BASE + OUTLINE_WIDTH * 2,
      SPINNERET_TIP + OUTLINE_WIDTH * 2,
    );
    ctx.fill();
    ctx.fillStyle = PALETTE.hideMid;
    capsulePath(ctx, tail, tip, SPINNERET_BASE, SPINNERET_TIP);
    ctx.fill();
  }
}

const DEFLATE_CREASES = 3;
const DEFLATE_CREASE_ALPHA = 0.6;
/** The hide's lit crown sits a little toward her waist, where the abdomen rides highest. */
const HIDE_LIGHT_FORWARD = 0.2;
const HIDE_LIGHT_REACH = 1.15;
const HIDE_LIGHT_STOP = 0.35;
const HIDE_MID_STOP = 0.72;

function drawAbdomen(ctx: Ctx, solve: SpiderSolve): void {
  const { abdomen } = solve;
  const rx = ABDOMEN_HALF_WIDTH * abdomen.scale;
  const ry = ABDOMEN_HALF_LENGTH * abdomen.scale;
  ctx.save();
  try {
    ctx.translate(solve.waist.x, solve.waist.y);
    ctx.rotate(abdomen.angle);
    ctx.translate(0, -abdomenCentreDistance(solve));
    drawBristles(ctx, rx, ry, solve);
    drawSpinnerets(ctx, ry);
    ctx.lineWidth = OUTLINE_WIDTH * 2;
    ctx.strokeStyle = PALETTE.outline;
    abdomenOutlinePath(ctx, rx, ry, abdomen.deflate);
    ctx.stroke();
    ctx.save();
    try {
      // The light is laid out in unit space and scaled to her radii, so its
      // falloff follows the abdomen's own shape rather than a circle.
      ctx.scale(rx, ry);
      const hide = ctx.createRadialGradient(0, HIDE_LIGHT_FORWARD, 0, 0, 0, HIDE_LIGHT_REACH);
      hide.addColorStop(0, PALETTE.hideLight);
      hide.addColorStop(HIDE_LIGHT_STOP, PALETTE.hideMid);
      hide.addColorStop(HIDE_MID_STOP, PALETTE.hideMid);
      hide.addColorStop(1, PALETTE.hideDark);
      ctx.fillStyle = hide;
      ctx.fill();
    } finally {
      ctx.restore();
    }
    withClip(
      ctx,
      () => abdomenOutlinePath(ctx, rx, ry, abdomen.deflate),
      () => {
        drawHideTexture(ctx, rx, ry);
        drawFeedPort(ctx, rx, ry);
        fillSoftEllipse(
          ctx,
          WEEPING_PATCH.x * rx,
          WEEPING_PATCH.y * ry,
          WEEPING_PATCH.rx * rx,
          WEEPING_PATCH.ry * ry,
          PALETTE.fleshDark,
          WEEPING_ALPHA,
          0,
          WEEPING_CORE,
        );
        fillSoftEllipse(
          ctx,
          WEEPING_PATCH.x * rx,
          WEEPING_PATCH.y * ry,
          WEEPING_PATCH.rx * rx * WEEPING_WET_SHARE,
          WEEPING_PATCH.ry * ry * WEEPING_WET_SHARE,
          PALETTE.flesh,
          WEEPING_ALPHA,
        );
        drawEggSac(ctx, rx, ry, solve);
        drawRupture(ctx, rx, ry, solve);
        drawBirthLump(ctx, rx, ry, solve.birthLump);
        if (abdomen.deflate > 0) {
          for (let i = 0; i < DEFLATE_CREASES; i++) {
            const x = lerp(-0.6, 0.6, i / (DEFLATE_CREASES - 1)) * rx;
            ctx.strokeStyle = rgba(PALETTE.hideDark, DEFLATE_CREASE_ALPHA * abdomen.deflate);
            ctx.lineWidth = OUTLINE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(x, -ry * 0.9);
            ctx.quadraticCurveTo(x * 1.2, 0, x * 0.8, ry * 0.8);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = rgba(PALETTE.hideRim, HIDE_RIM_ALPHA);
        ctx.lineWidth = RIM_WIDTH * HIDE_RIM_WIDTH_SCALE;
        abdomenOutlinePath(ctx, rx, ry, abdomen.deflate);
        ctx.stroke();
      },
    );
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = OUTLINE_WIDTH;
    abdomenOutlinePath(ctx, rx, ry, abdomen.deflate);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

// ── Waist, ovipositor, laid egg ──────────────────────────────────────────────

/** Narrow, but thick enough to see: the pinch is what makes two sections one animal. */
const PEDICEL_WIDTH = 0.22;
/** A steel clamp band round the waist, wider than the waist it grips. */
const WAIST_CLAMP_WIDTH = 0.09;
const WAIST_CLAMP_OVERHANG = 1.5;
const WAIST_CLAMP_SHINE_SHARE = 0.35;
/** Thick and fleshy: a thin ovipositor with an egg on its end reads as a lure on a stalk. */
const OVIPOSITOR_WIDTH = 0.22;
const OVIPOSITOR_TIP_WIDTH = 0.14;
/** How much wider the mouth stretches round a crowning egg. */
const OVIPOSITOR_DILATE_WIDTH = 0.18;
const OVIPOSITOR_RINGS = 3;
const OVIPOSITOR_RING_ALPHA = 0.7;
/** The empty mouth's dark opening, against the mouth's width. */
const OVIPOSITOR_HOLE_SHARE = 0.3;
/** Where along the tube, from the tail, the bruised hide turns to raw flesh. */
const OVIPOSITOR_RAW_FROM = 0.55;
/** The pink seam down the tube, against the mouth's width. */
const OVIPOSITOR_SEAM_SHARE = 0.35;
const OVIPOSITOR_SEAM_ALPHA = 0.8;
const EGG_SHADOW_ASPECT = 0.8;
const EGG_STRAND_WIDTH = 0.04;
const EGG_STRAND_ALPHA = 0.85;
/** The strand left hanging after an egg has gone. No drip on its end: a bead on a line reads as a lit fuse. */
const AFTERBIRTH_LENGTH = 0.3;
const AFTERBIRTH_SAG = 0.12;
/** The birth lump: an egg's width under the hide, and the squeeze behind it. */
const BIRTH_LUMP_FROM_Y = 0.35;
const BIRTH_LUMP_TO_Y = -0.85;
const BIRTH_LUMP_RX = 0.5;
const BIRTH_LUMP_RY = 0.34;
const BIRTH_LUMP_ALPHA = 0.9;
const BIRTH_LUMP_SHADE_ALPHA = 0.75;
const BIRTH_SQUEEZE_GAP = 1.25;
const BIRTH_SQUEEZE_ALPHA = 0.45;
const BIRTH_SQUEEZE_WIDTH = 0.05;

function drawPedicel(ctx: Ctx, solve: SpiderSolve): void {
  const front = cephToFigure(solve, 0, -CEPH_HALF_LENGTH);
  const back = alongAbdomen(
    solve,
    abdomenCentreDistance(solve) - ABDOMEN_HALF_LENGTH * solve.abdomen.scale * HALF,
  );
  ctx.fillStyle = PALETTE.outline;
  capsulePath(
    ctx,
    front,
    back,
    PEDICEL_WIDTH + OUTLINE_WIDTH * 2,
    PEDICEL_WIDTH + OUTLINE_WIDTH * 2,
  );
  ctx.fill();
  ctx.fillStyle = PALETTE.hideMid;
  capsulePath(ctx, front, back, PEDICEL_WIDTH, PEDICEL_WIDTH);
  ctx.fill();
  const waist = pointAlong(front, back, HALF);
  const along = Math.atan2(back.y - front.y, back.x - front.x);
  const across = along + QUARTER_TURN;
  const half = PEDICEL_WIDTH * HALF * WAIST_CLAMP_OVERHANG;
  const from = { x: waist.x - Math.cos(across) * half, y: waist.y - Math.sin(across) * half };
  const to = { x: waist.x + Math.cos(across) * half, y: waist.y + Math.sin(across) * half };
  ctx.lineCap = 'butt';
  strokeLine(ctx, from, to, PALETTE.outline, WAIST_CLAMP_WIDTH + OUTLINE_WIDTH * 2);
  strokeLine(ctx, from, to, PALETTE.metal, WAIST_CLAMP_WIDTH);
  // The highlight on the band's tail-facing edge, where the light is.
  const shine = WAIST_CLAMP_WIDTH * HALF * HALF;
  strokeLine(
    ctx,
    { x: from.x - Math.cos(along) * shine, y: from.y - Math.sin(along) * shine },
    { x: to.x - Math.cos(along) * shine, y: to.y - Math.sin(along) * shine },
    PALETTE.metalLight,
    WAIST_CLAMP_WIDTH * WAIST_CLAMP_SHINE_SHARE,
  );
  ctx.lineCap = 'round';
}

/**
 * A steel feeding port bolted into her flank, its tube long since torn out: a
 * hexagonal plate round a small dark hole. A round bright ring round a dark
 * centre reads as one more eye, which she has enough of; the hex's corners
 * are what make it hardware.
 */
const FEED_PORT = { x: 0.56, y: 0.42, r: 0.065 } as const;
const FEED_PORT_SIDES = 6;
const FEED_PORT_TURN = 0.3;
const FEED_PORT_HOLE_SHARE = 0.38;
const FEED_PORT_SHINE_SHARE = 0.55;
const FEED_PORT_GLINT_SHARE = 0.22;

function hexPath(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < FEED_PORT_SIDES; i++) {
    const a = FEED_PORT_TURN + (i / FEED_PORT_SIDES) * TWO_PI;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawFeedPort(ctx: Ctx, rx: number, ry: number): void {
  const x = FEED_PORT.x * rx;
  const y = FEED_PORT.y * ry;
  ctx.fillStyle = PALETTE.outline;
  hexPath(ctx, x, y, FEED_PORT.r + OUTLINE_WIDTH);
  ctx.fill();
  ctx.fillStyle = PALETTE.metalDark;
  hexPath(ctx, x, y, FEED_PORT.r);
  ctx.fill();
  // Only a sliver of light on its tail-facing corner: a lit plate round a dark
  // hole on her back reads at game size as one more eye, on the wrong end.
  fillCircle(
    ctx,
    x,
    y - FEED_PORT.r * FEED_PORT_SHINE_SHARE,
    FEED_PORT.r * FEED_PORT_GLINT_SHARE,
    PALETTE.metal,
  );
  fillCircle(ctx, x, y, FEED_PORT.r * FEED_PORT_HOLE_SHARE, PALETTE.outline);
}

function drawOvipositor(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.ovipositor <= 0) return;
  const base = alongAbdomen(solve, abdomenTailDistance(solve) - OVIPOSITOR_WIDTH);
  const tip = project(ovipositorTip(solve));
  const mouthWidth = OVIPOSITOR_TIP_WIDTH + solve.ovipositorDilate * OVIPOSITOR_DILATE_WIDTH;
  ctx.fillStyle = PALETTE.outline;
  capsulePath(ctx, base, tip, OVIPOSITOR_WIDTH + OUTLINE_WIDTH * 2, mouthWidth + OUTLINE_WIDTH * 2);
  ctx.fill();
  // Bruised hide down the tube, raw flesh only at its mouth: a tube red all
  // along with an egg on its end reads as a lollipop.
  const tube = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
  tube.addColorStop(0, PALETTE.hideMid);
  tube.addColorStop(OVIPOSITOR_RAW_FROM, PALETTE.bruiseNecrotic);
  tube.addColorStop(1, PALETTE.flesh);
  ctx.fillStyle = tube;
  capsulePath(ctx, base, tip, OVIPOSITOR_WIDTH, mouthWidth);
  ctx.fill();
  strokeLine(
    ctx,
    base,
    tip,
    rgba(PALETTE.seam, OVIPOSITOR_SEAM_ALPHA),
    OVIPOSITOR_TIP_WIDTH * OVIPOSITOR_SEAM_SHARE,
  );
  // Muscle rings across the tube: what makes it read as a body part that
  // pushes, rather than a smooth stalk.
  const axisX = tip.x - base.x;
  const axisY = tip.y - base.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength > 0) {
    const acrossX = -axisY / axisLength;
    const acrossY = axisX / axisLength;
    for (let i = 1; i <= OVIPOSITOR_RINGS; i++) {
      const t = i / (OVIPOSITOR_RINGS + 1);
      const width = lerp(OVIPOSITOR_WIDTH, mouthWidth, t) * HALF;
      const cx = lerp(base.x, tip.x, t);
      const cy = lerp(base.y, tip.y, t);
      strokeLine(
        ctx,
        { x: cx - acrossX * width, y: cy - acrossY * width },
        { x: cx + acrossX * width, y: cy + acrossY * width },
        rgba(PALETTE.fleshDark, OVIPOSITOR_RING_ALPHA),
        OUTLINE_WIDTH * HALF,
      );
    }
  }
  if (solve.heldEgg === null) {
    fillCircle(ctx, tip.x, tip.y, mouthWidth * OVIPOSITOR_HOLE_SHARE, PALETTE.fleshDark);
  }
  drawAfterbirth(ctx, solve, tip);
}

/** A string of slime hanging off the mouth after an egg has left it. */
function drawAfterbirth(ctx: Ctx, solve: SpiderSolve, mouth: P2): void {
  if (solve.afterbirth <= 0 || solve.heldEgg !== null) return;
  const outX = Math.sin(solve.abdomen.angle);
  const outY = -Math.cos(solve.abdomen.angle);
  const length = AFTERBIRTH_LENGTH * solve.afterbirth;
  const end = { x: mouth.x + outX * length, y: mouth.y + outY * length };
  const alpha = EGG_STRAND_ALPHA * solve.afterbirth;
  ctx.strokeStyle = rgba(PALETTE.outline, alpha);
  ctx.lineWidth = EGG_STRAND_WIDTH + OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(mouth.x, mouth.y);
  ctx.quadraticCurveTo(
    mouth.x + outX * length * HALF + outY * AFTERBIRTH_SAG,
    mouth.y + outY * length * HALF - outX * AFTERBIRTH_SAG,
    end.x,
    end.y,
  );
  ctx.stroke();
  ctx.strokeStyle = rgba(PALETTE.slime, alpha);
  ctx.lineWidth = EGG_STRAND_WIDTH;
  ctx.stroke();
}

/**
 * The egg at the ovipositor: crowning, hanging, or being pushed off it down to
 * the floor. It stays pressed to the mouth with no strand between: an egg on a
 * line reads as a balloon on a string.
 */
function drawHeldEgg(ctx: Ctx, solve: SpiderSolve): void {
  const egg = solve.heldEgg;
  if (egg === null) return;
  const at = project(egg.at);
  // Dry and plain until it lands, so it reads as the egg it will be on the
  // floor rather than as a glowing lure.
  paintEggSac(ctx, at.x, at.y, egg.radius * perspectiveScale(egg.at.h), {
    wet: 0,
    splat: 0,
    pulse: 0,
  });
}

/**
 * An egg being squeezed down the abdomen: a pale lump pressing up under the
 * hide with a tight ring of muscle clenched behind it. At game size the sac's
 * small eggs are a texture, and this is the one shape that reads as "something
 * is coming out".
 */
function drawBirthLump(ctx: Ctx, rx: number, ry: number, lump: number): void {
  if (lump <= 0) return;
  const y = lerp(BIRTH_LUMP_FROM_Y, BIRTH_LUMP_TO_Y, lump) * ry;
  const lumpRx = BIRTH_LUMP_RX * rx;
  const lumpRy = BIRTH_LUMP_RY * ry;
  fillSoftEllipse(
    ctx,
    0,
    y + lumpRy * 0.2,
    lumpRx * 1.15,
    lumpRy * 1.15,
    PALETTE.hideDark,
    BIRTH_LUMP_SHADE_ALPHA,
  );
  fillSoftEllipse(ctx, 0, y, lumpRx, lumpRy, PALETTE.eggCrown, BIRTH_LUMP_ALPHA, 0, 0.55);
  fillSoftEllipse(
    ctx,
    -lumpRx * 0.3,
    y - lumpRy * 0.3,
    lumpRx * 0.35,
    lumpRy * 0.25,
    PALETTE.bone,
    BIRTH_LUMP_ALPHA,
  );
  const squeezeY = y + lumpRy * BIRTH_SQUEEZE_GAP;
  ctx.strokeStyle = rgba(PALETTE.outline, BIRTH_SQUEEZE_ALPHA);
  ctx.lineWidth = BIRTH_SQUEEZE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(-rx, squeezeY + lumpRy * 0.3);
  ctx.quadraticCurveTo(0, squeezeY - lumpRy * 0.2, rx, squeezeY + lumpRy * 0.3);
  ctx.stroke();
}

// ── Carapace, maw and face ───────────────────────────────────────────────────

const HL = CEPH_HALF_LENGTH;
const HW = CEPH_HALF_WIDTH;

/** One half of the carapace, `side` -1 left or +1 right, carapace-local. */
function carapaceHalfPath(ctx: Ctx, side: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -HL);
  ctx.bezierCurveTo(side * 0.55 * HW, -HL, side * HW, -0.55 * HL, side * HW, -0.05 * HL);
  ctx.bezierCurveTo(side * HW, 0.4 * HL, side * 0.8 * HW, 0.8 * HL, side * 0.45 * HW, 0.96 * HL);
  ctx.bezierCurveTo(side * 0.3 * HW, 1.02 * HL, side * 0.12 * HW, 1.02 * HL, 0, HL);
  ctx.closePath();
}

/**
 * The carapace is dark chitin with a hot rim: dark, so the pale human eyes
 * and bone fangs on it are the brightest marks on her and say "face" from
 * across the room; rimmed hard, so the dark plate still holds its shape.
 */
const CARAPACE_RIM_ALPHA = 0.9;
const CARAPACE_RIM_WIDTH = 0.08;
const FOVEA_Y = -0.27;
const FOVEA_HALF_WIDTH = 0.07;
const FOVEA_WIDTH = 0.03;
const STRIAE: readonly number[] = [-0.35, 0.35, 1.05];
const STRIA_LENGTH = 0.3;
const STRIA_WIDTH = 0.014;
const STRIA_ALPHA = 0.5;
/**
 * A wet sheen on each half of the carapace, behind the eyes where the plate
 * rises toward the light: dry, matte chitin reads as plastic at game size. No
 * hard glint: a bright dot on the carapace reads as one more eye.
 */
const CARAPACE_SHEEN = { x: 0.24, y: -0.28, rx: 0.07, ry: 0.19, angle: 0.35, alpha: 0.55 } as const;
/**
 * A hard wet streak down the middle of that sheen. A streak, not a dot: it
 * reads as the chitin being wet, where a round highlight reads as one more eye.
 */
const CARAPACE_SPECULAR_LENGTH = 0.13;
/** Width of the raw strip down each half's torn edge, doubled because only the half inside the plate shows. */
const PEEL_EDGE_WIDTH = 0.16;
const PEEL_EDGE_WET_WIDTH = 0.05;
/** The strip is fully raw by a third of the way open. */
const PEEL_EDGE_RISE = 3;
const CARAPACE_SPECULAR_WIDTH = 0.026;
const CARAPACE_SPECULAR_ALPHA = 0.9;

function drawCarapaceHalf(ctx: Ctx, side: number, maw: number): void {
  const shade = ctx.createRadialGradient(0, -0.15 * HL, 0, 0, -0.15 * HL, HL * 1.3);
  shade.addColorStop(0, PALETTE.carapaceLight);
  shade.addColorStop(0.5, PALETTE.carapaceMid);
  shade.addColorStop(1, PALETTE.carapaceDark);
  ctx.fillStyle = shade;
  carapaceHalfPath(ctx, side);
  ctx.fill();
  withClip(
    ctx,
    () => carapaceHalfPath(ctx, side),
    () => {
      strokeLine(
        ctx,
        { x: 0, y: FOVEA_Y },
        { x: side * FOVEA_HALF_WIDTH, y: FOVEA_Y },
        PALETTE.carapaceDark,
        FOVEA_WIDTH,
      );
      for (const angle of STRIAE) {
        const a = side > 0 ? angle : Math.PI - angle;
        strokeLine(
          ctx,
          { x: side * FOVEA_HALF_WIDTH, y: FOVEA_Y },
          {
            x: side * FOVEA_HALF_WIDTH + Math.cos(a) * STRIA_LENGTH,
            y: FOVEA_Y + Math.sin(a) * STRIA_LENGTH,
          },
          rgba(PALETTE.carapaceDark, STRIA_ALPHA),
          STRIA_WIDTH,
        );
      }
      // The ridge running back from the fovea catches the light down its crest.
      strokeLine(
        ctx,
        { x: 0, y: FOVEA_Y },
        { x: 0, y: -HL },
        rgba(PALETTE.carapaceRim, RIM_ALPHA),
        FOVEA_WIDTH,
      );
      fillSoftEllipse(
        ctx,
        side * CARAPACE_SHEEN.x,
        CARAPACE_SHEEN.y,
        CARAPACE_SHEEN.rx,
        CARAPACE_SHEEN.ry,
        PALETTE.gloss,
        CARAPACE_SHEEN.alpha,
        side * CARAPACE_SHEEN.angle,
      );
      const streakAngle = QUARTER_TURN - side * CARAPACE_SHEEN.angle;
      const streakX = Math.cos(streakAngle) * CARAPACE_SPECULAR_LENGTH * HALF;
      const streakY = Math.sin(streakAngle) * CARAPACE_SPECULAR_LENGTH * HALF;
      strokeLine(
        ctx,
        { x: side * CARAPACE_SHEEN.x - streakX, y: CARAPACE_SHEEN.y - streakY },
        { x: side * CARAPACE_SHEEN.x + streakX, y: CARAPACE_SHEEN.y + streakY },
        rgba(PALETTE.gloss, CARAPACE_SPECULAR_ALPHA),
        CARAPACE_SPECULAR_WIDTH,
      );
      ctx.strokeStyle = rgba(PALETTE.carapaceRim, CARAPACE_RIM_ALPHA);
      ctx.lineWidth = CARAPACE_RIM_WIDTH;
      carapaceHalfPath(ctx, side);
      ctx.stroke();
      if (maw > 0) {
        // The torn inner edge of each peeled-back half: raw, wet flesh where
        // the plate has been prised off the mouth, so the halves read as
        // peeled open rather than as a plate with a hole in it.
        const peel = clamp01(maw * PEEL_EDGE_RISE);
        strokeLine(
          ctx,
          { x: 0, y: -HL },
          { x: 0, y: HL },
          rgba(PALETTE.fleshDark, peel),
          PEEL_EDGE_WIDTH + OUTLINE_WIDTH * 2,
        );
        strokeLine(
          ctx,
          { x: 0, y: -HL },
          { x: 0, y: HL },
          rgba(PALETTE.flesh, peel),
          PEEL_EDGE_WIDTH,
        );
        strokeLine(
          ctx,
          { x: 0, y: -HL },
          { x: 0, y: HL },
          rgba(PALETTE.fleshWet, peel * MAW_LIP_WET_ALPHA),
          PEEL_EDGE_WET_WIDTH,
        );
      }
    },
  );
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = OUTLINE_WIDTH;
  carapaceHalfPath(ctx, side);
  ctx.stroke();
}

/** The sealed maw is a stapled pink seam down the carapace front. */
const SEAM_STAPLES = 2;
const SEAM_WIDTH = 0.03;
/** The seam starts below the central eye, so the two never line up as an eye over a nose. */
const SEAM_TOP_Y = 0.2;
const SEAM_CLOSED_BELOW = 0.05;

function drawClosedSeam(ctx: Ctx, maw: number): void {
  if (maw >= SEAM_CLOSED_BELOW) return;
  strokeLine(
    ctx,
    { x: 0, y: SEAM_TOP_Y },
    { x: 0, y: HL },
    PALETTE.fleshDark,
    SEAM_WIDTH + OUTLINE_WIDTH,
  );
  strokeLine(ctx, { x: 0, y: SEAM_TOP_Y }, { x: 0, y: HL }, PALETTE.seam, SEAM_WIDTH);
  for (let i = 0; i < SEAM_STAPLES; i++) {
    const y = lerp(SEAM_TOP_Y, HL, (i + HALF) / SEAM_STAPLES);
    drawStaple(ctx, { x: 0, y }, Math.PI * HALF);
  }
}

/**
 * Rings of teeth down the maw, outermost first: [count, ring radius, tooth
 * length, twist], in maw radii and radians. Each ring is twisted against the
 * last so no tooth lines up with the one behind it: rings in step read as the
 * spokes of a wheel, and an even ring of equal teeth as a gear or a button.
 */
const MAW_TOOTH_RINGS: readonly (readonly [number, number, number, number])[] = [
  [11, 0.86, 0.3, 0.2],
  [9, 0.64, 0.25, 1.1],
  [7, 0.44, 0.2, 2.3],
];
const TOOTH_BASE_SHARE = 0.7;
/** How much one tooth's length and width stray from its ring's, either way. */
const TOOTH_LENGTH_JITTER = 0.4;
const TOOTH_WIDTH_JITTER = 0.3;
/** How far a tooth wanders round its ring from its even slot, as a share of the slot. */
const TOOTH_SLOT_JITTER = 0.3;
/** The share of teeth broken out of each ring: a gap-toothed ring is a mouth, a full one is a gear. */
const TOOTH_MISSING_SHARE = 0.12;
const TOOTH_SEED = 59;
/** Deeper rings sit in the throat's shadow: how far the innermost is darkened toward stained bone. */
const TOOTH_DEPTH_SHADE = 0.55;
/** Where the raw lips give way to the throat, as a share of the maw's radius. */
const MAW_INNER_SHARE = 0.72;
/**
 * The lips are lobed, not round: [frequency, amplitude, phase]. A clean
 * circle of teeth is a biscuit or a jack-o'-lantern; torn flesh is uneven.
 */
const MAW_LIP_LOBES: readonly (readonly [number, number, number])[] = [
  [3, 0.07, 0.4],
  [5, 0.045, 1.3],
  [7, 0.025, 2.1],
];
const MAW_LIP_POINTS = 40;
/** Wet highlights along the lips' tail-facing inner edge, where the light hangs: [angle, span]. */
const MAW_LIP_WET: readonly (readonly [number, number])[] = [
  [3.6, 0.5],
  [4.6, 0.35],
  [5.5, 0.45],
];
const MAW_LIP_WET_WIDTH = 0.03;
const MAW_LIP_WET_ALPHA = 0.8;
const MAW_LIP_WET_INSET = 0.1;
/**
 * The light is only in the deep middle third, off-centre and lobed, so the
 * mouth reads as a pit lit from far down it rather than a lamp or a disc.
 */
const MAW_GLOW_SHARE = 0.38;
const MAW_GLOW_OFFSET_X = 0.06;
const MAW_GLOW_OFFSET_Y = 0.08;
const MAW_GLOW_HOT_STOP = 0.3;
const MAW_GLOW_RED_STOP = 0.7;
const MAW_GLOW_LOBES: readonly (readonly [number, number, number])[] = [
  [2, 0.14, 0.9],
  [3, 0.1, 2.4],
];
const MAW_THROAT_DEEP = '#050102';
const ROAR_ARC_WIDTH = 0.075;
/** A dark line under each arc, so the pale sound rings hold against a pale floor. */
const ROAR_ARC_SHADOW_WIDTH = 0.12;
const ROAR_ARC_SHADOW_ALPHA = 0.5;
const ROAR_ARCS = 4;
const ROAR_ARC_STEP = 0.45;
const ROAR_ARC_SPAN = 0.7;
const ROAR_ARC_ALPHA = 0.9;

function drawMaw(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.maw <= 0) return;
  const r = MAW_MAX_RADIUS * solve.maw;
  const y = MAW_CENTRE_Y;
  if (solve.maw < MAW_TEETH_FROM) {
    drawMawSlit(ctx, solve.maw / MAW_TEETH_FROM, y);
    return;
  }
  ctx.save();
  try {
    // It opens as a slit down the seam and widens into the round maw: a small
    // round disc of teeth reads as a biscuit, a split as a mouth opening.
    ctx.translate(0, y);
    ctx.scale(lerp(MAW_SLIT_WIDTH, 1, solve.maw), 1);
    ctx.translate(0, -y);
    drawMawDisc(ctx, solve, r, y);
  } finally {
    ctx.restore();
  }
}

/** How narrow the maw is, against its height, as it first splits. */
const MAW_SLIT_WIDTH = 0.25;
/**
 * Below this opening the maw is not yet round: it is the carapace tearing
 * open along its seam, drawn by {@link drawMawSlit}.
 */
const MAW_TEETH_FROM = 0.6;
/** The gash's half-length as it first splits, and its half-width against that. */
const SLIT_FIRST_HALF_LENGTH = 0.24;
const SLIT_FIRST_WIDTH_SHARE = 0.36;
const SLIT_OPEN_WIDTH_SHARE = 0.55;
/** A quadratic's control point sits twice as far out as the curve's own peak. */
const QUADRATIC_PEAK_REACH = 2;
/**
 * A few big teeth per lip, the two rows offset by half a tooth so they
 * interlock across the gap in a zigzag. Many small teeth at game size average
 * into a pale ring round a dark centre, which is an eye.
 */
const SLIT_TEETH_PER_LIP = 3;
/** How far across the gash each tooth reaches, as a share of its lip's distance from the midline: past it, to interlock. */
const SLIT_TOOTH_REACH = 1.35;
const SLIT_TOOTH_BASE_SHARE = 0.85;
const SLIT_LIP_WIDTH = 0.04;

function slitPath(ctx: Ctx, y: number, halfLength: number, halfWidth: number): void {
  const reach = halfWidth * QUADRATIC_PEAK_REACH;
  ctx.beginPath();
  ctx.moveTo(0, y - halfLength);
  ctx.quadraticCurveTo(reach, y, 0, y + halfLength);
  ctx.quadraticCurveTo(-reach, y, 0, y - halfLength);
  ctx.closePath();
}

/**
 * The first split: a tall black gash down the seam, its lips raw flesh, with
 * big bone teeth jutting from both lips and interlocking across it, so from
 * its first open frame it reads as the carapace tearing onto a mouth. A plain
 * dark slit under the big eye, with a pale rim, reads as a second eye.
 */
function drawMawSlit(ctx: Ctx, open: number, y: number): void {
  const halfLength = lerp(SLIT_FIRST_HALF_LENGTH, MAW_MAX_RADIUS * MAW_TEETH_FROM, open);
  const halfWidth = halfLength * lerp(SLIT_FIRST_WIDTH_SHARE, SLIT_OPEN_WIDTH_SHARE, open);
  ctx.fillStyle = PALETTE.throat;
  slitPath(ctx, y, halfLength, halfWidth);
  ctx.fill();
  const step = (halfLength * 2) / SLIT_TEETH_PER_LIP;
  const toothHalfBase = step * HALF * SLIT_TOOTH_BASE_SHARE;
  for (const side of [-1, 1]) {
    const stagger = side > 0 ? 0 : HALF;
    for (let i = 0; i < SLIT_TEETH_PER_LIP; i++) {
      const toothY = y - halfLength + step * (i + HALF + stagger * HALF);
      const v = (toothY - y) / halfLength;
      const lipX = side * halfWidth * (1 - v * v);
      ctx.beginPath();
      ctx.moveTo(lipX, toothY - toothHalfBase);
      ctx.lineTo(lipX * (1 - SLIT_TOOTH_REACH), toothY);
      ctx.lineTo(lipX, toothY + toothHalfBase);
      ctx.closePath();
      ctx.fillStyle = PALETTE.bone;
      ctx.fill();
      ctx.strokeStyle = PALETTE.boneDark;
      ctx.lineWidth = OUTLINE_WIDTH * HALF;
      ctx.stroke();
    }
  }
  ctx.strokeStyle = PALETTE.flesh;
  ctx.lineWidth = SLIT_LIP_WIDTH;
  slitPath(ctx, y, halfLength, halfWidth);
  ctx.stroke();
}

/** A lobed closed path round (cx, cy), radius `r` bent by `lobes`. */
function lobedPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  lobes: readonly (readonly [number, number, number])[],
): void {
  ctx.beginPath();
  for (let i = 0; i <= MAW_LIP_POINTS; i++) {
    const a = (i / MAW_LIP_POINTS) * TWO_PI;
    let k = 1;
    for (const [frequency, amplitude, phase] of lobes)
      k += Math.sin(a * frequency + phase) * amplitude;
    const x = cx + Math.cos(a) * r * k;
    const y = cy + Math.sin(a) * r * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** One ring of bone teeth pointing down the throat, each its own size and a few missing. */
function drawToothRing(ctx: Ctx, r: number, y: number, ringIndex: number): void {
  const [count, ringShare, lengthShare, twist] = MAW_TOOTH_RINGS[ringIndex];
  const depth = ringIndex / (MAW_TOOTH_RINGS.length - 1);
  const slot = TWO_PI / count;
  const ring = r * ringShare;
  ctx.fillStyle = mix(PALETTE.bone, PALETTE.boneDark, depth * TOOTH_DEPTH_SHADE);
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = OUTLINE_WIDTH * HALF;
  for (let i = 0; i < count; i++) {
    const seed = (ringIndex * count + i) * TOOTH_SEED;
    if (hash01(seed) < TOOTH_MISSING_SHARE) continue;
    const a = twist + slot * (i + (hash01(seed + 1) - HALF) * TOOTH_SLOT_JITTER * 2);
    const length = r * lengthShare * (1 + (hash01(seed + 2) - HALF) * TOOTH_LENGTH_JITTER * 2);
    const halfBase =
      slot * HALF * TOOTH_BASE_SHARE * (1 + (hash01(seed + 3) - HALF) * TOOTH_WIDTH_JITTER * 2);
    const tipR = ring - length;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - halfBase) * ring, y + Math.sin(a - halfBase) * ring);
    ctx.lineTo(Math.cos(a) * tipR, y + Math.sin(a) * tipR);
    ctx.lineTo(Math.cos(a + halfBase) * ring, y + Math.sin(a + halfBase) * ring);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * The fully open maw: lobed raw lips round a black throat, ringed with uneven
 * bone teeth, and lit only from deep down its middle.
 */
function drawMawDisc(ctx: Ctx, solve: SpiderSolve, r: number, y: number): void {
  lobedPath(ctx, 0, y, r + OUTLINE_WIDTH, MAW_LIP_LOBES);
  ctx.fillStyle = PALETTE.outline;
  ctx.fill();
  const lip = ctx.createRadialGradient(0, y, r * MAW_INNER_SHARE, 0, y, r);
  lip.addColorStop(0, PALETTE.fleshDark);
  lip.addColorStop(HALF, PALETTE.flesh);
  lip.addColorStop(1, PALETTE.fleshDark);
  lobedPath(ctx, 0, y, r, MAW_LIP_LOBES);
  ctx.fillStyle = lip;
  ctx.fill();
  const throat = ctx.createRadialGradient(0, y, 0, 0, y, r * MAW_INNER_SHARE);
  throat.addColorStop(0, MAW_THROAT_DEEP);
  throat.addColorStop(1, PALETTE.throat);
  lobedPath(ctx, 0, y, r * MAW_INNER_SHARE, MAW_LIP_LOBES);
  ctx.fillStyle = throat;
  ctx.fill();
  const wetR = r * (1 - MAW_LIP_WET_INSET);
  for (const [angle, span] of MAW_LIP_WET) {
    ctx.beginPath();
    ctx.arc(0, y, wetR, angle - span * HALF, angle + span * HALF);
    ctx.strokeStyle = rgba(PALETTE.fleshWet, MAW_LIP_WET_ALPHA);
    ctx.lineWidth = MAW_LIP_WET_WIDTH;
    ctx.stroke();
  }
  const innermost = MAW_TOOTH_RINGS.length - 1;
  for (let ring = 0; ring < innermost; ring++) drawToothRing(ctx, r, y, ring);
  if (solve.mawGlow > 0) {
    const gx = r * MAW_GLOW_OFFSET_X;
    const gy = y + r * MAW_GLOW_OFFSET_Y;
    const glowR = r * MAW_GLOW_SHARE;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
    glow.addColorStop(0, rgba(PALETTE.glowHot, solve.mawGlow));
    glow.addColorStop(MAW_GLOW_HOT_STOP, rgba(PALETTE.glowHot, solve.mawGlow));
    glow.addColorStop(MAW_GLOW_RED_STOP, rgba(PALETTE.glow, solve.mawGlow));
    glow.addColorStop(1, rgba(PALETTE.glow, 0));
    lobedPath(ctx, gx, gy, glowR, MAW_GLOW_LOBES);
    ctx.fillStyle = glow;
    ctx.fill();
  }
  // The innermost teeth go over the light, so they stand out against it as
  // shapes instead of dissolving into the glow.
  drawToothRing(ctx, r, y, innermost);
}

/**
 * The screech's sound: plain concentric arcs just ahead of the maw, painted
 * over everything so her raised forelegs never hide them. No spokes between
 * them: arcs joined by radial strands read as a web.
 */
function drawRoar(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.roar <= 0) return;
  const r = MAW_MAX_RADIUS * solve.maw * cephDrawScale(solve);
  const centre = cephToFigure(solve, 0, MAW_CENTRE_Y);
  // Short arcs just ahead of the mouth. They stay at the maw: the burst's reach
  // is the ground telegraph's to show, not the sprite's.
  for (let i = 0; i < ROAR_ARCS; i++) {
    const arcR = r * (1 + ROAR_ARC_STEP * (i + 1));
    const fade = solve.roar * (1 - i / ROAR_ARCS);
    ctx.beginPath();
    ctx.arc(
      centre.x,
      centre.y,
      arcR,
      Math.PI * HALF - ROAR_ARC_SPAN,
      Math.PI * HALF + ROAR_ARC_SPAN,
    );
    ctx.strokeStyle = rgba(PALETTE.outline, ROAR_ARC_SHADOW_ALPHA * fade);
    ctx.lineWidth = ROAR_ARC_SHADOW_WIDTH;
    ctx.stroke();
    ctx.strokeStyle = rgba(PALETTE.spittle, ROAR_ARC_ALPHA * fade);
    ctx.lineWidth = ROAR_ARC_WIDTH;
    ctx.stroke();
  }
}

interface EyeDesc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly angle: number;
  readonly iris: string;
  readonly bloodshot: boolean;
  /** A predator's slit pupil rather than a round human one. */
  readonly slit: boolean;
  readonly sclera: string;
}

/**
 * Six mismatched human eyes, carapace-local; the side is the sign of `x`. No
 * iris is green: green on her is venom, and nothing else may read as it.
 */
const SMALL_EYES: readonly EyeDesc[] = [
  {
    x: -0.19,
    y: 0.2,
    r: 0.082,
    angle: -0.35,
    iris: '#6a4020',
    bloodshot: true,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
  {
    x: -0.08,
    y: 0.33,
    r: 0.056,
    angle: 0.25,
    iris: '#3a74a0',
    bloodshot: false,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
  {
    x: -0.26,
    y: 0.0,
    r: 0.06,
    angle: -0.9,
    iris: '#7a6a40',
    bloodshot: false,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
  {
    x: 0.15,
    y: 0.25,
    r: 0.095,
    angle: 0.3,
    iris: '#2a6a8e',
    bloodshot: true,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
  {
    x: 0.27,
    y: 0.06,
    r: 0.05,
    angle: 0.8,
    iris: '#7a4a2a',
    bloodshot: false,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
  {
    x: 0.07,
    y: 0.38,
    r: 0.045,
    angle: -0.15,
    iris: '#8a5a6a',
    bloodshot: true,
    slit: false,
    sclera: PALETTE.eyeWhite,
  },
];
/**
 * The big eye she hunts with: jaundiced, bloodshot, a red iris and a slit
 * pupil. A clear white eye with a round pupil this size reads as a friendly
 * cyclops.
 */
const CENTRAL_EYE: EyeDesc = {
  x: 0,
  y: -0.06,
  r: 0.21,
  angle: 0,
  iris: '#a02418',
  bloodshot: true,
  slit: true,
  sclera: '#d8c47e',
};
/** How many veins cross the central eye, against a small eye's. */
const CENTRAL_EYE_VEINS = 8;
/** A slit pupil's width and length against a round pupil's diameter. */
const SLIT_WIDTH = 0.4;
const SLIT_LENGTH = 2.6;
const EYE_ALMOND = 1.3;
const CENTRAL_GLOW_SCALE = 1.6;
/**
 * The small eyes are drawn larger than their table sizes and each glows on
 * its own, so at game size her face is a cluster of lit points rather than
 * one mascot eye. The glow stays dim enough never to pass for the maw's light.
 */
const SMALL_EYE_SCALE = 1.4;
const SMALL_EYE_GLOW_SCALE = 1.45;
const SMALL_EYE_GLOW_ALPHA = 0.7;
const CENTRAL_GLOW_ALPHA = 0.8;
const EYE_SOCKET_SCALE = 1.28;
const IRIS_SHARE = 0.52;
const PUPIL_SHARE = 0.2;
const PUPIL_DILATE = 0.9;
const LOOK_TRAVEL_X = 0.38;
const LOOK_TRAVEL_Y = 0.22;
const UNFOCUS_SPREAD = 1.4;
const GLINT_SHARE = 0.16;
const BLOODSHOT_VEINS = 4;
const BLOODSHOT_WIDTH = 0.01;
const LID_TOP = 0.72;
const LID_SPAN = 1.44;

function almondPath(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * EYE_ALMOND, r, 0);
  ctx.quadraticCurveTo(0, r * EYE_ALMOND, -r, 0);
  ctx.closePath();
}

function drawHumanEye(
  ctx: Ctx,
  eye: EyeDesc,
  lid: number,
  look: P2,
  dilate: number,
  unfocus: number,
  seed: number,
): void {
  const { r } = eye;
  ctx.save();
  try {
    ctx.translate(eye.x, eye.y);
    ctx.rotate(eye.angle);
    ctx.save();
    ctx.scale(EYE_SOCKET_SCALE, EYE_SOCKET_SCALE);
    ctx.fillStyle = PALETTE.outline;
    almondPath(ctx, r);
    ctx.fill();
    ctx.restore();
    const white = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    white.addColorStop(0, eye.sclera);
    white.addColorStop(1, PALETTE.eyeShade);
    ctx.fillStyle = white;
    almondPath(ctx, r);
    ctx.fill();
    withClip(
      ctx,
      () => almondPath(ctx, r),
      () => {
        if (eye.bloodshot) {
          const veins = eye === CENTRAL_EYE ? CENTRAL_EYE_VEINS : BLOODSHOT_VEINS;
          for (let v = 0; v < veins; v++) {
            const fromLeft = v % 2 === 0 ? -1 : 1;
            const wobble = (hash01(seed * veins + v) - HALF) * r;
            strokeLine(
              ctx,
              { x: fromLeft * r, y: wobble * HALF },
              { x: fromLeft * r * 0.35, y: wobble },
              PALETTE.blood,
              BLOODSHOT_WIDTH,
            );
          }
        }
        // Rotate the look into this eye's own frame, then scatter it when unfocused.
        const cos = Math.cos(-eye.angle);
        const sin = Math.sin(-eye.angle);
        const stray = (hash01(seed + 1) - HALF) * UNFOCUS_SPREAD * unfocus;
        const lx = look.x * cos - look.y * sin + stray;
        const ly = look.x * sin + look.y * cos - stray * HALF;
        const ix = clamp01((lx + 1) * HALF) * 2 - 1;
        const iy = clamp01((ly + 1) * HALF) * 2 - 1;
        const irisX = ix * r * LOOK_TRAVEL_X;
        const irisY = iy * r * LOOK_TRAVEL_Y;
        fillCircle(ctx, irisX, irisY, r * IRIS_SHARE, PALETTE.outline);
        fillCircle(ctx, irisX, irisY, r * IRIS_SHARE * 0.86, eye.iris);
        const pupil = r * PUPIL_SHARE * (1 + dilate * PUPIL_DILATE);
        if (eye.slit) {
          ctx.fillStyle = PALETTE.pupil;
          ctx.beginPath();
          ctx.ellipse(
            irisX,
            irisY,
            pupil * SLIT_WIDTH,
            r * PUPIL_SHARE * SLIT_LENGTH,
            0,
            0,
            TWO_PI,
          );
          ctx.fill();
        } else {
          fillCircle(ctx, irisX, irisY, pupil, PALETTE.pupil);
        }
        fillCircle(
          ctx,
          irisX - r * 0.15,
          irisY - r * 0.15,
          r * GLINT_SHARE,
          rgba(PALETTE.eyeWhite, 0.9),
        );
        if (lid > 0) {
          ctx.fillStyle = PALETTE.lid;
          ctx.fillRect(-r, -r * LID_TOP, r * 2, r * LID_SPAN * lid);
          strokeLine(
            ctx,
            { x: -r, y: -r * LID_TOP + r * LID_SPAN * lid },
            { x: r, y: -r * LID_TOP + r * LID_SPAN * lid },
            PALETTE.outline,
            BLOODSHOT_WIDTH * 1.5,
          );
        }
      },
    );
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = OUTLINE_WIDTH * HALF;
    almondPath(ctx, r);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

const CHELICERA_X = 0.12;
const CHELICERA_Y = HL + 0.1;
const CHELICERA_RX = 0.165;
const CHELICERA_RY = 0.22;
/** A wet sheen on each chelicera's crown, toward the midline and the light. */
const CHELICERA_GLOSS_INSET = 0.3;
const CHELICERA_GLOSS_SIZE = 0.4;
const CHELICERA_GLOSS_ALPHA = 0.45;
/** How far a chelicera swings out about its root when fully spread, radians. */
const CHELICERA_SPREAD_ANGLE = 0.38;
const PALP_WIDTHS: readonly number[] = [0.065, 0.052, 0.04];
const PALP_TWITCH = 0.03;
const PALP_RIDGE_ALPHA = 0.8;
const PALP_RIDGE_SHARE = 0.35;

/**
 * Each fang, carapace-local on her right: a thick root under the chelicera
 * curving out and then hooking in to a point at the mouth's front edge. Long
 * and bone-pale, the brightest shapes at her front end.
 */
const FANG_ROOT_OUTER = 0.3;
const FANG_ROOT_INNER = 0.07;
const FANG_ROOT_Y = 0.17;
const FANG_BELLY_X = 0.37;
const FANG_BELLY_Y = 0.52;
const FANG_TIP_X = 0.03;
const FANG_INNER_X = 0.14;
const FANG_INNER_Y = 0.4;
/** Where along the fang, root to tip, it turns from dark chitin to bone. */
const FANG_BONE_FROM = 0.6;
/**
 * A wet highlight down the outer curve of the bone half of each fang: the
 * fangs are what make the front end a face, so they carry her hardest light.
 */
const FANG_GLINT_FROM = 0.45;
const FANG_GLINT_INSET = 0.035;
const FANG_GLINT_WIDTH = 0.028;
const FANG_GLINT_ALPHA = 0.95;

function drawChelicera(ctx: Ctx, side: number, spread: number): void {
  const root = { x: side * CHELICERA_X, y: HL - 0.03 };
  ctx.save();
  try {
    ctx.translate(root.x, root.y);
    ctx.rotate(-side * spread * CHELICERA_SPREAD_ANGLE);
    ctx.translate(-root.x, -root.y);
    const cx = side * CHELICERA_X;
    ctx.fillStyle = PALETTE.outline;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      CHELICERA_Y,
      CHELICERA_RX + OUTLINE_WIDTH,
      CHELICERA_RY + OUTLINE_WIDTH,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    const bulb = ctx.createRadialGradient(cx, CHELICERA_Y - 0.02, 0, cx, CHELICERA_Y, CHELICERA_RY);
    bulb.addColorStop(0, PALETTE.carapaceLight);
    bulb.addColorStop(1, PALETTE.carapaceDark);
    ctx.fillStyle = bulb;
    ctx.beginPath();
    ctx.ellipse(cx, CHELICERA_Y, CHELICERA_RX, CHELICERA_RY, 0, 0, TWO_PI);
    ctx.fill();
    fillSoftEllipse(
      ctx,
      cx - side * CHELICERA_RX * CHELICERA_GLOSS_INSET,
      CHELICERA_Y - CHELICERA_RY * CHELICERA_GLOSS_INSET,
      CHELICERA_RX * CHELICERA_GLOSS_SIZE,
      CHELICERA_RY * CHELICERA_GLOSS_SIZE,
      PALETTE.gloss,
      CHELICERA_GLOSS_ALPHA,
    );
    // The fang curls in toward the midline and ends at the mouth's front edge.
    ctx.beginPath();
    ctx.moveTo(side * FANG_ROOT_OUTER, HL + FANG_ROOT_Y);
    ctx.quadraticCurveTo(side * FANG_BELLY_X, HL + FANG_BELLY_Y, side * FANG_TIP_X, FANG_TIP_Y);
    ctx.quadraticCurveTo(
      side * FANG_INNER_X,
      HL + FANG_INNER_Y,
      side * FANG_ROOT_INNER,
      HL + FANG_ROOT_Y,
    );
    ctx.closePath();
    // Dark at the root and bone only toward the point: an all-pale fang reads
    // at game size as a moustache or a pair of tusks.
    const fang = ctx.createLinearGradient(
      side * FANG_ROOT_OUTER,
      HL + FANG_ROOT_Y,
      side * FANG_TIP_X,
      FANG_TIP_Y,
    );
    fang.addColorStop(0, PALETTE.fangRoot);
    fang.addColorStop(FANG_BONE_FROM, PALETTE.boneDark);
    fang.addColorStop(1, PALETTE.bone);
    ctx.fillStyle = fang;
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = OUTLINE_WIDTH * HALF;
    ctx.stroke();
    const glintStart = quadraticPoint(
      { x: side * FANG_ROOT_OUTER, y: HL + FANG_ROOT_Y },
      { x: side * FANG_BELLY_X, y: HL + FANG_BELLY_Y },
      { x: side * FANG_TIP_X, y: FANG_TIP_Y },
      FANG_GLINT_FROM,
    );
    ctx.beginPath();
    ctx.moveTo(glintStart.x - side * FANG_GLINT_INSET, glintStart.y);
    ctx.quadraticCurveTo(
      side * (FANG_BELLY_X - FANG_GLINT_INSET * 2),
      HL + FANG_BELLY_Y - FANG_GLINT_INSET,
      side * (FANG_TIP_X + FANG_GLINT_INSET),
      FANG_TIP_Y - FANG_GLINT_INSET * 2,
    );
    ctx.strokeStyle = rgba(PALETTE.gloss, FANG_GLINT_ALPHA);
    ctx.lineWidth = FANG_GLINT_WIDTH;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

/** The pedipalps, carapace-local on her right: out past the fangs, then in. */
const PALP_ROOT_X = 0.22;
const PALP_ROOT_Y = -0.05;
const PALP_ELBOW_X = 0.34;
const PALP_ELBOW_Y = 0.1;
const PALP_TIP_X = 0.29;
const PALP_TIP_Y = 0.26;

function drawPalp(ctx: Ctx, side: number, twitch: number): void {
  const points: P2[] = [
    { x: side * PALP_ROOT_X, y: HL + PALP_ROOT_Y },
    { x: side * PALP_ELBOW_X, y: HL + PALP_ELBOW_Y + twitch * PALP_TWITCH },
    { x: side * PALP_TIP_X, y: HL + PALP_TIP_Y + twitch * PALP_TWITCH * HALF },
  ];
  for (let i = 0; i < points.length - 1; i++) {
    ctx.fillStyle = PALETTE.outline;
    capsulePath(
      ctx,
      points[i],
      points[i + 1],
      PALP_WIDTHS[i] + OUTLINE_WIDTH * 2,
      PALP_WIDTHS[i + 1] + OUTLINE_WIDTH * 2,
    );
    ctx.fill();
  }
  for (let i = 0; i < points.length - 1; i++) {
    ctx.fillStyle = PALETTE.legDark;
    capsulePath(ctx, points[i], points[i + 1], PALP_WIDTHS[i], PALP_WIDTHS[i + 1]);
    ctx.fill();
    strokeLine(
      ctx,
      points[i],
      points[i + 1],
      rgba(PALETTE.legRidge, PALP_RIDGE_ALPHA),
      PALP_WIDTHS[i + 1] * PALP_RIDGE_SHARE,
    );
  }
  const tip = points[points.length - 1];
  fillCircle(ctx, tip.x, tip.y, PALP_WIDTHS[PALP_WIDTHS.length - 1] * 0.75, PALETTE.legDark);
}

function drawCephalothorax(ctx: Ctx, solve: SpiderSolve): void {
  const origin = cephToFigure(solve, 0, 0);
  ctx.save();
  try {
    ctx.translate(origin.x, origin.y);
    ctx.scale(cephDrawScale(solve), cephDrawScale(solve));
    drawMaw(ctx, solve);
    for (const side of [-1, 1]) {
      ctx.save();
      try {
        ctx.translate(0, SPLIT_PIVOT_Y);
        ctx.rotate(-side * solve.maw * SPLIT_MAX_ANGLE);
        ctx.translate(side * solve.maw * SPLIT_MAX_SHIFT, -SPLIT_PIVOT_Y);
        drawPalp(ctx, side, solve.palp * side);
        drawChelicera(ctx, side, solve.cheliceraSpread);
        drawCarapaceHalf(ctx, side, solve.maw);
        SMALL_EYES.forEach((eye, index) => {
          if (Math.sign(eye.x) !== side) return;
          const shown = { ...eye, r: eye.r * SMALL_EYE_SCALE };
          fillSoftEllipse(
            ctx,
            shown.x,
            shown.y,
            shown.r * SMALL_EYE_GLOW_SCALE,
            shown.r * SMALL_EYE_GLOW_SCALE,
            PALETTE.eyeGlow,
            SMALL_EYE_GLOW_ALPHA * (1 - solve.lids[index]),
          );
          drawHumanEye(
            ctx,
            shown,
            solve.lids[index],
            solve.look,
            solve.dilate,
            solve.unfocus,
            index,
          );
        });
      } finally {
        ctx.restore();
      }
    }
    drawClosedSeam(ctx, solve.maw);
    // The one eye that lights up: at 32 px it is the mark that says which end is her head.
    fillSoftEllipse(
      ctx,
      CENTRAL_EYE.x,
      CENTRAL_EYE.y,
      CENTRAL_EYE.r * CENTRAL_GLOW_SCALE,
      CENTRAL_EYE.r * CENTRAL_GLOW_SCALE,
      PALETTE.eyeGlow,
      CENTRAL_GLOW_ALPHA * (1 - solve.centralLid),
    );
    drawHumanEye(
      ctx,
      CENTRAL_EYE,
      solve.centralLid,
      solve.look,
      solve.dilate,
      0,
      SMALL_EYES.length,
    );
  } finally {
    ctx.restore();
  }
}

// ── Venom glob ───────────────────────────────────────────────────────────────

const GLOB_STRETCH = 0.6;
const GLOB_CORE_SHARE = 0.45;
const GLOB_GLOW_SCALE = 1.3;
const GLOB_GLOW_ALPHA = 0.55;
const GLOB_STRING_WIDTH = 0.022;

function drawGlob(ctx: Ctx, solve: SpiderSolve): void {
  const glob = solve.glob;
  if (glob === null || glob.radius <= 0) return;
  const at = cephToFigure(solve, glob.x, glob.y);
  const r = glob.radius * cephDrawScale(solve);
  const stretch = 1 + glob.fling * GLOB_STRETCH;
  const leftFang = cephToFigure(solve, -0.02, FANG_TIP_Y);
  const rightFang = cephToFigure(solve, 0.02, FANG_TIP_Y);
  fillSoftEllipse(
    ctx,
    at.x,
    at.y,
    r * GLOB_GLOW_SCALE,
    r * GLOB_GLOW_SCALE * stretch,
    PALETTE.venomGlow,
    GLOB_GLOW_ALPHA,
  );
  for (const fang of [leftFang, rightFang]) {
    strokeLine(ctx, fang, at, rgba(PALETTE.venom, 0.85), GLOB_STRING_WIDTH);
  }
  ctx.fillStyle = PALETTE.venomDark;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, r + OUTLINE_WIDTH, r * stretch + OUTLINE_WIDTH, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = PALETTE.venom;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, r, r * stretch, 0, 0, TWO_PI);
  ctx.fill();
  fillSoftEllipse(
    ctx,
    at.x - r * 0.2,
    at.y - r * 0.15,
    r * 0.6,
    r * 0.5 * stretch,
    PALETTE.venomLight,
    0.8,
  );
  fillSoftEllipse(
    ctx,
    at.x,
    at.y,
    r * GLOB_CORE_SHARE,
    r * GLOB_CORE_SHARE * stretch,
    PALETTE.venomCore,
    1,
  );
  fillCircle(ctx, at.x - r * 0.3, at.y - r * 0.3, r * 0.18, PALETTE.venomGlow);
}

// ── Venom spray ──────────────────────────────────────────────────────────────

/** Droplets flung ahead of the mouth: [sideways, forward share, size], in tiles. */
const SPRAY_DROPS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0.07],
  [-0.08, 0.75, 0.05],
  [0.09, 0.8, 0.05],
  [-0.03, 0.5, 0.04],
  [0.05, 0.4, 0.035],
  [-0.1, 0.3, 0.03],
];
const SPRAY_REACH = 0.8;

function drawSpray(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.spray <= 0) return;
  for (const [aside, forward, size] of SPRAY_DROPS) {
    const at = cephToFigure(
      solve,
      aside * (1 + solve.spray),
      FANG_TIP_Y + forward * SPRAY_REACH * solve.spray,
    );
    fillCircle(ctx, at.x, at.y, size + OUTLINE_WIDTH * HALF, PALETTE.venomDark);
    fillCircle(ctx, at.x, at.y, size, PALETTE.venom);
  }
}

// ── Slam dust ────────────────────────────────────────────────────────────────

const DUST_PUFFS = 6;
const DUST_BLOBS_PER_PUFF = 3;
/** Spaces the hash seeds of neighbouring blobs so their angles and sizes do not correlate. */
const DUST_SEED_STRIDE = 5;
const DUST_MIN_REACH_SHARE = 0.2;
const DUST_MIN_SIZE_SHARE = 0.35;
/** Dust hugs the floor: each blob is squat rather than round. */
const DUST_FLATTEN = 0.7;
const DUST_REACH = 0.42;
const DUST_RADIUS = 0.27;
const DUST_ALPHA = 0.6;
/** A hard core: a soft-edged pale puff is lost against the lab floor's mid tone. */
const DUST_CORE = 0.6;
/** A darker halo under each puff separates it from the floor at game size. */
const DUST_HALO_SCALE = 1.2;
const DUST_HALO_ALPHA = 0.35;

/**
 * Low, lumpy dust kicked up round each foreleg's tip. Every puff is a cluster
 * of uneven blobs in two tones of the floor's own dust, with no ring and no
 * single round shape: a clean disc at a foot reads at game size as a button or
 * a coin lying on the floor, not as the ground being hit.
 */
function drawImpactDust(ctx: Ctx, solve: SpiderSolve): void {
  if (solve.impact <= 0) return;
  const spread = 1.6 - solve.impact;
  for (const leg of solve.legs) {
    if (leg.desc.pair !== 0) continue;
    const tip = project(leg.joints[leg.joints.length - 1]);
    const blobs = Array.from({ length: DUST_PUFFS * DUST_BLOBS_PER_PUFF }, (_, i) => {
      const seed = i * DUST_SEED_STRIDE + leg.index;
      const a = hash01(seed) * TWO_PI;
      const reach = DUST_REACH * spread * lerp(DUST_MIN_REACH_SHARE, 1, hash01(seed + 1));
      const size = DUST_RADIUS * spread * lerp(DUST_MIN_SIZE_SHARE, 1, hash01(seed + 2));
      return {
        x: tip.x + Math.cos(a) * reach,
        y: tip.y + Math.sin(a) * reach * DUST_FLATTEN,
        size,
        light: hash01(seed + 3) > HALF,
      };
    });
    for (const blob of blobs) {
      fillSoftEllipse(
        ctx,
        blob.x,
        blob.y,
        blob.size * DUST_HALO_SCALE,
        blob.size * DUST_HALO_SCALE * DUST_FLATTEN,
        PALETTE.outline,
        DUST_HALO_ALPHA * solve.impact,
      );
    }
    for (const blob of blobs) {
      fillSoftEllipse(
        ctx,
        blob.x,
        blob.y,
        blob.size,
        blob.size * DUST_FLATTEN,
        blob.light ? PALETTE.dust : PALETTE.dustShade,
        DUST_ALPHA * solve.impact,
        0,
        DUST_CORE,
      );
    }
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Paints the Grotesque Spider.
 *
 * @param sx   Left edge of the tile she stands on, in the target's coordinates.
 * @param sy   Top edge of that tile.
 * @param ts   Tile size in pixels.
 * @param pose Which pose of which row to paint.
 */
export function drawGrotesqueSpider(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  pose: GrotesqueSpiderPose,
): void {
  const solve = solveSpiderPose(pose);
  ctx.save();
  try {
    ctx.translate(sx + ts * SPIDER_BODY_CENTRE_RATIO, sy + ts * SPIDER_BODY_CENTRE_RATIO);
    ctx.scale(ts, ts);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawGroundLayer(ctx, solve);
    for (const leg of solve.legs) if (!leg.overBody) drawLeg(ctx, leg);
    drawPedicel(ctx, solve);
    // The ovipositor and its egg go under the abdomen, so the tube comes out
    // from beneath her tail tip rather than lying across her back, and the
    // tube goes over the egg, so the egg is pushed out of its end instead of
    // sitting on top of it.
    drawHeldEgg(ctx, solve);
    drawOvipositor(ctx, solve);
    drawAbdomen(ctx, solve);
    drawCephalothorax(ctx, solve);
    for (const leg of solve.legs) if (leg.overBody) drawLeg(ctx, leg);
    // Effects go over everything, raised legs included: they are the tell.
    drawGlob(ctx, solve);
    drawSpray(ctx, solve);
    drawRoar(ctx, solve);
    drawImpactDust(ctx, solve);
    if (solve.pallor > 0) {
      // Dead, she greys out: colour draining away is what separates a corpse
      // from a creature crouched to strike.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = rgba(PALETTE.corpse, PALLOR_ALPHA * solve.pallor);
      ctx.fillRect(
        -CELL_REACH_TILES,
        -CELL_REACH_TILES,
        CELL_REACH_TILES * 2,
        CELL_REACH_TILES * 2,
      );
    }
  } finally {
    ctx.restore();
  }
}
