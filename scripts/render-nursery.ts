/**
 * Headless review render of the goblin nursery mid-wave: the room's floor and
 * grates, its torches, the wood pile, barriers at several stages of damage and
 * of being built, the guide highlights, repair badges and the wave's status
 * panel — everything `DefendQuestSystem` draws, through its own render calls.
 *
 *   npx tsx scripts/render-nursery.ts --level=2 --scale=2
 *
 * Writes three frames: `-countdown` (no boards anywhere, so the wood pile's
 * arrow and every grate's highlight), `-defending` (a mix of barriers, one going
 * up, a refused repair) and `-stocked` (the same room with the crawler holding
 * boards). There is no `--seed`: the generator draws from `Math.random`, so a
 * fresh run is a fresh room.
 */

import { createCanvas, type Canvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { EventBus } from '../src/core/EventBus.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { GameMap } from '../src/map/GameMap.js';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  setDungeonFloorTheme,
} from '../src/map/dungeon/floorTheme.js';
import { DefendQuestSystem } from '../src/systems/DefendQuestSystem.js';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem.js';
import { Conversation } from '../src/dialog/Conversation.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { MobRoster } from '../src/systems/kits/SceneWorld.js';
import { SpellSystem } from '../src/systems/SpellSystem.js';
import type { SystemContext } from '../src/systems/GameSystem.js';

const DEFAULT_LEVEL = 1;
const DEFAULT_SCALE = 2;
const VIEW_MARGIN_TILES = 3;
const ARG_PREFIX_LENGTH = '--='.length;
const BARRIER_MAX_HP = 36;
/** Health fractions the barriers in the defending frame are set to, grate by grate. */
const HEALTH_SCRATCHED = 0.9;
const HEALTH_GOUGED = 0.7;
const HEALTH_CRACKED = 0.45;
const HEALTH_SNAPPED = 0.3;
const HEALTH_FAILING = 0.15;
const BARRIER_HEALTH = [
  1,
  HEALTH_GOUGED,
  HEALTH_CRACKED,
  HEALTH_FAILING,
  HEALTH_SCRATCHED,
  HEALTH_SNAPPED,
] as const;
/** Frames the effects are stepped after the staged blows, so the splinters are mid-air. */
const EFFECT_SETTLE_FRAMES = 6;
/** Frames the stocked frame waits for a finished build's sawdust to clear, so the pile reads cleanly. */
const BUILD_SETTLE_FRAMES = 48;
const BOARDS_IN_HAND = 8;
const BLOW_DAMAGE = 6;
/** Timers the staged frames are frozen at: mid-countdown and a little past halfway through the wave. */
const STAGED_APPROACH_FRAMES = 900;
const STAGED_DEFENSE_FRAMES = 2000;

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + ARG_PREFIX_LENGTH), 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const floorNumber = intArg('level', DEFAULT_LEVEL);
const scale = intArg('scale', DEFAULT_SCALE);
const outBase = stringArg('out', `${PREVIEW_DIR}/nursery`).replace(/\.png$/, '');
const levelDef = getLevelDef(`level${floorNumber}`);

await loadGameSpritesInNode();
setDungeonFloorTheme(levelDef.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);

const gameMap = new GameMap({
  mapSize: levelDef.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'dungeon',
  dungeon: dungeonOptionsForLevel(levelDef),
});
if (gameMap.questRooms.length === 0) throw new Error('this map has no nursery');
const room = gameMap.questRooms[0];

const quest = new DefendQuestSystem(
  gameMap,
  new EventBus(),
  () => undefined,
  new Conversation(null),
  () => 1,
  undefined,
  levelDef.defendQuestIntensity,
);
/** The lighting clock, fixed so a sconce's flicker lands on the same phase every run. */
const LIGHTING_CLOCK_MS = 0;

// The sconces' pools of light belong to the dungeon's lighting pass, built
// here the way `DungeonScene` builds it.
const lighting = new DungeonLightingSystem({
  gameMap,
  now: () => LIGHTING_CLOCK_MS,
  additiveGlows: () => true,
});
for (const sconce of quest.sconceLights()) {
  lighting.registerStaticLight({
    tileX: sconce.tileX,
    tileY: sconce.tileY,
    kind: 'wall_sconce',
    centre: { x: sconce.centreX, y: sconce.centreY },
  });
}
const human = new HumanPlayer(room.woodPileTile.x + 2, room.woodPileTile.y + 2, TILE_SIZE);
const cat = new CatPlayer(room.centre.x - 2, room.centre.y + 2, TILE_SIZE);
human.isActive = true;
cat.isActive = false;
const roster = new MobRoster(gameMap, new SpellSystem());
const context: SystemContext = {
  human,
  cat,
  active: human,
  inactive: cat,
  activeIsMoving: false,
  roster,
  gameMap,
};
quest.update(context);

const viewTilesW = room.bounds.w + VIEW_MARGIN_TILES * 2;
const viewTilesH = room.bounds.h + VIEW_MARGIN_TILES * 2;
const camX = (room.bounds.x - VIEW_MARGIN_TILES) * TILE_SIZE;
const camY = (room.bounds.y - VIEW_MARGIN_TILES) * TILE_SIZE;
const viewW = viewTilesW * TILE_SIZE;
const viewH = viewTilesH * TILE_SIZE;
setViewportSize(viewW, viewH);

function frame(name: string): void {
  const canvas: Canvas = createCanvas(viewW * scale, viewH * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const gameCtx = asGameContext(ctx);
  renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
  renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewW, viewH);
  quest.renderObjects(gameCtx, camX, camY, human, human);
  human.render(gameCtx, camX, camY, TILE_SIZE);
  lighting.render(gameCtx, camX, camY, viewW, viewH);
  quest.renderAbove(gameCtx, camX, camY, human);
  quest.renderUI(gameCtx);
  const path = writePreviewPng(`${outBase}-${name}.png`, canvas.toBuffer('image/png'));
  console.log(path);
}

const snapshot = quest.captureCheckpoint();
quest.restoreCheckpoint({
  ...snapshot,
  phase: 'countdown',
  approachTimer: STAGED_APPROACH_FRAMES,
  woodPileAvailable: true,
});
frame('countdown');

const barriers = room.grateTiles
  .map((grate, grateIdx) => ({
    tileX: grate.x,
    tileY: grate.y,
    worldX: grate.x * TILE_SIZE,
    worldY: grate.y * TILE_SIZE,
    hp: BARRIER_MAX_HP * (BARRIER_HEALTH[grateIdx] ?? 1),
    maxHp: BARRIER_MAX_HP,
    grateIdx,
    hitFlash: 0,
  }))
  .filter((_, grateIdx) => grateIdx !== room.grateTiles.length - 1);
quest.restoreCheckpoint({
  ...snapshot,
  phase: 'defending',
  defenseTimer: STAGED_DEFENSE_FRAMES,
  woodPileAvailable: true,
  barriers,
  pendingBuild: null,
});
const lastGrate = room.grateTiles[room.grateTiles.length - 1];
const damaged = room.grateTiles[1];
// A refused repair beside a clawed barrier, then boards in hand for a build on the last grate.
human.x = damaged.x * TILE_SIZE;
human.y = (damaged.y + 1) * TILE_SIZE;
quest.tryBuildBarrier(human);
quest.damageBarrier(room.grateTiles[2], BLOW_DAMAGE);
for (let step = 0; step < EFFECT_SETTLE_FRAMES; step++) quest.update(context);
frame('defending');

human.inventory.addItem('quest_wood_board', BOARDS_IN_HAND);
human.x = lastGrate.x * TILE_SIZE;
human.y = (lastGrate.y + 1) * TILE_SIZE;
quest.tryBuildBarrier(human);
for (let step = 0; step < BUILD_SETTLE_FRAMES; step++) quest.update(context);
frame('stocked');
