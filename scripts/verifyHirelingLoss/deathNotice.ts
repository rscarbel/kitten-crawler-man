/**
 * A hireling's permanent death is never silent: "<Name> has died." reaches the
 * toast strip exactly once, whichever way it died.
 *
 * - Left downed until its revive window runs out, it is announced on the next
 *   frame, once, however many frames follow.
 * - Left downed at a door, it dies in the scene being left — whose toast strip
 *   goes with it — and the scene arrived in announces it, once, even when the
 *   departing scene resolves the transition twice.
 * - A hire that goes down and is revived is never announced.
 * - The desk still has the name for its condolences after the toast.
 *
 * Each rule has its control: the same death with the announcing system never
 * ticked shows no toast, so a toast counted above is the system's own.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { createMercenaryRoster, type MercenaryRoster } from '../../src/core/MercenaryRoster';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import type { Mercenary } from '../../src/creatures/Mercenary';
import { HIRELING_REVIVE_WINDOW_FRAMES } from '../../src/creatures/mercenaries/hirelingSurvival';
import { level3 } from '../../src/levels/level3';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MercenarySystem, type HirelingFeedback } from '../../src/systems/MercenarySystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { JourneyGateReporter } from './circusJourney';

const HIRE_ID = 'sledge';
const ROOM_W_TILES = 24;
const ROOM_H_TILES = 16;
const PARTY_TILE = { x: 6, y: 8 } as const;
/** Far enough from the body that no crawler is in revive reach. */
const AWAY_TILE = { x: 20, y: 8 } as const;
/** Frames watched after a death for a second announcement. */
const AFTERMATH_FRAMES = 120;
/** Frames a crawler stands over a downed hire: past any revive. */
const REVIVE_WATCH_FRAMES = 600;

interface Scene {
  readonly human: HumanPlayer;
  readonly mobs: MobRoster;
  readonly system: MercenarySystem;
  readonly ctx: SystemContext;
  readonly toasts: string[];
}

function makeRoom(): GameMap {
  const lastX = ROOM_W_TILES - 1;
  const lastY = ROOM_H_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_H_TILES }, (_, y) =>
    Array.from({ length: ROOM_W_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type:
        x === 0 || y === 0 || x === lastX || y === lastY
          ? FloorTypeValue.wall
          : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function hiredRoster(): MercenaryRoster {
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRE_ID,
    name: getMercenaryTemplate(HIRE_ID).name,
    contractLevelId: level3.id,
    introduced: true,
  };
  return roster;
}

function makeScene(roster: MercenaryRoster): Scene {
  const map = makeRoom();
  const human = new HumanPlayer(PARTY_TILE.x, PARTY_TILE.y, TILE_SIZE);
  const cat = new CatPlayer(PARTY_TILE.x, PARTY_TILE.y + 1, TILE_SIZE);
  human.isActive = true;
  cat.setMap(map);
  const mobs = new MobRoster(map, new SpellSystem());
  const toasts: string[] = [];
  const feedback: HirelingFeedback = {
    toast: (message) => toasts.push(message),
    sound: () => undefined,
  };
  const system = new MercenarySystem(roster, level3.id, () => false, feedback);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
    extraTargets: [],
  };
  system.update(ctx);
  return { human, mobs, system, ctx, toasts };
}

function frame(scene: Scene): void {
  scene.system.checkHealth();
  scene.system.update(scene.ctx);
}

/** Puts the hire on the floor and walks the whole party out of revive reach. */
function knockDown(scene: Scene): Mercenary | null {
  const merc = scene.system.activeMerc;
  if (merc === null) return null;
  merc.hp = 0;
  scene.system.checkHealth();
  scene.human.x = AWAY_TILE.x * TILE_SIZE;
  scene.human.y = AWAY_TILE.y * TILE_SIZE;
  scene.ctx.cat.x = AWAY_TILE.x * TILE_SIZE;
  scene.ctx.cat.y = (AWAY_TILE.y + 1) * TILE_SIZE;
  return merc;
}

function deathToasts(toasts: readonly string[], name: string): number {
  return toasts.filter((message) => message === `${name} has died.`).length;
}

function checkWindowExpiry(report: JourneyGateReporter): void {
  const roster = hiredRoster();
  const scene = makeScene(roster);
  const merc = knockDown(scene);
  report.check(merc?.isDowned === true, 'the hire is down, ready to be left');
  if (merc === null) return;
  const name = merc.displayName;
  for (let f = 0; f < HIRELING_REVIVE_WINDOW_FRAMES + AFTERMATH_FRAMES; f++) frame(scene);
  report.check(roster.active === null, 'a hire left past its revive window is dead');
  report.check(
    deathToasts(scene.toasts, name) === 1,
    `a hire dead at the end of its window is announced once (${deathToasts(scene.toasts, name)})`,
  );
  report.check(
    roster.lastDeceased === name,
    'the desk still has the name for its condolences after the toast',
  );

  // The same death with only the health checks run: nothing announces it.
  const quietRoster = hiredRoster();
  const quiet = makeScene(quietRoster);
  const quietMerc = knockDown(quiet);
  for (let f = 0; f < HIRELING_REVIVE_WINDOW_FRAMES + AFTERMATH_FRAMES; f++) {
    quiet.system.checkHealth();
  }
  report.checkCatches(
    quietMerc !== null && deathToasts(quiet.toasts, quietMerc.displayName) > 0,
    'a death nobody announced still shows a toast, so the count above is not the system’s',
  );
}

function checkDeathAtTheDoor(report: JourneyGateReporter): void {
  const roster = hiredRoster();
  const leaving = makeScene(roster);
  const merc = knockDown(leaving);
  if (merc === null) {
    report.check(false, 'no hire to leave at the door');
    return;
  }
  const name = merc.displayName;
  // A scene can resolve its door twice — the prompt and the transition — and
  // the second finds nothing left to kill.
  leaving.system.dismissForTransition(leaving.mobs.mobs, leaving.mobs.grid);
  leaving.system.dismissForTransition(leaving.mobs.mobs, leaving.mobs.grid);
  report.check(roster.active === null, 'a hire left downed at the door is dead');
  report.check(
    deathToasts(leaving.toasts, name) === 0,
    'the death is not announced into the scene being torn down',
  );

  const arrived = makeScene(roster);
  for (let f = 0; f < AFTERMATH_FRAMES; f++) frame(arrived);
  report.check(
    deathToasts(arrived.toasts, name) === 1,
    `the scene on the far side of the door announces it once (${deathToasts(arrived.toasts, name)})`,
  );
  report.check(roster.lastDeceased === name, 'the desk still has the name after a door death');
}

function checkRevivedIsSilent(report: JourneyGateReporter): void {
  const roster = hiredRoster();
  const scene = makeScene(roster);
  const merc = knockDown(scene);
  if (merc === null) {
    report.check(false, 'no hire to revive');
    return;
  }
  scene.human.x = merc.x;
  scene.human.y = merc.y;
  for (let f = 0; f < REVIVE_WATCH_FRAMES; f++) frame(scene);
  report.check(
    !merc.isDowned && roster.active !== null,
    'a crawler standing over the hire revives it',
  );
  report.check(
    deathToasts(scene.toasts, merc.displayName) === 0,
    'a hire that went down and was revived is never announced as dead',
  );
}

export function checkDeathNotice(report: JourneyGateReporter): void {
  checkWindowExpiry(report);
  checkDeathAtTheDoor(report);
  checkRevivedIsSilent(report);
}
