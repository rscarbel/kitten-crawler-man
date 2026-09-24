/**
 * The shield fairy, in life and in death, through its real AI, the real damage
 * path and `FairySystem`.
 *
 * - A ward laid by a real cast keeps its carrier from all harm while the fairy
 *   lives: a crawler's blow, a status tick, a missile, an explosion. Struck,
 *   the carrier raises an "Invulnerable" label, once per throttle window
 *   however many blows land in it.
 * - The ward is laid on the frame the cast releases, and the fairy flies on
 *   through the cast rather than standing still for it.
 * - It wards exactly one more ally than its potency at every sampled level and
 *   difficulty, the potency ceiling included, and never more; engaged allies
 *   first, then bosses, then the nearest; never through a wall, never an ally
 *   that is immune anyway, and never an ally another living fairy already wards.
 * - It never wards another shield fairy, not even when that fairy is the only
 *   candidate and the candidate list was built with fairies in it: two shield
 *   fairies warding each other would both be invulnerable forever.
 * - It casts only while it is inside the camera view the scene publishes, so
 *   every ward, and its sound, happens on screen. The view is the real
 *   window: a desktop screen watches it from 10+ tiles off where a phone does
 *   not, a camera pinned at a map edge watches it far from the crawler, a
 *   wall on screen hides nothing, fog does, and with no view published it
 *   casts nothing. Only the active crawler's camera counts. It wards on the
 *   first frame it is in view, and a dead ally is replaced only once it is
 *   back in view.
 * - A warded ally that dies or leaves frees its slot for the next, and a
 *   called-off fight empties its ward list.
 * - Its death strips every ward it held on the same frame, so the next blow
 *   lands, and chains an aegis to every hostile in reach, bosses included:
 *   half damage for exactly `AEGIS_DURATION_FRAMES`, then nothing; a second
 *   aegis refreshes the first.
 */

import { TILE_SIZE } from '../../src/core/constants';
import type { Difficulty } from '../../src/core/difficultyProfiles';
import type { FloatingTextStyle } from '../../src/core/FloatingText';
import {
  FAIRY_AEGIS_STATUS,
  FAIRY_WARD_STATUS,
  makeBurn,
  makeFairyAegis,
  makeFairyWard,
  makeShield,
  type StatusEffect,
} from '../../src/core/StatusEffect';
import { Goblin } from '../../src/creatures/Goblin';
import type { Mob, PlayerDamageType } from '../../src/creatures/Mob';
import type { Player } from '../../src/Player';
import type { ActiveFairyCast, FairyCastIntent } from '../../src/creatures/fairies/Fairy';
import { ShieldFairy, WARD_CAST } from '../../src/creatures/fairies/ShieldFairy';
import { setPackAlertGrid } from '../../src/creatures/packAlert';
import {
  applyFairyWardFrom,
  canTakeWardFrom,
  fairyWardOn,
  isWardedBy,
} from '../../src/creatures/fairies/fairyWards';
import { collectFairyAllies } from '../../src/creatures/fairies/fairyAllies';
import { fairyPotencyCount, shieldWardCount } from '../../src/creatures/fairies/fairyPotency';
import {
  AEGIS_CHAIN_RADIUS_TILES,
  AEGIS_DAMAGE_SCALE,
  AEGIS_DURATION_FRAMES,
  FAIRY_ALLY_SEARCH_TILES,
  FAIRY_CAST_RECOVER_FRAMES,
  FAIRY_LEVELS_PER_EXTRA_TARGET,
  FAIRY_MAX_POTENCY,
} from '../../src/creatures/fairies/fairyTuning';
import {
  isWorldPointInView,
  setVisibleWorldView,
  visibleWorldView,
  type WorldSight,
} from '../../src/core/visibleWorldView';
import { MAX_MOB_LEVEL } from '../../src/levels/spawner';
import { FloatingCombatTextSystem } from '../../src/systems/FloatingCombatTextSystem';
import type { FairyGateReport } from './report';
import {
  ARENA_TILES,
  buildStage,
  centreOf,
  DESKTOP_SCREEN,
  followCameraView,
  PARK_TILE,
  PHONE_SCREEN,
  placeOnTile,
  type ScreenSize,
  type Stage,
  type TileSpec,
} from './stage';
import { DIFFICULTIES } from './spawnTables';

const FAIRY_TILE = 10;
/**
 * Offsets, in tiles, that put an ally further from the fairy than the one it
 * should ward first, so a nearest-first picker could not pass the priority
 * case by accident.
 */
const FAR_SIDE_TILES = 3;
const FARTHEST_TILES = 4;
/** Tiles from the fairy an ally stands at: inside ward range, clear of the fairy's own tile. */
const NEIGHBOR_OFFSET_TILES = 2;
/** A single tile off the fairy: nearer than any other ally in the case. */
const ADJACENT_TILES = 1;
/**
 * The last row, exclusive, of the wall column that seals the fairy off from
 * the far side: the arena's south wall, so the fairy cannot fly round its end
 * and ward from the near side while still on screen.
 */
const SEALING_WALL_END_ROW = ARENA_TILES - 1;
/** Tiles past the sealing wall the ally stands. */
const BEHIND_WALL_TILES = 2;
/** Aegis lengths the halving is watched over, so the frame it stops shows. */
const AEGIS_WATCH_SPANS = 2;
/**
 * Frames a first aegis runs before the second lands: long enough that a
 * refresh, a second aegis ignored and one stacked all leave different totals.
 */
const AEGIS_REFRESH_GAP_FRAMES = 100;
/** A level whose potency on hard is the ceiling, for the multi-ward cases. */
const HIGH_LEVEL = 16;
/**
 * Wards a shield fairy holds beyond its potency. Written here rather than read
 * from the tuning, so a tuning change that took the extra ward away shows red.
 */
const EXTRA_WARDS_OVER_POTENCY = 1;
/** Levels the ward count is sampled at: either side of every potency step, and the top level. */
const SAMPLED_LEVELS: readonly number[] = (() => {
  const levels = new Set<number>([1, MAX_MOB_LEVEL]);
  const firstStep = 1 + FAIRY_LEVELS_PER_EXTRA_TARGET;
  for (let step = firstStep; step <= MAX_MOB_LEVEL; step += FAIRY_LEVELS_PER_EXTRA_TARGET) {
    levels.add(step - 1);
    levels.add(step);
  }
  return [...levels].sort((a, b) => a - b);
})();
/** Frames two shield fairies are left side by side to (fail to) ward each other. */
const MUTUAL_WARD_FRAMES = 1200;
/** Goblins beside the two shield fairies in the among-allies case. */
const MUTUAL_CASE_GOBLINS = 2;
/** Frames granted for the first ward: a fresh fairy casts as soon as it sees an ally. */
const FIRST_WARD_FRAMES = 400;
/** Frames long enough for a fairy to fill every slot it has, several casts over. */
const FILL_FRAMES = 4000;
/** Frames a fairy sealed off by a wall is given to (fail to) ward the far side. */
const SEALED_FRAMES = 900;
/** The strongest blow a level-1 aegis test deals, so halving it is exact. */
const AEGIS_TEST_BLOW = 4;
/** A mob this far outside the chain radius, in tiles, must get no aegis. */
const OUTSIDE_CHAIN_MARGIN_TILES = 2;
const GOBLIN_WEAPON = 'sword';
/**
 * A status is live while its remaining ticks are zero or more, so it drops on
 * the tick after its last counted one.
 */
const STATUS_EXPIRY_TICK = 1;
/** The share of the carrier's max HP each direct blow in the protection run deals. */
const PROTECTION_BLOW_SHARE = 0.5;
/** Frames a burn is left ticking on the carrier: past its whole run. */
const BURN_WATCH_FRAMES = 540;
/** What a crawler's blow is dealt as, for each direct source the ward must hold off. */
const DIRECT_SOURCES: readonly PlayerDamageType[] = ['melee', 'missile', 'explosion'];
/** The pool of the ordinary absorbing shield the probe fairy lays in place of a ward. */
const PROBE_ABSORB = 1;
/** Long enough to outlast every measurement in the protection run. */
const PROBE_SHIELD_TICKS = 99_999;
/** The label a warded body raises when struck; matched by text, so its absence is measured too. */
const INVULNERABLE_LABEL = 'Invulnerable';
/**
 * Frames of the flurry, one burst of blows a frame: inside the ward label's
 * throttle window, so a throttled label shows exactly once over the lot.
 */
const FLURRY_FRAMES = 20;
const BLOWS_PER_FLURRY_FRAME = 3;
const FLURRY_BLOW = 1;
/** Frames the probe fairy lets pass between its cast releasing and its ward landing. */
const PROBE_WARD_DELAY_FRAMES = 6;
/** Tiles from the fairy the chasing human starts, north of it, inside its notice range. */
const CHASER_START_TILES = 5;
/**
 * Pixels the chasing human closes per frame: under the fairy's flutter speed,
 * so the fairy stays ahead and on the move rather than being caught.
 */
const CHASER_STEP_PX = 1.5;
/** The human stops closing once this near, so it never stands on the fairy. */
const CHASER_STOP_PX = TILE_SIZE;
/**
 * Frames the chase runs before the warded ally dies: long enough for the human
 * to have closed into flutter range, so the fairy is already flying from it.
 */
const CHASE_WARMUP_FRAMES = 150;
/** Frames after the death within which the fairy must lay its next ward. */
const REWARD_SEARCH_FRAMES = 300;
/** Frames before the release the fairy is watched moving over. */
const MOVING_BEFORE_RELEASE_FRAMES = 5;
/** Less than this many pixels in a frame counts as standing still. */
const STILL_PX = 0.5;
/** Tiles below the fairy the two chase allies stand, either side of it. */
const CHASE_ALLY_BELOW_TILES = 2;
/**
 * Tiles north of the fairy the human stands by default: well inside a phone
 * camera's view of the fairy, and past the fairy's flutter range so it is not
 * driven off before the case begins.
 */
const WATCHING_OFFSET_TILES = 4;
const WATCHING_TILE: TileSpec = [FAIRY_TILE, FAIRY_TILE - WATCHING_OFFSET_TILES];
/**
 * Tiles east of the fairy the crawler stands out of a phone's view: past the
 * half-width of a portrait phone, but inside the fairy's notice range, so the
 * fairy knows the party is there and still holds its casts.
 */
const OUT_OF_VIEW_TILES = 7;
/**
 * Tiles east of the fairy the crawler stands for the screen-size cases: a
 * desktop window shows the fairy from there and a phone does not.
 */
const DESKTOP_DISTANCE_TILES = 11;
/**
 * A fixed watched radius, in tiles: the half short side of the smallest phone.
 * A broken copy that watches through it in place of the live view shows the
 * desktop case needs the view.
 */
const FIXED_WATCHED_RANGE_TILES = 5;
/**
 * A square screen for the map-edge case: big enough that, pinned against the
 * arena's corner, it shows the fairy, and small enough that one centred on the
 * crawler would not.
 */
const EDGE_CASE_SCREEN: ScreenSize = { width: 480, height: 480 };
/** The crawler's tile for the map-edge case, near the arena's north-west corner. */
const EDGE_CASE_TILE = 2;
/** Clear sight, in tiles, the fog case leaves the crawler: short of the fairy. */
const FOGGED_SIGHT_TILES = 2;
/** Tiles north of the fairy the wall between it and the crawler runs. */
const SIGHT_WALL_ROW_OFFSET = 2;
/** Frames the fairy is left unwatched: several of its between-cast gaps. */
const UNSEEN_FRAMES = 900;
/**
 * Frames granted from the fairy coming into view to the ward landing: a fairy
 * that has not cast lately has no cooldown to wait out, so it wards at once.
 */
const SEEN_TO_WARD_FRAMES = 1;

class ImmuneGoblin extends Goblin {
  protected override get isDamageImmune(): boolean {
    return true;
  }
}

/** A goblin whose damage path ignores status damage scaling: the aegis cannot reach it. */
class AegisBlindGoblin extends Goblin {
  override get statusDamageScale(): number {
    return 1;
  }
}

/** A goblin that keeps the aegis it already holds and ignores a second. */
class AegisKeepingGoblin extends Goblin {
  override applyStatus(effect: StatusEffect): void {
    if (effect.type === FAIRY_AEGIS_STATUS && this.hasStatus(FAIRY_AEGIS_STATUS)) return;
    super.applyStatus(effect);
  }
}

/** A goblin that counts itself untouchable while any fairy ward is on it, living fairy or not. */
class WardTrustingGoblin extends Goblin {
  override get isHeldInvulnerable(): boolean {
    return this.hasStatus(FAIRY_WARD_STATUS);
  }
}

/** A goblin that raises its Invulnerable label unthrottled, on every blow the ward turns. */
class UnthrottledLabelGoblin extends Goblin {
  protected override soakWithWards(amount: number): number {
    if (amount > 0 && this.isHeldInvulnerable) {
      this.queueFloatingText(INVULNERABLE_LABEL, 'block');
      return 0;
    }
    return super.soakWithWards(amount);
  }
}

/** The ally a released cast was aimed at, as the fairy's own ally list holds it. */
function allyTargetOf(allies: readonly Mob[], cast: ActiveFairyCast): Mob | null {
  return allies.find((mob) => mob === cast.target) ?? null;
}

/** A shield fairy whose "ward" is an ordinary absorbing shield with a small pool. */
class AbsorbWardShieldFairy extends ShieldFairy {
  protected override onCastReleased(cast: ActiveFairyCast): void {
    const ally = allyTargetOf(this.allies, cast);
    if (ally === null || this.warded.length >= this.wardCount) return;
    ally.applyStatus(makeShield(PROBE_ABSORB, PROBE_SHIELD_TICKS));
    this.warded.push(ally);
  }
}

/** A shield fairy that lays its wards without counting them against its potency. */
class CountlessShieldFairy extends ShieldFairy {
  protected override onCastReleased(cast: ActiveFairyCast): void {
    const ally = allyTargetOf(this.allies, cast);
    if (ally !== null) applyFairyWardFrom(this, ally);
  }
}

/** A shield fairy that wards the nearest ally it does not hold, whoever else holds it. */
class UsurpingShieldFairy extends ShieldFairy {
  protected override chooseCast(_crawler: Player | null): FairyCastIntent | null {
    if (!this.isCastReady(WARD_CAST) || this.warded.length >= this.wardCount) return null;
    const target = this.allies.find((ally) => !isWardedBy(ally, this)) ?? null;
    if (target === null) return null;
    return { cast: WARD_CAST, target, aimX: target.x, aimY: target.y };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const ally = allyTargetOf(this.allies, cast);
    if (ally === null) return;
    ally.applyStatus(makeFairyWard(this));
    this.warded.push(ally);
  }
}

/** A shield fairy whose ward lands some frames after its cast released. */
class DelayedWardShieldFairy extends ShieldFairy {
  private pending: { ally: Mob; framesLeft: number } | null = null;

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const ally = allyTargetOf(this.allies, cast);
    if (ally !== null) this.pending = { ally, framesLeft: PROBE_WARD_DELAY_FRAMES };
  }

  override updateAI(targets: Player[]): void {
    super.updateAI(targets);
    const pending = this.pending;
    if (pending === null) return;
    pending.framesLeft--;
    if (pending.framesLeft > 0) return;
    this.pending = null;
    if (applyFairyWardFrom(this, pending.ally)) this.warded.push(pending.ally);
  }
}

/** A shield fairy that holds its position for as long as a cast is playing. */
class StillCastingShieldFairy extends ShieldFairy {
  override updateAI(targets: Player[]): void {
    const heldX = this.x;
    const heldY = this.y;
    super.updateAI(targets);
    if (this.activeCast === null) return;
    this.x = heldX;
    this.y = heldY;
  }
}

/** A shield fairy that keeps counting every ward it ever laid, its carrier dead or not. */
class DeadWardKeepingShieldFairy extends ShieldFairy {
  private readonly everWarded: Mob[] = [];

  protected override chooseCast(crawler: Player | null): FairyCastIntent | null {
    for (const mob of this.everWarded) if (!this.warded.includes(mob)) this.warded.push(mob);
    return super.chooseCast(crawler);
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    super.onCastReleased(cast);
    for (const mob of this.warded) if (!this.everWarded.includes(mob)) this.everWarded.push(mob);
  }
}

/** A shield fairy that wards exactly its potency: one ally short at every level. */
class PotencyCountShieldFairy extends ShieldFairy {
  override get wardCount(): number {
    return this.potencyCount;
  }
}

/**
 * A shield fairy whose ward candidates are every hostile near it, other
 * fairies included, each asked through the shared ward rule. Whatever list a
 * fairy builds, that rule alone must keep it off another shield fairy.
 */
class FairyInclusiveShieldFairy extends ShieldFairy {
  private readonly everyone: Mob[] = [];

  protected mayWard(mob: Mob): boolean {
    return canTakeWardFrom(mob, this);
  }

  protected layWard(mob: Mob): boolean {
    return applyFairyWardFrom(this, mob);
  }

  protected override chooseCast(_crawler: Player | null): FairyCastIntent | null {
    if (!this.isCastReady(WARD_CAST) || this.warded.length >= this.wardCount) return null;
    collectFairyAllies(this, TILE_SIZE * FAIRY_ALLY_SEARCH_TILES, this.everyone);
    const target = this.everyone.find((mob) => !isWardedBy(mob, this) && this.mayWard(mob)) ?? null;
    if (target === null) return null;
    return { cast: WARD_CAST, target, aimX: target.x, aimY: target.y };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const target = allyTargetOf(this.everyone, cast);
    if (target === null || this.warded.length >= this.wardCount) return;
    if (this.layWard(target)) this.warded.push(target);
  }
}

/** The same fairy asking a copy of the ward rule that has no shield-fairy guard. */
class GuardlessShieldFairy extends FairyInclusiveShieldFairy {
  protected override mayWard(mob: Mob): boolean {
    if (!mob.isAlive || !mob.isHostile || mob.refusesDamage) return false;
    const ward = fairyWardOn(mob);
    return ward === null || ward.applier?.isAlive !== true || ward.applier === this;
  }

  protected override layWard(mob: Mob): boolean {
    if (!this.mayWard(mob)) return false;
    mob.applyStatus(makeFairyWard(this));
    return isWardedBy(mob, this);
  }
}

type ShieldFactory = (tileX: number, tileY: number) => ShieldFairy;

/**
 * A fairy, and the active crawler standing where it watches the fairy unless
 * `watcher` puts it elsewhere; null leaves the party parked out of sight.
 * Every tick publishes the view of a camera following the active crawler on
 * `screen` (a phone unless given), clamped at the arena's walls, with a clear
 * sight disc of `sightTiles` around the crawler if given; a null screen
 * publishes no view at all.
 */
function shieldStage(
  opts: {
    walls?: readonly TileSpec[];
    level?: number;
    difficulty?: Difficulty;
    make?: ShieldFactory;
    watcher?: TileSpec | null;
    screen?: ScreenSize | null;
    sightTiles?: number;
  } = {},
) {
  const stage = buildStage(opts.walls ?? []);
  const screen = opts.screen === undefined ? PHONE_SCREEN : opts.screen;
  const sightTiles = opts.sightTiles;
  const publishCamera = (): void => {
    if (screen === null) {
      setVisibleWorldView(null);
      return;
    }
    const focus = stage.pm.active();
    const focusCentre = centreOf(focus);
    const sight: WorldSight | null =
      sightTiles === undefined
        ? null
        : { x: focusCentre.x, y: focusCentre.y, radiusPx: sightTiles * TILE_SIZE };
    setVisibleWorldView(followCameraView(focus, screen, sight));
  };
  const watcher = opts.watcher === undefined ? WATCHING_TILE : opts.watcher;
  if (watcher !== null) placeOnTile(stage.pm.human, watcher[0], watcher[1]);
  const fairy = placeShieldFairy(stage, FAIRY_TILE, FAIRY_TILE, opts.make);
  const level = opts.level ?? 1;
  if (level > 1) fairy.applyMobLevel(level);
  fairy.stampPotency(opts.difficulty ?? 'normal');
  const tickFairy = (which: ShieldFairy): void => {
    publishCamera();
    const oldX = which.x;
    const oldY = which.y;
    which.updateAI(stage.party());
    stage.roster.grid.move(which, oldX, oldY);
  };
  const tick = (frames = 1): void => {
    for (let i = 0; i < frames; i++) tickFairy(fairy);
  };
  const tickUntil = (predicate: () => boolean, limit: number): number => {
    for (let frame = 1; frame <= limit; frame++) {
      tick();
      if (predicate()) return frame;
    }
    return -1;
  };
  /** Adds a goblin built by hand the way `add` places a spawned one. */
  const addMade = (goblin: Goblin): Goblin => {
    goblin.setMap(stage.map);
    stage.roster.add(goblin);
    return goblin;
  };
  return { ...stage, fairy, tick, tickFairy, tickUntil, addMade };
}

/** A shield fairy spawned by key, or built by `make` and added the same way. */
function placeShieldFairy(
  stage: Stage,
  tileX: number,
  tileY: number,
  make?: ShieldFactory,
): ShieldFairy {
  if (make !== undefined) {
    const made = make(tileX, tileY);
    made.setMap(stage.map);
    stage.roster.add(made);
    return made;
  }
  const mob = stage.add('fairy_shield', tileX, tileY);
  if (!(mob instanceof ShieldFairy)) throw new Error('fairy_shield is not a ShieldFairy');
  return mob;
}

/** Puts the human back where it watches the fairy, north of it wherever it has flown. */
function stepIntoView(s: Stage & { readonly fairy: ShieldFairy }): void {
  const fairyTileX = Math.round(s.fairy.x / TILE_SIZE);
  const fairyTileY = Math.round(s.fairy.y / TILE_SIZE);
  placeOnTile(s.pm.human, fairyTileX, fairyTileY - WATCHING_OFFSET_TILES);
}

const wardedBy = (fairy: ShieldFairy, mobs: readonly Mob[]): Mob[] =>
  mobs.filter((mob) => isWardedBy(mob, fairy));

interface ProtectionRun {
  readonly laid: boolean;
  /** HP lost to each direct source, by damage type, then to a whole burn. */
  readonly losses: ReadonlyMap<string, number>;
  readonly raisedLabel: boolean;
}

const BURN_SOURCE = 'burn';

/**
 * A goblin warded by a real cast, then struck by a crawler's blow of each
 * direct type and left to burn through a whole burn, its HP restored between
 * each so every source is measured on its own.
 */
function protectionRun(make?: ShieldFactory): ProtectionRun {
  const s = shieldStage({ make });
  const goblin = s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE);
  const laid = s.tickUntil(() => s.fairy.wardedAllies.includes(goblin), FIRST_WARD_FRAMES) > 0;
  const blow = Math.floor(goblin.maxHp * PROTECTION_BLOW_SHARE);
  const losses = new Map<string, number>();
  let raisedLabel = false;
  for (const damageType of DIRECT_SOURCES) {
    const hp = goblin.hp;
    goblin.takeDamageFrom(blow, s.pm.human, damageType);
    losses.set(damageType, hp - goblin.hp);
    raisedLabel ||= goblin.pendingFloatingText.some((label) => label.text === INVULNERABLE_LABEL);
    goblin.hp = goblin.maxHp;
  }
  const hp = goblin.hp;
  goblin.applyStatus(makeBurn(s.pm.human));
  for (let frame = 0; frame < BURN_WATCH_FRAMES; frame++) goblin.tickTimers();
  losses.set(BURN_SOURCE, hp - goblin.hp);
  return { laid, losses, raisedLabel };
}

const describeLosses = (run: ProtectionRun): string =>
  [...run.losses].map(([source, lost]) => `${source} −${lost}`).join(', ');

function checkInvulnerability(report: FairyGateReport): void {
  const warded = protectionRun();
  report.precondition(warded.laid, 'a shield fairy lays a ward by a real cast');
  for (const [source, lost] of warded.losses) {
    report.check(lost === 0, `a warded ally loses no HP to a crawler's ${source}`, `−${lost}`);
  }
  report.check(warded.raisedLabel, `a warded ally struck raises an "${INVULNERABLE_LABEL}" label`);

  const absorb = protectionRun((x, y) => new AbsorbWardShieldFairy(x, y, TILE_SIZE));
  for (const [source, lost] of absorb.losses) {
    report.checkCatches(
      absorb.laid && lost === 0,
      `a fairy whose ward is an ordinary ${PROBE_ABSORB}-point shield is caught letting a ${source} through`,
      `−${lost}`,
    );
  }
  report.checkCatches(
    absorb.raisedLabel,
    `the same shield is caught raising no "${INVULNERABLE_LABEL}" label`,
    describeLosses(absorb),
  );
}

/** Counts every label the system actually puts on screen. */
class CountingFloatingText extends FloatingCombatTextSystem {
  readonly shown: string[] = [];

  override spawn(worldX: number, worldY: number, text: string, style: FloatingTextStyle): void {
    this.shown.push(text);
    super.spawn(worldX, worldY, text, style);
  }
}

/**
 * Invulnerable labels shown over a warded goblin struck by a flurry inside one
 * throttle window, drained by the real label system every frame.
 */
function flurryLabels(makeGoblin?: (tileX: number, tileY: number) => Goblin): {
  laid: boolean;
  shown: number;
} {
  const s = shieldStage();
  const tileX = FAIRY_TILE + NEIGHBOR_OFFSET_TILES;
  const goblin =
    makeGoblin === undefined
      ? s.add('goblin', tileX, FAIRY_TILE)
      : s.addMade(makeGoblin(tileX, FAIRY_TILE));
  const laid = s.tickUntil(() => isWardedBy(goblin, s.fairy), FIRST_WARD_FRAMES) > 0;
  const labels = new CountingFloatingText();
  for (let frame = 0; frame < FLURRY_FRAMES; frame++) {
    for (let blow = 0; blow < BLOWS_PER_FLURRY_FRAME; blow++) {
      goblin.takeDamageFrom(FLURRY_BLOW, s.pm.human);
    }
    labels.updateFor(s.pm.human, s.pm.cat, s.roster.mobs);
  }
  return { laid, shown: labels.shown.filter((text) => text === INVULNERABLE_LABEL).length };
}

function checkLabelThrottle(report: FairyGateReport): void {
  const real = flurryLabels();
  report.check(
    real.laid && real.shown === 1,
    `${FLURRY_FRAMES * BLOWS_PER_FLURRY_FRAME} blows over ${FLURRY_FRAMES} frames on a warded ally show one "${INVULNERABLE_LABEL}" label`,
    `${real.shown} shown`,
  );
  const unthrottled = flurryLabels(
    (x, y) => new UnthrottledLabelGoblin(x, y, TILE_SIZE, GOBLIN_WEAPON),
  );
  report.checkCatches(
    unthrottled.laid && unthrottled.shown === 1,
    'a carrier that raises the label unthrottled is caught stacking it',
    `${unthrottled.shown} shown`,
  );
}

interface FillRun {
  readonly potency: number;
  readonly cap: number;
  readonly filled: number;
  /** Frames on which the fairy held more wards than its ward count. */
  readonly over: number;
}

/**
 * A fairy at `level` on `difficulty` among more goblins than it can ever ward,
 * left long enough to fill every slot it has.
 */
function potencyFillRun(
  make?: ShieldFactory,
  level = HIGH_LEVEL,
  difficulty: Difficulty = 'hard',
): FillRun {
  const s = shieldStage({ level, difficulty, make });
  const NEAR = NEIGHBOR_OFFSET_TILES;
  const offsets: TileSpec[] = [
    [NEAR, 0],
    [0, NEAR],
    [-NEAR, 0],
    [0, -NEAR],
    [NEAR, NEAR],
    [-NEAR, -NEAR],
  ];
  const goblins = offsets.map(([dx, dy]) => s.add('goblin', FAIRY_TILE + dx, FAIRY_TILE + dy));
  const cap = s.fairy.wardCount;
  let over = 0;
  for (let frame = 0; frame < FILL_FRAMES; frame++) {
    s.tick();
    if (wardedBy(s.fairy, goblins).length > cap) over++;
  }
  const filled = wardedBy(s.fairy, goblins).length;
  return { potency: s.fairy.potencyCount, cap, filled, over };
}

interface SampledCount {
  readonly level: number;
  readonly difficulty: Difficulty;
  readonly expected: number;
  readonly filled: number;
}

/**
 * Wards filled at every sampled level and difficulty, each against potency
 * plus {@link EXTRA_WARDS_OVER_POTENCY}.
 */
function sampledWardCounts(make?: ShieldFactory): SampledCount[] {
  const samples: SampledCount[] = [];
  for (const level of SAMPLED_LEVELS) {
    for (const difficulty of DIFFICULTIES) {
      const expected = fairyPotencyCount(level, difficulty) + EXTRA_WARDS_OVER_POTENCY;
      const { filled } = potencyFillRun(make, level, difficulty);
      samples.push({ level, difficulty, expected, filled });
    }
  }
  return samples;
}

const describeMisses = (samples: readonly SampledCount[]): string => {
  const misses = samples.filter((sample) => sample.filled !== sample.expected);
  if (misses.length === 0) return `${samples.length} cells exact`;
  return misses.map((m) => `L${m.level} ${m.difficulty}: ${m.filled} of ${m.expected}`).join('; ');
};

function checkWardCountOverPotency(report: FairyGateReport): void {
  let formulaMisses = 0;
  for (let level = 1; level <= MAX_MOB_LEVEL; level++) {
    for (const difficulty of DIFFICULTIES) {
      const expected = fairyPotencyCount(level, difficulty) + EXTRA_WARDS_OVER_POTENCY;
      if (shieldWardCount(level, difficulty) !== expected) formulaMisses++;
    }
  }
  report.check(
    formulaMisses === 0,
    `shieldWardCount is potency + ${EXTRA_WARDS_OVER_POTENCY} at every level and difficulty`,
    `${formulaMisses} cells off`,
  );

  const samples = sampledWardCounts();
  report.check(
    samples.every((sample) => sample.filled === sample.expected),
    `a shield fairy wards exactly potency + ${EXTRA_WARDS_OVER_POTENCY} allies at every sampled level and difficulty`,
    describeMisses(samples),
  );
  const ceiling = samples.find(
    (sample) => sample.expected === FAIRY_MAX_POTENCY + EXTRA_WARDS_OVER_POTENCY,
  );
  report.check(
    ceiling !== undefined && ceiling.filled === ceiling.expected,
    `a fairy at the potency ceiling (${FAIRY_MAX_POTENCY}) wards ${FAIRY_MAX_POTENCY + EXTRA_WARDS_OVER_POTENCY}`,
    ceiling === undefined ? 'no sampled cell at the ceiling' : describeMisses([ceiling]),
  );
  const potencyOnly = sampledWardCounts((x, y) => new PotencyCountShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    potencyOnly.every((sample) => sample.filled === sample.expected),
    'a fairy that wards only its potency is caught one ally short',
    describeMisses(potencyOnly),
  );
}

function checkPotencyAndPriority(report: FairyGateReport): void {
  {
    const s = shieldStage();
    const goblins = [
      s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE),
      s.add('goblin', FAIRY_TILE, FAIRY_TILE + NEIGHBOR_OFFSET_TILES),
      s.add('goblin', FAIRY_TILE - NEIGHBOR_OFFSET_TILES, FAIRY_TILE),
    ];
    s.tick(FILL_FRAMES);
    const warded = wardedBy(s.fairy, goblins).length;
    const levelOneWards = 1 + EXTRA_WARDS_OVER_POTENCY;
    report.check(
      s.fairy.potencyCount === 1 && warded === levelOneWards,
      `a level-1 fairy on normal wards exactly ${levelOneWards} of ${goblins.length} allies`,
      `potency ${s.fairy.potencyCount}, warded ${warded}`,
    );
  }
  const fill = potencyFillRun();
  report.check(
    fill.cap > 1 && fill.over === 0 && fill.filled === fill.cap,
    'a high-level fairy fills exactly its ward count and never more',
    `ward count ${fill.cap}, filled ${fill.filled}, frames over ${fill.over}`,
  );
  const countless = potencyFillRun((x, y) => new CountlessShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    countless.over === 0 && countless.filled === countless.cap,
    'a fairy that loses count of its wards is caught warding past its ward count',
    `ward count ${countless.cap}, filled ${countless.filled}, frames over ${countless.over}`,
  );
  {
    const s = shieldStage({ level: HIGH_LEVEL, difficulty: 'hard' });
    const plain = s.add('goblin', FAIRY_TILE + ADJACENT_TILES, FAIRY_TILE);
    const boss = s.add('goblin', FAIRY_TILE + FAR_SIDE_TILES, FAIRY_TILE);
    boss.isBoss = true;
    const engaged = s.add('goblin', FAIRY_TILE, FAIRY_TILE + FARTHEST_TILES);
    engaged.currentTarget = s.pm.human;
    const order: Mob[] = [];
    const candidates = [plain, boss, engaged];
    for (let frame = 0; frame < FILL_FRAMES && order.length < candidates.length; frame++) {
      s.tick();
      for (const mob of candidates) {
        if (isWardedBy(mob, s.fairy) && !order.includes(mob)) order.push(mob);
      }
    }
    const names = order.map((mob) =>
      mob === engaged ? 'engaged' : mob === boss ? 'boss' : 'plain',
    );
    report.check(
      names.join(',') === 'engaged,boss,plain',
      'wards go to engaged allies first, then bosses, then the nearest',
      names.join(','),
    );
  }
}

/**
 * Two potency-1 fairies beside one goblin: the first wards it, then both fly
 * on. Whether the second ever took the ward over.
 */
function secondFairyRun(makeSecond?: ShieldFactory): {
  firstWarded: boolean;
  takenOver: boolean;
} {
  const s = shieldStage();
  const second = placeShieldFairy(s, FAIRY_TILE - NEIGHBOR_OFFSET_TILES, FAIRY_TILE, makeSecond);
  second.stampPotency('normal');
  const goblin = s.add('goblin', FAIRY_TILE, FAIRY_TILE + NEIGHBOR_OFFSET_TILES);
  const firstWarded = s.tickUntil(() => isWardedBy(goblin, s.fairy), FIRST_WARD_FRAMES) > 0;
  let takenOver = false;
  for (let frame = 0; frame < FILL_FRAMES && !takenOver; frame++) {
    s.tickFairy(s.fairy);
    s.tickFairy(second);
    takenOver = !isWardedBy(goblin, s.fairy);
  }
  return { firstWarded, takenOver };
}

function checkOneWardPerMob(report: FairyGateReport): void {
  const run = secondFairyRun();
  report.check(
    run.firstWarded && !run.takenOver,
    "a second shield fairy never takes over a living fairy's ward",
  );
  const usurper = secondFairyRun((x, y) => new UsurpingShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    usurper.firstWarded && !usurper.takenOver,
    'a second fairy that lays its ward without asking is caught overwriting the first',
  );
}

interface MutualWardRun {
  /** Whether the goblins beside the pair were warded at all, when there were any. */
  readonly goblinsWarded: boolean;
  /** Whether either fairy ever held a ward on the other. */
  readonly fairyWarded: boolean;
}

/**
 * Two shield fairies side by side, with `goblins` goblins beside them or none,
 * ticked together; whether either ever wards the other.
 */
function mutualWardRun(goblins: number, make?: ShieldFactory): MutualWardRun {
  const s = shieldStage({ make });
  const other = placeShieldFairy(s, FAIRY_TILE + ADJACENT_TILES, FAIRY_TILE, make);
  other.stampPotency('normal');
  const allies: Mob[] = [];
  for (let i = 0; i < goblins; i++) {
    allies.push(s.add('goblin', FAIRY_TILE + i, FAIRY_TILE + NEIGHBOR_OFFSET_TILES));
  }
  let fairyWarded = false;
  for (let frame = 0; frame < MUTUAL_WARD_FRAMES && !fairyWarded; frame++) {
    s.tickFairy(s.fairy);
    s.tickFairy(other);
    fairyWarded = fairyWardOn(s.fairy) !== null || fairyWardOn(other) !== null;
  }
  const goblinsWarded = allies.every((mob) => fairyWardOn(mob) !== null);
  return { goblinsWarded, fairyWarded };
}

function checkNoShieldOnShield(report: FairyGateReport): void {
  const withAllies = mutualWardRun(MUTUAL_CASE_GOBLINS);
  report.precondition(
    withAllies.goblinsWarded,
    'two shield fairies side by side ward their goblins',
  );
  report.check(!withAllies.fairyWarded, 'two shield fairies among allies never ward each other');
  const alone = mutualWardRun(0);
  report.check(!alone.fairyWarded, 'a shield fairy whose only candidate is another never wards it');

  const inclusive = (x: number, y: number) => new FairyInclusiveShieldFairy(x, y, TILE_SIZE);
  const inclusiveAlone = mutualWardRun(0, inclusive);
  report.check(
    !inclusiveAlone.fairyWarded,
    'the ward rule alone keeps a shield fairy off another, even from a candidate list with fairies in it',
  );
  const inclusiveAllies = mutualWardRun(MUTUAL_CASE_GOBLINS, inclusive);
  report.check(
    inclusiveAllies.goblinsWarded && !inclusiveAllies.fairyWarded,
    'the same fairies among allies ward the goblins and never each other',
  );
  const guardless = mutualWardRun(0, (x, y) => new GuardlessShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    !guardless.fairyWarded,
    'a ward rule without the shield-fairy guard is caught warding the other shield fairy',
  );
}

interface ChaseRun {
  readonly firstWarded: boolean;
  /** Frames from the first ally's death to the next ward landing, or -1. */
  readonly rewardAfter: number;
  /** Whether the next ward landed on the frame its cast released. */
  readonly landedOnRelease: boolean;
  /** Frames around the release on which the fairy stood still. */
  readonly stillFrames: number;
  readonly watchedFrames: number;
}

/**
 * A level-1 fairy fills its ward slots from a row of goblins one longer than
 * its ward count while a human walks at it. Once the fairy is flying from the
 * human, one warded goblin dies, and the fairy's next ward — on the goblin it
 * had no slot for — is watched: when it lands against the cast's release, and
 * whether the fairy was moving through the frames around it.
 */
function chaseRun(make?: ShieldFactory): ChaseRun {
  const s = shieldStage({ make });
  const goblins: Mob[] = [];
  const rowStart = FAIRY_TILE - Math.floor(s.fairy.wardCount / 2);
  for (let i = 0; i <= s.fairy.wardCount; i++) {
    goblins.push(s.add('goblin', rowStart + i, FAIRY_TILE + CHASE_ALLY_BELOW_TILES));
  }
  const human = s.pm.human;
  placeOnTile(human, FAIRY_TILE, FAIRY_TILE - CHASER_START_TILES);
  const chaseStep = (): void => {
    const dx = s.fairy.x - human.x;
    const dy = s.fairy.y - human.y;
    const gap = Math.hypot(dx, dy);
    if (gap <= CHASER_STOP_PX) return;
    human.x += (dx / gap) * CHASER_STEP_PX;
    human.y += (dy / gap) * CHASER_STEP_PX;
  };
  const moves: number[] = [];
  const step = (): void => {
    chaseStep();
    const oldX = s.fairy.x;
    const oldY = s.fairy.y;
    s.tick();
    moves.push(Math.hypot(s.fairy.x - oldX, s.fairy.y - oldY));
  };
  for (let frame = 0; frame < CHASE_WARMUP_FRAMES; frame++) step();
  const warded = wardedBy(s.fairy, goblins);
  const firstWarded = warded.length === s.fairy.wardCount;
  const second = goblins.find((mob) => !warded.includes(mob)) ?? null;
  if (warded.length > 0) warded[0].hp = 0;
  const deathIndex = moves.length;
  let rewardAfter = -1;
  let landedOnRelease = false;
  for (let frame = 1; frame <= REWARD_SEARCH_FRAMES && rewardAfter < 0; frame++) {
    step();
    if (second === null || !isWardedBy(second, s.fairy)) continue;
    rewardAfter = frame;
    landedOnRelease = s.fairy.activeCast?.phase === 'release';
  }
  for (let frame = 0; frame < FAIRY_CAST_RECOVER_FRAMES; frame++) step();
  const wardIndex = deathIndex + rewardAfter - 1;
  const watched =
    rewardAfter < 0
      ? []
      : moves.slice(
          wardIndex - MOVING_BEFORE_RELEASE_FRAMES,
          wardIndex + FAIRY_CAST_RECOVER_FRAMES,
        );
  return {
    firstWarded,
    rewardAfter,
    landedOnRelease,
    stillFrames: watched.filter((moved) => moved < STILL_PX).length,
    watchedFrames: watched.length,
  };
}

const describeChase = (run: ChaseRun): string =>
  `ward ${run.rewardAfter} frames after the death, on release ${run.landedOnRelease}, ` +
  `still on ${run.stillFrames} of ${run.watchedFrames} frames`;

function checkCastInFlight(report: FairyGateReport): void {
  const run = chaseRun();
  report.precondition(run.firstWarded, 'the chase fairy fills every ward slot it has');
  report.check(
    run.rewardAfter > 0,
    'once its warded ally dies, the fairy wards another',
    describeChase(run),
  );
  report.check(
    run.rewardAfter > 0 && run.landedOnRelease,
    'the ward lands on the frame its cast releases',
    describeChase(run),
  );
  report.check(
    run.watchedFrames > 0 && run.stillFrames === 0,
    'the fairy keeps flying from an approaching crawler through the frames around its cast',
    describeChase(run),
  );

  const keeper = chaseRun((x, y) => new DeadWardKeepingShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    keeper.rewardAfter > 0,
    "a fairy that keeps counting a dead ally's ward is caught with no slot to ward another",
    describeChase(keeper),
  );
  const delayed = chaseRun((x, y) => new DelayedWardShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    delayed.rewardAfter > 0 && delayed.landedOnRelease,
    `a ward that lands ${PROBE_WARD_DELAY_FRAMES} frames after its release is caught`,
    describeChase(delayed),
  );
  const still = chaseRun((x, y) => new StillCastingShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    still.watchedFrames > 0 && still.stillFrames === 0,
    'a fairy that holds still while its cast plays is caught standing',
    describeChase(still),
  );
}

/** A shield fairy that wards whether or not anyone can see it. */
class UnwatchedShieldFairy extends ShieldFairy {
  protected override get isWatched(): boolean {
    return true;
  }
}

/** A shield fairy that can ask whether the active crawler has a clear line to it. */
abstract class SightTestingShieldFairy extends ShieldFairy {
  /** Whether the active crawler is within `radiusTiles` of this fairy with a clear line to it. */
  protected activeCrawlerNear(targets: readonly Player[], radiusTiles: number): boolean {
    const from = centreOf(this);
    return targets.some((target) => {
      if (!target.isCrawler || !target.isActive || !target.isAlive) return false;
      const to = centreOf(target);
      if (Math.hypot(to.x - from.x, to.y - from.y) > TILE_SIZE * radiusTiles) return false;
      return this.map?.hasLineOfSight(to.x, to.y, from.x, from.y) !== false;
    });
  }
}

/** A shield fairy watched through a fixed phone-sized radius with a clear line, not the view. */
class FixedRadiusShieldFairy extends SightTestingShieldFairy {
  private near = false;

  override updateAI(targets: Player[]): void {
    this.near = this.activeCrawlerNear(targets, FIXED_WATCHED_RANGE_TILES);
    super.updateAI(targets);
  }

  protected override get isWatched(): boolean {
    return this.near;
  }
}

/** A shield fairy that also needs a clear line from the active crawler, on screen or not. */
class SightlineShieldFairy extends SightTestingShieldFairy {
  private sightline = false;

  override updateAI(targets: Player[]): void {
    this.sightline = this.activeCrawlerNear(targets, Number.POSITIVE_INFINITY);
    super.updateAI(targets);
  }

  protected override get isWatched(): boolean {
    return this.isOnScreen && this.sightline;
  }
}

/** A shield fairy that counts itself seen whenever no view has been published. */
class ViewlessWatchedShieldFairy extends ShieldFairy {
  protected override get isWatched(): boolean {
    return visibleWorldView() === null || this.isOnScreen;
  }
}

/** A shield fairy that tests the published view's rectangle and ignores its fog. */
class FogBlindShieldFairy extends ShieldFairy {
  protected override get isWatched(): boolean {
    const view = visibleWorldView();
    if (view === null) return false;
    const chest = this.castOrigin;
    const inX = chest.x >= view.left && chest.x <= view.left + view.width;
    const inY = chest.y >= view.top && chest.y <= view.top + view.height;
    return inX && inY;
  }
}

/**
 * A shield fairy that re-centres the published view on the active crawler, as
 * if the camera were never pinned at a map edge.
 */
class CrawlerCentredShieldFairy extends ShieldFairy {
  private centredOnCrawler = false;

  override updateAI(targets: Player[]): void {
    const view = visibleWorldView();
    const active = targets.find((target) => target.isCrawler && target.isActive);
    this.centredOnCrawler = false;
    if (view !== null && active !== undefined) {
      const focus = centreOf(active);
      const chest = this.castOrigin;
      const inX = Math.abs(chest.x - focus.x) <= view.width / 2;
      const inY = Math.abs(chest.y - focus.y) <= view.height / 2;
      this.centredOnCrawler = inX && inY;
    }
    super.updateAI(targets);
  }

  protected override get isWatched(): boolean {
    return this.centredOnCrawler;
  }
}

/** A shield fairy that counts a phone camera on either crawler, the one off camera too. */
class AnyCrawlerWatchedShieldFairy extends ShieldFairy {
  private seenByAny = false;

  override updateAI(targets: Player[]): void {
    const chest = this.castOrigin;
    const published = visibleWorldView();
    this.seenByAny = targets.some((target) => {
      if (!target.isCrawler || !target.isAlive) return false;
      setVisibleWorldView(followCameraView(target, PHONE_SCREEN));
      return isWorldPointInView(chest.x, chest.y, 0);
    });
    setVisibleWorldView(published);
    super.updateAI(targets);
  }

  protected override get isWatched(): boolean {
    return this.seenByAny;
  }
}

interface WatchRun {
  /** Frames, out of {@link UNSEEN_FRAMES}, on which the fairy was casting. */
  readonly castFrames: number;
  /** Whether the goblin beside it held its ward at any point in those frames. */
  readonly warded: boolean;
  /** Frames from the human stepping into a phone camera's view to the ward landing, or -1. */
  readonly wardAfterSeen: number;
}

/**
 * A level-1 fairy beside one goblin, with the active crawler at `watcher` (or
 * parked) and the cat at `catTile` if given, left long enough to have laid
 * several wards; then, if it laid none, the cat is parked and the human steps
 * into view.
 */
function watchRun(opts: {
  watcher: TileSpec | null;
  catTile?: TileSpec;
  walls?: readonly TileSpec[];
  make?: ShieldFactory;
  screen?: ScreenSize | null;
  sightTiles?: number;
}): WatchRun {
  const s = shieldStage({
    watcher: opts.watcher,
    walls: opts.walls,
    make: opts.make,
    screen: opts.screen,
    sightTiles: opts.sightTiles,
  });
  if (opts.catTile !== undefined) placeOnTile(s.pm.cat, opts.catTile[0], opts.catTile[1]);
  const goblin = s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE);
  let castFrames = 0;
  let warded = false;
  for (let frame = 0; frame < UNSEEN_FRAMES; frame++) {
    s.tick();
    if (s.fairy.activeCast !== null) castFrames++;
    warded ||= isWardedBy(goblin, s.fairy);
  }
  placeOnTile(s.pm.cat, PARK_TILE, PARK_TILE);
  stepIntoView(s);
  const wardAfterSeen = warded
    ? -1
    : s.tickUntil(() => isWardedBy(goblin, s.fairy), SEEN_TO_WARD_FRAMES);
  return { castFrames, warded, wardAfterSeen };
}

const describeWatch = (run: WatchRun): string =>
  `casting on ${run.castFrames} of ${UNSEEN_FRAMES} frames, warded ${run.warded}, ` +
  `ward ${run.wardAfterSeen < 0 ? 'not laid' : `${run.wardAfterSeen} frames`} after stepping into view`;

/** Whether a fairy cast at all over the held frames. */
const castsAtAll = (run: WatchRun): boolean => run.castFrames > 0 || run.warded;

interface ReplacementRun {
  readonly firstWarded: boolean;
  /** Whether the fairy laid another ward after its warded ally died, while nobody watched. */
  readonly replacedUnseen: boolean;
  /** Frames from the human stepping back into view to the replacement ward, or -1. */
  readonly replacedAfterSeen: number;
}

/**
 * A level-1 fairy fills its ward slots with the human watching; the human
 * walks off, one warded goblin dies, and a spare goblin waits for the slot.
 */
function replacementRun(make?: ShieldFactory): ReplacementRun {
  const s = shieldStage({ make });
  const goblins: Mob[] = [];
  for (let i = 0; i <= s.fairy.wardCount; i++) {
    goblins.push(s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE + i));
  }
  const allSlotsFull = (): boolean => wardedBy(s.fairy, goblins).length === s.fairy.wardCount;
  const firstWarded = s.tickUntil(allSlotsFull, FILL_FRAMES) > 0;
  const warded = wardedBy(s.fairy, goblins);
  const spare = goblins.find((mob) => !warded.includes(mob)) ?? null;
  placeOnTile(s.pm.human, PARK_TILE, PARK_TILE);
  if (warded.length > 0) warded[0].hp = 0;
  let replacedUnseen = false;
  for (let frame = 0; frame < UNSEEN_FRAMES; frame++) {
    s.tick();
    replacedUnseen ||= spare !== null && isWardedBy(spare, s.fairy);
  }
  stepIntoView(s);
  const replacedAfterSeen = s.tickUntil(
    () => spare !== null && isWardedBy(spare, s.fairy),
    SEEN_TO_WARD_FRAMES,
  );
  return { firstWarded, replacedUnseen, replacedAfterSeen };
}

function checkWaitsToBeSeen(report: FairyGateReport): void {
  const phoneOutOfView: TileSpec = [FAIRY_TILE + OUT_OF_VIEW_TILES, FAIRY_TILE];
  const far = watchRun({ watcher: phoneOutOfView });
  report.check(
    !castsAtAll(far),
    `with the crawler ${OUT_OF_VIEW_TILES} tiles off and the fairy outside a phone camera's view, it starts no cast and lays no ward`,
    describeWatch(far),
  );
  report.check(
    far.wardAfterSeen > 0,
    `once the crawler steps into view, the fairy wards within ${SEEN_TO_WARD_FRAMES} frame`,
    describeWatch(far),
  );
  const unwatched = watchRun({
    watcher: phoneOutOfView,
    make: (x, y) => new UnwatchedShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    !castsAtAll(unwatched),
    'a fairy that wards whether or not it is watched is caught warding off screen',
    describeWatch(unwatched),
  );

  const desktopDistance: TileSpec = [FAIRY_TILE + DESKTOP_DISTANCE_TILES, FAIRY_TILE];
  const desktop = watchRun({ watcher: desktopDistance, screen: DESKTOP_SCREEN });
  report.check(
    desktop.warded,
    `on a desktop screen the fairy is in view from ${DESKTOP_DISTANCE_TILES} tiles off, and wards`,
    describeWatch(desktop),
  );
  const fixedRadius = watchRun({
    watcher: desktopDistance,
    screen: DESKTOP_SCREEN,
    make: (x, y) => new FixedRadiusShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    fixedRadius.warded,
    `a fairy watched through a fixed ${FIXED_WATCHED_RANGE_TILES}-tile radius is caught refusing on the desktop screen that shows it`,
    describeWatch(fixedRadius),
  );
  const phone = watchRun({ watcher: desktopDistance, screen: PHONE_SCREEN });
  report.check(
    !castsAtAll(phone),
    `from the same ${DESKTOP_DISTANCE_TILES} tiles a phone screen does not show the fairy, and it lays no ward`,
    describeWatch(phone),
  );

  const edgeTile: TileSpec = [EDGE_CASE_TILE, EDGE_CASE_TILE];
  const edge = watchRun({ watcher: edgeTile, screen: EDGE_CASE_SCREEN });
  report.check(
    edge.warded,
    'with the camera pinned at the arena corner, the fairy is on screen far from the crawler, and wards',
    describeWatch(edge),
  );
  const centred = watchRun({
    watcher: edgeTile,
    screen: EDGE_CASE_SCREEN,
    make: (x, y) => new CrawlerCentredShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    centred.warded,
    'a fairy that takes the view as centred on the crawler is caught refusing while the pinned camera shows it',
    describeWatch(centred),
  );

  const walls: TileSpec[] = [];
  for (let x = 1; x < ARENA_TILES - 1; x++) walls.push([x, FAIRY_TILE - SIGHT_WALL_ROW_OFFSET]);
  const walled = watchRun({ watcher: WATCHING_TILE, walls });
  report.check(
    walled.warded,
    'with a wall between it and the crawler but the fairy on screen, it wards: a top-down view hides nothing behind a wall',
    describeWatch(walled),
  );
  const sightline = watchRun({
    watcher: WATCHING_TILE,
    walls,
    make: (x, y) => new SightlineShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    sightline.warded,
    "a fairy that also needs the crawler's line of sight is caught refusing on screen behind a wall",
    describeWatch(sightline),
  );

  const fogged = watchRun({
    watcher: WATCHING_TILE,
    screen: DESKTOP_SCREEN,
    sightTiles: FOGGED_SIGHT_TILES,
  });
  report.check(
    !castsAtAll(fogged),
    `inside the screen but past a ${FOGGED_SIGHT_TILES}-tile clear-sight disc, in the fog, the fairy lays no ward`,
    describeWatch(fogged),
  );
  const fogBlind = watchRun({
    watcher: WATCHING_TILE,
    screen: DESKTOP_SCREEN,
    sightTiles: FOGGED_SIGHT_TILES,
    make: (x, y) => new FogBlindShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    !castsAtAll(fogBlind),
    'a fairy that ignores the fog is caught warding in it',
    describeWatch(fogBlind),
  );

  const viewless = watchRun({ watcher: WATCHING_TILE, screen: null });
  report.check(
    !castsAtAll(viewless),
    'with no view published, the fairy counts itself unseen and lays no ward',
    describeWatch(viewless),
  );
  const viewlessWatched = watchRun({
    watcher: WATCHING_TILE,
    screen: null,
    make: (x, y) => new ViewlessWatchedShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    !castsAtAll(viewlessWatched),
    'a fairy that counts a missing view as seen is caught warding',
    describeWatch(viewlessWatched),
  );

  const catOnly = watchRun({ watcher: null, catTile: WATCHING_TILE });
  report.check(
    !castsAtAll(catOnly),
    'the inactive crawler standing by the fairy does not count: the camera is on the other one',
    describeWatch(catOnly),
  );
  const anyCrawler = watchRun({
    watcher: null,
    catTile: WATCHING_TILE,
    make: (x, y) => new AnyCrawlerWatchedShieldFairy(x, y, TILE_SIZE),
  });
  report.checkCatches(
    !castsAtAll(anyCrawler),
    "a fairy that counts the off-camera crawler's view as watching is caught warding",
    describeWatch(anyCrawler),
  );

  const replacement = replacementRun();
  report.precondition(replacement.firstWarded, 'the watched fairy fills every ward slot it has');
  report.check(
    !replacement.replacedUnseen && replacement.replacedAfterSeen > 0,
    'a warded ally that dies after the crawler walks off is replaced only once the fairy is back in view',
    `replaced unseen ${replacement.replacedUnseen}, ${replacement.replacedAfterSeen} frames after seen`,
  );
  const unwatchedReplacement = replacementRun((x, y) => new UnwatchedShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    !unwatchedReplacement.replacedUnseen,
    'a fairy that wards unwatched is caught replacing the dead ally with nobody looking',
  );
}

function checkRefusals(report: FairyGateReport): void {
  const WALL_COLUMN = FAIRY_TILE + ADJACENT_TILES;
  const walls: TileSpec[] = [];
  for (let y = 1; y < SEALING_WALL_END_ROW; y++) walls.push([WALL_COLUMN, y]);
  {
    const s = shieldStage({ walls });
    const goblin = s.add('goblin', WALL_COLUMN + BEHIND_WALL_TILES, FAIRY_TILE);
    s.tick(SEALED_FRAMES);
    report.check(!isWardedBy(goblin, s.fairy), 'no ward is laid through a wall');
  }
  {
    const s = shieldStage();
    const goblin = s.add('goblin', WALL_COLUMN + BEHIND_WALL_TILES, FAIRY_TILE);
    s.tick(SEALED_FRAMES);
    report.checkCatches(
      !isWardedBy(goblin, s.fairy),
      'the same ally with the wall gone is caught being warded',
    );
  }
  {
    const s = shieldStage();
    const immune = s.addMade(
      new ImmuneGoblin(FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE, TILE_SIZE, GOBLIN_WEAPON),
    );
    s.tick(SEALED_FRAMES);
    report.check(
      !isWardedBy(immune, s.fairy) && s.fairy.activeCast === null,
      'no ward is spent on an ally that is immune to damage',
    );
  }
}

/** A shield fairy with wards laid on `wardedMobs` by hand, killed through the real kill path. */
function killWarder(s: Stage, fairy: ShieldFairy, wardedMobs: readonly Mob[]): void {
  for (const mob of wardedMobs) applyFairyWardFrom(fairy, mob);
  s.kill(fairy);
}

/** HP a crawler's blow of `amount` takes off `mob`, restored afterwards. */
function blowCost(s: Stage, mob: Mob, amount: number): number {
  const hp = mob.hp;
  mob.takeDamageFrom(amount, s.pm.human);
  const taken = hp - mob.hp;
  mob.hp = hp;
  return taken;
}

/**
 * A goblin warded by the stage's fairy, whose fairy then dies off the kill
 * path — so nothing strips the ward — and the blow that follows.
 */
function blowAfterUnreportedDeath(makeGoblin?: (tileX: number, tileY: number) => Goblin): {
  wardLeftUp: boolean;
  taken: number;
} {
  const s = shieldStage();
  const tileX = FAIRY_TILE + NEIGHBOR_OFFSET_TILES;
  const warded =
    makeGoblin === undefined
      ? s.add('goblin', tileX, FAIRY_TILE)
      : s.addMade(makeGoblin(tileX, FAIRY_TILE));
  applyFairyWardFrom(s.fairy, warded);
  s.fairy.takeDamageFrom(Number.MAX_SAFE_INTEGER, s.pm.human);
  return { wardLeftUp: fairyWardOn(warded) !== null, taken: blowCost(s, warded, AEGIS_TEST_BLOW) };
}

function checkDeath(report: FairyGateReport): void {
  const s = shieldStage();
  const near = s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE);
  const boss = s.add('goblin', FAIRY_TILE, FAIRY_TILE + FAR_SIDE_TILES);
  boss.isBoss = true;
  const outsideTiles = Math.ceil(AEGIS_CHAIN_RADIUS_TILES) + OUTSIDE_CHAIN_MARGIN_TILES;
  const far = s.add('goblin', FAIRY_TILE + outsideTiles, FAIRY_TILE);
  const blind = new AegisBlindGoblin(
    FAIRY_TILE - NEIGHBOR_OFFSET_TILES,
    FAIRY_TILE,
    TILE_SIZE,
    GOBLIN_WEAPON,
  );
  blind.setMap(s.map);
  s.roster.add(blind);
  report.precondition(
    [near, boss].every((mob) => mob.isAlive),
    'every mob the death chains are measured on is standing',
  );
  const wardedBlow = (() => {
    applyFairyWardFrom(s.fairy, near);
    return blowCost(s, near, AEGIS_TEST_BLOW);
  })();
  report.precondition(wardedBlow === 0, 'the ward holds a blow off while the fairy lives');
  killWarder(s, s.fairy, [near, boss]);
  report.check(
    fairyWardOn(near) === null && fairyWardOn(boss) === null,
    "the fairy's death strips its wards on the same frame",
  );
  report.check(
    blowCost(s, near, AEGIS_TEST_BLOW) > 0,
    "the blow after the fairy's death lands",
    `${blowCost(s, near, AEGIS_TEST_BLOW)} taken`,
  );
  s.fairies.update(s.ctx());
  report.check(
    near.hasStatus(FAIRY_AEGIS_STATUS) && boss.hasStatus(FAIRY_AEGIS_STATUS),
    'the death chains an aegis to hostiles in reach, bosses included',
  );
  report.check(
    !far.hasStatus(FAIRY_AEGIS_STATUS),
    'a hostile outside the chain radius gets no aegis',
    `${outsideTiles} tiles out, radius ${AEGIS_CHAIN_RADIUS_TILES}`,
  );

  const unreported = blowAfterUnreportedDeath();
  report.checkCatches(
    !unreported.wardLeftUp,
    'a death that never reaches the kill path is caught leaving its ward up',
  );
  report.check(
    unreported.taken > 0,
    'even a ward left up by a death off the kill path stops holding once its fairy is dead',
    `${unreported.taken} taken`,
  );
  const trusting = blowAfterUnreportedDeath(
    (x, y) => new WardTrustingGoblin(x, y, TILE_SIZE, GOBLIN_WEAPON),
  );
  report.checkCatches(
    trusting.taken > 0,
    "a carrier that trusts the ward without asking after its fairy is caught unhurt after the fairy's death",
    `${trusting.taken} taken`,
  );

  // The aegis window: a blow halves on every frame through its last, then lands whole.
  const halved = Math.round(AEGIS_TEST_BLOW * AEGIS_DAMAGE_SCALE);
  const firstBlow = blowCost(s, near, AEGIS_TEST_BLOW);
  let halvedFrames = 0;
  let wholeAt = -1;
  for (let frame = 1; frame <= AEGIS_DURATION_FRAMES * AEGIS_WATCH_SPANS && wholeAt < 0; frame++) {
    near.tickTimers();
    near.invulnerableFrames = 0;
    const taken = blowCost(s, near, AEGIS_TEST_BLOW);
    if (taken === halved) halvedFrames++;
    else if (taken === AEGIS_TEST_BLOW) wholeAt = frame;
  }
  report.check(
    firstBlow === halved,
    'the aegis halves a blow',
    `${AEGIS_TEST_BLOW} → ${firstBlow}`,
  );
  report.check(
    halvedFrames === AEGIS_DURATION_FRAMES &&
      wholeAt === AEGIS_DURATION_FRAMES + STATUS_EXPIRY_TICK,
    `the aegis halves every blow for the ${AEGIS_DURATION_FRAMES} ticks after it lands, then stops`,
    `halved for ${halvedFrames} more frames, whole from frame ${wholeAt}`,
  );
  report.checkCatches(
    blind.hasStatus(FAIRY_AEGIS_STATUS) && blowCost(s, blind, AEGIS_TEST_BLOW) === halved,
    'a mob whose damage path ignores the aegis is caught taking the whole blow',
    `${blowCost(s, blind, AEGIS_TEST_BLOW)}`,
  );

  const refreshed = aegisTicksAfterSecond(
    new Goblin(FAIRY_TILE, FAIRY_TILE, TILE_SIZE, GOBLIN_WEAPON),
  );
  report.check(
    refreshed === AEGIS_DURATION_FRAMES,
    `a second aegis ${AEGIS_REFRESH_GAP_FRAMES} frames into the first refreshes it rather than stacking or being ignored`,
    `${refreshed} frames left, ${AEGIS_DURATION_FRAMES} for a refresh`,
  );
  const kept = aegisTicksAfterSecond(
    new AegisKeepingGoblin(FAIRY_TILE, FAIRY_TILE, TILE_SIZE, GOBLIN_WEAPON),
  );
  report.checkCatches(
    kept === AEGIS_DURATION_FRAMES,
    'a mob that ignores a second aegis is caught running out on the first',
    `${kept} frames left`,
  );
}

/**
 * Aegis frames `mob` holds once a second aegis lands
 * {@link AEGIS_REFRESH_GAP_FRAMES} into the first, summed over every aegis it
 * carries so a stacked pair shows as more than one aegis's worth.
 */
function aegisTicksAfterSecond(mob: Goblin): number {
  mob.applyStatus(makeFairyAegis(AEGIS_DURATION_FRAMES));
  for (let frame = 0; frame < AEGIS_REFRESH_GAP_FRAMES; frame++) mob.tickTimers();
  mob.applyStatus(makeFairyAegis(AEGIS_DURATION_FRAMES));
  return mob.statusEffects
    .filter((effect) => effect.type === FAIRY_AEGIS_STATUS)
    .reduce((sum, effect) => sum + effect.ticksRemaining, 0);
}

/**
 * A shield fairy that keeps its ward list through a called-off fight, so a
 * fairy reset mid-encounter would come back with its slots already spent.
 */
class WardHoardingShieldFairy extends ShieldFairy {
  protected override clearEncounterPhase(): void {
    const held = [...this.warded];
    super.clearEncounterPhase();
    this.warded.push(...held);
  }
}

/** Wards held by a level-1 fairy on normal once its fight is called off. */
function wardsAfterReset(make?: ShieldFactory): { wardedFirst: boolean; heldAfter: number } {
  const s = shieldStage({ make });
  const goblin = s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE);
  const wardedFirst = s.tickUntil(() => isWardedBy(goblin, s.fairy), FIRST_WARD_FRAMES) > 0;
  s.fairy.healAndForgetFight();
  return { wardedFirst, heldAfter: s.fairy.wardedAllies.length };
}

function checkResetAndDepartures(report: FairyGateReport): void {
  const reset = wardsAfterReset();
  report.check(
    reset.wardedFirst && reset.heldAfter === 0,
    "a called-off fight empties the fairy's ward list",
    `${reset.heldAfter} still held`,
  );
  const hoarder = wardsAfterReset((x, y) => new WardHoardingShieldFairy(x, y, TILE_SIZE));
  report.checkCatches(
    hoarder.wardedFirst && hoarder.heldAfter === 0,
    'a fairy that keeps its ward list through the reset is caught holding it',
    `${hoarder.heldAfter} still held`,
  );

  const departed = secondAllyAfterFirstLeaves(true);
  report.check(
    departed.firstWarded && departed.secondWarded,
    'a warded ally that leaves the mob list frees its slot: a fairy with every slot full wards a new ally',
    `ward count ${departed.wardCount}`,
  );
  const stayed = secondAllyAfterFirstLeaves(false);
  report.checkCatches(
    stayed.firstWarded && stayed.secondWarded,
    'the same fairy with its first ally still in the scene is caught with no slot to spare',
  );
}

/**
 * A level-1 fairy fills every ward slot it has; one warded goblin then leaves
 * the scene (or, for the negative, stays), and another arrives.
 */
function secondAllyAfterFirstLeaves(firstLeaves: boolean): {
  firstWarded: boolean;
  secondWarded: boolean;
  wardCount: number;
} {
  const s = shieldStage();
  const opening: Mob[] = [];
  for (let i = 0; i < s.fairy.wardCount; i++) {
    opening.push(s.add('goblin', FAIRY_TILE + NEIGHBOR_OFFSET_TILES, FAIRY_TILE + i));
  }
  const allWarded = (): boolean => opening.every((mob) => isWardedBy(mob, s.fairy));
  const firstWarded = s.tickUntil(allWarded, FILL_FRAMES) > 0;
  const first = opening[0];
  if (firstLeaves) {
    s.roster.replaceAll(s.roster.mobs.filter((mob) => mob !== first));
    s.roster.rebuildGrid();
    setPackAlertGrid(s.roster.grid);
  }
  const second = s.add('goblin', FAIRY_TILE - NEIGHBOR_OFFSET_TILES, FAIRY_TILE);
  // The fairy drifts off to its warded goblins, and a replacement ward waits
  // for the crawler to have it in view, so the crawler keeps up with it.
  const secondWarded =
    s.tickUntil(() => {
      stepIntoView(s);
      return isWardedBy(second, s.fairy);
    }, FILL_FRAMES) > 0;
  return { firstWarded, secondWarded, wardCount: s.fairy.wardCount };
}

export function verifyShieldFairy(report: FairyGateReport): void {
  report.section('Shield fairy');
  checkInvulnerability(report);
  checkLabelThrottle(report);
  checkPotencyAndPriority(report);
  checkWardCountOverPotency(report);
  checkOneWardPerMob(report);
  checkNoShieldOnShield(report);
  checkCastInFlight(report);
  checkWaitsToBeSeen(report);
  checkRefusals(report);
  checkDeath(report);
  checkResetAndDepartures(report);
}
