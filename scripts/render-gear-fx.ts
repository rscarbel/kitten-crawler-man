#!/usr/bin/env tsx
/**
 * Review harness for worn gear's world effects: the relics circling each
 * crawler, what they throw, claw swipes and slash waves, and the marks traits
 * leave on their wearer.
 *
 * Each cell builds a real party and a real `GearSystem`, puts the gear on or
 * queues the picture a trait would ask for, steps the system, then draws the
 * crawlers and the system over a dark dungeon floor and a pale one — light art
 * on a dark floor has to survive both. The sheet is drawn at the in-game size
 * (one world pixel to one CSS pixel) and again larger for detail; the in-game
 * sheet is the one that decides.
 *
 *   npm run render:gear-fx
 *   npx tsx scripts/render-gear-fx.ts --scale=4
 *
 * Output lands in `preview/gear-fx/`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { UNZOOMED, worldPx, type Camera } from '../src/core/rendering/camera.js';
import { EventBus } from '../src/core/EventBus.js';
import { ITEM_DEF, type ItemId } from '../src/core/items/defs/ItemDefs.js';
import { PlayerManager } from '../src/core/party/PlayerManager.js';
import type { ClawTrail } from '../src/core/items/equipment/weapons.js';
import { Mob } from '../src/creatures/Mob.js';
import { GameMap } from '../src/map/GameMap.js';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes.js';
import { GearSystem } from '../src/systems/GearSystem.js';
import { MobRoster } from '../src/systems/kits/SceneWorld.js';
import { SpellSystem } from '../src/systems/SpellSystem.js';

const CELL_TILES_W = 4;
const CELL_TILES_H = 4;
const CELL_W = CELL_TILES_W * TILE_SIZE;
const CELL_H = CELL_TILES_H * TILE_SIZE;
const LABEL_H = 14;
const GAP = 4;
const COLUMNS = 6;
const ROOM_TILES = 12;
const HUMAN_TILE = { x: 1, y: 2 } as const;
const CAT_TILE = { x: 2, y: 2 } as const;
/** Long enough for every relic to be mid-float rather than on frame zero. */
const WARM_FRAMES = 30;
const DUMMY_HP = 1_000_000;
const DUMMY_SPEED = 0;
const RECHARGING_FRAMES = 99;
/** Where a crawler a cell does not need stands, out of frame. */
const OFF_STAGE_PX = -TILE_SIZE * 4;

const FLOORS = [
  { name: 'dark', colour: '#26231f', grain: 'rgba(255,255,255,0.04)' },
  { name: 'pale', colour: '#9a8f78', grain: 'rgba(0,0,0,0.06)' },
] as const;
const SHEET_BACKDROP = '#111014';
const LABEL_COLOUR = '#e8e2d8';
const LABEL_FONT = '10px sans-serif';
const DEFAULT_SCALE = 3;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

class Target extends Mob {
  readonly xpValue = 0;
  protected override get eyePlacement(): null {
    return null;
  }
  constructor(tileX: number, tileY: number) {
    super(tileX, tileY, TILE_SIZE, DUMMY_HP, DUMMY_SPEED);
  }
  override get isHostile(): boolean {
    return true;
  }
  override updateAI(): void {
    // Placed by hand; never moves.
  }
  protected override drawSelf(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    ctx.fillStyle = '#6b2a2a';
    ctx.beginPath();
    ctx.ellipse(
      this.x - camX + TILE_SIZE / 2,
      this.y - camY + TILE_SIZE * 0.6,
      TILE_SIZE * 0.3,
      TILE_SIZE * 0.35,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function makeRoom(): GameMap {
  const grid: TileContent[][] = Array.from({ length: ROOM_TILES }, (_, y) =>
    Array.from({ length: ROOM_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

interface Stage {
  readonly pm: PlayerManager;
  readonly roster: MobRoster;
  readonly gear: GearSystem;
  /** Extra world art drawn under the crawlers, such as a bolt's target. */
  readonly mobs: Mob[];
}

function makeStage(): Stage {
  const map = makeRoom();
  const pm = new PlayerManager(HUMAN_TILE.x, HUMAN_TILE.y, undefined);
  pm.human.x = HUMAN_TILE.x * TILE_SIZE;
  pm.human.y = HUMAN_TILE.y * TILE_SIZE;
  pm.cat.x = CAT_TILE.x * TILE_SIZE;
  pm.cat.y = CAT_TILE.y * TILE_SIZE;
  const roster = new MobRoster(map, new SpellSystem());
  const gear = new GearSystem({
    gameMap: map,
    bus: new EventBus(),
    audio: null,
    audioScope: null,
    pm,
    roster,
  });
  return { pm, roster, gear, mobs: [] };
}

function wear(stage: Stage, who: 'human' | 'cat', id: ItemId): void {
  stage.pm[who].inventory.equipment.equip({ ...ITEM_DEF[id], quantity: 1 });
}

function step(stage: Stage, frames: number): void {
  for (let frame = 0; frame < frames; frame++) stage.gear.update();
}

interface Cell {
  readonly label: string;
  /** Sets the scene up, steps it, and leaves any per-frame flags set for the draw. */
  readonly build: () => Stage;
}

function relicCell(
  label: string,
  human: ItemId | null,
  cat: ItemId | null,
  recharge: boolean,
): Cell {
  return {
    label,
    build: () => {
      const stage = makeStage();
      if (human !== null) wear(stage, 'human', human);
      if (cat !== null) wear(stage, 'cat', cat);
      step(stage, WARM_FRAMES);
      if (recharge) {
        for (const [crawler, id] of [
          [stage.pm.human, human],
          [stage.pm.cat, cat],
        ] as const) {
          if (id !== null) crawler.gear.of(id).cooldownFrames.relic = RECHARGING_FRAMES;
        }
      }
      return stage;
    },
  };
}

function boltCell(frames: number): Cell {
  return {
    label: `ember bolt +${frames}f`,
    build: () => {
      const stage = makeStage();
      wear(stage, 'human', 'ember_wisp');
      step(stage, WARM_FRAMES);
      const target = new Target(3, 3);
      stage.roster.add(target);
      stage.mobs.push(target);
      stage.gear.fireRelicBolt(stage.pm.human, target, 'burn');
      step(stage, frames);
      return stage;
    },
  };
}

function brambleCell(age: number): Cell {
  return {
    label: `bramble age ${age}f`,
    build: () => {
      const stage = makeStage();
      wear(stage, 'cat', 'sproutling_seed');
      step(stage, WARM_FRAMES);
      stage.pm.cat.x = 0;
      stage.gear.plantBramble(stage.pm.cat, TILE_SIZE * 2.6, TILE_SIZE * 3.2);
      step(stage, age);
      return stage;
    },
  };
}

function fxCell(
  label: string,
  frames: number,
  queue: (stage: Stage) => void,
  setup?: (stage: Stage) => void,
): Cell {
  return {
    label,
    build: () => {
      const stage = makeStage();
      setup?.(stage);
      step(stage, WARM_FRAMES);
      queue(stage);
      step(stage, frames);
      return stage;
    },
  };
}

function swipeCell(trail: ClawTrail, frames: number): Cell {
  return fxCell(`${trail} swipe +${frames}f`, frames, (stage) => {
    const cat = stage.pm.cat;
    stage.pm.human.x = OFF_STAGE_PX;
    stage.pm.human.y = OFF_STAGE_PX;
    cat.facingX = 1;
    cat.facingY = 0;
    cat.gear.live.queueFx({
      kind: 'clawTrail',
      trail,
      x: cat.x + TILE_SIZE / 2,
      y: cat.y + TILE_SIZE * 0.65,
      dirX: 1,
      dirY: 0,
      reachPx: TILE_SIZE * 0.7,
    });
  });
}

function flagCell(
  label: string,
  setFlags: (stage: Stage) => void,
  setup?: (stage: Stage) => void,
): Cell {
  return {
    label,
    build: () => {
      const stage = makeStage();
      setup?.(stage);
      step(stage, WARM_FRAMES);
      setFlags(stage);
      return stage;
    },
  };
}

const CELLS: readonly Cell[] = [
  relicCell('wisp (him) + stone (her)', 'ember_wisp', 'ward_stone', false),
  relicCell('seed (him) + wisp (her)', 'sproutling_seed', 'ember_wisp', false),
  relicCell('stone + seed recharging', 'ward_stone', 'sproutling_seed', true),
  boltCell(4),
  boltCell(10),
  fxCell(
    'ward shatter +5f',
    5,
    (s) => s.pm.cat.gear.live.queueFx({ kind: 'wardShatter' }),
    (s) => wear(s, 'cat', 'ward_stone'),
  ),
  brambleCell(6),
  brambleCell(40),
  brambleCell(228),
  swipeCell('frost', 3),
  swipeCell('venom', 4),
  swipeCell('ink', 4),
  swipeCell('sunsteel', 3),
  swipeCell('sunsteel', 6),
  fxCell(
    'sunsteel slash wave',
    6,
    (s) => {
      const cat = s.pm.cat;
      s.pm.human.x = OFF_STAGE_PX;
      s.pm.human.y = OFF_STAGE_PX;
      cat.gear.live.queueFx({
        kind: 'slashWave',
        x: cat.x + TILE_SIZE / 2,
        y: cat.y + TILE_SIZE * 0.6,
        dirX: 1,
        dirY: 0,
        rangePx: TILE_SIZE * 3,
      });
    },
    (s) => wear(s, 'cat', 'sunsteel_talons'),
  ),
  flagCell('partner tether', (s) => {
    s.pm.cat.x = TILE_SIZE * 2.6;
    s.pm.cat.y = TILE_SIZE * 2.3;
    s.pm.human.gear.live.partnerLinked = true;
  }),
  fxCell('ninth life +8f', 8, (s) => s.pm.cat.gear.live.queueFx({ kind: 'lifeSaved' })),
  fxCell('ninth life +22f', 22, (s) => s.pm.cat.gear.live.queueFx({ kind: 'lifeSaved' })),
  flagCell(
    'last stand',
    (s) => {
      s.pm.human.gear.live.lastStandFrames = 60;
    },
    (s) => wear(s, 'human', 'hourglass_charm'),
  ),
  fxCell('set shimmer (epic) +15f', 15, (s) =>
    s.pm.human.gear.live.queueFx({ kind: 'setShimmer', rarity: 'Epic' }),
  ),
  flagCell('combo pips + riposte', (s) => {
    for (const crawler of [s.pm.human, s.pm.cat]) {
      crawler.gear.live.comboTarget = 3;
      crawler.gear.live.comboHits = 2;
      crawler.gear.live.riposteFrames = 30;
      crawler.facingX = 1;
      crawler.facingY = 0;
    }
  }),
  fxCell('chain spark +2f', 2, (s) => {
    const h = s.pm.human;
    h.gear.live.queueFx({
      kind: 'chainArc',
      fromX: h.x + TILE_SIZE,
      fromY: h.y + TILE_SIZE * 0.4,
      toX: TILE_SIZE * 3.5,
      toY: TILE_SIZE * 3.4,
    });
  }),
  flagCell('stillness regen', (s) => {
    s.pm.human.gear.live.stillnessRegenActive = true;
    s.pm.cat.gear.live.stillnessRegenActive = true;
  }),
  flagCell('vanish (her)', (s) => {
    s.pm.cat.gear.live.vanishFrames = 30;
  }),
  fxCell('flinch nova +6f', 6, (s) => {
    const h = s.pm.human;
    h.gear.live.queueFx({
      kind: 'shockwave',
      x: h.x + TILE_SIZE / 2,
      y: h.y + TILE_SIZE * 0.9,
      radiusPx: TILE_SIZE * 1.5,
      source: 'flinchNova',
    });
  }),
  fxCell('awakened +12f', 12, (s) => s.pm.human.gear.live.queueFx({ kind: 'awakened' })),
];

function paintFloor(ctx: CanvasRenderingContext2D, floor: (typeof FLOORS)[number]): void {
  ctx.fillStyle = floor.colour;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
  ctx.strokeStyle = floor.grain;
  ctx.lineWidth = 1;
  for (let x = 0; x <= CELL_TILES_W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_SIZE, 0);
    ctx.lineTo(x * TILE_SIZE, CELL_H);
    ctx.stroke();
  }
  for (let y = 0; y <= CELL_TILES_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_SIZE);
    ctx.lineTo(CELL_W, y * TILE_SIZE);
    ctx.stroke();
  }
}

function renderCell(cell: Cell, floor: (typeof FLOORS)[number], scale: number): Canvas {
  const stage = cell.build();
  const canvas = createCanvas(CELL_W * scale, CELL_H * scale);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.scale(scale, scale);
  paintFloor(ctx, floor);
  for (const mob of stage.mobs) mob.render(ctx, 0, 0, TILE_SIZE);
  const { human, cat } = stage.pm;
  const sorted = [
    ...[human, cat].map((crawler) => ({ sortY: crawler.depthY + TILE_SIZE, figure: crawler })),
    ...stage.gear.sortedRelics(() => false).map((relic) => ({ sortY: relic.sortY, figure: relic })),
  ].sort((a, b) => a.sortY - b.sortY);
  for (const { figure } of sorted) figure.render(ctx, 0, 0, TILE_SIZE);
  const cellCamera: Camera = {
    x: 0,
    y: 0,
    viewWidth: worldPx(CELL_W),
    viewHeight: worldPx(CELL_H),
    zoom: UNZOOMED,
  };
  stage.gear.render(ctx, cellCamera);
  stage.gear.dispose();
  return canvas;
}

function renderSheet(scale: number): Canvas {
  const rows = Math.ceil(CELLS.length / COLUMNS);
  const cellW = CELL_W * scale;
  const cellH = CELL_H * scale;
  const blockH = (cellH + GAP) * FLOORS.length + LABEL_H;
  const sheet = createCanvas(COLUMNS * (cellW + GAP) + GAP, rows * (blockH + GAP) + GAP);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = SHEET_BACKDROP;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = LABEL_FONT;
  CELLS.forEach((cell, index) => {
    const left = GAP + (index % COLUMNS) * (cellW + GAP);
    const top = GAP + Math.floor(index / COLUMNS) * (blockH + GAP);
    ctx.fillStyle = LABEL_COLOUR;
    ctx.fillText(cell.label, left, top + LABEL_H - 3);
    FLOORS.forEach((floor, row) => {
      ctx.drawImage(renderCell(cell, floor, scale), left, top + LABEL_H + row * (cellH + GAP));
    });
  });
  return sheet;
}

await loadGameSpritesInNode();
const scale = Number(parseFlag('scale', String(DEFAULT_SCALE)));
for (const [name, at] of [
  ['in-game', 1],
  [`x${scale}`, scale],
] as const) {
  const path = writePreviewPng(
    `${PREVIEW_DIR}/gear-fx/${name}.png`,
    renderSheet(at).toBuffer('image/png'),
  );
  console.log(`wrote ${path}`);
}
