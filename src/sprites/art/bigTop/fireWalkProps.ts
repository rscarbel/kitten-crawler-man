/**
 * Act I, the Fire-Eater's Alley: the fire-breather grates in the sawdust, the
 * stage rigging the two crawlers break open for each other, and the fire
 * act's kit hung on the drapes.
 *
 * Every still picture is baked once through `bigTopPropCache` and blitted;
 * only what moves with the frame (a prop's pulse, its hit flash, the flare of
 * a vent lighting, the ropes) is drawn live over it.
 */

import { drawDangerTile } from '../../dangerTelegraph';
import { flameStamps } from '../../flameStamps';
import { drawRadialGlow, type GlowStop } from '../../radialGlow';
import { paintWord, wordWidth } from '../circusLettering';
import type { BrushPigment } from '../brushStroke';
import {
  EVERY_EDGE,
  ONE_TILE_BOX,
  drawBigTopProp,
  type BigTopPropBox,
  type BigTopPropCatalogueEntry,
} from './bigTopPropCache';
import {
  BLOOD,
  BONE,
  BRASS,
  DAMAGE_STAGE_COUNT,
  GILT,
  INK,
  IRON,
  LIMELIGHT,
  RINGMASTER,
  ROT_TIMBER,
  STAGE_RED,
  STRAW,
  TAU,
  blend,
  contactShadow,
  hitsLanded,
  jitterTone,
  litColumn,
  litFill,
  loopFrame,
  outline,
  paint,
  paintCarlChevrons,
  paintDonutHoop,
  paintImpact,
  paintPulseHalo,
  propRng,
  pulseStrength,
  wallDirectionFor,
  type Ctx,
  type RGB,
} from './bigTopPropKit';

/** How a destructible currently looks, as its target hands it over. */
export interface MazeDestructibleArt {
  /** 1 at full, 0 at broken. */
  readonly integrity: number;
  readonly broken: boolean;
  /** True for a few frames after a landed blow. */
  readonly struck: boolean;
  /** Which side the acting crawler stands on. */
  readonly facing: 'west' | 'east';
  /** Monotonic frame counter owned by the prop. */
  readonly phase: number;
  readonly pulsing: boolean;
}

/**
 * Pixels per tile at and above which painted lettering resolves into letters.
 * Below it a word is a few pixels of brush and reads as dirt, so the smaller
 * bakes paint a plain band where the words would be.
 */
const LETTERING_MIN_PX_PER_TILE = 48;

// ── The fire-breather grate ──────────────────────────────────────────────────

const GRATE_CENTRE = 0.5;
const GRATE_SOOT_RADIUS = 0.44;
const GRATE_SOOT_ALPHA = 0.55;
const RUFF_RADIUS = 0.35;
const RUFF_SCALLOPS = 11;
const RUFF_SCALLOP_RADIUS = 0.085;
const FACE_RADIUS = 0.33;
const FACE_CENTRE_Y = 0.51;
const EYE_OFFSET_X = 0.13;
const EYE_Y = 0.41;
const EYE_RADIUS_X = 0.065;
const EYE_RADIUS_Y = 0.04;
const EYE_DIAMOND_REACH = 0.1;
const EYE_DIAMOND_WIDTH = 0.045;
const GREASEPAINT_ALPHA = 0.55;
const BROW_LIFT = 0.07;
const NOSE_Y = 0.54;
const NOSE_RADIUS = 0.055;
/** The grin is the vent: the flame column stands out of it. */
const MOUTH_Y = 0.66;
const MOUTH_HALF_WIDTH = 0.19;
const MOUTH_DROP = 0.1;
const MOUTH_TEETH = 4;
const MOUTH_TOOTH_WIDTH = 0.028;
/** The pilot light kept burning in the eyes and mouth, so a fire lane can be read cold. */
const PILOT_ALPHA = 0.55;
const RIM_HIGHLIGHT_ALPHA = 0.5;
/** How far the grin's upper lip dips, as a share of its drop. */
const GRIN_UPPER_LIP_SAG = 0.35;
/** The ruff's gradient box reaches this far from the centre on every side. */
const RUFF_LIGHT_REACH = 0.45;
const FACE_RIM_LINE_WIDTH = 0.02;
const FACE_RIM_INSET = 0.03;
/** The rim highlight's arc, upper-left, in half-turns from east. */
const FACE_RIM_ARC_START = 1.05;
const FACE_RIM_ARC_END = 1.55;
const GREASEPAINT_TONE_JITTER = 6;
const BROW_LINE_WIDTH = 0.025;
const BROW_DROP = 0.01;
/** The brow's arc over each eye, in half-turns from east. */
const BROW_ARC_START = 1.15;
const BROW_ARC_END = 1.85;
const PILOT_EYE_DROP = 0.01;
const PILOT_EYE_SCALE_X = 0.6;
const PILOT_EYE_SCALE_Y = 0.5;
/** The pilot glow sits low in the grin, where the flame would come from. */
const PILOT_MOUTH_DEPTH = 0.9;
const PILOT_MOUTH_WIDTH_SCALE = 0.7;
const PILOT_MOUTH_RADIUS_Y = 0.05;
/** The bars start above the grin's top edge so the clip, not the bar, draws the lip. */
const MOUTH_TOOTH_RISE = 0.02;
const MOUTH_TOOTH_LENGTH = 0.2;

const FACE_IRON_HIGHLIGHT_LIFT = 0.4;
/** The face's own iron: lifted off `iron_black` so a cast relief reads at all. */
const FACE_IRON = {
  shadow: IRON.mid,
  mid: IRON.light,
  light: IRON.accent,
  accent: blend(IRON.accent, BONE.light, FACE_IRON_HIGHLIGHT_LIFT),
};

function traceGrin(ctx: Ctx, cx: number, top: number, halfWidth: number, drop: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, top);
  ctx.quadraticCurveTo(cx, top + drop * GRIN_UPPER_LIP_SAG, cx + halfWidth, top);
  ctx.quadraticCurveTo(cx, top + drop * 2, cx - halfWidth, top);
  ctx.closePath();
}

function paintFireGrate(ctx: Ctx, ox: number, oy: number, s: number): void {
  const cx = ox + s * GRATE_CENTRE;
  const cy = oy + s * FACE_CENTRE_Y;
  const rng = propRng('fireGrate');

  contactShadow(
    ctx,
    cx,
    oy + s * GRATE_CENTRE,
    s * GRATE_SOOT_RADIUS,
    s * GRATE_SOOT_RADIUS,
    GRATE_SOOT_ALPHA,
  );

  // The ruff: a scalloped cast collar, tarnished brass, the clown's frill.
  ctx.beginPath();
  for (let index = 0; index < RUFF_SCALLOPS; index++) {
    const angle = (TAU / RUFF_SCALLOPS) * index;
    const px = cx + Math.cos(angle) * s * RUFF_RADIUS;
    const py = cy + Math.sin(angle) * s * RUFF_RADIUS;
    ctx.moveTo(px + s * RUFF_SCALLOP_RADIUS, py);
    ctx.arc(px, py, s * RUFF_SCALLOP_RADIUS, 0, TAU);
  }
  const ruffLightSpan = s * RUFF_LIGHT_REACH * 2;
  ctx.fillStyle = litFill(
    ctx,
    cx - s * RUFF_LIGHT_REACH,
    cy - s * RUFF_LIGHT_REACH,
    ruffLightSpan,
    ruffLightSpan,
    BRASS,
  );
  ctx.fill();
  outline(ctx, s);

  ctx.beginPath();
  ctx.arc(cx, cy, s * FACE_RADIUS, 0, TAU);
  ctx.fillStyle = litFill(
    ctx,
    cx - s * FACE_RADIUS,
    cy - s * FACE_RADIUS,
    s * FACE_RADIUS * 2,
    s * FACE_RADIUS * 2,
    FACE_IRON,
  );
  ctx.fill();
  outline(ctx, s);
  ctx.strokeStyle = paint(FACE_IRON.accent, RIM_HIGHLIGHT_ALPHA);
  ctx.lineWidth = Math.max(1, s * FACE_RIM_LINE_WIDTH);
  ctx.beginPath();
  ctx.arc(
    cx,
    cy,
    s * (FACE_RADIUS - FACE_RIM_INSET),
    Math.PI * FACE_RIM_ARC_START,
    Math.PI * FACE_RIM_ARC_END,
  );
  ctx.stroke();

  for (const side of [-1, 1]) {
    const eyeX = cx + side * s * EYE_OFFSET_X;
    const eyeY = oy + s * EYE_Y;
    // Worn greasepaint: the tall diamond through each eye.
    ctx.fillStyle = paint(jitterTone(BONE.light, rng, GREASEPAINT_TONE_JITTER), GREASEPAINT_ALPHA);
    ctx.beginPath();
    ctx.moveTo(eyeX, eyeY - s * EYE_DIAMOND_REACH);
    ctx.lineTo(eyeX + s * EYE_DIAMOND_WIDTH, eyeY);
    ctx.lineTo(eyeX, eyeY + s * EYE_DIAMOND_REACH);
    ctx.lineTo(eyeX - s * EYE_DIAMOND_WIDTH, eyeY);
    ctx.closePath();
    ctx.fill();
    // The raised brow arch catches the light on its upper-left.
    ctx.strokeStyle = paint(FACE_IRON.accent, RIM_HIGHLIGHT_ALPHA);
    ctx.lineWidth = Math.max(1, s * BROW_LINE_WIDTH);
    ctx.beginPath();
    ctx.arc(
      eyeX,
      eyeY + s * BROW_DROP,
      s * BROW_LIFT,
      Math.PI * BROW_ARC_START,
      Math.PI * BROW_ARC_END,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, s * EYE_RADIUS_X, s * EYE_RADIUS_Y, 0, 0, TAU);
    ctx.fillStyle = paint(INK);
    ctx.fill();
    ctx.fillStyle = paint(LIMELIGHT.shadow, PILOT_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      eyeX,
      eyeY + s * PILOT_EYE_DROP,
      s * EYE_RADIUS_X * PILOT_EYE_SCALE_X,
      s * EYE_RADIUS_Y * PILOT_EYE_SCALE_Y,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, oy + s * NOSE_Y, s * NOSE_RADIUS, 0, TAU);
  ctx.fillStyle = litFill(
    ctx,
    cx - s * NOSE_RADIUS,
    oy + s * (NOSE_Y - NOSE_RADIUS),
    s * NOSE_RADIUS * 2,
    s * NOSE_RADIUS * 2,
    BLOOD,
  );
  ctx.fill();
  outline(ctx, s);

  const mouthTop = oy + s * MOUTH_Y;
  traceGrin(ctx, cx, mouthTop, s * MOUTH_HALF_WIDTH, s * MOUTH_DROP);
  ctx.fillStyle = paint(INK);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = paint(LIMELIGHT.shadow, PILOT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    cx,
    mouthTop + s * MOUTH_DROP * PILOT_MOUTH_DEPTH,
    s * MOUTH_HALF_WIDTH * PILOT_MOUTH_WIDTH_SCALE,
    s * PILOT_MOUTH_RADIUS_Y,
    0,
    0,
    TAU,
  );
  ctx.fill();
  // The grate bars across the grin, which make it a vent and not just a face.
  for (let tooth = 1; tooth <= MOUTH_TEETH; tooth++) {
    const toothX =
      cx - s * MOUTH_HALF_WIDTH + ((s * MOUTH_HALF_WIDTH * 2) / (MOUTH_TEETH + 1)) * tooth;
    ctx.fillStyle = litColumn(
      ctx,
      toothX - (s * MOUTH_TOOTH_WIDTH) / 2,
      s * MOUTH_TOOTH_WIDTH,
      FACE_IRON,
    );
    ctx.fillRect(
      toothX - (s * MOUTH_TOOTH_WIDTH) / 2,
      mouthTop - s * MOUTH_TOOTH_RISE,
      s * MOUTH_TOOTH_WIDTH,
      s * MOUTH_TOOTH_LENGTH,
    );
  }
  ctx.restore();
  traceGrin(ctx, cx, mouthTop, s * MOUTH_HALF_WIDTH, s * MOUTH_DROP);
  outline(ctx, s);
}

/** A fire-breather grate, cold: a cast-iron clown face in the sawdust, its grin the vent. */
export function drawFireBreatherGrate(ctx: Ctx, x: number, y: number, size: number): void {
  drawBigTopProp(
    ctx,
    { prop: 'fireGrate', state: 'cold', frame: 0 },
    ONE_TILE_BOX,
    paintFireGrate,
    x,
    y,
    size,
  );
}

/** A row of fire-breather grates side by side, as one baked strip. */
export interface FireGrateRun {
  /** The row the run lies in. */
  readonly tileY: number;
  /** The leftmost column of the strip. */
  readonly x0: number;
  /** Every column in the strip holding a grate, left to right. */
  readonly columns: ReadonlyArray<number>;
}

/**
 * Groups grates into runs along their rows: one strip per row per side of
 * the dividing column. A fire lane holds a dozen grates, and one blit for a
 * run instead of one per grate is what keeps the fire walk inside its
 * draw-call budget.
 */
export function fireGrateRuns(
  tiles: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  dividingColumn: number,
): ReadonlyArray<FireGrateRun> {
  const groups = new Map<string, number[]>();
  for (const tile of tiles) {
    const key = `${tile.y}|${tile.x < dividingColumn ? 'west' : 'east'}`;
    const columns = groups.get(key) ?? [];
    columns.push(tile.x);
    groups.set(key, columns);
  }
  const runs: FireGrateRun[] = [];
  for (const [key, columns] of groups) {
    const tileY = Number(key.split('|')[0]);
    const sorted = [...new Set(columns)].sort((a, b) => a - b);
    if (sorted.length === 0) continue;
    const x0 = sorted[0];
    runs.push({ tileY, x0, columns: sorted });
  }
  return runs;
}

function grateRunPainter(run: FireGrateRun) {
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    for (const column of run.columns) paintFireGrate(ctx, ox + (column - run.x0) * s, oy, s);
  };
}

function grateRunBox(run: FireGrateRun): BigTopPropBox {
  const last = run.columns[run.columns.length - 1] ?? run.x0;
  return { left: 0, top: 0, width: last - run.x0 + 1, height: 1 };
}

/** A run of cold fire-breather grates, drawn with one blit; `(x, y)` is the strip's left tile. */
export function drawFireBreatherGrateRun(
  ctx: Ctx,
  run: FireGrateRun,
  x: number,
  y: number,
  size: number,
): void {
  // The grates are on screen from the moment the act is and the flame is not:
  // baking the flame's stamps here spends that cost on a frame with nothing at
  // stake rather than on the frame a vent first lights under somebody.
  flameStamps();
  drawBigTopProp(
    ctx,
    { prop: 'fireGrateRun', state: `${run.tileY}|${run.columns.join(',')}`, frame: 0 },
    grateRunBox(run),
    grateRunPainter(run),
    x,
    y,
    size,
  );
}

/**
 * Steps the kindling is baked in. Six over a half-second warning is one step
 * every few frames, which reads as a steady brightening rather than a flicker.
 */
export const KINDLE_STEPS = 6;
const KINDLE_EYE_GLOW_RADIUS = 0.11;
const KINDLE_MOUTH_GLOW_RADIUS = 0.26;
const KINDLE_MIN_ALPHA = 0.35;
const KINDLE_EYE_SCALE_X = 0.8;
const KINDLE_EYE_SCALE_Y = 0.7;
const KINDLE_MOUTH_GLOW_DEPTH = 0.7;
/** The lit grin sits just inside the iron one, so the cast lip stays dark round it. */
const KINDLE_GRIN_SCALE = 0.9;
const KINDLE_TOOTH_ALPHA = 0.85;

function kindlePainter(level: number) {
  const heat = level / KINDLE_STEPS;
  const glowAlpha = KINDLE_MIN_ALPHA + (1 - KINDLE_MIN_ALPHA) * heat;
  const core: RGB = blend(LIMELIGHT.mid, LIMELIGHT.accent, heat);
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    const cx = ox + s * GRATE_CENTRE;
    for (const side of [-1, 1]) {
      const eyeX = cx + side * s * EYE_OFFSET_X;
      const eyeY = oy + s * EYE_Y;
      const halo = ctx.createRadialGradient(eyeX, eyeY, 0, eyeX, eyeY, s * KINDLE_EYE_GLOW_RADIUS);
      halo.addColorStop(0, paint(core, glowAlpha));
      halo.addColorStop(1, paint(LIMELIGHT.shadow, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(
        eyeX - s * KINDLE_EYE_GLOW_RADIUS,
        eyeY - s * KINDLE_EYE_GLOW_RADIUS,
        s * KINDLE_EYE_GLOW_RADIUS * 2,
        s * KINDLE_EYE_GLOW_RADIUS * 2,
      );
      ctx.fillStyle = paint(core, glowAlpha);
      ctx.beginPath();
      ctx.ellipse(
        eyeX,
        eyeY,
        s * EYE_RADIUS_X * KINDLE_EYE_SCALE_X,
        s * EYE_RADIUS_Y * KINDLE_EYE_SCALE_Y,
        0,
        0,
        TAU,
      );
      ctx.fill();
    }
    const mouthTop = oy + s * MOUTH_Y;
    const mouthY = mouthTop + s * MOUTH_DROP * KINDLE_MOUTH_GLOW_DEPTH;
    const glow = ctx.createRadialGradient(cx, mouthY, 0, cx, mouthY, s * KINDLE_MOUTH_GLOW_RADIUS);
    glow.addColorStop(0, paint(core, glowAlpha));
    glow.addColorStop(0.5, paint(LIMELIGHT.mid, glowAlpha * 0.5));
    glow.addColorStop(1, paint(LIMELIGHT.shadow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(
      cx - s * KINDLE_MOUTH_GLOW_RADIUS,
      mouthY - s * KINDLE_MOUTH_GLOW_RADIUS,
      s * KINDLE_MOUTH_GLOW_RADIUS * 2,
      s * KINDLE_MOUTH_GLOW_RADIUS * 2,
    );
    traceGrin(
      ctx,
      cx,
      mouthTop,
      s * MOUTH_HALF_WIDTH * KINDLE_GRIN_SCALE,
      s * MOUTH_DROP * KINDLE_GRIN_SCALE,
    );
    ctx.fillStyle = paint(core, glowAlpha);
    ctx.fill();
    for (let tooth = 1; tooth <= MOUTH_TEETH; tooth++) {
      const toothX =
        cx - s * MOUTH_HALF_WIDTH + ((s * MOUTH_HALF_WIDTH * 2) / (MOUTH_TEETH + 1)) * tooth;
      ctx.fillStyle = paint(INK, KINDLE_TOOTH_ALPHA);
      ctx.fillRect(
        toothX - (s * MOUTH_TOOTH_WIDTH) / 2,
        mouthTop - s * MOUTH_TOOTH_RISE,
        s * MOUTH_TOOTH_WIDTH,
        s * MOUTH_TOOTH_LENGTH,
      );
    }
  };
}

/** Below this the flame is a lick rather than a column, and the warning is never drawn from nothing. */
const FLAME_RAMP_FRACTION = 0.2;

/**
 * The warning: the shared danger tile, with the grate's eyes kindling and its
 * grin glowing through it. The danger tile is the fairness contract and stays
 * underneath; the face only adds to it.
 */
export function drawFireBreatherTelegraph(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  drawDangerTile(ctx, x, y, size, Math.min(1, progress + FLAME_RAMP_FRACTION));
  const level = Math.max(1, Math.min(KINDLE_STEPS, Math.ceil(progress * KINDLE_STEPS)));
  drawBigTopProp(
    ctx,
    { prop: 'fireGrateKindle', state: 'warm', frame: level },
    ONE_TILE_BOX,
    kindlePainter(level),
    x,
    y,
    size,
  );
}

/** How much of a burn the heat shimmer lasts: the gulp of air as the jet catches. */
const SHIMMER_SHARE = 0.22;
const SHIMMER_RADIUS_TILES = 1.35;
const SHIMMER_PEAK_ALPHA = 0.55;
const SHIMMER_RING_RADIUS_TILES = 0.35;
const SHIMMER_RING_SPREAD_TILES = 0.9;
const SHIMMER_RING_ALPHA = 0.35;
const SHIMMER_RING_WIDTH = 0.06;
const SHIMMER_RIPPLE_SPEED = 0.9;
const SHIMMER_RIPPLE_DEPTH = 0.08;
/** The bloom rises from partway down the grin, where the jet leaves the vent. */
const SHIMMER_MOUTH_DEPTH = 0.5;
/** The ring lies on the floor, so it is squashed into an ellipse. */
const SHIMMER_RING_FORESHORTEN = 0.55;
const SHIMMER_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: paint(LIMELIGHT.light, 0.9) },
  { offset: 0.35, color: paint(LIMELIGHT.mid, 0.45) },
  { offset: 1, color: paint(LIMELIGHT.shadow, 0) },
];

/**
 * The flare as a vent lights: a wide warm bloom and one ring of shimmering air
 * rolling off the grate, gone within the first fifth of the burn. Additive, so
 * it only ever brightens what is under it.
 */
export function drawHeatShimmerFlare(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  burn: number,
  phase: number,
): void {
  if (burn <= 0 || burn >= SHIMMER_SHARE) return;
  const t = burn / SHIMMER_SHARE;
  const fade = 1 - t;
  const cx = x + size * GRATE_CENTRE;
  const cy = y + size * (MOUTH_Y + MOUTH_DROP * SHIMMER_MOUTH_DEPTH);
  const ripple = 1 + SHIMMER_RIPPLE_DEPTH * Math.sin(phase * SHIMMER_RIPPLE_SPEED);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = SHIMMER_PEAK_ALPHA * fade;
  drawRadialGlow(ctx, cx, cy, size * SHIMMER_RADIUS_TILES * ripple, SHIMMER_STOPS);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = paint(LIMELIGHT.light, SHIMMER_RING_ALPHA * fade);
  ctx.lineWidth = Math.max(1, size * SHIMMER_RING_WIDTH);
  const ringRadius = size * (SHIMMER_RING_RADIUS_TILES + SHIMMER_RING_SPREAD_TILES * t);
  ctx.beginPath();
  ctx.ellipse(cx, cy, ringRadius * ripple, ringRadius * SHIMMER_RING_FORESHORTEN, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ── Stencilled lettering ─────────────────────────────────────────────────────

const STENCIL_BUILD_UP_LIGHTEN = 0.15;
const STENCIL_WET_EDGE_DARKEN = 0.35;
/** Below lettering size the legend is a flat band, a touch translucent so it reads as paint and not a patch. */
const LEGEND_BAND_ALPHA = 0.8;
/** A letter's width as a share of its height, for sizing the band a word would fill. */
const LEGEND_LETTER_ASPECT = 0.6;
const LEGEND_BAND_INSET = 0.2;
const LEGEND_BAND_HEIGHT = 0.6;

function stencilPigment(color: RGB): BrushPigment {
  return {
    body: paint(color),
    buildUp: paint(blend(color, BONE.accent, STENCIL_BUILD_UP_LIGHTEN)),
    wetEdge: paint(blend(color, INK, STENCIL_WET_EDGE_DARKEN)),
    bareSurface: paint(BONE.mid),
    soak: paint(color),
  };
}

/** A word where it resolves, and a plain painted band where it would only be dirt. */
function paintLegend(
  ctx: Ctx,
  word: string,
  cx: number,
  top: number,
  height: number,
  maxWidth: number,
  color: RGB,
  s: number,
  seed: string,
): void {
  if (s < LETTERING_MIN_PX_PER_TILE) {
    ctx.fillStyle = paint(color, LEGEND_BAND_ALPHA);
    const bandWidth = Math.min(maxWidth, height * word.length * LEGEND_LETTER_ASPECT);
    ctx.fillRect(
      cx - bandWidth / 2,
      top + height * LEGEND_BAND_INSET,
      bandWidth,
      height * LEGEND_BAND_HEIGHT,
    );
    return;
  }
  const fitted = Math.min(height, (height * maxWidth) / wordWidth(word, height));
  const settle = (height - fitted) / 2;
  paintWord(ctx, word, cx, top + settle, fitted, stencilPigment(color), propRng(seed));
}

// ── Donut's counterweight: the stencilled sandbag ────────────────────────────

const SANDBAG_WIDTH = 0.6;
const SANDBAG_HEIGHT = 0.5;
const SANDBAG_TOP = 0.28;
const SANDBAG_WALL_HUG = 0.14;
const SANDBAG_NECK_FRACTION = 0.2;
const SANDBAG_FOOT_FRACTION = 0.44;
const SANDBAG_BELLY_FRACTION = 0.62;
const SANDBAG_STRIPES = 6;
const SANDBAG_FLOOR_Y = 0.86;
const SANDBAG_SHADOW_RADIUS = 0.3;
const SANDBAG_PANEL_TOP = 0.3;
const SANDBAG_PANEL_HEIGHT = 0.42;
const SANDBAG_PANEL_WIDTH = 0.74;
const SANDBAG_STENCIL_HEIGHT = 0.1;
const ROPE_WIDTH_TILES = 0.05;
/** Frames in the counterweight's sway loop, and game frames per step (a ~2.4 s sway). */
const SANDBAG_SWAY_FRAMES = 8;
const SANDBAG_SWAY_FRAMES_PER_STEP = 18;
const SANDBAG_SWAY_TILES = 0.025;
const SANDBAG_SPILL_WIDTH = 0.3;
const SANDBAG_SPILL_HEIGHT = 0.08;
const SANDBAG_SKIN_WIDTH = 0.26;
const SANDBAG_SKIN_HEIGHT = 0.06;
const SANDBAG_SKIN_Y = 0.82;
const SANDBAG_SKIN_TILT_RADIANS = -0.2;
const SANDBAG_SPILL_SHADOW_SCALE = 1.2;
const SANDBAG_SPILL_LIFT = 0.02;
const SANDBAG_SPILL_LIGHT_TOP = 0.1;
const SANDBAG_SPILL_LIGHT_HEIGHT = 0.16;
/** The cut end swings a little off plumb. */
const CUT_ROPE_DRIFT = 0.03;
const CUT_ROPE_LENGTH = 0.2;
/** The bag's shadow falls down-right, away from the upper-left light. */
const SANDBAG_SHADOW_OFFSET_X = 0.04;
const SANDBAG_SHADOW_RADIUS_Y = 0.07;
const ROPE_LIGHT_HALF_WIDTH = 0.03;
const ROPE_LIGHT_WIDTH = 0.06;
/** The stripes overrun the bag on both sides so the clip, not the stripe, makes its edge. */
const SANDBAG_STRIPE_SPAN = 1.2;
const SANDBAG_STRIPE_LEFT = 0.6;
const SANDBAG_STRIPE_TONE_JITTER = 8;
const SANDBAG_PANEL_ALPHA = 0.92;
const SANDBAG_NAME_TOP = 0.12;
const SANDBAG_NAME_WIDTH = 0.92;
const SANDBAG_COMPANY_TOP = 0.55;
const SANDBAG_COMPANY_WIDTH = 0.6;
const SANDBAG_FORM_HIGHLIGHT_ALPHA = 0.25;
const SANDBAG_FORM_MIDPOINT = 0.45;
const SANDBAG_FORM_SHADE_ALPHA = 0.5;
const SANDBAG_TIE_WIDTH_SCALE = 1.2;
/** The tie is a little wider than the neck it gathers. */
const SANDBAG_TIE_REACH = 1.1;
const SANDBAG_TIE_DROP = 0.02;

function sandbagPainter(facing: 'west' | 'east', broken: boolean, swayFrame: number) {
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    const wallDirection = wallDirectionFor(facing);
    const hangX = ox + s * (0.5 + wallDirection * SANDBAG_WALL_HUG);
    const floorY = oy + s * SANDBAG_FLOOR_Y;
    if (broken) {
      contactShadow(
        ctx,
        hangX,
        floorY,
        s * SANDBAG_SPILL_WIDTH,
        s * SANDBAG_SPILL_HEIGHT * SANDBAG_SPILL_SHADOW_SCALE,
      );
      ctx.beginPath();
      ctx.ellipse(
        hangX,
        floorY - s * SANDBAG_SPILL_LIFT,
        s * SANDBAG_SPILL_WIDTH,
        s * SANDBAG_SPILL_HEIGHT,
        0,
        0,
        TAU,
      );
      ctx.fillStyle = litFill(
        ctx,
        hangX - s * SANDBAG_SPILL_WIDTH,
        floorY - s * SANDBAG_SPILL_LIGHT_TOP,
        s * SANDBAG_SPILL_WIDTH * 2,
        s * SANDBAG_SPILL_LIGHT_HEIGHT,
        STRAW,
      );
      ctx.fill();
      outline(ctx, s);
      ctx.beginPath();
      ctx.ellipse(
        hangX,
        oy + s * SANDBAG_SKIN_Y,
        s * SANDBAG_SKIN_WIDTH,
        s * SANDBAG_SKIN_HEIGHT,
        SANDBAG_SKIN_TILT_RADIANS,
        0,
        TAU,
      );
      ctx.fillStyle = paint(STAGE_RED.mid);
      ctx.fill();
      outline(ctx, s);
      // The cut rope, dangling from the rigging.
      ctx.strokeStyle = paint(BONE.mid);
      ctx.lineWidth = Math.max(1, s * ROPE_WIDTH_TILES);
      ctx.beginPath();
      ctx.moveTo(hangX, oy);
      ctx.lineTo(hangX + s * CUT_ROPE_DRIFT, oy + s * CUT_ROPE_LENGTH);
      ctx.stroke();
      return;
    }
    const sway = Math.sin((swayFrame / SANDBAG_SWAY_FRAMES) * TAU) * s * SANDBAG_SWAY_TILES;
    const bagX = hangX + sway;
    const bagWidth = s * SANDBAG_WIDTH;
    const bagHeight = s * SANDBAG_HEIGHT;
    const bagTop = oy + s * SANDBAG_TOP;
    const bagBottom = bagTop + bagHeight;
    const bellyY = bagTop + bagHeight * SANDBAG_BELLY_FRACTION;

    contactShadow(
      ctx,
      bagX + s * SANDBAG_SHADOW_OFFSET_X,
      floorY,
      s * SANDBAG_SHADOW_RADIUS,
      s * SANDBAG_SHADOW_RADIUS_Y,
    );

    ctx.strokeStyle = litColumn(ctx, hangX - s * ROPE_LIGHT_HALF_WIDTH, s * ROPE_LIGHT_WIDTH, BONE);
    ctx.lineWidth = Math.max(1, s * ROPE_WIDTH_TILES);
    ctx.beginPath();
    ctx.moveTo(hangX, oy);
    ctx.lineTo(bagX, bagTop);
    ctx.stroke();

    const traceBag = (): void => {
      ctx.beginPath();
      ctx.moveTo(bagX - bagWidth * SANDBAG_NECK_FRACTION, bagTop);
      ctx.quadraticCurveTo(
        bagX - bagWidth / 2,
        bellyY,
        bagX - bagWidth * SANDBAG_FOOT_FRACTION,
        bagBottom,
      );
      ctx.lineTo(bagX + bagWidth * SANDBAG_FOOT_FRACTION, bagBottom);
      ctx.quadraticCurveTo(
        bagX + bagWidth / 2,
        bellyY,
        bagX + bagWidth * SANDBAG_NECK_FRACTION,
        bagTop,
      );
      ctx.closePath();
    };
    traceBag();
    ctx.fillStyle = paint(BONE.light);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const stripeWidth = (bagWidth * SANDBAG_STRIPE_SPAN) / SANDBAG_STRIPES;
    const stripesLeft = bagX - bagWidth * SANDBAG_STRIPE_LEFT;
    const rng = propRng(`sandbag${facing}`);
    for (let stripe = 0; stripe < SANDBAG_STRIPES; stripe += 2) {
      ctx.fillStyle = paint(jitterTone(STAGE_RED.mid, rng, SANDBAG_STRIPE_TONE_JITTER));
      ctx.fillRect(stripesLeft + stripeWidth * stripe, bagTop, stripeWidth, bagHeight);
    }
    // The stencilled panel, painted over the stripes the way a showman marks his kit.
    const panelWidth = bagWidth * SANDBAG_PANEL_WIDTH;
    const panelTop = bagTop + bagHeight * SANDBAG_PANEL_TOP;
    const panelHeight = bagHeight * SANDBAG_PANEL_HEIGHT;
    ctx.fillStyle = paint(BONE.light, SANDBAG_PANEL_ALPHA);
    ctx.fillRect(bagX - panelWidth / 2, panelTop, panelWidth, panelHeight);
    const stencilHeight = s * SANDBAG_STENCIL_HEIGHT;
    paintLegend(
      ctx,
      'GRIMALDI',
      bagX,
      panelTop + panelHeight * SANDBAG_NAME_TOP,
      stencilHeight,
      panelWidth * SANDBAG_NAME_WIDTH,
      STAGE_RED.shadow,
      s,
      'stencilName',
    );
    paintLegend(
      ctx,
      '& CO.',
      bagX,
      panelTop + panelHeight * SANDBAG_COMPANY_TOP,
      stencilHeight,
      panelWidth * SANDBAG_COMPANY_WIDTH,
      STAGE_RED.shadow,
      s,
      'stencilCo',
    );
    // Form shading over everything: lit from the upper left, heavy at the foot.
    const form = ctx.createLinearGradient(
      bagX - bagWidth / 2,
      bagTop,
      bagX + bagWidth / 2,
      bagBottom,
    );
    form.addColorStop(0, paint(BONE.accent, SANDBAG_FORM_HIGHLIGHT_ALPHA));
    form.addColorStop(SANDBAG_FORM_MIDPOINT, paint(INK, 0));
    form.addColorStop(1, paint(INK, SANDBAG_FORM_SHADE_ALPHA));
    ctx.fillStyle = form;
    ctx.fillRect(bagX - bagWidth, bagTop, bagWidth * 2, bagHeight);
    ctx.restore();
    traceBag();
    outline(ctx, s);

    // The gilt tie at the neck, which is what makes it a sack.
    ctx.strokeStyle = paint(GILT.light);
    ctx.lineWidth = Math.max(1, s * ROPE_WIDTH_TILES * SANDBAG_TIE_WIDTH_SCALE);
    ctx.beginPath();
    const tieY = bagTop + s * SANDBAG_TIE_DROP;
    ctx.moveTo(bagX - bagWidth * SANDBAG_NECK_FRACTION * SANDBAG_TIE_REACH, tieY);
    ctx.lineTo(bagX + bagWidth * SANDBAG_NECK_FRACTION * SANDBAG_TIE_REACH, tieY);
    ctx.stroke();
  };
}

/**
 * The counterweight Donut shoots out: a striped sack stencilled "GRIMALDI &
 * CO.", hung on a rope that runs over the pulley in the grate beside it.
 */
export function drawGrimaldiSandbag(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  const swayFrame = state.broken
    ? 0
    : loopFrame(state.phase, SANDBAG_SWAY_FRAMES, SANDBAG_SWAY_FRAMES_PER_STEP);
  const strength = pulseStrength(state.phase, state.pulsing);
  if (!state.broken) paintPulseHalo(ctx, x + size / 2, y + size / 2, size, strength, GILT.accent);
  drawBigTopProp(
    ctx,
    {
      prop: 'sandbag',
      state: `${state.facing}|${state.broken ? 'burst' : 'whole'}`,
      frame: swayFrame,
    },
    ONE_TILE_BOX,
    sandbagPainter(state.facing, state.broken, swayFrame),
    x,
    y,
    size,
  );
  if (state.broken) return;
  paintDonutHoop(ctx, x + size / 2, y + size / 2, size, strength);
  paintImpact(ctx, x + size / 2, y + size * (SANDBAG_TOP + SANDBAG_HEIGHT / 2), size, state.struck);
}

// ── Carl's brace: a timber stage brace on a screw jack ───────────────────────

const BRACE_POST_WIDTH = 0.2;
const BRACE_POST_TOP = 0.06;
const BRACE_SOLE_Y = 0.86;
const BRACE_SOLE_HEIGHT = 0.08;
const BRACE_SOLE_WIDTH = 0.66;
const BRACE_JACK_HEIGHT = 0.16;
const BRACE_JACK_WIDTH = 0.1;
const BRACE_JACK_BAR = 0.3;
const BRACE_RAKE_WIDTH = 0.12;
const BRACE_RAKE_FOOT_X = 0.32;
const BRACE_RAKE_TOP_Y = 0.3;
const BRACE_BAND_Y = 0.36;
const BRACE_BAND_HEIGHT = 0.1;
const BRACE_COLLAR_HEIGHT = 0.04;
const BRACE_MAX_LEAN_RADIANS = 0.2;
const BRACE_WALL_HUG = 0.18;
const BRACE_CHUNK_DEPTH = 0.08;
const BRACE_CHUNK_HEIGHT = 0.08;
const BRACE_NAIL_RADIUS = 0.022;
const BRACE_NAIL_YS: ReadonlyArray<number> = [0.2, 0.62];
const BRACE_SHADOW_DEPTH = 0.6;
const BRACE_SHADOW_RADIUS_X = 0.4;
const BRACE_SHADOW_RADIUS_Y = 0.08;
const BRACE_FALLEN_PIVOT_LIFT = 0.05;
/** Near flat: the post has gone over onto its sole plate. */
const BRACE_FALLEN_RADIANS = 1.35;
const BRACE_FALLEN_LENGTH = 0.4;
const BRACE_FALLEN_BAND_Y = 0.3;
const BRACE_FALLEN_JACK_OFFSET = 0.25;
const BRACE_FALLEN_JACK_LIFT = 0.03;
const BRACE_FALLEN_JACK_RADIUS_X = 0.08;
const BRACE_FALLEN_JACK_RADIUS_Y = 0.05;
const BRACE_FALLEN_JACK_TILT_RADIANS = 0.6;
const BRACE_SPLINTERS = 4;
const BRACE_SPLINTER_TONE_JITTER = 12;
const BRACE_SPLINTER_LEFT = 0.2;
const BRACE_SPLINTER_SPACING = 0.15;
const BRACE_SPLINTER_LIFT = 0.02;
const BRACE_SPLINTER_WIDTH = 0.08;
const BRACE_SPLINTER_HEIGHT = 0.025;
const BRACE_RAKE_LIGHT_PAD = 0.1;
const BRACE_RAKE_LIGHT_WIDTH = 0.5;
const BRACE_LOW_COLLAR_Y = 0.7;
const BRACE_COLLAR_OVERHANG = 0.01;
const BRACE_FIRST_CHUNK_Y = 0.22;
const BRACE_CHUNK_SPACING = 0.18;
const BRACE_JACK_THREAD_ALPHA = 0.8;
const BRACE_JACK_THREAD_WIDTH = 0.015;
/** The jack's screw is drawn as this many segments, the threads between them. */
const BRACE_JACK_THREAD_SEGMENTS = 4;
/** Half the rise of each thread across the screw: the threads slope, as a helix does. */
const BRACE_JACK_THREAD_SLOPE = 0.01;
const BRACE_JACK_BAR_DROP = 0.03;
const BRACE_JACK_BAR_HEIGHT = 0.035;
/** The blow lands on the post, which is narrower than the tile the impact is sized for. */
const BRACE_IMPACT_SCALE = 1.6;

function bracePainter(facing: 'west' | 'east', stage: number, broken: boolean) {
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    const wallDirection = wallDirectionFor(facing);
    const postCentreX = ox + s * (0.5 + wallDirection * BRACE_WALL_HUG);
    const postWidth = s * BRACE_POST_WIDTH;
    const soleY = oy + s * BRACE_SOLE_Y;
    const jackTop = soleY - s * BRACE_JACK_HEIGHT;
    const rng = propRng(`brace${facing}${stage}`);

    contactShadow(
      ctx,
      ox + s * 0.5,
      soleY + s * BRACE_SOLE_HEIGHT * BRACE_SHADOW_DEPTH,
      s * BRACE_SHADOW_RADIUS_X,
      s * BRACE_SHADOW_RADIUS_Y,
    );
    ctx.beginPath();
    ctx.rect(
      ox + s * (0.5 - BRACE_SOLE_WIDTH / 2),
      soleY,
      s * BRACE_SOLE_WIDTH,
      s * BRACE_SOLE_HEIGHT,
    );
    ctx.fillStyle = litFill(ctx, ox, soleY, s, s * BRACE_SOLE_HEIGHT, ROT_TIMBER);
    ctx.fill();
    outline(ctx, s);

    if (broken) {
      // The post down across its own sole plate, the jack kicked over.
      ctx.save();
      ctx.translate(ox + s * 0.5, soleY - s * BRACE_FALLEN_PIVOT_LIFT);
      ctx.rotate(wallDirection * BRACE_FALLEN_RADIANS);
      const fallenLength = s * BRACE_FALLEN_LENGTH;
      ctx.beginPath();
      ctx.rect(-postWidth / 2, -fallenLength, postWidth, fallenLength);
      ctx.fillStyle = litFill(
        ctx,
        -postWidth / 2,
        -fallenLength,
        postWidth,
        fallenLength,
        ROT_TIMBER,
      );
      ctx.fill();
      outline(ctx, s);
      ctx.fillStyle = paint(RINGMASTER.mid);
      ctx.fillRect(-postWidth / 2, -s * BRACE_FALLEN_BAND_Y, postWidth, s * BRACE_BAND_HEIGHT);
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(
        ox + s * (0.5 - wallDirection * BRACE_FALLEN_JACK_OFFSET),
        soleY - s * BRACE_FALLEN_JACK_LIFT,
        s * BRACE_FALLEN_JACK_RADIUS_X,
        s * BRACE_FALLEN_JACK_RADIUS_Y,
        BRACE_FALLEN_JACK_TILT_RADIANS,
        0,
        TAU,
      );
      ctx.fillStyle = paint(IRON.light);
      ctx.fill();
      outline(ctx, s);
      for (let splinter = 0; splinter < BRACE_SPLINTERS; splinter++) {
        ctx.fillStyle = paint(jitterTone(ROT_TIMBER.light, rng, BRACE_SPLINTER_TONE_JITTER));
        ctx.fillRect(
          ox + s * (BRACE_SPLINTER_LEFT + BRACE_SPLINTER_SPACING * splinter),
          soleY - s * BRACE_SPLINTER_LIFT,
          s * BRACE_SPLINTER_WIDTH,
          s * BRACE_SPLINTER_HEIGHT,
        );
      }
      return;
    }

    const lean = (BRACE_MAX_LEAN_RADIANS * stage) / DAMAGE_STAGE_COUNT;
    ctx.save();
    ctx.translate(postCentreX, jackTop);
    ctx.rotate(lean * wallDirection);
    ctx.translate(-postCentreX, -jackTop);

    // The raking brace, from the post's shoulder down to the sole on the lane side.
    const rakeFootX = postCentreX - wallDirection * s * BRACE_RAKE_FOOT_X;
    const rakeTopY = oy + s * BRACE_RAKE_TOP_Y;
    ctx.beginPath();
    ctx.moveTo(postCentreX - (s * BRACE_RAKE_WIDTH) / 2, rakeTopY);
    ctx.lineTo(postCentreX + (s * BRACE_RAKE_WIDTH) / 2, rakeTopY);
    ctx.lineTo(rakeFootX + (s * BRACE_RAKE_WIDTH) / 2, soleY);
    ctx.lineTo(rakeFootX - (s * BRACE_RAKE_WIDTH) / 2, soleY);
    ctx.closePath();
    ctx.fillStyle = litFill(
      ctx,
      Math.min(rakeFootX, postCentreX) - s * BRACE_RAKE_LIGHT_PAD,
      rakeTopY,
      s * BRACE_RAKE_LIGHT_WIDTH,
      soleY - rakeTopY,
      ROT_TIMBER,
    );
    ctx.fill();
    outline(ctx, s);

    const postTop = oy + s * BRACE_POST_TOP;
    ctx.beginPath();
    ctx.rect(postCentreX - postWidth / 2, postTop, postWidth, jackTop - postTop);
    ctx.fillStyle = litColumn(ctx, postCentreX - postWidth / 2, postWidth, ROT_TIMBER);
    ctx.fill();
    outline(ctx, s);
    // Ringmaster-blue paint and brass collars: whose timber this is.
    ctx.fillStyle = litColumn(ctx, postCentreX - postWidth / 2, postWidth, RINGMASTER);
    ctx.fillRect(
      postCentreX - postWidth / 2,
      oy + s * BRACE_BAND_Y,
      postWidth,
      s * BRACE_BAND_HEIGHT,
    );
    ctx.fillStyle = litColumn(ctx, postCentreX - postWidth / 2, postWidth, BRASS);
    for (const collarY of [
      BRACE_BAND_Y - BRACE_COLLAR_HEIGHT,
      BRACE_BAND_Y + BRACE_BAND_HEIGHT,
      BRACE_LOW_COLLAR_Y,
    ]) {
      ctx.fillRect(
        postCentreX - postWidth / 2 - s * BRACE_COLLAR_OVERHANG,
        oy + s * collarY,
        postWidth + s * BRACE_COLLAR_OVERHANG * 2,
        s * BRACE_COLLAR_HEIGHT,
      );
    }
    ctx.fillStyle = paint(BRASS.accent);
    for (const nailY of BRACE_NAIL_YS) {
      ctx.beginPath();
      ctx.arc(postCentreX, oy + s * nailY, s * BRACE_NAIL_RADIUS, 0, TAU);
      ctx.fill();
    }
    // One bite out of the strike face per landed blow.
    const strikeEdge = postCentreX - wallDirection * (postWidth / 2);
    for (let chunk = 0; chunk < stage; chunk++) {
      const chunkY = oy + s * (BRACE_FIRST_CHUNK_Y + BRACE_CHUNK_SPACING * chunk);
      ctx.fillStyle = paint(INK);
      ctx.beginPath();
      ctx.moveTo(strikeEdge, chunkY);
      ctx.lineTo(
        strikeEdge + wallDirection * s * BRACE_CHUNK_DEPTH,
        chunkY + (s * BRACE_CHUNK_HEIGHT) / 2,
      );
      ctx.lineTo(strikeEdge, chunkY + s * BRACE_CHUNK_HEIGHT);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // The screw jack the post stands on, wound tight.
    ctx.beginPath();
    ctx.rect(
      postCentreX - (s * BRACE_JACK_WIDTH) / 2,
      jackTop,
      s * BRACE_JACK_WIDTH,
      soleY - jackTop,
    );
    ctx.fillStyle = litColumn(
      ctx,
      postCentreX - (s * BRACE_JACK_WIDTH) / 2,
      s * BRACE_JACK_WIDTH,
      IRON,
    );
    ctx.fill();
    outline(ctx, s);
    ctx.strokeStyle = paint(IRON.accent, BRACE_JACK_THREAD_ALPHA);
    ctx.lineWidth = Math.max(1, s * BRACE_JACK_THREAD_WIDTH);
    ctx.beginPath();
    for (let thread = 1; thread < BRACE_JACK_THREAD_SEGMENTS; thread++) {
      const threadY = jackTop + ((soleY - jackTop) / BRACE_JACK_THREAD_SEGMENTS) * thread;
      ctx.moveTo(postCentreX - (s * BRACE_JACK_WIDTH) / 2, threadY + s * BRACE_JACK_THREAD_SLOPE);
      ctx.lineTo(postCentreX + (s * BRACE_JACK_WIDTH) / 2, threadY - s * BRACE_JACK_THREAD_SLOPE);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(
      postCentreX - (s * BRACE_JACK_BAR) / 2,
      jackTop + s * BRACE_JACK_BAR_DROP,
      s * BRACE_JACK_BAR,
      s * BRACE_JACK_BAR_HEIGHT,
    );
    ctx.fillStyle = litColumn(
      ctx,
      postCentreX - (s * BRACE_JACK_BAR) / 2,
      s * BRACE_JACK_BAR,
      BRASS,
    );
    ctx.fill();
    outline(ctx, s);
  };
}

/** The load-bearing brace Carl breaks: a blue-banded timber on a screw jack, raked against the wall. */
export function drawStageBrace(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  state: MazeDestructibleArt,
): void {
  const stage = hitsLanded(state.integrity);
  const strength = pulseStrength(state.phase, state.pulsing);
  if (!state.broken) paintPulseHalo(ctx, x + size / 2, y + size / 2, size, strength, BRASS.accent);
  drawBigTopProp(
    ctx,
    { prop: 'stageBrace', state: `${state.facing}|${state.broken ? 'down' : stage}`, frame: 0 },
    ONE_TILE_BOX,
    bracePainter(state.facing, stage, state.broken),
    x,
    y,
    size,
  );
  if (state.broken) return;
  paintCarlChevrons(ctx, x + size / 2, y + size / 2, size, state.facing, strength);
  paintImpact(
    ctx,
    x + size / 2,
    y + size / 2,
    size,
    state.struck,
    BRACE_POST_WIDTH * BRACE_IMPACT_SCALE,
  );
}

// ── The shut ways: an iron fire screen and a boarded flat ────────────────────

const SCREEN_POST_WIDTH = 0.12;
const SCREEN_LINTEL_HEIGHT = 0.14;
const SCREEN_BARS = 5;
const SCREEN_BAR_WIDTH = 0.07;
const SCREEN_STRAPS: ReadonlyArray<number> = [0.32, 0.56, 0.8];
const SCREEN_STRAP_HEIGHT = 0.05;
const SCREEN_SPIKE_DROP = 0.07;
const SCREEN_RIVET_RADIUS = 0.018;
const SCREEN_CHAIN_LINKS = 3;
const SCREEN_SOOT_STOP = 0.7;
const SCREEN_SOOT_BLOOD_MIX = 0.5;
const SCREEN_SCORCH_GLOW_MIX = 0.3;
const SCREEN_SPIKE_TIP = 0.9;
const SCREEN_CHAIN_LINE_WIDTH = 0.02;
const SCREEN_CHAIN_TOP = 0.02;
const SCREEN_CHAIN_LINK_PITCH = 0.045;
/** Links alternate face-on and edge-on, as a real chain hangs. */
const SCREEN_CHAIN_FACE_HALF_WIDTH = 0.025;
const SCREEN_CHAIN_EDGE_HALF_WIDTH = 0.012;
const SCREEN_CHAIN_LINK_HALF_HEIGHT = 0.028;

function paintFireScreen(ctx: Ctx, ox: number, oy: number, s: number): void {
  // Soot-stained sheet behind the lattice: the heat has been at it for years.
  const back = ctx.createLinearGradient(0, oy, 0, oy + s);
  back.addColorStop(0, paint(IRON.shadow));
  back.addColorStop(SCREEN_SOOT_STOP, paint(blend(IRON.mid, BLOOD.shadow, SCREEN_SOOT_BLOOD_MIX)));
  back.addColorStop(1, paint(blend(BLOOD.mid, LIMELIGHT.shadow, SCREEN_SCORCH_GLOW_MIX)));
  ctx.fillStyle = back;
  ctx.fillRect(ox, oy, s, s);

  const inner = s * (1 - SCREEN_POST_WIDTH * 2);
  const innerLeft = ox + s * SCREEN_POST_WIDTH;
  for (let bar = 0; bar < SCREEN_BARS; bar++) {
    const barX = innerLeft + (inner / SCREEN_BARS) * (bar + 0.5) - (s * SCREEN_BAR_WIDTH) / 2;
    const barBottom = oy + s * (1 - SCREEN_SPIKE_DROP);
    ctx.beginPath();
    ctx.moveTo(barX, oy + s * SCREEN_LINTEL_HEIGHT);
    ctx.lineTo(barX + s * SCREEN_BAR_WIDTH, oy + s * SCREEN_LINTEL_HEIGHT);
    ctx.lineTo(barX + s * SCREEN_BAR_WIDTH, barBottom);
    ctx.lineTo(
      barX + (s * SCREEN_BAR_WIDTH) / 2,
      barBottom + s * SCREEN_SPIKE_DROP * SCREEN_SPIKE_TIP,
    );
    ctx.lineTo(barX, barBottom);
    ctx.closePath();
    ctx.fillStyle = litColumn(ctx, barX, s * SCREEN_BAR_WIDTH, IRON);
    ctx.fill();
    outline(ctx, s);
  }
  for (const strapY of SCREEN_STRAPS) {
    ctx.beginPath();
    ctx.rect(innerLeft, oy + s * strapY, inner, s * SCREEN_STRAP_HEIGHT);
    ctx.fillStyle = litFill(ctx, innerLeft, oy + s * strapY, inner, s * SCREEN_STRAP_HEIGHT, IRON);
    ctx.fill();
    outline(ctx, s);
    ctx.fillStyle = paint(IRON.accent);
    for (let bar = 0; bar < SCREEN_BARS; bar++) {
      ctx.beginPath();
      ctx.arc(
        innerLeft + (inner / SCREEN_BARS) * (bar + 0.5),
        oy + s * (strapY + SCREEN_STRAP_HEIGHT / 2),
        s * SCREEN_RIVET_RADIUS,
        0,
        TAU,
      );
      ctx.fill();
    }
  }
  for (const side of [0, 1]) {
    const postX = side === 0 ? ox : ox + s * (1 - SCREEN_POST_WIDTH);
    ctx.beginPath();
    ctx.rect(postX, oy, s * SCREEN_POST_WIDTH, s);
    ctx.fillStyle = litColumn(ctx, postX, s * SCREEN_POST_WIDTH, ROT_TIMBER);
    ctx.fill();
    outline(ctx, s);
  }
  ctx.beginPath();
  ctx.rect(ox, oy, s, s * SCREEN_LINTEL_HEIGHT);
  ctx.fillStyle = litFill(ctx, ox, oy, s, s * SCREEN_LINTEL_HEIGHT, ROT_TIMBER);
  ctx.fill();
  outline(ctx, s);
  // The lifting chain, up into the rigging: this is a thing that rises.
  ctx.strokeStyle = paint(IRON.accent);
  ctx.lineWidth = Math.max(1, s * SCREEN_CHAIN_LINE_WIDTH);
  for (let link = 0; link < SCREEN_CHAIN_LINKS; link++) {
    ctx.beginPath();
    ctx.ellipse(
      ox + s * 0.5,
      oy + s * (SCREEN_CHAIN_TOP + link * SCREEN_CHAIN_LINK_PITCH),
      s * (link % 2 === 0 ? SCREEN_CHAIN_FACE_HALF_WIDTH : SCREEN_CHAIN_EDGE_HALF_WIDTH),
      s * SCREEN_CHAIN_LINK_HALF_HEIGHT,
      0,
      0,
      TAU,
    );
    ctx.stroke();
  }
}

/** The iron fire screen barring a lane, portcullis-fashion: spiked bars, riveted straps, a lifting chain. */
export function drawFireScreenGate(ctx: Ctx, x: number, y: number, size: number): void {
  drawBigTopProp(
    ctx,
    { prop: 'fireScreen', state: 'shut', frame: 0 },
    ONE_TILE_BOX,
    paintFireScreen,
    x,
    y,
    size,
  );
}

const FLAT_PLANKS = 4;
const FLAT_PLANK_GAP = 0.025;
const FLAT_STRAP_WIDTH = 0.07;
const FLAT_NAIL_RADIUS = 0.022;
const FLAT_PLANK_SKEW = 0.04;
const FLAT_PLANK_TONE_JITTER = 10;
const FLAT_PLANK_TOP_LIGHT = 0.6;
const FLAT_PLANK_FOOT_SHADE = 0.4;
/** The Z strap's corners, as tile fractions. */
const FLAT_STRAP_LEFT = 0.1;
const FLAT_STRAP_RIGHT = 0.9;
const FLAT_STRAP_TOP = 0.14;
const FLAT_STRAP_BOTTOM = 0.86;
const FLAT_STRAP_HIGHLIGHT_ALPHA = 0.6;
const FLAT_STRAP_HIGHLIGHT_WIDTH = 0.015;
const FLAT_NAIL_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0.14, 0.14],
  [0.86, 0.14],
  [0.5, 0.5],
  [0.14, 0.86],
  [0.86, 0.86],
];

function paintBoardedFlat(ctx: Ctx, ox: number, oy: number, s: number): void {
  const rng = propRng('boardedFlat');
  ctx.fillStyle = paint(ROT_TIMBER.shadow);
  ctx.fillRect(ox, oy, s, s);
  const plankHeight = s / FLAT_PLANKS;
  for (let plank = 0; plank < FLAT_PLANKS; plank++) {
    const top = oy + plankHeight * plank + s * FLAT_PLANK_GAP;
    const height = plankHeight - s * FLAT_PLANK_GAP * 2;
    const skew = (rng() - 0.5) * s * FLAT_PLANK_SKEW;
    ctx.beginPath();
    ctx.moveTo(ox, top + skew);
    ctx.lineTo(ox + s, top - skew);
    ctx.lineTo(ox + s, top - skew + height);
    ctx.lineTo(ox, top + skew + height);
    ctx.closePath();
    const tone = jitterTone(ROT_TIMBER.mid, rng, FLAT_PLANK_TONE_JITTER);
    const board = ctx.createLinearGradient(0, top, 0, top + height);
    board.addColorStop(0, paint(blend(tone, ROT_TIMBER.light, FLAT_PLANK_TOP_LIGHT)));
    board.addColorStop(1, paint(blend(tone, ROT_TIMBER.shadow, FLAT_PLANK_FOOT_SHADE)));
    ctx.fillStyle = board;
    ctx.fill();
    outline(ctx, s);
  }
  // A Z of iron strapping, which is what holds a flat shut against a crowd.
  ctx.strokeStyle = paint(IRON.mid);
  ctx.lineWidth = s * FLAT_STRAP_WIDTH;
  ctx.beginPath();
  ctx.moveTo(ox + s * FLAT_STRAP_LEFT, oy + s * FLAT_STRAP_TOP);
  ctx.lineTo(ox + s * FLAT_STRAP_RIGHT, oy + s * FLAT_STRAP_TOP);
  ctx.lineTo(ox + s * FLAT_STRAP_LEFT, oy + s * FLAT_STRAP_BOTTOM);
  ctx.lineTo(ox + s * FLAT_STRAP_RIGHT, oy + s * FLAT_STRAP_BOTTOM);
  ctx.stroke();
  ctx.strokeStyle = paint(IRON.accent, FLAT_STRAP_HIGHLIGHT_ALPHA);
  ctx.lineWidth = Math.max(1, s * FLAT_STRAP_HIGHLIGHT_WIDTH);
  ctx.stroke();
  ctx.fillStyle = paint(BRASS.light);
  for (const [nx, ny] of FLAT_NAIL_SPOTS) {
    ctx.beginPath();
    ctx.arc(ox + s * nx, oy + s * ny, s * FLAT_NAIL_RADIUS, 0, TAU);
    ctx.fill();
  }
}

/** The boarded scenery flat barring a lane until Carl breaks the brace holding it. */
export function drawBoardedFlat(ctx: Ctx, x: number, y: number, size: number): void {
  drawBigTopProp(
    ctx,
    { prop: 'boardedFlat', state: 'shut', frame: 0 },
    ONE_TILE_BOX,
    paintBoardedFlat,
    x,
    y,
    size,
  );
}

// ── The pulley grate in the dividing wall ────────────────────────────────────

const PULLEY_FRAME_INSET = 0.1;
const PULLEY_BARS = 4;
const PULLEY_BAR_WIDTH = 0.05;
const PULLEY_WHEEL_RADIUS = 0.2;
const PULLEY_HUB_RADIUS = 0.055;
const PULLEY_SPOKES = 4;
const PULLEY_HANGER_WIDTH = 0.07;
const PULLEY_FRAME_LINE_WIDTH = 0.06;
/** The wheel's shadow falls down-right, away from the upper-left light. */
const PULLEY_SHADOW_OFFSET_X = 0.04;
const PULLEY_SHADOW_OFFSET_Y = 0.05;
const PULLEY_SHADOW_ALPHA = 0.5;
const PULLEY_SPOKE_WIDTH = 0.03;
/** The groove's radius and the spokes' reach, as a share of the wheel's. */
const PULLEY_GROOVE_SHARE = 0.72;
/** An eighth turn, so the spokes stand as an X rather than a cross. */
const PULLEY_SPOKE_ROTATION = TAU / 8;

function paintPulleyGrate(ctx: Ctx, ox: number, oy: number, s: number): void {
  const inset = s * PULLEY_FRAME_INSET;
  const span = s - inset * 2;
  ctx.fillStyle = paint(INK);
  ctx.fillRect(ox + inset, oy + inset, span, span);
  for (let bar = 0; bar < PULLEY_BARS; bar++) {
    const barX = ox + inset + (span / PULLEY_BARS) * (bar + 0.5) - (s * PULLEY_BAR_WIDTH) / 2;
    ctx.fillStyle = litColumn(ctx, barX, s * PULLEY_BAR_WIDTH, IRON);
    ctx.fillRect(barX, oy + inset, s * PULLEY_BAR_WIDTH, span);
  }
  ctx.beginPath();
  ctx.rect(ox + inset, oy + inset, span, span);
  ctx.lineWidth = s * PULLEY_FRAME_LINE_WIDTH;
  ctx.strokeStyle = litFill(ctx, ox, oy, s, s, IRON);
  ctx.stroke();
  outline(ctx, s);

  // The sheave the rope runs over, hung from the grate's head.
  const cx = ox + s * 0.5;
  const cy = oy + s * 0.5;
  ctx.beginPath();
  ctx.rect(
    cx - (s * PULLEY_HANGER_WIDTH) / 2,
    oy + inset,
    s * PULLEY_HANGER_WIDTH,
    cy - oy - inset,
  );
  ctx.fillStyle = litColumn(ctx, cx - (s * PULLEY_HANGER_WIDTH) / 2, s * PULLEY_HANGER_WIDTH, IRON);
  ctx.fill();
  outline(ctx, s);
  contactShadow(
    ctx,
    cx + s * PULLEY_SHADOW_OFFSET_X,
    cy + s * PULLEY_SHADOW_OFFSET_Y,
    s * PULLEY_WHEEL_RADIUS,
    s * PULLEY_WHEEL_RADIUS,
    PULLEY_SHADOW_ALPHA,
  );
  ctx.beginPath();
  ctx.arc(cx, cy, s * PULLEY_WHEEL_RADIUS, 0, TAU);
  ctx.fillStyle = litFill(
    ctx,
    cx - s * PULLEY_WHEEL_RADIUS,
    cy - s * PULLEY_WHEEL_RADIUS,
    s * PULLEY_WHEEL_RADIUS * 2,
    s * PULLEY_WHEEL_RADIUS * 2,
    BRASS,
  );
  ctx.fill();
  outline(ctx, s);
  ctx.strokeStyle = paint(BRASS.shadow);
  ctx.lineWidth = Math.max(1, s * PULLEY_SPOKE_WIDTH);
  ctx.beginPath();
  ctx.arc(cx, cy, s * PULLEY_WHEEL_RADIUS * PULLEY_GROOVE_SHARE, 0, TAU);
  for (let spoke = 0; spoke < PULLEY_SPOKES; spoke++) {
    const angle = (TAU / PULLEY_SPOKES) * spoke + PULLEY_SPOKE_ROTATION;
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(angle) * s * PULLEY_WHEEL_RADIUS * PULLEY_GROOVE_SHARE,
      cy + Math.sin(angle) * s * PULLEY_WHEEL_RADIUS * PULLEY_GROOVE_SHARE,
    );
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, s * PULLEY_HUB_RADIUS, 0, TAU);
  ctx.fillStyle = paint(BRASS.accent);
  ctx.fill();
  outline(ctx, s);
}

/**
 * The grate set in the dividing wall, with the pulley the rope runs over. It
 * never opens: a broken counterweight leaves a hole to see through, not one
 * to walk through.
 */
export function drawPulleyGrate(ctx: Ctx, x: number, y: number, size: number): void {
  drawBigTopProp(
    ctx,
    { prop: 'pulleyGrate', state: 'set', frame: 0 },
    ONE_TILE_BOX,
    paintPulleyGrate,
    x,
    y,
    size,
  );
}

// ── The rope from each target to its way ─────────────────────────────────────

const ROPE_SAG_TILES = 0.3;
const ROPE_BODY_TILES = 0.075;
const ROPE_HIGHLIGHT_TILES = 0.025;
const ROPE_SHADOW_DROP_TILES = 0.06;
const ROPE_SHADOW_ALPHA = 0.45;
const ROPE_TWIST_DASH_TILES = 0.05;
const ROPE_TWIST_GAP_TILES = 0.07;
const ROPE_TWIST_ALPHA = 0.5;
const ROPE_BLOCK_RADIUS_TILES = 0.12;
const ROPE_HIGHLIGHT_ALPHA = 0.8;
/** The ink line round a rope or hoop, in screen pixels: a pixel of outline either side at any zoom. */
const INK_OUTLINE_PX = 2;

type RopePoint = { readonly x: number; readonly y: number };

function traceRope(ctx: Ctx, points: ReadonlyArray<RopePoint>, sag: number, dropY: number): void {
  if (points.length === 0) return;
  const first = points[0];
  ctx.beginPath();
  ctx.moveTo(first.x, first.y + dropY);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    ctx.quadraticCurveTo(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2 + sag + dropY,
      to.x,
      to.y + dropY,
    );
  }
}

/**
 * A sagging rope from a target, over its pulley, to the way it lifts: a
 * shadow on the floor under it, a twisted body in the owner's colour, and a
 * highlight along its upper-left. Slack at rest and taut once pulled.
 */
export function drawShadedRope(
  ctx: Ctx,
  points: ReadonlyArray<RopePoint>,
  state: { readonly pulled: number; readonly owner: 'human' | 'cat' },
  size: number,
): void {
  if (points.length < 2) return;
  const slack = 1 - Math.max(0, Math.min(1, state.pulled));
  const sag = slack * size * ROPE_SAG_TILES;
  const ramp = state.owner === 'cat' ? GILT : BRASS;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  traceRope(ctx, points, sag, size * ROPE_SHADOW_DROP_TILES);
  ctx.strokeStyle = paint(INK, ROPE_SHADOW_ALPHA);
  ctx.lineWidth = size * ROPE_BODY_TILES;
  ctx.stroke();

  traceRope(ctx, points, sag, 0);
  ctx.strokeStyle = paint(INK);
  ctx.lineWidth = size * ROPE_BODY_TILES + INK_OUTLINE_PX;
  ctx.stroke();
  ctx.strokeStyle = paint(ramp.mid);
  ctx.lineWidth = size * ROPE_BODY_TILES;
  ctx.stroke();
  ctx.setLineDash([size * ROPE_TWIST_DASH_TILES, size * ROPE_TWIST_GAP_TILES]);
  ctx.strokeStyle = paint(ramp.shadow, ROPE_TWIST_ALPHA);
  ctx.stroke();
  ctx.setLineDash([]);
  traceRope(ctx, points, sag, -size * ROPE_HIGHLIGHT_TILES);
  ctx.strokeStyle = paint(ramp.accent, ROPE_HIGHLIGHT_ALPHA);
  ctx.lineWidth = Math.max(1, size * ROPE_HIGHLIGHT_TILES);
  ctx.stroke();

  const hub = state.owner === 'cat' ? STAGE_RED : RINGMASTER;
  for (let index = 1; index < points.length - 1; index++) {
    const block = points[index];
    ctx.beginPath();
    ctx.arc(block.x, block.y, size * ROPE_BLOCK_RADIUS_TILES, 0, TAU);
    ctx.fillStyle = paint(hub.light);
    ctx.fill();
    outline(ctx, size);
  }
  ctx.restore();
}

// ── The fire act's kit on the drapes ─────────────────────────────────────────

const HOOK_Y = 0.16;
const HOOP_CENTRE_Y = 0.52;
const HOOP_RADIUS_TILES = 0.27;
const HOOP_RING_TILES = 0.06;
const HOOP_WICKS = 7;
const HOOP_WICK_RADIUS = 0.045;
const HOOP_SOOT_ALPHA = 0.5;
const HOOP_DRAPE_SHADOW = 0.05;
const HOOP_SOOT_RISE = 0.2;
const HOOP_SOOT_RADIUS_X = 0.3;
const HOOP_SOOT_RADIUS_Y = 0.34;
const HOOP_DRAPE_SHADOW_ALPHA = 0.45;
/** The second look binds the ring in red tape. */
const HOOP_TAPE_DASH = 0.06;
const HOOP_TAPE_ALPHA = 0.8;
const HOOP_TAPE_WIDTH_SCALE = 0.6;
const HOOP_WICK_CHAR = 0.3;
const HOOK_LIGHT_HALF_WIDTH = 0.05;
const HOOK_LIGHT_WIDTH = 0.1;
const HOOK_LIGHT_HEIGHT = 0.3;
const HOOK_MIN_LINE_PX = 1.5;
const HOOK_LINE_WIDTH = 0.04;
const HOOK_SHANK_LENGTH = 0.08;
const HOOK_CURL_RADIUS = 0.04;

function fireHoopPainter(variant: number) {
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    const cx = ox + s * 0.5;
    const cy = oy + s * HOOP_CENTRE_Y;
    const radius = s * HOOP_RADIUS_TILES;
    // Soot licked up the drape above a hoop that has been lit a thousand times.
    contactShadow(
      ctx,
      cx,
      cy - s * HOOP_SOOT_RISE,
      s * HOOP_SOOT_RADIUS_X,
      s * HOOP_SOOT_RADIUS_Y,
      HOOP_SOOT_ALPHA,
    );
    ctx.strokeStyle = paint(INK, HOOP_DRAPE_SHADOW_ALPHA);
    ctx.lineWidth = s * HOOP_RING_TILES;
    ctx.beginPath();
    ctx.arc(cx + s * HOOP_DRAPE_SHADOW, cy + s * HOOP_DRAPE_SHADOW, radius, 0, TAU);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.strokeStyle = paint(INK);
    ctx.lineWidth = s * HOOP_RING_TILES + INK_OUTLINE_PX;
    ctx.stroke();
    ctx.strokeStyle = litFill(ctx, cx - radius, cy - radius, radius * 2, radius * 2, IRON);
    ctx.lineWidth = s * HOOP_RING_TILES;
    ctx.stroke();
    if (variant % 2 === 1) {
      ctx.setLineDash([s * HOOP_TAPE_DASH, s * HOOP_TAPE_DASH]);
      ctx.strokeStyle = paint(STAGE_RED.mid, HOOP_TAPE_ALPHA);
      ctx.lineWidth = s * HOOP_RING_TILES * HOOP_TAPE_WIDTH_SCALE;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Rag wicks bound round the rim, charred black.
    for (let wick = 0; wick < HOOP_WICKS; wick++) {
      const angle = (TAU / HOOP_WICKS) * wick + variant;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
        s * HOOP_WICK_RADIUS,
        0,
        TAU,
      );
      ctx.fillStyle = paint(blend(BACKSTAGE_WICK, BLOOD.shadow, HOOP_WICK_CHAR));
      ctx.fill();
      outline(ctx, s);
    }
    // The hook, and the hoop hung off it.
    ctx.strokeStyle = litFill(
      ctx,
      cx - s * HOOK_LIGHT_HALF_WIDTH,
      oy,
      s * HOOK_LIGHT_WIDTH,
      s * HOOK_LIGHT_HEIGHT,
      IRON,
    );
    ctx.lineWidth = Math.max(HOOK_MIN_LINE_PX, s * HOOK_LINE_WIDTH);
    ctx.beginPath();
    ctx.moveTo(cx, oy + s * (HOOK_Y - HOOK_SHANK_LENGTH));
    ctx.lineTo(cx, oy + s * HOOK_Y);
    ctx.arc(cx + s * HOOK_CURL_RADIUS, oy + s * HOOK_Y, s * HOOK_CURL_RADIUS, Math.PI, 0, true);
    ctx.stroke();
  };
}
const BACKSTAGE_WICK: RGB = [30, 24, 22];

const CAN_FOOT_Y = 0.9;
const CAN_WIDTH = 0.34;
const CAN_HEIGHT = 0.42;
const TIN_WIDTH = 0.22;
const TIN_HEIGHT = 0.26;
/** Where the can and the tin stand either side of the tile's centre; a variant mirrors them. */
const CAN_OFFSET_X = 0.12;
const TIN_OFFSET_X = 0.2;
const CANS_SHADOW_X = 0.52;
const CANS_SHADOW_RADIUS_X = 0.42;
const CANS_SHADOW_RADIUS_Y = 0.05;
/** The jerry can's pressed cross, label, flame, handle and spout, as tile fractions from its top-left. */
const JERRY_CAN = {
  cornerRadius: 0.04,
  crossLineWidth: 0.02,
  crossInsetX: 0.03,
  crossTop: 0.1,
  crossFootInset: 0.05,
  labelHalfWidth: 0.08,
  labelTop: 0.14,
  labelWidth: 0.16,
  labelHeight: 0.14,
  flameTop: 0.16,
  flameBulgeX: 0.06,
  flameBulgeY: 0.24,
  flameFoot: 0.27,
  fittingLineWidth: 0.035,
  handleFrontX: 0.06,
  handleFrontTopX: 0.08,
  handleBackTopX: 0.2,
  handleBackX: 0.22,
  handleRise: 0.06,
  spoutRootInset: 0.06,
  spoutReach: 0.02,
  spoutRise: 0.08,
} as const;
const TIN_LID_RADIUS_Y = 0.035;
const TIN_LABEL_ALPHA = 0.7;
const TIN_LABEL_TOP = 0.1;
const TIN_LABEL_HEIGHT = 0.06;

function fuelCansPainter(variant: number) {
  return (ctx: Ctx, ox: number, oy: number, s: number): void => {
    const footY = oy + s * CAN_FOOT_Y;
    const flip = variant % 2 === 0 ? 1 : -1;
    const canX = ox + s * (0.5 - flip * CAN_OFFSET_X);
    const tinX = ox + s * (0.5 + flip * TIN_OFFSET_X);
    contactShadow(
      ctx,
      ox + s * CANS_SHADOW_X,
      footY,
      s * CANS_SHADOW_RADIUS_X,
      s * CANS_SHADOW_RADIUS_Y,
    );

    // The jerry can: dried-blood red with a bone label and a flame on it.
    const canLeft = canX - (s * CAN_WIDTH) / 2;
    const canTop = footY - s * CAN_HEIGHT;
    ctx.beginPath();
    ctx.roundRect(canLeft, canTop, s * CAN_WIDTH, s * CAN_HEIGHT, s * JERRY_CAN.cornerRadius);
    ctx.fillStyle = litFill(ctx, canLeft, canTop, s * CAN_WIDTH, s * CAN_HEIGHT, BLOOD);
    ctx.fill();
    outline(ctx, s);
    ctx.strokeStyle = paint(BLOOD.shadow);
    ctx.lineWidth = Math.max(1, s * JERRY_CAN.crossLineWidth);
    ctx.beginPath();
    const crossTop = canTop + s * JERRY_CAN.crossTop;
    const crossFoot = canTop + s * CAN_HEIGHT - s * JERRY_CAN.crossFootInset;
    ctx.moveTo(canLeft + s * JERRY_CAN.crossInsetX, crossTop);
    ctx.lineTo(canLeft + s * CAN_WIDTH - s * JERRY_CAN.crossInsetX, crossFoot);
    ctx.moveTo(canLeft + s * CAN_WIDTH - s * JERRY_CAN.crossInsetX, crossTop);
    ctx.lineTo(canLeft + s * JERRY_CAN.crossInsetX, crossFoot);
    ctx.stroke();
    ctx.fillStyle = paint(BONE.light);
    ctx.fillRect(
      canX - s * JERRY_CAN.labelHalfWidth,
      canTop + s * JERRY_CAN.labelTop,
      s * JERRY_CAN.labelWidth,
      s * JERRY_CAN.labelHeight,
    );
    ctx.fillStyle = paint(LIMELIGHT.shadow);
    ctx.beginPath();
    const flameTop = canTop + s * JERRY_CAN.flameTop;
    const flameBulgeY = canTop + s * JERRY_CAN.flameBulgeY;
    ctx.moveTo(canX, flameTop);
    ctx.quadraticCurveTo(
      canX + s * JERRY_CAN.flameBulgeX,
      flameBulgeY,
      canX,
      canTop + s * JERRY_CAN.flameFoot,
    );
    ctx.quadraticCurveTo(canX - s * JERRY_CAN.flameBulgeX, flameBulgeY, canX, flameTop);
    ctx.fill();
    // Handle and spout.
    ctx.strokeStyle = paint(IRON.light);
    ctx.lineWidth = Math.max(1, s * JERRY_CAN.fittingLineWidth);
    ctx.beginPath();
    const handleTop = canTop - s * JERRY_CAN.handleRise;
    ctx.moveTo(canLeft + s * JERRY_CAN.handleFrontX, canTop);
    ctx.lineTo(canLeft + s * JERRY_CAN.handleFrontTopX, handleTop);
    ctx.lineTo(canLeft + s * JERRY_CAN.handleBackTopX, handleTop);
    ctx.lineTo(canLeft + s * JERRY_CAN.handleBackX, canTop);
    ctx.moveTo(canLeft + s * CAN_WIDTH - s * JERRY_CAN.spoutRootInset, canTop);
    ctx.lineTo(
      canLeft + s * CAN_WIDTH + s * JERRY_CAN.spoutReach,
      canTop - s * JERRY_CAN.spoutRise,
    );
    ctx.stroke();

    // A squat paraffin tin beside it.
    const tinLeft = tinX - (s * TIN_WIDTH) / 2;
    const tinTop = footY - s * TIN_HEIGHT;
    ctx.beginPath();
    ctx.rect(tinLeft, tinTop, s * TIN_WIDTH, s * TIN_HEIGHT);
    ctx.fillStyle = litColumn(ctx, tinLeft, s * TIN_WIDTH, BRASS);
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.ellipse(tinX, tinTop, (s * TIN_WIDTH) / 2, s * TIN_LID_RADIUS_Y, 0, 0, TAU);
    ctx.fillStyle = paint(BRASS.accent);
    ctx.fill();
    outline(ctx, s);
    ctx.fillStyle = paint(STRAW.light, TIN_LABEL_ALPHA);
    ctx.fillRect(tinLeft, tinTop + s * TIN_LABEL_TOP, s * TIN_WIDTH, s * TIN_LABEL_HEIGHT);
  };
}

const POSTER_LEFT = 0.16;
const POSTER_TOP = 0.1;
const POSTER_WIDTH = 0.68;
const POSTER_HEIGHT = 0.7;
const POSTER_TILT = 0.06;
const POSTER_BORDER = 0.05;
const POSTER_HEADLINE_HEIGHT = 0.12;
const POSTER_FIRE_HEIGHT = 0.17;
const POSTER_TACK_RADIUS = 0.025;
const POSTER_SHADOW_ALPHA = 0.35;
const POSTER_SHADOW_OFFSET_X = 0.03;
const POSTER_SHADOW_OFFSET_Y = 0.04;
/** The bottom-right corner has curled away, cutting this much off each edge. */
const POSTER_CURL_RISE = 0.08;
const POSTER_CURL_RUN = 0.1;
const POSTER_PAPER_AGEING = 0.3;
const POSTER_BORDER_LINE_SCALE = 0.6;
/** The inner border stops short of the curled corner. */
const POSTER_BORDER_FOOT_GAP = 0.04;
const POSTER_HEADLINE_TOP = 0.1;
const POSTER_HEADLINE_WIDTH = 0.8;
const POSTER_DASH_TOP = 0.25;
const POSTER_DASH_HEIGHT = 0.08;
const POSTER_DASH_WIDTH = 0.3;
const POSTER_FIRE_TOP = 0.36;
const POSTER_FIRE_WIDTH = 0.75;
const POSTER_FLAME_FOOT_INSET = 0.1;
const POSTER_FLAME_HEIGHT = 0.14;
const POSTER_FLAME_BULGE_X = 0.09;
const POSTER_FLAME_BULGE_RISE = 0.04;
const POSTER_TACK_LEFT_INSET = 0.04;
const POSTER_TACK_RIGHT_INSET = 0.02;
const POSTER_TACK_DROP = 0.03;

function paintDangerPoster(ctx: Ctx, ox: number, oy: number, s: number): void {
  const left = ox + s * POSTER_LEFT;
  const top = oy + s * POSTER_TOP;
  const width = s * POSTER_WIDTH;
  const height = s * POSTER_HEIGHT;
  const cx = left + width / 2;
  ctx.save();
  ctx.translate(cx, top + height / 2);
  ctx.rotate(POSTER_TILT);
  ctx.translate(-cx, -(top + height / 2));

  ctx.fillStyle = paint(INK, POSTER_SHADOW_ALPHA);
  ctx.fillRect(left + s * POSTER_SHADOW_OFFSET_X, top + s * POSTER_SHADOW_OFFSET_Y, width, height);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + width, top);
  ctx.lineTo(left + width, top + height - s * POSTER_CURL_RISE);
  ctx.lineTo(left + width - s * POSTER_CURL_RUN, top + height);
  ctx.lineTo(left, top + height);
  ctx.closePath();
  const paper = ctx.createLinearGradient(left, top, left + width, top + height);
  paper.addColorStop(0, paint(BONE.accent));
  paper.addColorStop(1, paint(blend(BONE.mid, STRAW.mid, POSTER_PAPER_AGEING)));
  ctx.fillStyle = paper;
  ctx.fill();
  outline(ctx, s);
  ctx.strokeStyle = paint(STAGE_RED.mid);
  ctx.lineWidth = s * POSTER_BORDER * POSTER_BORDER_LINE_SCALE;
  ctx.strokeRect(
    left + s * POSTER_BORDER,
    top + s * POSTER_BORDER,
    width - s * POSTER_BORDER * 2,
    height - s * POSTER_BORDER * 2 - s * POSTER_BORDER_FOOT_GAP,
  );

  paintLegend(
    ctx,
    'DANGER',
    cx,
    top + s * POSTER_HEADLINE_TOP,
    s * POSTER_HEADLINE_HEIGHT,
    width * POSTER_HEADLINE_WIDTH,
    INK,
    s,
    'posterDanger',
  );
  paintLegend(
    ctx,
    '—',
    cx,
    top + s * POSTER_DASH_TOP,
    s * POSTER_DASH_HEIGHT,
    width * POSTER_DASH_WIDTH,
    STAGE_RED.shadow,
    s,
    'posterDash',
  );
  paintLegend(
    ctx,
    'FIRE',
    cx,
    top + s * POSTER_FIRE_TOP,
    s * POSTER_FIRE_HEIGHT,
    width * POSTER_FIRE_WIDTH,
    STAGE_RED.mid,
    s,
    'posterFire',
  );
  // The flame pictogram under the words.
  const flameBase = top + height - s * POSTER_FLAME_FOOT_INSET;
  const flameTip = flameBase - s * POSTER_FLAME_HEIGHT;
  const flameBulgeY = flameBase - s * POSTER_FLAME_BULGE_RISE;
  ctx.fillStyle = paint(LIMELIGHT.shadow);
  ctx.beginPath();
  ctx.moveTo(cx, flameTip);
  ctx.quadraticCurveTo(cx + s * POSTER_FLAME_BULGE_X, flameBulgeY, cx, flameBase);
  ctx.quadraticCurveTo(cx - s * POSTER_FLAME_BULGE_X, flameBulgeY, cx, flameTip);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = paint(BRASS.accent);
  for (const tackX of [
    left + s * POSTER_TACK_LEFT_INSET,
    left + width - s * POSTER_TACK_RIGHT_INSET,
  ]) {
    ctx.beginPath();
    ctx.arc(tackX, top + s * POSTER_TACK_DROP, s * POSTER_TACK_RADIUS, 0, TAU);
    ctx.fill();
    outline(ctx, s);
  }
}

/** Wall dressing the fire act hangs on its drapes. */
export type FireWalkWallKit = 'fireHoop' | 'fuelCans' | 'dangerPoster';
export const FIRE_WALK_WALL_KITS: ReadonlyArray<FireWalkWallKit> = [
  'fireHoop',
  'dangerPoster',
  'fuelCans',
];

/** How many looks each wall kit has; a seed picks one. */
const WALL_KIT_VARIANTS = 2;

/** One piece of the fire act's kit, hung on the drape face of a wall tile. */
export function drawFireWalkWallKit(
  ctx: Ctx,
  kit: FireWalkWallKit,
  x: number,
  y: number,
  size: number,
  seed: number,
): void {
  const variant = ((seed % WALL_KIT_VARIANTS) + WALL_KIT_VARIANTS) % WALL_KIT_VARIANTS;
  const box: BigTopPropBox = ONE_TILE_BOX;
  switch (kit) {
    case 'fireHoop':
      drawBigTopProp(
        ctx,
        { prop: kit, state: 'hung', frame: variant },
        box,
        fireHoopPainter(variant),
        x,
        y,
        size,
      );
      return;
    case 'fuelCans':
      drawBigTopProp(
        ctx,
        { prop: kit, state: 'stood', frame: variant },
        box,
        fuelCansPainter(variant),
        x,
        y,
        size,
      );
      return;
    case 'dangerPoster':
      drawBigTopProp(
        ctx,
        { prop: kit, state: 'pinned', frame: 0 },
        box,
        paintDangerPoster,
        x,
        y,
        size,
      );
      return;
  }
}

/**
 * Every baked picture this module can ask the cache for, so the art gate can
 * paint each one on its own and hold it to the strict canvas and its cell.
 */
export function fireWalkPropCatalogue(): ReadonlyArray<BigTopPropCatalogueEntry> {
  const entries: BigTopPropCatalogueEntry[] = [
    {
      key: { prop: 'fireGrate', state: 'cold', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintFireGrate,
    },
    {
      key: { prop: 'fireScreen', state: 'shut', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintFireScreen,
      openEdges: EVERY_EDGE,
    },
    {
      key: { prop: 'boardedFlat', state: 'shut', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintBoardedFlat,
      openEdges: EVERY_EDGE,
    },
    {
      key: { prop: 'pulleyGrate', state: 'set', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintPulleyGrate,
    },
    {
      key: { prop: 'dangerPoster', state: 'pinned', frame: 0 },
      box: ONE_TILE_BOX,
      painter: paintDangerPoster,
    },
  ];
  for (let level = 1; level <= KINDLE_STEPS; level++) {
    entries.push({
      key: { prop: 'fireGrateKindle', state: 'warm', frame: level },
      box: ONE_TILE_BOX,
      painter: kindlePainter(level),
    });
  }
  const run: FireGrateRun = { tileY: 0, x0: 0, columns: [0, 1, 3] };
  entries.push({
    key: { prop: 'fireGrateRun', state: 'sample', frame: 0 },
    box: grateRunBox(run),
    painter: grateRunPainter(run),
  });
  // The counterweight's rope runs off the top of its tile, up into the rigging.
  const ropeEdge: ReadonlyArray<'top'> = ['top'];
  for (const facing of ['west', 'east'] as const) {
    for (let frame = 0; frame < SANDBAG_SWAY_FRAMES; frame++) {
      entries.push({
        key: { prop: 'sandbag', state: `${facing}|whole`, frame },
        box: ONE_TILE_BOX,
        painter: sandbagPainter(facing, false, frame),
        openEdges: ropeEdge,
      });
    }
    entries.push({
      key: { prop: 'sandbag', state: `${facing}|burst`, frame: 0 },
      box: ONE_TILE_BOX,
      painter: sandbagPainter(facing, true, 0),
      openEdges: ropeEdge,
    });
    for (let stage = 0; stage < DAMAGE_STAGE_COUNT; stage++) {
      entries.push({
        key: { prop: 'stageBrace', state: `${facing}|${stage}`, frame: 0 },
        box: ONE_TILE_BOX,
        painter: bracePainter(facing, stage, false),
      });
    }
    entries.push({
      key: { prop: 'stageBrace', state: `${facing}|down`, frame: 0 },
      box: ONE_TILE_BOX,
      painter: bracePainter(facing, 0, true),
    });
  }
  for (let variant = 0; variant < WALL_KIT_VARIANTS; variant++) {
    entries.push({
      key: { prop: 'fireHoop', state: 'hung', frame: variant },
      box: ONE_TILE_BOX,
      painter: fireHoopPainter(variant),
    });
    entries.push({
      key: { prop: 'fuelCans', state: 'stood', frame: variant },
      box: ONE_TILE_BOX,
      painter: fuelCansPainter(variant),
    });
  }
  return entries;
}
