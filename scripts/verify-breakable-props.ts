#!/usr/bin/env tsx
/**
 * Headless gate for the dungeon's long-standing breakable props and the dead:
 * the barrel, fallen barrel, crate, bookshelf, torch and brazier on both
 * floors, and the bone pile and slumped skeleton.
 *
 * For every kind on every floor theme it checks that:
 * - a blow breaks it: the tile opens to floor and its wreckage is recorded
 * - the tile draw site (`drawDecorationTile` / `drawInteriorTile`) asks for the
 *   floor's own sheet and the tile's own look, recorded off a stub context —
 *   so a steel drum on the service level is never drawn from the oak sheet
 * - that sheet, painted exactly as the game paints it, has ink in every frame
 *   a tile can ask for and none of it clipped by its cell
 * - its chief material is the one its floor's version is made of
 * - the walkable bone scatter draws from its own sheet
 * - service-level drums include oil drums, drawn from the oil drum sheet, and
 *   cellar barrels never are
 *
 * Tiles are sampled across a span, not one fixed position, so every seeded
 * look is exercised. Every map is a hand-built flat floor, so the result never
 * depends on what a random generator seed produced.
 *
 * Run: npm run verify:breakable-props
 */

import { TILE_SIZE } from '../src/core/constants';
import { getSpriteDef, type SpriteKey } from '../src/core/SpriteLoader';
import { GameMap } from '../src/map/GameMap';
import {
  BARREL,
  BARREL_SIDE,
  BONE_PILE,
  BONES,
  BOOKSHELF,
  BRAZIER,
  CRATE,
  FloorTypeValue,
  SLUMPED_SKELETON,
  TORCH,
  type TileContent,
} from '../src/map/tileTypes';
import { setDungeonFloorTheme, type DungeonFloorThemeId } from '../src/map/dungeon/floorTheme';
import { boneScatterVariant, isOilDrum, propVariantIndex } from '../src/map/dungeon/propVariants';
import { isWalkableTileType } from '../src/map/walkability';
import { drawDecorationTile } from '../src/map/tiles/decorationTiles';
import { drawInteriorTile } from '../src/map/tiles/interiorTiles';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { LootSystem } from '../src/systems/LootSystem';
import { DestructiblePropSystem } from '../src/systems/DestructiblePropSystem';
import { REMAINS_PROP_KINDS } from '../src/systems/destruction/remainsPropKinds';
import { themedPropMaterials } from '../src/systems/destruction/themedPropMaterials';
import { isThemedPropKind, themedPropLookFrame } from '../src/sprites/breakablePropSprites';
import { PROP_VARIANT_COUNT } from '../src/sprites/art/propPaint';
import { BONE_SCATTER_VARIANTS } from '../src/sprites/art/remainsArt';
import { destructiblePropSheetPlans } from '../src/sprites/sheets/destructiblePropSheets';
import { floorTwoPropVariantSheetPlans } from '../src/sprites/sheets/propVariantSheets';
import { remainsSheetPlans } from '../src/sprites/sheets/remainsSheets';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan';
import { bakePropSheet, clippedFrames } from './propSheetBake.js';
import { paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { createCanvas } from 'canvas';

const GRID_SIZE = 24;
const BREAK_TILE = 12;
const CRAWLER_TILES_SOUTH = 1;
const BLAST_RADIUS = TILE_SIZE * 2;
const FLOOR_NUMBER = 1;
/** A tile's centre, as a fraction of its width. */
const TILE_CENTRE = 0.5;
/** The span of tiles sampled per axis: wide enough that every look turns up. */
const SAMPLE_SPAN = 12;
/** How far to search for an oil-drum tile before deciding there are none. */
const OIL_SEARCH_SPAN = 40;
const OIL_SHARE_MIN = 0.15;
const OIL_SHARE_MAX = 0.45;
/** Fewer inked pixels than this in a frame is an empty frame, not a sparse one. */
const MIN_INKED_PIXELS = 60;
const ALPHA_CHANNEL = 3;
const CHANNELS = 4;
const MAX_FAILURES_SHOWN = 40;
/** The recording context's own surface; nothing is drawn to it that matters. */
const RECORDER_SIZE = 64;

const KINDS = [
  { type: BARREL, kind: 'barrel' },
  { type: BARREL_SIDE, kind: 'barrel_side' },
  { type: CRATE, kind: 'crate' },
  { type: BOOKSHELF, kind: 'bookshelf' },
  { type: TORCH, kind: 'torch' },
  { type: BRAZIER, kind: 'brazier' },
  { type: BONE_PILE, kind: 'bone_pile' },
  { type: SLUMPED_SKELETON, kind: 'slumped_skeleton' },
] as const;

/** The sheet each kind must be drawn from on each floor (the barrel's oil case is checked apart). */
const EXPECTED_SHEET = {
  barrel: { cellars: 'barrel', service_level: 'steel_drum' },
  barrel_side: { cellars: 'barrel_side', service_level: 'steel_drum_side' },
  crate: { cellars: 'crate', service_level: 'plastic_crate' },
  bookshelf: { cellars: 'bookshelf', service_level: 'steel_shelving' },
  torch: { cellars: 'torch', service_level: 'work_lamp' },
  brazier: { cellars: 'brazier', service_level: 'drum_brazier' },
  bone_pile: { cellars: 'bone_pile', service_level: 'bone_pile' },
  slumped_skeleton: { cellars: 'slumped_skeleton', service_level: 'slumped_skeleton' },
} as const satisfies Record<(typeof KINDS)[number]['kind'], Record<DungeonFloorThemeId, SpriteKey>>;

/** What each floor's version of a prop is chiefly made of. */
const EXPECTED_CHIEF_MATERIAL = {
  barrel: { cellars: 'wood', service_level: 'metal' },
  barrel_side: { cellars: 'wood', service_level: 'metal' },
  crate: { cellars: 'wood', service_level: 'plastic' },
  bookshelf: { cellars: 'wood', service_level: 'metal' },
  torch: { cellars: 'metal', service_level: 'electrical' },
  brazier: { cellars: 'metal', service_level: 'metal' },
} as const;

const THEMES: ReadonlyArray<DungeonFloorThemeId> = ['cellars', 'service_level'];

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

function flatFloor(): TileContent[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}

// ── Painted sheets ───────────────────────────────────────────────────────────

paintEnvironmentArtInNode();

const PLANS = new Map<string, PropSheetPlan>(
  [
    ...destructiblePropSheetPlans(0),
    ...floorTwoPropVariantSheetPlans(),
    ...remainsSheetPlans(),
  ].map((plan) => [plan.key, plan]),
);
const inkCache = new Map<
  string,
  { inked: (row: number, frame: number) => number; clipped: string[] }
>();

/** Counts the inked pixels of each frame of a sheet, painted the way the game paints it. */
function inkOf(key: string) {
  const cached = inkCache.get(key);
  if (cached !== undefined) return cached;
  const plan = PLANS.get(key);
  if (plan === undefined) {
    fail(`sheet ${key} has no paint plan`);
    const none = { inked: () => 0, clipped: [] };
    inkCache.set(key, none);
    return none;
  }
  const baked = bakePropSheet(plan);
  const { data, width } = baked.pixels;
  const inked = (row: number, frame: number): number => {
    let count = 0;
    for (let y = 0; y < plan.frameHeight; y++) {
      for (let x = 0; x < plan.frameWidth; x++) {
        const px = frame * plan.frameWidth + x;
        const py = row * plan.frameHeight + y;
        if ((data[(py * width + px) * CHANNELS + ALPHA_CHANNEL] ?? 0) > 0) count++;
      }
    }
    return count;
  };
  const result = { inked, clipped: clippedFrames(plan, baked.pixels) };
  inkCache.set(key, result);
  return result;
}

/** Requires ink in every frame of `row` a tile can ask for, and no clipping anywhere on the sheet. */
function checkPainted(label: string, key: string, state: string, frames: ReadonlyArray<number>) {
  const plan = PLANS.get(key);
  const row = plan?.rows.findIndex((r) => r.state === state) ?? -1;
  if (plan === undefined || row < 0) {
    fail(`${label}: sheet ${key} paints no ${state} row`);
    return;
  }
  const ink = inkOf(key);
  for (const frame of frames) {
    if (frame >= plan.rows[row].frames.length) {
      fail(`${label}: sheet ${key} ${state} has no frame ${frame}`);
      continue;
    }
    const count = ink.inked(row, frame);
    if (count < MIN_INKED_PIXELS) {
      fail(`${label}: sheet ${key} ${state} frame ${frame} is empty (${count} px of ink)`);
    }
  }
  for (const clip of ink.clipped) fail(`${label}: ${clip}`);
}

// ── Draw sites ───────────────────────────────────────────────────────────────

interface Blit {
  readonly img: unknown;
  readonly sx: number;
  readonly sy: number;
}

/**
 * A real 2D context whose sheet blits are recorded instead of drawn, so the
 * gate sees exactly which sheet and frame a draw site asked for.
 */
function recordingContext(blits: Blit[]): CanvasRenderingContext2D {
  const ctx = asGameContext(createCanvas(RECORDER_SIZE, RECORDER_SIZE).getContext('2d'));
  Object.defineProperty(ctx, 'drawImage', {
    value: (img: unknown, sx: number, sy: number) => {
      blits.push({ img, sx, sy });
    },
  });
  return ctx;
}

/** The sheet blit the draw site made for a tile, or null when it drew none. */
function drawSiteBlit(structure: TileContent[][], type: number, tx: number, ty: number) {
  const blits: Blit[] = [];
  const ctx = recordingContext(blits);
  if (!drawDecorationTile(ctx, structure, type, 0, 0, TILE_SIZE, tx, ty, false)) {
    drawInteriorTile(ctx, structure, type, 0, 0, TILE_SIZE, tx, ty);
  }
  return blits;
}

function checkDrawSite(
  label: string,
  structure: TileContent[][],
  type: number,
  tx: number,
  ty: number,
  key: SpriteKey,
  frame: number,
) {
  const def = getSpriteDef(key);
  if (def === undefined) {
    fail(`${label}: sheet ${key} is not loaded`);
    return;
  }
  const blit = drawSiteBlit(structure, type, tx, ty).find((b) => b.img === def.img);
  if (blit === undefined) {
    fail(`${label} at (${tx},${ty}): the draw site never drew from sheet ${key}`);
    return;
  }
  const drawnFrame = Math.round(blit.sx / def.frameWidth);
  if (drawnFrame !== frame) {
    fail(
      `${label} at (${tx},${ty}): drew frame ${drawnFrame} of ${key}, the tile's look is ${frame}`,
    );
  }
}

// ── The checks ───────────────────────────────────────────────────────────────

function firstOilTile(): { readonly x: number; readonly y: number } | null {
  for (let y = 0; y < OIL_SEARCH_SPAN; y++) {
    for (let x = 0; x < OIL_SEARCH_SPAN; x++) if (isOilDrum(x, y)) return { x, y };
  }
  return null;
}

for (const theme of THEMES) {
  setDungeonFloorTheme(theme);
  for (const { type, kind } of KINDS) {
    const label = `${theme}/${kind}`;

    // Breaking.
    const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: flatFloor() });
    const loot = new LootSystem(gameMap);
    const destructibles = new DestructiblePropSystem(gameMap, loot, FLOOR_NUMBER);
    const propTile = gameMap.structure[BREAK_TILE][BREAK_TILE];
    propTile.type = type;
    if (isWalkableTileType(propTile))
      fail(`${label}: tile type is walkable, so it would not block`);
    const crawler = new HumanPlayer(BREAK_TILE, BREAK_TILE + CRAWLER_TILES_SOUTH, TILE_SIZE);
    const blastX = (BREAK_TILE + TILE_CENTRE) * TILE_SIZE;
    const blastY = (BREAK_TILE + CRAWLER_TILES_SOUTH + TILE_CENTRE) * TILE_SIZE;
    if (!destructibles.destroyInRadius(blastX, blastY, BLAST_RADIUS, crawler)) {
      fail(`${label}: a blast beside it reported no hit`);
    }
    if (propTile.type === type) fail(`${label}: still standing after the blast`);
    if (!isWalkableTileType(propTile)) fail(`${label}: its tile did not open to floor`);
    const wreckage = destructibles.captureCheckpoint().wreckage;
    if (
      !wreckage.some((w) => w.kind === kind && w.tileX === BREAK_TILE && w.tileY === BREAK_TILE)
    ) {
      fail(`${label}: no wreckage recorded where it stood`);
    }

    // Material.
    if (isThemedPropKind(kind)) {
      const chief = themedPropMaterials(kind)[0];
      const expected = EXPECTED_CHIEF_MATERIAL[kind][theme];
      if (chief !== expected)
        fail(`${label}: chiefly ${chief}, its floor's version is ${expected}`);
    } else if (REMAINS_PROP_KINDS[kind].materials[0] !== 'bone') {
      fail(`${label}: is not chiefly bone`);
    }

    // Draw sites and painted frames, over a span of tiles so every look is used.
    const structure = flatFloor();
    const key = EXPECTED_SHEET[kind][theme];
    const looksSeen = new Set<number>();
    for (let ty = 0; ty < SAMPLE_SPAN; ty++) {
      for (let tx = 0; tx < SAMPLE_SPAN; tx++) {
        if (kind === 'barrel' && isOilDrum(tx, ty)) continue;
        const tile = structure[ty][tx];
        tile.type = type;
        const look = isThemedPropKind(kind)
          ? themedPropLookFrame(kind, tx, ty)
          : propVariantIndex(tx, ty);
        const animated = kind === 'torch' || kind === 'brazier';
        if (!animated) {
          looksSeen.add(look);
          checkDrawSite(label, structure, type, tx, ty, key, look);
        } else if (drawSiteBlit(structure, type, tx, ty).length === 0) {
          fail(`${label} at (${tx},${ty}): the draw site drew nothing`);
        }
      }
    }
    const animated = kind === 'torch' || kind === 'brazier';
    if (!animated && looksSeen.size < PROP_VARIANT_COUNT) {
      fail(
        `${label}: only ${looksSeen.size} of ${PROP_VARIANT_COUNT} looks turned up on the sampled tiles`,
      );
    }
    const plan = PLANS.get(key);
    const allFrames = (state: string) =>
      Array.from(
        { length: plan?.rows.find((r) => r.state === state)?.frames.length ?? 0 },
        (_, i) => i,
      );
    checkPainted(label, key, 'idle', allFrames('idle'));
    checkPainted(label, key, 'damaged', allFrames('damaged'));
    checkPainted(label, key, 'shatter', allFrames('shatter'));
    checkPainted(label, key, 'remains', allFrames('remains'));
  }

  // The walkable scatter.
  const structure = flatFloor();
  const scatterLooks = new Set<number>();
  for (let tx = 0; tx < SAMPLE_SPAN; tx++) {
    const tile = structure[0][tx];
    tile.type = BONES;
    const look = boneScatterVariant(tx, 0);
    scatterLooks.add(look);
    checkDrawSite(`${theme}/bone_scatter`, structure, BONES, tx, 0, 'bone_scatter', look);
  }
  checkPainted(
    `${theme}/bone_scatter`,
    'bone_scatter',
    'idle',
    Array.from({ length: BONE_SCATTER_VARIANTS }, (_, i) => i),
  );

  // Oil drums.
  const oilTile = firstOilTile();
  if (theme === 'cellars' && oilTile !== null) {
    fail(`cellars: the barrel at (${oilTile.x},${oilTile.y}) is an oil drum`);
  }
  if (theme === 'service_level') {
    if (oilTile === null) {
      fail(`service_level: no oil drum in a ${OIL_SEARCH_SPAN}×${OIL_SEARCH_SPAN} span of tiles`);
    } else {
      const oilStructure = flatFloor();
      oilStructure[oilTile.y][oilTile.x].type = BARREL;
      {
        checkDrawSite(
          'service_level/oil_drum',
          oilStructure,
          BARREL,
          oilTile.x,
          oilTile.y,
          'oil_drum',
          propVariantIndex(oilTile.x, oilTile.y),
        );
      }
      checkPainted('service_level/oil_drum', 'oil_drum', 'idle', [0, 1, 2]);
      checkPainted('service_level/oil_drum', 'oil_drum', 'remains', [0, 1, 2]);
      let oil = 0;
      for (let y = 0; y < OIL_SEARCH_SPAN; y++) {
        for (let x = 0; x < OIL_SEARCH_SPAN; x++) if (isOilDrum(x, y)) oil++;
      }
      const share = oil / (OIL_SEARCH_SPAN * OIL_SEARCH_SPAN);
      if (share < OIL_SHARE_MIN || share > OIL_SHARE_MAX) {
        fail(
          `service_level: oil-drum share ${share.toFixed(2)} outside ${OIL_SHARE_MIN}–${OIL_SHARE_MAX}`,
        );
      }
    }
  }
}
setDungeonFloorTheme('cellars');

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} problem(s)`);
  for (const failure of failures.slice(0, MAX_FAILURES_SHOWN)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `PASS — ${KINDS.length} kinds × ${THEMES.length} floors: break, draw from the floor's own sheet at ` +
    `the tile's look, painted frames inked and unclipped, chief material per floor, oil drums`,
);
