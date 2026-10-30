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
import type { CrawlerBarkSystem } from './CrawlerBarkSystem';
import type { MobRoster } from './kits/SceneWorld';
import type { Camera } from '../core/rendering/camera';

/** Per-frame shared state passed to every system's update(). */
export interface SystemContext {
  human: HumanPlayer;
  cat: CatPlayer;
  active: HumanPlayer | CatPlayer;
  /**
   * The crawler not being steered, when it is on this map; null while the
   * party is split and it is away. `human` and `cat` stay the whole roster,
   * for rewards and the save only.
   */
  partner: HumanPlayer | CatPlayer | null;
  activeIsMoving: boolean;
  /**
   * The scene's population — the list, the spatial index, and the one spawn path
   * that keeps them in step. A system that adds a mob mid-frame calls
   * `roster.add`; anything else reads `roster.mobs` / `roster.grid`.
   */
  roster: MobRoster;
  gameMap: GameMap;
  /** The camera this frame is drawn with: what any rule about the view on screen measures. */
  camera: Camera;
  /** Boss room system reference — used by MobUpdateLoop for clamping. Absent in scenes without boss rooms (e.g. building interiors). */
  bossRoom?: BossRoomSystem;
  /** Additional player-like targets (e.g. Deinonychus). Used by MobUpdateLoop. */
  extraTargets?: Player[];
  /** The scene's crawler bark system, for any system that wants a crawler to say something. */
  crawlerBarks?: CrawlerBarkSystem;
}

export interface GameSystem {
  /** Called once per frame during the system update phase. */
  update?(ctx: SystemContext): void;
  /** Called when the scene is torn down. */
  dispose?(): void;
}

/**
 * The crawlers on this map, human first, leaving out one away with the other
 * group of a split party. What every in-world rule reads: who is hit, who
 * stands on a plate, who is lit, who swings. `human` and `cat` on their own
 * are the roster, for rewards and the save.
 */
export function presentCrawlers(party: {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}): Array<HumanPlayer | CatPlayer> {
  const present: Array<HumanPlayer | CatPlayer> = [];
  if (!party.human.isAway) present.push(party.human);
  if (!party.cat.isAway) present.push(party.cat);
  return present;
}
