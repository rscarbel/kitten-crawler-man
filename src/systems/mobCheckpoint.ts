/**
 * The mob half of a floor checkpoint: which mobs the floor held when the party
 * reached a safe room, and how to put the roster back that way on a death.
 */

import type { Mob } from '../creatures/Mob';
import type { MobRoster } from './kits/SceneWorld';

/**
 * Records which mobs the floor held, and which of them were alive, so a later
 * restore can tell a kill the player has already banked from one it scored
 * after the safe room.
 */
export function markMobsAtCheckpoint(roster: MobRoster): void {
  for (const mob of roster.mobs) {
    mob.presentAtCheckpoint = true;
    mob.aliveAtCheckpoint = mob.isAlive;
    mob.resurrectedAtCheckpoint = mob.wasResurrected;
  }
}

/**
 * Puts the floor's population back the way the checkpoint found it: anything
 * that arrived after the safe room is dropped, anything killed after it
 * stands back up, and the survivors are reset as they always were. The grid is
 * rebuilt over what is left.
 *
 * Dropping a mob is the one thing a scene otherwise never does — `mobs` is
 * append-only so corpses stay renderable — so the array is rebuilt in place
 * rather than spliced repeatedly, which keeps the cost linear even after a
 * summon-heavy fight has added hundreds of bodies.
 */
export function rewindMobsToCheckpoint(roster: MobRoster): void {
  const kept: Mob[] = [];
  for (const mob of roster.mobs) {
    if (!mob.presentAtCheckpoint) {
      // Summoned, hired or staged after the safe room, so it has no business
      // existing. Disposed because it is leaving the array for good — the
      // other splice sites (bounty abandon, companion despawn, the boss-room
      // roach compaction) owe the same call.
      mob.dispose();
      continue;
    }
    if (!mob.aliveAtCheckpoint && mob.isAlive) {
      // Dead at the checkpoint, then raised by something like a necro's
      // resurrection since — that kill already paid out once, so the rewind
      // must put the body back down rather than let it walk into the reset
      // survivor branch below.
      mob.undoResurrectionForCheckpoint();
      mob.wasResurrected = mob.resurrectedAtCheckpoint;
    } else if (mob.aliveAtCheckpoint && !mob.isAlive) {
      mob.reviveForCheckpoint();
      mob.wasResurrected = mob.resurrectedAtCheckpoint;
    } else if (mob.isAlive) {
      // Whatever raise happened since the checkpoint is undone with the rest
      // of the fight, and one it saw is kept, so the next kill pays exactly
      // when the checkpoint's own next kill would have.
      mob.wasResurrected = mob.resurrectedAtCheckpoint;
      if (mob.resetsFullyOnCheckpoint) {
        mob.resetToSpawn();
      } else {
        // Allies (Mongo, hired mercenaries) aren't spawn-anchored encounters
        // to reposition — their "spawn tile" is wherever they were summoned
        // or hired, not this safe room — but they can take real damage
        // fighting alongside the party and must not stay critically wounded
        // once the party itself is fully healed.
        mob.healAndForgetFight();
      }
    }
    kept.push(mob);
  }
  roster.replaceAll(kept);
  roster.rebuildGrid();
}
