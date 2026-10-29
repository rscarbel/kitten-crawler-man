/**
 * Review renders for the Kraken's flooded pump room's art: every prop, the
 * shark's fin turned every way, its carcass and the submerged Kraken, drawn through the same functions the room
 * draws them with over a patch of the room's real floor and water, at the size
 * the game draws them or enlarged.
 *
 *   npm run render:flooded-pump-room -- --scale=3 --frame=40
 *
 * Writes `preview/boss-rooms/flooded-pump-room-{flooded,drained,breach}-x<scale>.png`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../../src/core/constants.js';
import { KRAKEN_VISUAL_SCALE } from '../../src/creatures/Kraken.js';
import { setDungeonFloorTheme } from '../../src/map/dungeon/floorTheme.js';
import { dungeonWaterDepth, floodDungeonTile } from '../../src/map/dungeonWater.js';
import { GameMap } from '../../src/map/GameMap.js';
import { renderCanvas } from '../../src/map/TileRenderer.js';
import {
  drawDungeonWaterSurface,
  DungeonWaterRuns,
} from '../../src/map/tiles/dungeonWaterSurface.js';
import {
  FLOODED_PUMP_ROOM_FLOOR,
  FloorTypeValue,
  isDungeonWater,
  MAX_WATER_DEPTH,
  type TileContent,
} from '../../src/map/tileTypes.js';
import {
  drawBarrelStack,
  drawBarrelStackTopple,
  drawDeadShark,
  drawDrainSwirl,
  drawFloatingBarrel,
  drawFloodedPump,
  drawFloodedPumpChute,
  drawFloodedPumpRaft,
  drawFloorDrain,
  drawSettledBarrel,
  PUMP_OUTFALL_OFFSET_TILES,
  BARREL_STACK_HEIGHTS,
  type BarrelLanding,
  type SettledBarrelLook,
} from '../../src/sprites/floodedPumpRoomSprite.js';
import {
  drawKrakenSubmergedSprite,
  krakenScaledArtOrigin,
} from '../../src/sprites/krakenSprite.js';
import {
  drawSharkAttackSprite,
  drawSharkBloodPoolSprite,
  SHARK_ATTACK_TAKEN_FRAME,
} from '../../src/sprites/sharkAttackSprite.js';
import { drawSharkFinSprite } from '../../src/sprites/sharkFinSprite.js';
import { asGameContext } from '../nodeGameContext.js';
import { writePreviewPng } from '../previewOut.js';

const T = TILE_SIZE;
const ROOM_W = 24;
const ROOM_H = 14;
const BACKGROUND = '#101214';
/** World ticks per second, to turn the review's tick into the water's clock. */
const TICKS_PER_SECOND = 60;

interface TileBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where everything stands in the review patch, in tiles. */
const LAYOUT = {
  runningPump: { x: 3, y: 2 },
  runningPumpRaft: { x: 0, y: 2, w: 3, h: 3 },
  offPump: { x: 18, y: 2 },
  offPumpRaft: { x: 19, y: 2, w: 3, h: 3 },
  landing: { x: 0, y: 10, w: 3, h: 3 },
  bigRaft: { x: 5, y: 6, w: 5, h: 4 },
  smallRaft: { x: 13, y: 9, w: 4, h: 4 },
  floatingBarrels: { x: 4, y: 11 },
  kraken: { x: 11, y: 4 },
  drains: [
    { x: 9, y: 2 },
    { x: 14, y: 2 },
  ],
  deadSharks: [
    { x: 13, y: 7 },
    { x: 18, y: 10 },
    { x: 2, y: 8 },
  ],
  settledBarrels: { x: 2, y: 11 },
  stacks: [
    { x: 20, y: 4, height: 3 },
    { x: 22, y: 4, height: 4 },
  ],
  toppleSeats: { x: 13, y: 13, spacing: 3 },
} as const;

/** Three fins: one cruising past a raft, one end on, one chasing. */
const FINS = [
  { x: 12, y: 8.6, headingX: 1, headingY: 0, chasing: false },
  { x: 20, y: 7, headingX: 0, headingY: 1, chasing: false },
  { x: 19, y: 12, headingX: -1, headingY: -0.6, chasing: true },
] as const;

/** Seeds that keep the review's two rafts from bobbing in step. */
const BIG_RAFT_SEED = 1;
const SMALL_RAFT_SEED = 2;
/** The first of the moored rafts' seeds: the pumps' and the landing's. */
const MOORED_RAFT_SEED = 3;
const FLOATING_BARREL_COUNT = 3;
const OFF_PUMP_VALVE_TURNS = 0.4;
/** Points through the stack's fall the review freezes it at. */
const TOPPLE_STOPS = Object.values({ tipping: 0.25, tumbling: 0.55, landing: 0.8 });
const TOPPLE_STACK_HEIGHT = Math.max(...BARREL_STACK_HEIGHTS);
const SHATTER_REVIEW_PROGRESS = 0.4;
/** A settled barrel in every look, left to right along the review's row. */
const SETTLED_LOOKS: readonly SettledBarrelLook[] = [
  { kind: 'intact', variant: 0 },
  { kind: 'intact', variant: 1 },
  { kind: 'damaged', variant: 2 },
  { kind: 'shatter', progress: SHATTER_REVIEW_PROGRESS },
  { kind: 'remains', variant: 0 },
];

/** A patch of the room's floor, flooded everywhere but the `dry` boxes. */
function roomMap(flooded: boolean, dry: readonly TileBox[]): GameMap {
  const isDry = (x: number, y: number) =>
    dry.some((box) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h);
  const structure: TileContent[][] = [];
  for (let y = 0; y < ROOM_H; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < ROOM_W; x++) {
      // The generator lays the room in its floor's concrete; a bare patch has to say so.
      const cell: TileContent = {
        tileId: `${x}#${y}`,
        type: FLOODED_PUMP_ROOM_FLOOR,
        groundType: FloorTypeValue.concrete,
      };
      if (flooded && !isDry(x, y)) floodDungeonTile(cell, MAX_WATER_DEPTH);
      row.push(cell);
    }
    structure.push(row);
  }
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: structure });
}

function floorCanvas(
  map: GameMap,
  scale: number,
  frame: number,
): { canvas: Canvas; ctx: CanvasRenderingContext2D } {
  setDungeonFloorTheme('cellars');
  const canvas = createCanvas(ROOM_W * T * scale, ROOM_H * T * scale);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  renderCanvas(ctx, map.structure, TILE_SIZE, 0, 0, ROOM_W * T, ROOM_H * T);
  const waterRuns = new DungeonWaterRuns();
  map.structure.forEach((row, ty) =>
    row.forEach((cell, tx) => {
      if (isDungeonWater(cell)) waterRuns.add(tx, ty, dungeonWaterDepth(cell));
    }),
  );
  drawDungeonWaterSurface(ctx, waterRuns, 0, 0, frame / TICKS_PER_SECOND);
  return { canvas, ctx };
}

/** The fight's live room: rafts, pumps pouring and shut, barrels afloat, fins and the Kraken. */
function renderFlooded(scale: number, frame: number): Canvas {
  const moored = [LAYOUT.runningPumpRaft, LAYOUT.offPumpRaft, LAYOUT.landing];
  const map = roomMap(true, moored);
  const { canvas, ctx } = floorCanvas(map, scale, frame);
  const { bigRaft, smallRaft, runningPump, offPump, kraken } = LAYOUT;

  moored.forEach((raft, index) =>
    drawFloodedPumpRaft(
      ctx,
      raft.x * T,
      raft.y * T,
      raft.w,
      raft.h,
      T,
      'floating',
      frame,
      MOORED_RAFT_SEED + index,
    ),
  );

  drawFloodedPumpRaft(
    ctx,
    bigRaft.x * T,
    bigRaft.y * T,
    bigRaft.w,
    bigRaft.h,
    T,
    'floating',
    frame,
    BIG_RAFT_SEED,
  );
  drawFloodedPumpRaft(
    ctx,
    smallRaft.x * T,
    smallRaft.y * T,
    smallRaft.w,
    smallRaft.h,
    T,
    'floating',
    frame,
    SMALL_RAFT_SEED,
  );

  drawFloodedPump(ctx, runningPump.x * T, runningPump.y * T, T, true, 0, frame);
  drawFloodedPumpChute(
    ctx,
    (runningPump.x + PUMP_OUTFALL_OFFSET_TILES) * T,
    runningPump.y * T,
    T,
    'east',
    true,
    frame,
  );
  drawFloodedPump(ctx, offPump.x * T, offPump.y * T, T, false, OFF_PUMP_VALVE_TURNS, frame);
  drawFloodedPumpChute(
    ctx,
    (offPump.x - PUMP_OUTFALL_OFFSET_TILES) * T,
    offPump.y * T,
    T,
    'west',
    false,
    frame,
  );

  for (let i = 0; i < FLOATING_BARREL_COUNT; i++) {
    const { x, y } = LAYOUT.floatingBarrels;
    drawFloatingBarrel(ctx, (x + i) * T, y * T, T, frame, i);
  }

  const artTile = T * KRAKEN_VISUAL_SCALE;
  const art = krakenScaledArtOrigin(kraken.x * T, kraken.y * T, T, artTile);
  drawKrakenSubmergedSprite(ctx, art.x, art.y, artTile, frame, { idleFrame: 0 });

  for (const fin of FINS) {
    drawSharkFinSprite(
      ctx,
      fin.x * T,
      fin.y * T,
      T,
      fin.headingX,
      fin.headingY,
      frame,
      fin.chasing,
    );
  }
  return canvas;
}

/** After the drain: rafts and barrels settled, the dead shark both ways round, the stack, its fall and the drains. */
function renderDrained(scale: number, frame: number): Canvas {
  const { canvas, ctx } = floorCanvas(roomMap(false, []), scale, frame);
  const { bigRaft, runningPump, drains, settledBarrels } = LAYOUT;

  for (const drain of drains) drawFloorDrain(ctx, drain.x * T, drain.y * T, T);
  drawDrainSwirl(ctx, drains[1].x * T, drains[1].y * T, T, frame);

  drawFloodedPumpRaft(
    ctx,
    bigRaft.x * T,
    bigRaft.y * T,
    bigRaft.w,
    bigRaft.h,
    T,
    'settled',
    frame,
    BIG_RAFT_SEED,
  );
  drawFloodedPump(ctx, runningPump.x * T, runningPump.y * T, T, false, 0, frame);
  drawFloodedPumpChute(
    ctx,
    (runningPump.x + PUMP_OUTFALL_OFFSET_TILES) * T,
    runningPump.y * T,
    T,
    'east',
    false,
    frame,
  );

  LAYOUT.deadSharks.forEach((shark, i) =>
    drawDeadShark(ctx, shark.x * T, shark.y * T, T, i, i % 2 === 1),
  );

  const at = (offset: number) => (settledBarrels.x + offset) * T;
  const rowY = settledBarrels.y * T;
  SETTLED_LOOKS.forEach((look, offset) => drawSettledBarrel(ctx, at(offset), rowY, T, look));

  for (const seat of LAYOUT.stacks) {
    drawBarrelStack(ctx, seat.x * T, seat.y * T, T, seat.height);
  }

  TOPPLE_STOPS.forEach((progress, i) => {
    const seatX = LAYOUT.toppleSeats.x + i * LAYOUT.toppleSeats.spacing;
    const seatY = LAYOUT.toppleSeats.y;
    // The stack falls across the corridor beside it: one barrel to each tile to its west.
    const landings: BarrelLanding[] = Array.from({ length: TOPPLE_STACK_HEIGHT }, (_, level) => ({
      sx: (seatX - 1 - level) * T,
      sy: seatY * T,
    }));
    drawBarrelStackTopple(ctx, seatX * T, seatY * T, T, landings, progress, frame);
  });
  return canvas;
}

/** The world tick the breach strip's water is drawn at. */
const BREACH_WATER_FRAME = 0;

/** Ticks of the breach the strip shows, from the swell to the last ripple. */
const BREACH_STOPS = Object.values({
  swell: 4,
  rising: 12,
  gaping: 18,
  bite: 24,
  thrash: 32,
  holding: 44,
  sinking: 52,
  ripples: 70,
});
/** Ages of the pool, in ticks, from a fresh bloom to fully spread. */
const POOL_AGES = Object.values({ fresh: 10, spreading: 40, spread: 200 });
/** Each breach frame gets a cell this many tiles wide. */
const BREACH_CELL_TILES = 3;
const BREACH_ROW_TILES = 4;
const POOL_ROW_TILES = 8;

/** The breach, frame by frame, and the pool it leaves, over deep water. */
function renderBreach(scale: number): Canvas {
  const { canvas, ctx } = floorCanvas(roomMap(true, []), scale, BREACH_WATER_FRAME);
  const cellCentre = (i: number) => (i * BREACH_CELL_TILES + BREACH_CELL_TILES / 2) * T;
  BREACH_STOPS.forEach((tick, i) => {
    const poolAge = tick - SHARK_ATTACK_TAKEN_FRAME;
    drawSharkBloodPoolSprite(ctx, poolAge, cellCentre(i), BREACH_ROW_TILES * T, T);
    drawSharkAttackSprite(ctx, tick, cellCentre(i), BREACH_ROW_TILES * T, T);
  });
  POOL_AGES.forEach((age, i) =>
    drawSharkBloodPoolSprite(ctx, age, cellCentre(i), POOL_ROW_TILES * T, T),
  );
  return canvas;
}

/** Renders every review picture at `scale`, animations at world tick `frame`; returns the paths written. */
export function renderFloodedPumpRoomArt(scale: number, frame: number): string[] {
  const outputs: Array<[string, Canvas]> = [
    ['flooded', renderFlooded(scale, frame)],
    ['drained', renderDrained(scale, frame)],
    ['breach', renderBreach(scale)],
  ];
  return outputs.map(([name, canvas]) =>
    writePreviewPng(
      `preview/boss-rooms/flooded-pump-room-${name}-x${scale}.png`,
      canvas.toBuffer('image/png'),
    ),
  );
}
