/**
 * Where the Warden's fight is framed on one HUD layout: the cattery built for
 * the fight, the top band holding the fight's card (the boss bar with a
 * downed teammate's countdown riding in it), and the camera the scene computes —
 * the band's bottom as its top inset, `interiorHudOccluders`, `hudClearView`, then
 * `framedCamera` with the fight's arena rows — for the party standing on
 * every floor tile of the room.
 *
 * The north wall row must sit on screen, in the camera's view, under none of
 * the band's cards, from every tile where the room leaves the camera a way to
 * show both that row and the party's own tile: the fight is staged against
 * that wall.
 */

import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { TOWN_TOWER_ID } from '../src/map/buildingIds';
import { towerConditionsFor, towerStoreyIndex } from '../src/map/town/interiors/townCenterTower';
import { missingCatsProgressAt } from '../src/core/quests/missingCatsProgress';
import {
  framedCamera,
  hudClearView,
  interiorCameraBounds,
  interiorFocusRange,
  interiorMustSeeBounds,
} from '../src/scenes/interiorCamera';
import { hotbarBandHeightCss, interiorHudOccluders } from '../src/scenes/interiorHud';
import { WARDEN_ARENA_ROWS } from '../src/systems/tower/TowerRitualSystem';
import { toCssRect } from '../src/ui/hud/HudSurface';
import { intersect, overlaps, type Rect } from '../src/ui/core/geom';
import type { WorldRows } from '../src/core/rendering/worldRect';
import { representativeFightCard, type HudState } from './phoneHudLayouts';
import { installCanvasGlobals } from './nodeCanvasGlobals';

/** Every button the room can show, so the camera frames against the most covered screen. */
const FULL_CHROME = { follow: true, summon: true, build: true, journal: true } as const;
/** Rows riding in the boss card: a downed teammate's countdown. */
const RIDER_ROWS = 1;
const NORTH_WALL_ROW = 0;
/** Where `GameplayScene.computeCamera` centres on within the focus's tile. */
const FOCUS_TILE_CENTRE = 0.5;
/** Sub-pixel slack for comparing screen positions computed in floating point. */
const EPSILON_PX = 0.5;

/**
 * How the scene frames the fight: `band` insets the camera's view below the
 * band's cards and `arenaRows` names the fight's rows. A fault drops one, to show the check
 * fails without it.
 */
export interface FightFraming {
  readonly band: boolean;
  readonly arenaRows: WorldRows | null;
}

export const SCENE_FRAMING: FightFraming = { band: true, arenaRows: WARDEN_ARENA_ROWS };

let cattery: GameMap | null = null;

/** The cattery as the fight finds it, built once. */
function catteryMap(): GameMap {
  if (cattery !== null) return cattery;
  // The room's camera bounds measure its props' art, which paints on a canvas.
  installCanvasGlobals();
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', towerStoreyIndex('cattery'), TOWN_TOWER_ID, false, {
    kind: 'tower',
    conditions: towerConditionsFor(missingCatsProgressAt('ritual')),
  });
  cattery = map;
  return map;
}

export interface FramingResult {
  readonly failures: string[];
  /** Tiles from which the north wall had to be shown. */
  readonly checked: number;
}

/** The north wall's place on screen during the fight, from every floor tile, on `state`'s layout. */
export function wardenFightFramingFailures(
  state: HudState,
  where: string,
  framing: FightFraming = SCENE_FRAMING,
): FramingResult {
  const map = catteryMap();
  const { geometry, uiScale } = state;
  const cssWidth = state.width * uiScale;
  const cssHeight = state.height * uiScale;
  const bandSlots = representativeFightCard(geometry, RIDER_ROWS).map((piece) => piece.rect);
  const bandCss = bandSlots.map((rect) => toCssRect(rect, uiScale));
  const bandBottom = bandSlots.reduce((lowest, rect) => Math.max(lowest, rect.y + rect.h), 0);
  const topInset = framing.band ? bandBottom * uiScale : 0;
  const bottomInset = hotbarBandHeightCss(geometry, uiScale, cssHeight);
  const view: Rect = { x: 0, y: topInset, w: cssWidth, h: cssHeight - bottomInset - topInset };
  const occluders = interiorHudOccluders(geometry, uiScale, FULL_CHROME);
  const bounds = interiorCameraBounds(map);
  const focusRange = interiorFocusRange(map);
  const clear = hudClearView(view, occluders, bounds, interiorMustSeeBounds(map), focusRange);
  const rows = map.structure.length;
  const cols = map.structure[0]?.length ?? 0;
  const failures: string[] = [];
  let checked = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!map.isWalkable(x, y, 'walker')) continue;
      const wallToTile = (y + 1 - NORTH_WALL_ROW) * TILE_SIZE;
      if (wallToTile > clear.h) continue;
      checked++;
      const focus = {
        x: (x + FOCUS_TILE_CENTRE) * TILE_SIZE,
        y: (y + FOCUS_TILE_CENTRE) * TILE_SIZE,
      };
      const camera = framedCamera(focus, bounds, view, clear, focusRange, framing.arenaRows);
      const wallRow: Rect = {
        x: -camera.x,
        y: NORTH_WALL_ROW * TILE_SIZE - camera.y,
        w: cols * TILE_SIZE,
        h: TILE_SIZE,
      };
      const wallOnScreen = intersect(wallRow, view);
      const problem =
        wallRow.y < view.y - EPSILON_PX || wallRow.y + wallRow.h > view.y + view.h + EPSILON_PX
          ? 'is off screen'
          : wallOnScreen !== null && bandCss.some((card) => overlaps(card, wallOnScreen))
            ? 'is under the top band'
            : null;
      if (problem !== null) {
        failures.push(
          `${where}: standing on (${x},${y}) the cattery's north wall (screen y ${Math.round(wallRow.y)}) ${problem}`,
        );
      }
    }
  }
  return { failures, checked };
}
