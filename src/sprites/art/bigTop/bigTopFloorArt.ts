/**
 * The Big Top's baked floor marks: scorch round the vents, straw against the
 * cage walls, the harlequin cloth in the hall of mirrors, the ring's painted
 * curb, the chalked marks in the interval rooms — everything
 * `src/map/bigTopMazeDecor.ts` lays on the sawdust.
 *
 * Painted into the chunk bake over the sawdust material, one tile at a time.
 * Each tile draws every feature that covers it *whole*, in tile units, clipped
 * to itself — so a ring eight tiles across is one circle, and its pieces meet
 * across every tile and chunk border without either side knowing the other.
 *
 * Everything here is walkable ground and every hazard in the tent is read
 * against it, so all of it stays a tonal shift in the sawdust: low alpha, no
 * hard dark specks, and nothing saturated enough to be mistaken for a
 * telegraph.
 */

import {
  bigTopFloorFeaturesAt,
  decorHash,
  BURN_LANE_HALF_HEIGHT_TILES,
  GUY_SHADOW_HALF_WIDTH_TILES,
  HOLD_MARK_RADIUS_TILES,
  HOOP_RADIUS_TILES,
  PRACTICE_RING_HALF_WIDTH_TILES,
  RING_CURB_HALF_WIDTH_TILES,
  RUNNER_HALF_WIDTH_TILES,
  SOOT_DRAG_HALF_HEIGHT_TILES,
  SPOT_MARK_HALF_WIDTH_TILES,
  STANCHION_BASE_RADIUS_TILES,
  STRAW_DRIFT_DEPTH_TILES,
  TROUGH_SPILL_RADIUS_TILES,
  WHIP_COIL_RADIUS_TILES,
  rootPaths,
  type FloorFeature,
  type RootPath,
  type ScatterStyle,
  type TilePoint,
} from '../../../map/bigTopMazeDecor';
import type { MazeRect, MazeTile } from '../../../map/bigTopMazeLayout';
import { getCircusRamp, getTownRamp } from '../town/townPalette';
import { rgba } from '../town/townArt';
import { paintPoleFootShadow } from './bigTopShellArt';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const BACKSTAGE = getCircusRamp('circus_backstage');
const STRAW = getCircusRamp('circus_straw');
const BLOOD = getCircusRamp('circus_blood');
const BONE = getCircusRamp('circus_bone');
const BRUISE = getCircusRamp('circus_bruise');
const BRASS = getCircusRamp('circus_brass');
const MILDEW = getCircusRamp('circus_mildew');
const VINE = getCircusRamp('circus_vine');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const IRON = getTownRamp('iron_black');

/**
 * Paints every baked mark on one sawdust tile of the Big Top. A no-op
 * everywhere else, so it is safe to call from the sawdust tile's case in any
 * interior.
 */
export function paintBigTopFloorMarks(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  tileX: number,
  tileY: number,
): void {
  const features = bigTopFloorFeaturesAt(tileX, tileY);
  if (features.length === 0) return;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(sx, sy, ts, ts);
    ctx.clip();
    // From here on one unit is one tile, in world tile coordinates.
    ctx.translate(sx - tileX * ts, sy - tileY * ts);
    ctx.scale(ts, ts);
    const tile: MazeTile = { x: tileX, y: tileY };
    for (const feature of features) paintFeature(ctx, feature, tile);
  } finally {
    ctx.restore();
  }
}

function paintFeature(ctx: Ctx, feature: FloorFeature, tile: MazeTile): void {
  switch (feature.kind) {
    case 'scorch':
      paintScorch(ctx, feature.centre, feature.radius);
      return;
    case 'sootDrag':
      paintSootDrag(ctx, feature.x0, feature.x1, feature.row, feature.seed);
      return;
    case 'ironPlate':
      paintIronPlate(ctx, feature.tile, feature.seed);
      return;
    case 'strawDrift':
      paintStrawDrift(ctx, feature.x0, feature.x1, feature.row, feature.seed, tile);
      return;
    case 'pawTrail':
      paintPawTrail(ctx, feature.points);
      return;
    case 'whipCoil':
      paintWhipCoil(ctx, feature.centre, feature.seed);
      return;
    case 'troughSpill':
      paintTroughSpill(ctx, feature.centre, feature.seed);
      return;
    case 'practiceRing':
      paintPracticeRing(ctx, feature.centre, feature.radius);
      return;
    case 'hoop':
      paintHoop(ctx, feature.centre);
      return;
    case 'harlequinCloth':
      paintHarlequinCloth(ctx, feature.rect, tile);
      return;
    case 'burnLane':
      paintBurnLane(ctx, feature.x0, feature.x1, feature.row);
      return;
    case 'stanchion':
      paintStanchion(ctx, feature.centre, feature.ropeTo);
      return;
    case 'ringCurb':
      paintRingCurb(ctx, feature.centre, feature.radius);
      return;
    case 'spotMark':
      paintSpotMark(ctx, feature.centre, feature.radius);
      return;
    case 'vineRoots':
      paintVineRoots(ctx, feature.origin, feature.toward, feature.seed);
      return;
    case 'guyShadow':
      paintGuyShadow(ctx, feature.from, feature.to);
      return;
    case 'poleFoot':
      paintPoleFootShadow(ctx, feature.shadow);
      return;
    case 'runner':
      paintRunner(ctx, feature.column, feature.y0, feature.y1);
      return;
    case 'holdMark':
      paintHoldMark(ctx, feature.centre);
      return;
    case 'scatter':
      paintScatter(ctx, feature.tile, feature.style, feature.seed);
      return;
  }
}

// ── Fire walk ───────────────────────────────────────────────────────────────

/**
 * The grille itself stays nearly clean and the soot lies in a ring round it:
 * the vent's warning glow is drawn on the grille's own tile, and a sooty
 * surround makes that glow stand further out of the floor rather than
 * swallowing it.
 */
const SCORCH_CORE_ALPHA = 0.18;
const SCORCH_RING_ALPHA = 0.18;
const SCORCH_RING_STOP = 0.5;

/** Burnt sawdust round a vent: a sooty ring browning out to nothing. */
function paintScorch(ctx: Ctx, centre: TilePoint, radius: number): void {
  const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
  glow.addColorStop(0, rgba(BACKSTAGE.mid, SCORCH_CORE_ALPHA));
  glow.addColorStop(SCORCH_RING_STOP, rgba(ROT_TIMBER.shadow, SCORCH_RING_ALPHA));
  glow.addColorStop(1, rgba(ROT_TIMBER.shadow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, FULL_TURN);
  ctx.fill();
}

const SOOT_STREAKS = 2;
const SOOT_STREAK_OFFSETS: ReadonlyArray<number> = [-0.18, 0.2];
const SOOT_STREAK_THICKNESS = 0.08;
const SOOT_STREAK_ALPHA = 0.08;
const SOOT_DASH_MIN = 0.4;
const SOOT_DASH_RANGE = 1.1;
const SOOT_GAP_MIN = 0.1;
const SOOT_GAP_RANGE = 0.5;
const SOOT_SALT = 3;

/** The flame lanes throw soot along the ground in broken streaks, the way the fire walks. */
function paintSootDrag(ctx: Ctx, x0: number, x1: number, row: number, seed: number): void {
  const centreY = row + 0.5;
  ctx.fillStyle = rgba(BACKSTAGE.mid, SOOT_STREAK_ALPHA);
  for (let streak = 0; streak < SOOT_STREAKS; streak++) {
    const y = centreY + (SOOT_STREAK_OFFSETS[streak] ?? 0);
    let x = x0 + decorHash(seed, streak, SOOT_SALT) * SOOT_GAP_RANGE;
    let dash = 0;
    while (x < x1 + 1) {
      const length =
        SOOT_DASH_MIN + decorHash(seed, dash * SOOT_STREAKS + streak, SOOT_SALT) * SOOT_DASH_RANGE;
      const end = Math.min(x + length, x1 + 1);
      ctx.fillRect(x, y - SOOT_STREAK_THICKNESS / 2, end - x, SOOT_STREAK_THICKNESS);
      x = end + SOOT_GAP_MIN + decorHash(dash, seed, SOOT_SALT) * SOOT_GAP_RANGE;
      dash++;
    }
  }
  // A faint wash between the streaks, so the pair reads as one scorched lane.
  const wash = ctx.createLinearGradient(
    0,
    centreY - SOOT_DRAG_HALF_HEIGHT_TILES,
    0,
    centreY + SOOT_DRAG_HALF_HEIGHT_TILES,
  );
  wash.addColorStop(0, rgba(BACKSTAGE.mid, 0));
  wash.addColorStop(0.5, rgba(BACKSTAGE.mid, SOOT_STREAK_ALPHA / 2));
  wash.addColorStop(1, rgba(BACKSTAGE.mid, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(
    x0,
    centreY - SOOT_DRAG_HALF_HEIGHT_TILES,
    x1 + 1 - x0,
    SOOT_DRAG_HALF_HEIGHT_TILES * 2,
  );
}

const PLATE_INSET = 0.12;
const PLATE_FILL_ALPHA = 0.42;
const PLATE_EDGE_WIDTH = 0.045;
const PLATE_LIT_ALPHA = 0.3;
const PLATE_SHADE_ALPHA = 0.35;
const PLATE_RIVET_INSET = 0.1;
const PLATE_RIVET_RADIUS = 0.04;
const PLATE_RIVET_ALPHA = 0.45;
const PLATE_DUST_BLOBS = 3;
const PLATE_DUST_RADIUS = 0.16;
const PLATE_DUST_ALPHA = 0.3;
const PLATE_SALT = 7;

/**
 * A riveted iron floor plate, solid and slotless so it can never be read as a
 * vent grille, half buried in the sawdust kicked over it.
 */
function paintIronPlate(ctx: Ctx, tile: MazeTile, seed: number): void {
  const x = tile.x + PLATE_INSET;
  const y = tile.y + PLATE_INSET;
  const size = 1 - PLATE_INSET * 2;
  ctx.fillStyle = rgba(IRON.mid, PLATE_FILL_ALPHA);
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = rgba(IRON.light, PLATE_LIT_ALPHA);
  ctx.fillRect(x, y, size, PLATE_EDGE_WIDTH);
  ctx.fillRect(x, y, PLATE_EDGE_WIDTH, size);
  ctx.fillStyle = rgba(IRON.shadow, PLATE_SHADE_ALPHA);
  ctx.fillRect(x, y + size - PLATE_EDGE_WIDTH, size, PLATE_EDGE_WIDTH);
  ctx.fillRect(x + size - PLATE_EDGE_WIDTH, y, PLATE_EDGE_WIDTH, size);
  ctx.fillStyle = rgba(IRON.accent, PLATE_RIVET_ALPHA);
  for (const [cornerX, cornerY] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(
      x + PLATE_RIVET_INSET + cornerX * (size - PLATE_RIVET_INSET * 2),
      y + PLATE_RIVET_INSET + cornerY * (size - PLATE_RIVET_INSET * 2),
      PLATE_RIVET_RADIUS,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
  for (let blob = 0; blob < PLATE_DUST_BLOBS; blob++) {
    const bx = x + decorHash(seed, blob, PLATE_SALT) * size;
    const by = y + decorHash(blob, seed, PLATE_SALT) * size;
    const dust = ctx.createRadialGradient(bx, by, 0, bx, by, PLATE_DUST_RADIUS);
    dust.addColorStop(0, rgba(STRAW.light, PLATE_DUST_ALPHA));
    dust.addColorStop(1, rgba(STRAW.light, 0));
    ctx.fillStyle = dust;
    ctx.fillRect(
      bx - PLATE_DUST_RADIUS,
      by - PLATE_DUST_RADIUS,
      PLATE_DUST_RADIUS * 2,
      PLATE_DUST_RADIUS * 2,
    );
  }
}

// ── Menagerie ───────────────────────────────────────────────────────────────

const STRAW_WASH_ALPHA = 0.26;
const STRAWS_PER_TILE = 9;
const STRAW_MIN_LENGTH = 0.12;
const STRAW_LENGTH_RANGE = 0.2;
const STRAW_WIDTH = 0.035;
const STRAW_ALPHA = 0.45;
/** Straws lie mostly along the wall they drifted against, never standing up. */
const STRAW_MAX_TILT = 0.5;
const STRAW_SALT = 13;

/**
 * Straw drifted against the foot of a wall: a pale wash that thins away from
 * the wall, with loose straws in it. Only the straws that land on the tile
 * being drawn are generated, keyed by their column, so each tile does its own
 * share of the work and neighbours still agree.
 */
function paintStrawDrift(
  ctx: Ctx,
  x0: number,
  x1: number,
  row: number,
  seed: number,
  tile: MazeTile,
): void {
  const wash = ctx.createLinearGradient(0, row, 0, row + STRAW_DRIFT_DEPTH_TILES);
  wash.addColorStop(0, rgba(STRAW.light, STRAW_WASH_ALPHA));
  wash.addColorStop(1, rgba(STRAW.light, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(x0, row, x1 + 1 - x0, STRAW_DRIFT_DEPTH_TILES);

  ctx.lineWidth = STRAW_WIDTH;
  ctx.lineCap = 'round';
  // Straws from the columns either side can lean into this tile.
  for (let column = tile.x - 1; column <= tile.x + 1; column++) {
    if (column < x0 || column > x1) continue;
    for (let straw = 0; straw < STRAWS_PER_TILE; straw++) {
      const key = column * STRAWS_PER_TILE + straw;
      const along = decorHash(key, seed, STRAW_SALT);
      const depth = decorHash(seed, key, STRAW_SALT) ** 2 * STRAW_DRIFT_DEPTH_TILES;
      const length = STRAW_MIN_LENGTH + decorHash(key, key, STRAW_SALT + seed) * STRAW_LENGTH_RANGE;
      const tilt = (decorHash(key + 1, seed, STRAW_SALT) - 0.5) * 2 * STRAW_MAX_TILT;
      const x = column + along;
      const y = row + depth;
      const tone = decorHash(key, seed + 1, STRAW_SALT);
      ctx.strokeStyle = rgba(tone < 0.5 ? STRAW.light : STRAW.accent, STRAW_ALPHA);
      ctx.beginPath();
      ctx.moveTo(x - (Math.cos(tilt) * length) / 2, y - (Math.sin(tilt) * length) / 2);
      ctx.lineTo(x + (Math.cos(tilt) * length) / 2, y + (Math.sin(tilt) * length) / 2);
      ctx.stroke();
    }
  }
}

const PAW_PAD_RADIUS_X = 0.085;
const PAW_PAD_RADIUS_Y = 0.07;
const PAW_TOE_RADIUS = 0.036;
const PAW_TOE_REACH = 0.12;
const PAW_TOE_SPREAD = 0.7;
const PAW_TOES = 3;
const PAW_ALPHA = 0.3;

/** Pad prints pressed into the sawdust, toes leading the way the beast walked. */
function paintPawTrail(ctx: Ctx, points: ReadonlyArray<TilePoint>): void {
  ctx.fillStyle = rgba(STRAW.shadow, PAW_ALPHA);
  points.forEach((point, index) => {
    const next = points[index + 1] ?? point;
    const prev = points[index - 1] ?? point;
    const heading = Math.atan2(next.y - prev.y, next.x - prev.x);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, PAW_PAD_RADIUS_X, PAW_PAD_RADIUS_Y, heading, 0, FULL_TURN);
    ctx.fill();
    for (let toe = 0; toe < PAW_TOES; toe++) {
      const angle = heading + (toe - (PAW_TOES - 1) / 2) * PAW_TOE_SPREAD;
      ctx.beginPath();
      ctx.arc(
        point.x + Math.cos(angle) * PAW_TOE_REACH,
        point.y + Math.sin(angle) * PAW_TOE_REACH,
        PAW_TOE_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
  });
}

const WHIP_TURNS = 2.3;
const WHIP_INNER_RADIUS = 0.07;
const WHIP_SEGMENTS = 60;
const WHIP_WIDTH = 0.045;
const WHIP_SHADOW_OFFSET_X = 0.04;
const WHIP_SHADOW_OFFSET_Y = 0.05;
const WHIP_SHADOW_ALPHA = 0.25;
const WHIP_ALPHA = 0.8;
const WHIP_SHEEN_WIDTH = 0.015;
const WHIP_SHEEN_ALPHA = 0.35;
const WHIP_HANDLE_LENGTH = 0.36;
const WHIP_HANDLE_WIDTH = 0.07;
const WHIP_CAP_RADIUS = 0.045;

function whipSpiral(
  ctx: Ctx,
  centre: TilePoint,
  start: number,
  offsetX: number,
  offsetY: number,
): void {
  ctx.beginPath();
  for (let step = 0; step <= WHIP_SEGMENTS; step++) {
    const t = step / WHIP_SEGMENTS;
    const angle = start + t * WHIP_TURNS * FULL_TURN;
    const radius = WHIP_INNER_RADIUS + t * (WHIP_COIL_RADIUS_TILES - WHIP_INNER_RADIUS);
    const x = centre.x + Math.cos(angle) * radius + offsetX;
    const y = centre.y + Math.sin(angle) * radius + offsetY;
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** A ringmaster's whip dropped in a loose coil, its handle trailing off the last turn. */
function paintWhipCoil(ctx: Ctx, centre: TilePoint, seed: number): void {
  const start = decorHash(seed, seed, WHIP_SEGMENTS) * FULL_TURN;
  ctx.lineCap = 'round';
  ctx.lineWidth = WHIP_WIDTH;
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, WHIP_SHADOW_ALPHA);
  whipSpiral(ctx, centre, start, WHIP_SHADOW_OFFSET_X, WHIP_SHADOW_OFFSET_Y);
  ctx.strokeStyle = rgba(ROT_TIMBER.shadow, WHIP_ALPHA);
  whipSpiral(ctx, centre, start, 0, 0);
  ctx.lineWidth = WHIP_SHEEN_WIDTH;
  ctx.strokeStyle = rgba(ROT_TIMBER.light, WHIP_SHEEN_ALPHA);
  whipSpiral(ctx, centre, start, -WHIP_SHEEN_WIDTH, -WHIP_SHEEN_WIDTH);

  const endAngle = start + WHIP_TURNS * FULL_TURN;
  const endX = centre.x + Math.cos(endAngle) * WHIP_COIL_RADIUS_TILES;
  const endY = centre.y + Math.sin(endAngle) * WHIP_COIL_RADIUS_TILES;
  const tangent = endAngle + Math.PI / 2;
  const handleX = endX + Math.cos(tangent) * WHIP_HANDLE_LENGTH;
  const handleY = endY + Math.sin(tangent) * WHIP_HANDLE_LENGTH;
  ctx.lineWidth = WHIP_HANDLE_WIDTH;
  ctx.strokeStyle = rgba(ROT_TIMBER.mid, WHIP_ALPHA);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(handleX, handleY);
  ctx.stroke();
  ctx.fillStyle = rgba(BRASS.mid, WHIP_ALPHA);
  ctx.beginPath();
  ctx.arc(handleX, handleY, WHIP_CAP_RADIUS, 0, FULL_TURN);
  ctx.fill();
}

const SPILL_LOBES = 4;
const SPILL_LOBE_SCALE = 0.55;
const SPILL_LOBE_SPREAD = 0.3;
const SPILL_ALPHA = 0.17;
const SPILL_FEED_BITS = 14;
const SPILL_FEED_LENGTH = 0.08;
const SPILL_FEED_WIDTH = 0.03;
const SPILL_FEED_ALPHA = 0.5;
const SPILL_SALT = 17;

/** Where a feed trough slopped over: a damp dark stain with feed scattered in it. */
function paintTroughSpill(ctx: Ctx, centre: TilePoint, seed: number): void {
  for (let lobe = 0; lobe < SPILL_LOBES; lobe++) {
    const angle = decorHash(seed, lobe, SPILL_SALT) * FULL_TURN;
    const cx = centre.x + Math.cos(angle) * SPILL_LOBE_SPREAD * TROUGH_SPILL_RADIUS_TILES;
    const cy = centre.y + Math.sin(angle) * SPILL_LOBE_SPREAD * TROUGH_SPILL_RADIUS_TILES;
    const radius = TROUGH_SPILL_RADIUS_TILES * SPILL_LOBE_SCALE;
    const stain = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    stain.addColorStop(0, rgba(MILDEW.shadow, SPILL_ALPHA));
    stain.addColorStop(1, rgba(MILDEW.shadow, 0));
    ctx.fillStyle = stain;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.lineWidth = SPILL_FEED_WIDTH;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(STRAW.accent, SPILL_FEED_ALPHA);
  for (let bit = 0; bit < SPILL_FEED_BITS; bit++) {
    const angle = decorHash(bit, seed, SPILL_SALT) * FULL_TURN;
    const reach =
      decorHash(seed + bit, bit, SPILL_SALT) * TROUGH_SPILL_RADIUS_TILES * SPILL_LOBE_SCALE;
    const x = centre.x + Math.cos(angle) * reach;
    const y = centre.y + Math.sin(angle) * reach;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + Math.cos(angle * 3) * SPILL_FEED_LENGTH,
      y + Math.sin(angle * 3) * SPILL_FEED_LENGTH,
    );
    ctx.stroke();
  }
}

const PRACTICE_GROOVE_ALPHA = 0.2;
const PRACTICE_RIM_OFFSET = 0.07;
const PRACTICE_RIM_WIDTH = 0.04;
const PRACTICE_RIM_ALPHA = 0.22;

/** A ring raked into the sawdust where the beasts were walked in circles: a groove, lit on its far lip. */
function paintPracticeRing(ctx: Ctx, centre: TilePoint, radius: number): void {
  ctx.lineWidth = PRACTICE_RING_HALF_WIDTH_TILES * 2;
  ctx.strokeStyle = rgba(STRAW.shadow, PRACTICE_GROOVE_ALPHA);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, FULL_TURN);
  ctx.stroke();
  ctx.lineWidth = PRACTICE_RIM_WIDTH;
  ctx.strokeStyle = rgba(STRAW.accent, PRACTICE_RIM_ALPHA);
  ctx.beginPath();
  ctx.arc(centre.x + PRACTICE_RIM_OFFSET / 2, centre.y + PRACTICE_RIM_OFFSET, radius, 0, FULL_TURN);
  ctx.stroke();
}

/** A hoop lies flat, so it is foreshortened to this share of its width. */
const HOOP_FLATTEN = 0.5;
const HOOP_WIDTH = 0.065;
const HOOP_SHADOW_OFFSET_X = 0.05;
const HOOP_SHADOW_OFFSET_Y = 0.06;
const HOOP_SHADOW_ALPHA = 0.28;
const HOOP_ALPHA = 0.75;
const HOOP_TAPE_DASH = 0.08;
const HOOP_TAPE_GAP = 0.16;
const HOOP_TAPE_ALPHA = 0.6;
const HOOP_GLINT_WIDTH = 0.02;
const HOOP_GLINT_ALPHA = 0.45;
const HOOP_GLINT_FROM = Math.PI * 1.05;
const HOOP_GLINT_TO = Math.PI * 1.55;

/** A tumbler's hoop, dropped flat: tape-wrapped red over a soft contact shadow. */
function paintHoop(ctx: Ctx, centre: TilePoint): void {
  const radiusY = HOOP_RADIUS_TILES * HOOP_FLATTEN;
  const ring = (offsetX: number, offsetY: number): void => {
    ctx.beginPath();
    ctx.ellipse(
      centre.x + offsetX,
      centre.y + offsetY,
      HOOP_RADIUS_TILES,
      radiusY,
      0,
      0,
      FULL_TURN,
    );
    ctx.stroke();
  };
  ctx.lineWidth = HOOP_WIDTH;
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, HOOP_SHADOW_ALPHA);
  ring(HOOP_SHADOW_OFFSET_X, HOOP_SHADOW_OFFSET_Y);
  ctx.strokeStyle = rgba(BLOOD.mid, HOOP_ALPHA);
  ring(0, 0);
  ctx.setLineDash([HOOP_TAPE_DASH, HOOP_TAPE_GAP]);
  ctx.strokeStyle = rgba(BONE.light, HOOP_TAPE_ALPHA);
  ring(0, 0);
  ctx.setLineDash([]);
  ctx.lineWidth = HOOP_GLINT_WIDTH;
  ctx.strokeStyle = rgba(BONE.accent, HOOP_GLINT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, HOOP_RADIUS_TILES, radiusY, 0, HOOP_GLINT_FROM, HOOP_GLINT_TO);
  ctx.stroke();
}

// ── Hall of mirrors ─────────────────────────────────────────────────────────

const CLOTH_GROUND_ALPHA = 0.2;
const DIAMOND_WIDTH_TILES = 1;
const DIAMOND_HEIGHT_TILES = 1.4;
const DIAMOND_DARK_ALPHA = 0.2;
const DIAMOND_PALE_ALPHA = 0.14;
const CLOTH_BORDER_TILES = 0.14;
const CLOTH_BORDER_ALPHA = 0.32;
const CLOTH_BORDER_LINE_WIDTH = 0.035;
const CLOTH_BORDER_LINE_ALPHA = 0.45;
const CLOTH_DUST_BLOBS = 2;
const CLOTH_DUST_RADIUS = 0.35;
const CLOTH_DUST_ALPHA = 0.2;
const CLOTH_SALT = 19;

/**
 * A harlequin floor cloth laid over the sawdust: muted bruise-and-bone
 * diamonds inside a tarnished border, dusted with the sawdust tracked across
 * it. Only the diamonds touching the tile being drawn are traced.
 */
function paintHarlequinCloth(ctx: Ctx, rect: MazeRect, tile: MazeTile): void {
  const x0 = rect.x0;
  const y0 = rect.y0;
  const width = rect.x1 + 1 - rect.x0;
  const height = rect.y1 + 1 - rect.y0;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x0, y0, width, height);
    ctx.clip();
    ctx.fillStyle = rgba(BONE.shadow, CLOTH_GROUND_ALPHA);
    ctx.fillRect(tile.x, tile.y, 1, 1);

    // Diamond (a, b) spans u in [a, a+1] and v in [b, b+1], where
    // u = dx/W + dy/H and v = dx/W - dy/H: a checkerboard turned on its point.
    const toPoint = (u: number, v: number): [number, number] => [
      x0 + ((u + v) / 2) * DIAMOND_WIDTH_TILES,
      y0 + ((u - v) / 2) * DIAMOND_HEIGHT_TILES,
    ];
    const uAt = (x: number, y: number): number =>
      (x - x0) / DIAMOND_WIDTH_TILES + (y - y0) / DIAMOND_HEIGHT_TILES;
    const vAt = (x: number, y: number): number =>
      (x - x0) / DIAMOND_WIDTH_TILES - (y - y0) / DIAMOND_HEIGHT_TILES;
    const corners = [
      [tile.x, tile.y],
      [tile.x + 1, tile.y],
      [tile.x, tile.y + 1],
      [tile.x + 1, tile.y + 1],
    ] as const;
    const us = corners.map(([x, y]) => uAt(x, y));
    const vs = corners.map(([x, y]) => vAt(x, y));
    for (let a = Math.floor(Math.min(...us)); a <= Math.ceil(Math.max(...us)); a++) {
      for (let b = Math.floor(Math.min(...vs)); b <= Math.ceil(Math.max(...vs)); b++) {
        const dark = (((a + b) % 2) + 2) % 2 === 0;
        ctx.fillStyle = dark
          ? rgba(BRUISE.shadow, DIAMOND_DARK_ALPHA)
          : rgba(BONE.mid, DIAMOND_PALE_ALPHA);
        ctx.beginPath();
        ctx.moveTo(...toPoint(a, b));
        ctx.lineTo(...toPoint(a + 1, b));
        ctx.lineTo(...toPoint(a + 1, b + 1));
        ctx.lineTo(...toPoint(a, b + 1));
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = rgba(BRASS.shadow, CLOTH_BORDER_ALPHA);
    ctx.lineWidth = CLOTH_BORDER_TILES * 2;
    ctx.strokeRect(x0, y0, width, height);
    ctx.strokeStyle = rgba(BRASS.mid, CLOTH_BORDER_LINE_ALPHA);
    ctx.lineWidth = CLOTH_BORDER_LINE_WIDTH;
    ctx.strokeRect(
      x0 + CLOTH_BORDER_TILES * 1.5,
      y0 + CLOTH_BORDER_TILES * 1.5,
      width - CLOTH_BORDER_TILES * 3,
      height - CLOTH_BORDER_TILES * 3,
    );

    for (let blob = 0; blob < CLOTH_DUST_BLOBS; blob++) {
      const bx = tile.x + decorHash(tile.x * CLOTH_DUST_BLOBS + blob, tile.y, CLOTH_SALT);
      const by = tile.y + decorHash(tile.y, tile.x * CLOTH_DUST_BLOBS + blob, CLOTH_SALT);
      const dust = ctx.createRadialGradient(bx, by, 0, bx, by, CLOTH_DUST_RADIUS);
      dust.addColorStop(0, rgba(STRAW.mid, CLOTH_DUST_ALPHA));
      dust.addColorStop(1, rgba(STRAW.mid, 0));
      ctx.fillStyle = dust;
      ctx.fillRect(tile.x, tile.y, 1, 1);
    }
  } finally {
    ctx.restore();
  }
}

const BURN_CORE_ALPHA = 0.32;
const BURN_EDGE_ALPHA = 0.12;
const BURN_EDGE_STOP = 0.3;
const BURN_CHAR_LINES = 3;
const BURN_CHAR_WIDTH = 0.03;
const BURN_CHAR_ALPHA = 0.18;
const BURN_CHAR_SPREAD = 0.5;

/**
 * Where a limelight's unbent beam always burns: a scorched lane straight
 * through whatever lies there, cloth included — a permanent mark of the one
 * span in the hall that is fire and never moves.
 */
function paintBurnLane(ctx: Ctx, x0: number, x1: number, row: number): void {
  const centreY = row + 0.5;
  const top = centreY - BURN_LANE_HALF_HEIGHT_TILES;
  const bottom = centreY + BURN_LANE_HALF_HEIGHT_TILES;
  const burn = ctx.createLinearGradient(0, top, 0, bottom);
  burn.addColorStop(0, rgba(ROT_TIMBER.shadow, 0));
  burn.addColorStop(BURN_EDGE_STOP, rgba(ROT_TIMBER.shadow, BURN_EDGE_ALPHA));
  burn.addColorStop(0.5, rgba(BACKSTAGE.mid, BURN_CORE_ALPHA));
  burn.addColorStop(1 - BURN_EDGE_STOP, rgba(ROT_TIMBER.shadow, BURN_EDGE_ALPHA));
  burn.addColorStop(1, rgba(ROT_TIMBER.shadow, 0));
  ctx.fillStyle = burn;
  ctx.fillRect(x0, top, x1 + 1 - x0, bottom - top);
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, BURN_CHAR_ALPHA);
  ctx.lineWidth = BURN_CHAR_WIDTH;
  for (let line = 0; line < BURN_CHAR_LINES; line++) {
    const offset =
      ((line + 0.5) / BURN_CHAR_LINES - 0.5) * BURN_LANE_HALF_HEIGHT_TILES * BURN_CHAR_SPREAD * 2;
    ctx.beginPath();
    ctx.moveTo(x0, centreY + offset);
    ctx.lineTo(x1 + 1, centreY + offset);
    ctx.stroke();
  }
}

const ROPE_SAG_TILES = 0.2;
const ROPE_SHADOW_WIDTH = 0.06;
const ROPE_SHADOW_ALPHA = 0.18;
const POST_SHADOW_LENGTH = 0.5;
const POST_SHADOW_WIDTH = 0.07;
const POST_SHADOW_ALPHA = 0.16;
const STANCHION_CONTACT_OFFSET = 0.04;
const STANCHION_CONTACT_ALPHA = 0.3;
const STANCHION_FLATTEN = 0.62;
const STANCHION_TOP_SCALE = 0.65;
const STANCHION_BASE_ALPHA = 0.8;
const STANCHION_GLINT_RADIUS = 0.025;
const STANCHION_GLINT_OFFSET = 0.04;

/**
 * A velvet-rope stanchion as the floor sees it: a flat brass foot, the
 * shadow its post throws, and the shadow of the rope slung to the next one.
 * No post and no rope are drawn — it must never read as something to walk
 * round.
 */
function paintStanchion(ctx: Ctx, centre: TilePoint, ropeTo: TilePoint | null): void {
  ctx.lineCap = 'round';
  if (ropeTo !== null) {
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, ROPE_SHADOW_ALPHA);
    ctx.lineWidth = ROPE_SHADOW_WIDTH;
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y);
    ctx.quadraticCurveTo(
      (centre.x + ropeTo.x) / 2,
      (centre.y + ropeTo.y) / 2 + ROPE_SAG_TILES * 2,
      ropeTo.x,
      ropeTo.y,
    );
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(BACKSTAGE.shadow, POST_SHADOW_ALPHA);
  ctx.lineWidth = POST_SHADOW_WIDTH;
  ctx.beginPath();
  ctx.moveTo(centre.x, centre.y);
  ctx.lineTo(
    centre.x + POST_SHADOW_LENGTH * Math.SQRT1_2,
    centre.y + POST_SHADOW_LENGTH * Math.SQRT1_2,
  );
  ctx.stroke();

  const radiusY = STANCHION_BASE_RADIUS_TILES * STANCHION_FLATTEN;
  ctx.fillStyle = rgba(BACKSTAGE.shadow, STANCHION_CONTACT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    centre.x + STANCHION_CONTACT_OFFSET,
    centre.y + STANCHION_CONTACT_OFFSET,
    STANCHION_BASE_RADIUS_TILES,
    radiusY,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.shadow, STANCHION_BASE_ALPHA);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, STANCHION_BASE_RADIUS_TILES, radiusY, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.mid, STANCHION_BASE_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    STANCHION_BASE_RADIUS_TILES * STANCHION_TOP_SCALE,
    radiusY * STANCHION_TOP_SCALE,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
  ctx.fillStyle = rgba(BRASS.accent, STANCHION_BASE_ALPHA);
  ctx.beginPath();
  ctx.arc(
    centre.x - STANCHION_GLINT_OFFSET,
    centre.y - STANCHION_GLINT_OFFSET / 2,
    STANCHION_GLINT_RADIUS,
    0,
    FULL_TURN,
  );
  ctx.fill();
}

// ── Finale ──────────────────────────────────────────────────────────────────

const CURB_PAINT_ALPHA = 0.5;
const CURB_PINSTRIPE_WIDTH = 0.035;
const CURB_PINSTRIPE_INSET = 0.04;
const CURB_PINSTRIPE_ALPHA = 0.45;
const CURB_WEAR_ALPHA = 0.4;
const CURB_WEAR_DASH = 0.35;
const CURB_WEAR_GAP = 1.6;
const CURB_WEAR_WIDTH_SHARE = 0.7;

/**
 * The ring's curb, painted flat on the sawdust: dried-blood red between two
 * bone pinstripes, scuffed through in places where the troupe ran over it.
 * Paint, not a kerb — the ring is walkable, and nothing here may say it isn't.
 */
function paintRingCurb(ctx: Ctx, centre: TilePoint, radius: number): void {
  const circle = (r: number): void => {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r, 0, FULL_TURN);
    ctx.stroke();
  };
  ctx.lineWidth = RING_CURB_HALF_WIDTH_TILES * 2;
  ctx.strokeStyle = rgba(BLOOD.mid, CURB_PAINT_ALPHA);
  circle(radius);
  ctx.lineWidth = CURB_PINSTRIPE_WIDTH;
  ctx.strokeStyle = rgba(BONE.mid, CURB_PINSTRIPE_ALPHA);
  circle(radius - RING_CURB_HALF_WIDTH_TILES + CURB_PINSTRIPE_INSET);
  circle(radius + RING_CURB_HALF_WIDTH_TILES - CURB_PINSTRIPE_INSET);
  ctx.lineWidth = RING_CURB_HALF_WIDTH_TILES * 2 * CURB_WEAR_WIDTH_SHARE;
  ctx.strokeStyle = rgba(STRAW.mid, CURB_WEAR_ALPHA);
  ctx.setLineDash([CURB_WEAR_DASH, CURB_WEAR_GAP]);
  circle(radius);
  ctx.setLineDash([]);
}

const SPOT_MARK_ALPHA = 0.3;
const SPOT_MARK_DASH = 0.25;
const SPOT_MARK_GAP = 0.18;

/** The performer's mark round the king pole, chalked in dashes. */
function paintSpotMark(ctx: Ctx, centre: TilePoint, radius: number): void {
  ctx.lineWidth = SPOT_MARK_HALF_WIDTH_TILES * 2;
  ctx.strokeStyle = rgba(BONE.light, SPOT_MARK_ALPHA);
  ctx.setLineDash([SPOT_MARK_DASH, SPOT_MARK_GAP]);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, FULL_TURN);
  ctx.stroke();
  ctx.setLineDash([]);
}

const ROOT_CRACK_SCALE = 1.9;
const ROOT_CRACK_ALPHA = 0.22;
const ROOT_BODY_ALPHA = 0.75;
const ROOT_SHEEN_SCALE = 0.35;
const ROOT_SHEEN_ALPHA = 0.45;
const ROOT_SHEEN_OFFSET = 0.012;

function strokeTapered(ctx: Ctx, path: RootPath, widthScale: number, dx: number, dy: number): void {
  const count = path.points.length - 1;
  for (let segment = 0; segment < count; segment++) {
    const from = path.points[segment];
    const to = path.points[segment + 1];
    ctx.lineWidth = path.width * widthScale * (1 - segment / (count + 1));
    ctx.beginPath();
    ctx.moveTo(from.x + dx, from.y + dy);
    ctx.lineTo(to.x + dx, to.y + dy);
    ctx.stroke();
  }
}

/** Grimaldi's vine, cracking out through the sawdust from the king pole. */
function paintVineRoots(ctx: Ctx, origin: TilePoint, toward: TilePoint, seed: number): void {
  const paths = rootPaths(origin, toward, seed);
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(ROT_TIMBER.shadow, ROOT_CRACK_ALPHA);
  for (const path of paths) strokeTapered(ctx, path, ROOT_CRACK_SCALE, 0, 0);
  ctx.strokeStyle = rgba(VINE.shadow, ROOT_BODY_ALPHA);
  for (const path of paths) strokeTapered(ctx, path, 1, 0, 0);
  ctx.strokeStyle = rgba(VINE.mid, ROOT_SHEEN_ALPHA);
  for (const path of paths) {
    strokeTapered(ctx, path, ROOT_SHEEN_SCALE, -ROOT_SHEEN_OFFSET, -ROOT_SHEEN_OFFSET);
  }
}

const GUY_SHADOW_NEAR_ALPHA = 0.14;
const GUY_SHADOW_FAR_ALPHA = 0.04;

/** The shadow a guy line throws down across the ring from high on the king pole. */
function paintGuyShadow(ctx: Ctx, from: TilePoint, to: TilePoint): void {
  const fade = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  fade.addColorStop(0, rgba(BACKSTAGE.shadow, GUY_SHADOW_NEAR_ALPHA));
  fade.addColorStop(1, rgba(BACKSTAGE.shadow, GUY_SHADOW_FAR_ALPHA));
  ctx.strokeStyle = fade;
  ctx.lineWidth = GUY_SHADOW_HALF_WIDTH_TILES * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// ── The interval rooms ──────────────────────────────────────────────────────

const RUNNER_BASE_ALPHA = 0.8;
const RUNNER_FIELD_INSET = 0.07;
const RUNNER_FIELD_ALPHA = 0.45;
const RUNNER_STRIPE_INSET = 0.045;
const RUNNER_STRIPE_WIDTH = 0.025;
const RUNNER_STRIPE_ALPHA = 0.55;
const RUNNER_WEAR_WIDTH = 0.2;
const RUNNER_WEAR_ALPHA = 0.14;

/** The carpet laid from the interval room's door to where a crawler waits. */
function paintRunner(ctx: Ctx, column: number, y0: number, y1: number): void {
  const left = column + 0.5 - RUNNER_HALF_WIDTH_TILES;
  const width = RUNNER_HALF_WIDTH_TILES * 2;
  const height = y1 + 1 - y0;
  ctx.fillStyle = rgba(BLOOD.shadow, RUNNER_BASE_ALPHA);
  ctx.fillRect(left, y0, width, height);
  ctx.fillStyle = rgba(BLOOD.mid, RUNNER_FIELD_ALPHA);
  ctx.fillRect(left + RUNNER_FIELD_INSET, y0, width - RUNNER_FIELD_INSET * 2, height);
  ctx.fillStyle = rgba(BONE.mid, RUNNER_STRIPE_ALPHA);
  ctx.fillRect(left + RUNNER_STRIPE_INSET, y0, RUNNER_STRIPE_WIDTH, height);
  ctx.fillRect(
    left + width - RUNNER_STRIPE_INSET - RUNNER_STRIPE_WIDTH,
    y0,
    RUNNER_STRIPE_WIDTH,
    height,
  );
  ctx.fillStyle = rgba(BLOOD.light, RUNNER_WEAR_ALPHA);
  ctx.fillRect(column + 0.5 - RUNNER_WEAR_WIDTH / 2, y0, RUNNER_WEAR_WIDTH, height);
}

const CHALK_WIDTH = 0.04;
const CHALK_ALPHA = 0.55;
const CHALK_SECOND_PASS_ALPHA = 0.25;
const CHALK_SECOND_PASS_OFFSET = 0.015;
const HOLD_LETTER_HEIGHT = 0.2;
const HOLD_LETTER_WIDTH = 0.12;
const HOLD_LETTER_GAP = 0.04;
const HOLD_LETTERS = 4;

/** "HOLD" in chalk strokes, one polyline set per letter, in a letter box of unit size. */
const HOLD_GLYPHS: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = [
  [
    [
      [0, 0],
      [0, 1],
    ],
    [
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
  [
    [
      [0.5, 0],
      [1, 0.25],
      [1, 0.75],
      [0.5, 1],
      [0, 0.75],
      [0, 0.25],
      [0.5, 0],
    ],
  ],
  [
    [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
  ],
  [
    [
      [0, 0],
      [0, 1],
      [0.6, 1],
      [1, 0.7],
      [1, 0.3],
      [0.6, 0],
      [0, 0],
    ],
  ],
];

/**
 * The chalked spot each crawler waits on in an interval room: a ring and the
 * word HOLD, because the curtain only lifts with both of them standing on theirs.
 */
function paintHoldMark(ctx: Ctx, centre: TilePoint): void {
  const pass = (offset: number, alpha: number): void => {
    ctx.strokeStyle = rgba(BONE.accent, alpha);
    ctx.beginPath();
    ctx.arc(centre.x + offset, centre.y - offset, HOLD_MARK_RADIUS_TILES, 0, FULL_TURN);
    ctx.stroke();
    const totalWidth = HOLD_LETTERS * HOLD_LETTER_WIDTH + (HOLD_LETTERS - 1) * HOLD_LETTER_GAP;
    const left = centre.x - totalWidth / 2 + offset;
    const top = centre.y - HOLD_LETTER_HEIGHT / 2 - offset;
    HOLD_GLYPHS.forEach((glyph, index) => {
      const letterLeft = left + index * (HOLD_LETTER_WIDTH + HOLD_LETTER_GAP);
      for (const stroke of glyph) {
        ctx.beginPath();
        stroke.forEach(([gx, gy], pointIndex) => {
          const x = letterLeft + gx * HOLD_LETTER_WIDTH;
          const y = top + gy * HOLD_LETTER_HEIGHT;
          if (pointIndex === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    });
  };
  ctx.lineWidth = CHALK_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  pass(0, CHALK_ALPHA);
  pass(CHALK_SECOND_PASS_OFFSET, CHALK_SECOND_PASS_ALPHA);
}

// ── Scatter ─────────────────────────────────────────────────────────────────

const SCATTER_MARGIN = 0.25;
const SCUFF_RADIUS_X = 0.24;
const SCUFF_RADIUS_Y = 0.13;
const SCUFF_ALPHA = 0.14;
const CINDER_FLECKS = 3;
const CINDER_RADIUS = 0.035;
const CINDER_SPREAD = 0.2;
const CINDER_ALPHA = 0.45;
const TUFT_STRAWS = 8;
const TUFT_SPREAD = 0.2;
const SEQUINS = 6;
const SEQUIN_RADIUS = 0.04;
const SEQUIN_SPREAD = 0.3;
const SEQUIN_ALPHA = 0.7;
const TENDRIL_LENGTH = 0.5;
const TENDRIL_CURL = 0.25;
const TENDRIL_WIDTH = 0.04;
const TENDRIL_ALPHA = 0.5;
const LEAF_RADIUS_X = 0.07;
const LEAF_RADIUS_Y = 0.035;
const SCATTER_SALT = 31;

/** A small mark of whichever act a bare stretch of floor belongs to. */
function paintScatter(ctx: Ctx, tile: MazeTile, style: ScatterStyle, seed: number): void {
  const hash = (a: number, b: number): number => decorHash(seed + a, b, SCATTER_SALT);
  const x = tile.x + SCATTER_MARGIN + hash(1, 0) * (1 - SCATTER_MARGIN * 2);
  const y = tile.y + SCATTER_MARGIN + hash(2, 0) * (1 - SCATTER_MARGIN * 2);
  if (style === 'firewalk') {
    const scuff = ctx.createRadialGradient(x, y, 0, x, y, SCUFF_RADIUS_X);
    scuff.addColorStop(0, rgba(BACKSTAGE.mid, SCUFF_ALPHA));
    scuff.addColorStop(1, rgba(BACKSTAGE.mid, 0));
    ctx.fillStyle = scuff;
    ctx.beginPath();
    ctx.ellipse(x, y, SCUFF_RADIUS_X, SCUFF_RADIUS_Y, hash(3, 0) * Math.PI, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = rgba(ROT_TIMBER.shadow, CINDER_ALPHA);
    for (let fleck = 0; fleck < CINDER_FLECKS; fleck++) {
      ctx.beginPath();
      ctx.arc(
        x + (hash(fleck, 4) - 0.5) * CINDER_SPREAD * 2,
        y + (hash(fleck, 5) - 0.5) * CINDER_SPREAD,
        CINDER_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
    return;
  }
  if (style === 'menagerie') {
    ctx.lineWidth = STRAW_WIDTH;
    ctx.lineCap = 'round';
    for (let straw = 0; straw < TUFT_STRAWS; straw++) {
      const angle = hash(straw, 6) * Math.PI;
      const length = STRAW_MIN_LENGTH + hash(straw, 7) * STRAW_LENGTH_RANGE;
      const cx = x + (hash(straw, 8) - 0.5) * TUFT_SPREAD * 2;
      const cy = y + (hash(straw, 9) - 0.5) * TUFT_SPREAD;
      ctx.strokeStyle = rgba(hash(straw, 10) < 0.5 ? STRAW.light : STRAW.accent, STRAW_ALPHA);
      ctx.beginPath();
      ctx.moveTo(cx - (Math.cos(angle) * length) / 2, cy - (Math.sin(angle) * length) / 2);
      ctx.lineTo(cx + (Math.cos(angle) * length) / 2, cy + (Math.sin(angle) * length) / 2);
      ctx.stroke();
    }
    return;
  }
  if (style === 'mirrors') {
    for (let sequin = 0; sequin < SEQUINS; sequin++) {
      const tone = sequin % 3;
      ctx.fillStyle =
        tone === 0
          ? rgba(BRASS.accent, SEQUIN_ALPHA)
          : tone === 1
            ? rgba(BRUISE.light, SEQUIN_ALPHA)
            : rgba(BONE.accent, SEQUIN_ALPHA);
      ctx.beginPath();
      ctx.arc(
        x + (hash(sequin, 11) - 0.5) * SEQUIN_SPREAD * 2,
        y + (hash(sequin, 12) - 0.5) * SEQUIN_SPREAD * 2,
        SEQUIN_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
    return;
  }
  const angle = hash(13, 0) * FULL_TURN;
  const endX = x + Math.cos(angle) * TENDRIL_LENGTH;
  const endY = y + Math.sin(angle) * TENDRIL_LENGTH;
  ctx.lineWidth = TENDRIL_WIDTH;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(VINE.shadow, TENDRIL_ALPHA);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(
    (x + endX) / 2 + Math.cos(angle + Math.PI / 2) * TENDRIL_CURL,
    (y + endY) / 2 + Math.sin(angle + Math.PI / 2) * TENDRIL_CURL,
    endX,
    endY,
  );
  ctx.stroke();
  ctx.fillStyle = rgba(VINE.mid, TENDRIL_ALPHA);
  ctx.beginPath();
  ctx.ellipse(endX, endY, LEAF_RADIUS_X, LEAF_RADIUS_Y, angle, 0, FULL_TURN);
  ctx.fill();
}
