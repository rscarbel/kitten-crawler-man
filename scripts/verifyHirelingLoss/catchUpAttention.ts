/**
 * A hostile only holds a hire's catch-up off while the mob loop still ticks it.
 *
 * A hostile the party has walked away from — outside every crawler's AI
 * activation radius — keeps the target it last held, frozen, for as long as the
 * party stays away. Counting it as "engaged with the hire" would pin a far,
 * off-screen hire beside it forever. The same hostile inside the radius is a
 * live fight, and the hire is left to it.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { createMercenaryRoster } from '../../src/core/MercenaryRoster';
import { getMercenaryTemplate } from '../../src/core/mercenaryTemplates';
import { setViewportSize } from '../../src/core/Viewport';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { HIRELING_CATCH_UP_TILES } from '../../src/creatures/mercenaries/hirelingCatchUp';
import { createMob } from '../../src/levels/spawner';
import { level3 } from '../../src/levels/level3';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { SpellSystem } from '../../src/systems/SpellSystem';
import type { JourneyGateReporter } from './circusJourney';

const HIRE_ID = 'sledge';
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const HALL_W_TILES = 90;
const HALL_H_TILES = 12;
const HALL_ROW = 6;
const PARTY_COLUMN = 5;
/** Past the catch-up distance and off a desktop screen, but on the same floor. */
const HIRE_COLUMN = 45;
/** Beyond the mob loop's activation radius from both crawlers. */
const FORGOTTEN_HOSTILE_COLUMN = 85;
/** Well inside the activation radius: a fight the party is in. */
const LIVE_HOSTILE_COLUMN = 12;

function makeHall(): GameMap {
  const lastX = HALL_W_TILES - 1;
  const lastY = HALL_H_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: HALL_H_TILES }, (_, y) =>
    Array.from({ length: HALL_W_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type:
        x === 0 || y === 0 || x === lastX || y === lastY
          ? FloorTypeValue.wall
          : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** Whether the hire ends up beside the party, with a hostile at `hostileColumn` marking it. */
function caughtUpWith(hostileColumn: number): boolean {
  const map = makeHall();
  const human = new HumanPlayer(PARTY_COLUMN, HALL_ROW, TILE_SIZE);
  const cat = new CatPlayer(PARTY_COLUMN, HALL_ROW + 1, TILE_SIZE);
  human.isActive = true;
  cat.setMap(map);
  const mobs = new MobRoster(map, new SpellSystem());
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRE_ID,
    name: getMercenaryTemplate(HIRE_ID).name,
    contractLevelId: level3.id,
    introduced: true,
  };
  const system = new MercenarySystem(roster, level3.id);
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
  const hire = system.activeMerc;
  if (hire === null) return false;

  const preMoveX = hire.x;
  const preMoveY = hire.y;
  hire.x = HIRE_COLUMN * TILE_SIZE;
  hire.y = HALL_ROW * TILE_SIZE;
  mobs.grid.move(hire, preMoveX, preMoveY);
  const hostile = createMob('goblin', hostileColumn, HALL_ROW, map);
  hostile.aiHeld = true;
  mobs.add(hostile);
  hostile.currentTarget = hire;
  hostile.retaliateMob = hire;

  system.update(ctx);
  return Math.hypot(hire.x - human.x, hire.y - human.y) / TILE_SIZE <= HIRELING_CATCH_UP_TILES;
}

export function checkCatchUpAttention(report: JourneyGateReporter): void {
  setViewportSize(VIEWPORT_W, VIEWPORT_H);
  report.check(
    caughtUpWith(FORGOTTEN_HOSTILE_COLUMN),
    'a far hire marked only by a hostile the party left behind is caught up',
  );
  report.checkCatches(
    caughtUpWith(LIVE_HOSTILE_COLUMN),
    'a hire marked by a hostile in the fight the party is in is pulled out of it',
  );
}
