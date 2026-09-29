/**
 * The interval rooms between acts: the velvet drape over each arch and its
 * rise, the stage manager's peep window between the paired rooms, and the
 * painted easel naming the act behind the drapes.
 *
 * The drape's folds are painted strip by strip and each strip is shaded as a
 * plane (`shadePlane`): the side of a fold that turns toward the stage light
 * up and left is lit, the side that turns away falls into shade, and the
 * crease between them is where the velvet is darkest.
 */

import {
  allocReadableCanvas,
  surfaceContext,
  type CanvasSurface,
} from '../../../core/canvasSurface';
import { shadePlane } from '../../buildinggen/lighting';
import type { Plane } from '../../buildinggen/projection';
import { drawRadialGlow, type GlowStop } from '../../radialGlow';
import { hashUnit } from '../../flameStamps';
import { mulberry32 } from '../../person/rng';
import type { BrushPigment } from '../brushStroke';
import { paintWord, wordWidth } from '../circusLettering';
import type { RGB } from '../town/townPalette';
import { paintWayChevrons, paintWayFlare, type MazeWayOpenArt } from '../../bigTopMazeProps';
import {
  drawBigTopProp,
  EVERY_EDGE,
  ONE_TILE_BOX,
  type BigTopPropBox,
  type BigTopPropCatalogueEntry,
} from './bigTopPropCache';
import {
  BACKSTAGE,
  BLOOD,
  BONE,
  BRASS,
  FULL_TURN,
  GILT_GLINT,
  IRON,
  LIMELIGHT,
  ROT_TIMBER,
  STRAW,
  inkCurrentPath,
  loopFrame,
  outlineWidth,
  paintContactShadow,
  quantise,
  rgba,
} from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

// ── The drape ───────────────────────────────────────────────────────────────

const FOLDS = 5;
/** The share of each fold that turns toward the stage light. */
const FOLD_LIT_SHARE = 0.55;
/** Plane shading of a fold's two faces, and of the velvet deep in a crease. */
const FOLD_LIT_SHADE = 1.22;
const FOLD_TURNED_SHADE = 0.6;
const CREASE_ALPHA = 0.55;
const CREASE_WIDTH = 0.05;
const VELVET_TOP: RGB = [138, 34, 42];
const VELVET_BOTTOM: RGB = [78, 14, 22];
const NAP_STREAKS = 7;
const NAP_ALPHA = 0.08;
const NAP_WIDTH = 0.012;
/** The nap never thins below half a pixel, or it vanishes on a small bake. */
const NAP_MIN_WIDTH_PX = 0.5;

const VALANCE_HEIGHT = 0.2;
const FRINGE_BAND = 0.055;
const FRINGE_LENGTH = 0.075;
const FRINGE_SPACING = 0.04;
const FRINGE_THREAD_WIDTH = 0.018;
/** Each fringe thread is between this share of full length and full length. */
const FRINGE_MIN_LENGTH_SHARE = 0.75;
const FRINGE_LENGTH_VARIATION = 0.25;
/** The top of the fringe band catches the light across this share of its depth. */
const FRINGE_GLINT_SHARE = 0.3;
/** The pelmet's swags dip below its straight edge by this share of its depth. */
const VALANCE_SWAG_DIP = 1.35;
/** How far the hem of a fold scallops up between its lowest points. */
const HEM_SCALLOP = 0.06;
/** A fold's hem bellies down past its lowest points by this share of the scallop. */
const HEM_BELLY = 0.3;
const HEM_DUST_SHARE = 0.14;
const HEM_DUST_ALPHA = 0.3;
const HEM_AO_ALPHA = 0.5;

const SWAY_FRAMES = 4;
const SWAY_PERIOD_FRAMES = 150;
const SWAY_REACH = 0.035;
/** Each fold swings this far behind its neighbour, in radians, so the drape ripples. */
const SWAY_FOLD_STAGGER = 0.9;

const TIEBACK_X = 0.9;
const TIEBACK_TOP = 0.28;
const TIEBACK_BOTTOM = 0.66;
const TIEBACK_WIDTH = 0.04;
const TASSEL_LENGTH = 0.1;
const TASSEL_WIDTH = 0.06;
/** A gathered tie-back bows this far in across the drape, and its foot ends a little in from the hook, in tiles. */
const TIEBACK_GATHER_PULL = 0.2;
const TIEBACK_GATHER_FOOT = 0.02;
/** A waiting tie-back hangs with a slight outward bow, in tiles. */
const TIEBACK_HANG_BOW = 0.04;
/** The cord's twist: a dashed darker line this share of the cord's width, dashes this long in tiles. */
const TIEBACK_TWIST_SHARE = 0.35;
const TIEBACK_TWIST_DASH = 0.03;
const TIEBACK_HOOK_RADIUS = 0.03;

/** Hem height of the drape at each rise step: lifting, then bunched under the valance. */
const RISE_STEPS = 6;
const RISEN_HEM = 0.42;
/** The bunched drape gathers into swags this deep. */
const SWAG_DEPTH = 0.06;
/** Swag lines across the drape once it has fully risen. */
const RISEN_SWAGS = 2;

let foldScratch: CanvasSurface | null = null;

function scratchFor(size: number): { surface: CanvasSurface; ctx: Ctx } {
  const pixels = Math.max(1, Math.ceil(size));
  const cached = foldScratch;
  if (cached !== null && cached.width === pixels && cached.height === pixels) {
    return { surface: cached, ctx: surfaceContext(cached) };
  }
  const surface = allocReadableCanvas(pixels, pixels);
  foldScratch = surface;
  return { surface, ctx: surfaceContext(surface) };
}

interface DrapeShape {
  /** Top of the folds, under the valance. */
  readonly top: number;
  /** The hem's lowest points. */
  readonly hem: number;
  /** Per fold, how far its hem has swung sideways. */
  readonly sway: ReadonlyArray<number>;
  /** Swag lines across a bunched drape, 0 for a hanging one. */
  readonly swags: number;
}

function traceFoldStrip(
  ctx: Ctx,
  originX: number,
  size: number,
  shape: DrapeShape,
  fold: number,
  from: number,
  to: number,
): void {
  const width = size / FOLDS;
  const left = originX + width * (fold + from);
  const right = originX + width * (fold + to);
  const sway = shape.sway[fold] ?? 0;
  const scallop = HEM_SCALLOP * size;
  // The fold's lowest point is its middle; its edges ride up into the scallop.
  const edgeRise = (t: number): number => scallop * (1 - Math.sin(t * Math.PI));
  ctx.beginPath();
  ctx.moveTo(left, shape.top);
  ctx.lineTo(right, shape.top);
  ctx.lineTo(right + sway, shape.hem - edgeRise(to));
  const middle = (from + to) / 2;
  ctx.quadraticCurveTo(
    originX + width * (fold + middle) + sway,
    shape.hem - edgeRise(middle) + scallop * HEM_BELLY,
    left + sway,
    shape.hem - edgeRise(from),
  );
  ctx.closePath();
}

function paintDrape(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  shape: DrapeShape,
): void {
  const { surface, ctx: scratch } = scratchFor(size);
  const plane: Plane = {
    canvas: surface,
    ctx: scratch,
    width: surface.width,
    height: surface.height,
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: surface.width, y: 0 },
      br: { x: surface.width, y: surface.height },
      bl: { x: 0, y: surface.height },
    },
  };
  const velvet = (target: Ctx): void => {
    const fill = target.createLinearGradient(0, shape.top - originY, 0, shape.hem - originY);
    fill.addColorStop(0, rgba(VELVET_TOP, 1));
    fill.addColorStop(1, rgba(VELVET_BOTTOM, 1));
    target.fillStyle = fill;
  };
  for (let fold = 0; fold < FOLDS; fold++) {
    for (const [from, to, factor] of [
      [0, FOLD_LIT_SHARE, FOLD_LIT_SHADE],
      [FOLD_LIT_SHARE, 1, FOLD_TURNED_SHADE],
    ] as const) {
      scratch.save();
      try {
        scratch.setTransform(1, 0, 0, 1, 0, 0);
        scratch.clearRect(0, 0, surface.width, surface.height);
        scratch.scale(surface.width / size, surface.height / size);
        traceFoldStrip(
          scratch,
          0,
          size,
          { ...shape, top: shape.top - originY, hem: shape.hem - originY },
          fold,
          from,
          to,
        );
        velvet(scratch);
        scratch.fill();
        // The nap: faint vertical streaks down the pile.
        scratch.clip();
        scratch.strokeStyle = rgba(BONE.light, NAP_ALPHA);
        scratch.lineWidth = Math.max(NAP_MIN_WIDTH_PX, size * NAP_WIDTH);
        for (let streak = 0; streak < NAP_STREAKS; streak++) {
          const at =
            (size / FOLDS) *
            (fold + from + (to - from) * hashUnit(fold * NAP_STREAKS + streak, factor));
          scratch.beginPath();
          scratch.moveTo(at, shape.top - originY);
          scratch.lineTo(at + (shape.sway[fold] ?? 0), shape.hem - originY);
          scratch.stroke();
        }
      } finally {
        scratch.restore();
      }
      shadePlane(plane, factor);
      ctx.drawImage(surface, 0, 0, surface.width, surface.height, originX, originY, size, size);
    }
  }

  // The creases where one fold turns under the next.
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, CREASE_ALPHA);
  ctx.lineWidth = CREASE_WIDTH * size;
  ctx.lineCap = 'round';
  for (let fold = 1; fold < FOLDS; fold++) {
    const x = originX + (size / FOLDS) * fold;
    const sway = shape.sway[fold - 1] ?? 0;
    ctx.beginPath();
    ctx.moveTo(x, shape.top);
    ctx.lineTo(x + sway, shape.hem - HEM_SCALLOP * size);
    ctx.stroke();
  }

  // Bunched velvet gathers into swags across the drape.
  for (let swag = 1; swag <= shape.swags; swag++) {
    const y = shape.top + ((shape.hem - shape.top) * swag) / (shape.swags + 1);
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, CREASE_ALPHA);
    ctx.lineWidth = CREASE_WIDTH * size;
    ctx.beginPath();
    for (let fold = 0; fold < FOLDS; fold++) {
      const left = originX + (size / FOLDS) * fold;
      if (fold === 0) ctx.moveTo(left, y);
      ctx.quadraticCurveTo(left + size / FOLDS / 2, y + SWAG_DEPTH * size, left + size / FOLDS, y);
    }
    ctx.stroke();
  }

  // Sawdust dusted up the hem, and the shade where it meets the floor.
  ctx.save();
  try {
    ctx.beginPath();
    for (let fold = 0; fold < FOLDS; fold++) traceFoldStrip(ctx, originX, size, shape, fold, 0, 1);
    ctx.clip();
    const hemTop = shape.hem - (shape.hem - shape.top) * HEM_DUST_SHARE - HEM_SCALLOP * size;
    const dust = ctx.createLinearGradient(0, hemTop, 0, shape.hem);
    dust.addColorStop(0, rgba(STRAW.light, 0));
    dust.addColorStop(1, rgba(STRAW.light, HEM_DUST_ALPHA));
    ctx.fillStyle = dust;
    ctx.fillRect(originX, hemTop, size, shape.hem - hemTop);
    const ao = ctx.createLinearGradient(0, shape.top, 0, shape.top + size * VALANCE_HEIGHT);
    ao.addColorStop(0, rgba(BACKSTAGE.shadow, HEM_AO_ALPHA));
    ao.addColorStop(1, rgba(BACKSTAGE.shadow, 0));
    ctx.fillStyle = ao;
    ctx.fillRect(originX, shape.top, size, size * VALANCE_HEIGHT);
  } finally {
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(originX, shape.top);
  ctx.lineTo(originX + size, shape.top);
  ctx.lineTo(originX + size + (shape.sway[FOLDS - 1] ?? 0), shape.hem - HEM_SCALLOP * size);
  ctx.lineTo(originX + (shape.sway[0] ?? 0), shape.hem - HEM_SCALLOP * size);
  ctx.closePath();
  inkCurrentPath(ctx, size);
}

/** The pelmet: a gold band along the top of the arch, its fringe hanging over the drape. */
function paintValance(ctx: Ctx, originX: number, originY: number, size: number): void {
  const top = originY;
  const valance = VALANCE_HEIGHT * size;
  const cloth = ctx.createLinearGradient(0, top, 0, top + valance);
  cloth.addColorStop(0, rgba(BLOOD.light, 1));
  cloth.addColorStop(1, rgba(BLOOD.shadow, 1));
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(originX, top);
  ctx.lineTo(originX + size, top);
  ctx.lineTo(originX + size, top + valance);
  for (let swag = FOLDS; swag > 0; swag--) {
    const right = originX + (size / FOLDS) * swag;
    const left = right - size / FOLDS;
    ctx.quadraticCurveTo((left + right) / 2, top + valance * VALANCE_SWAG_DIP, left, top + valance);
  }
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);
  const band = FRINGE_BAND * size;
  ctx.fillStyle = rgba(BRASS.light, 1);
  ctx.fillRect(originX, top + valance - band, size, band);
  ctx.fillStyle = rgba(GILT_GLINT, 1);
  ctx.fillRect(originX, top + valance - band, size, Math.max(1, band * FRINGE_GLINT_SHARE));
  ctx.strokeStyle = rgba(BRASS.accent, 1);
  ctx.lineWidth = Math.max(1, size * FRINGE_THREAD_WIDTH);
  for (
    let x = originX + FRINGE_SPACING * size * 0.5;
    x < originX + size;
    x += FRINGE_SPACING * size
  ) {
    const length =
      FRINGE_LENGTH *
      size *
      (FRINGE_MIN_LENGTH_SHARE + FRINGE_LENGTH_VARIATION * hashUnit(x, size));
    ctx.beginPath();
    ctx.moveTo(x, top + valance);
    ctx.lineTo(x, top + valance + length);
    ctx.stroke();
  }
}

function paintTieback(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  gathered: boolean,
): void {
  const x = originX + TIEBACK_X * size;
  const top = originY + TIEBACK_TOP * size;
  const bottom = originY + TIEBACK_BOTTOM * size;
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
  ctx.lineWidth = TIEBACK_WIDTH * size + outlineWidth(size) * 2;
  ctx.lineCap = 'round';
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    if (gathered)
      ctx.quadraticCurveTo(
        x - size * TIEBACK_GATHER_PULL,
        (top + bottom) / 2,
        x - size * TIEBACK_GATHER_FOOT,
        bottom,
      );
    else ctx.quadraticCurveTo(x + size * TIEBACK_HANG_BOW, (top + bottom) / 2, x, bottom);
  };
  trace();
  ctx.stroke();
  ctx.strokeStyle = rgba(BRASS.light, 1);
  ctx.lineWidth = TIEBACK_WIDTH * size;
  trace();
  ctx.stroke();
  ctx.strokeStyle = rgba(BRASS.shadow, 1);
  ctx.lineWidth = Math.max(1, TIEBACK_WIDTH * size * TIEBACK_TWIST_SHARE);
  ctx.setLineDash([size * TIEBACK_TWIST_DASH, size * TIEBACK_TWIST_DASH]);
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
  const tasselX = gathered ? x - size * TIEBACK_GATHER_FOOT : x;
  ctx.fillStyle = rgba(BRASS.mid, 1);
  ctx.beginPath();
  ctx.moveTo(tasselX, bottom);
  ctx.lineTo(tasselX + (TASSEL_WIDTH * size) / 2, bottom + TASSEL_LENGTH * size);
  ctx.lineTo(tasselX - (TASSEL_WIDTH * size) / 2, bottom + TASSEL_LENGTH * size);
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);
  ctx.fillStyle = rgba(IRON.mid, 1);
  ctx.beginPath();
  ctx.arc(x, top, size * TIEBACK_HOOK_RADIUS, 0, FULL_TURN);
  ctx.fill();
}

function hangingDrape(originY: number, size: number, frame: number): DrapeShape {
  const cycle = (frame / SWAY_FRAMES) * FULL_TURN;
  return {
    top: originY + VALANCE_HEIGHT * size,
    hem: originY + size,
    sway: Array.from(
      { length: FOLDS },
      (_, fold) => Math.sin(cycle + fold * SWAY_FOLD_STAGGER) * SWAY_REACH * size,
    ),
    swags: 0,
  };
}

function paintClosedCurtain(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  frame: number,
): void {
  paintDrape(ctx, originX, originY, size, hangingDrape(originY, size, frame));
  paintValance(ctx, originX, originY, size);
  paintTieback(ctx, originX, originY, size, false);
}

/** The velvet drape between acts: heavy folds, a gold-fringed pelmet, a tie-back waiting on its hook. */
export function drawMazeCurtain(ctx: Ctx, x: number, y: number, size: number, phase: number): void {
  const entry = closedCurtainEntry(loopFrame(phase, SWAY_PERIOD_FRAMES, SWAY_FRAMES));
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
}

/** The drape fills its doorway edge to edge, hung and risen alike. */
function closedCurtainEntry(frame: number): BigTopPropCatalogueEntry {
  return {
    key: { prop: 'velvetCurtain', state: 'down', frame },
    box: ONE_TILE_BOX,
    painter: (target, originX, originY, px) =>
      paintClosedCurtain(target, originX, originY, px, frame),
    openEdges: EVERY_EDGE,
  };
}

function risingCurtainEntry(step: number): BigTopPropCatalogueEntry {
  return {
    key: { prop: 'velvetCurtain', state: 'rise', frame: step },
    box: ONE_TILE_BOX,
    painter: (target, originX, originY, px) =>
      paintRisingCurtain(target, originX, originY, px, step),
    openEdges: EVERY_EDGE,
  };
}

function paintRisingCurtain(
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
  step: number,
): void {
  const lifted = step / RISE_STEPS;
  // Eased so the drape starts heavy and bunches quickly at the top.
  const eased = 1 - (1 - lifted) ** 2;
  const fullHem = originY + size;
  const risenHem = originY + RISEN_HEM * size;
  paintDrape(ctx, originX, originY, size, {
    top: originY + VALANCE_HEIGHT * size,
    hem: fullHem + (risenHem - fullHem) * eased,
    sway: Array.from({ length: FOLDS }, () => 0),
    swags: Math.round(eased * RISEN_SWAGS),
  });
  paintValance(ctx, originX, originY, size);
  paintTieback(ctx, originX, originY, size, step === RISE_STEPS);
}

/** How an opened interval curtain looks: the opened-way language plus how far its rise has run. */
export interface MazeCurtainOpenArt extends MazeWayOpenArt {
  /** 0 as the pair of curtains starts to lift, 1 once the drape is bunched up under the pelmet. */
  readonly rise: number;
}

const GAP_SHADOW_ALPHA = 0.55;
const THRESHOLD_NEAR_ALPHA = 0.12;
const THRESHOLD_FAR_ALPHA = 0.62;
const CLEAR_GREEN: RGB = [138, 226, 168];
const WAY_GLOW_ALPHA = 0.34;
const WAY_CHEVRON_ALPHA = 0.95;

/**
 * The interval curtain once lifted: the drape rises and bunches under its
 * pelmet over about half a second, over the lit threshold and the tent's
 * "go" green, the same language every opened way wears.
 */
export function drawMazeCurtainOpen(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: MazeCurtainOpenArt,
): void {
  const step = quantise(art.rise, RISE_STEPS);
  ctx.save();
  try {
    ctx.fillStyle = rgba(BACKSTAGE.shadow, GAP_SHADOW_ALPHA);
    ctx.fillRect(x, y, size, size);
    const threshold = ctx.createLinearGradient(0, y + size, 0, y);
    threshold.addColorStop(0, rgba(LIMELIGHT.accent, THRESHOLD_NEAR_ALPHA));
    threshold.addColorStop(1, rgba(LIMELIGHT.accent, THRESHOLD_FAR_ALPHA));
    ctx.fillStyle = threshold;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = rgba(CLEAR_GREEN, WAY_GLOW_ALPHA);
    ctx.fillRect(x, y, size, size);
  } finally {
    ctx.restore();
  }
  const entry = risingCurtainEntry(step);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
  if (step === RISE_STEPS) paintWayChevrons(ctx, x, y, size, art.phase, WAY_CHEVRON_ALPHA);
  paintWayFlare(ctx, x, y, size, art.flare);
}

// ── The stage manager's peep window ─────────────────────────────────────────

const PEEP_WIDTH = 0.62;
const PEEP_HEIGHT = 0.42;
const PEEP_TOP = 0.42;
const PEEP_FRAME = 0.07;
const PEEP_SHUTTER_SHARE = 0.45;
const PEEP_LAMP_Y = 0.2;
const PEEP_LAMP_RADIUS = 0.07;
const PEEP_SHADE_WIDTH = 0.2;
const PEEP_SHADE_HEIGHT = 0.1;
/** The shade's top edge is this fraction of its width, and rises this share of its height above the lamp. */
const PEEP_SHADE_TOP_DIVISOR = 5;
const PEEP_SHADE_TOP_RISE = 0.4;
/** The bulb hangs this share of the shade's height below the lamp's mount. */
const PEEP_BULB_DROP = 0.6;
const PEEP_SHADOW_OFFSET = 0.04;
/** The contact shadow under the sill spreads across this share of the window. */
const PEEP_SHADOW_SPREAD = 0.6;
const PEEP_SHADOW_DEPTH = 0.05;
const PEEP_SHADOW_ALPHA = 0.5;
const PEEP_BEYOND_ALPHA = 0.9;
/** The shutter's lit top lip, as a share of the window's height. */
const PEEP_SHUTTER_LIP = 0.12;
const PEEP_HANDLE_INSET = 0.04;
const PEEP_HANDLE_RADIUS = 0.025;
const PEEP_SILL_LINE_WIDTH = 0.03;
const PEEP_LAMP_STEM_WIDTH = 0.03;

function paintPeepWindow(ctx: Ctx, originX: number, originY: number, size: number): void {
  const centreX = originX + size / 2;
  const left = centreX - (PEEP_WIDTH * size) / 2;
  const top = originY + PEEP_TOP * size;
  const width = PEEP_WIDTH * size;
  const height = PEEP_HEIGHT * size;
  const frame = PEEP_FRAME * size;

  paintContactShadow(
    ctx,
    centreX + size * PEEP_SHADOW_OFFSET,
    top + height + frame,
    width * PEEP_SHADOW_SPREAD,
    size * PEEP_SHADOW_DEPTH,
    PEEP_SHADOW_ALPHA,
  );
  const timber = ctx.createLinearGradient(
    left - frame,
    top - frame,
    left + width + frame,
    top + height + frame,
  );
  timber.addColorStop(0, rgba(ROT_TIMBER.light, 1));
  timber.addColorStop(1, rgba(ROT_TIMBER.shadow, 1));
  ctx.fillStyle = timber;
  ctx.beginPath();
  ctx.rect(left - frame, top - frame, width + frame * 2, height + frame * 2);
  ctx.fill();
  inkCurrentPath(ctx, size);

  // The room beyond, lit by its own lamp.
  const beyond = ctx.createLinearGradient(0, top, 0, top + height);
  beyond.addColorStop(0, rgba(LIMELIGHT.mid, PEEP_BEYOND_ALPHA));
  beyond.addColorStop(1, rgba(LIMELIGHT.shadow, PEEP_BEYOND_ALPHA));
  ctx.fillStyle = beyond;
  ctx.fillRect(left, top, width, height);
  // A sliding shutter, half drawn: the stage manager's spyhole, not a door.
  ctx.fillStyle = rgba(IRON.mid, 1);
  ctx.fillRect(left, top, width * PEEP_SHUTTER_SHARE, height);
  ctx.fillStyle = rgba(IRON.light, 1);
  ctx.fillRect(left, top, width * PEEP_SHUTTER_SHARE, Math.max(1, height * PEEP_SHUTTER_LIP));
  ctx.fillStyle = rgba(BRASS.accent, 1);
  ctx.beginPath();
  ctx.arc(
    left + width * PEEP_SHUTTER_SHARE - size * PEEP_HANDLE_INSET,
    top + height / 2,
    size * PEEP_HANDLE_RADIUS,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.strokeStyle = rgba(ROT_TIMBER.shadow, 1);
  ctx.lineWidth = Math.max(1, size * PEEP_SILL_LINE_WIDTH);
  ctx.strokeRect(left, top, width, height);

  // The hooded lamp over it.
  const lampY = originY + PEEP_LAMP_Y * size;
  ctx.strokeStyle = rgba(IRON.mid, 1);
  ctx.lineWidth = Math.max(1, size * PEEP_LAMP_STEM_WIDTH);
  ctx.beginPath();
  ctx.moveTo(centreX, top - frame);
  ctx.lineTo(centreX, lampY);
  ctx.stroke();
  ctx.fillStyle = rgba(LIMELIGHT.accent, 1);
  ctx.beginPath();
  ctx.arc(
    centreX,
    lampY + PEEP_SHADE_HEIGHT * size * PEEP_BULB_DROP,
    PEEP_LAMP_RADIUS * size,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.mid, 1);
  ctx.beginPath();
  ctx.moveTo(centreX - (PEEP_SHADE_WIDTH * size) / 2, lampY + PEEP_SHADE_HEIGHT * size);
  ctx.lineTo(
    centreX - (PEEP_SHADE_WIDTH * size) / PEEP_SHADE_TOP_DIVISOR,
    lampY - PEEP_SHADE_HEIGHT * size * PEEP_SHADE_TOP_RISE,
  );
  ctx.lineTo(
    centreX + (PEEP_SHADE_WIDTH * size) / PEEP_SHADE_TOP_DIVISOR,
    lampY - PEEP_SHADE_HEIGHT * size * PEEP_SHADE_TOP_RISE,
  );
  ctx.lineTo(centreX + (PEEP_SHADE_WIDTH * size) / 2, lampY + PEEP_SHADE_HEIGHT * size);
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);
}

const PEEP_WINDOW_ENTRY: BigTopPropCatalogueEntry = {
  key: { prop: 'peepWindow', state: 'shutter', frame: 0 },
  box: ONE_TILE_BOX,
  painter: paintPeepWindow,
};

const PEEP_GLOW_RADIUS = 0.55;
const PEEP_GLOW_FLICKER_SPEED = 0.09;
const PEEP_GLOW_FLICKER_DEPTH = 0.15;
const LAMP_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(252,236,190,0.6)' },
  { offset: 0.35, color: 'rgba(248,210,150,0.22)' },
  { offset: 1, color: 'rgba(248,200,140,0)' },
];

/** The stage manager's peep window between the paired rooms, with its hooded lamp — a sightline, never a door. */
export function drawMazeCurtainWindow(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  drawBigTopProp(
    ctx,
    PEEP_WINDOW_ENTRY.key,
    PEEP_WINDOW_ENTRY.box,
    PEEP_WINDOW_ENTRY.painter,
    x,
    y,
    size,
  );
  const flicker =
    1 - PEEP_GLOW_FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(phase * PEEP_GLOW_FLICKER_SPEED));
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flicker;
    drawRadialGlow(
      ctx,
      x + size / 2,
      y + (PEEP_LAMP_Y + PEEP_SHADE_HEIGHT) * size,
      PEEP_GLOW_RADIUS * size,
      LAMP_GLOW_STOPS,
    );
  } finally {
    ctx.restore();
  }
}

// ── The act easel ───────────────────────────────────────────────────────────

const EASEL_BOARD_WIDTH = 3.7;
const EASEL_BOARD_TOP = 0.02;
const EASEL_BOARD_HEIGHT = 0.86;
const EASEL_FRAME = 0.07;
const EASEL_LEG_WIDTH = 0.07;
const EASEL_LEG_SPLAY = 0.22;
const EASEL_FOOT_Y = 1.02;
const EASEL_LAMP_RISE = 0.34;
const EASEL_LAMP_REACH = 0.3;
const EASEL_SHADE_WIDTH = 0.26;
const EASEL_SHADE_HEIGHT = 0.12;
const LETTER_SMALL = 0.22;
const LETTER_LARGE = 0.29;
const LETTER_GAP = 0.06;
const LETTER_MARGIN = 0.18;
const LIGHT_POOL_ALPHA = 0.28;
/** The lamp's pool of light reaches this share of the board's face. */
const LIGHT_POOL_REACH = 0.55;
/** The board darkens toward its foot from this far down, to this alpha. */
const EASEL_FOOT_SHADE_START = 0.6;
const EASEL_FOOT_SHADE_ALPHA = 0.35;
const EASEL_PINSTRIPE_WIDTH = 0.025;
const EASEL_PINSTRIPE_INSET = 0.05;
/** The legs meet the board this share of its width either side of the middle. */
const EASEL_LEG_TOP_SPREAD = 0.3;
const EASEL_FOOT_SHADOW_OFFSET = 0.03;
const EASEL_FOOT_SHADOW_RADIUS_X = 0.1;
const EASEL_FOOT_SHADOW_RADIUS_Y = 0.035;
const EASEL_FOOT_SHADOW_ALPHA = 0.6;
const EASEL_LAMP_ARM_WIDTH = 0.035;
/** The gooseneck is clamped this share of the board's width right of the middle. */
const EASEL_LAMP_CLAMP_X = 0.2;
/** The bulb sits back from the lamp's tip and down into the shade: in tiles, and as a share of the shade's height. */
const EASEL_BULB_BACK = 0.06;
const EASEL_BULB_DROP = 0.7;
const EASEL_BULB_RADIUS = 0.05;
/** The shade's outline, as shares of its width and height from the lamp's tip. */
const EASEL_SHADE_CROWN_BACK = 0.25;
const EASEL_SHADE_CROWN_RISE = 0.3;
const EASEL_SHADE_NOSE_FORWARD = 0.1;
const EASEL_SHADE_MOUTH_DROP = 0.8;

/** Room either side of the board for the legs' splay, in tiles. */
const EASEL_BOX_SIDE_MARGIN = 0.15;
/** How far above its own tile the easel's lamp reaches, in tiles. */
const EASEL_BOX_HEADROOM = 0.5;
const EASEL_BOX_HEIGHT = 1.62;

const EASEL_BOX: BigTopPropBox = {
  left: 0.5 - EASEL_BOARD_WIDTH / 2 - EASEL_BOX_SIDE_MARGIN,
  top: -EASEL_BOX_HEADROOM,
  width: EASEL_BOARD_WIDTH + EASEL_BOX_SIDE_MARGIN * 2,
  height: EASEL_BOX_HEIGHT,
};

const TITLE_BUILD_UP: RGB = [255, 240, 190];
const NAME_BUILD_UP: RGB = [246, 238, 214];

const TITLE_PIGMENT: BrushPigment = {
  body: rgba(GILT_GLINT, 1),
  buildUp: rgba(TITLE_BUILD_UP, 1),
  wetEdge: rgba(BRASS.mid, 1),
  bareSurface: rgba(BLOOD.shadow, 1),
  soak: rgba(BRASS.shadow, 1),
};
const NAME_PIGMENT: BrushPigment = {
  body: rgba(BONE.accent, 1),
  buildUp: rgba(NAME_BUILD_UP, 1),
  wetEdge: rgba(BONE.mid, 1),
  bareSurface: rgba(BLOOD.shadow, 1),
  soak: rgba(BONE.shadow, 1),
};

/** The act card's two lines: "ACT II" over "THE MENAGERIE", or one line when the name has no act number. */
function easelLines(label: string): ReadonlyArray<{ text: string; small: boolean }> {
  const split = label.indexOf(': ');
  if (split < 0) return [{ text: label, small: false }];
  return [
    { text: label.slice(0, split), small: true },
    { text: label.slice(split + 2), small: false },
  ];
}

/** The classic string-hash multiplier: an odd prime, so every letter moves the seed. */
const LABEL_HASH_MULTIPLIER = 31;

function labelSeed(label: string): number {
  let seed = 0;
  for (const letter of label) seed = (seed * LABEL_HASH_MULTIPLIER + letter.charCodeAt(0)) >>> 0;
  return seed;
}

function paintEasel(ctx: Ctx, originX: number, originY: number, size: number, label: string): void {
  const centreX = originX + size / 2;
  const boardWidth = EASEL_BOARD_WIDTH * size;
  const boardLeft = centreX - boardWidth / 2;
  const boardTop = originY + EASEL_BOARD_TOP * size;
  const boardHeight = EASEL_BOARD_HEIGHT * size;
  const frame = EASEL_FRAME * size;
  const footY = originY + EASEL_FOOT_Y * size;

  // Legs behind the board, splayed to the floor, and the one at the back.
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const topX = centreX + side * boardWidth * EASEL_LEG_TOP_SPREAD;
    const footX = topX + side * EASEL_LEG_SPLAY * size;
    paintContactShadow(
      ctx,
      footX + size * EASEL_FOOT_SHADOW_OFFSET,
      footY,
      size * EASEL_FOOT_SHADOW_RADIUS_X,
      size * EASEL_FOOT_SHADOW_RADIUS_Y,
      EASEL_FOOT_SHADOW_ALPHA,
    );
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, 1);
    ctx.lineWidth = EASEL_LEG_WIDTH * size + outlineWidth(size) * 2;
    ctx.beginPath();
    ctx.moveTo(topX, boardTop);
    ctx.lineTo(footX, footY);
    ctx.stroke();
    ctx.strokeStyle = rgba(side < 0 ? ROT_TIMBER.light : ROT_TIMBER.mid, 1);
    ctx.lineWidth = EASEL_LEG_WIDTH * size;
    ctx.stroke();
  }

  const timber = ctx.createLinearGradient(boardLeft, boardTop, boardLeft, boardTop + boardHeight);
  timber.addColorStop(0, rgba(ROT_TIMBER.light, 1));
  timber.addColorStop(1, rgba(ROT_TIMBER.shadow, 1));
  ctx.fillStyle = timber;
  ctx.beginPath();
  ctx.rect(boardLeft, boardTop, boardWidth, boardHeight);
  ctx.fill();
  inkCurrentPath(ctx, size);
  const faceLeft = boardLeft + frame;
  const faceTop = boardTop + frame;
  const faceWidth = boardWidth - frame * 2;
  const faceHeight = boardHeight - frame * 2;
  ctx.fillStyle = rgba(BLOOD.mid, 1);
  ctx.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
  // The easel's own lamp pools its light high on the board, falling off down and out.
  const pool = ctx.createRadialGradient(
    centreX,
    faceTop,
    0,
    centreX,
    faceTop,
    faceWidth * LIGHT_POOL_REACH,
  );
  pool.addColorStop(0, rgba(LIMELIGHT.light, LIGHT_POOL_ALPHA));
  pool.addColorStop(1, rgba(LIMELIGHT.light, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
  const edge = ctx.createLinearGradient(0, faceTop, 0, faceTop + faceHeight);
  edge.addColorStop(EASEL_FOOT_SHADE_START, rgba(BACKSTAGE.shadow, 0));
  edge.addColorStop(1, rgba(BACKSTAGE.shadow, EASEL_FOOT_SHADE_ALPHA));
  ctx.fillStyle = edge;
  ctx.fillRect(faceLeft, faceTop, faceWidth, faceHeight);
  ctx.strokeStyle = rgba(BRASS.light, 1);
  ctx.lineWidth = Math.max(1, size * EASEL_PINSTRIPE_WIDTH);
  const inset = size * EASEL_PINSTRIPE_INSET;
  ctx.strokeRect(faceLeft + inset, faceTop + inset, faceWidth - inset * 2, faceHeight - inset * 2);

  const lines = easelLines(label);
  const rng = mulberry32(labelSeed(label));
  const maxWidth = faceWidth - LETTER_MARGIN * size * 2;
  const heights = lines.map((line) => {
    const wanted = (line.small ? LETTER_SMALL : LETTER_LARGE) * size;
    const natural = wordWidth(line.text, wanted);
    return natural > maxWidth ? wanted * (maxWidth / natural) : wanted;
  });
  const total =
    heights.reduce((sum, height) => sum + height, 0) + LETTER_GAP * size * (lines.length - 1);
  let top = faceTop + (faceHeight - total) / 2;
  lines.forEach((line, index) => {
    const height = heights[index] ?? LETTER_LARGE * size;
    paintWord(ctx, line.text, centreX, top, height, line.small ? TITLE_PIGMENT : NAME_PIGMENT, rng);
    top += height + LETTER_GAP * size;
  });

  // A gooseneck lamp clamped to the board's top, its shade over the lettering.
  const lampX = centreX + EASEL_LAMP_REACH * size;
  const lampY = boardTop - EASEL_LAMP_RISE * size;
  ctx.strokeStyle = rgba(IRON.mid, 1);
  ctx.lineWidth = Math.max(1, size * EASEL_LAMP_ARM_WIDTH);
  ctx.beginPath();
  ctx.moveTo(centreX + boardWidth * EASEL_LAMP_CLAMP_X, boardTop);
  ctx.quadraticCurveTo(centreX + boardWidth * EASEL_LAMP_CLAMP_X, lampY, lampX, lampY);
  ctx.stroke();
  ctx.fillStyle = rgba(LIMELIGHT.accent, 1);
  ctx.beginPath();
  ctx.arc(
    lampX - size * EASEL_BULB_BACK,
    lampY + EASEL_SHADE_HEIGHT * size * EASEL_BULB_DROP,
    size * EASEL_BULB_RADIUS,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.mid, 1);
  ctx.beginPath();
  ctx.moveTo(lampX - EASEL_SHADE_WIDTH * size, lampY + EASEL_SHADE_HEIGHT * size);
  ctx.lineTo(
    lampX - EASEL_SHADE_WIDTH * size * EASEL_SHADE_CROWN_BACK,
    lampY - EASEL_SHADE_HEIGHT * size * EASEL_SHADE_CROWN_RISE,
  );
  ctx.lineTo(lampX + EASEL_SHADE_WIDTH * size * EASEL_SHADE_NOSE_FORWARD, lampY);
  ctx.lineTo(lampX, lampY + EASEL_SHADE_HEIGHT * size * EASEL_SHADE_MOUTH_DROP);
  ctx.closePath();
  ctx.fill();
  inkCurrentPath(ctx, size);
}

const EASEL_GLOW_RADIUS = 0.8;

/**
 * The painted easel naming the act behind the drapes, standing between the
 * two arches: brush-lettered on a velvet-red board in a timber frame, lit by
 * its own gooseneck lamp. Drawn from the tile the board is centred on.
 */
export function drawActEasel(ctx: Ctx, x: number, y: number, size: number, label: string): void {
  const entry = easelEntry(label);
  drawBigTopProp(ctx, entry.key, entry.box, entry.painter, x, y, size);
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    drawRadialGlow(
      ctx,
      x + size / 2 + (EASEL_LAMP_REACH - EASEL_SHADE_WIDTH / 2) * size,
      y + (EASEL_BOARD_TOP - EASEL_LAMP_RISE + EASEL_SHADE_HEIGHT) * size,
      EASEL_GLOW_RADIUS * size,
      LAMP_GLOW_STOPS,
    );
  } finally {
    ctx.restore();
  }
}

function easelEntry(label: string): BigTopPropCatalogueEntry {
  return {
    key: { prop: 'actEasel', state: label, frame: 0 },
    box: EASEL_BOX,
    painter: (target, originX, originY, px) => paintEasel(target, originX, originY, px, label),
  };
}

/**
 * Every picture the interval rooms ask the prop cache for, for the art gate.
 * `actLabels` are the act names the easels are lettered with.
 */
export function curtainPropCatalogue(
  actLabels: ReadonlyArray<string>,
): ReadonlyArray<BigTopPropCatalogueEntry> {
  const entries: BigTopPropCatalogueEntry[] = [PEEP_WINDOW_ENTRY];
  for (let frame = 0; frame < SWAY_FRAMES; frame++) entries.push(closedCurtainEntry(frame));
  for (let step = 0; step <= RISE_STEPS; step++) entries.push(risingCurtainEntry(step));
  for (const label of actLabels) entries.push(easelEntry(label));
  return entries;
}
