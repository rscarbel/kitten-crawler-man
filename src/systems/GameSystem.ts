/**
 * GameSystem — minimal contract that every system in the dungeon scene
 * implements.  Not every system needs every method; all are optional.
 *
 * Having a shared interface lets DungeonScene store systems in typed
 * arrays and iterate over them generically for common operations
 * (frame tick, cleanup, etc.).
 */

import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameMap } from '../map/GameMap';
import type { BossRoomSystem } from './BossRoomSystem';
import type { MobRoster } from './kits/SceneWorld';

/** Per-frame shared state passed to every system's update(). */
export interface SystemContext {
  human: HumanPlayer;
  cat: CatPlayer;
  active: HumanPlayer | CatPlayer;
  inactive: HumanPlayer | CatPlayer;
  activeIsMoving: boolean;
  /**
   * The scene's population — the list, the spatial index, and the one spawn path
   * that keeps them in step. A system that adds a mob mid-frame calls
   * `roster.add`; anything else reads `roster.mobs` / `roster.grid`.
   */
  roster: MobRoster;
  gameMap: GameMap;
  /** Boss room system reference — used by MobUpdateLoop for clamping. Absent in scenes without boss rooms (e.g. building interiors). */
  bossRoom?: BossRoomSystem;
  /** Additional player-like targets (e.g. Mongo). Used by MobUpdateLoop. */
  extraTargets?: Player[];
}

export interface GameSystem {
  /** Called once per frame during the system update phase. */
  update?(ctx: SystemContext): void;
  /** Called when the scene is torn down. */
  dispose?(): void;
}
