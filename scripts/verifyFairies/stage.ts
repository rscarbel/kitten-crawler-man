/**
 * A walled arena with a real roster, combat kit, fairy systems and skeleton
 * system, wired the way `DungeonScene` wires them, for the per-kind sections
 * of `verify:fairies`.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { PlayerManager } from '../../src/core/PlayerManager';
import { AbilityManager } from '../../src/core/AbilityManager';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobRoster, type SceneWorld } from '../../src/systems/kits/SceneWorld';
import { CombatKit } from '../../src/systems/kits/CombatKit';
import type { SystemContext } from '../../src/systems/GameSystem';
import { createMob } from '../../src/levels/spawner';
import type { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import { FairySystem } from '../../src/systems/FairySystem';
import { FairyFireballSystem } from '../../src/systems/FairyFireballSystem';
import { SkeletonSummonSystem } from '../../src/systems/SkeletonSummonSystem';
import { setPackAlertGrid } from '../../src/creatures/packAlert';
import {
  setVisibleWorldView,
  type VisibleWorldView,
  type WorldSight,
} from '../../src/core/visibleWorldView';
import { clamp } from '../../src/utils';

/** Side of the square test arena, border walls included, in tiles. */
export const ARENA_TILES = 30;
/** A corner far from every fairy placed in a section: crawlers wait here out of notice. */
export const PARK_TILE = 27;
/** Big enough to kill anything in one blow. */
export const LETHAL_BLOW = 99_999;
/** The spawn tile `PlayerManager` is handed; every section repositions the party itself. */
const PARTY_SPAWN_TILE = 2;

/**
 * A roll no dodge chance reaches: the crawler's dodge is `Math.random() <
 * dodgeChance`, so pinned this high a blow always connects and an escape is
 * the movement alone rather than luck.
 */
const NEVER_DODGE_ROLL = 0.999;

/** Runs `body` with every random draw pinned above any dodge chance, then restores the stream. */
export function withDodgesOff<T>(body: () => T): T {
  const random = Math.random;
  Math.random = () => NEVER_DODGE_ROLL;
  try {
    return body();
  } finally {
    Math.random = random;
  }
}

export type TileSpec = readonly [number, number];

/** A screen the camera is drawn on, in CSS pixels. */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/** A portrait phone: the smallest screen the game is laid out for. */
export const PHONE_SCREEN: ScreenSize = { width: 360, height: 640 };
/** A full-HD desktop window: wider and taller than the whole arena. */
export const DESKTOP_SCREEN: ScreenSize = { width: 1920, height: 1080 };

/**
 * Everything in the arena, fog-free: the view every section starts with, so a
 * rule that waits for the player to see a fairy is met unless a section says
 * otherwise.
 */
export const WHOLE_ARENA_VIEW: VisibleWorldView = {
  left: 0,
  top: 0,
  width: ARENA_TILES * TILE_SIZE,
  height: ARENA_TILES * TILE_SIZE,
  sight: null,
};

/**
 * The view of a camera following `focus` on `screen`, centred on its tile and
 * held inside the arena exactly as `DungeonScene` holds its camera inside the
 * map, so a crawler near a wall sees farther on the far side.
 */
export function followCameraView(
  focus: { readonly x: number; readonly y: number },
  screen: ScreenSize,
  sight: WorldSight | null = null,
): VisibleWorldView {
  const arenaPx = ARENA_TILES * TILE_SIZE;
  const centredLeft = focus.x + TILE_SIZE / 2 - screen.width / 2;
  const centredTop = focus.y + TILE_SIZE / 2 - screen.height / 2;
  return {
    left: clamp(centredLeft, 0, arenaPx - screen.width),
    top: clamp(centredTop, 0, arenaPx - screen.height),
    width: screen.width,
    height: screen.height,
    sight,
  };
}

/** A square room walled at its border, plus any interior wall tiles given. */
export function makeArena(innerWalls: readonly TileSpec[] = []): GameMap {
  const walls = new Set(innerWalls.map(([x, y]) => `${x},${y}`));
  const last = ARENA_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ARENA_TILES }, (_, y) =>
    Array.from({ length: ARENA_TILES }, (_, x) => {
      const border = x === 0 || y === 0 || x === last || y === last;
      return {
        tileId: `${x}#${y}`,
        type: border || walls.has(`${x},${y}`) ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

export function placeOnTile(entity: { x: number; y: number }, tileX: number, tileY: number): void {
  entity.x = tileX * TILE_SIZE;
  entity.y = tileY * TILE_SIZE;
}

export function centreOf(entity: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  return { x: entity.x + TILE_SIZE / 2, y: entity.y + TILE_SIZE / 2 };
}

export function buildStage(innerWalls: readonly TileSpec[] = []) {
  const map = makeArena(innerWalls);
  const bus = new EventBus();
  const pm = new PlayerManager(PARTY_SPAWN_TILE, PARTY_SPAWN_TILE, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  setPackAlertGrid(roster.grid);
  setVisibleWorldView(WHOLE_ARENA_VIEW);
  const world: SceneWorld = { gameMap: map, bus, audio: null, pm, roster };
  const combat = new CombatKit({ world, abilityManager: new AbilityManager(), safeRoom: null });
  const summons = new SkeletonSummonSystem(map, (mob) => roster.add(mob));
  const fairies = new FairySystem({
    bus,
    gameMap: map,
    ledger: null,
    getMobs: () => roster.mobs,
    getCrawlers: () => [pm.human, pm.cat],
    addMob: (mob) => roster.add(mob),
    skeletonSummons: summons,
  });
  const fireballs = new FairyFireballSystem({ bus, gameMap: map, getMobs: () => roster.mobs });
  const ctx = (): SystemContext => ({
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    inactive: pm.inactive(),
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [],
  });
  const add = (type: string, tileX: number, tileY: number): Mob => {
    const mob = createMob(type, tileX, tileY, map);
    roster.add(mob);
    return mob;
  };
  /** Kills through the real damage path and the scene's kill resolution, so `mobKilled` fires. */
  const kill = (mob: Mob): void => {
    mob.takeDamageFrom(LETHAL_BLOW, pm.human);
    combat.resolveKills();
  };
  const party = (): Player[] => [pm.human, pm.cat];
  placeOnTile(pm.human, PARK_TILE, PARK_TILE);
  placeOnTile(pm.cat, PARK_TILE, PARK_TILE);
  return { map, bus, pm, roster, combat, summons, fairies, fireballs, ctx, add, kill, party };
}

export type Stage = ReturnType<typeof buildStage>;
