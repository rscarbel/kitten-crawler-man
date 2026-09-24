/**
 * The necro fairy, through its real AI, `FairySystem`, `SkeletonSummonSystem`
 * and the real kill resolution.
 *
 * - One raise stands up every eligible corpse in reach on its release frame,
 *   however long ago it fell, with no limit per life — never a boss, a summon,
 *   a fairy, or one out of range or sight, and never the same mob twice. A
 *   raised mob's second death pays nothing. A corpse that has left the mob
 *   list, or a boss's add, is never raised.
 * - A checkpoint rewind keeps a raise the checkpoint saw and undoes one it did not.
 * - Its army is two sword skeletons and one archer, called when a crawler comes
 *   within `NECRO_SUMMON_TRIGGER_TILES`, climbing out on the release frame and
 *   never exceeded. Down to its last skeleton it refills after
 *   `NECRO_RESUMMON_LAST_STANDING_FRAMES`; wiped out, within the after-wipe
 *   band; down one of three, not at all. Its skeletons pay nothing.
 * - The telekinetic wave bursts on the frame a crawler comes within
 *   `TK_TRIGGER_RADIUS_TILES`, shoves without damage or status, straight away
 *   from where the necro hangs on that frame, and never through a wall; it is
 *   refused for `TK_COOLDOWN_FRAMES` after each release, the same at level 1
 *   and the maximum.
 * - The necro keeps flying through every cast: it never stands still to cast.
 * - Its death raises 4 swords and 2 archers on easy and normal, 7 and 3 on
 *   hard, by the difficulty stamped at spawn, which pay nothing; a corridor too
 *   narrow for them all still raises the whole army.
 * - Every skeleton it raises, summoned or left on its death, is a lesser one:
 *   at `necroSkeletonLevel` of the fairy's level and `NECRO_SKELETON_STRENGTH`
 *   of a skeleton's authored HP and bite.
 * - It raises and summons only while it is inside the published camera view:
 *   off screen it does neither, on screen it does on the first frame, and an
 *   army refill that came due off screen is held and called the first frame
 *   it is back in view.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { Difficulty } from '../../src/core/difficultyProfiles';
import { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import { RisingSkeleton } from '../../src/creatures/RisingSkeleton';
import { SkeletonWarrior } from '../../src/creatures/SkeletonWarrior';
import { SkeletonArcher } from '../../src/creatures/SkeletonArcher';
import type { SkeletonSummonRequest } from '../../src/creatures/SkeletonLord';
import type { LevelledCurve } from '../../src/creatures/mobLevelScaling';
import type {
  ActiveFairyCast,
  FairyCast,
  FairyCastIntent,
} from '../../src/creatures/fairies/Fairy';
import {
  NecroFairy,
  NECRO_RESURRECT_CAST,
  NECRO_SUMMON_CAST,
  NECRO_TELEKINETIC_CAST,
} from '../../src/creatures/fairies/NecroFairy';
import { necroSkeletonLevel } from '../../src/creatures/fairies/fairyPotency';
import {
  NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES,
  NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES,
  NECRO_RESUMMON_LAST_STANDING_FRAMES,
  NECRO_SKELETON_STRENGTH,
  NECRO_SUMMON_TRIGGER_TILES,
  RESURRECT_RANGE_TILES,
  TK_COOLDOWN_FRAMES,
  TK_KNOCKBACK_FRAMES,
  TK_KNOCKBACK_TILES,
  TK_RADIUS_TILES,
  TK_TRIGGER_RADIUS_TILES,
} from '../../src/creatures/fairies/fairyTuning';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { applyKnockbackMotion, applyMovement } from '../../src/systems/GameLoopPhases';
import { setPackAlertGrid } from '../../src/creatures/packAlert';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../../src/systems/mobCheckpoint';
import type { FairyGateReport } from './report';
import { DIFFICULTIES } from './spawnTables';
import {
  PARK_TILE,
  WHOLE_ARENA_VIEW,
  buildStage,
  placeOnTile,
  withDodgesOff,
  type Stage,
  type TileSpec,
} from './stage';
import { setVisibleWorldView, type VisibleWorldView } from '../../src/core/visibleWorldView';

const NECRO_TILE = 10;
/** A crawler this far off is noticed but outside the wave's trigger: a fight on, nobody to shove. */
const FIGHT_OFFSET_TILES = 5;
/** How far east of the necro the sight-blocking wall column stands. */
const WALL_COLUMN_OFFSET_TILES = 4;
/** A wall column east of the necro, rows around it, for the sight cases. */
const WALL_COLUMN = NECRO_TILE + WALL_COLUMN_OFFSET_TILES;
/** Rows either side of the necro's own that a sight-blocking wall column spans. */
const WALL_HALF_SPAN_ROWS = 1;
const WALL_ROWS: readonly number[] = [
  NECRO_TILE - WALL_HALF_SPAN_ROWS,
  NECRO_TILE,
  NECRO_TILE + WALL_HALF_SPAN_ROWS,
];
/** Tiles off the necro an ally or corpse stands at: inside every reach, clear of its own tile. */
const NEIGHBOR_OFFSET_TILES = 2;
/** How far past the sight-blocking wall column the hidden corpse lies. */
const BEHIND_WALL_TILES = 1;
/** How many times its raise range the far corpse lies off, to be plainly out of reach. */
const OUT_OF_RANGE_FACTOR = 2;
/** Rows below the necro the far corpse lies, clear of the wall column's rows. */
const FAR_CORPSE_ROW_OFFSET_TILES = 6;
/** How long the old corpse lies dead before the necro sees it: a minute, far past any freshness window. */
const OLD_CORPSE_AGE_FRAMES = 3600;
/** Where the first batch of corpses falls, in tiles off the necro: all inside its raise range. */
const FIRST_BATCH_OFFSETS: readonly TileSpec[] = [
  [NEIGHBOR_OFFSET_TILES, 0],
  [-NEIGHBOR_OFFSET_TILES, 0],
  [0, NEIGHBOR_OFFSET_TILES],
  [0, -NEIGHBOR_OFFSET_TILES],
  [NEIGHBOR_OFFSET_TILES, NEIGHBOR_OFFSET_TILES],
];
/** Where the second batch falls, after the first has been raised. */
const SECOND_BATCH_OFFSETS: readonly TileSpec[] = [
  [-NEIGHBOR_OFFSET_TILES, -NEIGHBOR_OFFSET_TILES],
  [NEIGHBOR_OFFSET_TILES, -NEIGHBOR_OFFSET_TILES],
  [-NEIGHBOR_OFFSET_TILES, NEIGHBOR_OFFSET_TILES],
];
/** The army a living necro fields, as the design sets it; held apart from `NECRO_ARMY` so a retune cannot pass silently. */
const EXPECTED_ARMY = { sword: 2, archer: 1 } as const;
/** The army a necro's death leaves, by difficulty, as the design sets it. */
const EXPECTED_DEATH_ARMY: Readonly<Record<Difficulty, { sword: number; archer: number }>> = {
  easy: { sword: 4, archer: 2 },
  normal: { sword: 4, archer: 2 },
  hard: { sword: 7, archer: 3 },
};
/**
 * The army's strength reaches the fairy through `SkeletonSummonSystem`, which
 * runs after the fairy in a frame, so a kill is seen a frame late.
 */
const ARMY_REPORT_LATENCY_FRAMES = 1;
/** Frames an army down one of three is watched for a refill that must not come. */
const TWO_LEFT_WATCH_FRAMES = 400;
/** Frames given for the last-standing refill: its delay, and a second's slack to show a late one. */
const LAST_STANDING_WATCH_FRAMES = 360;
/** Frames given for the after-wipe summon: the band's top, and a second's slack. */
const WIPE_WATCH_FRAMES = 270;
/** Full wipes the army run stages, so the rolled delay is sampled more than once. */
const WIPE_TRIALS = 4;
/** The fixed summon cooldown the slow negative waits out, far past either delay. */
const FIXED_SUMMON_COOLDOWN_PROBE_FRAMES = 720;
/** A crawler this far off is noticed, but past the summon trigger. */
const PAST_TRIGGER_OFFSET_TILES = NECRO_SUMMON_TRIGGER_TILES + 1;
/** Half the side of the walled block the corridor case cuts: one tile past the summon system's widest ring. */
const CORRIDOR_HALF_SPAN_TILES = 6;
/** Wave cooldowns the TK run spans, so a second release shows. */
const TK_RUN_COOLDOWNS = 2;
/** Frames past the knockback's own length a shove is played out, so it has come to rest. */
const KNOCKBACK_SETTLE_FRAMES = 2;
/** The share of its real cooldown the impatient negative waits. */
const IMPATIENT_COOLDOWN_SHARE = 0.5;
/** Where the crawler presses in for the wave runs: a tile east, inside the wave. */
const PRESSING_OFFSET_TILES = 1;
/** For the walled wave case: a wall a tile east of the necro, and the crawler just past it. */
const SEALING_WALL_OFFSET_TILES = 1;
const SEALED_CRAWLER_OFFSET_TILES = 2;
/** Frames a necro is watched for a cast. */
const CAST_WATCH_FRAMES = 200;
/** Frames granted for a death's raise to rise and a summon system tick to drain it. */
const DEATH_RAISE_FRAMES = 2;
/** Frames the raised skeletons are run before being killed, so each finishes rising. */
const RISE_FRAMES = 200;
/** A necro level high enough that its skeletons' level step and HP share both show. */
const LESSER_CHECK_LEVEL = 11;
/** Frames a levelled necro with a fight on is given to land its first summon. */
const FIRST_SUMMON_WATCH_FRAMES = 300;
/** Levels sampled for the death army, which is the same at every one. */
const DEATH_ARMY_LEVELS = [1, MAX_MOB_LEVEL];
/** A shove that carries at least this share of its full distance counts as the full shove. */
const SHOVE_SHARE = 0.8;
/** Extra frames after two cooldowns for the TK run, so a second release fits. */
const TK_RUN_SLACK_FRAMES = 60;
/** Frames the delayed probes hold a cast's effect back after releasing it. */
const LATE_CAST_FRAMES = 30;
/** The blow the hurting probe's wave lands on everyone it shoves. */
const WAVE_PROBE_DAMAGE = 1;
/** How far east of the necro the off-centre probe's wave bursts from: past the crawler it shoves. */
const OFF_CENTRE_WAVE_TILES = 2;
/**
 * The least cosine between a shove and the line from the necro's centre to
 * the crawler for the shove to count as straight away from it: a few degrees
 * of slack for the knockback's own rounding.
 */
const SHOVE_ALIGNMENT_MIN_COSINE = 0.99;
const COSINE_DECIMALS = 3;
/** How far east of the necro the chasing crawler starts: outside the trigger, inside notice. */
const CHASE_START_OFFSET_TILES = 6;
/** Frames the chase runs: two wave cooldowns and change, so casts come and go. */
const CHASE_FRAMES = TK_COOLDOWN_FRAMES * TK_RUN_COOLDOWNS + TK_RUN_SLACK_FRAMES;
/** Movement under this many pixels in a frame is rounding, not flight. */
const MOVE_EPSILON_PX = 0.01;
/** Tiles off the necro the corpses in the guard and rewind cases fall, inside its raise range. */
const CORPSE_OFFSET_TILES = 1;
/**
 * How far the bystanding crawler stands past, or short of, the wave's radius:
 * enough to sit clearly on one side of the edge, too little to matter to the
 * wave's shape.
 */
const WAVE_EDGE_MARGIN_PX = 2;
/** Frames a skeleton is given to finish rising, close and land its first blow. */
const BITE_WATCH_FRAMES = 400;
/** The bite share of a skeleton raised at full strength. */
const FULL_BITE_SHARE = 1;
const BITE_DECIMALS = 2;
/** The top-left tile, on both axes, of a camera view that shows none of the necro's corner. */
const OFF_SCREEN_VIEW_TILE = 20;
/** Side of that view, in tiles. */
const OFF_SCREEN_VIEW_SIDE_TILES = 8;
const OFF_SCREEN_VIEW: VisibleWorldView = {
  left: OFF_SCREEN_VIEW_TILE * TILE_SIZE,
  top: OFF_SCREEN_VIEW_TILE * TILE_SIZE,
  width: OFF_SCREEN_VIEW_SIDE_TILES * TILE_SIZE,
  height: OFF_SCREEN_VIEW_SIDE_TILES * TILE_SIZE,
  sight: null,
};
/** Frames a necro is left off screen: longer than any army refill could wait. */
const OFF_SCREEN_WATCH_FRAMES = NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES * 2;
/**
 * Frames granted from the necro coming into view to the cast: a raise off
 * cooldown, a first summon and a refill already due have nothing to wait for.
 */
const SEEN_TO_CAST_FRAMES = 1;

function necroStage(walls: readonly TileSpec[] = []) {
  const stage = buildStage(walls);
  const addNecro = (tileX: number, tileY: number, make?: (x: number, y: number) => NecroFairy) => {
    const mob = make === undefined ? stage.add('fairy_necro', tileX, tileY) : make(tileX, tileY);
    if (!(mob instanceof NecroFairy)) throw new Error('fairy_necro is not a NecroFairy');
    if (make !== undefined) {
      mob.setMap(stage.map);
      stage.roster.add(mob);
    }
    return mob;
  };
  /** One world frame: the necro thinks and is shoved, the fairy system drains raises, skeletons rise. */
  const step = (necro: NecroFairy, runSummons = false): void => {
    necro.updateAI(stage.party());
    necro.advanceKnockback();
    stage.fairies.update(stage.ctx());
    if (runSummons) stage.summons.update(stage.ctx());
  };
  return { ...stage, addNecro, step };
}

type NecroStage = ReturnType<typeof necroStage>;

interface CastRelease {
  readonly castId: string;
  readonly frame: number;
  readonly target: ActiveFairyCast['target'];
  /** Whether the target was a mob standing by the end of the release frame. */
  readonly targetStanding: boolean;
  /** Raised skeletons that climbed out over the release frame. */
  readonly skeletonsRisen: number;
}

const livingSkeletons = (mobs: readonly Mob[]): number =>
  mobs.filter((mob) => mob instanceof RisingSkeleton && mob.isAlive).length;

/**
 * Every cast `necro` releases over `frames` runs of `run`, each read at the end
 * of the frame it was released on. A release lasts a single frame, so a cast
 * seen in its release phase is always a new one.
 */
function castReleases(
  necro: NecroFairy,
  mobs: () => readonly Mob[],
  run: () => void,
  frames: number,
): CastRelease[] {
  const releases: CastRelease[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const skeletonsBefore = livingSkeletons(mobs());
    run();
    const active = necro.activeCast;
    if (active?.phase !== 'release') continue;
    const target = active.target;
    releases.push({
      castId: active.cast.id,
      frame,
      target,
      targetStanding: target instanceof Mob && target.isAlive,
      skeletonsRisen: livingSkeletons(mobs()) - skeletonsBefore,
    });
  }
  return releases;
}

const raisedAny = (releases: readonly CastRelease[]): boolean =>
  releases.some((release) => release.castId === NECRO_RESURRECT_CAST.id);

const castIds = (releases: readonly CastRelease[]): string =>
  releases.map((release) => release.castId).join(',') || 'no casts';

/**
 * A necro whose raises and summons take effect {@link LATE_CAST_FRAMES} after
 * their release frame instead of on it.
 */
class LateCastNecro extends NecroFairy {
  private readonly held: { framesLeft: number; corpse: Mob | null }[] = [];

  protected override onCastReleased(active: ActiveFairyCast): void {
    if (active.cast === NECRO_RESURRECT_CAST && active.target instanceof Mob) {
      this.held.push({ framesLeft: LATE_CAST_FRAMES, corpse: active.target });
      return;
    }
    if (active.cast === NECRO_SUMMON_CAST) {
      this.held.push({ framesLeft: LATE_CAST_FRAMES, corpse: null });
      return;
    }
    super.onCastReleased(active);
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    for (const entry of this.held) entry.framesLeft--;
    for (const entry of this.held.filter((held) => held.framesLeft <= 0)) {
      if (entry.corpse === null) this.queueSkeletonSummon();
      else this.queueResurrection(entry.corpse);
    }
    const waiting = this.held.filter((held) => held.framesLeft > 0);
    this.held.length = 0;
    this.held.push(...waiting);
  }
}

const makeLateCastNecro = (x: number, y: number): NecroFairy => new LateCastNecro(x, y, TILE_SIZE);

/** A necro that only raises the corpses in `recent`: a raiser whose corpses age out. */
class WindowedNecro extends NecroFairy {
  readonly recent = new Set<Mob>();

  protected override queueResurrection(corpse: Mob): void {
    if (this.recent.has(corpse)) super.queueResurrection(corpse);
  }
}

const makeWindowedNecro = (x: number, y: number): NecroFairy => new WindowedNecro(x, y, TILE_SIZE);

interface EligibilityRun {
  readonly releases: readonly CastRelease[];
  /** A boss, a summon, a fairy, a corpse out of range and one out of sight. */
  readonly ineligible: readonly Mob[];
  /** An ordinary goblin in reach, dead for {@link OLD_CORPSE_AGE_FRAMES}. */
  readonly old: Mob;
}

function eligibilityRun(make?: (x: number, y: number) => NecroFairy): EligibilityRun {
  const walls: TileSpec[] = WALL_ROWS.map((y) => [WALL_COLUMN, y]);
  const s = necroStage(walls);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.escortAtCap = true;
  const boss = s.add(
    'goblin',
    NECRO_TILE + CORPSE_OFFSET_TILES,
    NECRO_TILE + NEIGHBOR_OFFSET_TILES,
  );
  boss.isBoss = true;
  const summon = s.add(
    'goblin',
    NECRO_TILE - CORPSE_OFFSET_TILES,
    NECRO_TILE + NEIGHBOR_OFFSET_TILES,
  );
  summon.isSummon = true;
  const fairy = s.add(
    'fairy_shield',
    NECRO_TILE + NEIGHBOR_OFFSET_TILES,
    NECRO_TILE - NEIGHBOR_OFFSET_TILES,
  );
  const far = s.add(
    'goblin',
    NECRO_TILE + RESURRECT_RANGE_TILES * OUT_OF_RANGE_FACTOR,
    NECRO_TILE + FAR_CORPSE_ROW_OFFSET_TILES,
  );
  const walled = s.add('goblin', WALL_COLUMN + BEHIND_WALL_TILES, NECRO_TILE);
  const old = s.add('goblin', NECRO_TILE - CORPSE_OFFSET_TILES, NECRO_TILE - NEIGHBOR_OFFSET_TILES);
  s.kill(old);
  for (let frame = 0; frame < OLD_CORPSE_AGE_FRAMES; frame++) s.fairies.update(s.ctx());
  const ineligible = [boss, summon, fairy, far, walled];
  for (const mob of ineligible) s.kill(mob);
  if (necro instanceof WindowedNecro) for (const mob of ineligible) necro.recent.add(mob);
  s.fairies.update(s.ctx());
  const releases = castReleases(
    necro,
    () => s.roster.mobs,
    () => s.step(necro),
    CAST_WATCH_FRAMES,
  );
  return { releases, ineligible, old };
}

function checkResurrectEligibility(report: FairyGateReport): void {
  const { releases, ineligible, old } = eligibilityRun();
  report.check(
    ineligible.every((mob) => !mob.isAlive),
    'a boss, a summon, a fairy, and a corpse out of range or sight are never raised',
    castIds(releases),
  );
  report.check(
    old.isAlive && old.wasResurrected,
    `a goblin dead for ${OLD_CORPSE_AGE_FRAMES} frames is still raised: corpses never age out`,
    castIds(releases),
  );
  const windowed = eligibilityRun(makeWindowedNecro);
  report.checkCatches(
    windowed.old.isAlive,
    'a raiser that lets corpses age out is caught leaving the old one down',
    castIds(windowed.releases),
  );
}

/** Raises no more than one corpse per cast. */
class OnePerCastNecro extends NecroFairy {
  private queuedThisFrame = false;

  override updateAI(targets: Player[]): void {
    this.queuedThisFrame = false;
    super.updateAI(targets);
  }

  protected override queueResurrection(corpse: Mob): void {
    if (this.queuedThisFrame) return;
    this.queuedThisFrame = true;
    super.queueResurrection(corpse);
  }
}

/** Stops raising once it has raised as many corpses as the first batch holds. */
class LifeCappedNecro extends NecroFairy {
  private raisesLeft = FIRST_BATCH_OFFSETS.length;

  protected override queueResurrection(corpse: Mob): void {
    if (this.raisesLeft <= 0) return;
    this.raisesLeft--;
    super.queueResurrection(corpse);
  }
}

interface RaiseAllRun {
  /** First-batch corpses standing at the end of the first raise's release frame; -1 if none was released. */
  readonly standingOnFirstRaise: number;
  /** Whether every first-batch corpse was standing, raised, after the first watch. */
  readonly firstBatchRaised: boolean;
  /** Whether every second-batch corpse was standing, raised, after the second watch. */
  readonly secondBatchRaised: boolean;
  /** Whether every raised body, killed again, stayed down through a full watch. */
  readonly stayedDownAfterSecondDeath: boolean;
  readonly firstDeathXp: number;
  readonly secondDeathXp: number;
  readonly releases: readonly CastRelease[];
}

const allRaised = (mobs: readonly Mob[]): boolean =>
  mobs.length > 0 && mobs.every((mob) => mob.isAlive && mob.wasResurrected);

function addCorpsesAt(s: NecroStage, offsets: readonly TileSpec[]): Mob[] {
  return offsets.map(([dx, dy]) => s.add('goblin', NECRO_TILE + dx, NECRO_TILE + dy));
}

/**
 * A necro among a batch of fresh corpses, then a second batch that falls after
 * the first has been raised, then every raised body killed again.
 */
function raiseAllRun(make?: (x: number, y: number) => NecroFairy): RaiseAllRun {
  const s = necroStage();
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.escortAtCap = true;
  const firstBatch = addCorpsesAt(s, FIRST_BATCH_OFFSETS);
  const xpBeforeFirstDeaths = s.pm.human.xp;
  for (const mob of firstBatch) s.kill(mob);
  const firstDeathXp = s.pm.human.xp - xpBeforeFirstDeaths;
  s.fairies.update(s.ctx());
  let standingOnFirstRaise = -1;
  const releases: CastRelease[] = [];
  const watch = (): void => {
    const seen = castReleases(
      necro,
      () => s.roster.mobs,
      () => {
        s.step(necro);
        const active = necro.activeCast;
        const isRaiseRelease = active?.phase === 'release' && active.cast === NECRO_RESURRECT_CAST;
        if (isRaiseRelease && standingOnFirstRaise < 0) {
          standingOnFirstRaise = firstBatch.filter((mob) => mob.isAlive).length;
        }
      },
      CAST_WATCH_FRAMES,
    );
    releases.push(...seen);
  };
  watch();
  const firstBatchRaised = allRaised(firstBatch);

  const secondBatch = addCorpsesAt(s, SECOND_BATCH_OFFSETS);
  for (const mob of secondBatch) s.kill(mob);
  s.fairies.update(s.ctx());
  watch();
  const secondBatchRaised = allRaised(secondBatch);

  const raised = [...firstBatch, ...secondBatch].filter((mob) => mob.isAlive);
  for (const mob of raised) finishRising(mob);
  const xpBeforeSecondDeaths = s.pm.human.xp;
  for (const mob of raised) s.kill(mob);
  const secondDeathXp = s.pm.human.xp - xpBeforeSecondDeaths;
  s.fairies.update(s.ctx());
  const releasesBefore = releases.length;
  watch();
  const stayedDownAfterSecondDeath =
    raised.every((mob) => !mob.isAlive) && !raisedAny(releases.slice(releasesBefore));
  return {
    standingOnFirstRaise,
    firstBatchRaised,
    secondBatchRaised,
    stayedDownAfterSecondDeath,
    firstDeathXp,
    secondDeathXp,
    releases,
  };
}

function checkResurrectEveryCorpse(report: FairyGateReport): void {
  const run = raiseAllRun();
  const firstCount = FIRST_BATCH_OFFSETS.length;
  report.check(
    run.standingOnFirstRaise === firstCount && run.firstBatchRaised,
    'one raise stands up every eligible corpse in reach, on the frame it is released',
    `${run.standingOnFirstRaise} of ${firstCount} standing on the first raise`,
  );
  const onePerCast = raiseAllRun((x, y) => new OnePerCastNecro(x, y, TILE_SIZE));
  report.checkCatches(
    onePerCast.standingOnFirstRaise === firstCount,
    'a raiser that stands up one corpse per cast is caught',
    `${onePerCast.standingOnFirstRaise} of ${firstCount}`,
  );
  const late = raiseAllRun(makeLateCastNecro);
  report.checkCatches(
    late.standingOnFirstRaise === firstCount,
    'a raise that stands its corpses up a moment after the release is caught',
    `${late.standingOnFirstRaise} of ${firstCount}`,
  );
  report.check(
    run.secondBatchRaised,
    'corpses that fall after a raise are raised too: there is no limit per life',
    castIds(run.releases),
  );
  const capped = raiseAllRun((x, y) => new LifeCappedNecro(x, y, TILE_SIZE));
  report.checkCatches(
    capped.firstBatchRaised && capped.secondBatchRaised,
    'a raiser with a per-life limit is caught leaving the second batch down',
    castIds(capped.releases),
  );
  report.check(
    run.stayedDownAfterSecondDeath,
    'a raised mob killed again is never raised a second time',
  );
  report.check(
    run.secondDeathXp === 0,
    "a raised mob's second death pays no XP",
    `${run.secondDeathXp} XP`,
  );
  report.checkCatches(
    run.firstDeathXp === 0,
    'the same mobs dying the first time are caught paying XP',
    `${run.firstDeathXp} XP`,
  );
}

// ── The skeleton army ──

interface SummonRun {
  readonly releases: readonly CastRelease[];
}

/** A necro with a crawler inside its summon trigger and nothing to raise, watched summoning. */
function summonRun(frames: number, make?: (x: number, y: number) => NecroFairy): SummonRun {
  const s = necroStage();
  placeOnTile(s.pm.human, NECRO_TILE + FIGHT_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.forceAggro = true;
  const releases = castReleases(
    necro,
    () => s.roster.mobs,
    () => {
      placeOnTile(necro, NECRO_TILE, NECRO_TILE);
      s.step(necro, true);
    },
    frames,
  );
  return { releases };
}

const summonsOf = (releases: readonly CastRelease[]): CastRelease[] =>
  releases.filter((release) => release.castId === NECRO_SUMMON_CAST.id);

const everySummonRoseOnRelease = (releases: readonly CastRelease[]): boolean => {
  const summons = summonsOf(releases);
  return summons.length > 0 && summons.every((release) => release.skeletonsRisen > 0);
};

const describeSummonRises = (releases: readonly CastRelease[]): string =>
  summonsOf(releases)
    .map((release) => `${release.skeletonsRisen} risen`)
    .join(', ') || 'no summons';

interface ArmyCount {
  readonly sword: number;
  readonly archer: number;
}

const livingArmy = (mobs: readonly Mob[]): RisingSkeleton[] =>
  mobs.filter((mob): mob is RisingSkeleton => mob instanceof RisingSkeleton && mob.isAlive);

function countArmy(skeletons: readonly RisingSkeleton[]): ArmyCount {
  const archer = skeletons.filter((mob) => mob instanceof SkeletonArcher).length;
  return { sword: skeletons.length - archer, archer };
}

const isArmy = (count: ArmyCount | null, expected: ArmyCount): boolean =>
  count !== null && count.sword === expected.sword && count.archer === expected.archer;

const describeArmy = (count: ArmyCount | null): string =>
  count === null ? 'none' : `${count.sword} sword + ${count.archer} archer`;

/** Stands a skeleton the rest of the way out of the ground, so a blow can land on it. */
function finishSkeletonRise(skeleton: RisingSkeleton): void {
  for (let frame = 0; frame < RISE_FRAMES && skeleton.isRising; frame++) skeleton.updateAI([]);
}

interface ArmyRun {
  /** The army standing at the end of the first summon's release frame. */
  readonly firstArmy: ArmyCount | null;
  /** The most of each kind ever alive at once. */
  readonly peak: ArmyCount;
  /** Summons released while two of the three still stood. */
  readonly summonsWithTwoLeft: number;
  /** Frames from the kill that left one skeleton to the refill's release; NaN if none came. */
  readonly lastStandingDelay: number;
  readonly refilledArmy: ArmyCount | null;
  /** Frames from each full wipe to the next summon's release; NaN where none came. */
  readonly wipeDelays: readonly number[];
  readonly wipeArmies: readonly (ArmyCount | null)[];
  /** XP the party earned from every skeleton the run killed. */
  readonly skeletonXp: number;
  readonly skeletonsKilled: number;
}

/**
 * A necro pinned in place with a crawler inside its summon trigger, whose army
 * is cut down in stages: one sword (two left), the other sword (one left, the
 * archer), then the whole army, {@link WIPE_TRIALS} times.
 */
function armyRun(make?: (x: number, y: number) => NecroFairy): ArmyRun {
  const s = necroStage();
  placeOnTile(s.pm.human, NECRO_TILE + FIGHT_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.forceAggro = true;
  let peak: ArmyCount = { sword: 0, archer: 0 };
  const tick = (): boolean => {
    placeOnTile(necro, NECRO_TILE, NECRO_TILE);
    s.step(necro, true);
    const now = countArmy(livingArmy(s.roster.mobs));
    peak = { sword: Math.max(peak.sword, now.sword), archer: Math.max(peak.archer, now.archer) };
    const active = necro.activeCast;
    return active?.phase === 'release' && active.cast === NECRO_SUMMON_CAST;
  };
  const framesUntilSummon = (limit: number): number => {
    for (let frame = 1; frame <= limit; frame++) if (tick()) return frame;
    return NaN;
  };
  const armyIfSummoned = (delay: number): ArmyCount | null =>
    Number.isNaN(delay) ? null : countArmy(livingArmy(s.roster.mobs));
  let skeletonsKilled = 0;
  const xpBefore = s.pm.human.xp;
  const killAll = (skeletons: readonly RisingSkeleton[]): void => {
    for (const skeleton of skeletons) {
      finishSkeletonRise(skeleton);
      s.kill(skeleton);
      skeletonsKilled++;
    }
  };

  const firstArmy = armyIfSummoned(framesUntilSummon(FIRST_SUMMON_WATCH_FRAMES));

  const swords = livingArmy(s.roster.mobs).filter((mob) => !(mob instanceof SkeletonArcher));
  killAll(swords.slice(0, 1));
  let summonsWithTwoLeft = 0;
  for (let frame = 0; frame < TWO_LEFT_WATCH_FRAMES; frame++) if (tick()) summonsWithTwoLeft++;

  killAll(livingArmy(s.roster.mobs).filter((mob) => !(mob instanceof SkeletonArcher)));
  const lastStandingDelay = framesUntilSummon(LAST_STANDING_WATCH_FRAMES);
  const refilledArmy = armyIfSummoned(lastStandingDelay);

  const wipeDelays: number[] = [];
  const wipeArmies: (ArmyCount | null)[] = [];
  for (let trial = 0; trial < WIPE_TRIALS; trial++) {
    killAll(livingArmy(s.roster.mobs));
    const delay = framesUntilSummon(WIPE_WATCH_FRAMES);
    wipeDelays.push(delay);
    wipeArmies.push(armyIfSummoned(delay));
  }
  return {
    firstArmy,
    peak,
    summonsWithTwoLeft,
    lastStandingDelay,
    refilledArmy,
    wipeDelays,
    wipeArmies,
    skeletonXp: s.pm.human.xp - xpBefore,
    skeletonsKilled,
  };
}

/** A necro whose summons all come up as swords. */
class SwordsOnlyNecro extends NecroFairy {
  override takePendingSummons(): readonly SkeletonSummonRequest[] {
    return super.takePendingSummons().map((request) => ({ ...request, kind: 'sword' as const }));
  }
}

/** A necro whose summon waits out a long fixed cooldown instead of the army's delays. */
class SlowResummonNecro extends NecroFairy {
  protected override cooldownFramesFor(cast: FairyCast): number {
    return cast === NECRO_SUMMON_CAST
      ? FIXED_SUMMON_COOLDOWN_PROBE_FRAMES
      : super.cooldownFramesFor(cast);
  }
}

/** A necro that refills its army the moment anything in it falls. */
class EagerRefillNecro extends NecroFairy {
  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    const chosen = super.chooseCast(crawler);
    if (chosen !== null || crawler === null || this.escortAtCap) return chosen;
    if (!this.isCastReady(NECRO_SUMMON_CAST)) return null;
    return { cast: NECRO_SUMMON_CAST, target: null, aimX: crawler.x, aimY: crawler.y };
  }
}

const wipeDelayInBand = (delay: number): boolean =>
  delay >= NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES &&
  delay <= NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES + ARMY_REPORT_LATENCY_FRAMES;

const lastStandingDelayInBand = (delay: number): boolean =>
  delay >= NECRO_RESUMMON_LAST_STANDING_FRAMES &&
  delay <= NECRO_RESUMMON_LAST_STANDING_FRAMES + ARMY_REPORT_LATENCY_FRAMES;

function checkSummons(report: FairyGateReport): void {
  const run = armyRun();
  report.check(
    isArmy(run.firstArmy, EXPECTED_ARMY),
    'the first summon raises the whole army at once: two sword skeletons and one archer',
    describeArmy(run.firstArmy),
  );
  const swordsOnly = armyRun((x, y) => new SwordsOnlyNecro(x, y, TILE_SIZE));
  report.checkCatches(
    isArmy(swordsOnly.firstArmy, EXPECTED_ARMY),
    'an army with no archer in it is caught',
    describeArmy(swordsOnly.firstArmy),
  );
  report.check(
    run.peak.sword <= EXPECTED_ARMY.sword && run.peak.archer <= EXPECTED_ARMY.archer,
    'the army never exceeds two swords and one archer, through every refill',
    `peak ${describeArmy(run.peak)}`,
  );
  report.check(
    run.summonsWithTwoLeft === 0,
    `an army down one of three is not refilled over ${TWO_LEFT_WATCH_FRAMES} frames`,
    `${run.summonsWithTwoLeft} summons`,
  );
  const eager = armyRun((x, y) => new EagerRefillNecro(x, y, TILE_SIZE));
  report.checkCatches(
    eager.summonsWithTwoLeft === 0,
    'a necro that refills the moment one skeleton falls is caught',
    `${eager.summonsWithTwoLeft} summons`,
  );
  report.check(
    lastStandingDelayInBand(run.lastStandingDelay) && isArmy(run.refilledArmy, EXPECTED_ARMY),
    `down to its last skeleton, the army is refilled to full ${NECRO_RESUMMON_LAST_STANDING_FRAMES} frames later`,
    `${run.lastStandingDelay} frames, ${describeArmy(run.refilledArmy)}`,
  );
  report.check(
    run.wipeDelays.every(wipeDelayInBand) &&
      run.wipeArmies.every((army) => isArmy(army, EXPECTED_ARMY)),
    `after a full wipe the whole army is back within ${NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES}–${NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES} frames`,
    `${run.wipeDelays.join(', ')} frames; ${run.wipeArmies.map(describeArmy).join('; ')}`,
  );
  const slow = armyRun((x, y) => new SlowResummonNecro(x, y, TILE_SIZE));
  report.checkCatches(
    slow.wipeDelays.every(wipeDelayInBand),
    `a necro on a fixed ${FIXED_SUMMON_COOLDOWN_PROBE_FRAMES}-frame summon cooldown is caught slow after a wipe`,
    slow.wipeDelays.join(', '),
  );
  report.checkCatches(
    lastStandingDelayInBand(slow.lastStandingDelay),
    `the same necro is caught slow to refill its last skeleton`,
    `${slow.lastStandingDelay} frames`,
  );
  report.check(
    run.skeletonsKilled > 0 && run.skeletonXp === 0,
    'summoned skeletons pay no XP',
    `${run.skeletonsKilled} killed, ${run.skeletonXp} XP`,
  );

  const releases = summonRun(FIRST_SUMMON_WATCH_FRAMES).releases;
  report.check(
    everySummonRoseOnRelease(releases),
    'every summoned skeleton climbs out on the very frame its summon is released',
    describeSummonRises(releases),
  );
  const late = summonRun(FIRST_SUMMON_WATCH_FRAMES, makeLateCastNecro).releases;
  report.checkCatches(
    everySummonRoseOnRelease(late),
    'a summon whose skeletons climb out a moment after the release is caught',
    describeSummonRises(late),
  );

  const distant = necroStage();
  placeOnTile(distant.pm.human, NECRO_TILE + PAST_TRIGGER_OFFSET_TILES, NECRO_TILE);
  const waiting = distant.addNecro(NECRO_TILE, NECRO_TILE);
  waiting.forceAggro = true;
  const distantReleases = castReleases(
    waiting,
    () => distant.roster.mobs,
    () => {
      placeOnTile(waiting, NECRO_TILE, NECRO_TILE);
      distant.step(waiting, true);
    },
    FIRST_SUMMON_WATCH_FRAMES,
  );
  report.check(
    summonsOf(distantReleases).length === 0,
    `no army is called while the crawler stands past ${NECRO_SUMMON_TRIGGER_TILES} tiles`,
    castIds(distantReleases),
  );
  report.checkCatches(
    summonsOf(releases).length === 0,
    `the same necro with the crawler ${FIGHT_OFFSET_TILES} tiles off is caught calling it`,
    castIds(releases),
  );

  const plainStage = necroStage();
  const plain = plainStage.add('skeleton_sword', NECRO_TILE - FIGHT_OFFSET_TILES, NECRO_TILE);
  const xpBeforePlain = plainStage.pm.human.xp;
  plainStage.kill(plain);
  report.checkCatches(
    plainStage.pm.human.xp === xpBeforePlain,
    'a skeleton that was not a fairy summon is caught paying XP',
    `${plainStage.pm.human.xp - xpBeforePlain} XP`,
  );
}

interface WaveRun {
  /** Frames the wave was released on. */
  readonly releases: readonly number[];
  readonly displaced: number;
  readonly damaged: boolean;
  readonly statusAdded: boolean;
  /** Whether the cat, standing `catOffsetPx` west of the necro's centre, was ever shoved. */
  readonly catShoved: boolean;
}

/**
 * A crawler pressing in on the necro for two wave cooldowns, walking back after
 * every shove, while the cat stands `catOffsetPx` due west of the necro's
 * centre, held there every frame.
 */
function waveRun(
  level: number,
  catOffsetPx: number,
  make?: (x: number, y: number) => NecroFairy,
): WaveRun {
  const s = necroStage();
  const human = s.pm.human;
  const cat = s.pm.cat;
  placeOnTile(human, NECRO_TILE + PRESSING_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  if (level > 1) necro.applyMobLevel(level);
  necro.escortAtCap = true;
  necro.forceAggro = true;
  const hp0 = human.hp;
  const statuses0 = human.statusEffects.length;
  const releases: number[] = [];
  let displaced = 0;
  let catShoved = false;
  const runFrames = TK_COOLDOWN_FRAMES * TK_RUN_COOLDOWNS + TK_RUN_SLACK_FRAMES;
  withDodgesOff(() => {
    for (let frame = 0; frame < runFrames; frame++) {
      if (human.knockbackFramesRemaining === 0) {
        human.x = necro.x + PRESSING_OFFSET_TILES * TILE_SIZE;
        human.y = necro.y;
      }
      cat.x = necro.x - catOffsetPx;
      cat.y = necro.y;
      const before = human.x;
      s.step(necro);
      const active = necro.activeCast;
      if (active?.phase === 'release' && active.cast === NECRO_TELEKINETIC_CAST) {
        releases.push(frame);
      }
      let moved = 0;
      const shoveFrames = TK_KNOCKBACK_FRAMES + KNOCKBACK_SETTLE_FRAMES;
      for (let k = 0; k < shoveFrames && human.knockbackFramesRemaining > 0; k++) {
        applyKnockbackMotion(human, s.map);
        moved = human.x - before;
      }
      displaced = Math.max(displaced, moved);
      if (cat.knockbackFramesRemaining > 0) catShoved = true;
    }
  });
  return {
    releases,
    displaced,
    damaged: human.hp !== hp0,
    statusAdded: human.statusEffects.length !== statuses0,
    catShoved,
  };
}

const releaseGaps = (releases: readonly number[]): number[] =>
  releases.slice(1).map((release, i) => release - releases[i]);

/** Whether a run released at least twice, and never within the flat cooldown of the last release. */
const heldCooldown = (run: WaveRun): boolean =>
  run.releases.length >= 2 && releaseGaps(run.releases).every((gap) => gap >= TK_COOLDOWN_FRAMES);

/** A necro whose wave comes back after half its cooldown. */
class ImpatientNecro extends NecroFairy {
  protected override cooldownFramesFor(cast: FairyCast): number {
    const full = super.cooldownFramesFor(cast);
    return cast === NECRO_TELEKINETIC_CAST ? Math.ceil(full * IMPATIENT_COOLDOWN_SHARE) : full;
  }
}

/** A necro whose wave also lands a blow on the crawler it was released at. */
class HurtingWaveNecro extends NecroFairy {
  protected override onCastReleased(active: ActiveFairyCast): void {
    super.onCastReleased(active);
    if (active.cast === NECRO_TELEKINETIC_CAST) active.target?.takeDamage(WAVE_PROBE_DAMAGE);
  }
}

/** A necro whose wave bursts from a point east of where it hangs on the release frame. */
class OffCentreWaveNecro extends NecroFairy {
  protected override onCastReleased(active: ActiveFairyCast): void {
    if (active.cast !== NECRO_TELEKINETIC_CAST) {
      super.onCastReleased(active);
      return;
    }
    const offsetPx = OFF_CENTRE_WAVE_TILES * TILE_SIZE;
    this.x += offsetPx;
    super.onCastReleased(active);
    this.x -= offsetPx;
  }
}

/**
 * How straight away from the necro's centre on the release frame the wave
 * shoves a crawler standing a tile east: the cosine between the shove and the
 * line from that centre to the crawler's, 1 for dead straight. NaN when no
 * shove lands, so a run whose crawler stood outside the wave cannot pass.
 */
function shoveAlignment(make?: (x: number, y: number) => NecroFairy): number {
  const s = necroStage();
  const human = s.pm.human;
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.escortAtCap = true;
  placeOnTile(human, NECRO_TILE + PRESSING_OFFSET_TILES, NECRO_TILE);
  for (let frame = 0; frame < CAST_WATCH_FRAMES; frame++) {
    // A release comes before the necro moves in its frame, so the centre it
    // bursts from is where it hangs as the frame starts.
    const releaseCentre = necro.groundCentre;
    s.step(necro);
    if (human.knockbackFramesRemaining === 0) continue;
    const awayX = human.x + TILE_SIZE / 2 - releaseCentre.x;
    const awayY = human.y + TILE_SIZE / 2 - releaseCentre.y;
    const awayLength = Math.hypot(awayX, awayY);
    const shoveLength = Math.hypot(human.knockbackDirX, human.knockbackDirY);
    if (awayLength === 0 || shoveLength === 0) return NaN;
    return (awayX * human.knockbackDirX + awayY * human.knockbackDirY) / (awayLength * shoveLength);
  }
  return NaN;
}

function checkTelekineticWave(report: FairyGateReport): void {
  const fullShove = TILE_SIZE * TK_KNOCKBACK_TILES;
  const radiusPx = TILE_SIZE * TK_RADIUS_TILES;
  const justOutsidePx = radiusPx + WAVE_EDGE_MARGIN_PX;
  const justInsidePx = radiusPx - WAVE_EDGE_MARGIN_PX;
  const cleanShove = (run: WaveRun): boolean =>
    run.displaced >= fullShove * SHOVE_SHARE && !run.damaged && !run.statusAdded;
  const describeShove = (run: WaveRun): string =>
    `${run.displaced.toFixed(1)} px, damaged ${run.damaged}, status ${run.statusAdded}`;
  for (const level of [1, MAX_MOB_LEVEL]) {
    const run = waveRun(level, justOutsidePx);
    report.check(
      cleanShove(run),
      `L${level}: the wave shoves the crawler away with no damage and no status`,
      describeShove(run),
    );
    report.check(
      heldCooldown(run),
      `L${level}: the wave never fires twice within its flat ${TK_COOLDOWN_FRAMES}-frame cooldown`,
      `gaps ${releaseGaps(run.releases).join(',')}`,
    );
    report.check(
      run.releases.length > 0 && !run.catShoved,
      `L${level}: a crawler just outside the wave's radius is never shoved`,
      `${justOutsidePx} px from the centre, radius ${radiusPx} px`,
    );
  }
  const hurting = waveRun(1, justOutsidePx, (x, y) => new HurtingWaveNecro(x, y, TILE_SIZE));
  report.checkCatches(
    cleanShove(hurting),
    'a wave that also lands a blow is caught',
    describeShove(hurting),
  );
  const inside = waveRun(1, justInsidePx);
  report.checkCatches(
    inside.releases.length > 0 && !inside.catShoved,
    "the same crawler just inside the wave's radius is caught being shoved",
    `${justInsidePx} px from the centre`,
  );
  const impatient = waveRun(1, justOutsidePx, (x, y) => new ImpatientNecro(x, y, TILE_SIZE));
  report.checkCatches(
    heldCooldown(impatient),
    'a wave back after half its cooldown is caught',
    `gaps ${releaseGaps(impatient.releases).join(',')}`,
  );

  const aligned = shoveAlignment();
  report.check(
    aligned >= SHOVE_ALIGNMENT_MIN_COSINE,
    "the wave shoves straight away from the necro's centre on the frame it is released",
    `cosine ${aligned.toFixed(COSINE_DECIMALS)}`,
  );
  const offCentre = shoveAlignment((x, y) => new OffCentreWaveNecro(x, y, TILE_SIZE));
  report.checkCatches(
    offCentre >= SHOVE_ALIGNMENT_MIN_COSINE,
    'a wave that bursts from a point off the necro is caught shoving the wrong way',
    `cosine ${offCentre.toFixed(COSINE_DECIMALS)}`,
  );
}

// ── The wave and the wall ──

/**
 * A necro that releases its wave at `forcedTarget` whenever the wave is ready
 * and the target is within its trigger, whether or not it can see the target:
 * the release's own guard against walls, tested apart from the choice's.
 */
class ForcedWaveNecro extends NecroFairy {
  forcedTarget: Player | null = null;

  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    const target = this.forcedTarget;
    if (target === null || !this.isCastReady(NECRO_TELEKINETIC_CAST)) {
      return super.chooseCast(crawler);
    }
    const centre = this.groundCentre;
    const distance = Math.hypot(
      target.x + TILE_SIZE / 2 - centre.x,
      target.y + TILE_SIZE / 2 - centre.y,
    );
    if (distance > TK_TRIGGER_RADIUS_TILES * TILE_SIZE) return super.chooseCast(crawler);
    return { cast: NECRO_TELEKINETIC_CAST, target, aimX: target.x, aimY: target.y };
  }
}

/** A forced wave that shoves everyone in its radius, walls or not. */
class WallBlindWaveNecro extends ForcedWaveNecro {
  private partySeen: readonly Player[] = [];

  override updateAI(targets: Player[]): void {
    this.partySeen = targets;
    super.updateAI(targets);
  }

  protected override onCastReleased(active: ActiveFairyCast): void {
    if (active.cast !== NECRO_TELEKINETIC_CAST) {
      super.onCastReleased(active);
      return;
    }
    const centre = this.groundCentre;
    for (const member of this.partySeen) {
      const awayX = member.x + TILE_SIZE / 2 - centre.x;
      const awayY = member.y + TILE_SIZE / 2 - centre.y;
      if (Math.hypot(awayX, awayY) > TK_RADIUS_TILES * TILE_SIZE) continue;
      member.applyKnockback(awayX, awayY, TK_KNOCKBACK_TILES * TILE_SIZE, TK_KNOCKBACK_FRAMES);
    }
  }
}

interface WallRun {
  readonly releases: number;
  readonly shoved: boolean;
}

/**
 * A crawler two tiles east of the necro, inside its trigger, with or without a
 * wall column standing between them, watched for waves and shoves.
 */
function waveOnCrawlerPast(walled: boolean, make?: (x: number, y: number) => NecroFairy): WallRun {
  const wallX = NECRO_TILE + SEALING_WALL_OFFSET_TILES;
  const walls: TileSpec[] = walled ? WALL_ROWS.map((y) => [wallX, y]) : [];
  const s = necroStage(walls);
  const human = s.pm.human;
  placeOnTile(human, NECRO_TILE + SEALED_CRAWLER_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.escortAtCap = true;
  if (necro instanceof ForcedWaveNecro) necro.forcedTarget = human;
  let shoved = false;
  const releases = castReleases(
    necro,
    () => s.roster.mobs,
    () => {
      s.step(necro);
      if (human.knockbackFramesRemaining > 0) shoved = true;
    },
    CAST_WATCH_FRAMES,
  );
  const waves = releases.filter((release) => release.castId === NECRO_TELEKINETIC_CAST.id);
  return { releases: waves.length, shoved };
}

const describeWallRun = (run: WallRun): string =>
  `${run.releases} waves, crawler shoved ${run.shoved}`;

function checkWaveStopsAtWalls(report: FairyGateReport): void {
  const sealed = waveOnCrawlerPast(true);
  report.check(
    sealed.releases === 0 && !sealed.shoved,
    'the wave never fires at, or shoves, a crawler behind a wall',
    describeWallRun(sealed),
  );
  const open = waveOnCrawlerPast(false);
  report.checkCatches(
    open.releases === 0 && !open.shoved,
    'the same crawler with the wall gone is caught shoved',
    describeWallRun(open),
  );
  const makeForced = (x: number, y: number): NecroFairy => new ForcedWaveNecro(x, y, TILE_SIZE);
  const forced = waveOnCrawlerPast(true, makeForced);
  report.check(
    forced.releases > 0 && !forced.shoved,
    'a wave released with the crawler behind a wall leaves it untouched',
    describeWallRun(forced),
  );
  const makeBlind = (x: number, y: number): NecroFairy => new WallBlindWaveNecro(x, y, TILE_SIZE);
  const blind = waveOnCrawlerPast(true, makeBlind);
  report.checkCatches(
    blind.releases > 0 && !blind.shoved,
    'a wave that ignores walls is caught shoving the crawler through one',
    describeWallRun(blind),
  );
}

// ── The chase: the wave on entry, and a necro that never stops to cast ──

/** A necro that waits {@link LATE_CAST_FRAMES} frames after a crawler comes within its wave's trigger. */
class HesitantWaveNecro extends NecroFairy {
  private framesHesitated = 0;

  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    const intent = super.chooseCast(crawler);
    if (intent?.cast !== NECRO_TELEKINETIC_CAST) return intent;
    if (this.framesHesitated < LATE_CAST_FRAMES) {
      this.framesHesitated++;
      return null;
    }
    this.framesHesitated = 0;
    return intent;
  }
}

/** A necro that holds its place for every frame a cast is playing. */
class RootedCasterNecro extends NecroFairy {
  override updateAI(targets: Player[]): void {
    const heldX = this.x;
    const heldY = this.y;
    super.updateAI(targets);
    if (this.activeCast === null) return;
    this.x = heldX;
    this.y = heldY;
    this.isMoving = false;
  }
}

interface ChaseRun {
  /** The first frame the crawler's centre came within the wave's trigger, or -1. */
  readonly entryFrame: number;
  /** The first frame the crawler was shoved, or -1. */
  readonly firstShoveFrame: number;
  /** Pixels the necro flew over each frame it released a cast on. */
  readonly releaseMovesPx: readonly number[];
  /** Pixels the necro flew over every frame a released cast was still playing out. */
  readonly recoverMovedPx: number;
}

/**
 * A crawler walking straight at the necro from outside its trigger, by the real
 * movement code, and carried off by the real knockback after every shove.
 */
function chaseRun(make?: (x: number, y: number) => NecroFairy): ChaseRun {
  const s = necroStage();
  const human = s.pm.human;
  placeOnTile(human, NECRO_TILE + CHASE_START_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  necro.escortAtCap = true;
  const triggerPx = TK_TRIGGER_RADIUS_TILES * TILE_SIZE;
  let entryFrame = -1;
  let firstShoveFrame = -1;
  const releaseMovesPx: number[] = [];
  let recoverMovedPx = 0;
  for (let frame = 0; frame < CHASE_FRAMES; frame++) {
    if (human.knockbackFramesRemaining > 0) {
      applyKnockbackMotion(human, s.map);
    } else {
      const towardX = necro.x - human.x;
      const towardY = necro.y - human.y;
      const towardLength = Math.hypot(towardX, towardY);
      if (towardLength > 0) {
        const step = { dx: towardX / towardLength, dy: towardY / towardLength, isMobile: true };
        applyMovement(human, step, s.map);
      }
    }
    const centre = necro.groundCentre;
    const gapPx = Math.hypot(
      human.x + TILE_SIZE / 2 - centre.x,
      human.y + TILE_SIZE / 2 - centre.y,
    );
    if (entryFrame < 0 && gapPx <= triggerPx) entryFrame = frame;
    const fromX = necro.x;
    const fromY = necro.y;
    const shovedBefore = human.knockbackFramesRemaining > 0;
    s.step(necro);
    if (firstShoveFrame < 0 && !shovedBefore && human.knockbackFramesRemaining > 0) {
      firstShoveFrame = frame;
    }
    const movedPx = Math.hypot(necro.x - fromX, necro.y - fromY);
    const phase = necro.activeCast?.phase;
    if (phase === 'release') releaseMovesPx.push(movedPx);
    else if (phase === 'recover') recoverMovedPx += movedPx;
  }
  return { entryFrame, firstShoveFrame, releaseMovesPx, recoverMovedPx };
}

const burstOnEntry = (run: ChaseRun): boolean =>
  run.entryFrame >= 0 && run.firstShoveFrame === run.entryFrame;

const describeEntry = (run: ChaseRun): string =>
  `entered on frame ${run.entryFrame}, first shoved on frame ${run.firstShoveFrame}`;

const keptFlying = (run: ChaseRun): boolean =>
  run.releaseMovesPx.length > 0 &&
  run.releaseMovesPx.every((moved) => moved > MOVE_EPSILON_PX) &&
  run.recoverMovedPx > MOVE_EPSILON_PX;

const describeFlight = (run: ChaseRun): string =>
  `release frames ${run.releaseMovesPx.map((moved) => moved.toFixed(2)).join(',') || 'none'} px; ` +
  `${run.recoverMovedPx.toFixed(1)} px over the recoveries`;

function checkChase(report: FairyGateReport): void {
  const run = chaseRun();
  report.check(
    burstOnEntry(run),
    `the wave bursts on the frame a crawler comes within ${TK_TRIGGER_RADIUS_TILES} tiles`,
    describeEntry(run),
  );
  const hesitant = chaseRun((x, y) => new HesitantWaveNecro(x, y, TILE_SIZE));
  report.checkCatches(
    burstOnEntry(hesitant),
    'a wave that waits a moment after the crawler comes in is caught',
    describeEntry(hesitant),
  );
  report.check(
    keptFlying(run),
    'the necro keeps flying on every frame it releases a cast and through the recovery after',
    describeFlight(run),
  );
  const rooted = chaseRun((x, y) => new RootedCasterNecro(x, y, TILE_SIZE));
  report.checkCatches(
    keptFlying(rooted),
    'a necro that holds still while it casts is caught',
    describeFlight(rooted),
  );
}

function deathSkeletons(
  level: number,
  difficulty: Difficulty,
  reportDeath: boolean,
  options: {
    readonly make?: (x: number, y: number) => NecroFairy;
    readonly walls?: readonly TileSpec[];
  } = {},
): {
  risen: RisingSkeleton[];
  stage: NecroStage;
} {
  const s = necroStage(options.walls);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, options.make);
  if (level > 1) necro.applyMobLevel(level);
  necro.stampPotency(difficulty);
  if (reportDeath) s.kill(necro);
  else necro.takeDamageFrom(Number.MAX_SAFE_INTEGER, s.pm.human);
  for (let frame = 0; frame < DEATH_RAISE_FRAMES; frame++) s.step(necro, true);
  return { risen: livingArmy(s.roster.mobs), stage: s };
}

/** A necro whose death army is its old potency count of swords, whatever the difficulty. */
class PotencyDeathNecro extends NecroFairy {
  override get deathArmy(): ArmyCount {
    return { sword: this.potencyCount, archer: 0 };
  }
}

/** A necro that ignores the difficulty it was spawned under and always leaves normal's army. */
class DifficultyBlindNecro extends NecroFairy {
  override stampPotency(_difficulty: Difficulty): void {
    super.stampPotency('normal');
  }
}

/** Every sampled level and difficulty whose death army is not the expected one, described. */
function deathArmyMisses(make?: (x: number, y: number) => NecroFairy): string[] {
  const misses: string[] = [];
  for (const level of DEATH_ARMY_LEVELS) {
    for (const difficulty of DIFFICULTIES) {
      const army = countArmy(deathSkeletons(level, difficulty, true, { make }).risen);
      if (!isArmy(army, EXPECTED_DEATH_ARMY[difficulty])) {
        misses.push(`L${level} ${difficulty}: ${describeArmy(army)}`);
      }
    }
  }
  return misses;
}

const tileOf = (mob: Mob): string =>
  `${Math.floor(mob.x / TILE_SIZE)},${Math.floor(mob.y / TILE_SIZE)}`;

/** Walls every tile around the necro but its own row: a corridor with fewer free tiles than the hard death army. */
function corridorWalls(): TileSpec[] {
  const walls: TileSpec[] = [];
  for (let dy = -CORRIDOR_HALF_SPAN_TILES; dy <= CORRIDOR_HALF_SPAN_TILES; dy++) {
    if (dy === 0) continue;
    for (let dx = -CORRIDOR_HALF_SPAN_TILES; dx <= CORRIDOR_HALF_SPAN_TILES; dx++) {
      walls.push([NECRO_TILE + dx, NECRO_TILE + dy]);
    }
  }
  return walls;
}

function checkDeathSkeletons(report: FairyGateReport): void {
  const misses = deathArmyMisses();
  report.check(
    misses.length === 0,
    'a necro death raises 4 swords + 2 archers on easy and normal, 7 swords + 3 archers on hard, at every sampled level',
    misses.join('; ') || `${DEATH_ARMY_LEVELS.length * DIFFICULTIES.length} samples`,
  );
  report.checkCatches(
    deathArmyMisses((x, y) => new PotencyDeathNecro(x, y, TILE_SIZE)).length === 0,
    'a death army sized by potency is caught',
  );
  report.checkCatches(
    deathArmyMisses((x, y) => new DifficultyBlindNecro(x, y, TILE_SIZE)).length === 0,
    'a death army that ignores the stamped difficulty is caught',
  );
  const silent = deathSkeletons(MAX_MOB_LEVEL, 'hard', false);
  report.checkCatches(
    isArmy(countArmy(silent.risen), EXPECTED_DEATH_ARMY.hard),
    'a death that never reaches the kill path is caught raising nothing',
    describeArmy(countArmy(silent.risen)),
  );

  const { risen, stage } = deathSkeletons(MAX_MOB_LEVEL, 'hard', true);
  const distinctTiles = new Set(risen.map(tileOf)).size;
  report.check(
    risen.length > 0 && distinctTiles === risen.length,
    'in open ground, every death skeleton rises on a tile of its own',
    `${risen.length} risen on ${distinctTiles} tiles`,
  );
  const xpBefore = stage.pm.human.xp;
  for (const skeleton of risen) {
    finishSkeletonRise(skeleton);
    stage.kill(skeleton);
  }
  report.check(
    risen.length > 0 &&
      risen.every((skeleton) => !skeleton.paysRewards && skeleton.forceAggro) &&
      stage.pm.human.xp === xpBefore,
    "a necro's death skeletons come for the party and pay no XP",
    `${risen.length} risen, ${xpBefore} → ${stage.pm.human.xp}`,
  );

  const cramped = deathSkeletons(MAX_MOB_LEVEL, 'hard', true, { walls: corridorWalls() });
  const crampedTiles = new Set(cramped.risen.map(tileOf)).size;
  report.check(
    isArmy(countArmy(cramped.risen), EXPECTED_DEATH_ARMY.hard),
    'in a corridor with fewer free tiles than skeletons, the whole death army still rises, doubling up',
    `${describeArmy(countArmy(cramped.risen))} on ${crampedTiles} tiles`,
  );
}

/** Takes `mob` out of the scene the way a rewind drops one: off the list and off the grid. */
function dropFromScene(s: Stage, mob: Mob): void {
  s.roster.replaceAll(s.roster.mobs.filter((other) => other !== mob));
  s.roster.rebuildGrid();
  setPackAlertGrid(s.roster.grid);
}

function checkResurrectGuards(report: FairyGateReport): void {
  {
    const s = necroStage();
    const necro = s.addNecro(NECRO_TILE, NECRO_TILE);
    necro.escortAtCap = true;
    const dropped = s.add('goblin', NECRO_TILE + CORPSE_OFFSET_TILES, NECRO_TILE);
    const kept = s.add('goblin', NECRO_TILE - CORPSE_OFFSET_TILES, NECRO_TILE);
    s.kill(dropped);
    s.kill(kept);
    s.fairies.update(s.ctx());
    const bothRecorded = [dropped, kept].every((mob) =>
      s.fairies.corpseLedger.entries.some((entry) => entry.mob === mob),
    );
    dropFromScene(s, dropped);
    const raisedDropped = s.fairies.resurrect(dropped, necro, s.roster.grid);
    report.check(
      bothRecorded && !raisedDropped && !dropped.isAlive,
      'FairySystem.resurrect refuses a corpse that has left the mob list',
    );
    const raisedKept = s.fairies.resurrect(kept, necro, s.roster.grid);
    report.checkCatches(
      !raisedKept,
      'the same raise on a corpse still in the mob list is caught standing it up',
    );
  }
  {
    const s = necroStage();
    const necro = s.addNecro(NECRO_TILE, NECRO_TILE);
    necro.escortAtCap = true;
    const add = s.add('goblin', NECRO_TILE + CORPSE_OFFSET_TILES, NECRO_TILE);
    add.isBossAdd = true;
    s.kill(add);
    s.fairies.update(s.ctx());
    const recorded = s.fairies.corpseLedger.entries.some((entry) => entry.mob === add);
    const releases = castReleases(
      necro,
      () => s.roster.mobs,
      () => s.step(necro),
      CAST_WATCH_FRAMES,
    );
    const raisedDirectly = s.fairies.resurrect(add, necro, s.roster.grid);
    report.check(
      !add.isAlive && !recorded && !raisedAny(releases) && !raisedDirectly,
      "a boss's add is never recorded as a corpse, cast on, or raised",
      castIds(releases),
    );
    const plain = s.add('goblin', NECRO_TILE - CORPSE_OFFSET_TILES, NECRO_TILE);
    s.kill(plain);
    report.checkCatches(
      !s.fairies.corpseLedger.entries.some((entry) => entry.mob === plain),
      'the same goblin not fighting beside a boss is caught recorded as a corpse',
    );
  }
}

/** Ticks a raised mob until it has stood up, so a blow can land on it. */
function finishRising(mob: Mob): void {
  for (let frame = 0; frame < RISE_FRAMES && mob.isReviving; frame++) mob.tickTimers();
}

interface RewindOutcome {
  /** Raised before the checkpoint, killed after it: stands back up still counted as raised. */
  readonly raisedThenKilled: Mob;
  /** Raised before the checkpoint and alive through the rewind. */
  readonly raisedSurvivor: Mob;
  /** Dead at the checkpoint, raised after it: put back down, the raise undone. */
  readonly raisedAfter: Mob;
  /** Whether every raise and kill the scenario stages actually happened before the rewind. */
  readonly staged: boolean;
}

/** The checkpoint mark and rewind the dungeon scene runs, over the stage's roster. */
function rewindRun(forgetRaisesAtMark: boolean): RewindOutcome {
  const s = necroStage();
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE);
  necro.escortAtCap = true;
  const raise = (mob: Mob): boolean => {
    s.kill(mob);
    s.fairies.update(s.ctx());
    const stood = s.fairies.resurrect(mob, necro, s.roster.grid);
    finishRising(mob);
    return stood;
  };
  const raisedThenKilled = s.add('goblin', NECRO_TILE + CORPSE_OFFSET_TILES, NECRO_TILE);
  const raisedSurvivor = s.add('goblin', NECRO_TILE - CORPSE_OFFSET_TILES, NECRO_TILE);
  const raisedAfter = s.add('goblin', NECRO_TILE, NECRO_TILE + CORPSE_OFFSET_TILES);
  const raisedBeforeMark = raise(raisedThenKilled) && raise(raisedSurvivor);
  s.kill(raisedAfter);

  markMobsAtCheckpoint(s.roster);
  if (forgetRaisesAtMark) for (const mob of s.roster.mobs) mob.resurrectedAtCheckpoint = false;

  s.kill(raisedThenKilled);
  s.fairies.update(s.ctx());
  const raisedAfterMark = s.fairies.resurrect(raisedAfter, necro, s.roster.grid);
  finishRising(raisedAfter);
  const staged = raisedBeforeMark && raisedAfterMark && !raisedThenKilled.isAlive;

  rewindMobsToCheckpoint(s.roster);
  setPackAlertGrid(s.roster.grid);
  return { raisedThenKilled, raisedSurvivor, raisedAfter, staged };
}

function checkRewindKeepsRaises(report: FairyGateReport): void {
  const run = rewindRun(false);
  report.check(
    run.staged,
    "the dungeon scene's checkpoint mark and rewind are driven over raises before and after it",
  );
  const { raisedThenKilled, raisedSurvivor, raisedAfter } = run;
  report.check(
    raisedThenKilled.isAlive && raisedThenKilled.wasResurrected && !raisedThenKilled.paysRewards,
    'a mob raised before the checkpoint and killed after it stands back up still counted as raised',
    `alive ${raisedThenKilled.isAlive}, raised ${raisedThenKilled.wasResurrected}`,
  );
  report.check(
    raisedSurvivor.isAlive && raisedSurvivor.wasResurrected,
    'a raised mob alive through the rewind keeps its raise',
  );
  report.check(
    !raisedAfter.isAlive && !raisedAfter.wasResurrected,
    'a mob dead at the checkpoint and raised after it is put back down, the raise undone',
    `alive ${raisedAfter.isAlive}, raised ${raisedAfter.wasResurrected}`,
  );
  const forgetful = rewindRun(true);
  report.checkCatches(
    forgetful.raisedThenKilled.wasResurrected && forgetful.raisedSurvivor.wasResurrected,
    'a checkpoint that does not record raises is caught paying for their kills again',
  );
}

/** A skeleton warrior as a necro fairy of `fairyLevel` on `curve` should raise it, or at full strength. */
function referenceSkeleton(fairyLevel: number, curve: LevelledCurve, lesser: boolean): Mob {
  const skeleton = new SkeletonWarrior(PARK_TILE, PARK_TILE, TILE_SIZE);
  if (lesser) skeleton.raiseAsLesser(NECRO_SKELETON_STRENGTH);
  skeleton.applyMobLevel(necroSkeletonLevel(fairyLevel), curve);
  return skeleton;
}

/**
 * The HP `skeleton`'s first landed blow takes off a crawler standing beside it,
 * through its own AI and the real damage path, on a stage of its own; NaN if no
 * blow lands.
 */
function biteOf(skeleton: Mob): number {
  const s = buildStage();
  skeleton.setMap(s.map);
  s.roster.add(skeleton);
  const human = s.pm.human;
  return withDodgesOff(() => {
    for (let frame = 0; frame < BITE_WATCH_FRAMES; frame++) {
      human.x = skeleton.x + TILE_SIZE;
      human.y = skeleton.y;
      human.invulnerableFrames = 0;
      const hpBefore = human.hp;
      skeleton.updateAI([human]);
      if (human.hp < hpBefore) return hpBefore - human.hp;
    }
    return NaN;
  });
}

/**
 * Whether `skeleton` stands at the lesser level and HP a necro of `fairyLevel`
 * raises at, and bites as hard as that lesser skeleton — which is less than a
 * full-strength one at the same level, or the bite half would prove nothing.
 */
function isLesserRaise(skeleton: Mob, fairyLevel: number, curve: LevelledCurve): boolean {
  const expected = referenceSkeleton(fairyLevel, curve, true);
  const expectedBite = biteOf(expected);
  const fullBite = biteOf(referenceSkeleton(fairyLevel, curve, false));
  return (
    skeleton.mobLevel === expected.mobLevel &&
    skeleton.maxHp === expected.maxHp &&
    expectedBite < fullBite &&
    biteOf(skeleton) === expectedBite
  );
}

/**
 * Whether an archer stands at the lesser level and HP a necro of `fairyLevel`
 * raises at. Its arrows go through the same `scaledDamage` the warrior's bite
 * does, which the warrior's check measures.
 */
function isLesserArcher(archer: Mob, fairyLevel: number, curve: LevelledCurve): boolean {
  const expected = new SkeletonArcher(PARK_TILE, PARK_TILE, TILE_SIZE);
  expected.raiseAsLesser(NECRO_SKELETON_STRENGTH);
  expected.applyMobLevel(necroSkeletonLevel(fairyLevel), curve);
  return archer.mobLevel === expected.mobLevel && archer.maxHp === expected.maxHp;
}

function describeRaise(skeletons: readonly Mob[]): string {
  return skeletons
    .map((skeleton) =>
      skeleton instanceof SkeletonArcher
        ? `archer L${skeleton.mobLevel} ${skeleton.maxHp} HP`
        : `L${skeleton.mobLevel} ${skeleton.maxHp} HP, bite ${biteOf(skeleton).toFixed(BITE_DECIMALS)}`,
    )
    .join(', ');
}

/** A skeleton raised lesser in HP whose blows are then put back to full strength. */
class FullBiteSkeleton extends SkeletonWarrior {
  restoreFullBite(): void {
    this.lesserShare = FULL_BITE_SHARE;
  }
}

function checkSkeletonsAreLesser(report: FairyGateReport): void {
  const s = necroStage();
  placeOnTile(s.pm.human, NECRO_TILE + FIGHT_OFFSET_TILES, NECRO_TILE);
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE);
  necro.applyMobLevel(LESSER_CHECK_LEVEL);
  necro.forceAggro = true;
  const summoned: RisingSkeleton[] = [];
  for (let frame = 0; frame < FIRST_SUMMON_WATCH_FRAMES && summoned.length === 0; frame++) {
    s.step(necro, true);
    summoned.push(...livingArmy(s.roster.mobs));
  }
  const curve = necro.levelledCurve;
  const isLesser = (mob: RisingSkeleton): boolean =>
    mob instanceof SkeletonArcher
      ? isLesserArcher(mob, LESSER_CHECK_LEVEL, curve)
      : isLesserRaise(mob, LESSER_CHECK_LEVEL, curve);
  const summonedArchers = summoned.filter((mob) => mob instanceof SkeletonArcher).length;
  report.check(
    summonedArchers > 0 && summoned.every(isLesser),
    `a levelled necro's summoned swords and archers rise lesser, at level ${necroSkeletonLevel(LESSER_CHECK_LEVEL)}`,
    describeRaise(summoned),
  );

  const { risen } = deathSkeletons(LESSER_CHECK_LEVEL, 'hard', true);
  const deathArchers = risen.filter((mob) => mob instanceof SkeletonArcher).length;
  report.check(
    deathArchers > 0 && risen.every(isLesser),
    `a levelled necro's death swords and archers rise lesser, at level ${necroSkeletonLevel(LESSER_CHECK_LEVEL)}`,
    describeRaise(risen),
  );
  const fullArcher = new SkeletonArcher(PARK_TILE, PARK_TILE, TILE_SIZE);
  fullArcher.applyMobLevel(necroSkeletonLevel(LESSER_CHECK_LEVEL), curve);
  report.checkCatches(
    isLesserArcher(fullArcher, LESSER_CHECK_LEVEL, curve),
    'an archer raised at full strength is caught',
    `${fullArcher.maxHp} HP`,
  );

  const fullStrength = referenceSkeleton(LESSER_CHECK_LEVEL, curve, false);
  report.checkCatches(
    isLesserRaise(fullStrength, LESSER_CHECK_LEVEL, curve),
    'a skeleton raised at full strength is caught',
    describeRaise([fullStrength]),
  );
  const fairyLevelled = new SkeletonWarrior(PARK_TILE, PARK_TILE, TILE_SIZE);
  fairyLevelled.raiseAsLesser(NECRO_SKELETON_STRENGTH);
  fairyLevelled.applyMobLevel(LESSER_CHECK_LEVEL, curve);
  report.checkCatches(
    isLesserRaise(fairyLevelled, LESSER_CHECK_LEVEL, curve),
    "a skeleton raised at the fairy's own level is caught",
    describeRaise([fairyLevelled]),
  );
  const fullBite = new FullBiteSkeleton(PARK_TILE, PARK_TILE, TILE_SIZE);
  fullBite.raiseAsLesser(NECRO_SKELETON_STRENGTH);
  fullBite.applyMobLevel(necroSkeletonLevel(LESSER_CHECK_LEVEL), curve);
  fullBite.restoreFullBite();
  report.checkCatches(
    isLesserRaise(fullBite, LESSER_CHECK_LEVEL, curve),
    'a skeleton with lesser HP but a full-strength bite is caught',
    describeRaise([fullBite]),
  );
}

/** A necro that counts itself on screen wherever the camera is. */
class ScreenBlindNecro extends NecroFairy {
  override get isOnScreen(): boolean {
    return true;
  }
}

const makeScreenBlindNecro = (x: number, y: number): NecroFairy =>
  new ScreenBlindNecro(x, y, TILE_SIZE);

interface ScreenRun {
  /** Whether the setup a hold is measured from happened: the first army fielded, for a refill. */
  readonly staged: boolean;
  /** Releases of the watched cast while the necro was off screen. */
  readonly offScreenCasts: number;
  /** Frames from the necro coming into view to the watched cast's release, or -1. */
  readonly castAfterSeen: number;
}

type ScreenCase = 'raise' | 'summon' | 'refill';

/**
 * A necro pinned in place with, per case, a corpse beside it and nobody near
 * (`raise`), a crawler inside its summon trigger (`summon`), or the same
 * crawler after a first army it fielded on screen has been wiped out
 * (`refill`). The camera is then moved off it for {@link OFF_SCREEN_WATCH_FRAMES}
 * and back.
 */
function screenRun(screenCase: ScreenCase, make?: (x: number, y: number) => NecroFairy): ScreenRun {
  const s = necroStage();
  const necro = s.addNecro(NECRO_TILE, NECRO_TILE, make);
  const raising = screenCase === 'raise';
  const watched = raising ? NECRO_RESURRECT_CAST : NECRO_SUMMON_CAST;
  const tick = (): boolean => {
    placeOnTile(necro, NECRO_TILE, NECRO_TILE);
    s.step(necro, !raising);
    const active = necro.activeCast;
    return active?.phase === 'release' && active.cast === watched;
  };
  const framesUntilCast = (limit: number): number => {
    for (let frame = 1; frame <= limit; frame++) if (tick()) return frame;
    return -1;
  };
  let staged = true;
  if (raising) {
    const corpse = s.add('goblin', NECRO_TILE + CORPSE_OFFSET_TILES, NECRO_TILE);
    s.kill(corpse);
    s.fairies.update(s.ctx());
  } else {
    placeOnTile(s.pm.human, NECRO_TILE + FIGHT_OFFSET_TILES, NECRO_TILE);
    necro.forceAggro = true;
  }
  if (screenCase === 'refill') {
    staged = framesUntilCast(FIRST_SUMMON_WATCH_FRAMES) > 0;
    for (const skeleton of livingArmy(s.roster.mobs)) {
      finishSkeletonRise(skeleton);
      s.kill(skeleton);
    }
  }
  setVisibleWorldView(OFF_SCREEN_VIEW);
  let offScreenCasts = 0;
  for (let frame = 0; frame < OFF_SCREEN_WATCH_FRAMES; frame++) if (tick()) offScreenCasts++;
  setVisibleWorldView(WHOLE_ARENA_VIEW);
  const castAfterSeen = framesUntilCast(SEEN_TO_CAST_FRAMES);
  return { staged, offScreenCasts, castAfterSeen };
}

const describeScreenRun = (run: ScreenRun): string =>
  `${run.offScreenCasts} off-screen casts, ` +
  `${run.castAfterSeen < 0 ? 'none' : `one ${run.castAfterSeen} frames`} after coming into view`;

function checkWaitsToBeSeen(report: FairyGateReport): void {
  const cases: readonly { screenCase: ScreenCase; what: string }[] = [
    { screenCase: 'raise', what: 'raise the corpse beside it' },
    { screenCase: 'summon', what: 'call its army with a crawler in its summon trigger' },
    { screenCase: 'refill', what: 'refill its wiped-out army' },
  ];
  for (const { screenCase, what } of cases) {
    const run = screenRun(screenCase);
    if (screenCase === 'refill') {
      report.precondition(run.staged, 'the necro fields its first army while on screen');
    }
    report.check(
      run.offScreenCasts === 0 && run.castAfterSeen > 0,
      `off screen the necro does not ${what}; back in view it does within ${SEEN_TO_CAST_FRAMES} frame`,
      describeScreenRun(run),
    );
    const blind = screenRun(screenCase, makeScreenBlindNecro);
    report.checkCatches(
      blind.offScreenCasts === 0,
      `a necro that counts itself on screen anywhere is caught trying to ${what} off screen`,
      describeScreenRun(blind),
    );
  }
}

export function verifyNecroFairy(report: FairyGateReport): void {
  report.section('Necro fairy');
  checkResurrectEligibility(report);
  checkResurrectEveryCorpse(report);
  checkSummons(report);
  checkTelekineticWave(report);
  checkWaveStopsAtWalls(report);
  checkChase(report);
  checkResurrectGuards(report);
  checkRewindKeepsRaises(report);
  checkDeathSkeletons(report);
  checkSkeletonsAreLesser(report);
  checkWaitsToBeSeen(report);
}
