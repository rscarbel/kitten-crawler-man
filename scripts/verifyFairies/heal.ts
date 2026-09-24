/**
 * The healing fairy, in life and in death, through its real AI and
 * `FairySystem`.
 *
 * - It heals the most wounded ally it can reach and see, and nobody above
 *   the trigger share, on the frame the cast releases, flying on from an
 *   approaching crawler through the cast; a boss by the boss share, and never
 *   past the boss's
 *   phase ceiling — every phased boss, with its own AI running — and a
 *   Krakaren standing exactly on its enrage line is already past it.
 * - What it restores per second on any target is held under
 *   `HEAL_MAX_SHARE_OF_PARTY_DPS` of the reference party's damage per second
 *   at every level, and what it really restores never beats that published
 *   rate.
 * - Its death wave heals a wounded regular mob to full, gives a full one
 *   exactly half its max HP as overheal, and leaves a boss untouched.
 * - Off screen it heals, and its death wave heals, as on screen, but neither
 *   makes a sound; on screen both do.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { OVERHEAL_STATUS } from '../../src/core/StatusEffect';
import {
  REFERENCE_CRAWLERS,
  referenceStats,
  type ReferenceBuild,
} from '../../src/core/referenceCrawler';
import type { Mob } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import type { ActiveFairyCast, FairyCast } from '../../src/creatures/fairies/Fairy';
import { Goblin } from '../../src/creatures/Goblin';
import { TheHoarder } from '../../src/creatures/TheHoarder';
import { KrakarenClone } from '../../src/creatures/KrakarenClone';
import { TheLich } from '../../src/creatures/TheLich';
import { LichBattleSystem, type LichBattleHooks } from '../../src/systems/LichBattleSystem';
import { applyFairyHeal } from '../../src/creatures/fairies/fairyHeal';
import {
  HealingFairy,
  healingFairyCooldownFrames,
  healingFairyHealAmount,
  healingFairyHealPerSecond,
} from '../../src/creatures/fairies/HealingFairy';
import {
  BOSS_HEAL_SCALE,
  FAIRY_CAST_RECOVER_FRAMES,
  HEAL_FRACTION_OF_TARGET_MAX_HP,
  HEAL_MAX_SHARE_OF_PARTY_DPS,
  HEAL_RANGE_TILES,
  HEAL_TRIGGER_HP_FRACTION,
  HEAL_WAVE_EXPAND_FRAMES,
  HEAL_WAVE_RADIUS_TILES,
  OVERHEAL_MAX_HP_FRACTION,
} from '../../src/creatures/fairies/fairyTuning';
import {
  LEARNING_FLOOR_LEVELLED_CURVE,
  SHARED_LEVELLED_CURVE,
  type LevelledCurve,
} from '../../src/creatures/mobLevelScaling';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import type { FairyGateReport } from './report';
import { LETHAL_BLOW, WHOLE_ARENA_VIEW, buildStage, placeOnTile, type TileSpec } from './stage';
import { setVisibleWorldView, type VisibleWorldView } from '../../src/core/visibleWorldView';
import type { SoundId } from '../../src/audio/sounds';
import {
  playFairyCastCues,
  playFairySystemCues,
  type FairyCuePlayer,
} from '../../src/systems/fairyAudioCues';

const FRAMES_PER_SECOND = 60;
const HEALER_TILE = 8;
/**
 * A wall column between the healer and one wounded ally, rows 1..`WALL_ROWS`:
 * close enough that the ally behind it is in heal range, so only sight hides it.
 */
/** How far east of the healer the sight-blocking wall stands, within heal range. */
const WALL_OFFSET_TILES = 3;
const WALL_X = HEALER_TILE + WALL_OFFSET_TILES;
/** How far past the wall the hidden ally stands: inside heal range, out of sight. */
const BEHIND_WALL_OFFSET_TILES = 2;
const BEHIND_WALL_X = WALL_X + BEHIND_WALL_OFFSET_TILES;
/** Tiles off the healer an ally stands at: inside heal range and clear of the healer's own tile. */
const NEIGHBOR_OFFSET_TILES = 2;
/** How many times its heal range an ally stands off to be out of reach. */
const OUT_OF_RANGE_FACTOR = 2;
/** First-heal windows the scratched ally is watched for, so a slow cast still shows. */
const SCRATCH_WATCH_WINDOWS = 2;
/** Frames past the wave's full expansion it is run, so its last ring has resolved. */
const WAVE_SETTLE_FRAMES = 2;
/** The single hit point that puts a boss just above its line. */
const ONE_HP = 1;
const WALL_ROWS = 12;
/** Frames from idle to the first heal landing, with slack for the recover pose. */
const FIRST_HEAL_FRAMES = 80;
/** Wound shares for the target-choice case: lightly, badly, and worst-of-all. */
const LIGHT_WOUND = 0.7;
const BAD_WOUND = 0.3;
const WORST_WOUND = 0.1;
/** Halfway between the trigger share and full HP: a scratch not worth a cast. */
const SCRATCH_WOUND = (HEAL_TRIGGER_HP_FRACTION + 1) / 2;
/**
 * Max HP of the scratched ally: large enough that its scratch share rounds to
 * a real wound rather than back to full.
 */
const SCRATCHED_ALLY_MAX_HP = 100;
/** The share a phased boss starts its heal run at: past every boss's first phase line. */
const BOSS_START_SHARE = 0.3;
/**
 * Seconds each phased boss is healed while its own AI runs: long enough for the
 * slowest-healed of them, the Lich, to be lifted all the way to its line.
 */
const BOSS_HEAL_SECONDS = 120;
/** A healer level well inside the curve, for the measured-rate case. */
const MEASURED_RATE_LEVEL = 8;
/** A body small enough that a share of its HP, not the level cap, sets a heal. */
const SHARE_BOUND_MAX_HP = 40;
/** A boss so big the heal cap, not the share of its HP, sets every heal. */
const HUGE_BOSS_MAX_HP = 5000;
const MEASURED_RATE_SECONDS = 120;
/** How far short of its real cooldown the hasty probe healer recovers, in frames. */
const HASTY_COOLDOWN_FRAMES = 30;
/** The injured share the huge boss is held at every frame, under the heal trigger. */
const HELD_WOUND_SHARE = 0.2;
const RATE_EPSILON = 1e-9;
const GOBLIN_WEAPON = 'sword';
const DECIMALS = 3;
/** Target sizes the heal/sec bound is swept over, a scratch to a colossus. */
const SCRATCH_TARGET_MAX_HP = 1;
const TINY_TARGET_MAX_HP = 6;
const SMALL_TARGET_MAX_HP = 14;
const MODEST_TARGET_MAX_HP = 40;
const MEDIUM_TARGET_MAX_HP = 120;
const LARGE_TARGET_MAX_HP = 400;
const HUGE_TARGET_MAX_HP = 1500;
const GIANT_TARGET_MAX_HP = 10_000;
const COLOSSAL_TARGET_MAX_HP = 1_000_000;
const TARGET_MAX_HPS = [
  SCRATCH_TARGET_MAX_HP,
  TINY_TARGET_MAX_HP,
  SMALL_TARGET_MAX_HP,
  MODEST_TARGET_MAX_HP,
  MEDIUM_TARGET_MAX_HP,
  LARGE_TARGET_MAX_HP,
  HUGE_TARGET_MAX_HP,
  GIANT_TARGET_MAX_HP,
  COLOSSAL_TARGET_MAX_HP,
];
const CURVES: ReadonlyArray<readonly [string, LevelledCurve]> = [
  ['shared', SHARED_LEVELLED_CURVE],
  ['learning', LEARNING_FLOOR_LEVELLED_CURVE],
];
/** The reference party build the difficulty curve prices regular fights with. */
const REFERENCE_PARTY_BUILD: ReferenceBuild = 'balanced';
/** Every boss whose HP phases carry a heal ceiling, by spawn key. */
const PHASED_BOSS_KEYS = [
  'the_hoarder',
  'juicer',
  'krakaren_clone',
  'ball_of_swine',
  'terror_the_clown',
  'the_lich',
] as const;
/** Frames the probe healer lets pass between its cast releasing and its heal landing. */
const PROBE_HEAL_DELAY_FRAMES = 6;
/** A single tile off the healer, either side, for the chase allies. */
const ADJACENT_TILES = 1;
/** Tiles below the healer the two chase allies stand. */
const CHASE_ALLY_BELOW_TILES = 2;
/** Tiles from the healer the chasing human starts, north of it, inside its notice range. */
const CHASER_START_TILES = 5;
/**
 * Pixels the chasing human closes per frame: under the fairy's flutter speed,
 * so the healer stays ahead and on the move rather than being caught.
 */
const CHASER_STEP_PX = 1.5;
/** The human stops closing once this near, so it never stands on the healer. */
const CHASER_STOP_PX = TILE_SIZE;
/**
 * Frames the chase runs before the ally is wounded: long enough for the human
 * to have closed into flutter range, so the healer is already flying from it.
 */
const CHASE_WARMUP_FRAMES = 150;
/** Frames before the release the healer is watched moving over. */
const MOVING_BEFORE_RELEASE_FRAMES = 5;
/** Less than this many pixels in a frame counts as standing still. */
const STILL_PX = 0.5;
/** Tiles off the healer the wave cases stand at, inside its radius. */
const WAVE_OFFSET_TILES = 2;
/** A mob this far out, in tiles, is past the wave's reach. */
const OUTSIDE_WAVE_MARGIN_TILES = 2;

function wallTiles(): TileSpec[] {
  const walls: TileSpec[] = [];
  for (let y = 1; y <= WALL_ROWS; y++) walls.push([WALL_X, y]);
  return walls;
}

function healStage(opts: { walled?: boolean } = {}) {
  const stage = buildStage(opts.walled === false ? [] : wallTiles());
  const addHealer = (tileX: number, tileY: number, level = 1): HealingFairy => {
    const mob = stage.add('fairy_healer', tileX, tileY);
    if (!(mob instanceof HealingFairy)) throw new Error('fairy_healer is not a HealingFairy');
    if (level > 1) mob.applyMobLevel(level);
    return mob;
  };
  const tick = (healer: HealingFairy, frames: number): void => {
    for (let i = 0; i < frames; i++) {
      const oldX = healer.x;
      const oldY = healer.y;
      healer.updateAI(stage.party());
      stage.roster.grid.move(healer, oldX, oldY);
    }
  };
  return { ...stage, addHealer, tick };
}

const wound = (mob: Mob, share: number): void => {
  mob.hp = Math.max(1, Math.round(mob.maxHp * share));
};

/**
 * `HealingFairy`'s choice of ally, copied with one of its guards removed, for
 * the negatives: `ignoreTrigger` heals anyone below full, `ignoreRefusal` casts
 * on an ally that refuses damage.
 */
function makeCarelessHealer(breakage: { ignoreTrigger?: boolean; ignoreRefusal?: boolean }) {
  return class CarelessHealer extends HealingFairy {
    protected override mostWoundedAlly(castable: boolean): Mob | null {
      const rangePx = this.tileSize * HEAL_RANGE_TILES;
      let best: Mob | null = null;
      let bestFraction = breakage.ignoreTrigger === true ? 1 : HEAL_TRIGGER_HP_FRACTION;
      for (const ally of this.allies) {
        const refusalBlocks = breakage.ignoreRefusal !== true && ally.refusesDamage;
        if (!ally.isAlive || refusalBlocks || ally.maxHp <= 0) continue;
        const fraction = ally.hp / ally.maxHp;
        if (fraction >= bestFraction) continue;
        const roomUnderCeiling = Math.min(ally.maxHp, ally.fairyHealCeiling) - ally.hp;
        if (roomUnderCeiling <= 0) continue;
        if (castable && (this.distanceTo(ally) > rangePx || !this.canSeeAlly(ally))) continue;
        best = ally;
        bestFraction = fraction;
      }
      return best;
    }
  };
}

const TriggerlessHealer = makeCarelessHealer({ ignoreTrigger: true });
const RefusalBlindHealer = makeCarelessHealer({ ignoreRefusal: true });

type HealerFactory = (tileX: number, tileY: number) => HealingFairy;

/** Places a healer built by `make` into the stage the way `addHealer` places a spawned one. */
function addMadeHealer(
  s: ReturnType<typeof healStage>,
  make: HealerFactory,
  tileX: number,
  tileY: number,
): HealingFairy {
  const healer = make(tileX, tileY);
  healer.setMap(s.map);
  s.roster.add(healer);
  return healer;
}

/**
 * A healer beside one ally scratched above the trigger share, on an ally big
 * enough that the scratch is a real wound.
 */
function scratchRun(make?: HealerFactory) {
  const s = healStage();
  const healer =
    make === undefined
      ? s.addHealer(HEALER_TILE, HEALER_TILE)
      : addMadeHealer(s, make, HEALER_TILE, HEALER_TILE);
  const scratched = new BigGoblin(
    HEALER_TILE + NEIGHBOR_OFFSET_TILES,
    HEALER_TILE,
    SCRATCHED_ALLY_MAX_HP,
  );
  scratched.setMap(s.map);
  s.roster.add(scratched);
  wound(scratched, SCRATCH_WOUND);
  const hp = scratched.hp;
  let cast = false;
  for (let frame = 0; frame < FIRST_HEAL_FRAMES * SCRATCH_WATCH_WINDOWS; frame++) {
    s.tick(healer, 1);
    if (healer.activeCast !== null) cast = true;
  }
  return {
    reallyWounded: hp < scratched.maxHp && hp / scratched.maxHp > HEAL_TRIGGER_HP_FRACTION,
    untouched: !cast && scratched.hp === hp,
    detail: `${hp}/${scratched.maxHp}, trigger ${HEAL_TRIGGER_HP_FRACTION}`,
  };
}

/**
 * A healer beside one badly hurt ally that is rising from the dead and so
 * refuses damage, watched for any cast aimed at it.
 */
function risingAllyRun(make?: HealerFactory) {
  const s = healStage();
  const healer =
    make === undefined
      ? s.addHealer(HEALER_TILE, HEALER_TILE)
      : addMadeHealer(s, make, HEALER_TILE, HEALER_TILE);
  const rising = s.add('goblin', HEALER_TILE + NEIGHBOR_OFFSET_TILES, HEALER_TILE);
  rising.takeDamageFrom(LETHAL_BLOW, s.pm.human);
  rising.justDied = false;
  s.roster.grid.remove(rising);
  rising.reviveInPlace(BAD_WOUND, s.roster.grid);
  const hp = rising.hp;
  let refusedThroughout = true;
  let castsOnRising = 0;
  for (let frame = 0; frame < FIRST_HEAL_FRAMES; frame++) {
    s.tick(healer, 1);
    if (!rising.refusesDamage) refusedThroughout = false;
    const cast = healer.activeCast;
    if (cast?.phase === 'release' && cast.target === rising) castsOnRising++;
  }
  return {
    refusedThroughout,
    neverCastOn: castsOnRising === 0 && rising.hp === hp,
    detail: `${castsOnRising} casts aimed at it`,
  };
}

function checkTargetChoice(report: FairyGateReport): void {
  const pickFirstHealed = (walled: boolean) => {
    const s = healStage({ walled });
    const healer = s.addHealer(HEALER_TILE, HEALER_TILE);
    const lightly = s.add('goblin', HEALER_TILE - NEIGHBOR_OFFSET_TILES, HEALER_TILE);
    const badly = s.add('goblin', HEALER_TILE, HEALER_TILE + NEIGHBOR_OFFSET_TILES);
    const behindWall = s.add('goblin', BEHIND_WALL_X, HEALER_TILE);
    const outOfRange = s.add(
      'goblin',
      HEALER_TILE,
      HEALER_TILE + HEAL_RANGE_TILES * OUT_OF_RANGE_FACTOR,
    );
    const unhurt = s.add('goblin', HEALER_TILE, HEALER_TILE - NEIGHBOR_OFFSET_TILES);
    wound(lightly, LIGHT_WOUND);
    wound(badly, BAD_WOUND);
    wound(behindWall, WORST_WOUND);
    wound(outOfRange, WORST_WOUND);
    const all = [lightly, badly, behindWall, outOfRange, unhurt];
    const before = new Map(all.map((mob) => [mob, mob.hp]));
    let healedOnRelease = false;
    for (let frame = 0; frame < FIRST_HEAL_FRAMES; frame++) {
      const hpBefore = badly.hp;
      s.tick(healer, 1);
      if (badly.hp > hpBefore) healedOnRelease = healer.activeCast?.phase === 'release';
    }
    const healed = all.filter((mob) => mob.hp !== before.get(mob));
    const badlyGain = badly.hp - (before.get(badly) ?? 0);
    const expected = Math.min(
      healingFairyHealAmount(1, badly.maxHp, false),
      badly.maxHp - (before.get(badly) ?? 0),
    );
    return { healed, badly, behindWall, badlyGain, expected, healedOnRelease };
  };
  const walled = pickFirstHealed(true);
  report.check(
    walled.healed.length === 1 && walled.healed[0] === walled.badly,
    'the first heal lands on the most wounded ally in range and in sight, and only there',
    `${walled.healed.length} healed`,
  );
  report.check(walled.healedOnRelease, 'the heal lands on the frame its cast releases');
  report.check(
    Math.abs(walled.badlyGain - walled.expected) < RATE_EPSILON,
    'one heal restores the published amount',
    `${walled.badlyGain} vs ${walled.expected}`,
  );
  const open = pickFirstHealed(false);
  report.checkCatches(
    open.healed.length === 1 && open.healed[0] === open.badly,
    'with the wall gone, the choice is caught going to the ally the wall had hidden',
    open.healed.includes(open.behindWall) ? 'the hidden ally was healed' : 'still the same ally',
  );

  const scratch = scratchRun();
  report.check(
    scratch.reallyWounded && scratch.untouched,
    'no heal is cast on an ally wounded, but above the trigger share',
    scratch.detail,
  );
  const triggerless = scratchRun((x, y) => new TriggerlessHealer(x, y, TILE_SIZE));
  report.checkCatches(
    triggerless.reallyWounded && triggerless.untouched,
    'a healer that ignores the trigger share is caught casting on the scratched ally',
    triggerless.detail,
  );
}

interface BossCeilingRun {
  /** Whether the heals lifted the boss all the way to its line, so the line was what stopped them. */
  readonly reachedLine: boolean;
  /** Whether the line read at the start of the run sits below the boss's max HP at all. */
  readonly hasLine: boolean;
  readonly breaches: number;
  readonly detail: string;
}

/**
 * Heals `boss` for {@link BOSS_HEAL_SECONDS} with its own AI running, and
 * counts every frame a heal lifted it past its phase line. The line is read
 * once, off the boss as it stands wounded past its first phase before any heal
 * lands, and held fixed for the whole run: a ceiling re-read every frame would
 * be the getter under test grading itself, and one that regressed to max HP
 * mid-fight would pass. A boss whose line is not below its max HP has no line
 * to hold, and fails outright.
 */
function bossCeilingRun(makeBoss: (s: ReturnType<typeof healStage>) => Mob): BossCeilingRun {
  const s = healStage({ walled: false });
  const healer = s.addHealer(HEALER_TILE, HEALER_TILE);
  const boss = makeBoss(s);
  boss.isBoss = true;
  wound(boss, BOSS_START_SHARE);
  const start = boss.hp;
  const line = boss.fairyHealCeiling;
  let reachedLine = false;
  let breaches = 0;
  let worst = '';
  const holdX = boss.x;
  const holdY = boss.y;
  for (let frame = 0; frame < FRAMES_PER_SECOND * BOSS_HEAL_SECONDS; frame++) {
    const hpBefore = boss.hp;
    boss.updateAI([]);
    // Held beside the healer: a boss with nobody to fight wanders, and a run
    // that drifts out of heal range measures the wander rather than the line.
    const driftedX = boss.x;
    const driftedY = boss.y;
    boss.x = holdX;
    boss.y = holdY;
    s.roster.grid.move(boss, driftedX, driftedY);
    s.tick(healer, 1);
    if (boss.hp >= line) reachedLine = true;
    if (boss.hp > hpBefore) {
      if (boss.hp > Math.max(line, hpBefore)) {
        breaches++;
        worst = `, ${hpBefore} → ${boss.hp} past it`;
      }
    }
  }
  return {
    reachedLine,
    hasLine: line < boss.maxHp,
    breaches,
    detail: `${start} → ${boss.hp}/${boss.maxHp}, line ${line}, ${breaches} breaches${worst}`,
  };
}

const heldUnderLine = (run: BossCeilingRun): boolean =>
  run.hasLine && run.reachedLine && run.breaches === 0;

/** The Lich's battle, with nothing to show its barks and banners on: they are never raised here. */
const SILENT_LICH_HOOKS: LichBattleHooks = {
  openBark: (_pages, onClosed) => onClosed(),
  showBanner: () => undefined,
};

/**
 * A phased boss by spawn key beside the healer. The Lich's phase line is
 * reported by the battle that choreographs it, and a Lich with no battle
 * attached has none, so it gets one.
 */
function addPhasedBoss(s: ReturnType<typeof healStage>, key: string): Mob {
  const boss = s.add(key, HEALER_TILE + NEIGHBOR_OFFSET_TILES, HEALER_TILE);
  if (boss instanceof TheLich) new LichBattleSystem(s.map, boss, null, null, SILENT_LICH_HOOKS);
  return boss;
}

/** A goblin authored at `maxHp`, so a small share of it is still a whole wound. */
class BigGoblin extends Goblin {
  constructor(tileX: number, tileY: number, maxHp: number) {
    super(tileX, tileY, TILE_SIZE, GOBLIN_WEAPON);
    this.setFixedMaxHp(maxHp);
  }
}

/** A goblin the size of a boss, so the heal cap and not its share of HP sets every heal. */
class HugeGoblin extends Goblin {
  constructor(tileX: number, tileY: number) {
    super(tileX, tileY, TILE_SIZE, GOBLIN_WEAPON);
    this.setFixedMaxHp(HUGE_BOSS_MAX_HP);
  }
}

/** A Hoarder whose heal ceiling has been lost: it reports its whole max HP. */
class CeilinglessHoarder extends TheHoarder {
  override get fairyHealCeiling(): number {
    return this.maxHp;
  }
}

function checkBossHealing(report: FairyGateReport): void {
  for (const key of PHASED_BOSS_KEYS) {
    const run = bossCeilingRun((s) => addPhasedBoss(s, key));
    report.check(
      heldUnderLine(run),
      `${key}: healed up to the phase line it stood under, and never past it`,
      run.detail,
    );
  }
  const mutant = bossCeilingRun((s) => {
    const hoarder = new CeilinglessHoarder(
      HEALER_TILE + NEIGHBOR_OFFSET_TILES,
      HEALER_TILE,
      TILE_SIZE,
    );
    hoarder.setMap(s.map);
    s.roster.add(hoarder);
    return hoarder;
  });
  report.checkCatches(
    heldUnderLine(mutant),
    'a Hoarder that has lost its heal ceiling is caught healed back past its enrage line',
    mutant.detail,
  );

  const perHeal = healingFairyHealAmount(1, SHARE_BOUND_MAX_HP, true);
  const regular = healingFairyHealAmount(1, SHARE_BOUND_MAX_HP, false);
  report.precondition(
    perHeal < regular,
    'the published heal gives a boss less than a regular mob of the same size',
    `${perHeal} vs ${regular}`,
  );

  const rising = risingAllyRun();
  report.check(
    rising.refusedThroughout && rising.neverCastOn,
    'an ally refusing damage is never cast on',
    rising.detail,
  );
  const refusalBlind = risingAllyRun((x, y) => new RefusalBlindHealer(x, y, TILE_SIZE));
  report.checkCatches(
    refusalBlind.refusedThroughout && refusalBlind.neverCastOn,
    'a healer that ignores a refusal to take damage is caught casting on the rising ally',
    refusalBlind.detail,
  );
}

function referencePartyDamagePerSecond(partyLevel: number): number {
  let perSecond = 0;
  for (const crawler of REFERENCE_CRAWLERS) {
    const { attackCycle } = referenceStats(crawler, REFERENCE_PARTY_BUILD, partyLevel);
    const damage = attackCycle.reduce((sum, attack) => sum + attack.damage, 0);
    const frames = attackCycle.reduce((sum, attack) => sum + attack.frames, 0);
    perSecond += (damage / frames) * FRAMES_PER_SECOND;
  }
  return perSecond;
}

type HealRate = (level: number, maxHp: number, isBoss: boolean, curve: LevelledCurve) => number;

function worstShare(rate: HealRate): { share: number; where: string } {
  let share = 0;
  let where = '';
  for (let level = 1; level <= MAX_MOB_LEVEL; level++) {
    const partyDps = referencePartyDamagePerSecond(level);
    for (const [curveName, curve] of CURVES) {
      for (const maxHp of TARGET_MAX_HPS) {
        for (const isBoss of [false, true]) {
          const here = rate(level, maxHp, isBoss, curve) / partyDps;
          if (here > share) {
            share = here;
            where = `L${level} ${curveName} maxHp ${maxHp}${isBoss ? ' boss' : ''}`;
          }
        }
      }
    }
  }
  return { share, where };
}

/** The heal rate with its level cap taken away: a share of any target's max HP, however big. */
const uncappedRate: HealRate = (level, maxHp, isBoss) =>
  (maxHp * HEAL_FRACTION_OF_TARGET_MAX_HP * (isBoss ? BOSS_HEAL_SCALE : 1) * FRAMES_PER_SECOND) /
  healingFairyCooldownFrames(level);

function checkHealRate(report: FairyGateReport): void {
  const bound = worstShare(healingFairyHealPerSecond);
  report.check(
    bound.share <= HEAL_MAX_SHARE_OF_PARTY_DPS,
    `one healer's heal/sec stays under ${HEAL_MAX_SHARE_OF_PARTY_DPS} of the reference party's DPS at every level 1..${MAX_MOB_LEVEL}`,
    `worst ${bound.share.toFixed(DECIMALS)} at ${bound.where}`,
  );
  const mutant = worstShare(uncappedRate);
  report.checkCatches(
    mutant.share <= HEAL_MAX_SHARE_OF_PARTY_DPS,
    'a heal with no level cap is caught outhealing the party',
    `worst ${mutant.share.toFixed(DECIMALS)} at ${mutant.where}`,
  );

  // The bound above is on the published rate; this holds the real healer to it.
  const real = measuredHealRate();
  report.precondition(real.warmedUp, 'the measured healer lands its first heal');
  report.check(
    real.measured > 0 && real.measured <= real.published + RATE_EPSILON,
    'what a real healer restores per second never beats the published rate',
    `measured ${real.measured.toFixed(DECIMALS)}, published ${real.published.toFixed(DECIMALS)}`,
  );
  const hasty = measuredHealRate((x, y) => new HastyHealer(x, y, TILE_SIZE));
  report.checkCatches(
    hasty.measured > 0 && hasty.measured <= hasty.published + RATE_EPSILON,
    `a healer whose cooldown runs ${HASTY_COOLDOWN_FRAMES} frames short is caught beating the published rate`,
    `measured ${hasty.measured.toFixed(DECIMALS)}, published ${hasty.published.toFixed(DECIMALS)}`,
  );
}

/** A healer that recovers from each cast a little sooner than its level allows. */
class HastyHealer extends HealingFairy {
  protected override cooldownFramesFor(cast: FairyCast): number {
    return super.cooldownFramesFor(cast) - HASTY_COOLDOWN_FRAMES;
  }
}

/**
 * HP per second a healer at {@link MEASURED_RATE_LEVEL} restores to a huge
 * boss held wounded, against the published rate. The window opens the frame
 * after the first heal lands: a fresh healer casts the moment it sees a
 * wound, and that head start is not a rate.
 */
function measuredHealRate(make?: HealerFactory): {
  warmedUp: boolean;
  measured: number;
  published: number;
} {
  const s = healStage({ walled: false });
  let healer: HealingFairy;
  if (make === undefined) {
    healer = s.addHealer(HEALER_TILE, HEALER_TILE, MEASURED_RATE_LEVEL);
  } else {
    healer = addMadeHealer(s, make, HEALER_TILE, HEALER_TILE);
    healer.applyMobLevel(MEASURED_RATE_LEVEL);
  }
  const hugeBoss = new HugeGoblin(HEALER_TILE + NEIGHBOR_OFFSET_TILES, HEALER_TILE);
  hugeBoss.setMap(s.map);
  s.roster.add(hugeBoss);
  hugeBoss.isBoss = true;
  const healOnce = (): number => {
    hugeBoss.hp = hugeBoss.maxHp * HELD_WOUND_SHARE;
    const before = hugeBoss.hp;
    s.tick(healer, 1);
    return hugeBoss.hp - before;
  };
  let warmedUp = false;
  for (let frame = 0; frame < FIRST_HEAL_FRAMES && !warmedUp; frame++) {
    warmedUp = healOnce() > 0;
  }
  let restored = 0;
  for (let frame = 0; frame < FRAMES_PER_SECOND * MEASURED_RATE_SECONDS; frame++) {
    restored += healOnce();
  }
  const published = healingFairyHealPerSecond(
    MEASURED_RATE_LEVEL,
    hugeBoss.maxHp,
    true,
    healer.levelledCurve,
  );
  return { warmedUp, measured: restored / MEASURED_RATE_SECONDS, published };
}

/** A healer whose heal lands some frames after its cast released. */
class DelayedHealer extends HealingFairy {
  private pending: { cast: ActiveFairyCast; framesLeft: number } | null = null;

  protected override onCastReleased(cast: ActiveFairyCast): void {
    this.pending = { cast, framesLeft: PROBE_HEAL_DELAY_FRAMES };
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    const pending = this.pending;
    if (pending === null) return;
    pending.framesLeft--;
    if (pending.framesLeft > 0) return;
    this.pending = null;
    super.onCastReleased(pending.cast);
  }
}

/** A healer that holds its position for as long as a cast is playing. */
class StillCastingHealer extends HealingFairy {
  override updateAI(targets: Player[]): void {
    const heldX = this.x;
    const heldY = this.y;
    super.updateAI(targets);
    if (this.activeCast === null) return;
    this.x = heldX;
    this.y = heldY;
  }
}

interface ChaseHealRun {
  /** Frames from the wound to the heal landing, or -1. */
  readonly healedAfter: number;
  readonly landedOnRelease: boolean;
  /** Frames around the release on which the healer stood still. */
  readonly stillFrames: number;
  readonly watchedFrames: number;
}

/**
 * A healer with two allies below it while a human walks at it. Once the
 * healer is flying from the human, one ally is badly wounded, and the heal
 * that follows is watched: when it lands against the cast's release, and
 * whether the healer was moving through the frames around it.
 */
function chaseHealRun(make?: HealerFactory): ChaseHealRun {
  const s = healStage({ walled: false });
  const healer =
    make === undefined
      ? s.addHealer(HEALER_TILE, HEALER_TILE)
      : addMadeHealer(s, make, HEALER_TILE, HEALER_TILE);
  s.add('goblin', HEALER_TILE + ADJACENT_TILES, HEALER_TILE + CHASE_ALLY_BELOW_TILES);
  const hurt = s.add('goblin', HEALER_TILE - ADJACENT_TILES, HEALER_TILE + CHASE_ALLY_BELOW_TILES);
  const human = s.pm.human;
  placeOnTile(human, HEALER_TILE, HEALER_TILE - CHASER_START_TILES);
  const moves: number[] = [];
  const step = (): void => {
    const dx = healer.x - human.x;
    const dy = healer.y - human.y;
    const gap = Math.hypot(dx, dy);
    if (gap > CHASER_STOP_PX) {
      human.x += (dx / gap) * CHASER_STEP_PX;
      human.y += (dy / gap) * CHASER_STEP_PX;
    }
    const oldX = healer.x;
    const oldY = healer.y;
    s.tick(healer, 1);
    moves.push(Math.hypot(healer.x - oldX, healer.y - oldY));
  };
  for (let frame = 0; frame < CHASE_WARMUP_FRAMES; frame++) step();
  wound(hurt, BAD_WOUND);
  const woundIndex = moves.length;
  let healedAfter = -1;
  let landedOnRelease = false;
  for (let frame = 1; frame <= FIRST_HEAL_FRAMES && healedAfter < 0; frame++) {
    const hp = hurt.hp;
    step();
    if (hurt.hp <= hp) continue;
    healedAfter = frame;
    landedOnRelease = healer.activeCast?.phase === 'release';
  }
  for (let frame = 0; frame < FAIRY_CAST_RECOVER_FRAMES; frame++) step();
  const healIndex = woundIndex + healedAfter - 1;
  const watched =
    healedAfter < 0
      ? []
      : moves.slice(
          healIndex - MOVING_BEFORE_RELEASE_FRAMES,
          healIndex + FAIRY_CAST_RECOVER_FRAMES,
        );
  return {
    healedAfter,
    landedOnRelease,
    stillFrames: watched.filter((moved) => moved < STILL_PX).length,
    watchedFrames: watched.length,
  };
}

const describeChase = (run: ChaseHealRun): string =>
  `heal ${run.healedAfter} frames after the wound, on release ${run.landedOnRelease}, ` +
  `still on ${run.stillFrames} of ${run.watchedFrames} frames`;

function checkHealInFlight(report: FairyGateReport): void {
  const run = chaseHealRun();
  report.check(
    run.healedAfter > 0 && run.landedOnRelease,
    'a heal cast in flight lands on the frame its cast releases',
    describeChase(run),
  );
  report.check(
    run.watchedFrames > 0 && run.stillFrames === 0,
    'the healer keeps flying from an approaching crawler through the frames around its cast',
    describeChase(run),
  );
  const delayed = chaseHealRun((x, y) => new DelayedHealer(x, y, TILE_SIZE));
  report.checkCatches(
    delayed.healedAfter > 0 && delayed.landedOnRelease,
    `a heal that lands ${PROBE_HEAL_DELAY_FRAMES} frames after its release is caught`,
    describeChase(delayed),
  );
  const still = chaseHealRun((x, y) => new StillCastingHealer(x, y, TILE_SIZE));
  report.checkCatches(
    still.watchedFrames > 0 && still.stillFrames === 0,
    'a healer that holds still while its cast plays is caught standing',
    describeChase(still),
  );
}

function checkDeathWave(report: FairyGateReport): void {
  const waveRun = (reportDeath: boolean) => {
    const s = healStage({ walled: false });
    const healer = s.addHealer(HEALER_TILE, HEALER_TILE);
    const wounded = s.add('goblin', HEALER_TILE + WAVE_OFFSET_TILES, HEALER_TILE);
    const full = s.add('goblin', HEALER_TILE, HEALER_TILE + WAVE_OFFSET_TILES);
    const boss = s.add('goblin', HEALER_TILE - WAVE_OFFSET_TILES, HEALER_TILE);
    const outsideTiles = Math.ceil(HEAL_WAVE_RADIUS_TILES) + OUTSIDE_WAVE_MARGIN_TILES;
    const far = s.add('goblin', HEALER_TILE + outsideTiles, HEALER_TILE);
    boss.isBoss = true;
    wounded.hp = 1;
    boss.hp = 1;
    far.hp = 1;
    if (reportDeath) s.kill(healer);
    else healer.takeDamageFrom(Number.MAX_SAFE_INTEGER, s.pm.human);
    for (let frame = 0; frame < HEAL_WAVE_EXPAND_FRAMES + WAVE_SETTLE_FRAMES; frame++)
      s.fairies.update(s.ctx());
    const overheal = full.statusEffects.find((effect) => effect.type === OVERHEAL_STATUS);
    return { wounded, full, boss, far, overheal };
  };
  const wave = waveRun(true);
  report.check(
    wave.wounded.hp === wave.wounded.maxHp,
    'the death wave heals a wounded regular mob to full',
    `${wave.wounded.hp}/${wave.wounded.maxHp}`,
  );
  const expectedOverheal = Math.round(wave.full.maxHp * OVERHEAL_MAX_HP_FRACTION);
  report.check(
    wave.overheal?.absorbRemaining === expectedOverheal,
    'a full-HP regular mob gains exactly half its max HP as overheal',
    `${wave.overheal?.absorbRemaining} vs ${expectedOverheal}`,
  );
  report.check(
    wave.boss.hp === 1 && !wave.boss.hasStatus(OVERHEAL_STATUS),
    'a boss is left unchanged by the wave',
  );
  report.check(wave.far.hp === 1, 'a mob outside the wave radius is untouched');
  const silent = waveRun(false);
  report.checkCatches(
    silent.wounded.hp === silent.wounded.maxHp,
    'a death that never reaches the kill path is caught releasing no wave',
    `${silent.wounded.hp}/${silent.wounded.maxHp}`,
  );
}

/** A Krakaren that only counts itself past its enrage line strictly below it. */
class StrictLineKrakaren extends KrakarenClone {
  override get fairyHealCeiling(): number {
    const line = super.fairyHealCeiling;
    return this.isEnraged || this.hp < line ? line : this.maxHp;
  }
}

/** Far more than any Krakaren's max HP, so only the ceiling limits the heal. */
const OVERSIZED_HEAL = 1e6;

interface EnrageLineRead {
  readonly line: number;
  readonly maxHp: number;
  readonly ceilingAtLine: number;
  readonly ceilingAboveLine: number;
  readonly healedAtLine: number;
}

/**
 * The Krakaren's heal ceiling read at its enrage line exactly. The line is
 * read off the boss itself — the ceiling it reports once badly hurt — and
 * confirmed as the boundary by the ceiling one HP above it.
 */
function krakarenAtEnrageLine(make?: (tileX: number, tileY: number) => KrakarenClone) {
  const s = buildStage();
  let boss: Mob;
  if (make === undefined) {
    boss = s.add('krakaren_clone', HEALER_TILE, HEALER_TILE);
  } else {
    boss = make(HEALER_TILE, HEALER_TILE);
    s.roster.add(boss);
  }
  boss.hp = 1;
  const line = boss.fairyHealCeiling;
  boss.hp = line + ONE_HP;
  const ceilingAboveLine = boss.fairyHealCeiling;
  boss.hp = line;
  const ceilingAtLine = boss.fairyHealCeiling;
  const healedAtLine = applyFairyHeal(boss, OVERSIZED_HEAL);
  const read: EnrageLineRead = {
    line,
    maxHp: boss.maxHp,
    ceilingAtLine,
    ceilingAboveLine,
    healedAtLine,
  };
  return read;
}

function checkKrakarenEnrageLine(report: FairyGateReport): void {
  const heldAtLine = (read: EnrageLineRead): boolean =>
    read.line < read.maxHp &&
    read.ceilingAboveLine === read.maxHp &&
    read.ceilingAtLine === read.line &&
    read.healedAtLine === 0;
  const read = krakarenAtEnrageLine();
  report.check(
    heldAtLine(read),
    'a Krakaren standing exactly on its enrage line is held there: the ceiling is the line, not full HP',
    `line ${read.line}/${read.maxHp}, ceiling ${read.ceilingAtLine}, healed ${read.healedAtLine}`,
  );
  const strict = krakarenAtEnrageLine((x, y) => new StrictLineKrakaren(x, y, TILE_SIZE));
  report.checkCatches(
    heldAtLine(strict),
    'a Krakaren counting the line itself as above it is caught healed back to full',
    `ceiling ${strict.ceilingAtLine}, healed ${strict.healedAtLine}`,
  );
}

/** The top-left tile, on both axes, of a camera view that shows none of the healer's corner. */
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
const HEAL_BLOOM_SOUND: SoundId = 'fairy_heal_bloom';
const HEAL_WAVE_SOUND: SoundId = 'fairy_heal_wave';

/** A healer that counts itself on screen wherever the camera is. */
class ScreenBlindHealer extends HealingFairy {
  override get isOnScreen(): boolean {
    return true;
  }
}

/** A cue player that writes down what it was asked to play. */
function soundRecorder(): FairyCuePlayer & { readonly played: SoundId[] } {
  const played: SoundId[] = [];
  return { played, play: (id) => void played.push(id) };
}

interface MutedRun {
  /** Whether the badly hurt ally beside the healer was healed. */
  readonly healed: boolean;
  /** Whether the healer's death wave healed the second ally. */
  readonly waveHealed: boolean;
  readonly played: readonly SoundId[];
}

/**
 * A healer beside a badly hurt goblin, under `view`, with its cast and system
 * cues drained into a recorder every frame the way the scene drains them; once
 * it has healed, it is killed beside a second hurt goblin and its wave run out.
 */
function mutedRun(view: VisibleWorldView, make?: HealerFactory): MutedRun {
  const s = healStage({ walled: false });
  const healer =
    make === undefined
      ? s.addHealer(HEALER_TILE, HEALER_TILE)
      : addMadeHealer(s, make, HEALER_TILE, HEALER_TILE);
  const hurt = s.add('goblin', HEALER_TILE + NEIGHBOR_OFFSET_TILES, HEALER_TILE);
  wound(hurt, BAD_WOUND);
  const hurtHp = hurt.hp;
  setVisibleWorldView(view);
  const recorder = soundRecorder();
  for (let frame = 0; frame < FIRST_HEAL_FRAMES && hurt.hp === hurtHp; frame++) {
    s.tick(healer, 1);
    playFairyCastCues(healer, recorder);
  }
  const healed = hurt.hp > hurtHp;
  const waveTarget = s.add('goblin', HEALER_TILE, HEALER_TILE + WAVE_OFFSET_TILES);
  waveTarget.hp = ONE_HP;
  s.kill(healer);
  for (let frame = 0; frame < HEAL_WAVE_EXPAND_FRAMES + WAVE_SETTLE_FRAMES; frame++) {
    s.fairies.update(s.ctx());
    playFairySystemCues(s.fairies.takeCues(), recorder);
  }
  setVisibleWorldView(WHOLE_ARENA_VIEW);
  return { healed, waveHealed: waveTarget.hp > ONE_HP, played: recorder.played };
}

const describeMuted = (run: MutedRun): string =>
  `healed ${run.healed}, wave healed ${run.waveHealed}, played ${run.played.join(', ') || 'nothing'}`;

function checkMutedOffScreen(report: FairyGateReport): void {
  const seen = mutedRun(WHOLE_ARENA_VIEW);
  report.check(
    seen.healed && seen.played.includes(HEAL_BLOOM_SOUND),
    'on screen, a heal sounds its bloom',
    describeMuted(seen),
  );
  report.check(
    seen.waveHealed && seen.played.includes(HEAL_WAVE_SOUND),
    'on screen, the death wave sounds',
    describeMuted(seen),
  );
  const unseen = mutedRun(OFF_SCREEN_VIEW);
  report.check(
    unseen.healed && unseen.waveHealed,
    'off screen, the healer still heals and its death wave still heals',
    describeMuted(unseen),
  );
  report.check(
    !unseen.played.includes(HEAL_BLOOM_SOUND) && !unseen.played.includes(HEAL_WAVE_SOUND),
    'off screen, neither the heal nor the death wave makes a sound',
    describeMuted(unseen),
  );
  const blind = mutedRun(OFF_SCREEN_VIEW, (x, y) => new ScreenBlindHealer(x, y, TILE_SIZE));
  report.checkCatches(
    !blind.played.includes(HEAL_BLOOM_SOUND),
    'a healer that counts itself on screen anywhere is caught sounding its heal off screen',
    describeMuted(blind),
  );
  report.checkCatches(
    !blind.played.includes(HEAL_WAVE_SOUND),
    'the same healer is caught sounding its death wave off screen',
    describeMuted(blind),
  );
}

export function verifyHealingFairy(report: FairyGateReport): void {
  report.section('Healing fairy');
  checkTargetChoice(report);
  checkBossHealing(report);
  checkKrakarenEnrageLine(report);
  checkHealRate(report);
  checkHealInFlight(report);
  checkDeathWave(report);
  checkMutedOffScreen(report);
}
