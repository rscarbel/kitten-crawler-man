/**
 * Run-scoped counters used to check the game's difficulty curve against its
 * target feel.
 *
 * A singleton rather than a field on {@link GameStats}, and the reason is the
 * whole point of the thing: `GameStats` is rebuilt with its `DungeonScene`, so a
 * party that walks down a stairwell loses everything it counted. The
 * target-feel table is measured across a *run* — floor 1 pre-Hoarder through
 * floor 3 — so the numbers have to outlive the scene that produced them, the
 * same way `perfMonitor` does.
 *
 * Recording is unconditional and costs a few additions per frame; only the
 * dev-only overlay that reads it is stripped from a release build.
 */

/**
 * The stretches of a run the target-feel table is measured over.
 *
 * Floor 1 is split by its two gauntlet bosses because that is where the
 * difficulty curve is supposed to bend — a single "floor 1" number would average
 * the tutorial-adjacent opening together with the post-Juicer free region and
 * say nothing about either.
 */
import { settings } from './Settings';
import type { Difficulty } from './difficultyProfiles';

export const DIFFICULTY_SEGMENTS = [
  'floor1-pre-hoarder',
  'floor1-post-hoarder',
  'floor1-post-juicer',
  'floor2',
  'floor3',
] as const;

export type DifficultySegment = (typeof DIFFICULTY_SEGMENTS)[number];

/** Everything counted for one segment. */
export interface SegmentTally {
  /**
   * The difficulty active when this segment's tally was first opened.
   * Stamped once rather than read live, so a segment already in progress when
   * the player flips difficulty in the pause menu keeps the label its numbers
   * were actually measured under.
   */
  readonly difficulty: Difficulty;
  /** Total HP the party lost to anything at all. */
  readonly damageTaken: number;
  readonly potionsUsed: number;
  readonly dodges: number;
  readonly deaths: number;
  /** Room fights that ran to completion; see {@link DifficultyStats.recordRoomFight}. */
  readonly roomFights: number;
  /**
   * Summed party-HP fraction remaining at the end of each counted fight, so the
   * overlay can show a mean without keeping every fight's number.
   */
  readonly hpRemainingSum: number;
  /** Summed seconds each counted fight lasted, for the time-to-kill target. */
  readonly fightSecondsSum: number;
  /** Times the party used a stairwell menu to descend while this segment was open. */
  readonly descents: number;
  /**
   * Descents where the party's level was below the next floor's recommended
   * level. See {@link DifficultyStats.recordDescend}.
   */
  readonly descendedUnderleveled: number;
  /** Summed (recommended − party) level gap over just the underlevelled descents. */
  readonly descendedLevelDeltaSum: number;
}

type MutableTally = { -readonly [K in keyof SegmentTally]: SegmentTally[K] };

/** One floor's stairwell hunt while it is still being timed. */
interface OpenHunt {
  floorNumber: number;
  frames: number;
}

/** A point-in-time copy of the stairwell-hunt clock and of the hunts already measured. */
export interface StairwellHuntCheckpoint {
  readonly openHunt: OpenHunt | null;
  readonly huntFramesByFloor: ReadonlyArray<readonly [number, number]>;
}

function emptyTally(difficulty: Difficulty): MutableTally {
  return {
    difficulty,
    damageTaken: 0,
    potionsUsed: 0,
    dodges: 0,
    deaths: 0,
    roomFights: 0,
    hpRemainingSum: 0,
    fightSecondsSum: 0,
    descents: 0,
    descendedUnderleveled: 0,
    descendedLevelDeltaSum: 0,
  };
}

/**
 * Spawn keys of the two floor-1 gauntlet bosses, as `bossDefeated` reports
 * them — the same names the level definitions and the boss music use.
 */
const HOARDER_BOSS_TYPE = 'the_hoarder';
const JUICER_BOSS_TYPE = 'juicer';

const FIRST_FLOOR = 1;
const SECOND_FLOOR = 2;
/** Also the deepest named segment: anything below folds into it. */
const THIRD_FLOOR = 3;

export class DifficultyStats {
  private readonly tallies = new Map<DifficultySegment, MutableTally>();
  private floorNumber = FIRST_FLOOR;
  private hoarderDefeated = false;
  private juicerDefeated = false;

  /** Completed stairwell-hunt lengths, in frames, keyed by floor number. */
  private readonly huntFramesByFloor = new Map<number, number>();
  /** The hunt clock in progress, if the floor's last gauntlet boss has died but no stairwell has been found yet. */
  private openHunt: OpenHunt | null = null;

  /**
   * Which stretch of the run subsequent records belong to.
   *
   * Derived rather than stored, so a boss killed mid-floor moves the boundary
   * on the very next damage tick with nothing to keep in sync.
   */
  get segment(): DifficultySegment {
    if (this.floorNumber >= THIRD_FLOOR) return 'floor3';
    if (this.floorNumber === SECOND_FLOOR) return 'floor2';
    if (this.juicerDefeated) return 'floor1-post-juicer';
    if (this.hoarderDefeated) return 'floor1-post-hoarder';
    return 'floor1-pre-hoarder';
  }

  /** Called on scene entry so the counters know which floor they are on. */
  setFloor(floorNumber: number): void {
    this.floorNumber = floorNumber;
  }

  /** Called from the `bossDefeated` handler; unknown boss types are ignored. */
  noteBossDefeated(bossType: string): void {
    if (bossType === HOARDER_BOSS_TYPE) this.hoarderDefeated = true;
    if (bossType === JUICER_BOSS_TYPE) this.juicerDefeated = true;
  }

  private current(): MutableTally {
    const segment = this.segment;
    const existing = this.tallies.get(segment);
    if (existing !== undefined) return existing;
    const fresh = emptyTally(settings.difficulty);
    this.tallies.set(segment, fresh);
    return fresh;
  }

  recordDamageTaken(amount: number): void {
    if (amount <= 0) return;
    this.current().damageTaken += amount;
  }

  recordPotionUsed(): void {
    this.current().potionsUsed++;
  }

  recordDodge(): void {
    this.current().dodges++;
  }

  recordDeath(): void {
    this.current().deaths++;
  }

  /**
   * One completed room fight.
   *
   * @param hpRemainingFraction Party HP over party max HP the moment the last
   *   engaged mob let go — "HP remaining after a regular room fight".
   * @param seconds How long the fight ran, for the time-to-kill target.
   */
  recordRoomFight(hpRemainingFraction: number, seconds: number): void {
    const tally = this.current();
    tally.roomFights++;
    tally.hpRemainingSum += hpRemainingFraction;
    tally.fightSecondsSum += seconds;
  }

  /** The tally for one segment, or null when nothing has happened in it yet. */
  tallyFor(segment: DifficultySegment): SegmentTally | null {
    return this.tallies.get(segment) ?? null;
  }

  /**
   * Opens the stairwell-hunt clock for the current floor. Called when the
   * floor's last gauntlet boss dies. A no-op if a hunt is already open, so a
   * floor whose last gauntlet boss somehow reports defeated twice can't
   * restart the clock partway through the hunt.
   */
  startStairwellHunt(): void {
    if (this.openHunt !== null) return;
    this.openHunt = { floorNumber: this.floorNumber, frames: 0 };
  }

  /**
   * Advances the open hunt clock by one frame. Cheap and safe to call every
   * gameplay frame regardless of whether a hunt is open.
   */
  tickStairwellHunt(): void {
    if (this.openHunt !== null) this.openHunt.frames++;
  }

  /**
   * Closes the stairwell-hunt clock on the floor's first stairwell find. A
   * no-op if no hunt is open — a floor with no gauntlet, or a stairwell found
   * before any boss died, never started one.
   */
  finishStairwellHunt(): void {
    if (this.openHunt === null) return;
    this.huntFramesByFloor.set(this.openHunt.floorNumber, this.openHunt.frames);
    this.openHunt = null;
  }

  /**
   * The hunt clock, and only the hunt clock, as a checkpoint can put it back.
   *
   * The rest of this object is deliberately not snapshotted: the damage and the
   * fights it counts happened, and a death is the strongest datum of all. The
   * hunt clock is the exception because it measures a *stretch of the floor*
   * rather than an event, and a checkpoint restore rewinds that stretch — the
   * gauntlet boss goes back to alive and has to be re-killed. Left running, the
   * clock would bill the death, the respawn and the re-fight to a hunt the
   * player had not yet started, and the re-kill cannot fix it because reopening
   * an already-open hunt is a no-op.
   *
   * Kept in step with `StairwellSystem`'s Wayfinder clock, which the same boss
   * kill arms and which rewinds the same way: the two are meant to describe the
   * same hunt.
   */
  captureStairwellHunt(): StairwellHuntCheckpoint {
    return {
      openHunt: this.openHunt === null ? null : { ...this.openHunt },
      huntFramesByFloor: [...this.huntFramesByFloor],
    };
  }

  restoreStairwellHunt(snapshot: StairwellHuntCheckpoint): void {
    this.openHunt = snapshot.openHunt === null ? null : { ...snapshot.openHunt };
    this.huntFramesByFloor.clear();
    for (const [floorNumber, frames] of snapshot.huntFramesByFloor) {
      this.huntFramesByFloor.set(floorNumber, frames);
    }
  }

  /** Frames from the last gauntlet boss's death to the first stairwell found, or null if not yet measured. */
  stairwellHuntFramesFor(floorNumber: number): number | null {
    return this.huntFramesByFloor.get(floorNumber) ?? null;
  }

  /**
   * One stairwell descent, for the current segment's tally.
   *
   * `recommendedLevel` is null until a floor exposes its own recommended
   * party level; passing null always counts the descent without judging it,
   * so a caller that gains a real recommended level later needs no change
   * here beyond passing it.
   */
  recordDescend(partyLevel: number, recommendedLevel: number | null): void {
    const tally = this.current();
    tally.descents++;
    if (recommendedLevel === null || partyLevel >= recommendedLevel) return;
    tally.descendedUnderleveled++;
    tally.descendedLevelDeltaSum += recommendedLevel - partyLevel;
  }

  /**
   * Starts a fresh run's counters.
   *
   * The boss flags matter as much as the tallies: they latch, so a second
   * playthrough in the same page session would begin on floor 1 already
   * classified `floor1-post-juicer` — and the pre-Hoarder baseline this is
   * meant to capture would be unreachable without reloading the page.
   */
  beginRun(): void {
    this.tallies.clear();
    this.hoarderDefeated = false;
    this.juicerDefeated = false;
    this.floorNumber = FIRST_FLOOR;
    this.huntFramesByFloor.clear();
    this.openHunt = null;
  }
}

export const difficultyStats = new DifficultyStats();
