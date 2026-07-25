/**
 * Town-square fountain: a single tiered stone fountain drawn as one continuous
 * composition spanning the whole 3×3 FOUNTAIN block, then sliced per tile.
 *
 * Drawing the whole fountain at once (rather than nine independent tiles) is
 * what makes the silhouette round, the pool a single water surface, and the
 * ripples continuous across tile boundaries.
 *
 * Everything below `drawFountainComposition` is DOM-free and takes a plain
 * 2D context, so an offline script can rasterise preview sheets with the
 * `canvas` devDependency.
 */
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

const TAU = Math.PI * 2;

// ─── Composition frame ───────────────────────────────────────────────────────
/** Tiles spanned by the fountain footprint on each axis. */
const BLOCK_TILES = 3;
/** Tile-heights reserved above the block for the jet plume and its droplets. */
const HEADROOM_TILES = 1.5;
/** Pre-rendered animation frames. Every effect is periodic over exactly this many. */
const FOUNTAIN_LOOP_FRAMES = 24;
/** Wall-clock duration of one full animation loop. */
const FOUNTAIN_LOOP_SECONDS = 1.6;
/**
 * The composition is rasterised at this multiple of its final size and
 * downscaled once. That matches the soft, anti-aliased edges of the
 * neighbouring props (painted at 64 px per tile, shown at 32) — and because the
 * downscale lands in the final frame canvas, per-tile slicing stays an exact
 * integer pixel copy, so no resampling seam appears at tile boundaries.
 */
const AUTHORING_SCALE = 2;

// ─── Palette ─────────────────────────────────────────────────────────────────
// Warm limestone sampled to sit beside the plaza cobbles and the well sprite;
// the town square contains no cold grey, so neither does the fountain.
const STONE_HIGHLIGHT = '#e3d8bd';
const STONE_LIGHT = '#cdbfa0';
const STONE_MID = '#a8987c';
const STONE_COPING_SHADE = '#8a7c66';
const STONE_SHADE = '#6f6350';
const STONE_DEEP = '#4b4136';
const STONE_WET = '#7a6d55';
const MOSS_LIGHT = '#5c6b34';
const MOSS_DARK = '#465228';
const WATER_DEEP = '#1f4a63';
const WATER_BODY = '#2f6f8c';
const WATER_SHALLOW = '#58a0b4';
const WATER_GLINT = '#cfe9f2';
const FOAM = '#eef7f9';
const SHADOW_BROWN = '#261a0e';

// ─── Basin geometry (tile units) ─────────────────────────────────────────────
const POOL_CENTRE_X_TILES = 1.5;
/** Pushed low in the block so the column and jet own the upper half. */
const POOL_CENTRE_Y_TILES = HEADROOM_TILES + 1.52;
const BASIN_OUTER_RX_TILES = 1.42;
/** 0.67 of the horizontal radius — the squash that reads as a 3/4 view. */
const BASIN_OUTER_RY_TILES = 0.95;
const COPING_RING_WIDTH_TILES = 0.17;
const FRONT_WALL_HEIGHT_TILES = 0.36;
/**
 * How far the water plane sits below the coping. The water ellipse keeps its
 * southern edge flush with the lip and drops its northern edge, which exposes
 * the far inner wall — the cue that the pool is recessed, not painted on.
 */
const WATER_RECESS_TILES = 0.09;
/** Horizontal inset of the water from the inner basin wall. */
const WATER_SIDE_INSET_TILES = 0.03;

// ─── Ground contact shadow ───────────────────────────────────────────────────
// Sized to outrun the basin: the fountain is drawn over its own shadow, so only
// the fringe that clears the outer wall ever reaches the player's eye.
const CONTACT_SHADOW_RX_TILES = 1.46;
const CONTACT_SHADOW_RY_TILES = 0.95;
const CONTACT_SHADOW_OFFSET_X_TILES = 0.04;
const CONTACT_SHADOW_OFFSET_Y_TILES = 0.16;
/** Fraction of the radius that stays at full opacity before the falloff starts. */
const CONTACT_SHADOW_CORE_RATIO = 0.62;
/** Where along the front wall's height the shadow's centre sits. */
const CONTACT_SHADOW_BASE_RATIO = 1;
const CONTACT_SHADOW_ALPHA = 0.4;

// ─── Front wall masonry ──────────────────────────────────────────────────────
const MASONRY_COURSES = 2;
const MASONRY_BLOCKS_PER_COURSE = 8;
/** Peak lighten/darken applied to an individual block so no two blocks match. */
const MASONRY_TONE_RANGE = 0.13;
const MASONRY_JOINT_ALPHA = 0.4;
const MASONRY_JOINT_WIDTH_TILES = 0.018;
/** Half-block offset applied to alternate courses so joints never line up. */
const MASONRY_COURSE_STAGGER = 0.5;
/** Lit-left / shaded-right wash that makes the wall read as a cylinder. */
const CYLINDER_LIGHT_ALPHA = 0.12;
const CYLINDER_SHADE_ALPHA = 0.3;
/** Where across the wall the light and shade washes cross over. */
const CYLINDER_NEUTRAL_STOP = 0.45;

// ─── Coping ring ─────────────────────────────────────────────────────────────
const COPING_JOINT_COUNT = 20;
const COPING_JOINT_ALPHA = 0.3;
/** Gradient stop where the lit upper-left lip settles into its base tone. */
const COPING_LIGHT_STOP = 0.45;
/** Screen angle of the chipped block on the south-east lip. */
const COPING_CHIP_ANGLE = Math.PI * 0.28;
const COPING_CHIP_ARC = Math.PI * 0.07;
/** Fraction of the coping width left intact under the chip, from the inner edge. */
const COPING_CHIP_INTACT_RATIO = 0.35;
const COPING_CHIP_EDGE_ALPHA = 0.55;
const COPING_CRACK_ANGLE = Math.PI * 0.56;
const COPING_CRACK_ALPHA = 0.45;

// ─── Water surface ───────────────────────────────────────────────────────────
/** Sky reflection along the far inner edge, as a fraction of the pool height. */
const SKY_CRESCENT_DEPTH = 0.42;
const SKY_CRESCENT_ALPHA = 0.34;
const SUBMERGED_ITEM_COUNT = 6;
const SUBMERGED_ITEM_ALPHA = 0.35;
const SUBMERGED_ITEM_MIN_RADIUS_TILES = 0.025;
const SUBMERGED_ITEM_RADIUS_RANGE_TILES = 0.02;
const SUBMERGED_WOBBLE_TILES = 0.012;
/** Coins settle away from the rim, where the falling water would sweep them. */
const SUBMERGED_SPREAD_RATIO = 0.8;
const RIPPLE_RING_COUNT = 3;
const RIPPLE_START_RADIUS_RATIO = 0.28;
const RIPPLE_ALPHA = 0.3;
const RIPPLE_WIDTH_TILES = 0.026;
const GLINT_COUNT = 5;
const GLINT_ALPHA = 0.5;
const GLINT_RX_TILES = 0.11;
const GLINT_RY_TILES = 0.022;
/** How far a glint drifts east over one full drift cycle. */
const GLINT_DRIFT_TILES = 0.5;
const GLINT_SPREAD_X_RATIO = 0.7;
const GLINT_SPREAD_Y_RATIO = 0.6;
const IMPACT_RING_COUNT = 2;
const IMPACT_RING_MAX_RADIUS_TILES = 0.24;
const IMPACT_RING_ALPHA = 0.26;
const FOAM_PATCH_RX_TILES = 0.12;
const FOAM_PATCH_ALPHA = 0.2;

// ─── Column ──────────────────────────────────────────────────────────────────
const PLINTH_RX_TILES = 0.42;
const PLINTH_RY_TILES = 0.17;
const PLINTH_HEIGHT_TILES = 0.12;
const PLINTH_AO_SPREAD_TILES = 0.09;
const PLINTH_AO_ALPHA = 0.4;
const SHAFT_BOTTOM_WIDTH_TILES = 0.34;
const SHAFT_TOP_WIDTH_TILES = 0.28;
const SHAFT_HEIGHT_TILES = 1.0;
/** Fractions of the shaft height at which the two carved rings sit. */
const SHAFT_RING_HEIGHTS = [0.28, 0.62] as const;
const SHAFT_RING_THICKNESS_TILES = 0.05;
const SHAFT_RING_OVERHANG_TILES = 0.03;
/** Vertical foreshortening of a carved ring, so it reads as a collar not a bar. */
const SHAFT_RING_SQUASH = 0.34;
/** Height of the darker, algae-stained band where the shaft leaves the water. */
const SHAFT_WATERLINE_HEIGHT_TILES = 0.1;
const SHAFT_MOSS_STREAK_COUNT = 3;
/** Moss climbs only the lowest part of the shaft, just above the waterline. */
const SHAFT_MOSS_CLIMB_RATIO = 0.3;
const SHAFT_MOSS_MIN_WIDTH_RATIO = 0.2;
const SHAFT_MOSS_WIDTH_RANGE_RATIO = 0.3;
const SHAFT_MOSS_HEIGHT_RATIO = 0.4;
const SHAFT_MOSS_ALPHA = 0.5;
/** Offset from the shaft centre to its shaded left face. */
const SHAFT_MOSS_OFFSET_RATIO = 0.5;
/** Gradient stop where the shaft's lit left face turns to its body tone. */
const SHAFT_LIGHT_STOP = 0.4;

// ─── Upper bowl ──────────────────────────────────────────────────────────────
const BOWL_RX_TILES = 0.5;
const BOWL_RY_TILES = 0.17;
const BOWL_UNDERSIDE_DEPTH_TILES = 0.2;
const BOWL_LIP_WIDTH_TILES = 0.06;
const BOWL_WATER_INSET_TILES = 0.03;
const BOWL_JET_FOAM_RX_TILES = 0.14;
const BOWL_JET_FOAM_ALPHA = 0.55;
/** The underside curve is pulled to twice its depth so the bezier apex lands on it. */
const BOWL_UNDERSIDE_CONTROL_SCALE = 2;
/** Gradient stop where the bowl lip's highlight settles into its base tone. */
const BOWL_LIP_LIGHT_STOP = 0.5;

// ─── Overflow sheets ─────────────────────────────────────────────────────────
const OVERFLOW_SPOUT_COUNT = 4;
/** First spout sits south-east; the rest are spaced evenly around the bowl. */
const OVERFLOW_FIRST_ANGLE = Math.PI * 0.25;
const OVERFLOW_TOP_WIDTH_TILES = 0.07;
const OVERFLOW_BOTTOM_WIDTH_TILES = 0.13;
const OVERFLOW_LANDING_RX_TILES = 0.95;
const OVERFLOW_WIDTH_PULSE = 0.18;
const OVERFLOW_TOP_ALPHA = 0.34;
const OVERFLOW_BOTTOM_ALPHA = 0.07;
const OVERFLOW_LIP_FOAM_ALPHA = 0.6;
const OVERFLOW_LIP_FOAM_SQUASH = 0.35;
const OVERFLOW_STREAK_ALPHA = 0.16;
const OVERFLOW_BEND_X_RATIO = 0.8;
const OVERFLOW_BEND_Y_RATIO = 0.2;

// ─── Jet ─────────────────────────────────────────────────────────────────────
const JET_WIDTH_TILES = 0.07;
const JET_HEIGHT_TILES = 0.85;
const JET_TIP_WIDTH_RATIO = 0.22;
const JET_PULSE = 0.12;
const JET_GLOW_SPREAD_TILES = 0.11;
const JET_GLOW_ALPHA = 0.16;
const JET_TIP_ALPHA = 0.95;
const JET_CORE_ALPHA = 0.7;
const JET_BASE_ALPHA = 0.28;
/** Where along the jet the bright tip has faded into the translucent stream. */
const JET_CORE_FADE_STOP = 0.35;
const JET_SPRAY_RADIUS_TILES = 0.05;
const JET_SPRAY_ALPHA = 0.6;
/** The glow narrows faster than the stream, hugging the tip. */
const JET_GLOW_TIP_RATIO = 0.4;
/** Spray puff straddles the tip: half its radius below, and taller than wide. */
const JET_SPRAY_DROP_RATIO = 0.5;
const JET_SPRAY_STRETCH = 1.3;
const JET_DROPLET_COUNT = 6;
const JET_DROPLET_RISE_TILES = 0.34;
const JET_DROPLET_SPREAD_TILES = 0.22;
const JET_DROPLET_RADIUS_TILES = 0.028;

// ─── Wear at the base ────────────────────────────────────────────────────────
// Screen angles (south-west, south, south-east) of the moss tufts at the wall
// foot. They must stay clear of the composition's left and right edges: a tuft
// that overflows is silently cut off by the tile slice, leaving a straight
// vertical edge on a tile seam — the exact square read this renderer exists to
// avoid. At the basin's widest point a tuft would overhang by ~1 px.
const MOSS_TUFT_ANGLES = [Math.PI * 0.78, Math.PI * 0.5, Math.PI * 0.18] as const;
const MOSS_TUFT_BLADES = 4;
const MOSS_TUFT_RX_TILES = 0.11;
const MOSS_TUFT_RY_TILES = 0.05;
const MOSS_BLADE_MIN_HEIGHT_RATIO = 1.2;
const MOSS_BLADE_HEIGHT_RANGE_RATIO = 1.6;
const MOSS_BLADE_WIDTH_RATIO = 0.22;
const WATER_STAIN_ANGLES = [Math.PI * 0.34, Math.PI * 0.62, Math.PI * 0.86] as const;
const WATER_STAIN_WIDTH_TILES = 0.05;
const WATER_STAIN_ALPHA = 0.3;

// ─── Loop harmonics ──────────────────────────────────────────────────────────
// Every animated quantity is an integer harmonic of the loop phase, so the last
// frame joins the first with no discontinuity.
const RIPPLE_CYCLES = 2;
const IMPACT_RING_CYCLES = 3;
const GLINT_DRIFT_CYCLES = 1;
const SUBMERGED_WOBBLE_CYCLES = 1;
const OVERFLOW_PULSE_CYCLES = 2;
const JET_PULSE_CYCLES = 2;
const JET_DROPLET_CYCLES = 2;

/**
 * Palette colour at a given alpha. Gradient stops need `rgba(...)` strings, and
 * hand-writing them would fork the palette constants above.
 */
function withAlpha(hexColor: string, alpha: number): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** Deterministic pseudo-random value in [0, 1) — keeps every frame identical. */
function hash01(seed: number): number {
  const mixed = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  const folded = (mixed ^ (mixed >>> 13)) >>> 0;
  return folded / 0x100000000;
}

/** Positive shifts lighten, negative darken — used for per-block stone variation. */
function toneOverlay(shift: number): string {
  return shift >= 0 ? `rgba(255,255,255,${shift})` : `rgba(0,0,0,${-shift})`;
}

interface FountainGeometry {
  /** Pixels per tile unit for this rasterisation. */
  readonly u: number;
  readonly cx: number;
  readonly cy: number;
  readonly outerRx: number;
  readonly outerRy: number;
  readonly innerRx: number;
  readonly innerRy: number;
  readonly frontWallH: number;
  readonly waterCy: number;
  readonly waterRx: number;
  readonly waterRy: number;
  /** Vertical foreshortening of the water plane; ripples inherit it. */
  readonly waterSquash: number;
  readonly shaftBottomY: number;
  readonly shaftTopY: number;
  readonly bowlCy: number;
}

function computeGeometry(originX: number, originY: number, u: number): FountainGeometry {
  const cx = originX + POOL_CENTRE_X_TILES * u;
  const cy = originY + POOL_CENTRE_Y_TILES * u;
  const outerRx = BASIN_OUTER_RX_TILES * u;
  const outerRy = BASIN_OUTER_RY_TILES * u;
  const copingWidth = COPING_RING_WIDTH_TILES * u;
  const innerRx = outerRx - copingWidth;
  const innerRy = outerRy - copingWidth;
  const recess = WATER_RECESS_TILES * u;
  const waterRx = innerRx - WATER_SIDE_INSET_TILES * u;
  const waterRy = innerRy - recess;
  const shaftBottomY = cy - PLINTH_HEIGHT_TILES * u;
  const shaftTopY = shaftBottomY - SHAFT_HEIGHT_TILES * u;
  return {
    u,
    cx,
    cy,
    outerRx,
    outerRy,
    innerRx,
    innerRy,
    frontWallH: FRONT_WALL_HEIGHT_TILES * u,
    waterCy: cy + recess,
    waterRx,
    waterRy,
    waterSquash: waterRy / waterRx,
    shaftBottomY,
    shaftTopY,
    bowlCy: shaftTopY,
  };
}

/** Builds the crescent between the outer basin arc and the same arc extruded down. */
function frontWallPath(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, g.outerRx, g.outerRy, 0, 0, Math.PI);
  ctx.ellipse(g.cx, g.cy + g.frontWallH, g.outerRx, g.outerRy, 0, Math.PI, 0, true);
  ctx.closePath();
}

/** Builds the band between two vertically-offset copies of the same elliptical arc. */
function arcBandPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topCy: number,
  bottomCy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, topCy, rx, ry, 0, startAngle, endAngle);
  ctx.ellipse(cx, bottomCy, rx, ry, 0, endAngle, startAngle, true);
  ctx.closePath();
}

function ellipseRingPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, outerRx, outerRy, 0, 0, TAU);
  ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, TAU);
}

/** Builds the wedge of an ellipse ring between two angles — one laid block. */
function ringArcPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, outerRx, outerRy, 0, startAngle, endAngle);
  ctx.ellipse(cx, cy, innerRx, innerRy, 0, endAngle, startAngle, true);
  ctx.closePath();
}

/**
 * Runs `draw` in a space where the water plane is a unit-squashed circle of
 * radius `g.waterRx` centred on the origin, clipped to the pool. Ripples, coins
 * and glints all lie on that plane, so drawing them as circles here gives them
 * the pool's foreshortening for free.
 */
function onWaterPlane(
  ctx: CanvasRenderingContext2D,
  g: FountainGeometry,
  draw: (radius: number) => void,
): void {
  ctx.save();
  ctx.translate(g.cx, g.waterCy);
  ctx.scale(1, g.waterSquash);
  ctx.beginPath();
  ctx.arc(0, 0, g.waterRx, 0, TAU);
  ctx.clip();
  draw(g.waterRx);
  ctx.restore();
}

function drawContactShadow(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const rx = CONTACT_SHADOW_RX_TILES * g.u;
  const ry = CONTACT_SHADOW_RY_TILES * g.u;
  const centreX = g.cx + CONTACT_SHADOW_OFFSET_X_TILES * g.u;
  const centreY =
    g.cy + g.frontWallH * CONTACT_SHADOW_BASE_RATIO + CONTACT_SHADOW_OFFSET_Y_TILES * g.u;

  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(1, ry / rx);
  const falloff = ctx.createRadialGradient(0, 0, rx * CONTACT_SHADOW_CORE_RATIO, 0, 0, rx);
  falloff.addColorStop(0, withAlpha(SHADOW_BROWN, CONTACT_SHADOW_ALPHA));
  falloff.addColorStop(1, withAlpha(SHADOW_BROWN, 0));
  ctx.fillStyle = falloff;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBasinFrontWall(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const wallTop = g.cy - g.outerRy;
  const wallBottom = g.cy + g.frontWallH + g.outerRy;

  frontWallPath(ctx, g);
  const body = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
  body.addColorStop(0, STONE_MID);
  body.addColorStop(1, STONE_SHADE);
  ctx.fillStyle = body;
  ctx.fill();

  const courseHeight = g.frontWallH / MASONRY_COURSES;
  const jointWidth = MASONRY_JOINT_WIDTH_TILES * g.u;
  for (let course = 0; course < MASONRY_COURSES; course++) {
    const topCy = g.cy + course * courseHeight;
    const bottomCy = topCy + courseHeight;
    const stagger = course % 2 === 0 ? 0 : MASONRY_COURSE_STAGGER;
    for (let block = -1; block < MASONRY_BLOCKS_PER_COURSE; block++) {
      const rawStart = (Math.PI * (block + stagger)) / MASONRY_BLOCKS_PER_COURSE;
      const rawEnd = (Math.PI * (block + 1 + stagger)) / MASONRY_BLOCKS_PER_COURSE;
      const startAngle = Math.max(rawStart, 0);
      const endAngle = Math.min(rawEnd, Math.PI);
      if (endAngle <= startAngle) continue;

      const toneShift = (hash01(course * 31 + block) - 0.5) * MASONRY_TONE_RANGE;
      arcBandPath(ctx, g.cx, topCy, bottomCy, g.outerRx, g.outerRy, startAngle, endAngle);
      ctx.fillStyle = toneOverlay(toneShift);
      ctx.fill();

      if (startAngle > 0) {
        ctx.strokeStyle = STONE_DEEP;
        ctx.globalAlpha = MASONRY_JOINT_ALPHA;
        ctx.lineWidth = jointWidth;
        ctx.beginPath();
        ctx.moveTo(
          g.cx + g.outerRx * Math.cos(startAngle),
          topCy + g.outerRy * Math.sin(startAngle),
        );
        ctx.lineTo(
          g.cx + g.outerRx * Math.cos(startAngle),
          bottomCy + g.outerRy * Math.sin(startAngle),
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (course > 0) {
      ctx.strokeStyle = STONE_DEEP;
      ctx.globalAlpha = MASONRY_JOINT_ALPHA;
      ctx.lineWidth = jointWidth;
      ctx.beginPath();
      ctx.ellipse(g.cx, topCy, g.outerRx, g.outerRy, 0, 0, Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.save();
  frontWallPath(ctx, g);
  ctx.clip();
  const cylinder = ctx.createLinearGradient(g.cx - g.outerRx, 0, g.cx + g.outerRx, 0);
  cylinder.addColorStop(0, `rgba(255,255,255,${CYLINDER_LIGHT_ALPHA})`);
  cylinder.addColorStop(CYLINDER_NEUTRAL_STOP, 'rgba(0,0,0,0)');
  cylinder.addColorStop(1, `rgba(0,0,0,${CYLINDER_SHADE_ALPHA})`);
  ctx.fillStyle = cylinder;
  ctx.fillRect(g.cx - g.outerRx, wallTop, g.outerRx * 2, wallBottom - wallTop);
  ctx.restore();
}

function drawCopingRing(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  ellipseRingPath(ctx, g.cx, g.cy, g.outerRx, g.outerRy, g.innerRx, g.innerRy);
  const lit = ctx.createLinearGradient(
    g.cx - g.outerRx,
    g.cy - g.outerRy,
    g.cx + g.outerRx,
    g.cy + g.outerRy,
  );
  lit.addColorStop(0, STONE_HIGHLIGHT);
  lit.addColorStop(COPING_LIGHT_STOP, STONE_LIGHT);
  lit.addColorStop(1, STONE_COPING_SHADE);
  ctx.fillStyle = lit;
  ctx.fill('evenodd');

  ctx.strokeStyle = STONE_DEEP;
  ctx.globalAlpha = COPING_JOINT_ALPHA;
  ctx.lineWidth = MASONRY_JOINT_WIDTH_TILES * g.u;
  for (let i = 0; i < COPING_JOINT_COUNT; i++) {
    const angle = (i / COPING_JOINT_COUNT) * TAU;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(g.cx + g.innerRx * cos, g.cy + g.innerRy * sin);
    ctx.lineTo(g.cx + g.outerRx * cos, g.cy + g.outerRy * sin);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // One block missing off the south-east lip: the rough core it exposes sits
  // below the polished top, so it reads as shade with a hard broken edge.
  const chipStart = COPING_CHIP_ANGLE - COPING_CHIP_ARC;
  const chipEnd = COPING_CHIP_ANGLE + COPING_CHIP_ARC;
  const chipInnerRx = g.innerRx + (g.outerRx - g.innerRx) * COPING_CHIP_INTACT_RATIO;
  const chipInnerRy = g.innerRy + (g.outerRy - g.innerRy) * COPING_CHIP_INTACT_RATIO;
  ringArcPath(ctx, g.cx, g.cy, g.outerRx, g.outerRy, chipInnerRx, chipInnerRy, chipStart, chipEnd);
  ctx.fillStyle = STONE_SHADE;
  ctx.fill();
  ctx.strokeStyle = STONE_DEEP;
  ctx.globalAlpha = COPING_CHIP_EDGE_ALPHA;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, chipInnerRx, chipInnerRy, 0, chipStart, chipEnd);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = STONE_DEEP;
  ctx.globalAlpha = COPING_CRACK_ALPHA;
  ctx.beginPath();
  const crackCos = Math.cos(COPING_CRACK_ANGLE);
  const crackSin = Math.sin(COPING_CRACK_ANGLE);
  ctx.moveTo(g.cx + g.innerRx * crackCos, g.cy + g.innerRy * crackSin);
  ctx.lineTo(g.cx + g.outerRx * crackCos, g.cy + g.outerRy * crackSin);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawInnerBasinWall(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, g.innerRx, g.innerRy, 0, 0, TAU);
  const occlusion = ctx.createLinearGradient(0, g.cy - g.innerRy, 0, g.cy + g.innerRy);
  occlusion.addColorStop(0, STONE_DEEP);
  occlusion.addColorStop(1, STONE_SHADE);
  ctx.fillStyle = occlusion;
  ctx.fill();
}

function drawWaterBody(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  onWaterPlane(ctx, g, (radius) => {
    const depth = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    depth.addColorStop(0, WATER_BODY);
    depth.addColorStop(1, WATER_DEEP);
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();

    const crescentBottom = -radius + radius * 2 * SKY_CRESCENT_DEPTH;
    const sky = ctx.createLinearGradient(0, -radius, 0, crescentBottom);
    sky.addColorStop(0, WATER_SHALLOW);
    sky.addColorStop(1, withAlpha(WATER_SHALLOW, 0));
    ctx.globalAlpha = SKY_CRESCENT_ALPHA;
    ctx.fillStyle = sky;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2 * SKY_CRESCENT_DEPTH);
    ctx.globalAlpha = 1;
  });
}

function drawSubmergedItems(
  ctx: CanvasRenderingContext2D,
  g: FountainGeometry,
  phase: number,
): void {
  onWaterPlane(ctx, g, (radius) => {
    ctx.globalAlpha = SUBMERGED_ITEM_ALPHA;
    for (let i = 0; i < SUBMERGED_ITEM_COUNT; i++) {
      const angle = hash01(i * 7 + 1) * TAU;
      const distance = Math.sqrt(hash01(i * 13 + 5)) * radius * SUBMERGED_SPREAD_RATIO;
      const wobble =
        Math.sin(TAU * SUBMERGED_WOBBLE_CYCLES * phase + i) * SUBMERGED_WOBBLE_TILES * g.u;
      const itemRadius =
        (SUBMERGED_ITEM_MIN_RADIUS_TILES + hash01(i * 29 + 3) * SUBMERGED_ITEM_RADIUS_RANGE_TILES) *
        g.u;
      ctx.fillStyle = hash01(i * 41 + 9) > 0.5 ? STONE_HIGHLIGHT : STONE_WET;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * distance + wobble, Math.sin(angle) * distance, itemRadius, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

function drawRipples(ctx: CanvasRenderingContext2D, g: FountainGeometry, phase: number): void {
  onWaterPlane(ctx, g, (radius) => {
    ctx.strokeStyle = WATER_GLINT;
    ctx.lineWidth = RIPPLE_WIDTH_TILES * g.u;
    for (let i = 0; i < RIPPLE_RING_COUNT; i++) {
      const progress = (i / RIPPLE_RING_COUNT + RIPPLE_CYCLES * phase) % 1;
      const ringRadius =
        radius * (RIPPLE_START_RADIUS_RATIO + progress * (1 - RIPPLE_START_RADIUS_RATIO));
      ctx.globalAlpha = (1 - progress) * RIPPLE_ALPHA;
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Landing point of spout `index` on the water plane, in composition coordinates. */
function overflowLanding(g: FountainGeometry, index: number): { x: number; y: number } {
  const angle = OVERFLOW_FIRST_ANGLE + (index / OVERFLOW_SPOUT_COUNT) * TAU;
  const landingRx = OVERFLOW_LANDING_RX_TILES * g.u;
  return {
    x: g.cx + landingRx * Math.cos(angle),
    y: g.waterCy + landingRx * g.waterSquash * Math.sin(angle),
  };
}

function drawImpactRings(ctx: CanvasRenderingContext2D, g: FountainGeometry, phase: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(g.cx, g.waterCy, g.waterRx, g.waterRy, 0, 0, TAU);
  ctx.clip();
  const maxRadius = IMPACT_RING_MAX_RADIUS_TILES * g.u;
  for (let spout = 0; spout < OVERFLOW_SPOUT_COUNT; spout++) {
    const landing = overflowLanding(g, spout);

    ctx.globalAlpha = FOAM_PATCH_ALPHA;
    ctx.fillStyle = FOAM;
    ctx.beginPath();
    ctx.ellipse(
      landing.x,
      landing.y,
      FOAM_PATCH_RX_TILES * g.u,
      FOAM_PATCH_RX_TILES * g.u * g.waterSquash,
      0,
      0,
      TAU,
    );
    ctx.fill();

    ctx.strokeStyle = FOAM;
    ctx.lineWidth = RIPPLE_WIDTH_TILES * g.u;
    for (let ring = 0; ring < IMPACT_RING_COUNT; ring++) {
      const progress = (ring / IMPACT_RING_COUNT + IMPACT_RING_CYCLES * phase) % 1;
      const ringRx = maxRadius * progress;
      ctx.globalAlpha = (1 - progress) * IMPACT_RING_ALPHA;
      ctx.beginPath();
      ctx.ellipse(landing.x, landing.y, ringRx, ringRx * g.waterSquash, 0, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSurfaceGlints(
  ctx: CanvasRenderingContext2D,
  g: FountainGeometry,
  phase: number,
): void {
  onWaterPlane(ctx, g, (radius) => {
    ctx.fillStyle = WATER_GLINT;
    for (let i = 0; i < GLINT_COUNT; i++) {
      const progress = (i / GLINT_COUNT + GLINT_DRIFT_CYCLES * phase) % 1;
      const startX = (hash01(i * 17 + 2) * 2 - 1) * radius * GLINT_SPREAD_X_RATIO;
      const x = startX + (progress - 0.5) * GLINT_DRIFT_TILES * g.u;
      const y = (hash01(i * 23 + 6) * 2 - 1) * radius * GLINT_SPREAD_Y_RATIO;
      const fade = Math.sin(Math.PI * progress);
      ctx.globalAlpha = fade * fade * GLINT_ALPHA;
      ctx.beginPath();
      ctx.ellipse(x, y, GLINT_RX_TILES * g.u, GLINT_RY_TILES * g.u, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

function drawPlinth(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const plinthRx = PLINTH_RX_TILES * g.u;
  const plinthRy = PLINTH_RY_TILES * g.u;
  const plinthHeight = PLINTH_HEIGHT_TILES * g.u;
  const aoSpread = PLINTH_AO_SPREAD_TILES * g.u;

  ctx.globalAlpha = PLINTH_AO_ALPHA;
  ctx.fillStyle = WATER_DEEP;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, plinthRx + aoSpread, plinthRy + aoSpread * g.waterSquash, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  arcBandPath(ctx, g.cx, g.cy - plinthHeight, g.cy, plinthRx, plinthRy, 0, Math.PI);
  const side = ctx.createLinearGradient(0, g.cy - plinthHeight, 0, g.cy + plinthRy);
  side.addColorStop(0, STONE_WET);
  side.addColorStop(1, STONE_DEEP);
  ctx.fillStyle = side;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy - plinthHeight, plinthRx, plinthRy, 0, 0, TAU);
  const top = ctx.createLinearGradient(g.cx - plinthRx, 0, g.cx + plinthRx, 0);
  top.addColorStop(0, STONE_LIGHT);
  top.addColorStop(1, STONE_SHADE);
  ctx.fillStyle = top;
  ctx.fill();
}

function shaftPath(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const halfBottom = (SHAFT_BOTTOM_WIDTH_TILES * g.u) / 2;
  const halfTop = (SHAFT_TOP_WIDTH_TILES * g.u) / 2;
  ctx.beginPath();
  ctx.moveTo(g.cx - halfBottom, g.shaftBottomY);
  ctx.lineTo(g.cx - halfTop, g.shaftTopY);
  ctx.lineTo(g.cx + halfTop, g.shaftTopY);
  ctx.lineTo(g.cx + halfBottom, g.shaftBottomY);
  ctx.closePath();
}

function drawShaft(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const halfBottom = (SHAFT_BOTTOM_WIDTH_TILES * g.u) / 2;
  const shaftHeight = g.shaftBottomY - g.shaftTopY;

  shaftPath(ctx, g);
  const lit = ctx.createLinearGradient(g.cx - halfBottom, 0, g.cx + halfBottom, 0);
  lit.addColorStop(0, STONE_LIGHT);
  lit.addColorStop(SHAFT_LIGHT_STOP, STONE_MID);
  lit.addColorStop(1, STONE_SHADE);
  ctx.fillStyle = lit;
  ctx.fill();

  ctx.save();
  shaftPath(ctx, g);
  ctx.clip();

  const waterlineHeight = SHAFT_WATERLINE_HEIGHT_TILES * g.u;
  const wet = ctx.createLinearGradient(0, g.shaftBottomY - waterlineHeight, 0, g.shaftBottomY);
  wet.addColorStop(0, withAlpha(STONE_DEEP, 0));
  wet.addColorStop(1, STONE_DEEP);
  ctx.fillStyle = wet;
  ctx.fillRect(
    g.cx - halfBottom,
    g.shaftBottomY - waterlineHeight,
    halfBottom * 2,
    waterlineHeight,
  );

  ctx.fillStyle = MOSS_DARK;
  ctx.globalAlpha = SHAFT_MOSS_ALPHA;
  for (let i = 0; i < SHAFT_MOSS_STREAK_COUNT; i++) {
    const climb = hash01(i * 19 + 4) * shaftHeight * SHAFT_MOSS_CLIMB_RATIO;
    const streakY = g.shaftBottomY - waterlineHeight - climb;
    const widthRatio =
      SHAFT_MOSS_MIN_WIDTH_RATIO + hash01(i * 37 + 8) * SHAFT_MOSS_WIDTH_RANGE_RATIO;
    ctx.beginPath();
    ctx.ellipse(
      g.cx - halfBottom * SHAFT_MOSS_OFFSET_RATIO,
      streakY,
      halfBottom * widthRatio,
      waterlineHeight * SHAFT_MOSS_HEIGHT_RATIO,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const ringThickness = SHAFT_RING_THICKNESS_TILES * g.u;
  const ringOverhang = SHAFT_RING_OVERHANG_TILES * g.u;
  const halfTop = (SHAFT_TOP_WIDTH_TILES * g.u) / 2;
  for (const heightRatio of SHAFT_RING_HEIGHTS) {
    const ringY = g.shaftBottomY - shaftHeight * heightRatio;
    const halfWidthAtRing = halfBottom - (halfBottom - halfTop) * heightRatio;
    const ringRx = halfWidthAtRing + ringOverhang;
    const ringRy = ringRx * SHAFT_RING_SQUASH;
    const collarTop = ringY - ringThickness / 2;
    const collarBottom = ringY + ringThickness / 2;

    arcBandPath(ctx, g.cx, collarTop, collarBottom, ringRx, ringRy, 0, Math.PI);
    const face = ctx.createLinearGradient(g.cx - ringRx, 0, g.cx + ringRx, 0);
    face.addColorStop(0, STONE_MID);
    face.addColorStop(1, STONE_DEEP);
    ctx.fillStyle = face;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(g.cx, collarTop, ringRx, ringRy, 0, 0, TAU);
    const cap = ctx.createLinearGradient(g.cx - ringRx, 0, g.cx + ringRx, 0);
    cap.addColorStop(0, STONE_HIGHLIGHT);
    cap.addColorStop(1, STONE_SHADE);
    ctx.fillStyle = cap;
    ctx.fill();
  }
}

function drawUpperBowl(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  const bowlRx = BOWL_RX_TILES * g.u;
  const bowlRy = BOWL_RY_TILES * g.u;
  const undersideDepth = BOWL_UNDERSIDE_DEPTH_TILES * g.u;
  const lipWidth = BOWL_LIP_WIDTH_TILES * g.u;

  ctx.beginPath();
  ctx.moveTo(g.cx - bowlRx, g.bowlCy);
  ctx.quadraticCurveTo(
    g.cx,
    g.bowlCy + undersideDepth * BOWL_UNDERSIDE_CONTROL_SCALE,
    g.cx + bowlRx,
    g.bowlCy,
  );
  ctx.closePath();
  const underside = ctx.createLinearGradient(0, g.bowlCy, 0, g.bowlCy + undersideDepth);
  underside.addColorStop(0, STONE_SHADE);
  underside.addColorStop(1, STONE_DEEP);
  ctx.fillStyle = underside;
  ctx.fill();

  ellipseRingPath(ctx, g.cx, g.bowlCy, bowlRx, bowlRy, bowlRx - lipWidth, bowlRy - lipWidth);
  const lip = ctx.createLinearGradient(
    g.cx - bowlRx,
    g.bowlCy - bowlRy,
    g.cx + bowlRx,
    g.bowlCy + bowlRy,
  );
  lip.addColorStop(0, STONE_HIGHLIGHT);
  lip.addColorStop(BOWL_LIP_LIGHT_STOP, STONE_LIGHT);
  lip.addColorStop(1, STONE_COPING_SHADE);
  ctx.fillStyle = lip;
  ctx.fill('evenodd');

  ctx.beginPath();
  ctx.ellipse(g.cx, g.bowlCy, bowlRx - lipWidth, bowlRy - lipWidth, 0, 0, TAU);
  ctx.fillStyle = STONE_DEEP;
  ctx.fill();

  const waterInset = BOWL_WATER_INSET_TILES * g.u;
  ctx.beginPath();
  ctx.ellipse(
    g.cx,
    g.bowlCy + waterInset,
    bowlRx - lipWidth - waterInset,
    bowlRy - lipWidth - waterInset,
    0,
    0,
    TAU,
  );
  const bowlWater = ctx.createLinearGradient(0, g.bowlCy - bowlRy, 0, g.bowlCy + bowlRy);
  bowlWater.addColorStop(0, WATER_BODY);
  bowlWater.addColorStop(1, WATER_DEEP);
  ctx.fillStyle = bowlWater;
  ctx.fill();

  // Foam collar where the jet falls back into the bowl.
  const collarRx = BOWL_JET_FOAM_RX_TILES * g.u;
  ctx.globalAlpha = BOWL_JET_FOAM_ALPHA;
  ctx.strokeStyle = FOAM;
  ctx.lineWidth = RIPPLE_WIDTH_TILES * g.u;
  ctx.beginPath();
  ctx.ellipse(g.cx, g.bowlCy + waterInset, collarRx, collarRx * (bowlRy / bowlRx), 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draws the spouts on one side of the column. The far (north) sheets are drawn
 * before the shaft so it occludes them, the near (south) sheets after it.
 */
function drawOverflowSheets(
  ctx: CanvasRenderingContext2D,
  g: FountainGeometry,
  phase: number,
  side: 'far' | 'near',
): void {
  const bowlRx = BOWL_RX_TILES * g.u;
  const bowlRy = BOWL_RY_TILES * g.u;

  for (let spout = 0; spout < OVERFLOW_SPOUT_COUNT; spout++) {
    const angle = OVERFLOW_FIRST_ANGLE + (spout / OVERFLOW_SPOUT_COUNT) * TAU;
    const isNear = Math.sin(angle) >= 0;
    if (isNear !== (side === 'near')) continue;

    const pulse = 1 + Math.sin(TAU * OVERFLOW_PULSE_CYCLES * phase + spout) * OVERFLOW_WIDTH_PULSE;
    const lipX = g.cx + bowlRx * Math.cos(angle);
    const lipY = g.bowlCy + bowlRy * Math.sin(angle);
    const landing = overflowLanding(g, spout);
    const halfTop = (OVERFLOW_TOP_WIDTH_TILES * g.u * pulse) / 2;
    const halfBottom = (OVERFLOW_BOTTOM_WIDTH_TILES * g.u * pulse) / 2;
    // Water leaves the lip travelling outward and only then falls, so the
    // control point sits most of the way out but barely below the lip.
    const bendX = lipX + (landing.x - lipX) * OVERFLOW_BEND_X_RATIO;
    const bendY = lipY + (landing.y - lipY) * OVERFLOW_BEND_Y_RATIO;

    ctx.beginPath();
    ctx.moveTo(lipX - halfTop, lipY);
    ctx.quadraticCurveTo(bendX - halfBottom, bendY, landing.x - halfBottom, landing.y);
    ctx.lineTo(landing.x + halfBottom, landing.y);
    ctx.quadraticCurveTo(bendX + halfTop, bendY, lipX + halfTop, lipY);
    ctx.closePath();
    const sheet = ctx.createLinearGradient(0, lipY, 0, landing.y);
    sheet.addColorStop(0, withAlpha(FOAM, OVERFLOW_TOP_ALPHA));
    sheet.addColorStop(1, withAlpha(WATER_SHALLOW, OVERFLOW_BOTTOM_ALPHA));
    ctx.fillStyle = sheet;
    ctx.fill();

    ctx.strokeStyle = FOAM;
    ctx.globalAlpha = OVERFLOW_STREAK_ALPHA;
    ctx.lineWidth = RIPPLE_WIDTH_TILES * g.u;
    ctx.beginPath();
    ctx.moveTo(lipX, lipY);
    ctx.quadraticCurveTo(bendX, bendY, landing.x, landing.y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.globalAlpha = OVERFLOW_LIP_FOAM_ALPHA;
    ctx.fillStyle = FOAM;
    ctx.beginPath();
    ctx.ellipse(lipX, lipY, halfTop, halfTop * OVERFLOW_LIP_FOAM_SQUASH, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawJet(ctx: CanvasRenderingContext2D, g: FountainGeometry, phase: number): void {
  const pulse = 1 + Math.sin(TAU * JET_PULSE_CYCLES * phase) * JET_PULSE;
  const jetHeight = JET_HEIGHT_TILES * g.u * pulse;
  const halfBase = (JET_WIDTH_TILES * g.u) / 2;
  const halfTip = halfBase * JET_TIP_WIDTH_RATIO;
  const tipY = g.bowlCy - jetHeight;
  const glowSpread = JET_GLOW_SPREAD_TILES * g.u;

  ctx.globalAlpha = JET_GLOW_ALPHA;
  ctx.fillStyle = WATER_SHALLOW;
  ctx.beginPath();
  ctx.moveTo(g.cx - halfBase - glowSpread, g.bowlCy);
  ctx.lineTo(g.cx - halfTip - glowSpread * JET_GLOW_TIP_RATIO, tipY);
  ctx.lineTo(g.cx + halfTip + glowSpread * JET_GLOW_TIP_RATIO, tipY);
  ctx.lineTo(g.cx + halfBase + glowSpread, g.bowlCy);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  const core = ctx.createLinearGradient(0, tipY, 0, g.bowlCy);
  core.addColorStop(0, withAlpha(FOAM, JET_TIP_ALPHA));
  core.addColorStop(JET_CORE_FADE_STOP, withAlpha(WATER_GLINT, JET_CORE_ALPHA));
  core.addColorStop(1, withAlpha(WATER_SHALLOW, JET_BASE_ALPHA));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(g.cx - halfBase, g.bowlCy);
  ctx.lineTo(g.cx - halfTip, tipY);
  ctx.lineTo(g.cx + halfTip, tipY);
  ctx.lineTo(g.cx + halfBase, g.bowlCy);
  ctx.closePath();
  ctx.fill();

  // The stream breaks up where it loses momentum, so the tip is a spray puff
  // rather than a squared-off end.
  const sprayRadius = JET_SPRAY_RADIUS_TILES * g.u;
  ctx.fillStyle = FOAM;
  ctx.globalAlpha = JET_SPRAY_ALPHA;
  ctx.beginPath();
  ctx.ellipse(
    g.cx,
    tipY + sprayRadius * JET_SPRAY_DROP_RATIO,
    sprayRadius,
    sprayRadius * JET_SPRAY_STRETCH,
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  for (let i = 0; i < JET_DROPLET_COUNT; i++) {
    const progress = (i / JET_DROPLET_COUNT + JET_DROPLET_CYCLES * phase) % 1;
    const sideSign = i % 2 === 0 ? 1 : -1;
    const dropletX = g.cx + sideSign * progress * JET_DROPLET_SPREAD_TILES * g.u;
    const dropletY = tipY - Math.sin(Math.PI * progress) * JET_DROPLET_RISE_TILES * g.u;
    ctx.globalAlpha = Math.sin(Math.PI * progress);
    ctx.beginPath();
    ctx.arc(dropletX, dropletY, JET_DROPLET_RADIUS_TILES * g.u, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBaseWear(ctx: CanvasRenderingContext2D, g: FountainGeometry): void {
  ctx.save();
  frontWallPath(ctx, g);
  ctx.clip();
  ctx.globalAlpha = WATER_STAIN_ALPHA;
  ctx.fillStyle = STONE_WET;
  const stainWidth = WATER_STAIN_WIDTH_TILES * g.u;
  for (const angle of WATER_STAIN_ANGLES) {
    const stainX = g.cx + g.outerRx * Math.cos(angle);
    const stainTop = g.cy + g.outerRy * Math.sin(angle);
    ctx.fillRect(stainX - stainWidth / 2, stainTop, stainWidth, g.frontWallH);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const tuftRx = MOSS_TUFT_RX_TILES * g.u;
  const tuftRy = MOSS_TUFT_RY_TILES * g.u;
  for (let tuft = 0; tuft < MOSS_TUFT_ANGLES.length; tuft++) {
    const angle = MOSS_TUFT_ANGLES[tuft];
    const footX = g.cx + g.outerRx * Math.cos(angle);
    const footY = g.cy + g.frontWallH + g.outerRy * Math.sin(angle);
    ctx.fillStyle = MOSS_DARK;
    ctx.beginPath();
    ctx.ellipse(footX, footY, tuftRx, tuftRy, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = MOSS_LIGHT;
    for (let blade = 0; blade < MOSS_TUFT_BLADES; blade++) {
      const bladeSeed = tuft * 53 + blade;
      const bladeX = footX + (hash01(bladeSeed) * 2 - 1) * tuftRx;
      const heightRatio =
        MOSS_BLADE_MIN_HEIGHT_RATIO + hash01(bladeSeed + 101) * MOSS_BLADE_HEIGHT_RANGE_RATIO;
      const bladeHeight = tuftRy * heightRatio;
      ctx.beginPath();
      ctx.ellipse(
        bladeX,
        footY - bladeHeight / 2,
        tuftRx * MOSS_BLADE_WIDTH_RATIO,
        bladeHeight,
        0,
        0,
        TAU,
      );
      ctx.fill();
    }
  }
}

/**
 * Draws the whole fountain into `ctx` with its top-left corner at
 * (`originX`, `originY`) and `u` pixels per tile unit. `phase` is the animation
 * position in [0, 1).
 *
 * DOM-free by design so offline preview scripts can call it directly.
 */
export function drawFountainComposition(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  u: number,
  phase: number,
): void {
  const g = computeGeometry(originX, originY, u);

  // The layers below leave fill/stroke styles behind them by design; this is a
  // public entry point, so none of that reaches the caller's context.
  ctx.save();
  drawContactShadow(ctx, g);
  drawBasinFrontWall(ctx, g);
  drawCopingRing(ctx, g);
  drawInnerBasinWall(ctx, g);
  drawWaterBody(ctx, g);
  drawSubmergedItems(ctx, g, phase);
  drawRipples(ctx, g, phase);
  // Impact rings and glints belong to the water plane, so they go under the
  // column rather than over it, despite being effects of the spouts above.
  drawImpactRings(ctx, g, phase);
  drawSurfaceGlints(ctx, g, phase);
  drawPlinth(ctx, g);
  drawOverflowSheets(ctx, g, phase, 'far');
  drawShaft(ctx, g);
  drawUpperBowl(ctx, g);
  drawOverflowSheets(ctx, g, phase, 'near');
  drawJet(ctx, g, phase);
  drawBaseWear(ctx, g);
  ctx.restore();
}

/** Pixel size of one pre-rendered composition frame at the given tile size. */
export function fountainCompositionSize(ts: number): {
  width: number;
  height: number;
  headroom: number;
} {
  const headroom = Math.round(HEADROOM_TILES * ts);
  return { width: BLOCK_TILES * ts, height: headroom + BLOCK_TILES * ts, headroom };
}

const compositionFrames = new Map<string, CanvasSurface>();

function buildCompositionFrame(ts: number, frame: number): CanvasSurface {
  const { width, height, headroom } = fountainCompositionSize(ts);

  const scratch = allocCanvas(width * AUTHORING_SCALE, height * AUTHORING_SCALE);
  const scratchCtx = surfaceContext(scratch);
  const authoredUnit = ts * AUTHORING_SCALE;
  // Rounding the headroom to whole pixels can shift it off the exact tile-unit
  // grid; offsetting the origin keeps the block's top edge on the rounded row.
  const originY = headroom * AUTHORING_SCALE - HEADROOM_TILES * authoredUnit;
  drawFountainComposition(scratchCtx, 0, originY, authoredUnit, frame / FOUNTAIN_LOOP_FRAMES);

  const target = allocCanvas(width, height);
  const targetCtx = surfaceContext(target);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.drawImage(scratch, 0, 0, width, height);
  return target;
}

function compositionFrame(ts: number, frame: number): CanvasSurface {
  const key = `${ts}_${frame}`;
  const cached = compositionFrames.get(key);
  if (cached !== undefined) return cached;
  const built = buildCompositionFrame(ts, frame);
  compositionFrames.set(key, built);
  return built;
}

function clampBlockIndex(index: number): number {
  return Math.max(0, Math.min(BLOCK_TILES - 1, Math.floor(index)));
}

/**
 * Blits this fountain tile's slice of the shared, pre-rendered composition.
 *
 * `blockX` / `blockY` are the tile's 0..2 offset within the 3×3 block; top-row
 * tiles also carry the headroom band holding the jet.
 */
export function drawFountainTileSlice(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  blockX: number,
  blockY: number,
  time: number,
): void {
  const loopPosition = (((time / FOUNTAIN_LOOP_SECONDS) % 1) + 1) % 1;
  const frame = Math.min(FOUNTAIN_LOOP_FRAMES - 1, Math.floor(loopPosition * FOUNTAIN_LOOP_FRAMES));
  const composition = compositionFrame(ts, frame);
  const { headroom } = fountainCompositionSize(ts);

  const col = clampBlockIndex(blockX);
  const row = clampBlockIndex(blockY);
  const isTopRow = row === 0;
  const srcX = col * ts;
  const srcY = isTopRow ? 0 : headroom + row * ts;
  const srcH = isTopRow ? headroom + ts : ts;
  const dstY = isTopRow ? sy - headroom : sy;

  ctx.drawImage(composition, srcX, srcY, ts, srcH, sx, dstY, ts, srcH);
}
