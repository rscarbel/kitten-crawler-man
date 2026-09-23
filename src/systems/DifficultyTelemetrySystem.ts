import type { GameSystem, SystemContext } from './GameSystem';
import { difficultyStats } from '../core/DifficultyStats';
import type { StairwellHuntCheckpoint } from '../core/DifficultyStats';
import { isEngagedInFight } from '../creatures/tactics/tacticalFrame';
import { drainTacticsTelemetry } from '../creatures/tactics/tacticsTelemetry';

/**
 * Feeds the per-frame half of {@link difficultyStats}: damage the party actually
 * took, where each room fight left its health, the tactics counters (blocks,
 * kites) that fight produced, whether a trait-bearing mob fought in it, and the
 * stairwell-hunt clock's tick.
 *
 * The event-driven half (potions, dodges, deaths, boss kills, hunt clock
 * start/stop) is wired in `DungeonScene.wireEventBus` beside the existing
 * `GameStats` lines — there is no reason for this system to hold a bus just to
 * forward a handful of events.
 */

/**
 * How long every engaged mob has to stay disengaged before a fight is called
 * over. Long enough to bridge a goblin losing line of sight round a pillar, and
 * short enough that the next room's fight is a separate data point.
 */
export const FIGHT_END_GRACE_FRAMES = 120;

/**
 * Fights shorter than this are not counted. A mob that noticed the party across
 * a room and was killed before it arrived is not a room fight, and averaging it
 * in would report the floor as far easier than it plays.
 */
export const MIN_COUNTED_FIGHT_FRAMES = 60;

const FRAMES_PER_SECOND = 60;

/** A point-in-time copy of the fight currently being measured, and of the stairwell-hunt clock. */
export interface DifficultyTelemetryCheckpoint {
  engagedFrames: number;
  idleFrames: number;
  inFight: boolean;
  fightBlocks: number;
  fightKiteStarts: number;
  fightKiteEnds: number;
  fightKiteFrames: number;
  fightHasTraitMob: boolean;
  stairwellHunt: StairwellHuntCheckpoint;
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

  /** Tactics counters accumulated over the fight in progress; see {@link trackFight}. */
  private fightBlocks = 0;
  private fightKiteStarts = 0;
  private fightKiteEnds = 0;
  private fightKiteFrames = 0;
  /** Whether any mob that fought this fight had rolled a tactics trait. */
  private fightHasTraitMob = false;

  /**
   * The tactics sink is module-wide, and only this system drains it. Guards
   * and kites noted while no such system was running (a building interior, a
   * torn-down scene) belong to no fight here, so they are discarded rather
   * than handed to whichever fight this system happens to be tracking first.
   */
  constructor() {
    drainTacticsTelemetry();
  }

  /**
   * Snapshots the in-progress fight, plus the one part of `difficultyStats` a
   * checkpoint rewinds. Everything else recorded there stays: those fights are
   * real data about how the floor plays, and a death is the strongest datum of
   * all.
   *
   * The fight the player died in, though, was never finished — without this,
   * `inFight` stays true across the restore and the next room's engagement is
   * measured from a frame count accumulated before the player respawned. The
   * stairwell-hunt clock rides along for the same reason, and this system
   * carries it because this system is what ticks it.
   */
  captureCheckpoint(): DifficultyTelemetryCheckpoint {
    return {
      engagedFrames: this.engagedFrames,
      idleFrames: this.idleFrames,
      inFight: this.inFight,
      fightBlocks: this.fightBlocks,
      fightKiteStarts: this.fightKiteStarts,
      fightKiteEnds: this.fightKiteEnds,
      fightKiteFrames: this.fightKiteFrames,
      fightHasTraitMob: this.fightHasTraitMob,
      stairwellHunt: difficultyStats.captureStairwellHunt(),
    };
  }

  restoreCheckpoint(snapshot: DifficultyTelemetryCheckpoint): void {
    this.engagedFrames = snapshot.engagedFrames;
    this.idleFrames = snapshot.idleFrames;
    this.inFight = snapshot.inFight;
    this.fightBlocks = snapshot.fightBlocks;
    this.fightKiteStarts = snapshot.fightKiteStarts;
    this.fightKiteEnds = snapshot.fightKiteEnds;
    this.fightKiteFrames = snapshot.fightKiteFrames;
    this.fightHasTraitMob = snapshot.fightHasTraitMob;
    difficultyStats.restoreStairwellHunt(snapshot.stairwellHunt);
    // A restore can reopen a fight, so anything noted between the capture and
    // now must not be folded into it.
    drainTacticsTelemetry();
  }

  update(ctx: SystemContext): void {
    difficultyStats.recordDamageTaken(ctx.human.pendingDamageTaken);
    difficultyStats.recordDamageTaken(ctx.cat.pendingDamageTaken);
    ctx.human.pendingDamageTaken = 0;
    ctx.cat.pendingDamageTaken = 0;

    difficultyStats.tickStairwellHunt();
    this.trackFight(ctx);
  }

  /**
   * True while at least one living mob has one of the crawlers in its sights —
   * the fight start/end definition, unchanged. A trait-bearing *participant*
   * is judged by the stricter {@link isEngagedInFight} (drawn blood or taken a
   * hit), not by this `currentTarget` check alone: a mob that has merely
   * noticed the party has not fought them, and counting it would blame a
   * trait for a fight it never touched.
   */
  private anyMobEngaged(ctx: SystemContext): boolean {
    let engaged = false;
    for (const mob of ctx.roster.mobs) {
      if (!mob.isAlive) continue;
      const target = mob.currentTarget;
      if (target !== ctx.human && target !== ctx.cat) continue;
      engaged = true;
      if (isEngagedInFight(mob) && mob.hasActiveTactics) this.fightHasTraitMob = true;
    }
    return engaged;
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

    // Drained every frame regardless of fight state, so the sink itself never
    // piles up — but only folded into the fight in progress. A block or kite
    // outside `inFight` (a sneak hit on a mob that has not yet noticed, or the
    // dead time between fights) is discarded here rather than left to land on
    // whatever fight happens to close next.
    const tactics = drainTacticsTelemetry();
    if (this.inFight) {
      this.fightBlocks += tactics.guardBlocks;
      this.fightKiteStarts += tactics.kiteStarts;
      this.fightKiteEnds += tactics.kiteEnds;
      this.fightKiteFrames += tactics.kiteFrames;
    }

    if (!this.inFight || this.idleFrames < FIGHT_END_GRACE_FRAMES) return;

    if (this.engagedFrames >= MIN_COUNTED_FIGHT_FRAMES) {
      const partyHp = ctx.human.hp + ctx.cat.hp;
      const partyMaxHp = ctx.human.maxHp + ctx.cat.maxHp;
      difficultyStats.recordRoomFight({
        hpRemainingFraction: partyMaxHp > 0 ? partyHp / partyMaxHp : 0,
        seconds: this.engagedFrames / FRAMES_PER_SECOND,
        blocks: this.fightBlocks,
        kiteStarts: this.fightKiteStarts,
        kiteEnds: this.fightKiteEnds,
        kiteFramesSum: this.fightKiteFrames,
        hadTraitMob: this.fightHasTraitMob,
      });
    }
    this.inFight = false;
    this.engagedFrames = 0;
    this.idleFrames = 0;
    this.fightBlocks = 0;
    this.fightKiteStarts = 0;
    this.fightKiteEnds = 0;
    this.fightKiteFrames = 0;
    this.fightHasTraitMob = false;
  }
}
