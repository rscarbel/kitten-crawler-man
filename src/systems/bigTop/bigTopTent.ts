/**
 * Restarting the Big Top's maze from Act I, for a difficulty change confirmed
 * mid-show.
 *
 * `BuildingInteriorScene` restarts the tent through this, and the maze's gate
 * calls it headless, so everything a restart does to the room — the deal, the
 * teardown, the rebuild, the new maze and the party back at the flaps — is
 * the code the gate runs. What only the scene owns (its menus, its companions)
 * it does around the call.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Difficulty } from '../../core/difficultyProfiles';
import type { Conversation } from '../../dialog/Conversation';
import type { GameMap } from '../../map/GameMap';
import {
  MAZE_CAT_SPAWN_TILE,
  MAZE_HUMAN_SPAWN_TILE,
  planBigTopMaze,
  type BigTopMazePlan,
  type MazeTile,
} from '../../map/bigTopMazeLayout';
import type { Player } from '../../Player';
import type { BigTopMazeSystem } from '../BigTopMazeSystem';
import type { MobRoster } from '../kits/SceneWorld';

/** The room a tent stands in, and how to stand a maze up in it. */
export interface BigTopTentRoom {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly conversation: Conversation;
  readonly human: Player;
  readonly cat: Player;
  /** Floor 3's world seed, which with the difficulty deals the hall its board. */
  readonly worldSeed: number;
  /** Stands a new maze up on a room already rebuilt from `plan`. */
  readonly raise: (plan: BigTopMazePlan) => BigTopMazeSystem;
}

/**
 * Puts a crawler on a mark and stops them dead.
 *
 * The momentum matters as much as the position: a crawler mid-knockback or
 * mid-attack arrives still carrying the frames they left with, and a shove
 * owed from somewhere else would spend itself walking them off the tile they
 * were just put on.
 */
export function placeOnMark(entity: Player, tile: MazeTile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
  entity.knockbackFramesRemaining = 0;
  entity.isMoving = false;
}

/**
 * Deals the tent for `next`, takes the old maze out of the room, rebuilds the
 * room's tiles from the new plan and stands the new maze up on them: every act
 * shut again and the party back at the two flaps. The map is rebuilt in place
 * rather than replaced, because every system in the room already holds it.
 */
export function restartBigTopTent(
  old: BigTopMazeSystem,
  room: BigTopTentRoom,
  next: Difficulty,
): BigTopMazeSystem {
  const plan = planBigTopMaze(room.worldSeed, next);
  // An act card or a burn notice belongs to the show being thrown away.
  room.conversation.close();
  const owned = new Set(old.ownedMobs());
  old.dispose();
  room.roster.replaceAll(room.roster.mobs.filter((mob) => !owned.has(mob)));
  room.roster.rebuildGrid();
  room.map.generateBigTopMaze(plan);
  const maze = room.raise(plan);
  placeOnMark(room.human, MAZE_HUMAN_SPAWN_TILE);
  placeOnMark(room.cat, MAZE_CAT_SPAWN_TILE);
  return maze;
}
