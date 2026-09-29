/**
 * Over City's material painters: plaster, timber framing, dressed and
 * coursed stone, slate and clay roofing, ironwork, awning cloth, glazing and
 * plank boarding.
 *
 * Every painter here stays low-alpha and coarse enough to resolve at 32
 * px/tile display (memory: "detail below its resolving size is noise") —
 * this is what "calmer" means: lower contrast and lower frequency than the
 * baseline it replaces, never a flat fill. A material that measures as flat
 * fails the texture-frequency gate exactly as hard as one that measures
 * busier than the ground under it (`scripts/gates-town-art.ts`).
 *
 * These are small canvas painters in the same register as `villageArt.ts`'s
 * `drawFieldstones`/`drawPlanks`/`drawWattle` — jittered elements over a
 * seeded `Rng`, not the noise-field pixel-buffer machinery
 * `buildinggen/materials/` uses for the shipped facades. That keeps this
 * module dependency-free of `buildinggen` (which will come to depend on it,
 * in the other direction, when the facade repaint adopts it) and cheap
 * enough to run live for interior furniture, which has no staged-paint
 * budget to spend.
 */

import type { Ramp, RGB } from './townPalette';
import { sampleRamp } from './townPalette';
import { rgb, rgba, type Ctx, type Rng } from './townArt';
import { range } from '../../person/rng';

// ── Plaster ───────────────────────────────────────────────────────────────────

const PLASTER_WASH_BLOTCHES = 9;
const PLASTER_WASH_RADIUS_MIN_FRACTION = 0.35;
const PLASTER_WASH_RADIUS_MAX_FRACTION = 0.7;
const PLASTER_WASH_ASPECT = 0.6;
const PLASTER_WASH_ALPHA = 0.1;
const PLASTER_WASH_DARK_SHARE = 0.5;

/**
 * A gentle tonal wash over a plaster wall: soft light and dark patches from
 * layered radial fades. Plaster has no elements of its own — no courses, no
 * joints — so this wash is the only thing standing between a flat fill and a
 * surface that reads as lime plaster rather than paint.
 */
export function paintPlasterWash(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < PLASTER_WASH_BLOTCHES; i++) {
    const cx = x + range(rng, 0, w);
    const cy = y + range(rng, 0, h);
    const r = h * range(rng, PLASTER_WASH_RADIUS_MIN_FRACTION, PLASTER_WASH_RADIUS_MAX_FRACTION);
    const tone = rng() < PLASTER_WASH_DARK_SHARE ? ramp.shadow : ramp.light;
    paintSoftRadialBlotch(ctx, cx, cy, r, r * PLASTER_WASH_ASPECT, tone, PLASTER_WASH_ALPHA);
  }
  ctx.restore();
}

/** A soft-edged elliptical wash, faded fully to transparent — the plaster wash's own primitive, kept local so this module has no dependency on the figure-painting `softShade` machinery. */
function paintSoftRadialBlotch(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGB,
  alpha: number,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
  ctx.translate(-cx, -cy);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Timber framing ───────────────────────────────────────────────────────────

const TIMBER_GRAIN_COUNT = 2;
const TIMBER_GRAIN_ALPHA = 0.22;
const TIMBER_GRAIN_INSET_FRACTION = 0.28;
const TIMBER_GRAIN_END_MARGIN_FRACTION = 0.05;
const TIMBER_GRAIN_LINE_WIDTH_FRACTION = 0.05;

/** One quiet grain streak along a beam or board's length, inset from its edges — reused for door panels and plank boarding, not just framing. */
export function paintGrainStreak(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  dark: RGB,
  rng: Rng,
): void {
  const vertical = h > w;
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  const nearEnd = along * TIMBER_GRAIN_END_MARGIN_FRACTION;
  const farEnd = along * (1 - TIMBER_GRAIN_END_MARGIN_FRACTION);
  for (let i = 0; i < TIMBER_GRAIN_COUNT; i++) {
    const offset =
      across * range(rng, TIMBER_GRAIN_INSET_FRACTION, 1 - TIMBER_GRAIN_INSET_FRACTION);
    ctx.strokeStyle = rgba(dark, TIMBER_GRAIN_ALPHA);
    ctx.lineWidth = Math.max(1, across * TIMBER_GRAIN_LINE_WIDTH_FRACTION);
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x + offset, y + nearEnd);
      ctx.lineTo(x + offset, y + farEnd);
    } else {
      ctx.moveTo(x + nearEnd, y + offset);
      ctx.lineTo(x + farEnd, y + offset);
    }
    ctx.stroke();
  }
}

const TIMBER_EDGE_WIDTH_FRACTION = 0.12;
const TIMBER_EDGE_LIGHT_ALPHA = 0.3;
const TIMBER_EDGE_SHADOW_ALPHA = 0.35;
const TIMBER_FACE_RAMP_T = 0.45;
const TIMBER_EDGE_LIGHT_RAMP_T = 0.8;
const TIMBER_EDGE_SHADOW_RAMP_T = 0.1;

/** One timber member (a beam or post): a flat fill, a lit edge, a shadowed edge and quiet grain — never a bare rectangle. */
export function paintBeam(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const edgeW = Math.max(1, w * TIMBER_EDGE_WIDTH_FRACTION);
  ctx.fillStyle = rgb(sampleRamp(ramp, TIMBER_FACE_RAMP_T));
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(sampleRamp(ramp, TIMBER_EDGE_LIGHT_RAMP_T), TIMBER_EDGE_LIGHT_ALPHA);
  ctx.fillRect(x, y, edgeW, h);
  ctx.fillStyle = rgba(sampleRamp(ramp, TIMBER_EDGE_SHADOW_RAMP_T), TIMBER_EDGE_SHADOW_ALPHA);
  ctx.fillRect(x + w - edgeW, y, edgeW, h);
  paintGrainStreak(ctx, x, y, w, h, sampleRamp(ramp, 0), rng);
}

const TIMBER_POST_WIDTH_FRACTION = 0.11;
const TIMBER_HEAD_HEIGHT_FRACTION = 0.1;
const TIMBER_BRACE_WIDTH_FRACTION = 0.09;
const TIMBER_BRACE_RUN_FRACTION = 0.35;
const TIMBER_BRACE_RISE_FRACTION = 0.4;
const TIMBER_BRACE_ANCHOR_FRACTION = 0.5;

/**
 * Visible but quiet timber framing: two corner posts, a head beam and one
 * diagonal brace — real framing members over a plaster infill, not a flat
 * trim band.
 */
export function paintTimberFraming(
  ctx: Ctx,
  x: number,
  wallTop: number,
  width: number,
  wallHeight: number,
  ramp: Ramp,
  rng: Rng,
): void {
  const postW = width * TIMBER_POST_WIDTH_FRACTION;
  paintBeam(ctx, x, wallTop, postW, wallHeight, ramp, rng);
  paintBeam(ctx, x + width - postW, wallTop, postW, wallHeight, ramp, rng);
  const headH = wallHeight * TIMBER_HEAD_HEIGHT_FRACTION;
  paintBeam(ctx, x, wallTop, width, headH, ramp, rng);

  const braceW = width * TIMBER_BRACE_WIDTH_FRACTION;
  ctx.save();
  ctx.translate(x + postW * TIMBER_BRACE_ANCHOR_FRACTION, wallTop + headH);
  const braceLen = Math.hypot(
    width * TIMBER_BRACE_RUN_FRACTION,
    wallHeight * TIMBER_BRACE_RISE_FRACTION,
  );
  const braceAngle = Math.atan2(
    wallHeight * TIMBER_BRACE_RISE_FRACTION,
    width * TIMBER_BRACE_RUN_FRACTION,
  );
  ctx.rotate(braceAngle);
  paintBeam(ctx, 0, -braceW / 2, braceLen, braceW, ramp, rng);
  ctx.restore();
}

// ── Plank boarding (for interior furniture — table tops, counters, shelving) ──

export type PlankDirection = 'horizontal' | 'vertical';

export interface PlankOptions {
  readonly direction: PlankDirection;
  /** Width of one board across its grain, in pixels. */
  readonly boardPx: number;
  readonly ramp: Ramp;
}

const PLANK_TONE_JITTER = 0.08;
const PLANK_SEAM_WIDTH_FRACTION = 0.09;
const PLANK_SEAM_RAMP_T = 0;
const PLANK_HIGHLIGHT_ALPHA = 0.2;
const PLANK_HIGHLIGHT_RAMP_T = 0.85;
const PLANK_BASE_RAMP_T = 0.45;

/**
 * A panel of boards: tone jitters board to board, a dark seam and lit edge
 * between each, and a grain streak along the board. The plank/board
 * material an interior prop framework needs for table tops, counters and
 * shelving — the same construction as `villageArt.ts`'s `drawPlanks`,
 * ported onto this module's `Ramp`-based colour so an interior counter
 * matches the town's own ash-oak timber rather than the village's walnut.
 */
export function paintPlankBoard(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
  options: PlankOptions,
): void {
  const horizontal = options.direction === 'horizontal';
  const across = horizontal ? h : w;
  const along = horizontal ? w : h;
  const boards = Math.max(1, Math.round(across / options.boardPx));
  const board = across / boards;
  const seamWidth = Math.max(1, board * PLANK_SEAM_WIDTH_FRACTION);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(options.ramp, PLANK_BASE_RAMP_T));
  ctx.fillRect(x, y, w, h);
  for (let index = 0; index < boards; index++) {
    const start = index * board;
    const tone = PLANK_BASE_RAMP_T + range(rng, -PLANK_TONE_JITTER, PLANK_TONE_JITTER);
    const [bx, by, bw, bh] = horizontal
      ? [x, y + start, along, board]
      : [x + start, y, board, along];
    ctx.fillStyle = rgb(sampleRamp(options.ramp, Math.min(1, Math.max(0, tone))));
    ctx.fillRect(bx, by, bw, bh);
    paintGrainStreak(ctx, bx, by, bw, bh, sampleRamp(options.ramp, 0), rng);
    ctx.fillStyle = rgba(sampleRamp(options.ramp, PLANK_HIGHLIGHT_RAMP_T), PLANK_HIGHLIGHT_ALPHA);
    if (horizontal) ctx.fillRect(bx, by, bw, seamWidth);
    else ctx.fillRect(bx, by, seamWidth, bh);
    ctx.fillStyle = rgb(sampleRamp(options.ramp, PLANK_SEAM_RAMP_T));
    if (horizontal) ctx.fillRect(bx, by + board - seamWidth, bw, seamWidth);
    else ctx.fillRect(bx + board - seamWidth, by, seamWidth, bh);
  }
  ctx.restore();
}

// ── Dressed and coursed stone ───────────────────────────────────────────────

const STONE_COURSE_HEIGHT_FRACTION = 0.55;
const STONE_BLOCK_WIDTH_MIN_FRACTION = 0.7;
const STONE_BLOCK_WIDTH_MAX_FRACTION = 1.3;
const STONE_JOINT_FRACTION = 0.08;
const STONE_HIGHLIGHT_ALPHA = 0.28;
const STONE_PIT_CHANCE = 0.2;
const STONE_PIT_ALPHA = 0.35;
const STONE_STAGGER_FRACTION = 0.5;
const STONE_FACE_T_MIN = 0.3;
const STONE_FACE_T_MAX = 0.75;
const STONE_FACE_GRADIENT_SPREAD = 0.15;
const STONE_HIGHLIGHT_RAMP_T = 0.9;
const STONE_HIGHLIGHT_INSET_X_FRACTION = 0.08;
const STONE_HIGHLIGHT_INSET_Y_FRACTION = 0.1;
const STONE_HIGHLIGHT_WIDTH_FRACTION = 0.4;
const STONE_HIGHLIGHT_HEIGHT_FRACTION = 0.22;
const STONE_PIT_POSITION_MIN_FRACTION = 0.3;
const STONE_PIT_POSITION_MAX_FRACTION = 0.7;
const STONE_PIT_RADIUS_FRACTION = 0.05;

/**
 * A coursed dressed-stone wall or plinth: jittered rectangular blocks with
 * mortar joints, a per-block gradient shade and highlight, and the odd
 * weathering pit. Quarried and coursed, not the village's rounded
 * fieldstone — every block here is squared, matching Over City's masonry.
 */
export function paintStoneCourses(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(sampleRamp(ramp, 0));
  ctx.fillRect(x, y, w, h);
  const courseH = h * STONE_COURSE_HEIGHT_FRACTION;
  const courses = Math.max(1, Math.round(h / courseH));
  const rowH = h / courses;
  for (let row = 0; row < courses; row++) {
    const top = y + row * rowH;
    let cursor = x - (row % 2 === 0 ? 0 : rowH * STONE_STAGGER_FRACTION);
    while (cursor < x + w) {
      const blockW =
        rowH * range(rng, STONE_BLOCK_WIDTH_MIN_FRACTION, STONE_BLOCK_WIDTH_MAX_FRACTION);
      const joint = rowH * STONE_JOINT_FRACTION;
      const blockX = cursor + joint / 2;
      const blockY = top + joint / 2;
      const blockW2 = blockW - joint;
      const blockH2 = rowH - joint;
      const faceT = range(rng, STONE_FACE_T_MIN, STONE_FACE_T_MAX);
      const gradient = ctx.createLinearGradient(blockX, blockY, blockX + blockW2, blockY + blockH2);
      gradient.addColorStop(
        0,
        rgb(sampleRamp(ramp, Math.min(1, faceT + STONE_FACE_GRADIENT_SPREAD))),
      );
      gradient.addColorStop(
        1,
        rgb(sampleRamp(ramp, Math.max(0, faceT - STONE_FACE_GRADIENT_SPREAD))),
      );
      ctx.fillStyle = gradient;
      ctx.fillRect(blockX, blockY, blockW2, blockH2);
      ctx.fillStyle = rgba(sampleRamp(ramp, STONE_HIGHLIGHT_RAMP_T), STONE_HIGHLIGHT_ALPHA);
      ctx.fillRect(
        blockX + blockW2 * STONE_HIGHLIGHT_INSET_X_FRACTION,
        blockY + blockH2 * STONE_HIGHLIGHT_INSET_Y_FRACTION,
        blockW2 * STONE_HIGHLIGHT_WIDTH_FRACTION,
        blockH2 * STONE_HIGHLIGHT_HEIGHT_FRACTION,
      );
      if (rng() < STONE_PIT_CHANCE) {
        ctx.fillStyle = rgba(sampleRamp(ramp, 0), STONE_PIT_ALPHA);
        ctx.beginPath();
        ctx.arc(
          blockX +
            blockW2 * range(rng, STONE_PIT_POSITION_MIN_FRACTION, STONE_PIT_POSITION_MAX_FRACTION),
          blockY +
            blockH2 * range(rng, STONE_PIT_POSITION_MIN_FRACTION, STONE_PIT_POSITION_MAX_FRACTION),
          rowH * STONE_PIT_RADIUS_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      cursor += blockW;
    }
  }
  ctx.restore();
}

// ── Roof coursing (clay tile or slate) ─────────────────────────────────────────

export type RoofMaterial = 'clay' | 'slate';

const ROOF_TILE_COURSE_HEIGHT_FRACTION = 0.12;
const ROOF_TILE_WIDTH_FRACTION = 0.34;
const ROOF_TILE_STAGGER_FRACTION = 0.5;
const ROOF_LAP_SHADOW_ALPHA = 0.42;
const ROOF_LAP_SHADOW_HEIGHT_FRACTION = 0.12;
const ROOF_TILE_TONE_JITTER = 0.32;
const ROOF_RIDGE_TONE_LIFT = 0.1;
const ROOF_COURSE_OVERSHOOT_FRACTION = 0.02;
const ROOF_TILE_BASE_RAMP_T = 0.55;
const ROOF_CLAY_ARC_WIDTH_FRACTION = 0.48;
const ROOF_CLAY_ARC_HEIGHT_FRACTION = 0.5;
const ROOF_SLATE_JOINT_FRACTION = 0.03;

/**
 * Coursed roof tiles (clay) or slates, painted bottom-up from the eave with
 * a lap shadow under each course and per-tile tone jitter — never a flat
 * fill. `clip` is the roof plane's own path (a gable or hip triangle,
 * already on the context or passed as a point list); this function clips to
 * it, so a rounded tile cap or a narrow slate joint never exposes what is
 * behind the roof at its own edge — the base course fill under every course
 * reaches past the clip boundary by `ROOF_COURSE_OVERSHOOT_FRACTION` for
 * exactly that reason.
 */
export function paintRoofCourses(
  ctx: Ctx,
  clipPath: ReadonlyArray<readonly [number, number]>,
  eaveY: number,
  ridgeY: number,
  spanLeft: number,
  spanRight: number,
  ramp: Ramp,
  material: RoofMaterial,
  rng: Rng,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clipPath[0][0], clipPath[0][1]);
  for (const point of clipPath.slice(1)) ctx.lineTo(point[0], point[1]);
  ctx.closePath();
  ctx.clip();

  const depth = eaveY - ridgeY;
  const courseH = depth * ROOF_TILE_COURSE_HEIGHT_FRACTION;
  const courses = Math.max(1, Math.round(depth / courseH));
  const rowH = depth / courses;
  const spanW = spanRight - spanLeft;
  const tileW = spanW * ROOF_TILE_WIDTH_FRACTION;
  const overshoot = Math.max(1, rowH * ROOF_COURSE_OVERSHOOT_FRACTION);

  for (let row = 0; row < courses; row++) {
    const courseT = row / courses;
    const bottom = eaveY - row * rowH + overshoot;
    const top = bottom - rowH - overshoot;
    const toneLift = courseT * ROOF_RIDGE_TONE_LIFT;
    const baseT = Math.min(1, Math.max(0, ROOF_TILE_BASE_RAMP_T + toneLift));
    ctx.fillStyle = rgb(sampleRamp(ramp, baseT));
    ctx.fillRect(spanLeft - tileW, top, spanW + tileW * 2, bottom - top);

    let cursor = spanLeft - (row % 2 === 0 ? 0 : tileW * ROOF_TILE_STAGGER_FRACTION);
    while (cursor < spanRight) {
      const toneJitter = range(rng, -ROOF_TILE_TONE_JITTER, ROOF_TILE_TONE_JITTER);
      const t = Math.min(1, Math.max(0, baseT + toneJitter));
      ctx.fillStyle = rgb(sampleRamp(ramp, t));
      if (material === 'clay') {
        const radius = Math.max(
          tileW * ROOF_CLAY_ARC_WIDTH_FRACTION,
          rowH * ROOF_CLAY_ARC_HEIGHT_FRACTION,
        );
        ctx.beginPath();
        ctx.arc(cursor + tileW / 2, top + rowH / 2, radius, Math.PI, 0);
        ctx.lineTo(cursor + tileW, bottom);
        ctx.lineTo(cursor, bottom);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(
          cursor + tileW * ROOF_SLATE_JOINT_FRACTION,
          top,
          tileW * (1 - ROOF_SLATE_JOINT_FRACTION * 2),
          rowH,
        );
      }
      cursor += tileW;
    }
    ctx.fillStyle = rgba(sampleRamp(ramp, 0), ROOF_LAP_SHADOW_ALPHA);
    ctx.fillRect(spanLeft, top, spanW, rowH * ROOF_LAP_SHADOW_HEIGHT_FRACTION);
  }
  ctx.restore();
}

// ── Ironwork ─────────────────────────────────────────────────────────────────

const IRON_STRAP_LENGTH_FRACTION = 0.9;
const IRON_STRAP_WIDTH_FRACTION = 0.22;
const IRON_STRAP_HIGHLIGHT_ALPHA = 0.4;
const IRON_STRAP_HIGHLIGHT_RAMP_T = 0.75;
const IRON_STRAP_BODY_RAMP_T = 0.25;
const IRON_RIVET_RAMP_T = 0.6;
const IRON_RIVET_RADIUS_FRACTION = 0.18;
const IRON_RIVET_INSET_FRACTION = 0.16;

/**
 * A strap of hinge or bracket ironwork: a dark tapered band with a lit
 * spine and a rivet at each end. The one ironwork element every hinge,
 * bracket and window stay in Over City is built from — hardware stays rare
 * and always darkened, never a whole-wall material.
 */
export function paintIronStrap(
  ctx: Ctx,
  x: number,
  y: number,
  length: number,
  angle: number,
  ramp: Ramp,
): void {
  const w = length * IRON_STRAP_WIDTH_FRACTION;
  const len = length * IRON_STRAP_LENGTH_FRACTION;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = rgb(sampleRamp(ramp, IRON_STRAP_BODY_RAMP_T));
  ctx.fillRect(0, -w / 2, len, w);
  ctx.fillStyle = rgba(sampleRamp(ramp, IRON_STRAP_HIGHLIGHT_RAMP_T), IRON_STRAP_HIGHLIGHT_ALPHA);
  ctx.fillRect(0, -w / 2, len, Math.max(1, w * 0.3));
  ctx.fillStyle = rgb(sampleRamp(ramp, IRON_RIVET_RAMP_T));
  for (const t of [IRON_RIVET_INSET_FRACTION, 1 - IRON_RIVET_INSET_FRACTION]) {
    ctx.beginPath();
    ctx.arc(len * t, 0, w * IRON_RIVET_RADIUS_FRACTION, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Cloth awning ─────────────────────────────────────────────────────────────

const AWNING_STRIPE_COUNT = 5;
const AWNING_SCALLOP_DEPTH_FRACTION = 0.16;
const AWNING_SCALLOP_RADIUS_FRACTION = 0.5;
const AWNING_UNDERSIDE_ALPHA = 0.25;
const AWNING_UNDERSIDE_RAMP_T = 0.1;

/**
 * A striped awning or banner panel: alternating cool/warm cloth stripes
 * (`oc_cloth_sky`/`oc_cloth_ember`) with a scalloped hem and a shaded
 * underside — cloth reads as dyed fabric rather than a flat rectangle
 * because the hem is never straight.
 */
export function paintClothAwning(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  stripeA: Ramp,
  stripeB: Ramp,
): void {
  const stripeW = w / AWNING_STRIPE_COUNT;
  const bodyH = h * (1 - AWNING_SCALLOP_DEPTH_FRACTION);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < AWNING_STRIPE_COUNT; i++) {
    const stripe = i % 2 === 0 ? stripeA : stripeB;
    const sx = x + i * stripeW;
    ctx.fillStyle = rgb(sampleRamp(stripe, 0.5));
    ctx.fillRect(sx, y, stripeW, bodyH);
    ctx.fillStyle = rgba(sampleRamp(stripe, 0), AWNING_UNDERSIDE_ALPHA);
    ctx.fillRect(sx, y, stripeW, bodyH * AWNING_UNDERSIDE_RAMP_T);
    const scallopR = stripeW * AWNING_SCALLOP_RADIUS_FRACTION;
    ctx.beginPath();
    ctx.moveTo(sx, y + bodyH);
    ctx.arc(sx + stripeW / 2, y + bodyH, scallopR, Math.PI, 0);
    ctx.lineTo(sx + stripeW, y + bodyH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ── Glazing ──────────────────────────────────────────────────────────────────

export interface GlazingOptions {
  readonly wallRamp: Ramp;
  readonly trimRamp: Ramp;
  /** A warm lit-interior tone; omit for an unlit, reflective pane. */
  readonly glowColor?: RGB;
}

const GLAZING_GLASS_RAMP_T = 0.08;
const GLAZING_GLOW_ALPHA = 0.55;
const GLAZING_GLOW_INSET_FRACTION = 0.12;
const GLAZING_GLOW_SIZE_FRACTION = 0.76;
const GLAZING_MULLION_WIDTH_FRACTION = 0.05;
const GLAZING_FRAME_RAMP_T = 0.55;
const GLAZING_FRAME_WIDTH_FRACTION = 0.06;
const GLAZING_SILL_RAMP_T = 0.7;
const GLAZING_SILL_OVERHANG_FRACTION = 0.1;
const GLAZING_SILL_HEIGHT_FRACTION = 0.08;

/**
 * A glazed window: a dark or glowing pane, a mullion cross, a frame and a
 * lit sill ledge below it, as a reusable painter shared across every facade
 * and prop instead of duplicated facade-inline code.
 */
export function paintGlazing(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  options: GlazingOptions,
): void {
  const { wallRamp, trimRamp, glowColor } = options;
  ctx.fillStyle = rgb(sampleRamp(wallRamp, GLAZING_GLASS_RAMP_T));
  ctx.fillRect(x, y, w, h);
  if (glowColor !== undefined) {
    ctx.fillStyle = rgba(glowColor, GLAZING_GLOW_ALPHA);
    ctx.fillRect(
      x + w * GLAZING_GLOW_INSET_FRACTION,
      y + h * GLAZING_GLOW_INSET_FRACTION,
      w * GLAZING_GLOW_SIZE_FRACTION,
      h * GLAZING_GLOW_SIZE_FRACTION,
    );
  }
  const mullionW = Math.max(1, w * GLAZING_MULLION_WIDTH_FRACTION);
  ctx.strokeStyle = rgb(sampleRamp(trimRamp, GLAZING_FRAME_RAMP_T));
  ctx.lineWidth = mullionW;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, w * GLAZING_FRAME_WIDTH_FRACTION);
  ctx.strokeRect(x, y, w, h);
  const sillOverhang = w * GLAZING_SILL_OVERHANG_FRACTION;
  const sillH = h * GLAZING_SILL_HEIGHT_FRACTION;
  ctx.fillStyle = rgb(sampleRamp(trimRamp, GLAZING_SILL_RAMP_T));
  ctx.fillRect(x - sillOverhang, y + h, w + sillOverhang * 2, sillH);
}
