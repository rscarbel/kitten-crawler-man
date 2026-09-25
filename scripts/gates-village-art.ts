#!/usr/bin/env tsx
/**
 * Gates for Briar Hollow's art: its prop sheets, its roofless walls, the tile
 * registries they are drawn through, its ground materials and its memory.
 *
 *   npm run gates:village-art
 *   npm run gates:village-art -- --fault=wide-prop      # must fail
 *   npm run gates:village-art -- --fault=wide-wall      # must fail
 *   npm run gates:village-art -- --fault=sheet-budget   # must fail
 *
 * Checked, in order:
 *
 * 1. **Props.** Every variant of every prop paints something, and nothing
 *    outside its frame. Each frame is painted with no clip into a padded
 *    canvas, because the game clips every frame to its cell and a clip hides
 *    exactly the ink this is looking for: art past a prop's sides is ground a
 *    crawler can stand on while drawn behind the prop, and the clip turns it
 *    into a straight-edged amputation rather than an error.
 *    Then each sheet is baked as the game bakes it and every frame's own
 *    border is checked for ink: a stroke that stops exactly on the frame's
 *    outermost column has been cut there.
 * 2. **Walls.** Every wall piece a village can produce — each run and corner,
 *    beside every kind of doorway, with every face feature, flower box and
 *    sign — paints, stays inside its own tile's column (a lintel may span its
 *    doorway, which is overhead), and reaches no higher than its declared
 *    extent, which is what the cull and the overlay cache are sized to.
 * 3. **Registries.** The wall and both prop types are drawn by the Y-sorted
 *    pass and not by the chunk bake, sit in the decoration index, block, and
 *    block sight exactly as their height says. Missing from either registry,
 *    a tile renders as bare floor and passes typecheck and lint.
 * 4. **The live village.** On real generated maps, every wall tile belongs to
 *    a building, every building's wall is closed except at its doorways, and
 *    every prop's drawing tile resolves to a painted row.
 * 5. **Ground.** The review baker for the ground sheets runs clean — it exits
 *    non-zero on any seamed patch — and actually measured the village's
 *    materials.
 * 6. **Memory.** The village sheets fit their budget.
 */

import { spawnSync } from 'node:child_process';
import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { bakePropSheet, clippedFrames } from './propSheetBake.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { VILLAGE_SALT, floorArtSubSeed } from '../src/map/ground/floorArtSeed.js';
import {
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_WALL,
  VERGE_GRASS,
  type TileContent,
} from '../src/map/tileTypes.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import {
  everyWallPiece,
  paintWallPieceUncached,
  wallPieceReachPx,
} from '../src/map/tiles/hollowWallTiles.js';
import { hollowPropPlacementAt } from '../src/map/tiles/hollowVillageTiles.js';
import { villagePropSpriteKey, VILLAGE_PROPS } from '../src/map/overworld/briarHollowLayout.js';
import { isVillageStandingProp } from '../src/sprites/art/villageArt.js';
import {
  VILLAGE_GROUNDED_EDGES,
  villagePropSheetKey,
  villageSheetPlans,
} from '../src/sprites/sheets/villageSheets.js';
import { propSheetPlanMismatches, propSheetSize } from '../src/sprites/sheets/propSheetPlan.js';
import type { FramePainter, PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';
import { getSpriteDefByKey } from '../src/core/SpriteLoader.js';

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);

const failures: string[] = [];
/** Enough failures to see the pattern; the count says how many more there are. */
const MAX_FAILURES_SHOWN = 25;
function check(condition: boolean, scope: string, message: string): void {
  if (!condition) failures.push(`${scope}: ${message}`);
}

await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Ink above this alpha counts; a shape clamped to an edge still antialiases a whisper past it. */
const INK_ALPHA_MIN = 24;
/** A variant with fewer inked pixels than this painted nothing a player could see. */
const MIN_INK_PX = 40;
/** Room round a frame for ink that should not be there to land in. */
const PAD_PX = 48;
/** How far the deliberate faults push art past its bounds. */
const FAULT_OVERHANG_PX = 4;

interface InkReport {
  readonly inked: number;
  /** Inked pixels outside the allowed rectangle, per side. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Counts ink inside and outside an allowed rectangle of a canvas. */
function inkReport(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  allowed: { x0: number; y0: number; x1: number; y1: number },
): InkReport {
  let inked = 0;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * CHANNELS + ALPHA_OFFSET] <= INK_ALPHA_MIN) continue;
      inked++;
      if (x < allowed.x0) left++;
      else if (x >= allowed.x1) right++;
      else if (y < allowed.y0) top++;
      else if (y >= allowed.y1) bottom++;
    }
  }
  return { inked, left, right, top, bottom };
}

function describeOverhang(report: InkReport): string {
  return (['left', 'right', 'top', 'bottom'] as const)
    .filter((side) => report[side] > 0)
    .map((side) => `${report[side]} px past its ${side}`)
    .join(', ');
}

// ── 1. Props ──────────────────────────────────────────────────────────────────

const plans = villageSheetPlans(floorArtSubSeed(VILLAGE_SALT));

/** The first frame of the first sheet, pushed past its left side on purpose. */
function faultedPainter(paint: FramePainter): FramePainter {
  return (ctx, originX, originY) => {
    paint(ctx, originX, originY);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(originX - FAULT_OVERHANG_PX, originY, FAULT_OVERHANG_PX, FAULT_OVERHANG_PX * 2);
  };
}

let propFramesChecked = 0;
plans.forEach((plan, planIndex) => {
  for (const problem of propSheetPlanMismatches(plan)) check(false, plan.key, problem);
  plan.rows.forEach((row, rowIndex) => {
    row.frames.forEach((frame, frameIndex) => {
      const paint =
        fault === 'wide-prop' && planIndex === 0 && rowIndex === 0 && frameIndex === 0
          ? faultedPainter(frame)
          : frame;
      const width = plan.frameWidth + PAD_PX * 2;
      const height = plan.frameHeight + PAD_PX * 2;
      const canvas = createCanvas(width, height);
      const nodeCtx = canvas.getContext('2d');
      paint(asGameContext(nodeCtx), PAD_PX + plan.tileX, PAD_PX + plan.tileY);
      const report = inkReport(nodeCtx.getImageData(0, 0, width, height).data, width, height, {
        x0: PAD_PX,
        y0: PAD_PX,
        x1: PAD_PX + plan.frameWidth,
        y1: PAD_PX + plan.frameHeight,
      });
      const scope = `prop ${row.state}#${frameIndex} (${plan.key})`;
      propFramesChecked++;
      check(report.inked >= MIN_INK_PX, scope, `paints only ${report.inked} px — nothing to see`);
      check(
        report.left + report.right + report.top + report.bottom === 0,
        scope,
        `ink outside its frame: ${describeOverhang(report)} — the game's cell clip would ` +
          'shear it off, and past the sides it stands on walkable ground',
      );
    });
  });
});
check(propFramesChecked > 0, 'props', 'no prop frames were painted — the gate measured nothing');
// The clip test proper: a frame inked on its own outermost column or row has
// almost certainly been cut there, even when the unclipped paint above happened
// to stop exactly on the line.
for (const plan of plans) {
  for (const problem of clippedFrames(plan, bakePropSheet(plan).pixels, VILLAGE_GROUNDED_EDGES)) {
    check(false, plan.key, problem);
  }
}

// ── 2. Walls ──────────────────────────────────────────────────────────────────

const pieces = everyWallPiece();
check(pieces.length > 0, 'walls', 'no wall pieces were enumerated — the gate measured nothing');
pieces.forEach((piece, index) => {
  const reach = wallPieceReachPx(piece, TILE_SIZE);
  const width = TILE_SIZE + reach.right + PAD_PX * 2;
  const height = TILE_SIZE + reach.up + PAD_PX * 2;
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  const ox = PAD_PX;
  const oy = PAD_PX + reach.up;
  paintWallPieceUncached(ctx, piece, ox, oy, TILE_SIZE);
  if (fault === 'wide-wall' && index === 0) {
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(ox - FAULT_OVERHANG_PX, oy, FAULT_OVERHANG_PX, FAULT_OVERHANG_PX * 2);
  }
  const report = inkReport(nodeCtx.getImageData(0, 0, width, height).data, width, height, {
    x0: ox,
    y0: oy - reach.up,
    x1: ox + TILE_SIZE + reach.right,
    y1: oy + TILE_SIZE,
  });
  const scope = `wall piece ${JSON.stringify(piece)}`;
  check(report.inked >= MIN_INK_PX, scope, `paints only ${report.inked} px`);
  check(
    report.left + report.right + report.top + report.bottom === 0,
    scope,
    `ink outside its tile's column and declared reach: ${describeOverhang(report)}`,
  );
});

// ── 3. Registries ─────────────────────────────────────────────────────────────

const TEST_MAP_TILES = 5;
const TEST_TILE = Math.floor(TEST_MAP_TILES / 2);
const TEST_MAP_PX = TEST_MAP_TILES * TILE_SIZE;

function testMap(centre: TileContent | null): GameMap {
  const grid: TileContent[][] = [];
  for (let y = 0; y < TEST_MAP_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < TEST_MAP_TILES; x++) {
      row.push({ tileId: `${x},${y}`, type: VERGE_GRASS });
    }
    grid.push(row);
  }
  // A village wall or prop records the ground it was stood on, as the painter
  // stamps it; the chunk bake draws that ground under it.
  if (centre !== null) grid[TEST_TILE][TEST_TILE] = { ...centre, groundType: VERGE_GRASS };
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function centreTilePixels(gameMap: GameMap, passes: { overlay: boolean }): Uint8ClampedArray {
  const canvas = createCanvas(TEST_MAP_PX, TEST_MAP_PX);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  gameMap.renderCanvas(ctx, 0, 0, TEST_MAP_PX, TEST_MAP_PX);
  if (passes.overlay) {
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

interface TileContract {
  readonly name: string;
  readonly tile: TileContent;
  readonly blocksSight: boolean;
}

const TILE_CONTRACTS: readonly TileContract[] = [
  {
    name: 'HOLLOW_WALL',
    tile: { tileId: 'wall', type: HOLLOW_WALL },
    blocksSight: true,
  },
  {
    name: 'HOLLOW_PROP_LOW (bench)',
    tile: { tileId: 'bench', type: HOLLOW_PROP_LOW, spriteKey: villagePropSpriteKey('bench') },
    blocksSight: false,
  },
  {
    name: 'HOLLOW_PROP_TALL (tool rack)',
    tile: {
      tileId: 'rack',
      type: HOLLOW_PROP_TALL,
      spriteKey: villagePropSpriteKey('tool_rack'),
    },
    blocksSight: true,
  },
];

const plainFloor = centreTilePixels(testMap(null), { overlay: false });
for (const contract of TILE_CONTRACTS) {
  const scope = `tile ${contract.name}`;
  const gameMap = testMap(contract.tile);
  check(!isWalkableTileType(gameMap.structure[TEST_TILE][TEST_TILE]), scope, 'is walkable');
  const sightY = (TEST_TILE + 1 / 2) * TILE_SIZE;
  const sightClear = gameMap.hasLineOfSight(
    TILE_SIZE / 2,
    sightY,
    TEST_MAP_PX - TILE_SIZE / 2,
    sightY,
  );
  check(
    sightClear === !contract.blocksSight,
    scope,
    contract.blocksSight ? 'does not block sight' : 'blocks sight, but is low enough to see over',
  );
  const base = centreTilePixels(gameMap, { overlay: false });
  const full = centreTilePixels(gameMap, { overlay: true });
  check(
    samePixels(base, plainFloor),
    scope,
    'the chunk bake draws it rather than the floor under it — missing from DECORATION_TYPES ' +
      '(TileRenderer) or from the baseOnly cases (decorationTiles)',
  );
  check(
    !samePixels(full, base),
    scope,
    'the overlay pass draws nothing — it renders as bare floor',
  );
  check(
    gameMap
      .getVisibleDecorationTiles(0, 0, TEST_MAP_PX, TEST_MAP_PX)
      .some((entry) => entry.tx === TEST_TILE && entry.ty === TEST_TILE),
    scope,
    'missing from DECORATION_OVERLAY_TYPES (GameMap), so the Y-sorted pass never draws it',
  );
}

// ── 4. The live village ───────────────────────────────────────────────────────

/** The same three worlds the review render draws: multiples of one seed. */
const LIVE_SEED_BASE = 7919;
const LIVE_SEED_COUNT = 3;
const LIVE_SEEDS = Array.from(
  { length: LIVE_SEED_COUNT },
  (_unused, index) => LIVE_SEED_BASE * (index + 1),
);
const MAP_SIZE = 280;
for (const seed of LIVE_SEEDS) {
  const gameMap = new GameMap({
    mapSize: MAP_SIZE,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
  });
  const site = gameMap.briarHollow;
  if (site === null) {
    check(false, `seed ${seed}`, 'no village');
    continue;
  }
  const buildingTiles = new Set<number>();
  for (const building of site.buildings) {
    const { rect } = building;
    const doorways = new Set(building.doorways.map((door) => door.y * MAP_SIZE + door.x));
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        buildingTiles.add(y * MAP_SIZE + x);
        const onPerimeter =
          x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
        const key = y * MAP_SIZE + x;
        // Anything stamped over a wall tile later — dressing, a prop — opens a
        // hole in the building that no reachability check notices.
        check(
          !onPerimeter || doorways.has(key) || gameMap.structure[y][x].type === HOLLOW_WALL,
          `seed ${seed} ${building.id} (${x}, ${y})`,
          'is a gap in the wall that is not a doorway',
        );
      }
    }
  }
  let wallTiles = 0;
  let propDrawTiles = 0;
  const bounds = site.palisadeBounds;
  const quarry = site.quarry.rect;
  const scanX0 = Math.min(bounds.x, quarry.x);
  const scanY0 = Math.min(bounds.y, quarry.y);
  const scanX1 = Math.max(bounds.x + bounds.w, quarry.x + quarry.w);
  const scanY1 = Math.max(bounds.y + bounds.h, quarry.y + quarry.h);
  for (let y = scanY0; y < scanY1; y++) {
    for (let x = scanX0; x < scanX1; x++) {
      const tile = gameMap.structure[y][x];
      if (tile.type === HOLLOW_WALL) {
        wallTiles++;
        check(
          buildingTiles.has(y * MAP_SIZE + x),
          `seed ${seed} wall (${x}, ${y})`,
          'belongs to no building, so it draws as a bare block',
        );
      }
      if (tile.type !== HOLLOW_PROP_LOW && tile.type !== HOLLOW_PROP_TALL) continue;
      const placement = hollowPropPlacementAt(gameMap.structure, x, y);
      const scope = `seed ${seed} prop tile (${x}, ${y})`;
      if (placement === null) {
        check(false, scope, `sprite key ${tile.spriteKey ?? 'none'} names no prop`);
        continue;
      }
      if (!isVillageStandingProp(placement.prop)) {
        check(false, scope, `${placement.prop} is flat dressing on a blocking tile`);
        continue;
      }
      const isDrawTile =
        x === placement.anchorX && y === placement.anchorY + VILLAGE_PROPS[placement.prop].h - 1;
      if (!isDrawTile) continue;
      propDrawTiles++;
      const def = getSpriteDefByKey(villagePropSheetKey(placement.prop));
      check(
        (def?.states.get(placement.prop)?.frameCount ?? 0) > 0,
        scope,
        `${placement.prop} has no painted row to draw`,
      );
    }
  }
  check(wallTiles > 0, `seed ${seed}`, 'no wall tiles found — the scan measured nothing');
  check(propDrawTiles > 0, `seed ${seed}`, 'no prop tiles found — the scan measured nothing');
}

// ── 5. Ground ─────────────────────────────────────────────────────────────────

const VILLAGE_MATERIALS = ['hollow_planks', 'pasture_grass', 'crop_rows'] as const;
const groundBake = spawnSync('npx', ['tsx', 'scripts/generate-ground-tileset.ts'], {
  encoding: 'utf8',
});
check(
  groundBake.status === 0,
  'ground',
  `the ground review baker failed (exit ${groundBake.status ?? 'signal'}) — a patch is seamed:\n` +
    `${groundBake.stdout}${groundBake.stderr}`,
);
for (const material of VILLAGE_MATERIALS) {
  check(
    groundBake.stdout.includes(material),
    'ground',
    `the baker's report never mentions ${material} — it was not measured`,
  );
}

// ── 6. Memory ─────────────────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** The whole village sheet set, decoded. */
const VILLAGE_SHEET_BUDGET_MB = 6;
const FAULT_SHEET_BUDGET_MB = 1;
const budgetMb = fault === 'sheet-budget' ? FAULT_SHEET_BUDGET_MB : VILLAGE_SHEET_BUDGET_MB;
function sheetBytes(plan: PropSheetPlan): number {
  const { widthPx, heightPx } = propSheetSize(plan);
  return widthPx * heightPx * BYTES_PER_PIXEL;
}
const totalBytes = plans.reduce((sum, plan) => sum + sheetBytes(plan), 0);
const totalMb = totalBytes / BYTES_PER_MEGABYTE;
check(
  totalMb <= budgetMb,
  'memory',
  `the village sheets decode to ${totalMb.toFixed(2)} MB, over the ${budgetMb} MB budget`,
);

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log(
  `village art: ${propFramesChecked} prop frames, ${pieces.length} wall pieces, ` +
    `${TILE_CONTRACTS.length} tile contracts, ${LIVE_SEEDS.length} live villages, ` +
    `sheets ${totalMb.toFixed(2)} MB of ${budgetMb} MB`,
);
if (failures.length > 0) {
  const shown = failures.slice(0, MAX_FAILURES_SHOWN);
  console.error(`\nFAIL — ${failures.length} problem(s):`);
  for (const failure of shown) console.error(`  ${failure}`);
  if (failures.length > shown.length)
    console.error(`  … and ${failures.length - shown.length} more`);
  process.exit(1);
}
console.log('PASS');
