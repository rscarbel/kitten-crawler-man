import type { GameSystem, SystemContext } from './GameSystem';
import { difficultyStats } from '../core/DifficultyStats';

/**
 * Feeds the per-frame half of {@link difficultyStats}: damage the party actually
 * took, and where each room fight left its health.
 *
 * The event-driven half (potions, dodges, deaths, boss kills) is wired in
 * `DungeonScene.wireEventBus` beside the existing `GameStats` lines — there is
 * no reason for this system to hold a bus just to forward four events.
 */

/**
 * How long every engaged mob has to stay disengaged before a fight is called
 * over. Long enough to bridge a goblin losing line of sight round a pillar, and
 * short enough that the next room's fight is a separate data point.
 */
const FIGHT_END_GRACE_FRAMES = 120;

/**
 * Fights shorter than this are not counted. A mob that noticed the party across
 * a room and was killed before it arrived is not a room fight, and averaging it
 * in would report the floor as far easier than it plays.
 */
const MIN_COUNTED_FIGHT_FRAMES = 60;

const FRAMES_PER_SECOND = 60;

/** A point-in-time copy of the fight currently being measured. */
export interface DifficultyTelemetryCheckpoint {
  engagedFrames: number;
  idleFrames: number;
  inFight: boolean;
}

export class DifficultyTelemetrySystem implements GameSystem {
  /**
   * Frames of the current fight on which something was actually engaged.
   *
   * Counted rather than subtracted out at the end: a fight has as many lulls as
   * the room has pillars, and each of them is short of the grace window, so
   * taking the fight's wall-clock length and removing only the final gap would
   * report every one of those lulls as combat. That number feeds the
   * time-to-kill target this telemetry tracks, so it would read high in
   * exactly the direction that makes the game look harder than it is.
   */
  private engagedFrames = 0;
  private idleFrames = 0;
  private inFight = false;

  /**
   * Snapshots the in-progress fight only. `difficultyStats` is deliberately left
   * alone: the fights already recorded there are real data about how the floor
   * plays, and a death is the strongest datum of all.
   *
   * The fight the player died in, though, was never finished — without this,
   * `inFight` stays true across the restore and the next room's engagement is
   * measured from a frame count accumulated before the player respawned.
   */
  captureCheckpoint(): DifficultyTelemetryCheckpoint {
    return {
      engagedFrames: this.engagedFrames,
      idleFrames: this.idleFrames,
      inFight: this.inFight,
    };
  }

  restoreCheckpoint(snapshot: DifficultyTelemetryCheckpoint): void {
    this.engagedFrames = snapshot.engagedFrames;
    this.idleFrames = snapshot.idleFrames;
    this.inFight = snapshot.inFight;
  }

  update(ctx: SystemContext): void {
    difficultyStats.recordDamageTaken(ctx.human.pendingDamageTaken);
    difficultyStats.recordDamageTaken(ctx.cat.pendingDamageTaken);
    ctx.human.pendingDamageTaken = 0;
    ctx.cat.pendingDamageTaken = 0;

    this.trackFight(ctx);
  }

  /** True while at least one living mob has one of the crawlers in its sights. */
  private anyMobEngaged(ctx: SystemContext): boolean {
    for (const mob of ctx.mobs) {
      if (!mob.isAlive) continue;
      const target = mob.currentTarget;
      if (target === ctx.human || target === ctx.cat) return true;
    }
    return false;
  }

  private trackFight(ctx: SystemContext): void {
    const engaged = this.anyMobEngaged(ctx);
    if (engaged) {
      this.idleFrames = 0;
      this.inFight = true;
      this.engagedFrames++;
    } else if (this.inFight) {
      this.idleFrames++;
    }

    if (!this.inFight || this.idleFrames < FIGHT_END_GRACE_FRAMES) return;

    if (this.engagedFrames >= MIN_COUNTED_FIGHT_FRAMES) {
      const partyHp = ctx.human.hp + ctx.cat.hp;
      const partyMaxHp = ctx.human.maxHp + ctx.cat.maxHp;
      difficultyStats.recordRoomFight(
        partyMaxHp > 0 ? partyHp / partyMaxHp : 0,
        this.engagedFrames / FRAMES_PER_SECOND,
      );
    }
    this.inFight = false;
    this.engagedFrames = 0;
    this.idleFrames = 0;
  }
}
