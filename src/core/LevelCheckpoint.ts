import type { AbilityManager } from './AbilityManager';
import type { AchievementManager } from './AchievementManager';
import type { PlayerSnapshot } from './PlayerSnapshot';
import type { WorldCheckpoint } from './WorldCheckpoint';

/**
 * In-run checkpoint captured on safe-room entry. Restoring it puts the current
 * `DungeonScene` back the way it was at capture time rather than rebuilding the
 * scene — map generation has no seed, so "the world you left" cannot be
 * re-derived, only kept. In-memory only: it does not survive a page reload.
 */
export interface LevelCheckpoint {
  /**
   * The floor and the run as they stood at capture. Without this the checkpoint
   * rewound the party but not the world, so a boss killed after the safe room
   * stayed dead and its reward stayed collected.
   */
  world: WorldCheckpoint;
  humanSnap: PlayerSnapshot;
  catSnap: PlayerSnapshot;
  /**
   * Ability levels and XP. Not in `PlayerSnapshot` — ability progress is carried
   * only as a live `AbilityManager` reference, so without a clone here it would
   * not rewind and the player would keep magic-missile levels earned after saving.
   */
  abilities: AbilityManager;
  humanAchievements: AchievementManager;
  catAchievements: AchievementManager;
  /** Pixel position both crawlers respawn at — the safe room's centre. */
  respawnX: number;
  respawnY: number;
  /** Frames left on the floor clock — restoring it is what stops a respawn into an expired timer. */
  levelTimerFrames: number;
}
