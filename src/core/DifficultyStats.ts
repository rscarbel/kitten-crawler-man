/**
 * Run-scoped counters behind the difficulty rebalance (`docs/difficulty-plan.md`).
 *
 * A singleton rather than a field on {@link GameStats}, and the reason is the
 * whole point of the thing: `GameStats` is rebuilt with its `DungeonScene`, so a
 * party that walks down a stairwell loses everything it counted. The plan's
 * target-feel table is measured across a *run* — floor 1 pre-Hoarder through
 * floor 3 — so the numbers have to outlive the scene that produced them, the
 * same way `perfMonitor` does.
 *
 * Recording is unconditional and costs a few additions per frame; only the
 * dev-only overlay that reads it is stripped from a release build.
 */

/**
 * The stretches of a run the plan's target-feel table is measured over.
 *
 * Floor 1 is split by its two gauntlet bosses because that is where the
 * difficulty curve is supposed to bend — a single "floor 1" number would average
 * the tutorial-adjacent opening together with the post-Juicer free region and
 * say nothing about either.
 */
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
}

type MutableTally = { -readonly [K in keyof SegmentTally]: SegmentTally[K] };

function emptyTally(): MutableTally {
  return {
    damageTaken: 0,
    potionsUsed: 0,
    dodges: 0,
    deaths: 0,
    roomFights: 0,
    hpRemainingSum: 0,
    fightSecondsSum: 0,
  };
}

/**
 * Class names of the two floor-1 gauntlet bosses, as `bossDefeated` reports
 * them. `DungeonScene` emits `mob.constructor.name` for boss-flagged mobs.
 */
const HOARDER_BOSS_TYPE = 'TheHoarder';
const JUICER_BOSS_TYPE = 'Juicer';

const FIRST_FLOOR = 1;
const SECOND_FLOOR = 2;
/** Also the deepest named segment: anything below folds into it. */
const THIRD_FLOOR = 3;

export class DifficultyStats {
  private readonly tallies = new Map<DifficultySegment, MutableTally>();
  private floorNumber = FIRST_FLOOR;
  private hoarderDefeated = false;
  private juicerDefeated = false;

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
    const fresh = emptyTally();
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
   *   engaged mob let go — the plan's "HP remaining after a regular room fight".
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
   * Starts a fresh run's counters.
   *
   * The boss flags matter as much as the tallies: they latch, so a second
   * playthrough in the same page session would begin on floor 1 already
   * classified `floor1-post-juicer` — and the pre-Hoarder baseline the plan asks
   * Phase 0 to capture would be unreachable without reloading the page.
   */
  beginRun(): void {
    this.tallies.clear();
    this.hoarderDefeated = false;
    this.juicerDefeated = false;
    this.floorNumber = FIRST_FLOOR;
  }
}

export const difficultyStats = new DifficultyStats();
