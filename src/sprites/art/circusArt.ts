/**
 * Painters for Grimaldi's circus grounds: the Big Top, the side-show
 * pavilions and the entry arch's posts.
 *
 * Written on the town's vocabulary (`src/sprites/art/town/`): the circus ramps
 * from `townPalette.ts`, the one upper-left sun, one silhouette outline in warm
 * ink, a soft contact shadow, gradient occlusion at every ground contact and a
 * few drawn shapes for weathering — never per-pixel noise.
 *
 * ## A tent is modelled, then projected
 *
 * Every tent is a plan ellipse with a short sidewall and canvas raised to one
 * or two king poles. The canvas is cut into panels — one stripe each — that
 * run from the eave to a pole's peak, or between the poles to a ridge rope
 * sagging from peak to peak. Each panel is painted flat into its own plane
 * and warped onto its quad with `drawPlane`, so the stripes genuinely narrow
 * as they climb and meet at the peak: the convergence that makes canvas read
 * as a tent rather than as striped wallpaper. Panels facing away from the
 * viewer are never drawn; the ones facing it are lit by how squarely they
 * face the sun, through `shadePlane`.
 *
 * The projection is the game's: a step back into the picture and a step up
 * off the ground both move a point one tile up the frame. A point is written
 * `(u, d, h)` — tiles east from the footprint's west edge, tiles north from
 * its south edge, tiles above the ground.
 *
 * ## The frame contract
 *
 * Ink stays inside the blocked footprint's columns and never below a
 * column's lowest blocked tile, except over a doorway and for soft shadow;
 * above that it may rise as high as the sheet's headroom allows. The Big
 * Top's plan ellipse is sized so its base clears the four corner tiles its
 * layout leaves walkable.
 */

import {
  BIG_TOP_KING_POLES,
  BIG_TOP_KING_POLE_DEPTH_TILES,
  CIRCUS_ARCH_POST_HEIGHT_TILES,
  CIRCUS_STRUCTURES,
  type CircusStructureId,
  type CircusStructureSpec,
} from '../../map/overworld/circusGroundsLayout';
import { drawPlane, makePlane, quadPath, type Point, type Quad } from '../buildinggen/projection';
import { paintEdgeAo, shadePlane } from '../buildinggen/lighting';
import { applyMossPatches, applyStreaks, applyWeatherPatches } from '../buildinggen/texture';
import { NoiseField } from '../../map/tilegen/noise';
import { mulberry32, range, rangeInt, type Rng } from '../person/rng';
import type { BrushPigment } from './brushStroke';
import { paintWord, wordWidth } from './circusLettering';
import { fillSoftEllipse, withClip } from './softShade';
import { TOWN_TILE_SCALE, forkRng, inkOutline, rgb, rgba } from './town/townArt';
import {
  CARAVAN_WINDOW,
  FLAME_LAMP_MOUTH,
  FLAME_LAMP_MOUTH_HALF_WIDTH_TILES,
  FLAME_LAMP_TIE,
  PAVILION_PEAK_HEIGHT_TILES,
  PAVILION_POLE_CAP_TILES,
  TICKET_BOOTH_BALLOON_TIE,
} from './circusOverlayAnchors';
import {
  TOWN_CONTACT_SHADOW,
  TOWN_INK,
  getCircusRamp,
  getTownRamp,
  mix,
  shade,
  type RGB,
  type Ramp,
} from './town/townPalette';

type Ctx = CanvasRenderingContext2D;

/** Source pixels per game tile: the town's prop scale, so a tent sits at the resolution of the figures in front of it. */
export const CIRCUS_TILE_SCALE = TOWN_TILE_SCALE;

/** Where one structure is painted: its drawing tile's top-left corner. */
export interface CircusFrame {
  readonly originX: number;
  readonly originY: number;
  readonly tileScale: number;
}

export type CircusPainter = (ctx: Ctx, frame: CircusFrame, variant: number, rng: Rng) => void;

/**
 * Runs a structure's painter with nothing drawn below its ground line. Only
 * the ground line is clipped: a stroke centred on it and a shadow pooled at
 * the foot are trimmed there, as the cell clip would trim them in the game,
 * while a painter that strays sideways or above its headroom still does so
 * visibly, for `gates:circus-art` to catch.
 */
function aboveGround(spec: CircusStructureSpec, paint: CircusPainter): CircusPainter {
  return (ctx, frame, variant, rng) => {
    const ts = frame.tileScale;
    const ground = frame.originY + ts + (spec.h - 1 - spec.drawTile.dy) * ts;
    const reach = (spec.w + spec.h + SIDE_REACH_TILES) * ts;
    withClip(
      ctx,
      () => {
        ctx.beginPath();
        ctx.rect(frame.originX - reach, ground - reach * 2, reach * 3, reach * 2);
      },
      () => paint(ctx, frame, variant, rng),
    );
  };
}
/** How far past the footprint the ground-line clip reaches on the other three sides, so it never trims them. */
const SIDE_REACH_TILES = 8;

export interface CircusStructureArt {
  /** How many variants the structure has — the frame count of its sheet row. */
  readonly variants: number;
  /** Tiles of art allowed above the footprint's top row. */
  readonly headroomTiles: number;
  readonly paint: CircusPainter;
}

// ── Projection ────────────────────────────────────────────────────────────────

interface Vec3 {
  readonly u: number;
  readonly d: number;
  readonly h: number;
}

/** The frame a structure is painted into, in the footprint's own terms. */
interface Stage {
  readonly ctx: Ctx;
  readonly ts: number;
  /** Frame x of the footprint's west edge. */
  readonly left: number;
  /** Frame y of the footprint's south edge — the ground line. */
  readonly ground: number;
}

function stageFor(ctx: Ctx, frame: CircusFrame, spec: CircusStructureSpec): Stage {
  const ts = frame.tileScale;
  return {
    ctx,
    ts,
    left: frame.originX - spec.drawTile.dx * ts,
    ground: frame.originY + ts + (spec.h - 1 - spec.drawTile.dy) * ts,
  };
}

function project(stage: Stage, point: Vec3): Point {
  return {
    x: stage.left + point.u * stage.ts,
    y: stage.ground - (point.d + point.h) * stage.ts,
  };
}

/**
 * The one sun, in plan terms: from the west, a little north of overhead —
 * the game's upper-left light, since up the frame is both north and up.
 */
const SUN = normalise({ u: -0.55, d: 0.35, h: 0.76 });
/** The viewer's line of sight: a surface faces the viewer when its normal opposes this. */
const SIGHT: Vec3 = { u: 0, d: 1, h: -1 };

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.u, v.d, v.h);
  return { u: v.u / length, d: v.d / length, h: v.h / length };
}

function dot(a: Vec3, b: Vec3): number {
  return a.u * b.u + a.d * b.d + a.h * b.h;
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return { u: a.u - b.u, d: a.d - b.d, h: a.h - b.h };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    u: a.d * b.h - a.h * b.d,
    d: a.h * b.u - a.u * b.h,
    h: a.u * b.d - a.d * b.u,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const BLOOD = getCircusRamp('circus_blood');
const BONE = getCircusRamp('circus_bone');
const BRUISE = getCircusRamp('circus_bruise');
const BRASS = getCircusRamp('circus_brass');
const NAVY = getCircusRamp('circus_navy');
const MILDEW = getCircusRamp('circus_mildew');
const VINE = getCircusRamp('circus_vine');
const BACKSTAGE = getCircusRamp('circus_backstage');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const STRAW = getCircusRamp('circus_straw');
const IRON = getTownRamp('iron_black');
const LIMELIGHT = getCircusRamp('circus_limelight');

// ── The tent model ────────────────────────────────────────────────────────────

interface TentDoor {
  readonly centreU: number;
  readonly halfWidth: number;
  /** Height of the door's head above the ground, in tiles; a door taller than the sidewall is cut up into the canvas. */
  readonly height: number;
  /** Tied back onto a dark mouth, or laced shut. */
  readonly open: boolean;
}

interface TentModel {
  /** Plan ellipse: centre and radii, in tiles. */
  readonly centreU: number;
  readonly centreD: number;
  readonly radiusU: number;
  readonly radiusD: number;
  readonly wallHeight: number;
  /** King poles, all standing on the plan's east–west centre line. */
  readonly peaks: ReadonlyArray<{ readonly u: number; readonly h: number }>;
  /** How far the ridge rope between two peaks sags at its middle, in tiles. */
  readonly ridgeSag: number;
  /** Panels round the whole eave; a multiple of four keeps a seam dead centre in front. */
  readonly panelCount: number;
  /** The two stripe colours, alternating panel by panel. */
  readonly stripes: readonly [Ramp, Ramp];
  readonly valance: Ramp;
  readonly valanceTrim: Ramp;
  /** How far the valance hangs below the eave at a quarter pole, in tiles. */
  readonly valanceDrop: number;
  /** Panels between quarter poles; the valance swags between them. */
  readonly quarterPoleEvery: number;
  readonly door: TentDoor | null;
  /** How far above a peak its king pole stands, in tiles. */
  readonly poleCap: number;
}

/** How much of each panel's height is bleached toward its paler tone at the peak: the sun reaches the top first. */
const SUN_BLEACH = 0.35;
/** Canvas darkens toward the eave, where the valance shades it and rain runs down it. */
const EAVE_DARKEN = 0.86;
/** Ambient share of a lit plane's value, and the share that comes from facing the sun. */
const AMBIENT_SHADE = 0.5;
const SUN_SHADE = 0.78;
/** The sidewall is a vertical face: it gets less sky than the roof. */
const WALL_AMBIENT_SHADE = 0.52;
const WALL_SUN_SHADE = 0.55;
const SEAM_ALPHA = 0.45;
const SEAM_WIDTH_PX = 1.2;
/** Panels are painted at a third of their warped height: the stripes run vertically and lose nothing, and the warp, one slice per row, is most of a tent's cost. */
const PLANE_HEIGHT_FRACTION = 0.34;
const MIN_PLANE_HEIGHT_PX = 8;
const WEATHER_AMPLITUDE = 0.07;
const STREAK_STRENGTH = 0.1;
const STREAK_DENSITY = 0.03;
const STREAK_LENGTH_FRACTION = 0.55;
const STREAK_ORIGIN = 0.05;
/**
 * One noise field for every panel's streaks, built once: a field per plane
 * cost more than the rest of the tent together. Its wrap is wider than any
 * panel, so no streak repeats inside one.
 */
const STREAK_NOISE_WRAP_PX = 512;
const STREAK_NOISE = new NoiseField(STREAK_NOISE_WRAP_PX);

function eaveAt(model: TentModel, angle: number, h: number): Vec3 {
  return {
    u: model.centreU + model.radiusU * Math.cos(angle),
    d: model.centreD + model.radiusD * Math.sin(angle),
    h,
  };
}

/**
 * Radius of the collar ring round each king pole the canvas is laced to, in
 * tiles. The panels stop on it rather than meeting in a point, which is how a
 * big top is rigged — and a panel warped down to a zero-width edge would hand
 * `drawPlane` a singular transform, which node-canvas never recovers from.
 */
const PEAK_COLLAR_RADIUS = 0.12;

/** Where the canvas above an eave point is drawn up to: a peak's collar, or the ridge rope between two. */
function canvasTop(model: TentModel, eave: Vec3): Vec3 {
  const first = model.peaks[0];
  const last = model.peaks[model.peaks.length - 1];
  const peak = eave.u <= first.u ? first : eave.u >= last.u ? last : null;
  if (peak === null) return { u: eave.u, d: model.centreD, h: ridgeHeight(model, eave.u) };
  const runU = eave.u - peak.u;
  const runD = eave.d - model.centreD;
  const run = Math.hypot(runU, runD);
  const toCollar = run === 0 ? 0 : PEAK_COLLAR_RADIUS / run;
  return {
    u: peak.u + runU * toCollar,
    d: model.centreD + runD * toCollar,
    h: lerp(peak.h, eave.h, toCollar),
  };
}

function ridgeHeight(model: TentModel, u: number): number {
  const first = model.peaks[0];
  const last = model.peaks[model.peaks.length - 1];
  const span = last.u - first.u;
  if (span <= 0) return first.h;
  const t = (u - first.u) / span;
  const centred = t * 2 - 1;
  return lerp(first.h, last.h, t) - model.ridgeSag * (1 - centred * centred);
}

function panelAngle(model: TentModel, index: number): number {
  return (index / model.panelCount) * Math.PI * 2;
}

interface Panel {
  readonly index: number;
  readonly eaveA: Vec3;
  readonly eaveB: Vec3;
  readonly topA: Vec3;
  readonly topB: Vec3;
  readonly normal: Vec3;
  readonly depth: number;
}

function roofPanels(model: TentModel): Panel[] {
  const panels: Panel[] = [];
  for (let index = 0; index < model.panelCount; index++) {
    const eaveA = eaveAt(model, panelAngle(model, index), model.wallHeight);
    const eaveB = eaveAt(model, panelAngle(model, index + 1), model.wallHeight);
    const topA = canvasTop(model, eaveA);
    const topB = canvasTop(model, eaveB);
    const topMid = { u: (topA.u + topB.u) / 2, d: (topA.d + topB.d) / 2, h: (topA.h + topB.h) / 2 };
    const raw = cross(minus(eaveB, eaveA), minus(topMid, eaveA));
    const up = raw.h >= 0 ? raw : { u: -raw.u, d: -raw.d, h: -raw.h };
    panels.push({
      index,
      eaveA,
      eaveB,
      topA,
      topB,
      normal: normalise(up),
      depth: (eaveA.d + eaveB.d) / 2,
    });
  }
  return panels;
}

function facesViewer(normal: Vec3): boolean {
  return dot(normal, SIGHT) < 0;
}

function sunFactor(normal: Vec3, ambient: number, sun: number): number {
  return ambient + sun * Math.max(0, dot(normal, SUN));
}

/** Weathering chosen once per tent from the paint seed: which panels are patched and torn. */
interface Wear {
  readonly patched: ReadonlySet<number>;
  readonly torn: number;
  readonly seed: number;
}

const PATCHED_PANELS = 2;

function rollWear(model: TentModel, frontPanels: ReadonlyArray<Panel>, rng: Rng): Wear {
  const candidates = frontPanels.map((panel) => panel.index);
  const patched = new Set<number>();
  for (let pick = 0; pick < PATCHED_PANELS && candidates.length > 0; pick++) {
    patched.add(candidates[rangeInt(rng, 0, candidates.length - 1)]);
  }
  const torn = candidates.length > 0 ? candidates[rangeInt(rng, 0, candidates.length - 1)] : -1;
  const SEED_RANGE = 0x7fffffff;
  return { patched, torn, seed: Math.floor(rng() * SEED_RANGE) + model.panelCount };
}

/** A sewn patch: a paler square of replacement canvas with its stitching. */
const PATCH_WIDTH_FRACTION = 0.5;
const PATCH_HEIGHT_FRACTION = 0.16;
/** Replacement canvas is this much paler than the panel it patches. */
const PATCH_TINT = 0.3;
/** Patches sit in this band of a panel's height: clear of the peak's bleach and the eave's tear. */
const PATCH_BAND_TOP_FRACTION = 0.3;
const PATCH_BAND_BOTTOM_FRACTION = 0.75;
/** The stitching runs one pixel inside the patch's edge. */
const STITCH_INSET_PX = 1;
const STITCH_DASH_PX = 2;
const STITCH_GAP_PX = 2;
/** A tear: a ragged split near the eave, open onto the dark inside. */
const TEAR_TOP_FRACTION = 0.52;
const TEAR_BOTTOM_FRACTION = 0.86;
const TEAR_WIDTH_FRACTION = 0.34;
/** How far the tear may wander off the panel's centre line, as a share of its width. */
const TEAR_WANDER_FRACTION = 0.1;
/**
 * The tear's ragged outline, clockwise from its top point: each vertex's
 * offset across the tear, in half-widths, and down it, from top to bottom.
 */
const TEAR_OUTLINE: ReadonlyArray<{ readonly across: number; readonly down: number }> = [
  { across: 0.6, down: 0.35 },
  { across: 1, down: 0.7 },
  { across: 0.3, down: 1 },
  { across: -0.4, down: 0.8 },
  { across: -1, down: 0.55 },
  { across: -0.3, down: 0.25 },
];

function paintCanvasPanel(
  stage: Stage,
  model: TentModel,
  panel: Panel,
  wear: Wear,
  rng: Rng,
): void {
  const quad: Quad = {
    tl: project(stage, panel.topA),
    tr: project(stage, panel.topB),
    br: project(stage, panel.eaveB),
    bl: project(stage, panel.eaveA),
  };
  const warpedHeight = Math.max(
    Math.hypot(quad.tl.x - quad.bl.x, quad.tl.y - quad.bl.y),
    Math.hypot(quad.tr.x - quad.br.x, quad.tr.y - quad.br.y),
  );
  const plane = makePlane(
    quad,
    undefined,
    Math.max(MIN_PLANE_HEIGHT_PX, Math.round(warpedHeight * PLANE_HEIGHT_FRACTION)),
  );
  const ramp = model.stripes[panel.index % 2];
  const { ctx, width, height } = plane;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, rgb(mix(ramp.mid, ramp.accent, SUN_BLEACH)));
  gradient.addColorStop(1, rgb(shade(ramp.mid, EAVE_DARKEN)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (wear.patched.has(panel.index)) {
    const patchW = width * PATCH_WIDTH_FRACTION;
    const patchH = height * PATCH_HEIGHT_FRACTION;
    const patchX = range(rng, 0, width - patchW);
    const patchY = range(
      rng,
      height * PATCH_BAND_TOP_FRACTION,
      height * PATCH_BAND_BOTTOM_FRACTION - patchH,
    );
    ctx.fillStyle = rgb(mix(ramp.mid, ramp.light, PATCH_TINT));
    ctx.fillRect(patchX, patchY, patchW, patchH);
    ctx.strokeStyle = rgba(ramp.shadow, SEAM_ALPHA);
    ctx.lineWidth = 1;
    ctx.setLineDash([STITCH_DASH_PX, STITCH_GAP_PX]);
    ctx.strokeRect(
      patchX + STITCH_INSET_PX,
      patchY + STITCH_INSET_PX,
      patchW - STITCH_INSET_PX * 2,
      patchH - STITCH_INSET_PX * 2,
    );
    ctx.setLineDash([]);
  }
  if (panel.index === wear.torn) {
    const top = height * TEAR_TOP_FRACTION;
    const bottom = height * TEAR_BOTTOM_FRACTION;
    const wander = width * TEAR_WANDER_FRACTION;
    const centreX = width / 2 + range(rng, -wander, wander);
    const halfWidth = (width * TEAR_WIDTH_FRACTION) / 2;
    ctx.fillStyle = rgb(BACKSTAGE.shadow);
    ctx.beginPath();
    ctx.moveTo(centreX, top);
    for (const vertex of TEAR_OUTLINE) {
      ctx.lineTo(centreX + halfWidth * vertex.across, lerp(top, bottom, vertex.down));
    }
    ctx.closePath();
    ctx.fill();
  }

  applyWeatherPatches(plane, {
    seed: wear.seed + panel.index,
    scale: stage.ts,
    amplitude: WEATHER_AMPLITUDE,
  });
  applyStreaks(plane, STREAK_NOISE, {
    seed: wear.seed + panel.index,
    strength: STREAK_STRENGTH,
    density: STREAK_DENSITY,
    length: height * STREAK_LENGTH_FRACTION,
    originY: STREAK_ORIGIN,
  });
  // The seam down one side of each panel is stitched canvas, not an outline:
  // a darker line of the panel's own colour, crossing no other panel.
  ctx.strokeStyle = rgba(ramp.shadow, SEAM_ALPHA);
  ctx.lineWidth = SEAM_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(SEAM_WIDTH_PX / 2, 0);
  ctx.lineTo(SEAM_WIDTH_PX / 2, height);
  ctx.stroke();

  shadePlane(plane, sunFactor(panel.normal, AMBIENT_SHADE, SUN_SHADE));
  drawPlane(stage.ctx, plane);
}

/** Sidewall stripes per panel: twice the roof's, so the wall reads as its own skirt. */
const WALL_STRIPES_PER_PANEL = 2;
const WALL_TOP_AO_DEPTH = 0.4;
const WALL_TOP_AO_REACH = 0.35;
const WALL_FOOT_AO_DEPTH = 0.5;
const WALL_FOOT_AO_REACH = 0.3;
const MILDEW_STRENGTH = 0.75;
const MILDEW_REACH = 0.85;

function wallNormal(model: TentModel, angle: number): Vec3 {
  return normalise({
    u: Math.cos(angle) / model.radiusU,
    d: Math.sin(angle) / model.radiusD,
    h: 0,
  });
}

function inDoor(model: TentModel, u: number): boolean {
  return model.door !== null && Math.abs(u - model.door.centreU) < model.door.halfWidth;
}

function paintSidewallSegment(stage: Stage, model: TentModel, index: number, wear: Wear): void {
  const angleA = panelAngle(model, index);
  const angleB = panelAngle(model, index + 1);
  const quad: Quad = {
    tl: project(stage, eaveAt(model, angleA, model.wallHeight)),
    tr: project(stage, eaveAt(model, angleB, model.wallHeight)),
    br: project(stage, eaveAt(model, angleB, 0)),
    bl: project(stage, eaveAt(model, angleA, 0)),
  };
  const plane = makePlane(quad);
  const { ctx, width, height } = plane;
  for (let stripe = 0; stripe < WALL_STRIPES_PER_PANEL; stripe++) {
    const ramp = model.stripes[(index * WALL_STRIPES_PER_PANEL + stripe) % 2];
    ctx.fillStyle = rgb(ramp.mid);
    const x0 = (stripe / WALL_STRIPES_PER_PANEL) * width;
    ctx.fillRect(x0, 0, width / WALL_STRIPES_PER_PANEL + 1, height);
  }
  const rect = { x: 0, y: 0, width, height };
  paintEdgeAo(ctx, rect, 'top', { depth: WALL_TOP_AO_DEPTH, reach: height * WALL_TOP_AO_REACH });
  paintEdgeAo(ctx, rect, 'bottom', {
    depth: WALL_FOOT_AO_DEPTH,
    reach: height * WALL_FOOT_AO_REACH,
  });
  applyMossPatches(plane, {
    seed: wear.seed + index,
    scale: stage.ts,
    color: MILDEW.mid,
    strength: MILDEW_STRENGTH,
    reach: MILDEW_REACH,
  });
  const midAngle = (angleA + angleB) / 2;
  shadePlane(plane, sunFactor(wallNormal(model, midAngle), WALL_AMBIENT_SHADE, WALL_SUN_SHADE));
  drawPlane(stage.ctx, plane);
}

/** Front-facing sidewall: the half of the ring whose outward normal points toward the viewer. */
function frontWallIndices(model: TentModel): number[] {
  const indices: number[] = [];
  for (let index = 0; index < model.panelCount; index++) {
    const mid = (panelAngle(model, index) + panelAngle(model, index + 1)) / 2;
    if (Math.sin(mid) < 0) indices.push(index);
  }
  return indices;
}

// ── Valance, poles, door ──────────────────────────────────────────────────────

const VALANCE_SAMPLES_PER_PANEL = 10;
const SCALLOPS_PER_PANEL = 2;
const SCALLOP_DEPTH = 0.07;
const SWAG_DEPTH = 0.1;
const VALANCE_TRIM_OFFSET = 0.05;
const VALANCE_TRIM_WIDTH = 0.035;
const VALANCE_SHADOW_ALPHA = 0.35;
const VALANCE_SHADOW_OFFSET = 0.05;
/** The valance falls off toward the east, away from the sun, to this share of its mid tone. */
const VALANCE_FAR_SHADE = 0.72;

/** The valance's hem at an angle: a base drop, swagging between quarter poles, scalloped. */
function valanceDrop(model: TentModel, angle: number): number {
  const panelPosition = (angle / (Math.PI * 2)) * model.panelCount;
  const swagPhase = (panelPosition / model.quarterPoleEvery) % 1;
  const scallopPhase = (panelPosition * SCALLOPS_PER_PANEL) % 1;
  return (
    model.valanceDrop +
    SWAG_DEPTH * Math.sin(Math.PI * swagPhase) +
    SCALLOP_DEPTH * Math.sin(Math.PI * scallopPhase)
  );
}

/**
 * The plan angles whose wall faces the viewer: where the outward normal's
 * northward part is negative, the half of the ellipse from due west, round
 * the front, to due east.
 */
const FRONT_ARC = { from: Math.PI, to: Math.PI * 2 } as const;

function paintValance(stage: Stage, model: TentModel): void {
  const { ctx, ts } = stage;
  const arc = FRONT_ARC;
  const samples = Math.round(
    ((arc.to - arc.from) / (Math.PI * 2)) * model.panelCount * VALANCE_SAMPLES_PER_PANEL,
  );
  const top: Point[] = [];
  const hem: Point[] = [];
  for (let sample = 0; sample <= samples; sample++) {
    const angle = lerp(arc.from, arc.to, sample / samples);
    top.push(project(stage, eaveAt(model, angle, model.wallHeight)));
    hem.push(project(stage, eaveAt(model, angle, model.wallHeight - valanceDrop(model, angle))));
  }
  // The valance shades the wall under it along its hem.
  ctx.save();
  ctx.strokeStyle = rgba(TOWN_CONTACT_SHADOW, VALANCE_SHADOW_ALPHA);
  ctx.lineWidth = VALANCE_SHADOW_OFFSET * ts * 2;
  ctx.beginPath();
  hem.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y + VALANCE_SHADOW_OFFSET * ts);
    else ctx.lineTo(point.x, point.y + VALANCE_SHADOW_OFFSET * ts);
  });
  ctx.stroke();

  const first = top[0];
  const last = top[top.length - 1];
  const gradient = ctx.createLinearGradient(first.x, 0, last.x, 0);
  gradient.addColorStop(0, rgb(model.valance.light));
  gradient.addColorStop(0.5, rgb(model.valance.mid));
  gradient.addColorStop(1, rgb(shade(model.valance.mid, VALANCE_FAR_SHADE)));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  top.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  for (let index = hem.length - 1; index >= 0; index--) ctx.lineTo(hem[index].x, hem[index].y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgb(model.valanceTrim.light);
  ctx.lineWidth = VALANCE_TRIM_WIDTH * ts;
  ctx.beginPath();
  top.forEach((point, index) => {
    const y = point.y + VALANCE_TRIM_OFFSET * ts;
    if (index === 0) ctx.moveTo(point.x, y);
    else ctx.lineTo(point.x, y);
  });
  ctx.stroke();
  ctx.restore();
}

const QUARTER_POLE_WIDTH = 0.07;
const QUARTER_POLE_RISE = 0.12;
/** Quarter poles stand only where the eave faces the viewer at least this squarely; nearer the flanks the wall hides them. */
const QUARTER_POLE_MAX_PLAN_SINE = -0.2;
/** A pole's sunlit west edge, as a share of its half-width. */
const POLE_LIT_SHARE = 0.8;
/** The brass cap is wider than the pole and this tall, both in the pole's half-widths. */
const QUARTER_POLE_CAP_HALF_WIDTH = 1.3;
const QUARTER_POLE_CAP_HEIGHT = 1.4;

function paintQuarterPoles(stage: Stage, model: TentModel): void {
  const { ctx, ts } = stage;
  for (let index = 0; index <= model.panelCount; index += model.quarterPoleEvery) {
    const angle = panelAngle(model, index);
    if (Math.sin(angle) > QUARTER_POLE_MAX_PLAN_SINE) continue;
    const foot = project(stage, eaveAt(model, angle, 0));
    if (inDoor(model, eaveAt(model, angle, 0).u)) continue;
    const top = project(stage, eaveAt(model, angle, model.wallHeight + QUARTER_POLE_RISE));
    const halfWidth = (QUARTER_POLE_WIDTH * ts) / 2;
    ctx.fillStyle = rgb(ROT_TIMBER.mid);
    ctx.fillRect(foot.x - halfWidth, top.y, halfWidth * 2, foot.y - top.y);
    ctx.fillStyle = rgb(ROT_TIMBER.light);
    ctx.fillRect(foot.x - halfWidth, top.y, halfWidth * POLE_LIT_SHARE, foot.y - top.y);
    ctx.fillStyle = rgb(BRASS.light);
    const capHalfWidth = halfWidth * QUARTER_POLE_CAP_HALF_WIDTH;
    ctx.fillRect(
      foot.x - capHalfWidth,
      top.y - halfWidth,
      capHalfWidth * 2,
      halfWidth * QUARTER_POLE_CAP_HEIGHT,
    );
  }
}

const DOOR_FLAP_BULGE = 0.24;
const DOOR_TIE_HEIGHT = 0.42;
const DOOR_FLAP_FOOT_SPREAD = 0.18;
const DOOR_ROPE_WIDTH = 0.04;
const LACE_CROSSINGS = 4;
const LACE_HALF_SPAN = 0.07;
const LACE_WIDTH = 0.025;
/** The dark seam where the laced flaps meet, in lace widths. */
const LACE_SEAM_WIDTH = 1.5;
const LACE_SEAM_ALPHA = 0.75;
/** Each lacing crosses the seam from this share of its slot down to this one. */
const LACE_CROSSING_START = 0.15;
const LACE_CROSSING_END = 0.85;
/** A tied-back flap bunches outward at this share of the door's height. */
const DOOR_FLAP_BULGE_HEIGHT = 0.62;
/** How far inside the doorway's edge the tie bites, and how far outside it the flap's foot tucks, in tiles. */
const DOOR_TIE_INSET = 0.04;
const DOOR_FLAP_FOOT_TUCK = 0.02;
/** The east flap turns from the sun, to this share of its mid tone. */
const DOOR_FLAP_SHADE = 0.75;

/** The plan depth of a door's threshold: where the front of the eave ellipse crosses the doorway's edges, the nearer of the two. */
function doorFootDepth(model: TentModel): number {
  const door = model.door;
  if (door === null) return 0;
  const angleOf = (u: number): number =>
    Math.PI + Math.acos(Math.max(-1, Math.min(1, (u - model.centreU) / model.radiusU)));
  const westFoot = eaveAt(
    model,
    2 * Math.PI - (angleOf(door.centreU - door.halfWidth) - Math.PI),
    0,
  );
  const eastFoot = eaveAt(
    model,
    2 * Math.PI - (angleOf(door.centreU + door.halfWidth) - Math.PI),
    0,
  );
  return Math.min(westFoot.d, eastFoot.d);
}

function paintDoor(stage: Stage, model: TentModel): void {
  const door = model.door;
  if (door === null) return;
  const { ctx, ts } = stage;
  const westU = door.centreU - door.halfWidth;
  const eastU = door.centreU + door.halfWidth;
  const footD = doorFootDepth(model);
  const lintelH = door.height;
  const corner = (u: number, h: number): Point => project(stage, { u, d: footD, h });

  if (!door.open) {
    // Laced shut: the two flaps meet down the middle, lashed across.
    const centreTop = corner(door.centreU, lintelH);
    const centreFoot = corner(door.centreU, 0);
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, LACE_SEAM_ALPHA);
    ctx.lineWidth = LACE_WIDTH * ts * LACE_SEAM_WIDTH;
    ctx.beginPath();
    ctx.moveTo(centreTop.x, centreTop.y);
    ctx.lineTo(centreFoot.x, centreFoot.y);
    ctx.stroke();
    ctx.strokeStyle = rgb(STRAW.light);
    ctx.lineWidth = LACE_WIDTH * ts;
    ctx.beginPath();
    for (let crossing = 0; crossing < LACE_CROSSINGS; crossing++) {
      const y0 = lerp(centreTop.y, centreFoot.y, (crossing + LACE_CROSSING_START) / LACE_CROSSINGS);
      const y1 = lerp(centreTop.y, centreFoot.y, (crossing + LACE_CROSSING_END) / LACE_CROSSINGS);
      ctx.moveTo(centreTop.x - LACE_HALF_SPAN * ts, y0);
      ctx.lineTo(centreTop.x + LACE_HALF_SPAN * ts, y1);
      ctx.moveTo(centreTop.x + LACE_HALF_SPAN * ts, y0);
      ctx.lineTo(centreTop.x - LACE_HALF_SPAN * ts, y1);
    }
    ctx.stroke();
    return;
  }

  // The mouth: the dark inside of the tent, darkest up under the canvas.
  const topWest = corner(westU, lintelH);
  const topEast = corner(eastU, lintelH);
  const footWest = corner(westU, 0);
  const footEast = corner(eastU, 0);
  const mouth = ctx.createLinearGradient(0, topWest.y, 0, footWest.y);
  mouth.addColorStop(0, rgb(BACKSTAGE.shadow));
  mouth.addColorStop(1, rgb(BACKSTAGE.light));
  ctx.fillStyle = mouth;
  ctx.beginPath();
  ctx.moveTo(topWest.x, topWest.y);
  ctx.lineTo(topEast.x, topEast.y);
  ctx.lineTo(footEast.x, footEast.y);
  ctx.lineTo(footWest.x, footWest.y);
  ctx.closePath();
  ctx.fill();

  // Each flap is hauled back to its side and tied: a bunched fold of canvas
  // with the rope biting into it.
  for (const side of [-1, 1] as const) {
    const edgeU = side < 0 ? westU : eastU;
    const inward = -side;
    const ramp = side < 0 ? model.stripes[0] : model.stripes[1];
    const top = corner(edgeU, lintelH);
    const bulge = corner(edgeU + inward * DOOR_FLAP_BULGE, lintelH * DOOR_FLAP_BULGE_HEIGHT);
    const tie = corner(edgeU + inward * DOOR_TIE_INSET, DOOR_TIE_HEIGHT * lintelH);
    const footIn = corner(edgeU + inward * DOOR_FLAP_FOOT_SPREAD, 0);
    const footOut = corner(edgeU - inward * DOOR_FLAP_FOOT_TUCK, 0);
    const flap = ctx.createLinearGradient(top.x, 0, bulge.x, 0);
    flap.addColorStop(0, rgb(ramp.mid));
    flap.addColorStop(1, rgb(side < 0 ? ramp.light : shade(ramp.mid, DOOR_FLAP_SHADE)));
    ctx.fillStyle = flap;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(bulge.x, bulge.y, tie.x, tie.y);
    ctx.quadraticCurveTo(footIn.x, lerp(tie.y, footIn.y, 0.5), footIn.x, footIn.y);
    ctx.lineTo(footOut.x, footOut.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgb(STRAW.mid);
    ctx.lineWidth = DOOR_ROPE_WIDTH * ts;
    ctx.beginPath();
    ctx.moveTo(tie.x - inward * DOOR_ROPE_WIDTH * ts, tie.y - DOOR_ROPE_WIDTH * ts);
    ctx.lineTo(tie.x + inward * DOOR_FLAP_BULGE * 0.5 * ts, tie.y + DOOR_ROPE_WIDTH * ts);
    ctx.stroke();
  }
}

const KING_POLE_WIDTH = 0.12;
const FINIAL_RADIUS = 0.085;
const FINIAL_SPIKE = 0.14;
const PEAK_RING_RADIUS = 0.13;
/** The finial's glint: up and west of its centre, in finial radii, and this share of its size. */
const FINIAL_GLINT_OFFSET = 0.35;
const FINIAL_GLINT_RISE = 1.35;
const FINIAL_GLINT_RADIUS = 0.35;
const FINIAL_SPIKE_WIDTH = 0.03;

function paintKingPoles(stage: Stage, model: TentModel): void {
  const { ctx, ts } = stage;
  for (const peak of model.peaks) {
    const base = project(stage, { u: peak.u, d: model.centreD, h: peak.h });
    const cap = project(stage, { u: peak.u, d: model.centreD, h: peak.h + model.poleCap });
    const halfWidth = (KING_POLE_WIDTH * ts) / 2;
    ctx.beginPath();
    ctx.rect(cap.x - halfWidth, cap.y, halfWidth * 2, base.y - cap.y);
    ctx.arc(cap.x, cap.y - FINIAL_RADIUS * ts, FINIAL_RADIUS * ts, 0, Math.PI * 2);
    inkOutline(ctx, ts * 2);
    ctx.fillStyle = rgb(ROT_TIMBER.mid);
    ctx.fillRect(cap.x - halfWidth, cap.y, halfWidth * 2, base.y - cap.y);
    ctx.fillStyle = rgb(ROT_TIMBER.light);
    ctx.fillRect(cap.x - halfWidth, cap.y, halfWidth * POLE_LIT_SHARE, base.y - cap.y);
    // The brass collar where the canvas is laced to the pole.
    fillSoftEllipse(
      ctx,
      base.x,
      base.y,
      PEAK_RING_RADIUS * ts,
      PEAK_RING_RADIUS * ts * 0.5,
      rgb(BRASS.mid),
      1,
    );
    ctx.fillStyle = rgb(BRASS.mid);
    ctx.beginPath();
    ctx.arc(cap.x, cap.y - FINIAL_RADIUS * ts, FINIAL_RADIUS * ts, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(BRASS.accent);
    ctx.beginPath();
    ctx.arc(
      cap.x - FINIAL_RADIUS * ts * FINIAL_GLINT_OFFSET,
      cap.y - FINIAL_RADIUS * ts * FINIAL_GLINT_RISE,
      FINIAL_RADIUS * ts * FINIAL_GLINT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = rgb(BRASS.mid);
    ctx.lineWidth = Math.max(1, ts * FINIAL_SPIKE_WIDTH);
    ctx.beginPath();
    ctx.moveTo(cap.x, cap.y - FINIAL_RADIUS * ts * 2);
    ctx.lineTo(cap.x, cap.y - (FINIAL_RADIUS * 2 + FINIAL_SPIKE) * ts);
    ctx.stroke();
  }
}

const RIDGE_ROPE_SAMPLES = 16;
const RIDGE_ROPE_WIDTH = 0.045;

function paintRidgeRope(stage: Stage, model: TentModel): void {
  if (model.peaks.length < 2) return;
  const { ctx, ts } = stage;
  const first = model.peaks[0];
  const last = model.peaks[model.peaks.length - 1];
  ctx.strokeStyle = rgb(STRAW.shadow);
  ctx.lineWidth = RIDGE_ROPE_WIDTH * ts;
  ctx.beginPath();
  for (let sample = 0; sample <= RIDGE_ROPE_SAMPLES; sample++) {
    const u = lerp(first.u, last.u, sample / RIDGE_ROPE_SAMPLES);
    const point = project(stage, { u, d: model.centreD, h: ridgeHeight(model, u) });
    if (sample === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

// ── The whole tent ────────────────────────────────────────────────────────────

const CONTACT_SHADOW_ALPHA = 0.55;
const CONTACT_SHADOW_SPREAD = 0.98;
const CONTACT_SHADOW_DEPTH_SPREAD = 1.08;
/** Wide enough to cover the antialiased hairline between two warped panels. */
const UNDERCOAT_STROKE_PX = 1.5;

/** Paints the tent's body — shadow, canvas, wall, valance, door, poles — with its silhouette inked. */
function paintTent(stage: Stage, model: TentModel, rng: Rng): void {
  const { ctx, ts } = stage;
  const centre = project(stage, { u: model.centreU, d: model.centreD, h: 0 });
  fillSoftEllipse(
    ctx,
    centre.x,
    centre.y,
    model.radiusU * ts * CONTACT_SHADOW_SPREAD,
    model.radiusD * ts * CONTACT_SHADOW_DEPTH_SPREAD,
    rgb(TOWN_CONTACT_SHADOW),
    CONTACT_SHADOW_ALPHA,
  );

  const panels = roofPanels(model);
  const front = panels.filter((panel) => facesViewer(panel.normal));
  front.sort((a, b) => b.depth - a.depth);
  const walls = frontWallIndices(model);
  const wear = rollWear(model, front, forkRng(rng));

  // The outline is stroked at twice its width round every visible face first;
  // the faces painted over it cover its inner half, so only the silhouette's
  // outer edge keeps ink and no seam between two panels ever does.
  ctx.beginPath();
  for (const panel of front) {
    quadPath(ctx, {
      tl: project(stage, panel.topA),
      tr: project(stage, panel.topB),
      br: project(stage, panel.eaveB),
      bl: project(stage, panel.eaveA),
    });
    inkOutline(ctx, ts * 2);
  }
  for (const index of walls) {
    quadPath(ctx, {
      tl: project(stage, eaveAt(model, panelAngle(model, index), model.wallHeight)),
      tr: project(stage, eaveAt(model, panelAngle(model, index + 1), model.wallHeight)),
      br: project(stage, eaveAt(model, panelAngle(model, index + 1), 0)),
      bl: project(stage, eaveAt(model, panelAngle(model, index), 0)),
    });
    inkOutline(ctx, ts * 2);
  }

  // One undercoat under the whole canvas, so the hairlines antialiasing leaves
  // between two warped panels show canvas rather than the ground behind.
  ctx.fillStyle = rgb(shade(model.stripes[1].mid, EAVE_DARKEN));
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = UNDERCOAT_STROKE_PX;
  for (const panel of front) {
    quadPath(ctx, {
      tl: project(stage, panel.topA),
      tr: project(stage, panel.topB),
      br: project(stage, panel.eaveB),
      bl: project(stage, panel.eaveA),
    });
    ctx.fill();
    ctx.stroke();
  }

  for (const index of walls) paintSidewallSegment(stage, model, index, wear);
  const panelRng = forkRng(rng);
  for (const panel of front) paintCanvasPanel(stage, model, panel, wear, panelRng);
  paintRidgeRope(stage, model);
  paintValance(stage, model);
  paintDoor(stage, model);
  paintQuarterPoles(stage, model);
}

// ── Vines ─────────────────────────────────────────────────────────────────────

const VINE_RUNNERS = 5;
const VINE_MIN_RISE = 0.45;
const VINE_MAX_RISE = 1.25;
const VINE_WIDTH = 0.045;
const VINE_SEGMENTS = 6;
const VINE_WANDER = 0.12;
const VINE_LEAVES_PER_RUNNER = 4;
const VINE_LEAF_RADIUS = 0.05;
const VINE_DOOR_MARGIN = 0.5;
/** Runners keep this far in from each end of the front arc, in radians, off the tent's flanks. */
const VINE_ARC_MARGIN = 0.25;
/** Where in its share of the arc each runner roots. */
const VINE_ROOT_MIN_SHARE = 0.2;
const VINE_ROOT_MAX_SHARE = 0.8;
/** Above the wall the vine climbs the sloping canvas, which rises less up the frame than the wall does. */
const VINE_CANVAS_CLIMB = 0.7;
const VINE_LEAF_ASPECT = 0.6;

/** Grimaldi's vine, climbing out from under the skirt and up the canvas. */
function paintVines(stage: Stage, model: TentModel, rng: Rng): void {
  const { ctx, ts } = stage;
  const arc = FRONT_ARC;
  for (let runner = 0; runner < VINE_RUNNERS; runner++) {
    const angle = lerp(
      arc.from + VINE_ARC_MARGIN,
      arc.to - VINE_ARC_MARGIN,
      (runner + range(rng, VINE_ROOT_MIN_SHARE, VINE_ROOT_MAX_SHARE)) / VINE_RUNNERS,
    );
    const foot = eaveAt(model, angle, 0);
    // Kept off the doorway and its tied-back flaps.
    if (
      model.door !== null &&
      Math.abs(foot.u - model.door.centreU) < model.door.halfWidth + VINE_DOOR_MARGIN
    ) {
      continue;
    }
    const rise = range(rng, VINE_MIN_RISE, VINE_MAX_RISE);
    const points: Point[] = [];
    let wander = 0;
    for (let segment = 0; segment <= VINE_SEGMENTS; segment++) {
      wander += range(rng, -VINE_WANDER, VINE_WANDER);
      const h = (segment / VINE_SEGMENTS) * rise;
      const along = eaveAt(model, angle + wander / model.radiusU, Math.min(h, model.wallHeight));
      const above = h > model.wallHeight ? h - model.wallHeight : 0;
      const point = project(stage, along);
      points.push({ x: point.x, y: point.y - above * ts * VINE_CANVAS_CLIMB });
    }
    ctx.strokeStyle = rgb(VINE.shadow);
    ctx.lineWidth = VINE_WIDTH * ts;
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.strokeStyle = rgb(VINE.mid);
    ctx.lineWidth = VINE_WIDTH * ts * 0.5;
    ctx.stroke();
    for (let leaf = 0; leaf < VINE_LEAVES_PER_RUNNER; leaf++) {
      const at = points[rangeInt(rng, 1, points.length - 1)];
      ctx.fillStyle = rgb(leaf % 2 === 0 ? VINE.light : VINE.mid);
      ctx.beginPath();
      ctx.ellipse(
        at.x + range(rng, -VINE_LEAF_RADIUS, VINE_LEAF_RADIUS) * ts,
        at.y,
        VINE_LEAF_RADIUS * ts,
        VINE_LEAF_RADIUS * ts * VINE_LEAF_ASPECT,
        range(rng, 0, Math.PI),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

// ── Guy lines ─────────────────────────────────────────────────────────────────

interface GuyLine {
  /** Where on the eave the line is tied, as a plan angle. */
  readonly angle: number;
  /** The stake, on ground inside the blocked footprint. */
  readonly stake: Vec3;
}

const GUY_LINE_WIDTH = 0.025;
const GUY_LINE_SAG = 0.06;
const STAKE_HEIGHT = 0.1;
const STAKE_WIDTH = 0.05;
const GUY_LINE_ALPHA = 0.9;

function paintGuyLines(stage: Stage, model: TentModel, lines: ReadonlyArray<GuyLine>): void {
  const { ctx, ts } = stage;
  for (const line of lines) {
    const tie = project(stage, eaveAt(model, line.angle, model.wallHeight));
    const stake = project(stage, line.stake);
    const sag = { x: (tie.x + stake.x) / 2, y: (tie.y + stake.y) / 2 + GUY_LINE_SAG * ts };
    ctx.strokeStyle = rgba(STRAW.shadow, GUY_LINE_ALPHA);
    ctx.lineWidth = GUY_LINE_WIDTH * ts;
    ctx.beginPath();
    ctx.moveTo(tie.x, tie.y);
    ctx.quadraticCurveTo(sag.x, sag.y, stake.x, stake.y);
    ctx.stroke();
    ctx.fillStyle = rgb(IRON.mid);
    ctx.fillRect(
      stake.x - (STAKE_WIDTH * ts) / 2,
      stake.y - STAKE_HEIGHT * ts,
      STAKE_WIDTH * ts,
      STAKE_HEIGHT * ts,
    );
  }
}

// ── Boards and lettering ──────────────────────────────────────────────────────

interface SignBoard {
  readonly westU: number;
  readonly eastU: number;
  /** Plan depth the board and its posts stand at. */
  readonly d: number;
  readonly bottomH: number;
  readonly topH: number;
  readonly face: Ramp;
  /** Lines of lettering, top to bottom, each with its height as a fraction of the board's. */
  readonly lines: ReadonlyArray<{ readonly text: string; readonly heightFraction: number }>;
  /** Posts from the ground to the board, or none when the board hangs from the canvas. */
  readonly posts: boolean;
  /** Dead bulbs round the border, or none. */
  readonly bulbs: boolean;
}

const BOARD_TRIM = 0.05;
const BOARD_POST_WIDTH = 0.08;
const BOARD_POST_INSET = 0.12;
const BULB_SPACING = 0.2;
const BULB_RADIUS = 0.035;
/** Every so many bulbs one is gone altogether, leaving its socket. */
const BROKEN_BULB_CHANCE = 0.18;
const LINE_GAP_FRACTION = 0.08;
const LETTER_SOAK_ALPHA = 0.3;
const BOARD_POST_SHADOW_ALPHA = 0.5;
/** A surviving bulb's dead glass inside its brass socket, as a share of the socket's radius. */
const BULB_GLASS_RADIUS_SHARE = 0.72;
/** The sky's glint in dead glass: a small square up and west of centre, in bulb radii. */
const BULB_GLINT_ALPHA = 0.7;
const BULB_GLINT_WEST = 0.4;
const BULB_GLINT_RISE = 0.45;
const BULB_GLINT_SIZE = 0.35;
/** Lettering keeps two trims' width clear of each side of the board. */
const LETTERING_SIDE_MARGIN_TRIMS = 2;

function letteringPigment(board: Ramp): BrushPigment {
  return {
    body: rgb(BONE.light),
    buildUp: rgb(BONE.accent),
    wetEdge: rgb(BONE.mid),
    bareSurface: rgb(board.mid),
    soak: rgba(BONE.light, LETTER_SOAK_ALPHA),
  };
}

/** A bulb on a board's border, in tiles on its structure's footprint (see `circusOverlayAnchors.ts`). */
export interface CircusBulb {
  readonly x: number;
  readonly up: number;
  /** Gone altogether, leaving only its socket: never lit, whatever the ambience does. */
  readonly broken: boolean;
}

const BULB_HASH_MULTIPLIER = 0x9e3779b1;
const BULB_HASH_SHIFT = 15;
const UINT32_SPAN = 0x100000000;

/** Whether the bulb at `index` round a border is broken: fixed by its place, so the live glow can skip it too. */
function isBrokenBulb(index: number): boolean {
  const mixed = Math.imul(index + 1, BULB_HASH_MULTIPLIER) >>> 0;
  const hashed = (mixed ^ (mixed >>> BULB_HASH_SHIFT)) >>> 0;
  return hashed / UINT32_SPAN < BROKEN_BULB_CHANCE;
}

/**
 * The bulbs round a board's border, clockwise from its top-left corner, set
 * in half the trim's width. `up` folds the board's plan depth into its height,
 * as the game's projection does.
 */
function boardBulbs(board: SignBoard): CircusBulb[] {
  const width = board.eastU - board.westU;
  const height = board.topH - board.bottomH;
  const inset = BOARD_TRIM / 2;
  const perimeter = 2 * (width + height);
  const count = Math.floor(perimeter / BULB_SPACING);
  const bulbs: CircusBulb[] = [];
  const top = board.d + board.topH;
  const bottom = board.d + board.bottomH;
  for (let index = 0; index < count; index++) {
    let along = (index / count) * perimeter;
    let x: number;
    let up: number;
    if (along < width) {
      x = board.westU + along;
      up = top - inset;
    } else if ((along -= width) < height) {
      x = board.eastU - inset;
      up = top - along;
    } else if ((along -= height) < width) {
      x = board.eastU - along;
      up = bottom + inset;
    } else {
      along -= width;
      x = board.westU + inset;
      up = bottom + along;
    }
    bulbs.push({ x, up, broken: isBrokenBulb(index) });
  }
  return bulbs;
}

function paintSignBoard(stage: Stage, board: SignBoard, rng: Rng): void {
  const { ctx, ts } = stage;
  const topLeft = project(stage, { u: board.westU, d: board.d, h: board.topH });
  const bottomRight = project(stage, { u: board.eastU, d: board.d, h: board.bottomH });
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  if (board.posts) {
    const postHalf = (BOARD_POST_WIDTH * ts) / 2;
    for (const u of [board.westU + BOARD_POST_INSET, board.eastU - BOARD_POST_INSET]) {
      const foot = project(stage, { u, d: board.d, h: 0 });
      ctx.beginPath();
      ctx.rect(foot.x - postHalf, topLeft.y, postHalf * 2, foot.y - topLeft.y);
      inkOutline(ctx, ts * 2);
      ctx.fillStyle = rgb(ROT_TIMBER.mid);
      ctx.fillRect(foot.x - postHalf, topLeft.y, postHalf * 2, foot.y - topLeft.y);
      ctx.fillStyle = rgb(ROT_TIMBER.light);
      ctx.fillRect(foot.x - postHalf, topLeft.y, postHalf * POLE_LIT_SHARE, foot.y - topLeft.y);
      fillSoftEllipse(
        ctx,
        foot.x,
        foot.y,
        postHalf * 2,
        postHalf,
        rgb(TOWN_CONTACT_SHADOW),
        BOARD_POST_SHADOW_ALPHA,
      );
    }
  }

  ctx.beginPath();
  ctx.rect(topLeft.x, topLeft.y, width, height);
  inkOutline(ctx, ts * 2);
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.fillRect(topLeft.x, topLeft.y, width, height);
  const trim = BOARD_TRIM * ts;
  const faceGradient = ctx.createLinearGradient(0, topLeft.y, 0, topLeft.y + height);
  faceGradient.addColorStop(0, rgb(board.face.light));
  faceGradient.addColorStop(1, rgb(board.face.mid));
  ctx.fillStyle = faceGradient;
  ctx.fillRect(topLeft.x + trim, topLeft.y + trim, width - trim * 2, height - trim * 2);

  if (board.bulbs) {
    const radius = BULB_RADIUS * ts;
    for (const bulb of boardBulbs(board)) {
      const centre = project(stage, { u: bulb.x, d: 0, h: bulb.up });
      ctx.fillStyle = rgb(BRASS.shadow);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (bulb.broken) continue;
      // Dead glass: grey-amber, with only the sky's glint in it.
      ctx.fillStyle = rgb(mix(BACKSTAGE.light, STRAW.shadow, 0.5));
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius * BULB_GLASS_RADIUS_SHARE, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(BONE.accent, BULB_GLINT_ALPHA);
      const glintSize = radius * BULB_GLINT_SIZE;
      ctx.fillRect(
        centre.x - radius * BULB_GLINT_WEST,
        centre.y - radius * BULB_GLINT_RISE,
        glintSize,
        glintSize,
      );
    }
  }

  const inner = height - trim * 2;
  const totalFraction = board.lines.reduce((sum, line) => sum + line.heightFraction, 0);
  const gaps = (board.lines.length + 1) * LINE_GAP_FRACTION * inner;
  const scale = Math.min(1, (inner - gaps) / (totalFraction * inner));
  let cursor = topLeft.y + trim + LINE_GAP_FRACTION * inner;
  const centreX = topLeft.x + width / 2;
  const pigment = letteringPigment(board.face);
  for (const line of board.lines) {
    let letterHeight = line.heightFraction * inner * scale;
    const available = width - trim * LETTERING_SIDE_MARGIN_TRIMS * 2;
    const measured = wordWidth(line.text, letterHeight);
    if (measured > available) letterHeight *= available / measured;
    paintWord(ctx, line.text, centreX, cursor, letterHeight, pigment, rng);
    cursor += line.heightFraction * inner * scale + LINE_GAP_FRACTION * inner;
  }
}

// ── The Big Top ───────────────────────────────────────────────────────────────

const BIG_TOP = CIRCUS_STRUCTURES.big_top;
/**
 * A tenth of a tile in from the footprint's east and west edges, so the
 * canvas never touches the frame's border; at that size the ellipse's base
 * is still more than a tile in from the long sides at a corner column.
 */
const BIG_TOP_EDGE_INSET = 0.1;

const BIG_TOP_MODEL: TentModel = {
  centreU: BIG_TOP.w / 2,
  centreD: BIG_TOP_KING_POLE_DEPTH_TILES,
  radiusU: BIG_TOP.w / 2 - BIG_TOP_EDGE_INSET,
  radiusD: BIG_TOP.h / 2,
  wallHeight: 0.85,
  peaks: BIG_TOP_KING_POLES.map((pole) => ({ u: pole.x, h: pole.heightTiles })),
  ridgeSag: 0.55,
  panelCount: 48,
  stripes: [BLOOD, BONE],
  valance: BLOOD,
  valanceTrim: BONE,
  valanceDrop: 0.2,
  quarterPoleEvery: 4,
  door:
    BIG_TOP.door === undefined
      ? null
      : {
          centreU: BIG_TOP.door.dx + BIG_TOP.door.width / 2,
          halfWidth: 0.72,
          height: 1.3,
          open: true,
        },
  poleCap: 0.42,
};

/** Stakes stand on the ground the ellipse leaves inside the blocked tiles: the front corners and the ends. */
const BIG_TOP_GUY_LINES: ReadonlyArray<GuyLine> = [
  { angle: Math.PI * 1.1, stake: { u: 0.3, d: 1.25, h: 0 } },
  { angle: Math.PI * 1.25, stake: { u: 1.5, d: 0.2, h: 0 } },
  { angle: Math.PI * 1.75, stake: { u: 10.5, d: 0.2, h: 0 } },
  { angle: Math.PI * 1.9, stake: { u: 11.7, d: 1.25, h: 0 } },
];

const MARQUEE: Omit<SignBoard, 'bottomH' | 'topH'> = {
  westU: 4.25,
  eastU: 7.75,
  d: 0.02,
  face: BRUISE,
  lines: [{ text: "GRIMALDI'S", heightFraction: 1 }],
  posts: true,
  bulbs: true,
};
/** The marquee hangs just clear of the door's head. */
const MARQUEE_BOTTOM_ABOVE_DOOR = 0.06;
const MARQUEE_HEIGHT = 0.72;

const BIG_TOP_DOOR_HEIGHT = BIG_TOP_MODEL.door?.height ?? BIG_TOP_MODEL.wallHeight;

const BIG_TOP_MARQUEE: SignBoard = {
  ...MARQUEE,
  bottomH: BIG_TOP_DOOR_HEIGHT + MARQUEE_BOTTOM_ABOVE_DOOR,
  topH: BIG_TOP_DOOR_HEIGHT + MARQUEE_BOTTOM_ABOVE_DOOR + MARQUEE_HEIGHT,
};

/** The marquee's bulbs, where the painter sets their dead glass and the live glow lights them. */
export const BIG_TOP_MARQUEE_BULBS: ReadonlyArray<CircusBulb> = boardBulbs(BIG_TOP_MARQUEE);
export const BIG_TOP_MARQUEE_BULB_RADIUS_TILES = BULB_RADIUS;

/**
 * The Big Top's open doorway, in tiles on its footprint: `x` is the door's
 * centre from the west edge, `footUp` where its threshold meets the frame,
 * `height` its head above that. The warm light inside spills from here.
 */
export const BIG_TOP_DOOR_MOUTH: {
  readonly x: number;
  readonly halfWidth: number;
  readonly height: number;
  readonly footUp: number;
} = {
  x: BIG_TOP_MODEL.door?.centreU ?? BIG_TOP.w / 2,
  halfWidth: BIG_TOP_MODEL.door?.halfWidth ?? 0,
  height: BIG_TOP_DOOR_HEIGHT,
  footUp: doorFootDepth(BIG_TOP_MODEL),
};

const paintBigTop: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, BIG_TOP);
  paintTent(stage, BIG_TOP_MODEL, forkRng(rng));
  paintVines(stage, BIG_TOP_MODEL, forkRng(rng));
  paintGuyLines(stage, BIG_TOP_MODEL, BIG_TOP_GUY_LINES);
  paintSignBoard(stage, BIG_TOP_MARQUEE, forkRng(rng));
  paintKingPoles(stage, BIG_TOP_MODEL);
};

// ── The side-show pavilions ───────────────────────────────────────────────────

const PAVILION = CIRCUS_STRUCTURES.pavilion_mold_lion;
const PAVILION_EDGE_INSET = 0.1;

function pavilionModel(stripe: Ramp, open: boolean): TentModel {
  return {
    centreU: PAVILION.w / 2,
    centreD: PAVILION.h / 2,
    radiusU: PAVILION.w / 2 - PAVILION_EDGE_INSET,
    radiusD: PAVILION.h / 2 - PAVILION_EDGE_INSET,
    wallHeight: 0.62,
    peaks: [{ u: PAVILION.w / 2, h: PAVILION_PEAK_HEIGHT_TILES }],
    ridgeSag: 0,
    panelCount: 20,
    stripes: [stripe, BONE],
    valance: stripe,
    valanceTrim: BRASS,
    valanceDrop: 0.14,
    quarterPoleEvery: 5,
    door: { centreU: PAVILION.w / 2, halfWidth: 0.3, height: 0.82, open },
    poleCap: PAVILION_POLE_CAP_TILES,
  };
}

const SIGN_BOTTOM_H = 0.95;
const SIGN_TOP_H = 1.62;
const SIGN_WEST_U = 0.18;
const SIGN_D = 0.08;

function pavilionPainter(
  stripe: Ramp,
  board: Ramp,
  open: boolean,
  lines: SignBoard['lines'],
): CircusPainter {
  const model = pavilionModel(stripe, open);
  return (ctx, frame, _variant, rng) => {
    const stage = stageFor(ctx, frame, PAVILION);
    paintTent(stage, model, forkRng(rng));
    paintSignBoard(
      stage,
      {
        westU: SIGN_WEST_U,
        eastU: PAVILION.w - SIGN_WEST_U,
        d: SIGN_D,
        bottomH: SIGN_BOTTOM_H,
        topH: SIGN_TOP_H,
        face: board,
        lines,
        posts: true,
        bulbs: false,
      },
      forkRng(rng),
    );
    paintKingPoles(stage, model);
  };
}

// ── The arch post ─────────────────────────────────────────────────────────────

const ARCH_POST = CIRCUS_STRUCTURES.arch_post;
const ARCH_POST_WIDTH = 0.26;
const ARCH_PLINTH_WIDTH = 0.44;
const ARCH_PLINTH_HEIGHT = 0.22;
const ARCH_BAND_PITCH = 0.28;
const ARCH_BAND_SLANT = 0.16;
const ARCH_FINIAL_RADIUS = 0.1;
const ARCH_SHADE_ALPHA = 0.45;
/** The post's contact shadow spreads past its plinth and is squashed flat on the ground, in plinth half-widths. */
const ARCH_SHADOW_SPREAD = 1.3;
const ARCH_SHADOW_DEPTH = 0.55;
const ARCH_SHADOW_ALPHA = 0.6;
/** The plinth's sunlit top lip. */
const ARCH_PLINTH_LIP_TILES = 0.04;
/** The painted pole's sunlit west edge, fading to nothing by this share of its width. */
const ARCH_SHEEN_ALPHA = 0.18;
const ARCH_SHEEN_FADE_STOP = 0.45;
/** How far up the post its plinth's occlusion reaches, in tiles. */
const ARCH_PLINTH_AO_TILES = 0.3;
const ARCH_FINIAL_GLINT_RISE = 1.3;

const paintArchPost: CircusPainter = (ctx, frame) => {
  const stage = stageFor(ctx, frame, ARCH_POST);
  const { ts } = stage;
  const foot = project(stage, { u: 0.5, d: 0.5, h: 0 });
  const cap = project(stage, { u: 0.5, d: 0.5, h: CIRCUS_ARCH_POST_HEIGHT_TILES });
  const halfWidth = (ARCH_POST_WIDTH * ts) / 2;
  const plinthHalf = (ARCH_PLINTH_WIDTH * ts) / 2;
  const plinthTop = foot.y - ARCH_PLINTH_HEIGHT * ts;
  fillSoftEllipse(
    ctx,
    foot.x,
    foot.y,
    plinthHalf * ARCH_SHADOW_SPREAD,
    plinthHalf * ARCH_SHADOW_DEPTH,
    rgb(TOWN_CONTACT_SHADOW),
    ARCH_SHADOW_ALPHA,
  );

  const outlinePath = (): void => {
    ctx.beginPath();
    ctx.rect(foot.x - plinthHalf, plinthTop, plinthHalf * 2, foot.y - plinthTop);
    ctx.rect(foot.x - halfWidth, cap.y, halfWidth * 2, plinthTop - cap.y);
    ctx.arc(foot.x, cap.y - ARCH_FINIAL_RADIUS * ts, ARCH_FINIAL_RADIUS * ts, 0, Math.PI * 2);
  };
  outlinePath();
  inkOutline(ctx, ts * 2);

  ctx.fillStyle = rgb(ROT_TIMBER.mid);
  ctx.fillRect(foot.x - plinthHalf, plinthTop, plinthHalf * 2, foot.y - plinthTop);
  ctx.fillStyle = rgb(ROT_TIMBER.light);
  ctx.fillRect(foot.x - plinthHalf, plinthTop, plinthHalf * 2, ts * ARCH_PLINTH_LIP_TILES);

  ctx.save();
  ctx.beginPath();
  ctx.rect(foot.x - halfWidth, cap.y, halfWidth * 2, plinthTop - cap.y);
  ctx.clip();
  ctx.fillStyle = rgb(BONE.mid);
  ctx.fillRect(foot.x - halfWidth, cap.y, halfWidth * 2, plinthTop - cap.y);
  ctx.fillStyle = rgb(BLOOD.mid);
  const pitch = ARCH_BAND_PITCH * ts;
  for (let y = cap.y - pitch; y < plinthTop + pitch; y += pitch) {
    ctx.beginPath();
    ctx.moveTo(foot.x - halfWidth, y);
    ctx.lineTo(foot.x + halfWidth, y - ARCH_BAND_SLANT * ts);
    ctx.lineTo(foot.x + halfWidth, y - ARCH_BAND_SLANT * ts + pitch / 2);
    ctx.lineTo(foot.x - halfWidth, y + pitch / 2);
    ctx.closePath();
    ctx.fill();
  }
  // Round: lit on the sun side, falling off to the shade side.
  const round = ctx.createLinearGradient(foot.x - halfWidth, 0, foot.x + halfWidth, 0);
  round.addColorStop(0, rgba(BONE.accent, ARCH_SHEEN_ALPHA));
  round.addColorStop(ARCH_SHEEN_FADE_STOP, rgba(TOWN_CONTACT_SHADOW, 0));
  round.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, ARCH_SHADE_ALPHA));
  ctx.fillStyle = round;
  ctx.fillRect(foot.x - halfWidth, cap.y, halfWidth * 2, plinthTop - cap.y);
  ctx.restore();
  const plinthAo = ts * ARCH_PLINTH_AO_TILES;
  paintEdgeAoAt(ctx, foot.x - halfWidth, plinthTop - plinthAo, halfWidth * 2, plinthAo);

  ctx.fillStyle = rgb(BRASS.mid);
  ctx.beginPath();
  ctx.arc(foot.x, cap.y - ARCH_FINIAL_RADIUS * ts, ARCH_FINIAL_RADIUS * ts, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(BRASS.accent);
  ctx.beginPath();
  ctx.arc(
    foot.x - ARCH_FINIAL_RADIUS * ts * FINIAL_GLINT_OFFSET,
    cap.y - ARCH_FINIAL_RADIUS * ts * ARCH_FINIAL_GLINT_RISE,
    ARCH_FINIAL_RADIUS * ts * FINIAL_GLINT_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();
};

const EDGE_AO_ALPHA = 0.35;

/** The wood's own shade where the post meets its plinth — a gradient, never a bar. */
function paintEdgeAoAt(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, y + height, 0, y);
  gradient.addColorStop(0, rgba(TOWN_CONTACT_SHADOW, EDGE_AO_ALPHA));
  gradient.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
}

// ── The rim: shared kit ───────────────────────────────────────────────────────
//
// The rim props are one row deep and seen from the south, so every face that
// matters is a front face standing on the footprint and a lid seen from above
// it. They are painted straight in footprint terms: `u` tiles east from the
// footprint's west edge and `up` tiles above its south edge, which already
// folds depth and height together the way the game's projection does.

/** A frame point from footprint tiles: `u` east of the west edge, `up` above the ground line. */
function at(stage: Stage, u: number, up: number): Point {
  return { x: stage.left + u * stage.ts, y: stage.ground - up * stage.ts };
}

/** A footprint rectangle, `u0`–`u1` across and `up0`–`up1` high, as a frame rectangle. */
interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function rectAt(stage: Stage, u0: number, u1: number, up0: number, up1: number): FrameRect {
  const topLeft = at(stage, u0, up1);
  const bottomRight = at(stage, u1, up0);
  return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
}

/** Lit from the upper left: the west end of a face catches the sun, the east end falls away. */
const FACE_SUN_MIX = 0.3;
const FACE_FAR_SHADE = 0.74;
/** The foot of every face sits in its own occlusion. */
const FACE_FOOT_AO_ALPHA = 0.35;
const FACE_FOOT_AO_REACH = 0.3;
/** A lid's far edge sinks this far from its palest tone toward the ramp's mid. */
const LID_FAR_MIX = 0.55;

function paintFace(ctx: Ctx, rect: FrameRect, ramp: Ramp, footAo = true): void {
  const gradient = ctx.createLinearGradient(rect.x, 0, rect.x + rect.w, 0);
  gradient.addColorStop(0, rgb(mix(ramp.mid, ramp.light, FACE_SUN_MIX)));
  gradient.addColorStop(1, rgb(shade(ramp.mid, FACE_FAR_SHADE)));
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (!footAo) return;
  const reach = rect.h * FACE_FOOT_AO_REACH;
  const ao = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y + rect.h - reach);
  ao.addColorStop(0, rgba(TOWN_CONTACT_SHADOW, FACE_FOOT_AO_ALPHA));
  ao.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, 0));
  ctx.fillStyle = ao;
  ctx.fillRect(rect.x, rect.y + rect.h - reach, rect.w, reach);
}

/** A lid or deck seen from above: the palest the ramp goes, darkening toward its far (upper) edge. */
function paintLid(ctx: Ctx, rect: FrameRect, ramp: Ramp): void {
  const gradient = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y);
  gradient.addColorStop(0, rgb(ramp.light));
  gradient.addColorStop(1, rgb(mix(ramp.light, ramp.mid, LID_FAR_MIX)));
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/** A soft pool of shadow on the ground under a prop, kept inside its own columns. */
function paintRimShadow(stage: Stage, u0: number, u1: number, depthUp: number): void {
  const { ctx, ts } = stage;
  const centre = at(stage, (u0 + u1) / 2, depthUp);
  fillSoftEllipse(
    ctx,
    centre.x,
    centre.y,
    ((u1 - u0) / 2) * ts,
    depthUp * ts * RIM_SHADOW_DEPTH_SPREAD,
    rgb(TOWN_CONTACT_SHADOW),
    RIM_SHADOW_ALPHA,
  );
}
const RIM_SHADOW_ALPHA = 0.5;
const RIM_SHADOW_DEPTH_SPREAD = 0.9;

/** Flaked paint: a few small irregular chips of the surface under it. */
function paintFlakes(ctx: Ctx, rect: FrameRect, count: number, under: RGB, rng: Rng): void {
  ctx.fillStyle = rgb(under);
  for (let flake = 0; flake < count; flake++) {
    const x = rect.x + range(rng, FLAKE_MARGIN, 1 - FLAKE_MARGIN) * rect.w;
    const y = rect.y + range(rng, FLAKE_MARGIN, 1 - FLAKE_MARGIN) * rect.h;
    const size = Math.min(rect.w, rect.h) * range(rng, FLAKE_MIN, FLAKE_MAX);
    ctx.beginPath();
    for (const vertex of FLAKE_OUTLINE) ctx.lineTo(x + size * vertex.x, y + size * vertex.y);
    ctx.closePath();
    ctx.fill();
  }
}
const FLAKE_MIN = 0.06;
const FLAKE_MAX = 0.16;
/** Flakes land this far in from every edge of the face, as a share of it. */
const FLAKE_MARGIN = 0.05;
/** A flake's chipped outline, in flake sizes from its centre. */
const FLAKE_OUTLINE: ReadonlyArray<Point> = [
  { x: 0, y: -0.6 },
  { x: 0.7, y: -0.1 },
  { x: 0.3, y: 0.5 },
  { x: -0.5, y: 0.3 },
];

/** A crack: a jagged dark line from one point to another. */
function paintCrack(ctx: Ctx, from: Point, to: Point, widthPx: number, rng: Rng): void {
  const steps = CRACK_STEPS;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const normalX = -(to.y - from.y) / Math.max(1, length);
  const normalY = (to.x - from.x) / Math.max(1, length);
  ctx.strokeStyle = rgba(TOWN_INK, CRACK_ALPHA);
  ctx.lineWidth = widthPx;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const kink = range(rng, -1, 1) * length * CRACK_KINK;
    ctx.lineTo(lerp(from.x, to.x, t) + normalX * kink, lerp(from.y, to.y, t) + normalY * kink);
  }
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}
const CRACK_STEPS = 5;
const CRACK_KINK = 0.12;
const CRACK_ALPHA = 0.8;

/** Grime run down a face from its top: a darker fade, a few of them per face. */
function paintRunoff(ctx: Ctx, rect: FrameRect, count: number, rng: Rng): void {
  for (let run = 0; run < count; run++) {
    const width = rect.w * range(rng, RUNOFF_MIN_WIDTH, RUNOFF_MAX_WIDTH);
    const x = rect.x + range(rng, 0, rect.w - width);
    const length = rect.h * range(rng, RUNOFF_MIN_LENGTH, 1);
    const gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + length);
    gradient.addColorStop(0, rgba(TOWN_CONTACT_SHADOW, RUNOFF_ALPHA));
    gradient.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, rect.y, width, length);
  }
}
const RUNOFF_MIN_WIDTH = 0.04;
const RUNOFF_MAX_WIDTH = 0.1;
const RUNOFF_MIN_LENGTH = 0.4;
const RUNOFF_ALPHA = 0.22;

/** Every rim prop's silhouette is inked once, as the tents are: stroked wide, then painted over. */
function inkSilhouette(stage: Stage, trace: (ctx: Ctx) => void): void {
  const { ctx, ts } = stage;
  ctx.beginPath();
  trace(ctx);
  inkOutline(ctx, ts * 2);
}

function traceRect(ctx: Ctx, rect: FrameRect): void {
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
}

/** A rectangle whose top corners are rounded to `radius`: a barrel roof seen side on. */
function traceRoundTop(
  path: Ctx,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): void {
  path.moveTo(left, bottom);
  path.lineTo(left, top + radius);
  path.arcTo(left, top, left + radius, top, radius);
  path.lineTo(right - radius, top);
  path.arcTo(right, top, right, top + radius, radius);
  path.lineTo(right, bottom);
  path.closePath();
}

function traceCircle(ctx: Ctx, centre: Point, radius: number): void {
  ctx.moveTo(centre.x + radius, centre.y);
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
}

// ── Wagons ────────────────────────────────────────────────────────────────────

const WAGON = CIRCUS_STRUCTURES.cage_wagon;
/** The wagon's near wheels, centred this far in from each end, on the side facing the viewer. */
const WAGON_WHEEL_INSET = 0.58;
const WAGON_WHEEL_RADIUS = 0.34;
const WAGON_WHEEL_HUB_UP = 0.36;
const WAGON_WHEEL_SPOKES = 8;
const WAGON_WHEEL_RIM_SHARE = 0.2;
const WAGON_HUB_SHARE = 0.2;
/** The body's front face, from the chassis up. */
const WAGON_BODY_WEST = 0.14;
const WAGON_CHASSIS_BOTTOM = 0.44;
const WAGON_CHASSIS_TOP = 0.58;
/** How far a lid seen from above climbs the frame: the wagon's depth behind its front face. */
const WAGON_LID_DEPTH = 0.55;

function wagonEast(): number {
  return WAGON.w - WAGON_BODY_WEST;
}

function wagonWheelCentres(stage: Stage): Point[] {
  return [
    at(stage, WAGON_WHEEL_INSET, WAGON_WHEEL_HUB_UP),
    at(stage, WAGON.w - WAGON_WHEEL_INSET, WAGON_WHEEL_HUB_UP),
  ];
}

function paintWheel(stage: Stage, centre: Point, rng: Rng): void {
  const { ctx, ts } = stage;
  const radius = WAGON_WHEEL_RADIUS * ts;
  const rimWidth = radius * WAGON_WHEEL_RIM_SHARE;
  // The spokes and the ground seen between them.
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, WHEEL_GAP_SHADE);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius - rimWidth, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(ROT_TIMBER.mid);
  ctx.lineWidth = rimWidth * WHEEL_SPOKE_SHARE;
  ctx.beginPath();
  const twist = range(rng, 0, Math.PI);
  for (let spoke = 0; spoke < WAGON_WHEEL_SPOKES; spoke++) {
    const angle = twist + (spoke / WAGON_WHEEL_SPOKES) * Math.PI * 2;
    ctx.moveTo(centre.x, centre.y);
    ctx.lineTo(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
  }
  ctx.stroke();
  // The felloe: timber rim with an iron tyre, lit at the top left.
  ctx.strokeStyle = rgb(ROT_TIMBER.shadow);
  ctx.lineWidth = rimWidth;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius - rimWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgb(ROT_TIMBER.light);
  ctx.lineWidth = rimWidth * WHEEL_GLINT_SHARE;
  ctx.beginPath();
  ctx.arc(
    centre.x,
    centre.y,
    radius - rimWidth / 2,
    Math.PI * WHEEL_GLINT_START_TURNS,
    Math.PI * WHEEL_GLINT_END_TURNS,
  );
  ctx.stroke();
  ctx.fillStyle = rgb(IRON.mid);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius * WAGON_HUB_SHARE, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(IRON.accent);
  ctx.beginPath();
  const hubGlint = radius * WAGON_HUB_SHARE * HUB_GLINT_SHARE;
  ctx.arc(centre.x - hubGlint, centre.y - hubGlint, hubGlint, 0, Math.PI * 2);
  ctx.fill();
}
const WHEEL_GAP_SHADE = 0.45;
const WHEEL_SPOKE_SHARE = 0.55;
const WHEEL_GLINT_SHARE = 0.45;
/** The rim's glint runs round its upper-left arc, in half-turns from due east. */
const WHEEL_GLINT_START_TURNS = 1.05;
const WHEEL_GLINT_END_TURNS = 1.55;
/** The hub's glint sits up and west of its centre and is this share of the hub, in each. */
const HUB_GLINT_SHARE = 0.35;

/** The chassis beam every wagon stands its body on, with its blood-red trim line. */
function paintChassis(stage: Stage): void {
  const { ctx } = stage;
  const beam = rectAt(stage, WAGON_BODY_WEST, wagonEast(), WAGON_CHASSIS_BOTTOM, WAGON_CHASSIS_TOP);
  paintFace(ctx, beam, ROT_TIMBER, false);
  ctx.fillStyle = rgb(BLOOD.mid);
  ctx.fillRect(beam.x, beam.y + beam.h * TRIM_TOP_SHARE, beam.w, beam.h * TRIM_HEIGHT_SHARE);
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, CHASSIS_UNDERSIDE_ALPHA);
  ctx.fillRect(
    beam.x,
    beam.y + beam.h * (1 - TRIM_HEIGHT_SHARE),
    beam.w,
    beam.h * TRIM_HEIGHT_SHARE,
  );
}
const TRIM_TOP_SHARE = 0.3;
const TRIM_HEIGHT_SHARE = 0.3;
const CHASSIS_UNDERSIDE_ALPHA = 0.4;

/** The wagon's dark underside between its wheels, and the ground shadow under it. */
function paintWagonUnderside(stage: Stage): void {
  paintRimShadow(stage, WAGON_BODY_WEST, wagonEast(), WAGON_SHADOW_DEPTH_UP);
}
const WAGON_SHADOW_DEPTH_UP = 0.42;

// Cage wagon.
const CAGE_TOP = 1.5;
const CAGE_ROOF_TOP = 1.64;
const CAGE_BAR_PITCH = 0.17;
const CAGE_BAR_WIDTH = 0.045;
const CAGE_POST_WIDTH = 0.12;
/** The bent pair: spread apart at the middle, as if something forced its way out. */
const CAGE_BENT_BAR_U = 1.78;
const CAGE_BENT_SPREAD = 0.13;
const CAGE_STRAW_TOP = 0.86;
const CAGE_BACK_WALL_SHARE = 0.55;

const paintCageWagon: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, WAGON);
  const { ts } = stage;
  const east = wagonEast();
  const wheels = wagonWheelCentres(stage);
  const body = rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_TOP, CAGE_TOP);
  const roof = rectAt(
    stage,
    WAGON_BODY_WEST - CAGE_ROOF_OVERHANG,
    east + CAGE_ROOF_OVERHANG,
    CAGE_TOP,
    CAGE_ROOF_TOP,
  );
  const lid = rectAt(stage, WAGON_BODY_WEST, east, CAGE_ROOF_TOP, CAGE_ROOF_TOP + CAGE_LID_DEPTH);
  paintWagonUnderside(stage);
  inkSilhouette(stage, (path) => {
    traceRect(path, rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_BOTTOM, CAGE_TOP));
    traceRect(path, roof);
    traceRect(path, lid);
    for (const wheel of wheels) traceCircle(path, wheel, WAGON_WHEEL_RADIUS * ts);
  });

  paintChassis(stage);
  // Inside the cage: the dark, the back wall's boards, the straw and what is left in it.
  const inside = ctx.createLinearGradient(0, body.y, 0, body.y + body.h);
  inside.addColorStop(0, rgb(BACKSTAGE.mid));
  inside.addColorStop(1, rgb(BACKSTAGE.light));
  ctx.fillStyle = inside;
  ctx.fillRect(body.x, body.y, body.w, body.h);
  ctx.fillStyle = rgba(ROT_TIMBER.shadow, CAGE_BACK_WALL_SHARE);
  for (let board = 0; board < CAGE_BACK_BOARDS; board++) {
    const y = body.y + (board / CAGE_BACK_BOARDS) * body.h * CAGE_BACK_WALL_SHARE;
    ctx.fillRect(body.x, y, body.w, 1);
  }
  paintStrawBed(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_TOP, CAGE_STRAW_TOP, rng);
  paintBones(stage, rng);

  // The bars, one of them wrenched aside.
  ctx.lineCap = 'butt';
  for (
    let u = WAGON_BODY_WEST + CAGE_POST_WIDTH + CAGE_BAR_PITCH / 2;
    u < east - CAGE_POST_WIDTH;
    u += CAGE_BAR_PITCH
  ) {
    const bentSide =
      Math.abs(u - CAGE_BENT_BAR_U) < CAGE_BAR_PITCH ? Math.sign(u - CAGE_BENT_BAR_U) || 1 : 0;
    const top = at(stage, u, CAGE_TOP);
    const foot = at(stage, u, WAGON_CHASSIS_TOP);
    const bow = bentSide * CAGE_BENT_SPREAD * ts;
    const mid = { x: top.x + bow, y: lerp(top.y, foot.y, CAGE_BEND_HEIGHT) };
    for (const [colour, widthShare, offset] of [
      [IRON.shadow, 1, 0],
      [IRON.light, CAGE_BAR_GLINT_SHARE, -CAGE_BAR_WIDTH * ts * CAGE_BAR_GLINT_OFFSET],
    ] as const) {
      ctx.strokeStyle = rgb(colour);
      ctx.lineWidth = CAGE_BAR_WIDTH * ts * widthShare;
      ctx.beginPath();
      ctx.moveTo(top.x + offset, top.y);
      ctx.quadraticCurveTo(mid.x + offset, mid.y, foot.x + offset, foot.y);
      ctx.stroke();
    }
  }
  // Corner posts and the rail along the top.
  for (const u of [WAGON_BODY_WEST, east - CAGE_POST_WIDTH]) {
    paintFace(
      ctx,
      rectAt(stage, u, u + CAGE_POST_WIDTH, WAGON_CHASSIS_TOP, CAGE_TOP),
      ROT_TIMBER,
      false,
    );
  }
  paintFace(ctx, roof, BLOOD, false);
  paintFlakes(ctx, roof, CAGE_ROOF_FLAKES, ROT_TIMBER.mid, rng);
  ctx.fillStyle = rgb(BONE.mid);
  const roofTrim = Math.max(1, roof.h * CAGE_ROOF_TRIM_SHARE);
  ctx.fillRect(roof.x, roof.y + roof.h - roofTrim, roof.w, roofTrim);
  paintLid(ctx, lid, BLOOD);
  ctx.fillStyle = rgba(BLOOD.shadow, PLANK_SEAM_ALPHA);
  for (let plank = 1; plank < CAGE_LID_PLANKS; plank++) {
    ctx.fillRect(lid.x, lid.y + (plank / CAGE_LID_PLANKS) * lid.h, lid.w, 1);
  }
  paintFlakes(ctx, lid, CAGE_ROOF_FLAKES, ROT_TIMBER.mid, rng);
  paintRunoff(ctx, lid, CAGE_LID_RUNS, rng);
  // A padlock hanging open on the cage door.
  const lock = at(stage, CAGE_LOCK_U, CAGE_LOCK_UP);
  ctx.fillStyle = rgb(BRASS.shadow);
  ctx.fillRect(
    lock.x - ts * CAGE_PADLOCK.halfWidth,
    lock.y,
    ts * CAGE_PADLOCK.width,
    ts * CAGE_PADLOCK.height,
  );
  ctx.strokeStyle = rgb(BRASS.mid);
  ctx.lineWidth = Math.max(1, ts * CAGE_PADLOCK.shackleWidth);
  ctx.beginPath();
  ctx.arc(
    lock.x + ts * CAGE_PADLOCK.shackleOffset,
    lock.y,
    ts * CAGE_PADLOCK.shackleRadius,
    Math.PI,
    Math.PI * CAGE_PADLOCK.shackleEndTurns,
  );
  ctx.stroke();
  for (const wheel of wheels) paintWheel(stage, wheel, rng);
};
const CAGE_BACK_BOARDS = 4;
const CAGE_BEND_HEIGHT = 0.5;
const CAGE_BAR_GLINT_SHARE = 0.4;
const CAGE_ROOF_FLAKES = 5;
const CAGE_LID_RUNS = 3;
const CAGE_LID_DEPTH = 0.36;
const CAGE_LID_PLANKS = 3;
const CAGE_LOCK_U = 1.02;
const CAGE_LOCK_UP = 1.05;
const CAGE_ROOF_OVERHANG = 0.04;
/** The bars' glint rides this share of a bar's width west of its centre line. */
const CAGE_BAR_GLINT_OFFSET = 0.2;
/** The bone-white trim along the roof's foot, as a share of its height. */
const CAGE_ROOF_TRIM_SHARE = 0.2;
/** The open padlock, in tiles: body, and its shackle swung open short of a full half-turn. */
const CAGE_PADLOCK = {
  halfWidth: 0.05,
  width: 0.1,
  height: 0.09,
  shackleWidth: 0.022,
  shackleOffset: 0.03,
  shackleRadius: 0.04,
  /** Where the shackle's arc stops, in half-turns from due east. */
  shackleEndTurns: 1.9,
} as const;

/** Straw heaped on a floor: a ragged mound with a few loose stalks, never speckle. */
function paintStrawBed(
  stage: Stage,
  u0: number,
  u1: number,
  floorUp: number,
  topUp: number,
  rng: Rng,
): void {
  const { ctx, ts } = stage;
  const points: Point[] = [];
  const steps = STRAW_MOUND_STEPS;
  for (let step = 0; step <= steps; step++) {
    const u = lerp(u0, u1, step / steps);
    const lift = range(rng, STRAW_MOUND_MIN_LIFT, 1);
    points.push(at(stage, u, lerp(floorUp, topUp, lift)));
  }
  const floorWest = at(stage, u0, floorUp);
  const floorEast = at(stage, u1, floorUp);
  const gradient = ctx.createLinearGradient(0, at(stage, 0, topUp).y, 0, floorWest.y);
  gradient.addColorStop(0, rgb(STRAW.light));
  gradient.addColorStop(1, rgb(STRAW.mid));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(floorWest.x, floorWest.y);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(floorEast.x, floorEast.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(STRAW.light);
  ctx.lineWidth = Math.max(1, ts * STRAW_STALK_WIDTH);
  ctx.beginPath();
  for (let stalk = 0; stalk < STRAW_STALKS; stalk++) {
    const base = points[rangeInt(rng, 1, points.length - 2)];
    const lean = range(rng, -1, 1) * ts * STRAW_STALK_LEAN;
    ctx.moveTo(base.x, base.y + ts * STRAW_STALK_ROOT);
    ctx.lineTo(base.x + lean, base.y - ts * STRAW_STALK_RISE);
  }
  ctx.stroke();
}
const STRAW_MOUND_STEPS = 9;
/** The mound's ragged top never drops below this share of the way up to its crest. */
const STRAW_MOUND_MIN_LIFT = 0.55;
const STRAW_STALKS = 8;
const STRAW_STALK_WIDTH = 0.018;
const STRAW_STALK_LEAN = 0.08;
const STRAW_STALK_ROOT = 0.03;
const STRAW_STALK_RISE = 0.07;

/** A skull and a long bone half sunk in the cage's straw. */
function paintBones(stage: Stage, rng: Rng): void {
  const { ctx, ts } = stage;
  const skull = at(stage, range(rng, BONE_SKULL_U_MIN, BONE_SKULL_U_MAX), BONE_SKULL_UP);
  const radius = BONE_SKULL_RADIUS * ts;
  ctx.fillStyle = rgb(BONE.light);
  ctx.beginPath();
  const s = SKULL;
  ctx.ellipse(skull.x, skull.y, radius, radius * s.craniumHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  const jawHalfWidth = radius * s.jawHalfWidth;
  ctx.fillRect(
    skull.x - jawHalfWidth,
    skull.y + radius * s.jawDrop,
    jawHalfWidth * 2,
    radius * s.jawHeight,
  );
  ctx.fillStyle = rgb(BACKSTAGE.mid);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(
      skull.x + side * radius * s.socketSpread,
      skull.y + radius * s.socketDrop,
      radius * s.socketRadius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = rgb(BONE.shadow);
  ctx.fillRect(
    skull.x + radius * s.crackEast,
    skull.y - radius * s.crackRise,
    radius * s.crackWidth,
    radius * s.crackHeight,
  );

  const boneFrom = at(stage, BONE_FEMUR_FROM_U, BONE_FEMUR_UP);
  const boneTo = at(stage, BONE_FEMUR_TO_U, BONE_FEMUR_UP + BONE_FEMUR_TILT);
  ctx.strokeStyle = rgb(BONE.mid);
  ctx.lineWidth = ts * BONE_FEMUR_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(boneFrom.x, boneFrom.y);
  ctx.lineTo(boneTo.x, boneTo.y);
  ctx.stroke();
  ctx.fillStyle = rgb(BONE.light);
  for (const end of [boneFrom, boneTo]) {
    ctx.beginPath();
    ctx.arc(end.x, end.y, ts * BONE_KNUCKLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}
const BONE_SKULL_U_MIN = 0.6;
const BONE_SKULL_U_MAX = 0.9;
const BONE_SKULL_UP = 0.9;
const BONE_SKULL_RADIUS = 0.11;
const BONE_FEMUR_FROM_U = 2.05;
const BONE_FEMUR_TO_U = 2.5;
const BONE_FEMUR_UP = 0.84;
const BONE_FEMUR_TILT = 0.08;
const BONE_FEMUR_WIDTH = 0.045;
const BONE_KNUCKLE_RADIUS = 0.035;
/** The skull, in its own radii: a squat cranium, the jaw under it, two sockets and a shaded crack on its crown. */
const SKULL = {
  craniumHeight: 0.85,
  jawHalfWidth: 0.55,
  jawDrop: 0.4,
  jawHeight: 0.6,
  socketSpread: 0.38,
  socketDrop: 0.1,
  socketRadius: 0.24,
  crackEast: 0.2,
  crackRise: 0.8,
  crackWidth: 0.7,
  crackHeight: 0.25,
} as const;

// Clown caravan.
const CARAVAN_WALL_TOP = 1.46;
const CARAVAN_ROOF_TOP = 2.2;
const CARAVAN_ROOF_OVERHANG = 0.06;
const CARAVAN_SKIRT_TOP = 0.78;
const CARAVAN_DOOR = { west: 0.36, east: 0.92, top: 1.36 } as const;
const CARAVAN_STACK = { u: 2.32, width: 0.11, top: 2.72, capWidth: 0.2 } as const;
const CARAVAN_STEPS = 2;
const CARAVAN_WINDOW_FRAME = 0.04;
/** The share of the window the still half of the curtain covers, from its west edge. */
const CARAVAN_CURTAIN_SHARE = 0.34;

const paintClownCaravan: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, WAGON);
  const { ts } = stage;
  const east = wagonEast();
  const wheels = wagonWheelCentres(stage);
  const wall = rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_TOP, CARAVAN_WALL_TOP);
  const roofWest = WAGON_BODY_WEST - CARAVAN_ROOF_OVERHANG;
  const roofEast = east + CARAVAN_ROOF_OVERHANG;
  const roofBottom = at(stage, roofWest, CARAVAN_WALL_TOP);
  const roofTop = at(stage, roofEast, CARAVAN_ROOF_TOP);
  const roofRadius = (roofBottom.y - roofTop.y) * CARAVAN_ROOF_ROUNDING;
  const traceRoof = (path: Ctx): void => {
    traceRoundTop(path, roofBottom.x, roofTop.y, roofTop.x, roofBottom.y, roofRadius);
  };
  const stack = rectAt(
    stage,
    CARAVAN_STACK.u - CARAVAN_STACK.width / 2,
    CARAVAN_STACK.u + CARAVAN_STACK.width / 2,
    CARAVAN_ROOF_TOP - CARAVAN_STACK_SEAT,
    CARAVAN_STACK.top,
  );
  const stackCap = rectAt(
    stage,
    CARAVAN_STACK.u - CARAVAN_STACK.capWidth / 2,
    CARAVAN_STACK.u + CARAVAN_STACK.capWidth / 2,
    CARAVAN_STACK.top - CARAVAN_STACK_CAP_HEIGHT,
    CARAVAN_STACK.top,
  );
  paintWagonUnderside(stage);
  inkSilhouette(stage, (path) => {
    traceRect(path, rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_BOTTOM, CARAVAN_WALL_TOP));
    traceRoof(path);
    traceRect(path, stack);
    traceRect(path, stackCap);
    for (const wheel of wheels) traceCircle(path, wheel, WAGON_WHEEL_RADIUS * ts);
    for (const tread of caravanTreads(stage)) traceRect(path, tread);
  });

  paintChassis(stage);
  // Faded bruise-purple panels over a blood-red skirt, bone trim between.
  paintFace(ctx, wall, BRUISE);
  const skirt = rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_TOP, CARAVAN_SKIRT_TOP);
  paintFace(ctx, skirt, BLOOD, false);
  applyMossPatchesTo(ctx, skirt, rng);
  ctx.fillStyle = rgb(BONE.mid);
  ctx.fillRect(wall.x, skirt.y - ts * CARAVAN_TRIM, wall.w, ts * CARAVAN_TRIM);
  ctx.fillRect(wall.x, wall.y, wall.w, ts * CARAVAN_TRIM);
  paintCaravanScrolls(stage, rng);
  paintFlakes(ctx, wall, CARAVAN_WALL_FLAKES, BRUISE.shadow, rng);
  paintRunoff(ctx, wall, CARAVAN_WALL_RUNS, rng);

  // The steps up to the door.
  for (const tread of caravanTreads(stage)) paintFace(ctx, tread, ROT_TIMBER, false);
  paintCaravanDoor(stage, rng);
  paintCaravanWindow(stage);

  // The barrel roof: bone canvas over hoops, mildewed where the rain sits.
  ctx.save();
  ctx.beginPath();
  traceRoof(ctx);
  ctx.clip();
  const roofShade = ctx.createLinearGradient(0, roofBottom.y, 0, roofTop.y);
  roofShade.addColorStop(0, rgb(shade(BONE.mid, CARAVAN_ROOF_EAVE_SHADE)));
  roofShade.addColorStop(CARAVAN_ROOF_CREST_STOP, rgb(BONE.light));
  roofShade.addColorStop(1, rgb(mix(BONE.light, BONE.mid, CARAVAN_ROOF_FAR_MIX)));
  ctx.fillStyle = roofShade;
  ctx.fillRect(roofBottom.x, roofTop.y, roofTop.x - roofBottom.x, roofBottom.y - roofTop.y);
  ctx.strokeStyle = rgba(BONE.shadow, CARAVAN_HOOP_ALPHA);
  ctx.lineWidth = Math.max(1, ts * CARAVAN_HOOP_WIDTH);
  for (let hoop = 1; hoop < CARAVAN_ROOF_HOOPS; hoop++) {
    const x = lerp(roofBottom.x, roofTop.x, hoop / CARAVAN_ROOF_HOOPS);
    ctx.beginPath();
    ctx.moveTo(x, roofBottom.y);
    ctx.lineTo(x, roofTop.y);
    ctx.stroke();
  }
  ctx.restore();
  const roofRect = {
    x: roofBottom.x,
    y: roofTop.y,
    w: roofTop.x - roofBottom.x,
    h: roofBottom.y - roofTop.y,
  };
  applyMossPatchesTo(ctx, roofRect, rng);
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, CARAVAN_EAVE_SHADOW_ALPHA);
  ctx.fillRect(wall.x, wall.y + ts * CARAVAN_TRIM, wall.w, ts * CARAVAN_EAVE_SHADOW);

  paintFace(ctx, stack, IRON, false);
  paintFace(ctx, stackCap, IRON, false);
  ctx.fillStyle = rgba(TOWN_CONTACT_SHADOW, CARAVAN_SOOT_ALPHA);
  ctx.fillRect(stackCap.x, stackCap.y, stackCap.w, Math.max(1, stackCap.h * CARAVAN_SOOT_SHARE));
  for (const wheel of wheels) paintWheel(stage, wheel, rng);
};
const CARAVAN_ROOF_ROUNDING = 0.75;
const CARAVAN_STACK_SEAT = 0.1;
const CARAVAN_STACK_CAP_HEIGHT = 0.07;
const CARAVAN_TRIM = 0.035;
const CARAVAN_WALL_FLAKES = 7;
const CARAVAN_WALL_RUNS = 4;
const CARAVAN_ROOF_EAVE_SHADE = 0.8;
const CARAVAN_ROOF_HOOPS = 6;
const CARAVAN_HOOP_ALPHA = 0.35;
const CARAVAN_HOOP_WIDTH = 0.02;
const CARAVAN_EAVE_SHADOW = 0.08;
const CARAVAN_EAVE_SHADOW_ALPHA = 0.35;
const CARAVAN_SOOT_ALPHA = 0.6;
/** Soot blackens the top of the stack's cap, this share of the way down. */
const CARAVAN_SOOT_SHARE = 0.4;
/** The barrel roof is palest at its crown, this share of the way up, and sinks back toward the mid tone past it. */
const CARAVAN_ROOF_CREST_STOP = 0.55;
const CARAVAN_ROOF_FAR_MIX = 0.4;

/** The treads of the caravan's folding steps, hung from its sill under the door. */
function caravanTreads(stage: Stage): FrameRect[] {
  const treads: FrameRect[] = [];
  for (let step = 0; step < CARAVAN_STEPS; step++) {
    const up = WAGON_CHASSIS_BOTTOM * ((step + 1) / (CARAVAN_STEPS + 1));
    treads.push(
      rectAt(
        stage,
        CARAVAN_DOOR.west + CARAVAN_TREAD_INSET,
        CARAVAN_DOOR.east - CARAVAN_TREAD_INSET,
        up - CARAVAN_TREAD_HEIGHT,
        up,
      ),
    );
  }
  return treads;
}
const CARAVAN_TREAD_INSET = 0.06;
const CARAVAN_TREAD_HEIGHT = 0.06;

/** Brass scrollwork on the panels: a few curls, the kind a painter did once and nobody touched up. */
function paintCaravanScrolls(stage: Stage, rng: Rng): void {
  const { ctx, ts } = stage;
  ctx.strokeStyle = rgba(BRASS.mid, CARAVAN_SCROLL_ALPHA);
  ctx.lineWidth = Math.max(1, ts * CARAVAN_SCROLL_WIDTH);
  for (const u of CARAVAN_SCROLL_U) {
    const wander = range(rng, -CARAVAN_SCROLL_WANDER, CARAVAN_SCROLL_WANDER);
    const centre = at(stage, u, CARAVAN_SCROLL_UP + wander);
    const radius = ts * CARAVAN_SCROLL_RADIUS;
    const sweep = Math.PI * CARAVAN_SCROLL_SWEEP_TURNS;
    ctx.beginPath();
    ctx.arc(centre.x - radius, centre.y, radius, 0, sweep);
    ctx.moveTo(centre.x + radius * 2, centre.y);
    ctx.arc(centre.x + radius, centre.y, radius, 0, -sweep, true);
    ctx.stroke();
  }
}
const CARAVAN_SCROLL_U: ReadonlyArray<number> = [1.28, 2.62];
const CARAVAN_SCROLL_UP = 1.2;
const CARAVAN_SCROLL_RADIUS = 0.07;
const CARAVAN_SCROLL_WIDTH = 0.025;
const CARAVAN_SCROLL_ALPHA = 0.8;
/** How far each scroll may sit off its line, in tiles: painted by hand, not ruled. */
const CARAVAN_SCROLL_WANDER = 0.03;
/** Each curl of the scroll sweeps three quarters of a turn, in half-turns. */
const CARAVAN_SCROLL_SWEEP_TURNS = 1.5;

/** Mildew on a rectangle of canvas: a few soft green blooms, never speckle. */
function applyMossPatchesTo(ctx: Ctx, rect: FrameRect, rng: Rng): void {
  for (let bloom = 0; bloom < MILDEW_BLOOMS; bloom++) {
    fillSoftEllipse(
      ctx,
      rect.x + range(rng, MOSS_PATCH.acrossMin, MOSS_PATCH.acrossMax) * rect.w,
      rect.y + range(rng, MOSS_PATCH.downMin, MOSS_PATCH.downMax) * rect.h,
      rect.h * range(rng, MOSS_PATCH.radiusXMin, MOSS_PATCH.radiusXMax),
      rect.h * range(rng, MOSS_PATCH.radiusYMin, MOSS_PATCH.radiusYMax),
      rgb(MILDEW.mid),
      MILDEW_BLOOM_ALPHA,
    );
  }
}
const MILDEW_BLOOMS = 3;
const MILDEW_BLOOM_ALPHA = 0.45;
/**
 * Where a bloom lands and how big it grows, as shares of the rectangle: across
 * its middle, low down where the damp sits, and wider than it is tall — both
 * radii measured in the rectangle's height, so a long face gets no bigger blooms.
 */
const MOSS_PATCH = {
  acrossMin: 0.1,
  acrossMax: 0.9,
  downMin: 0.45,
  downMax: 0.95,
  radiusXMin: 0.25,
  radiusXMax: 0.45,
  radiusYMin: 0.12,
  radiusYMax: 0.2,
} as const;

/** The caravan's door, painted with a clown's face that has not aged well. */
function paintCaravanDoor(stage: Stage, rng: Rng): void {
  const { ctx, ts } = stage;
  const door = rectAt(
    stage,
    CARAVAN_DOOR.west,
    CARAVAN_DOOR.east,
    WAGON_CHASSIS_TOP,
    CARAVAN_DOOR.top,
  );
  paintFace(ctx, door, ROT_TIMBER);
  ctx.strokeStyle = rgba(TOWN_INK, DOOR_EDGE_ALPHA);
  ctx.lineWidth = Math.max(1, ts * DOOR_EDGE_WIDTH);
  ctx.strokeRect(door.x, door.y, door.w, door.h);
  const face = { x: door.x + door.w / 2, y: door.y + door.h * DOOR_FACE_CENTRE };
  const radius = door.w * DOOR_FACE_RADIUS;
  // Greasepaint white, a red nose and a grin painted too wide.
  ctx.fillStyle = rgb(BONE.mid);
  ctx.beginPath();
  const look = DOOR_CLOWN_FACE;
  ctx.ellipse(face.x, face.y, radius, radius * look.height, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(BACKSTAGE.mid);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    for (const vertex of look.eye) {
      ctx.lineTo(face.x + side * radius * vertex.x, face.y - radius * vertex.y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = rgb(BLOOD.mid);
  ctx.lineWidth = Math.max(1, radius * look.grinWidth);
  ctx.beginPath();
  ctx.arc(
    face.x,
    face.y + radius * look.grinDrop,
    radius * look.grinRadius,
    Math.PI * look.grinStartTurns,
    Math.PI * look.grinEndTurns,
  );
  ctx.stroke();
  ctx.fillStyle = rgb(BLOOD.light);
  ctx.beginPath();
  ctx.arc(face.x, face.y + radius * look.noseDrop, radius * look.noseRadius, 0, Math.PI * 2);
  ctx.fill();
  paintFlakes(
    ctx,
    { x: face.x - radius, y: face.y - radius, w: radius * 2, h: radius * 2 },
    DOOR_FACE_FLAKES,
    ROT_TIMBER.mid,
    rng,
  );
  const knob = at(stage, CARAVAN_DOOR.east - DOOR_KNOB_INSET, DOOR_KNOB_UP);
  ctx.fillStyle = rgb(BRASS.light);
  ctx.beginPath();
  ctx.arc(knob.x, knob.y, ts * DOOR_KNOB_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}
const DOOR_EDGE_ALPHA = 0.6;
const DOOR_FACE_CENTRE = 0.4;
const DOOR_FACE_RADIUS = 0.3;
const DOOR_FACE_FLAKES = 3;
const DOOR_KNOB_UP = 0.95;
const DOOR_KNOB_INSET = 0.08;
const DOOR_KNOB_RADIUS = 0.025;
const DOOR_EDGE_WIDTH = 0.02;
/**
 * The clown painted on the caravan door, in the face's radii: a tall oval,
 * each eye a slanted triangle (its vertices across from the centre line and up
 * from the centre, mirrored for the other eye), a grin and a red nose.
 */
const DOOR_CLOWN_FACE = {
  height: 1.15,
  eye: [
    { x: 0.2, y: 0.2 },
    { x: 0.55, y: 0.55 },
    { x: 0.7, y: 0.1 },
  ],
  grinWidth: 0.22,
  grinDrop: 0.15,
  grinRadius: 0.62,
  /** The grin's arc, in half-turns, from its right corner round the bottom to its left. */
  grinStartTurns: 0.12,
  grinEndTurns: 0.88,
  noseDrop: 0.08,
  noseRadius: 0.18,
} as const;

/** The window the live curtain twitches in: dark glass, a frame, and the curtain's still half. */
function paintCaravanWindow(stage: Stage): void {
  const { ctx, ts } = stage;
  const pane = rectAt(
    stage,
    CARAVAN_WINDOW.x,
    CARAVAN_WINDOW.x + CARAVAN_WINDOW.w,
    CARAVAN_WINDOW.up,
    CARAVAN_WINDOW.up + CARAVAN_WINDOW.h,
  );
  const frameWidth = ts * CARAVAN_WINDOW_FRAME;
  ctx.fillStyle = rgb(BONE.mid);
  ctx.fillRect(
    pane.x - frameWidth,
    pane.y - frameWidth,
    pane.w + frameWidth * 2,
    pane.h + frameWidth * 2,
  );
  ctx.fillStyle = rgb(BONE.light);
  ctx.fillRect(
    pane.x - frameWidth,
    pane.y - frameWidth,
    pane.w + frameWidth * 2,
    Math.max(1, frameWidth * 0.5),
  );
  const glass = ctx.createLinearGradient(0, pane.y, 0, pane.y + pane.h);
  glass.addColorStop(0, rgb(BACKSTAGE.light));
  glass.addColorStop(1, rgb(BACKSTAGE.shadow));
  ctx.fillStyle = glass;
  ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
  const curtainWidth = pane.w * CARAVAN_CURTAIN_SHARE;
  ctx.fillStyle = rgb(BLOOD.shadow);
  ctx.beginPath();
  ctx.moveTo(pane.x, pane.y);
  ctx.lineTo(pane.x + curtainWidth, pane.y);
  ctx.quadraticCurveTo(
    pane.x + curtainWidth * CURTAIN_BELLY_ACROSS,
    pane.y + pane.h * CURTAIN_BELLY_DOWN,
    pane.x + curtainWidth * CURTAIN_HEM_ACROSS,
    pane.y + pane.h,
  );
  ctx.lineTo(pane.x, pane.y + pane.h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(BONE.accent, WINDOW_GLINT_ALPHA);
  ctx.fillRect(
    pane.x + pane.w * WINDOW_GLINT.across,
    pane.y + pane.h * WINDOW_GLINT.down,
    pane.w * WINDOW_GLINT.width,
    pane.h * WINDOW_GLINT.height,
  );
  ctx.fillStyle = rgb(BONE.light);
  const sillOverhang = frameWidth * CARAVAN_SILL_OVERHANG_FRAMES;
  ctx.fillRect(
    pane.x - sillOverhang,
    pane.y + pane.h + frameWidth,
    pane.w + sillOverhang * 2,
    frameWidth,
  );
}
const WINDOW_GLINT_ALPHA = 0.35;
/** The sky's glint on the glass, in shares of the pane: up in its east half, clear of the curtain. */
const WINDOW_GLINT = { across: 0.62, down: 0.12, width: 0.14, height: 0.1 } as const;
/** The curtain's hem swings in from its rail, bellying out partway down; in shares of its width and the pane's height. */
const CURTAIN_BELLY_ACROSS = 0.55;
const CURTAIN_BELLY_DOWN = 0.6;
const CURTAIN_HEM_ACROSS = 0.8;
/** The sill juts past the frame by this many frame widths each side. */
const CARAVAN_SILL_OVERHANG_FRAMES = 2;

// Prop wagon.
const PROP_DECK_TOP = 0.7;
const PROP_RAIL_TOP = 0.86;

interface Hoop {
  readonly u: number;
  readonly up: number;
  readonly radiusU: number;
  readonly radiusUp: number;
  readonly tilt: number;
  readonly ramp: Ramp;
  readonly striped: boolean;
}

/** Hoops heaped on the deck, stood on edge and leaning on each other. */
const PROP_HOOPS: ReadonlyArray<Hoop> = [
  { u: 0.72, up: 1.24, radiusU: 0.42, radiusUp: 0.48, tilt: -0.25, ramp: BRASS, striped: false },
  { u: 1.08, up: 1.16, radiusU: 0.38, radiusUp: 0.42, tilt: 0.3, ramp: BLOOD, striped: true },
  { u: 0.66, up: 1.02, radiusU: 0.36, radiusUp: 0.16, tilt: 0.05, ramp: NAVY, striped: true },
];
const HOOP_WIDTH = 0.07;
const HOOP_STRIPES = 14;

const PROP_CANNON = {
  breech: { u: 2.68, up: 0.98 },
  muzzle: { u: 1.72, up: 1.62 },
  breechRadius: 0.17,
  muzzleRadius: 0.23,
} as const;
const PROP_DRUM = { west: 1.46, east: 1.84, bottom: PROP_DECK_TOP, top: 1.02 } as const;

const paintPropWagon: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, WAGON);
  const { ts } = stage;
  const east = wagonEast();
  const wheels = wagonWheelCentres(stage);
  const deck = rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_TOP, PROP_DECK_TOP);
  const deckTop = rectAt(
    stage,
    WAGON_BODY_WEST,
    east,
    PROP_DECK_TOP,
    PROP_DECK_TOP + WAGON_LID_DEPTH,
  );
  const cannon = cannonOutline(stage);
  const drum = rectAt(stage, PROP_DRUM.west, PROP_DRUM.east, PROP_DRUM.bottom, PROP_DRUM.top);
  paintWagonUnderside(stage);
  inkSilhouette(stage, (path) => {
    traceRect(path, rectAt(stage, WAGON_BODY_WEST, east, WAGON_CHASSIS_BOTTOM, PROP_DECK_TOP));
    traceRect(path, deckTop);
    for (const hoop of PROP_HOOPS) traceHoop(stage, path, hoop, HOOP_WIDTH / 2);
    path.moveTo(cannon[0].x, cannon[0].y);
    for (const point of cannon) path.lineTo(point.x, point.y);
    path.closePath();
    traceRect(path, drum);
    for (const wheel of wheels) traceCircle(path, wheel, WAGON_WHEEL_RADIUS * ts);
  });

  paintChassis(stage);
  paintFace(ctx, deck, ROT_TIMBER, false);
  paintLid(ctx, deckTop, ROT_TIMBER);
  ctx.fillStyle = rgba(ROT_TIMBER.shadow, PLANK_SEAM_ALPHA);
  for (let plank = 1; plank < PROP_DECK_PLANKS; plank++) {
    const x = deckTop.x + (plank / PROP_DECK_PLANKS) * deckTop.w;
    ctx.fillRect(x, deckTop.y, 1, deckTop.h);
  }
  // Rail posts along the deck's front edge.
  for (let post = 0; post <= PROP_RAIL_POSTS; post++) {
    const u = lerp(
      WAGON_BODY_WEST + PROP_RAIL_INSET,
      east - PROP_RAIL_INSET,
      post / PROP_RAIL_POSTS,
    );
    paintFace(
      ctx,
      rectAt(
        stage,
        u - PROP_RAIL_POST_HALF_WIDTH,
        u + PROP_RAIL_POST_HALF_WIDTH,
        PROP_DECK_TOP,
        PROP_RAIL_TOP,
      ),
      ROT_TIMBER,
      false,
    );
  }

  for (const hoop of PROP_HOOPS) paintHoop(stage, hoop);
  paintDrum(stage, drum);
  paintCannon(stage, cannon, rng);
  for (const wheel of wheels) paintWheel(stage, wheel, rng);
};
const PLANK_SEAM_ALPHA = 0.6;
const PROP_DECK_PLANKS = 7;
const PROP_RAIL_POSTS = 5;
const PROP_RAIL_INSET = 0.05;
const PROP_RAIL_POST_HALF_WIDTH = 0.025;

function traceHoop(stage: Stage, path: Ctx, hoop: Hoop, outset: number): void {
  const centre = at(stage, hoop.u, hoop.up);
  const { ts } = stage;
  path.moveTo(
    centre.x + Math.cos(hoop.tilt) * (hoop.radiusU + outset) * ts,
    centre.y + Math.sin(hoop.tilt) * (hoop.radiusU + outset) * ts,
  );
  path.ellipse(
    centre.x,
    centre.y,
    (hoop.radiusU + outset) * ts,
    (hoop.radiusUp + outset) * ts,
    hoop.tilt,
    0,
    Math.PI * 2,
  );
}

function paintHoop(stage: Stage, hoop: Hoop): void {
  const { ctx, ts } = stage;
  const centre = at(stage, hoop.u, hoop.up);
  const segments = HOOP_STRIPES;
  ctx.lineWidth = HOOP_WIDTH * ts;
  for (let segment = 0; segment < segments; segment++) {
    const from = (segment / segments) * Math.PI * 2;
    const to = ((segment + 1) / segments) * Math.PI * 2;
    // Lit along its upper-left arc, where it faces the sun.
    const facing = Math.cos((from + to) / 2 + Math.PI * HOOP_SUN_PHASE_TURNS);
    const base = hoop.striped && segment % 2 === 1 ? BONE : hoop.ramp;
    ctx.strokeStyle = rgb(
      facing > 0
        ? mix(base.mid, base.light, facing * HOOP_LIT_MIX)
        : shade(base.mid, 1 + facing * HOOP_SHADE_DEPTH),
    );
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      centre.y,
      hoop.radiusU * ts,
      hoop.radiusUp * ts,
      hoop.tilt,
      from,
      to + HOOP_SEGMENT_OVERLAP,
    );
    ctx.stroke();
  }
}
const HOOP_SEGMENT_OVERLAP = 0.02;
/** Turns the hoop's lit arc to face the upper-left sun, in half-turns. */
const HOOP_SUN_PHASE_TURNS = 0.75;
/** How far the sunlit arc pales toward the light tone, and the far arc darkens, at their extremes. */
const HOOP_LIT_MIX = 0.6;
const HOOP_SHADE_DEPTH = 0.3;

/** The human cannonball's barrel, tipped off its carriage and lying muzzle-up across the deck. */
function cannonOutline(stage: Stage): Point[] {
  const breech = at(stage, PROP_CANNON.breech.u, PROP_CANNON.breech.up);
  const muzzle = at(stage, PROP_CANNON.muzzle.u, PROP_CANNON.muzzle.up);
  const length = Math.hypot(muzzle.x - breech.x, muzzle.y - breech.y);
  const normalX = -(muzzle.y - breech.y) / length;
  const normalY = (muzzle.x - breech.x) / length;
  const breechHalf = PROP_CANNON.breechRadius * stage.ts;
  const muzzleHalf = PROP_CANNON.muzzleRadius * stage.ts;
  return [
    { x: breech.x + normalX * breechHalf, y: breech.y + normalY * breechHalf },
    { x: muzzle.x + normalX * muzzleHalf, y: muzzle.y + normalY * muzzleHalf },
    { x: muzzle.x - normalX * muzzleHalf, y: muzzle.y - normalY * muzzleHalf },
    { x: breech.x - normalX * breechHalf, y: breech.y - normalY * breechHalf },
  ];
}

function paintCannon(stage: Stage, outline: ReadonlyArray<Point>, rng: Rng): void {
  const { ctx, ts } = stage;
  const [breechA, muzzleA, muzzleB, breechB] = outline;
  const barrel = ctx.createLinearGradient(muzzleA.x, muzzleA.y, muzzleB.x, muzzleB.y);
  barrel.addColorStop(0, rgb(mix(NAVY.mid, NAVY.light, 0.5)));
  barrel.addColorStop(CANNON_BARREL_TURN_STOP, rgb(NAVY.mid));
  barrel.addColorStop(1, rgb(NAVY.shadow));
  ctx.fillStyle = barrel;
  ctx.beginPath();
  for (const point of outline) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  // Painted stars down the barrel and brass bands round it.
  for (const t of CANNON_BANDS) {
    ctx.strokeStyle = rgb(BRASS.mid);
    ctx.lineWidth = ts * CANNON_BAND_WIDTH;
    ctx.beginPath();
    ctx.moveTo(lerp(breechA.x, muzzleA.x, t), lerp(breechA.y, muzzleA.y, t));
    ctx.lineTo(lerp(breechB.x, muzzleB.x, t), lerp(breechB.y, muzzleB.y, t));
    ctx.stroke();
  }
  const starAt = {
    x: lerp((breechA.x + breechB.x) / 2, (muzzleA.x + muzzleB.x) / 2, CANNON_STAR_AT),
    y: lerp((breechA.y + breechB.y) / 2, (muzzleA.y + muzzleB.y) / 2, CANNON_STAR_AT),
  };
  paintStar(ctx, starAt, ts * CANNON_STAR_RADIUS, rgb(BONE.light));
  paintFlakes(
    ctx,
    {
      x: Math.min(breechA.x, muzzleB.x),
      y: Math.min(muzzleA.y, muzzleB.y),
      w: Math.abs(breechA.x - muzzleB.x),
      h: Math.abs(breechB.y - muzzleA.y) * CANNON_FLAKE_BAND_SHARE,
    },
    CANNON_FLAKES,
    IRON.mid,
    rng,
  );
  // The muzzle: a brass lip round a black mouth, seen a little from the side.
  const muzzle = { x: (muzzleA.x + muzzleB.x) / 2, y: (muzzleA.y + muzzleB.y) / 2 };
  const angle = Math.atan2(muzzleB.y - muzzleA.y, muzzleB.x - muzzleA.x);
  const radius = PROP_CANNON.muzzleRadius * ts;
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.beginPath();
  ctx.ellipse(
    muzzle.x,
    muzzle.y,
    radius * CANNON_MOUTH_FORESHORTEN,
    radius,
    angle + Math.PI / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = rgb(BACKSTAGE.shadow);
  ctx.beginPath();
  ctx.ellipse(
    muzzle.x,
    muzzle.y,
    radius * CANNON_MOUTH_FORESHORTEN * CANNON_BORE_WIDTH_SHARE,
    radius * CANNON_BORE_HEIGHT_SHARE,
    angle + Math.PI / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
const CANNON_BANDS: ReadonlyArray<number> = [0.12, 0.82];
const CANNON_BAND_WIDTH = 0.05;
const CANNON_STAR_AT = 0.45;
const CANNON_STAR_RADIUS = 0.08;
const CANNON_FLAKES = 3;
const CANNON_MOUTH_FORESHORTEN = 0.45;
/** Where across the barrel it turns from the sun into its mid tone. */
const CANNON_BARREL_TURN_STOP = 0.6;
/** Flaked paint only on the barrel's upper share, where the sun and the rain reach. */
const CANNON_FLAKE_BAND_SHARE = 0.6;
/** The black bore inside the brass lip, as shares of the lip's width and height. */
const CANNON_BORE_WIDTH_SHARE = 0.7;
const CANNON_BORE_HEIGHT_SHARE = 0.72;

function paintStar(ctx: Ctx, centre: Point, radius: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let point = 0; point < STAR_POINTS * 2; point++) {
    const angle = -Math.PI / 2 + (point / (STAR_POINTS * 2)) * Math.PI * 2;
    const reach = point % 2 === 0 ? radius : radius * STAR_INNER_SHARE;
    ctx.lineTo(centre.x + Math.cos(angle) * reach, centre.y + Math.sin(angle) * reach);
  }
  ctx.closePath();
  ctx.fill();
}
const STAR_POINTS = 5;
const STAR_INNER_SHARE = 0.45;

/** A bass drum on the deck, its skin split. */
function paintDrum(stage: Stage, drum: FrameRect): void {
  const { ctx, ts } = stage;
  paintFace(ctx, drum, BLOOD, false);
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.fillRect(drum.x, drum.y, drum.w, ts * DRUM_HOOP);
  ctx.fillRect(drum.x, drum.y + drum.h - ts * DRUM_HOOP, drum.w, ts * DRUM_HOOP);
  ctx.strokeStyle = rgb(BONE.mid);
  ctx.lineWidth = Math.max(1, ts * DRUM_LACE_WIDTH);
  ctx.beginPath();
  for (let zig = 0; zig <= DRUM_ZIGS; zig++) {
    const x = drum.x + (zig / DRUM_ZIGS) * drum.w;
    const y = zig % 2 === 0 ? drum.y + ts * DRUM_HOOP : drum.y + drum.h - ts * DRUM_HOOP;
    if (zig === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const lid = { x: drum.x, y: drum.y - ts * DRUM_LID, w: drum.w, h: ts * DRUM_LID };
  paintLid(ctx, lid, BONE);
  ctx.strokeStyle = rgba(TOWN_INK, CRACK_ALPHA);
  ctx.beginPath();
  ctx.moveTo(lid.x + lid.w * DRUM_SPLIT.fromAcross, lid.y + lid.h * DRUM_SPLIT.fromDown);
  ctx.lineTo(lid.x + lid.w * DRUM_SPLIT.toAcross, lid.y + lid.h * DRUM_SPLIT.toDown);
  ctx.stroke();
}
const DRUM_HOOP = 0.04;
const DRUM_ZIGS = 6;
const DRUM_LID = 0.12;
const DRUM_LACE_WIDTH = 0.02;
/** The split in the drum's skin, corner to corner across its lid, in shares of the lid. */
const DRUM_SPLIT = { fromAcross: 0.25, fromDown: 0.3, toAcross: 0.7, toDown: 0.75 } as const;

// ── Booths and the crate stack ────────────────────────────────────────────────

const BOOTH = CIRCUS_STRUCTURES.ticket_booth;

// Ticket booth.
const TICKET_BOOTH = { west: 0.12, east: 1.44, top: 1.34, counterUp: 0.62 } as const;
const TICKET_WINDOW = { west: 0.42, east: 1.14, bottom: 0.66, top: 1.04 } as const;
const TICKET_ROOF = { overhang: 0.07, eaveUp: 1.34, ridgeUp: 1.72 } as const;
const TICKET_SIGN = { west: 0.2, east: 1.36, bottom: 1.74, top: 2.06 } as const;
const TICKET_BOOTH_STRIPES = 6;
const TICKET_SIGN_POSTS: ReadonlyArray<number> = [0.36, 1.2];
const TICKET_SIGN_POST_HALF = 0.03;
const TICKET_POLE_WIDTH = 0.06;
const TICKET_POLE_KNOB = 0.05;

const paintTicketBooth: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, BOOTH);
  const { ts } = stage;
  const body = rectAt(stage, TICKET_BOOTH.west, TICKET_BOOTH.east, 0, TICKET_BOOTH.top);
  const roof = [
    at(stage, TICKET_BOOTH.west - TICKET_ROOF.overhang, TICKET_ROOF.eaveUp),
    at(stage, (TICKET_BOOTH.west + TICKET_BOOTH.east) / 2, TICKET_ROOF.ridgeUp),
    at(stage, TICKET_BOOTH.east + TICKET_ROOF.overhang, TICKET_ROOF.eaveUp),
  ];
  const sign = rectAt(
    stage,
    TICKET_SIGN.west,
    TICKET_SIGN.east,
    TICKET_SIGN.bottom,
    TICKET_SIGN.top,
  );
  const tie = at(stage, TICKET_BOOTH_BALLOON_TIE.x, TICKET_BOOTH_BALLOON_TIE.up);
  const poleFoot = at(stage, TICKET_BOOTH_BALLOON_TIE.x, TICKET_POLE_FOOT_UP);
  const pole = {
    x: poleFoot.x - (TICKET_POLE_WIDTH * ts) / 2,
    y: tie.y - TICKET_POLE_KNOB * ts,
    w: TICKET_POLE_WIDTH * ts,
    h: poleFoot.y - tie.y + TICKET_POLE_KNOB * ts,
  };
  paintRimShadow(stage, TICKET_BOOTH.west, TICKET_BOOTH.east, RIM_BOOTH_SHADOW_UP);
  inkSilhouette(stage, (path) => {
    traceRect(path, body);
    path.moveTo(roof[0].x, roof[0].y);
    for (const point of roof) path.lineTo(point.x, point.y);
    path.closePath();
    traceRect(path, sign);
    for (const u of TICKET_SIGN_POSTS) {
      traceRect(
        path,
        rectAt(
          stage,
          u - TICKET_SIGN_POST_HALF,
          u + TICKET_SIGN_POST_HALF,
          TICKET_ROOF.eaveUp,
          TICKET_SIGN.bottom,
        ),
      );
    }
    traceRect(path, pole);
    traceCircle(path, tie, TICKET_POLE_KNOB * ts);
  });

  // Stripes on the lower panel, a bone upper half with the window in it.
  paintFace(ctx, body, BONE);
  const lower = rectAt(stage, TICKET_BOOTH.west, TICKET_BOOTH.east, 0, TICKET_BOOTH.counterUp);
  const stripeWidth = lower.w / TICKET_BOOTH_STRIPES;
  for (let stripe = 0; stripe < TICKET_BOOTH_STRIPES; stripe += 2) {
    paintFace(
      ctx,
      { x: lower.x + stripe * stripeWidth, y: lower.y, w: stripeWidth, h: lower.h },
      BLOOD,
    );
  }
  paintRunoff(ctx, body, TICKET_RUNS, rng);
  paintFlakes(ctx, lower, TICKET_FLAKES, ROT_TIMBER.mid, rng);
  applyMossPatchesTo(ctx, lower, rng);
  const window = rectAt(
    stage,
    TICKET_WINDOW.west,
    TICKET_WINDOW.east,
    TICKET_WINDOW.bottom,
    TICKET_WINDOW.top,
  );
  ctx.fillStyle = rgb(BACKSTAGE.mid);
  ctx.fillRect(window.x, window.y, window.w, window.h);
  ctx.fillStyle = rgb(BRASS.mid);
  for (let bar = 1; bar < TICKET_GRILLE_BARS; bar++) {
    ctx.fillRect(
      window.x + (bar / TICKET_GRILLE_BARS) * window.w,
      window.y,
      Math.max(1, ts * TICKET_GRILLE_BAR_WIDTH),
      window.h,
    );
  }
  const counter = rectAt(
    stage,
    TICKET_WINDOW.west - TICKET_COUNTER_OVERHANG,
    TICKET_WINDOW.east + TICKET_COUNTER_OVERHANG,
    TICKET_BOOTH.counterUp,
    TICKET_BOOTH.counterUp + TICKET_COUNTER_DEPTH,
  );
  paintLid(ctx, counter, ROT_TIMBER);

  // The roof: a little gable of blood-red shingle.
  const roofShade = ctx.createLinearGradient(roof[0].x, 0, roof[2].x, 0);
  roofShade.addColorStop(0, rgb(BLOOD.light));
  roofShade.addColorStop(0.5, rgb(BLOOD.mid));
  roofShade.addColorStop(0.5, rgb(shade(BLOOD.mid, FACE_FAR_SHADE)));
  roofShade.addColorStop(1, rgb(BLOOD.shadow));
  ctx.fillStyle = roofShade;
  ctx.beginPath();
  for (const point of roof) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();

  for (const u of TICKET_SIGN_POSTS) {
    const post = rectAt(
      stage,
      u - TICKET_SIGN_POST_HALF,
      u + TICKET_SIGN_POST_HALF,
      TICKET_ROOF.eaveUp,
      TICKET_SIGN.bottom + TICKET_SIGN_POST_SEAT,
    );
    paintFace(ctx, post, ROT_TIMBER, false);
  }
  paintCrackedSign(stage, sign, rng);

  paintFace(ctx, pole, ROT_TIMBER, false);
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.beginPath();
  const knob = TICKET_POLE_KNOB * ts;
  ctx.arc(
    tie.x,
    tie.y - knob * TICKET_POLE_KNOB_RISE,
    knob * TICKET_POLE_KNOB_SIZE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
};
const RIM_BOOTH_SHADOW_UP = 0.4;
const TICKET_POLE_FOOT_UP = 0.3;
const TICKET_RUNS = 3;
const TICKET_FLAKES = 4;
const TICKET_GRILLE_BARS = 5;
const TICKET_GRILLE_BAR_WIDTH = 0.02;
/** The counter juts past the window each side and runs this deep, in tiles. */
const TICKET_COUNTER_OVERHANG = 0.06;
const TICKET_COUNTER_DEPTH = 0.06;
/** The sign's posts run a little way up behind the board, so it sits on them rather than floating. */
const TICKET_SIGN_POST_SEAT = 0.04;
/** The brass knob on the balloon pole: raised off the tie and a little smaller than the pole's silhouette knob, in knob radii. */
const TICKET_POLE_KNOB_RISE = 0.4;
const TICKET_POLE_KNOB_SIZE = 0.8;

/** "ADMIT ONE" on a board split clean across, the east half slipped on its nail. */
function paintCrackedSign(stage: Stage, sign: FrameRect, rng: Rng): void {
  const { ctx, ts } = stage;
  const splitX = sign.x + sign.w * SIGN_SPLIT_AT;
  const slip = ts * SIGN_SLIP;
  const halves: ReadonlyArray<{ readonly x0: number; readonly x1: number; readonly dy: number }> = [
    { x0: sign.x, x1: splitX, dy: 0 },
    { x0: splitX, x1: sign.x + sign.w, dy: slip },
  ];
  for (const half of halves) {
    withClip(
      ctx,
      () => {
        ctx.beginPath();
        ctx.rect(half.x0, sign.y + half.dy, half.x1 - half.x0, sign.h);
      },
      () => {
        ctx.save();
        ctx.translate(0, half.dy);
        ctx.fillStyle = rgb(BRASS.shadow);
        ctx.fillRect(sign.x, sign.y, sign.w, sign.h);
        const trim = ts * BOARD_TRIM * SIGN_TRIM_SHARE;
        const face = ctx.createLinearGradient(0, sign.y, 0, sign.y + sign.h);
        face.addColorStop(0, rgb(NAVY.light));
        face.addColorStop(1, rgb(NAVY.mid));
        ctx.fillStyle = face;
        ctx.fillRect(sign.x + trim, sign.y + trim, sign.w - trim * 2, sign.h - trim * 2);
        const letterHeight = sign.h * SIGN_LETTER_SHARE;
        const available = sign.w - trim * LETTERING_SIDE_MARGIN_TRIMS * 2;
        const measured = wordWidth(SIGN_TEXT, letterHeight);
        const fitted = measured > available ? letterHeight * (available / measured) : letterHeight;
        paintWord(
          ctx,
          SIGN_TEXT,
          sign.x + sign.w / 2,
          sign.y + (sign.h - fitted) / 2,
          fitted,
          letteringPigment(NAVY),
          mulberry32(SIGN_LETTER_SEED),
        );
        ctx.restore();
      },
    );
  }
  paintCrack(
    ctx,
    { x: splitX, y: sign.y },
    { x: splitX + ts * SIGN_CRACK_LEAN, y: sign.y + sign.h + slip },
    Math.max(1, ts * SIGN_CRACK_WIDTH),
    rng,
  );
}
const SIGN_TEXT = 'ADMIT ONE';
const SIGN_SPLIT_AT = 0.62;
const SIGN_SLIP = 0.05;
const SIGN_LETTER_SHARE = 0.58;
/** The ticket sign's trim is narrower than a big board's, as a share of `BOARD_TRIM`. */
const SIGN_TRIM_SHARE = 0.6;
/** The split leans east as it runs down, in tiles. */
const SIGN_CRACK_LEAN = 0.03;
const SIGN_CRACK_WIDTH = 0.03;
/** One stream for both halves, so the letters line up across the split. */
const SIGN_LETTER_SEED = 0xad317;

// Game booth.
const GAME_COUNTER = { west: 0.08, east: 1.92, top: 0.68, lidDepth: 0.2 } as const;
const GAME_BACKBOARD = { bottom: 0.88, top: 1.9 } as const;
const GAME_AWNING = { bottom: 1.92, top: 2.22, scallops: 6, drop: 0.1 } as const;
const GAME_HEADS: ReadonlyArray<number> = [0.46, 1.0, 1.54];
const GAME_HEAD_UP = 1.34;
const GAME_HEAD_RADIUS = 0.2;
const GAME_POST_WIDTH = 0.07;
const GAME_COUNTER_STRIPES = 8;

const paintGameBooth: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, BOOTH);
  const { ts } = stage;
  const counter = rectAt(stage, GAME_COUNTER.west, GAME_COUNTER.east, 0, GAME_COUNTER.top);
  const counterLid = rectAt(
    stage,
    GAME_COUNTER.west,
    GAME_COUNTER.east,
    GAME_COUNTER.top,
    GAME_COUNTER.top + GAME_COUNTER.lidDepth,
  );
  const backboard = rectAt(
    stage,
    GAME_COUNTER.west + GAME_BACKBOARD_INSET,
    GAME_COUNTER.east - GAME_BACKBOARD_INSET,
    GAME_BACKBOARD.bottom,
    GAME_BACKBOARD.top,
  );
  const awning = rectAt(
    stage,
    GAME_COUNTER.west,
    GAME_COUNTER.east,
    GAME_AWNING.bottom,
    GAME_AWNING.top,
  );
  const posts = [
    GAME_COUNTER.west + GAME_POST_INSET,
    GAME_COUNTER.east - GAME_POST_INSET - GAME_POST_WIDTH,
  ].map((u) => rectAt(stage, u, u + GAME_POST_WIDTH, GAME_COUNTER.top, GAME_AWNING.bottom));
  paintRimShadow(stage, GAME_COUNTER.west, GAME_COUNTER.east, RIM_BOOTH_SHADOW_UP);
  inkSilhouette(stage, (path) => {
    traceRect(path, counter);
    traceRect(path, counterLid);
    traceRect(path, backboard);
    traceRect(path, { ...awning, h: awning.h + GAME_AWNING.drop * ts });
    for (const post of posts) traceRect(path, post);
  });

  // The backdrop the heads are mounted on: bruise, gone dark with the damp.
  paintFace(ctx, backboard, BRUISE);
  paintRunoff(ctx, backboard, GAME_BACK_RUNS, rng);
  for (const u of GAME_HEADS) paintLaughingHead(stage, at(stage, u, GAME_HEAD_UP), rng);
  for (const post of posts) paintFace(ctx, post, ROT_TIMBER, false);

  // The counter: striped boards and a worn lid with the last few balls on it.
  const stripeWidth = counter.w / GAME_COUNTER_STRIPES;
  for (let stripe = 0; stripe < GAME_COUNTER_STRIPES; stripe++) {
    paintFace(
      ctx,
      {
        x: counter.x + stripe * stripeWidth,
        y: counter.y,
        w: stripeWidth + STRIPE_SEAM_OVERLAP_PX,
        h: counter.h,
      },
      stripe % 2 === 0 ? BLOOD : BONE,
    );
  }
  paintFlakes(ctx, counter, GAME_COUNTER_FLAKES, ROT_TIMBER.mid, rng);
  paintRunoff(ctx, counter, GAME_COUNTER_RUNS, rng);
  applyMossPatchesTo(ctx, counter, rng);
  paintLid(ctx, counterLid, ROT_TIMBER);
  for (let ball = 0; ball < GAME_BALLS; ball++) {
    const centre = at(
      stage,
      range(rng, GAME_BALL_SPREAD.westU, GAME_BALL_SPREAD.eastU),
      GAME_COUNTER.top + range(rng, GAME_BALL_SPREAD.nearUp, GAME_BALL_SPREAD.farUp),
    );
    ctx.fillStyle = rgb(BONE.mid);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, ts * GAME_BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(BONE.accent);
    ctx.beginPath();
    const glintOffset = ts * GAME_BALL_GLINT_OFFSET;
    ctx.arc(
      centre.x - glintOffset,
      centre.y - glintOffset,
      ts * GAME_BALL_RADIUS * GAME_BALL_GLINT_SHARE,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  paintStripedAwning(stage, awning, GAME_AWNING.scallops, GAME_AWNING.drop * ts);
};
const GAME_BACK_RUNS = 3;
const GAME_COUNTER_FLAKES = 5;
const GAME_COUNTER_RUNS = 4;
const GAME_BALLS = 3;
const GAME_BALL_RADIUS = 0.04;
/** The glint up and west of each ball's centre, in tiles, and its size as a share of the ball. */
const GAME_BALL_GLINT_OFFSET = 0.012;
const GAME_BALL_GLINT_SHARE = 0.4;
/** Where the last balls lie on the counter's lid, in footprint tiles across and above its front edge. */
const GAME_BALL_SPREAD = { westU: 0.3, eastU: 1.7, nearUp: 0.05, farUp: 0.14 } as const;
const GAME_BACKBOARD_INSET = 0.06;
const GAME_POST_INSET = 0.02;
/** Each stripe runs half a pixel into the next, so no antialiased seam shows between two. */
const STRIPE_SEAM_OVERLAP_PX = 0.5;

/**
 * The laughing head, in its own radii: hair tufts either side, a highlight up
 * and west, eyes squeezed into arcs, a gaping mouth inside a red lip, a nose,
 * and a crack from the crown down toward the nose.
 */
const LAUGHING_HEAD = {
  hairOut: 0.95,
  hairRaise: 0.3,
  hairRadiusX: 0.38,
  hairRadiusY: 0.3,
  /** Each tuft tilts outward by this, in radians. */
  hairTilt: 0.5,
  highlightWest: 0.35,
  highlightRise: 0.4,
  highlightRadius: 0.1,
  rimShade: 0.85,
  eyeLine: 0.14,
  eyeSpread: 0.38,
  eyeRaise: 0.3,
  eyeRadius: 0.18,
  /** Each eye is the top of a small circle, in half-turns from due east. */
  eyeStartTurns: 1.1,
  eyeEndTurns: 1.9,
  lipDrop: 0.35,
  lipRadiusX: 0.56,
  lipRadiusY: 0.46,
  mouthDrop: 0.38,
  mouthRadiusX: 0.42,
  mouthRadiusY: 0.34,
  noseRaise: 0.02,
  noseRadius: 0.16,
  crackTopAcrossMin: -0.6,
  crackTopAcrossMax: -0.2,
  crackTopRise: 0.9,
  crackFootAcrossMin: -0.1,
  crackFootAcrossMax: 0.2,
  crackFootRise: 0.1,
} as const;
const LAUGHING_HEAD_CRACK_WIDTH = 0.015;

/** A laughing clown head, mouth gaping for the ball — the one game on the midway that still grins. */
function paintLaughingHead(stage: Stage, centre: Point, rng: Rng): void {
  const { ctx, ts } = stage;
  const radius = GAME_HEAD_RADIUS * ts;
  const look = LAUGHING_HEAD;
  ctx.fillStyle = rgb(BLOOD.mid);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(
      centre.x + side * radius * look.hairOut,
      centre.y - radius * look.hairRaise,
      radius * look.hairRadiusX,
      radius * look.hairRadiusY,
      side * look.hairTilt,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const face = ctx.createRadialGradient(
    centre.x - radius * look.highlightWest,
    centre.y - radius * look.highlightRise,
    radius * look.highlightRadius,
    centre.x,
    centre.y,
    radius,
  );
  face.addColorStop(0, rgb(BONE.light));
  face.addColorStop(1, rgb(shade(BONE.mid, look.rimShade)));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.fill();
  // Eyes squeezed shut with laughing.
  ctx.strokeStyle = rgb(BACKSTAGE.mid);
  ctx.lineWidth = Math.max(1, radius * look.eyeLine);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(
      centre.x + side * radius * look.eyeSpread,
      centre.y - radius * look.eyeRaise,
      radius * look.eyeRadius,
      Math.PI * look.eyeStartTurns,
      Math.PI * look.eyeEndTurns,
    );
    ctx.stroke();
  }
  // The mouth: a wide black hole with a red lip, where the ball goes.
  ctx.fillStyle = rgb(BLOOD.mid);
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y + radius * look.lipDrop,
    radius * look.lipRadiusX,
    radius * look.lipRadiusY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = rgb(BACKSTAGE.shadow);
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y + radius * look.mouthDrop,
    radius * look.mouthRadiusX,
    radius * look.mouthRadiusY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = rgb(BLOOD.light);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y - radius * look.noseRaise, radius * look.noseRadius, 0, Math.PI * 2);
  ctx.fill();
  const crackTopX = centre.x + radius * range(rng, look.crackTopAcrossMin, look.crackTopAcrossMax);
  const crackTop = { x: crackTopX, y: centre.y - radius * look.crackTopRise };
  const crackFootX =
    centre.x + radius * range(rng, look.crackFootAcrossMin, look.crackFootAcrossMax);
  const crackFoot = { x: crackFootX, y: centre.y - radius * look.crackFootRise };
  paintCrack(ctx, crackTop, crackFoot, Math.max(1, ts * LAUGHING_HEAD_CRACK_WIDTH), rng);
}

/** A striped awning with a scalloped valance hanging from its front edge. */
function paintStripedAwning(
  stage: Stage,
  awning: FrameRect,
  scallops: number,
  dropPx: number,
): void {
  const { ctx } = stage;
  const stripes = scallops * 2;
  const stripeWidth = awning.w / stripes;
  for (let stripe = 0; stripe < stripes; stripe++) {
    const ramp = stripe % 2 === 0 ? BLOOD : BONE;
    const x = awning.x + stripe * stripeWidth;
    const gradient = ctx.createLinearGradient(0, awning.y, 0, awning.y + awning.h);
    gradient.addColorStop(0, rgb(mix(ramp.mid, ramp.light, AWNING_BACK_MIX)));
    gradient.addColorStop(1, rgb(shade(ramp.mid, AWNING_FRONT_SHADE)));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, awning.y, stripeWidth + STRIPE_SEAM_OVERLAP_PX, awning.h);
    ctx.fillStyle = rgb(shade(ramp.mid, AWNING_FRONT_SHADE));
    ctx.beginPath();
    ctx.moveTo(x, awning.y + awning.h);
    ctx.lineTo(x + stripeWidth, awning.y + awning.h);
    ctx.quadraticCurveTo(
      x + stripeWidth / 2,
      awning.y + awning.h + dropPx * 2,
      x,
      awning.y + awning.h,
    );
    ctx.fill();
  }
}
const AWNING_FRONT_SHADE = 0.78;
/** The awning's sloping top catches the sun, paling this far toward the ramp's light tone. */
const AWNING_BACK_MIX = 0.6;

// Crate stack.
interface Crate {
  readonly west: number;
  readonly east: number;
  readonly bottom: number;
  readonly top: number;
  readonly kind: 'crate' | 'trunk';
}

const CRATE_LID_DEPTH = 0.22;
const CRATE_STACK: ReadonlyArray<Crate> = [
  { west: 0.08, east: 1.1, bottom: 0, top: 0.56, kind: 'trunk' },
  { west: 1.06, east: 1.92, bottom: 0, top: 0.74, kind: 'crate' },
  { west: 0.22, east: 0.92, bottom: 0.56 + CRATE_LID_DEPTH * 0.5, top: 1.3, kind: 'crate' },
  { west: 1.16, east: 1.78, bottom: 0.74 + CRATE_LID_DEPTH * 0.5, top: 1.18, kind: 'trunk' },
];

const paintCrateStack: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, BOOTH);
  paintRimShadow(stage, CRATE_STACK[0].west, CRATE_STACK[1].east, RIM_BOOTH_SHADOW_UP);
  inkSilhouette(stage, (path) => {
    for (const crate of CRATE_STACK) {
      traceRect(
        path,
        rectAt(stage, crate.west, crate.east, crate.bottom, crate.top + CRATE_LID_DEPTH),
      );
    }
  });
  for (const crate of CRATE_STACK) {
    if (crate.kind === 'trunk') paintTrunk(stage, crate, rng);
    else paintCrate(stage, crate, rng);
  }
};

function paintCrate(stage: Stage, crate: Crate, rng: Rng): void {
  const { ctx, ts } = stage;
  const face = rectAt(stage, crate.west, crate.east, crate.bottom, crate.top);
  const lid = rectAt(stage, crate.west, crate.east, crate.top, crate.top + CRATE_LID_DEPTH);
  paintFace(ctx, face, ROT_TIMBER);
  ctx.fillStyle = rgba(ROT_TIMBER.shadow, PLANK_SEAM_ALPHA);
  for (let plank = 1; plank < CRATE_PLANKS; plank++) {
    ctx.fillRect(face.x, face.y + (plank / CRATE_PLANKS) * face.h, face.w, 1);
  }
  // The cross brace.
  ctx.strokeStyle = rgb(ROT_TIMBER.light);
  ctx.lineWidth = ts * CRATE_BRACE_WIDTH;
  ctx.beginPath();
  const braceInset = ts * CRATE_BRACE_INSET;
  ctx.moveTo(face.x + braceInset, face.y + face.h - braceInset);
  ctx.lineTo(face.x + face.w - braceInset, face.y + braceInset);
  ctx.stroke();
  ctx.strokeStyle = rgba(TOWN_INK, CRATE_FRAME_ALPHA);
  const frameInset = ts * CRATE_FRAME_INSET;
  ctx.lineWidth = Math.max(1, frameInset);
  ctx.strokeRect(
    face.x + frameInset,
    face.y + frameInset,
    face.w - frameInset * 2,
    face.h - frameInset * 2,
  );
  // A stencilled star, half worn off.
  paintStar(
    ctx,
    { x: face.x + face.w * CRATE_STENCIL_AT.across, y: face.y + face.h * CRATE_STENCIL_AT.down },
    ts * CRATE_STENCIL_RADIUS,
    rgba(BLOOD.mid, CRATE_STENCIL_ALPHA),
  );
  paintLid(ctx, lid, ROT_TIMBER);
  paintRunoff(ctx, face, CRATE_RUNS, rng);
}
const CRATE_PLANKS = 3;
const CRATE_BRACE_WIDTH = 0.05;
const CRATE_FRAME_ALPHA = 0.5;
const CRATE_STENCIL_RADIUS = 0.1;
const CRATE_STENCIL_ALPHA = 0.7;
/** The stencil sits up and west of the face's centre, in shares of the face. */
const CRATE_STENCIL_AT = { across: 0.3, down: 0.4 } as const;
const CRATE_RUNS = 2;
/** The brace runs corner to corner this far in from the face's edges, in tiles. */
const CRATE_BRACE_INSET = 0.04;
/** The inked frame round the face: as wide as it is set in from the edge, in tiles. */
const CRATE_FRAME_INSET = 0.02;

function paintTrunk(stage: Stage, trunk: Crate, rng: Rng): void {
  const { ctx, ts } = stage;
  const face = rectAt(stage, trunk.west, trunk.east, trunk.bottom, trunk.top);
  const lid = rectAt(stage, trunk.west, trunk.east, trunk.top, trunk.top + CRATE_LID_DEPTH);
  paintFace(ctx, face, NAVY);
  paintLid(ctx, lid, NAVY);
  paintFlakes(ctx, face, TRUNK_FLAKES, ROT_TIMBER.mid, rng);
  // A leather strap round it, and brass on every corner.
  ctx.fillStyle = rgb(ROT_TIMBER.shadow);
  const strapX = face.x + face.w * TRUNK_STRAP_AT;
  ctx.fillRect(strapX, lid.y, ts * TRUNK_STRAP_WIDTH, face.y + face.h - lid.y);
  ctx.fillStyle = rgb(BRASS.mid);
  ctx.fillRect(
    strapX - ts * TRUNK_BUCKLE_OVERHANG,
    face.y + face.h * TRUNK_BUCKLE_AT,
    ts * (TRUNK_STRAP_WIDTH + TRUNK_BUCKLE_OVERHANG * 2),
    ts * TRUNK_BUCKLE_HEIGHT,
  );
  const corner = ts * TRUNK_CORNER;
  for (const [x, y] of [
    [face.x, face.y],
    [face.x + face.w - corner, face.y],
    [face.x, face.y + face.h - corner],
    [face.x + face.w - corner, face.y + face.h - corner],
  ] as const) {
    ctx.fillStyle = rgb(BRASS.mid);
    ctx.fillRect(x, y, corner, corner);
    ctx.fillStyle = rgb(BRASS.light);
    ctx.fillRect(x, y, corner * TRUNK_CORNER_GLINT_WIDTH, corner * TRUNK_CORNER_GLINT_HEIGHT);
  }
  ctx.fillStyle = rgba(BONE.light, TRUNK_BAND_ALPHA);
  ctx.fillRect(face.x, face.y + face.h * TRUNK_BAND_AT, face.w, ts * TRUNK_BAND);
}
const TRUNK_FLAKES = 3;
const TRUNK_STRAP_AT = 0.68;
const TRUNK_STRAP_WIDTH = 0.07;
const TRUNK_CORNER = 0.09;
const TRUNK_BAND = 0.04;
const TRUNK_BAND_ALPHA = 0.7;
/** The painted band round the trunk, this share of the way down its face. */
const TRUNK_BAND_AT = 0.55;
/** The brass buckle on the strap: this share of the way down, jutting past the strap each side, in tiles. */
const TRUNK_BUCKLE_AT = 0.35;
const TRUNK_BUCKLE_OVERHANG = 0.01;
const TRUNK_BUCKLE_HEIGHT = 0.06;
/** Each brass corner's lit top-left, as shares of the corner. */
const TRUNK_CORNER_GLINT_WIDTH = 0.5;
const TRUNK_CORNER_GLINT_HEIGHT = 0.35;

// ── Posts: the flame lamp and the high striker ────────────────────────────────

const RIM_POST = CIRCUS_STRUCTURES.flame_lamp;

// Flame lamp.
const LAMP_FOOT = { halfWidth: 0.2, top: 0.2, capHalfWidth: 0.24, capTop: 0.26 } as const;
const LAMP_POLE_HALF_WIDTH = 0.06;
const LAMP_POLE_BAND_PITCH = 0.22;
const LAMP_POLE_BAND_SLANT = 0.1;
const LAMP_TIE_RING_HALF = 0.085;
const LAMP_TIE_RING_HEIGHT = 0.05;
/** The brazier's clown face, round the mouth the live flame stands in. */
const LAMP_FACE_ABOVE_MOUTH = 0.13;
const LAMP_FACE_UP = FLAME_LAMP_MOUTH.up + LAMP_FACE_ABOVE_MOUTH;
const LAMP_FACE_RADIUS_U = 0.3;
const LAMP_FACE_RADIUS_UP = 0.28;
const LAMP_RUFF_BELOW_MOUTH = 0.2;
const LAMP_RUFF_UP = FLAME_LAMP_MOUTH.up - LAMP_RUFF_BELOW_MOUTH;
const LAMP_RUFF_HALF = 0.28;
const LAMP_RUFF_POINTS = 7;
/** The bowl's rim sits just inside the top of the face, so the face reads as hung from it. */
const LAMP_BOWL_RIM_FACE_SHARE = 0.92;
const LAMP_BOWL_RIM_UP = LAMP_FACE_UP + LAMP_FACE_RADIUS_UP * LAMP_BOWL_RIM_FACE_SHARE;
const LAMP_BOWL_RIM_HALF = 0.34;
const LAMP_BOWL_RIM_DEPTH = 0.08;
const LAMP_MOUTH_HEIGHT_SHARE = 0.9;

const paintFlameLamp: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, RIM_POST);
  const { ts } = stage;
  const u = FLAME_LAMP_MOUTH.x;
  const foot = rectAt(stage, u - LAMP_FOOT.halfWidth, u + LAMP_FOOT.halfWidth, 0, LAMP_FOOT.top);
  const footCap = rectAt(
    stage,
    u - LAMP_FOOT.capHalfWidth,
    u + LAMP_FOOT.capHalfWidth,
    LAMP_FOOT.top,
    LAMP_FOOT.capTop,
  );
  const pole = rectAt(
    stage,
    u - LAMP_POLE_HALF_WIDTH,
    u + LAMP_POLE_HALF_WIDTH,
    LAMP_FOOT.capTop,
    LAMP_RUFF_UP,
  );
  const face = at(stage, u, LAMP_FACE_UP);
  const faceRadiusX = LAMP_FACE_RADIUS_U * ts;
  const faceRadiusY = LAMP_FACE_RADIUS_UP * ts;
  const rim = at(stage, u, LAMP_BOWL_RIM_UP);
  const ruff = ruffPoints(stage, u);
  const look = LAMP_CLOWN_FACE;
  paintRimShadow(stage, u - LAMP_FOOT.capHalfWidth, u + LAMP_FOOT.capHalfWidth, LAMP_SHADOW_UP);
  inkSilhouette(stage, (path) => {
    traceRect(path, foot);
    traceRect(path, footCap);
    traceRect(path, pole);
    path.moveTo(face.x + faceRadiusX, face.y);
    path.ellipse(face.x, face.y, faceRadiusX, faceRadiusY, 0, 0, Math.PI * 2);
    path.moveTo(rim.x + LAMP_BOWL_RIM_HALF * ts, rim.y);
    path.ellipse(
      rim.x,
      rim.y,
      LAMP_BOWL_RIM_HALF * ts,
      LAMP_BOWL_RIM_DEPTH * ts,
      0,
      0,
      Math.PI * 2,
    );
    path.moveTo(ruff[0].x, ruff[0].y);
    for (const point of ruff) path.lineTo(point.x, point.y);
    path.closePath();
  });

  paintFace(ctx, foot, IRON, false);
  paintLid(ctx, footCap, IRON);
  paintBarberPole(stage, pole);
  // An iron ring on the pole where strings are tied to it.
  const tie = at(stage, FLAME_LAMP_TIE.x, FLAME_LAMP_TIE.up);
  paintFace(
    ctx,
    {
      x: tie.x - LAMP_TIE_RING_HALF * ts,
      y: tie.y - (LAMP_TIE_RING_HEIGHT * ts) / 2,
      w: LAMP_TIE_RING_HALF * ts * 2,
      h: LAMP_TIE_RING_HEIGHT * ts,
    },
    IRON,
    false,
  );

  // The ruff at the clown's throat.
  ctx.fillStyle = rgb(BLOOD.mid);
  ctx.beginPath();
  for (const point of ruff) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(BLOOD.light);
  const ruffHighlight = ts * LAMP_RUFF_HIGHLIGHT_HEIGHT;
  ctx.fillRect(
    ruff[0].x,
    ruff[0].y - ruffHighlight,
    (ruff[ruff.length - 1].x - ruff[0].x) * LAMP_RUFF_HIGHLIGHT_SHARE,
    ruffHighlight,
  );

  // The cast face: iron under greasepaint, the paint gone in flakes and cracks.
  ctx.fillStyle = rgb(IRON.mid);
  ctx.beginPath();
  ctx.ellipse(face.x, face.y, faceRadiusX, faceRadiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(face.x, face.y, faceRadiusX, faceRadiusY, 0, 0, Math.PI * 2);
    },
    () => {
      const paint = ctx.createRadialGradient(
        face.x - faceRadiusX * look.highlightWest,
        face.y - faceRadiusY * look.highlightRise,
        faceRadiusX * look.highlightRadius,
        face.x,
        face.y,
        faceRadiusX * look.paintReach,
      );
      paint.addColorStop(0, rgb(BONE.light));
      paint.addColorStop(1, rgb(shade(BONE.mid, LAMP_FACE_FAR_SHADE)));
      ctx.fillStyle = paint;
      ctx.fillRect(face.x - faceRadiusX, face.y - faceRadiusY, faceRadiusX * 2, faceRadiusY * 2);
      paintFlakes(
        ctx,
        {
          x: face.x - faceRadiusX,
          y: face.y - faceRadiusY,
          w: faceRadiusX * 2,
          h: faceRadiusY * 2,
        },
        LAMP_FACE_FLAKES,
        IRON.mid,
        rng,
      );
      // Soot from the fire, blacking the face above the mouth.
      fillSoftEllipse(
        ctx,
        face.x,
        face.y - faceRadiusY * look.sootRise,
        faceRadiusX * look.sootRadiusX,
        faceRadiusY * look.sootRadiusY,
        rgb(TOWN_CONTACT_SHADOW),
        LAMP_SOOT_ALPHA,
      );
    },
  );
  // Diamond eyes, a painted brow, a red nose.
  ctx.fillStyle = rgb(BACKSTAGE.mid);
  for (const side of [-1, 1] as const) {
    const eye = {
      x: face.x + side * faceRadiusX * look.eyeSpread,
      y: face.y - faceRadiusY * look.eyeRaise,
    };
    const eyeHalfWidth = faceRadiusX * look.eyeHalfWidth;
    ctx.beginPath();
    ctx.moveTo(eye.x, eye.y - faceRadiusY * look.eyeTop);
    ctx.lineTo(eye.x + eyeHalfWidth, eye.y);
    ctx.lineTo(eye.x, eye.y + faceRadiusY * look.eyeBottom);
    ctx.lineTo(eye.x - eyeHalfWidth, eye.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgb(BLOOD.light);
  ctx.beginPath();
  ctx.arc(
    face.x,
    face.y - faceRadiusY * look.noseRaise,
    faceRadiusX * look.noseRadius,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // The mouth the fire comes out of: a black hollow with a red lip and an ember rim.
  const mouth = at(stage, FLAME_LAMP_MOUTH.x, FLAME_LAMP_MOUTH.up);
  const mouthHalf = FLAME_LAMP_MOUTH_HALF_WIDTH_TILES * ts;
  ctx.fillStyle = rgb(BLOOD.mid);
  ctx.beginPath();
  ctx.ellipse(
    mouth.x,
    mouth.y,
    mouthHalf * LAMP_LIP_SHARE,
    mouthHalf * LAMP_MOUTH_HEIGHT_SHARE * LAMP_LIP_SHARE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = rgb(BACKSTAGE.shadow);
  ctx.beginPath();
  ctx.ellipse(mouth.x, mouth.y, mouthHalf, mouthHalf * LAMP_MOUTH_HEIGHT_SHARE, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(LIMELIGHT.shadow, LAMP_EMBER_ALPHA);
  ctx.lineWidth = Math.max(1, ts * look.emberWidthTiles);
  ctx.beginPath();
  ctx.ellipse(
    mouth.x,
    mouth.y,
    mouthHalf * look.emberShare,
    mouthHalf * LAMP_MOUTH_HEIGHT_SHARE * look.emberShare,
    0,
    Math.PI * look.emberStartTurns,
    Math.PI * look.emberEndTurns,
  );
  ctx.stroke();
  const crackTopX = face.x + faceRadiusX * range(rng, look.crackTopMin, look.crackTopMax);
  const crackTop = { x: crackTopX, y: face.y - faceRadiusY * look.crackTopRise };
  const crackFootX = face.x + faceRadiusX * range(rng, look.crackFootMin, look.crackFootMax);
  const crackFoot = { x: crackFootX, y: face.y + faceRadiusY * look.crackFootDrop };
  paintCrack(ctx, crackTop, crackFoot, Math.max(1, ts * look.crackWidthTiles), rng);

  // The brazier's iron lip above the face, its bowl blackened inside.
  ctx.fillStyle = rgb(IRON.light);
  ctx.beginPath();
  ctx.ellipse(rim.x, rim.y, LAMP_BOWL_RIM_HALF * ts, LAMP_BOWL_RIM_DEPTH * ts, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(BACKSTAGE.mid);
  ctx.beginPath();
  ctx.ellipse(
    rim.x,
    rim.y + ts * look.bowlDropTiles,
    LAMP_BOWL_RIM_HALF * ts * look.bowlWidthShare,
    LAMP_BOWL_RIM_DEPTH * ts * look.bowlDepthShare,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
};
const LAMP_SHADOW_UP = 0.2;
const LAMP_FACE_FAR_SHADE = 0.82;
const LAMP_FACE_FLAKES = 5;
const LAMP_SOOT_ALPHA = 0.35;
const LAMP_LIP_SHARE = 1.3;
const LAMP_EMBER_ALPHA = 0.6;
/** The lit top of the ruff, in tiles high and as a share of its width from the west. */
const LAMP_RUFF_HIGHLIGHT_HEIGHT = 0.03;
const LAMP_RUFF_HIGHLIGHT_SHARE = 0.35;
/**
 * The brazier's cast clown face, in the face's radii unless named in tiles:
 * greasepaint lit up and west, soot above the mouth, diamond eyes, a nose, an
 * ember glow round the bottom of the mouth, a crack down the east cheek, and
 * the blackened bowl inside the rim.
 */
const LAMP_CLOWN_FACE = {
  highlightWest: 0.4,
  highlightRise: 0.45,
  highlightRadius: 0.1,
  /** The greasepaint's shading reaches a little past the face's edge, so the rim never goes fully dark. */
  paintReach: 1.1,
  sootRise: 0.2,
  sootRadiusX: 0.45,
  sootRadiusY: 0.7,
  eyeSpread: 0.45,
  eyeRaise: 0.28,
  eyeTop: 0.28,
  eyeBottom: 0.2,
  eyeHalfWidth: 0.14,
  noseRaise: 0.02,
  noseRadius: 0.15,
  emberWidthTiles: 0.02,
  /** The ember glow sits just inside the mouth's black, as a share of its size. */
  emberShare: 0.85,
  /** The glow runs round the mouth's lower arc, in half-turns from due east. */
  emberStartTurns: 0.15,
  emberEndTurns: 0.85,
  crackTopMin: 0.1,
  crackTopMax: 0.4,
  crackTopRise: 0.95,
  crackFootMin: 0.3,
  crackFootMax: 0.6,
  crackFootDrop: 0.1,
  crackWidthTiles: 0.015,
  bowlDropTiles: 0.01,
  bowlWidthShare: 0.8,
  bowlDepthShare: 0.62,
} as const;

/** The frilled collar under the brazier's face: a zig-zag hem hung from the face's chin. */
function ruffPoints(stage: Stage, u: number): Point[] {
  const points: Point[] = [at(stage, u - LAMP_RUFF_HALF, LAMP_RUFF_UP + LAMP_RUFF_RISE)];
  for (let point = 0; point <= LAMP_RUFF_POINTS * 2; point++) {
    const along = lerp(u - LAMP_RUFF_HALF, u + LAMP_RUFF_HALF, point / (LAMP_RUFF_POINTS * 2));
    const dip = point % 2 === 0 ? 0 : LAMP_RUFF_DIP;
    points.push(at(stage, along, LAMP_RUFF_UP - dip));
  }
  points.push(at(stage, u + LAMP_RUFF_HALF, LAMP_RUFF_UP + LAMP_RUFF_RISE));
  return points;
}
const LAMP_RUFF_RISE = 0.12;
const LAMP_RUFF_DIP = 0.07;

/** A barber-pole stripe down a round pole, shaded round from the lit west side. */
function paintBarberPole(stage: Stage, pole: FrameRect): void {
  const { ctx, ts } = stage;
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(pole.x, pole.y, pole.w, pole.h);
    },
    () => {
      ctx.fillStyle = rgb(BONE.mid);
      ctx.fillRect(pole.x, pole.y, pole.w, pole.h);
      ctx.fillStyle = rgb(BLOOD.mid);
      const pitch = LAMP_POLE_BAND_PITCH * ts;
      for (let y = pole.y - pitch; y < pole.y + pole.h + pitch; y += pitch) {
        ctx.beginPath();
        ctx.moveTo(pole.x, y);
        ctx.lineTo(pole.x + pole.w, y - LAMP_POLE_BAND_SLANT * ts);
        ctx.lineTo(pole.x + pole.w, y - LAMP_POLE_BAND_SLANT * ts + pitch / 2);
        ctx.lineTo(pole.x, y + pitch / 2);
        ctx.closePath();
        ctx.fill();
      }
      const round = ctx.createLinearGradient(pole.x, 0, pole.x + pole.w, 0);
      round.addColorStop(0, rgba(BONE.accent, POLE_SUN_ALPHA));
      round.addColorStop(POLE_SUN_FADE_STOP, rgba(TOWN_CONTACT_SHADOW, 0));
      round.addColorStop(1, rgba(TOWN_CONTACT_SHADOW, POLE_SHADE_ALPHA));
      ctx.fillStyle = round;
      ctx.fillRect(pole.x, pole.y, pole.w, pole.h);
    },
  );
}
const POLE_SUN_ALPHA = 0.2;
const POLE_SHADE_ALPHA = 0.45;
/** The sun's sheen fades out by this share of the pole's width. */
const POLE_SUN_FADE_STOP = 0.45;

// High striker.
const STRIKER_BASE = { west: 0.1, east: 0.9, top: 0.16, lidDepth: 0.22 } as const;
const STRIKER_MAST = { halfWidth: 0.09, bottom: 0.3, top: 3.42 } as const;
const STRIKER_PAD = { west: 0.18, east: 0.46, top: 0.24 } as const;
const STRIKER_TICK_PITCH = 0.22;
const STRIKER_PUCK_UP = 1.46;
const STRIKER_BELL = { up: 3.6, radius: 0.17 } as const;
/** The mallet leans on the east of the base, head up, well inside its column. */
const STRIKER_MALLET = {
  foot: { u: 0.86, up: 0.05 },
  head: { u: 0.7, up: 1.22 },
  headHalfLength: 0.2,
  headHalfWidth: 0.1,
  handleWidth: 0.05,
} as const;

const paintHighStriker: CircusPainter = (ctx, frame, _variant, rng) => {
  const stage = stageFor(ctx, frame, RIM_POST);
  const { ts } = stage;
  const u = RIM_POST.w / 2;
  const base = rectAt(stage, STRIKER_BASE.west, STRIKER_BASE.east, 0, STRIKER_BASE.top);
  const baseLid = rectAt(
    stage,
    STRIKER_BASE.west,
    STRIKER_BASE.east,
    STRIKER_BASE.top,
    STRIKER_BASE.top + STRIKER_BASE.lidDepth,
  );
  const mast = rectAt(
    stage,
    u - STRIKER_MAST.halfWidth,
    u + STRIKER_MAST.halfWidth,
    STRIKER_MAST.bottom,
    STRIKER_MAST.top,
  );
  const bell = at(stage, u, STRIKER_BELL.up);
  const bellRadius = STRIKER_BELL.radius * ts;
  const mallet = malletGeometry(stage);
  paintRimShadow(stage, STRIKER_BASE.west, STRIKER_BASE.east, LAMP_SHADOW_UP);
  inkSilhouette(stage, (path) => {
    traceRect(path, base);
    traceRect(path, baseLid);
    traceRect(path, mast);
    traceBell(path, bell, bellRadius);
    path.moveTo(mallet.handle[0].x, mallet.handle[0].y);
    for (const point of mallet.handle) path.lineTo(point.x, point.y);
    path.closePath();
    path.moveTo(mallet.head[0].x, mallet.head[0].y);
    for (const point of mallet.head) path.lineTo(point.x, point.y);
    path.closePath();
  });

  paintFace(ctx, base, ROT_TIMBER, false);
  paintLid(ctx, baseLid, ROT_TIMBER);
  const pad = rectAt(
    stage,
    STRIKER_PAD.west,
    STRIKER_PAD.east,
    STRIKER_BASE.top + STRIKER_PAD_SEAT,
    STRIKER_PAD.top + STRIKER_PAD_DEPTH,
  );
  paintLid(ctx, pad, IRON);

  // The scale board: bone with blood ticks climbing to the bell.
  paintFace(ctx, mast, BONE, false);
  ctx.fillStyle = rgb(BLOOD.mid);
  let tick = 0;
  for (
    let up = STRIKER_MAST.bottom + STRIKER_TICK_PITCH;
    up < STRIKER_MAST.top - STRIKER_TICK_TOP_CLEARANCE;
    up += STRIKER_TICK_PITCH
  ) {
    const y = at(stage, u, up).y;
    const long = tick % 2 === 0;
    const width = mast.w * (long ? STRIKER_LONG_TICK : STRIKER_SHORT_TICK);
    ctx.fillRect(mast.x, y, width, Math.max(1, ts * STRIKER_TICK_HEIGHT));
    tick++;
  }
  // The top band is painted the loudest red: STRONG.
  const crown = rectAt(
    stage,
    u - STRIKER_MAST.halfWidth,
    u + STRIKER_MAST.halfWidth,
    STRIKER_MAST.top - STRIKER_CROWN,
    STRIKER_MAST.top,
  );
  paintFace(ctx, crown, BLOOD, false);
  ctx.fillStyle = rgb(IRON.shadow);
  ctx.fillRect(
    mast.x + mast.w * STRIKER_RAIL_AT,
    mast.y,
    Math.max(1, ts * STRIKER_RAIL_WIDTH),
    mast.h,
  );
  paintRunoff(ctx, mast, STRIKER_RUNS, rng);
  const puck = rectAt(
    stage,
    u - STRIKER_PUCK_HALF,
    u + STRIKER_PUCK_HALF,
    STRIKER_PUCK_UP,
    STRIKER_PUCK_UP + STRIKER_PUCK_HEIGHT,
  );
  paintFace(ctx, puck, BRASS, false);

  paintBell(ctx, bell, bellRadius);

  // The mallet, its head blooded.
  ctx.fillStyle = rgb(ROT_TIMBER.light);
  ctx.beginPath();
  for (const point of mallet.handle) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  const headShade = ctx.createLinearGradient(
    mallet.head[0].x,
    mallet.head[0].y,
    mallet.head[2].x,
    mallet.head[2].y,
  );
  headShade.addColorStop(0, rgb(ROT_TIMBER.light));
  headShade.addColorStop(1, rgb(ROT_TIMBER.shadow));
  ctx.fillStyle = headShade;
  ctx.beginPath();
  for (const point of mallet.head) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  const headCentre = at(stage, STRIKER_MALLET.head.u, STRIKER_MALLET.head.up);
  fillSoftEllipse(
    ctx,
    headCentre.x + ts * STRIKER_BLOOD_OFFSET,
    headCentre.y,
    ts * STRIKER_BLOOD_RADIUS,
    ts * STRIKER_BLOOD_RADIUS,
    rgb(BLOOD.mid),
    1,
  );
  // And blood dried on the pad it was brought down on.
  fillSoftEllipse(
    ctx,
    pad.x + pad.w * 0.5,
    pad.y + pad.h * 0.5,
    pad.w * STRIKER_PAD_STAIN_WIDTH,
    pad.h * STRIKER_PAD_STAIN_HEIGHT,
    rgb(BLOOD.shadow),
    STRIKER_BLOOD_ALPHA,
  );
};
const STRIKER_LONG_TICK = 0.7;
const STRIKER_SHORT_TICK = 0.4;
const STRIKER_TICK_HEIGHT = 0.03;
const STRIKER_CROWN = 0.24;
const STRIKER_RAIL_AT = 0.72;
const STRIKER_RAIL_WIDTH = 0.025;
const STRIKER_RUNS = 3;
const STRIKER_PUCK_HALF = 0.11;
const STRIKER_PUCK_HEIGHT = 0.1;
const STRIKER_BLOOD_ALPHA = 0.85;
const STRIKER_BLOOD_OFFSET = 0.08;
const STRIKER_BLOOD_RADIUS = 0.1;
/** The iron strike pad sits just above the base's front edge and runs back over its lid, in tiles. */
const STRIKER_PAD_SEAT = 0.02;
const STRIKER_PAD_DEPTH = 0.1;
/** The ticks stop this far below the mast's top, in tiles, clear of the crown. */
const STRIKER_TICK_TOP_CLEARANCE = 0.1;
/** The dried stain on the pad, its radii as shares of the pad. */
const STRIKER_PAD_STAIN_WIDTH = 0.4;
const STRIKER_PAD_STAIN_HEIGHT = 0.45;

function traceBell(path: Ctx, centre: Point, radius: number): void {
  path.moveTo(centre.x - radius, centre.y + radius * BELL_LIP_DROP);
  const shoulder = radius * BELL_SHOULDER;
  path.quadraticCurveTo(centre.x - shoulder, centre.y - radius, centre.x, centre.y - radius);
  path.quadraticCurveTo(
    centre.x + shoulder,
    centre.y - radius,
    centre.x + radius,
    centre.y + radius * BELL_LIP_DROP,
  );
  path.closePath();
}
const BELL_LIP_DROP = 0.6;
/** Where the bell's crown curves pull toward, in radii off its centre line: square-shouldered, not a dome. */
const BELL_SHOULDER = 0.9;

function paintBell(ctx: Ctx, centre: Point, radius: number): void {
  const body = ctx.createLinearGradient(centre.x - radius, 0, centre.x + radius, 0);
  body.addColorStop(0, rgb(BRASS.light));
  body.addColorStop(BELL_TURN_STOP, rgb(BRASS.mid));
  body.addColorStop(1, rgb(BRASS.shadow));
  ctx.fillStyle = body;
  ctx.beginPath();
  traceBell(ctx, centre, radius);
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.accent, BELL_SHINE_ALPHA);
  ctx.fillRect(
    centre.x - radius * BELL_SHINE.west,
    centre.y - radius * BELL_SHINE.rise,
    radius * BELL_SHINE.width,
    radius * BELL_SHINE.height,
  );
  ctx.fillStyle = rgb(BRASS.shadow);
  ctx.fillRect(
    centre.x - radius,
    centre.y + radius * (BELL_LIP_DROP - BELL_LIP_BAND),
    radius * 2,
    radius * BELL_LIP_BAND,
  );
}
const BELL_SHINE_ALPHA = 0.8;
/** Where across the bell it turns from the sun into its mid tone. */
const BELL_TURN_STOP = 0.35;
/** The shine up the bell's lit west flank, in radii. */
const BELL_SHINE = { west: 0.55, rise: 0.55, width: 0.22, height: 0.8 } as const;
/** The dark band along the bell's lip, in radii. */
const BELL_LIP_BAND = 0.18;

function malletGeometry(stage: Stage): { handle: Point[]; head: Point[] } {
  const { ts } = stage;
  const foot = at(stage, STRIKER_MALLET.foot.u, STRIKER_MALLET.foot.up);
  const head = at(stage, STRIKER_MALLET.head.u, STRIKER_MALLET.head.up);
  const length = Math.hypot(head.x - foot.x, head.y - foot.y);
  const alongX = (head.x - foot.x) / length;
  const alongY = (head.y - foot.y) / length;
  const acrossX = -alongY;
  const acrossY = alongX;
  const handleHalf = (STRIKER_MALLET.handleWidth * ts) / 2;
  const headHalfLength = STRIKER_MALLET.headHalfLength * ts;
  const headHalfWidth = STRIKER_MALLET.headHalfWidth * ts;
  return {
    handle: [
      { x: foot.x + acrossX * handleHalf, y: foot.y + acrossY * handleHalf },
      { x: head.x + acrossX * handleHalf, y: head.y + acrossY * handleHalf },
      { x: head.x - acrossX * handleHalf, y: head.y - acrossY * handleHalf },
      { x: foot.x - acrossX * handleHalf, y: foot.y - acrossY * handleHalf },
    ],
    head: [
      {
        x: head.x + acrossX * headHalfLength + alongX * headHalfWidth,
        y: head.y + acrossY * headHalfLength + alongY * headHalfWidth,
      },
      {
        x: head.x - acrossX * headHalfLength + alongX * headHalfWidth,
        y: head.y - acrossY * headHalfLength + alongY * headHalfWidth,
      },
      {
        x: head.x - acrossX * headHalfLength - alongX * headHalfWidth,
        y: head.y - acrossY * headHalfLength - alongY * headHalfWidth,
      },
      {
        x: head.x + acrossX * headHalfLength - alongX * headHalfWidth,
        y: head.y + acrossY * headHalfLength - alongY * headHalfWidth,
      },
    ],
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

const BIG_TOP_HEADROOM_TILES = 3;
const PAVILION_HEADROOM_TILES = 3;
const ARCH_POST_HEADROOM_TILES = 3;
/** The flame lamp's brazier and the striker's bell stand well above a tile. */
const RIM_POST_HEADROOM_TILES = 3;
const WAGON_HEADROOM_TILES = 2;
const BOOTH_HEADROOM_TILES = 2;
/** Two casts of the lamp, the paint gone differently on each, so a ring of six is not six copies. */
const FLAME_LAMP_VARIANTS = 2;

export const CIRCUS_STRUCTURE_ART: Readonly<Record<CircusStructureId, CircusStructureArt>> = {
  big_top: {
    variants: 1,
    headroomTiles: BIG_TOP_HEADROOM_TILES,
    paint: aboveGround(BIG_TOP, paintBigTop),
  },
  pavilion_mold_lion: {
    variants: 1,
    headroomTiles: PAVILION_HEADROOM_TILES,
    paint: aboveGround(
      PAVILION,
      pavilionPainter(NAVY, BLOOD, false, [
        { text: 'THE AMAZING', heightFraction: 0.32 },
        { text: 'MOLD LION', heightFraction: 0.5 },
      ]),
    ),
  },
  pavilion_feats_of_flesh: {
    variants: 1,
    headroomTiles: PAVILION_HEADROOM_TILES,
    paint: aboveGround(
      PAVILION,
      pavilionPainter(BLOOD, BRUISE, false, [
        { text: 'FEATS OF', heightFraction: 0.34 },
        { text: 'FLESH', heightFraction: 0.5 },
      ]),
    ),
  },
  pavilion_fortunes: {
    variants: 1,
    headroomTiles: PAVILION_HEADROOM_TILES,
    paint: aboveGround(
      PAVILION,
      pavilionPainter(BRUISE, NAVY, true, [{ text: 'FORTUNES', heightFraction: 0.6 }]),
    ),
  },
  arch_post: {
    variants: 1,
    headroomTiles: ARCH_POST_HEADROOM_TILES,
    paint: aboveGround(ARCH_POST, paintArchPost),
  },
  flame_lamp: {
    variants: FLAME_LAMP_VARIANTS,
    headroomTiles: RIM_POST_HEADROOM_TILES,
    paint: aboveGround(RIM_POST, paintFlameLamp),
  },
  high_striker: {
    variants: 1,
    headroomTiles: RIM_POST_HEADROOM_TILES,
    paint: aboveGround(RIM_POST, paintHighStriker),
  },
  cage_wagon: {
    variants: 1,
    headroomTiles: WAGON_HEADROOM_TILES,
    paint: aboveGround(WAGON, paintCageWagon),
  },
  clown_caravan: {
    variants: 1,
    headroomTiles: WAGON_HEADROOM_TILES,
    paint: aboveGround(WAGON, paintClownCaravan),
  },
  prop_wagon: {
    variants: 1,
    headroomTiles: WAGON_HEADROOM_TILES,
    paint: aboveGround(WAGON, paintPropWagon),
  },
  ticket_booth: {
    variants: 1,
    headroomTiles: BOOTH_HEADROOM_TILES,
    paint: aboveGround(BOOTH, paintTicketBooth),
  },
  game_booth: {
    variants: 1,
    headroomTiles: BOOTH_HEADROOM_TILES,
    paint: aboveGround(BOOTH, paintGameBooth),
  },
  crate_stack: {
    variants: 1,
    headroomTiles: BOOTH_HEADROOM_TILES,
    paint: aboveGround(BOOTH, paintCrateStack),
  },
};

/** Exposed for the art gate: the geometry the painters draw from, to measure against. */
export const BIG_TOP_TENT = {
  peakHeightTiles: Math.max(...BIG_TOP_KING_POLES.map((pole) => pole.heightTiles)),
  eaveHeightTiles: BIG_TOP_MODEL.wallHeight,
  poleCapTiles: BIG_TOP_MODEL.poleCap,
} as const;
