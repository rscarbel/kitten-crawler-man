import type { AbilityManager } from '../skills/AbilityManager';
import type { AchievementManager } from '../progression/AchievementManager';
import type { PlayerSnapshot } from './PlayerSnapshot';
import type { WorldCheckpoint } from './WorldCheckpoint';
import type { PartyCraftsState } from '../labour/partyCrafts';

/**
 * In-run checkpoint captured at a save point, alongside the save it mirrors in
 * a `SavePoint`. Restoring it puts the current `DungeonScene` back the way
 * it was at capture time rather than rebuilding the scene, which keeps what the
 * save cannot: which ordinary mobs are already dead, the fog, the felled trees.
 * In-memory only, and bound to the creatures that captured it — its mob flags
 * live on them — so a scene rebuilt around a regenerated roster falls back to
 * the save itself. A scene rebuilt around a floor held aside for a building
 * visit keeps those very creatures, and so keeps the checkpoint too.
 */
export interface LevelCheckpoint {
  /**
   * The floor and the run as they stood at capture. Without it a respawn would
   * rewind the party but not the world, so a boss killed after the save point
   * would stay dead and its reward stay collected.
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
  /**
   * Party tool tiers and seen explainers at capture time. Not in `PlayerSnapshot`
   * — this is party progress threaded as a live `PartyCraftsState`, so without a
   * copy here a death rewind would leave an upgrade bought after the save point
   * in place.
   */
  crafts: PartyCraftsState;
  /** Pixel position the party respawns at — a safe room's centre, or the tile where it entered town. */
  respawnX: number;
  respawnY: number;
  /** Frames left on the floor clock — restoring it is what stops a respawn into an expired timer. */
  levelTimerFrames: number;
}
