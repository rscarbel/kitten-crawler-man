#!/usr/bin/env tsx
/**
 * Gates for the circus grounds' structure art: the Big Top, the side-show
 * pavilions, the entry arch's posts and the rim's props — the flame lamps,
 * the wagons, the midway booths, the high striker and the crate stack.
 *
 *   npm run gates:circus-art
 *   npm run gates:circus-art -- --fault=wide-prop      # must fail
 *   npm run gates:circus-art -- --fault=flat-canvas    # must fail
 *   npm run gates:circus-art -- --fault=sheet-budget   # must fail
 *   npm run gates:circus-art -- --fault=loose-crossbar # must fail
 *
 * Checked, in order:
 *
 * 1. **Frame contract.** Every plan agrees with its manifest entry, every
 *    frame paints something, and nothing outside its frame: each is painted
 *    with no clip into a padded canvas, because the game clips every frame to
 *    its cell and the clip hides exactly the ink this looks for. Each sheet is
 *    then baked as the game bakes it and every frame's border checked for ink
 *    (`clippedFrames`). Every painter runs on a strict context
 *    (`strictCanvas.ts`) that throws where Chrome throws and records non-finite
 *    arguments, and must leave its save stack where it found it.
 * 2. **Footprint.** No solid ink outside the blocked footprint except straight
 *    up: in each column only as low as that column's lowest blocked tile (or
 *    the doorway, which the door is painted on), and in no column that blocks
 *    nothing. Past that is ground a crawler can stand on while drawn behind
 *    the canvas. Soft shadow is below the solid threshold and allowed out.
 *    Every structure on every sheet is held to this, the rim props included.
 * 3. **Convergence.** A tent's canvas just below its peak is measurably
 *    narrower than at its eave — the canvas climbs to the poles instead of
 *    standing as a striped wall.
 * 4. **Texture band.** Each tent's local contrast sits in a band against the
 *    circus lot it stands on (the `gates:town-art` measure): richer than the
 *    lot, so the canvas carries its stripes and weather, and not so busy it
 *    reads as noise beside the telegraphs drawn on that lot.
 * 5. **Registries.** Both structure tile types are drawn by the Y-sorted pass
 *    and not by the chunk bake, sit in the decoration index, block, and block
 *    sight exactly as their height says.
 * 6. **Live surfaces.** The entry arch's crossbar (every span the road can
 *    set its posts at, across and up the screen) and the marionette, which
 *    the ambience paints at runtime, keep their ink inside their surfaces and
 *    run clean on a strict context.
 * 7. **Memory.** The circus sheets, with the largest crossbar and the
 *    marionette, fit their budget.
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals, loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { bakePropSheet, clippedFrames } from './propSheetBake.js';
import { watchCanvas } from './strictCanvas.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import {
  BIG_TOP_KING_POLES,
  BIG_TOP_KING_POLE_DEPTH_TILES,
  ARCH_POST_MAX_OFFSET_TILES,
  ARCH_POST_OFFSET_TILES,
  CIRCUS_STRUCTURES,
  circusStructureSpriteKey,
  isBlockedStep,
  type CircusStructureId,
} from '../src/map/overworld/circusGroundsLayout.js';
import {
  CIRCUS_LOT,
  CIRCUS_STRUCTURE_LOW,
  CIRCUS_STRUCTURE_TALL,
  type TileContent,
} from '../src/map/tileTypes.js';
import { getMaterial, paintPatch } from '../src/map/tilegen/materials.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import { CIRCUS_GROUNDED_EDGES, circusSheetPlans } from '../src/sprites/sheets/circusSheets.js';
import { CIRCUS_TILE_SCALE } from '../src/sprites/art/circusArt.js';
import {
  MARIONETTE,
  crossbarLayout,
  paintArchCrossbar,
  paintMarionette,
} from '../src/sprites/art/circusArchArt.js';
import { mulberry32 } from '../src/sprites/person/rng.js';
import {
  propSheetPlanMismatches,
  propSheetSize,
  type FramePainter,
  type PropSheetPlan,
} from '../src/sprites/sheets/propSheetPlan.js';

const FAULTS = ['wide-prop', 'flat-canvas', 'sheet-budget', 'loose-crossbar'] as const;
type Fault = (typeof FAULTS)[number];
function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}
const faultArg = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);
if (faultArg !== undefined && !isFault(faultArg)) {
  console.error(`unknown --fault=${faultArg}; one of ${FAULTS.join(', ')}`);
  process.exit(2);
}
const fault: Fault | null = faultArg ?? null;

type Section =
  'frames' | 'footprint' | 'convergence' | 'texture' | 'registries' | 'live' | 'memory';
const checksRun = new Map<Section, number>();
const failures: string[] = [];
/** Enough failures to see the pattern; the count says how many more there are. */
const MAX_FAILURES_SHOWN = 25;
function check(section: Section, condition: boolean, scope: string, message: string): void {
  checksRun.set(section, (checksRun.get(section) ?? 0) + 1);
  if (!condition) failures.push(`[${section}] ${scope}: ${message}`);
}

installCanvasGlobals();

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Ink above this alpha counts for the frame bounds; a clamped shape still antialiases a whisper past it. */
const INK_ALPHA_MIN = 24;
/** Ink at or above this alpha reads as solid; the soft contact shadow stays under it. */
const SOLID_ALPHA_MIN = 200;
/** A frame with fewer inked pixels than this painted nothing a player could see. */
const MIN_INK_PX = 400;
/** Room round a frame for ink that should not be there to land in. */
const PAD_PX = 64;
/** How far the wide-prop fault pushes solid art past the footprint. */
const FAULT_OVERHANG_PX = 12;

// ── Fault painters ────────────────────────────────────────────────────────────

/** A frame's art, pushed past the footprint's west edge at ground level. */
function widened(paint: FramePainter): FramePainter {
  return (ctx, originX, originY) => {
    paint(ctx, originX, originY);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(originX - FAULT_OVERHANG_PX * 2, originY, FAULT_OVERHANG_PX, FAULT_OVERHANG_PX);
  };
}

/**
 * The Big Top as the wallpaper it must never be again: one flat-coloured
 * block standing on its footprint, with no convergence and no texture.
 */
function flatCanvas(plan: PropSheetPlan): FramePainter {
  const spec = CIRCUS_STRUCTURES.big_top;
  return (ctx, originX, originY) => {
    const left = originX - spec.drawTile.dx * plan.tileScale;
    const ground = originY + plan.tileScale;
    const top = ground - (spec.h + 1) * plan.tileScale;
    ctx.fillStyle = '#a02828';
    ctx.fillRect(left + plan.tileScale, top, (spec.w - 2) * plan.tileScale, ground - top - 1);
  };
}

function painterFor(plan: PropSheetPlan, state: string, frame: FramePainter): FramePainter {
  if (state !== 'big_top') return frame;
  if (fault === 'wide-prop') return widened(frame);
  if (fault === 'flat-canvas') return flatCanvas(plan);
  return frame;
}

function isStructureId(state: string): state is CircusStructureId {
  return state in CIRCUS_STRUCTURES;
}

// ── 1 & 2. Frames and footprints ──────────────────────────────────────────────

interface PaintedFrame {
  readonly plan: PropSheetPlan;
  readonly state: CircusStructureId;
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Where the footprint's west edge and ground line fall in the padded canvas. */
  readonly footprintLeft: number;
  readonly ground: number;
}

const plans = circusSheetPlans().map((plan) => ({
  ...plan,
  rows: plan.rows.map((row) => ({
    ...row,
    frames: row.frames.map((frame) => painterFor(plan, row.state, frame)),
  })),
}));

const painted: PaintedFrame[] = [];
for (const plan of plans) {
  for (const problem of propSheetPlanMismatches(plan)) check('frames', false, plan.key, problem);
  for (const row of plan.rows) {
    if (!isStructureId(row.state)) {
      check('frames', false, plan.key, `row ${row.state} names no circus structure`);
      continue;
    }
    const state = row.state;
    row.frames.forEach((frame, frameIndex) => {
      const scope = `${state}#${frameIndex} (${plan.key})`;
      const width = plan.frameWidth + PAD_PX * 2;
      const height = plan.frameHeight + PAD_PX * 2;
      const canvas = createCanvas(width, height);
      const nodeCtx = canvas.getContext('2d');
      const ctx = asGameContext(nodeCtx);
      const watch = watchCanvas(ctx);
      try {
        frame(ctx, PAD_PX + plan.tileX, PAD_PX + plan.tileY);
      } catch (error) {
        check('frames', false, scope, `the painter threw: ${String(error)}`);
        return;
      }
      check('frames', watch.violations.length === 0, scope, watch.violations.join('; '));
      check(
        'frames',
        watch.saveDepth() === 0,
        scope,
        `left ${watch.saveDepth()} save(s) unrestored`,
      );
      const data = nodeCtx.getImageData(0, 0, width, height).data;
      let inked = 0;
      let outside = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] <= INK_ALPHA_MIN) continue;
          inked++;
          const inFrame =
            x >= PAD_PX &&
            x < PAD_PX + plan.frameWidth &&
            y >= PAD_PX &&
            y < PAD_PX + plan.frameHeight;
          if (!inFrame) outside++;
        }
      }
      check('frames', inked >= MIN_INK_PX, scope, `paints only ${inked} px — nothing to see`);
      check(
        'frames',
        outside === 0,
        scope,
        `${outside} px of ink outside its frame — the game's cell clip would shear it off`,
      );
      const spec = CIRCUS_STRUCTURES[state];
      painted.push({
        plan,
        state,
        data,
        width,
        height,
        footprintLeft: PAD_PX + plan.tileX - spec.drawTile.dx * plan.tileScale,
        ground: PAD_PX + plan.tileY + (spec.h - spec.drawTile.dy) * plan.tileScale,
      });
    });
  }
  for (const problem of clippedFrames(plan, bakePropSheet(plan).pixels, CIRCUS_GROUNDED_EDGES)) {
    check('frames', false, plan.key, problem);
  }
}
check('frames', painted.length > 0, 'frames', 'no frame was painted — the gate measured nothing');

/**
 * The lowest frame y solid ink may reach in each footprint column: the bottom
 * of that column's lowest blocked or doorway tile, measured up from the
 * ground line; -Infinity for a column that blocks nothing.
 */
function lowestAllowedY(frame: PaintedFrame): number[] {
  const spec = CIRCUS_STRUCTURES[frame.state];
  const ts = frame.plan.tileScale;
  const limits: number[] = [];
  for (let dx = 0; dx < spec.w; dx++) {
    let limit = -Infinity;
    for (let dy = 0; dy < spec.h; dy++) {
      const doorDx = spec.door?.dx ?? -1;
      const isDoor = dy === spec.door?.dy && dx >= doorDx && dx < doorDx + spec.door.width;
      if (!isBlockedStep(spec, dx, dy) && !isDoor) continue;
      limit = Math.max(limit, frame.ground - (spec.h - 1 - dy) * ts);
    }
    limits.push(limit);
  }
  return limits;
}

for (const frame of painted) {
  const ts = frame.plan.tileScale;
  const limits = lowestAllowedY(frame);
  let stray = 0;
  let firstStray = '';
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.data[(y * frame.width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_MIN) continue;
      const column = Math.floor((x - frame.footprintLeft) / ts);
      const limit = column >= 0 && column < limits.length ? limits[column] : -Infinity;
      if (y < limit) continue;
      if (stray === 0)
        firstStray = `(${x - frame.footprintLeft}, ${frame.ground - y}) px from the footprint's south-west corner`;
      stray++;
    }
  }
  check(
    'footprint',
    stray === 0,
    frame.state,
    `${stray} px of solid ink stand on walkable ground beside or below the footprint, first at ${firstStray}`,
  );
}

// ── 3. Convergence ────────────────────────────────────────────────────────────

/** How far below a peak the canvas is measured, in tiles: under the collar and the finial. */
const PEAK_PROBE_TILES = 0.35;
/** A peak span this share of the eave span or more is canvas standing as a wall. */
const MAX_PEAK_TO_EAVE_SPAN = 0.6;
const PERCENT = 100;

function solidSpan(frame: PaintedFrame, y: number): number {
  let min = Infinity;
  let max = -Infinity;
  const row = Math.round(y);
  if (row < 0 || row >= frame.height) return 0;
  for (let x = 0; x < frame.width; x++) {
    if (frame.data[(row * frame.width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_MIN) continue;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return max >= min ? max - min + 1 : 0;
}

const bigTop = painted.find((frame) => frame.state === 'big_top');
if (bigTop === undefined) {
  check('convergence', false, 'big_top', 'was not painted, so its roof could not be measured');
} else {
  const ts = bigTop.plan.tileScale;
  const peakHeight = Math.max(...BIG_TOP_KING_POLES.map((pole) => pole.heightTiles));
  const peakY =
    bigTop.ground - (BIG_TOP_KING_POLE_DEPTH_TILES + peakHeight - PEAK_PROBE_TILES) * ts;
  let eaveSpan = 0;
  for (let y = 0; y < bigTop.height; y++) eaveSpan = Math.max(eaveSpan, solidSpan(bigTop, y));
  const peakSpan = solidSpan(bigTop, peakY);
  check(
    'convergence',
    eaveSpan > 0 && peakSpan > 0 && peakSpan < eaveSpan * MAX_PEAK_TO_EAVE_SPAN,
    'big_top',
    `the canvas is ${peakSpan} px across just under its peaks and ${eaveSpan} px at its widest — ` +
      `a roof climbing to its poles is there and under ${MAX_PEAK_TO_EAVE_SPAN * PERCENT}% as wide; ` +
      'nothing there, or wider, is a striped wall',
  );
}

// ── 4. Texture band ───────────────────────────────────────────────────────────

const TEXTURE_WINDOW_PX = 8;
const OPAQUE_ALPHA = 255;
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

/** Mean local contrast over fully opaque 8x8-px windows — the measure `gates:town-art` uses. */
function measureLocalContrast(data: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let windows = 0;
  for (let wy = 0; wy + TEXTURE_WINDOW_PX <= height; wy += TEXTURE_WINDOW_PX) {
    for (let wx = 0; wx + TEXTURE_WINDOW_PX <= width; wx += TEXTURE_WINDOW_PX) {
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      let allOpaque = true;
      for (let y = wy; y < wy + TEXTURE_WINDOW_PX && allOpaque; y++) {
        for (let x = wx; x < wx + TEXTURE_WINDOW_PX; x++) {
          const index = (y * width + x) * CHANNELS;
          if (data[index + ALPHA_OFFSET] < OPAQUE_ALPHA) {
            allOpaque = false;
            break;
          }
          const value =
            data[index] * LUMA_RED + data[index + 1] * LUMA_GREEN + data[index + 2] * LUMA_BLUE;
          sum += value;
          sumSquares += value * value;
          count++;
        }
      }
      if (!allOpaque || count === 0) continue;
      const mean = sum / count;
      total += Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
      windows++;
    }
  }
  return windows === 0 ? 0 : total / windows;
}

const RICHNESS_SEED = 20260929;
const lotPatch = paintPatch(getMaterial('circus_lot'), RICHNESS_SEED, RICHNESS_SEED);
const lotRichness = measureLocalContrast(lotPatch.toRgba(), lotPatch.size, lotPatch.size);
check(
  'texture',
  lotRichness > 0,
  'circus_lot',
  'measured zero richness — the gate measured nothing',
);
/**
 * A tent must carry most of the lot's own texture — stripes, seams and
 * weather. Broad stripes put few edges inside an 8 px window, so a big top
 * honestly measures about the lot's own value; a flat block of canvas
 * measures near nothing.
 */
const TEXTURE_FLOOR_FRACTION_OF_LOT = 0.75;
/**
 * And no more than this many times it: canvas is broad stripes and a few
 * stains, and past this a tent is speckle competing with every telegraph on
 * the lot around it.
 */
const TEXTURE_CEILING_FRACTION_OF_LOT = 3;
/**
 * The canvas structures. The rim's crates are tall too, but they are timber
 * and paint, not striped canvas, and the band below is written for canvas.
 */
const TENT_IDS: ReadonlySet<CircusStructureId> = new Set<CircusStructureId>([
  'big_top',
  'pavilion_mold_lion',
  'pavilion_feats_of_flesh',
  'pavilion_fortunes',
]);
const tents = painted.filter((frame) => TENT_IDS.has(frame.state));
check('texture', tents.length > 0, 'tents', 'no tent was painted — the gate measured nothing');
const tentRichness: string[] = [];
for (const frame of tents) {
  const richness = measureLocalContrast(frame.data, frame.width, frame.height);
  tentRichness.push(`${frame.state} ${richness.toFixed(2)}`);
  check(
    'texture',
    richness >= lotRichness * TEXTURE_FLOOR_FRACTION_OF_LOT,
    frame.state,
    `local contrast ${richness.toFixed(2)} is under the lot's ${lotRichness.toFixed(2)} — flat canvas`,
  );
  check(
    'texture',
    richness <= lotRichness * TEXTURE_CEILING_FRACTION_OF_LOT,
    frame.state,
    `local contrast ${richness.toFixed(2)} is over ${TEXTURE_CEILING_FRACTION_OF_LOT}x the lot's ` +
      `${lotRichness.toFixed(2)} — busier than anything should be beside a telegraph`,
  );
}

// ── 5. Registries ─────────────────────────────────────────────────────────────

await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

const TEST_MAP_TILES = 7;
const TEST_TILE = Math.floor(TEST_MAP_TILES / 2);
const TEST_MAP_PX = TEST_MAP_TILES * TILE_SIZE;

function testMap(centre: TileContent | null): GameMap {
  const grid: TileContent[][] = [];
  for (let y = 0; y < TEST_MAP_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < TEST_MAP_TILES; x++) row.push({ tileId: `${x},${y}`, type: CIRCUS_LOT });
    grid.push(row);
  }
  // A structure records the lot it was pitched on, as the stamper writes it.
  if (centre !== null) grid[TEST_TILE][TEST_TILE] = { ...centre, groundType: CIRCUS_LOT };
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function centreTilePixels(gameMap: GameMap, overlay: boolean): Uint8ClampedArray {
  const canvas = createCanvas(TEST_MAP_PX, TEST_MAP_PX);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  gameMap.renderCanvas(ctx, 0, 0, TEST_MAP_PX, TEST_MAP_PX);
  if (overlay) {
    for (const { tx, ty } of gameMap.getVisibleDecorationTiles(0, 0, TEST_MAP_PX, TEST_MAP_PX)) {
      gameMap.drawDecorationAt(ctx, tx, ty, 0, 0);
    }
  }
  const origin = TEST_TILE * TILE_SIZE;
  return nodeCtx.getImageData(origin, origin, TILE_SIZE, TILE_SIZE).data;
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const TILE_CONTRACTS: ReadonlyArray<{
  readonly name: string;
  readonly tile: TileContent;
  readonly blocksSight: boolean;
}> = [
  {
    name: 'CIRCUS_STRUCTURE_TALL (pavilion)',
    tile: {
      tileId: 'pavilion',
      type: CIRCUS_STRUCTURE_TALL,
      spriteKey: circusStructureSpriteKey('pavilion_fortunes'),
    },
    blocksSight: true,
  },
  {
    name: 'CIRCUS_STRUCTURE_LOW (arch post)',
    tile: {
      tileId: 'post',
      type: CIRCUS_STRUCTURE_LOW,
      spriteKey: circusStructureSpriteKey('arch_post'),
    },
    blocksSight: false,
  },
];

const plainLot = centreTilePixels(testMap(null), false);
for (const contract of TILE_CONTRACTS) {
  const scope = contract.name;
  const gameMap = testMap(contract.tile);
  check(
    'registries',
    !isWalkableTileType(gameMap.structure[TEST_TILE][TEST_TILE]),
    scope,
    'is walkable',
  );
  const sightY = (TEST_TILE + 1 / 2) * TILE_SIZE;
  const sightClear = gameMap.hasLineOfSight(
    TILE_SIZE / 2,
    sightY,
    TEST_MAP_PX - TILE_SIZE / 2,
    sightY,
  );
  check(
    'registries',
    sightClear === !contract.blocksSight,
    scope,
    contract.blocksSight ? 'does not block sight' : 'blocks sight, but is slim enough to see past',
  );
  const base = centreTilePixels(gameMap, false);
  const full = centreTilePixels(gameMap, true);
  check(
    'registries',
    samePixels(base, plainLot),
    scope,
    'the chunk bake draws it rather than the lot under it — missing from DECORATION_TYPES ' +
      '(TileRenderer) or from the baseOnly cases (decorationTiles)',
  );
  check(
    'registries',
    !samePixels(full, base),
    scope,
    'the overlay pass draws nothing — it renders as bare lot',
  );
  check(
    'registries',
    gameMap
      .getVisibleDecorationTiles(0, 0, TEST_MAP_PX, TEST_MAP_PX)
      .some((entry) => entry.tx === TEST_TILE && entry.ty === TEST_TILE),
    scope,
    'missing from DECORATION_OVERLAY_TYPES (GameMap), so the Y-sorted pass never draws it',
  );
}

// ── 6. Live dressing surfaces ─────────────────────────────────────────────────
//
// The entry arch's crossbar spans however far apart the road set its posts,
// so `CircusGroundsAmbience` paints it at runtime into a surface sized by
// `crossbarLayout`, and the marionette into one of its own. Each is painted
// here on a strict context into a padded canvas: ink outside the surface is
// art the blit would shear off.

const BYTES_PER_PIXEL = 4;

interface LiveSurface {
  readonly scope: string;
  readonly width: number;
  readonly height: number;
  readonly paint: (ctx: CanvasRenderingContext2D, originX: number, originY: number) => void;
}

/** The narrowest and widest the arch's posts can stand apart, in tiles. */
const ARCH_SPANS = Array.from(
  { length: (ARCH_POST_MAX_OFFSET_TILES - ARCH_POST_OFFSET_TILES) * 2 + 1 },
  (_unused, index) => ARCH_POST_OFFSET_TILES * 2 + index,
);
/** How much the loose-crossbar fault shrinks the surface it paints into, in pixels. */
const FAULT_CROSSBAR_SHRINK_PX = 48;

const liveSurfaces: LiveSurface[] = [];
for (const spanTiles of ARCH_SPANS) {
  for (const across of [true, false]) {
    const layout = crossbarLayout(spanTiles, across, CIRCUS_TILE_SCALE);
    const shrink = fault === 'loose-crossbar' ? FAULT_CROSSBAR_SHRINK_PX : 0;
    liveSurfaces.push({
      scope: `arch crossbar ${spanTiles} tiles ${across ? 'across' : 'up'} the screen`,
      width: layout.width - shrink,
      height: layout.height - shrink,
      paint: (ctx, originX, originY) => {
        ctx.save();
        ctx.translate(originX, originY);
        paintArchCrossbar(ctx, layout, across, CIRCUS_TILE_SCALE, mulberry32(spanTiles));
        ctx.restore();
      },
    });
  }
}
liveSurfaces.push({
  scope: 'marionette',
  width: Math.ceil(MARIONETTE.widthTiles * CIRCUS_TILE_SCALE),
  height: Math.ceil(MARIONETTE.heightTiles * CIRCUS_TILE_SCALE),
  paint: (ctx, originX, originY) => {
    ctx.save();
    ctx.translate(originX, originY);
    paintMarionette(ctx, CIRCUS_TILE_SCALE);
    ctx.restore();
  },
});

let liveBytes = 0;
for (const surface of liveSurfaces) {
  const width = surface.width + PAD_PX * 2;
  const height = surface.height + PAD_PX * 2;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  const watch = watchCanvas(ctx);
  try {
    surface.paint(ctx, PAD_PX, PAD_PX);
  } catch (error) {
    check('live', false, surface.scope, `the painter threw: ${String(error)}`);
    continue;
  }
  check('live', watch.violations.length === 0, surface.scope, watch.violations.join('; '));
  check(
    'live',
    watch.saveDepth() === 0,
    surface.scope,
    `left ${watch.saveDepth()} save(s) unrestored`,
  );
  const data = nodeCtx.getImageData(0, 0, width, height).data;
  let inked = 0;
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] <= INK_ALPHA_MIN) continue;
      inked++;
      const inside =
        x >= PAD_PX && x < PAD_PX + surface.width && y >= PAD_PX && y < PAD_PX + surface.height;
      if (!inside) outside++;
    }
  }
  check('live', inked >= MIN_INK_PX, surface.scope, `paints only ${inked} px — nothing to see`);
  check(
    'live',
    outside === 0,
    surface.scope,
    `${outside} px of ink outside its surface — the blit would shear it off`,
  );
  liveBytes = Math.max(liveBytes, surface.width * surface.height * BYTES_PER_PIXEL);
}
check('live', liveSurfaces.length > 0, 'live', 'no live surface was painted');

// ── 7. Memory ─────────────────────────────────────────────────────────────────

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** The whole circus sheet set, decoded — the same ceiling Briar Hollow's furniture is held to. */
const CIRCUS_SHEET_BUDGET_MB = 6;
const FAULT_SHEET_BUDGET_MB = 1;
const budgetMb = fault === 'sheet-budget' ? FAULT_SHEET_BUDGET_MB : CIRCUS_SHEET_BUDGET_MB;
const totalBytes = plans.reduce((sum, plan) => {
  const { widthPx, heightPx } = propSheetSize(plan);
  return sum + widthPx * heightPx * BYTES_PER_PIXEL;
}, 0);
// A site holds one crossbar and one marionette; the widest crossbar is the worst case.
const marionetteBytes =
  Math.ceil(MARIONETTE.widthTiles * CIRCUS_TILE_SCALE) *
  Math.ceil(MARIONETTE.heightTiles * CIRCUS_TILE_SCALE) *
  BYTES_PER_PIXEL;
const totalMb = (totalBytes + liveBytes + marionetteBytes) / BYTES_PER_MEGABYTE;
check('memory', totalBytes > 0, 'sheets', 'measured no sheet — the gate measured nothing');
check(
  'memory',
  totalMb <= budgetMb,
  'sheets',
  `the circus sheets decode to ${totalMb.toFixed(2)} MB, over the ${budgetMb} MB budget`,
);

// ── Verdict ───────────────────────────────────────────────────────────────────

const sections: readonly Section[] = [
  'frames',
  'footprint',
  'convergence',
  'texture',
  'registries',
  'live',
  'memory',
];
for (const section of sections) {
  if ((checksRun.get(section) ?? 0) === 0) failures.push(`[${section}] ran no checks`);
}
const totalChecks = [...checksRun.values()].reduce((sum, count) => sum + count, 0);
console.log(
  `circus art: ${painted.length} frames, lot richness ${lotRichness.toFixed(2)}, ` +
    `tents ${tentRichness.join(', ')}, sheets ${totalMb.toFixed(2)} MB of ${budgetMb} MB`,
);
if (fault !== null) console.log(`fault injected: ${fault}`);
if (failures.length > 0) {
  const shown = failures.slice(0, MAX_FAILURES_SHOWN);
  console.error(`\nFAIL — ${failures.length} problem(s) in ${totalChecks} checks:`);
  for (const failure of shown) console.error(`  ${failure}`);
  if (failures.length > shown.length)
    console.error(`  … and ${failures.length - shown.length} more`);
  process.exit(1);
}
console.log(`PASS: ${totalChecks} checks`);
