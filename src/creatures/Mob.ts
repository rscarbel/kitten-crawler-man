import { Player, HP_BAR_HEIGHT, HP_BAR_Y_OFFSET } from '../Player';
import type { DamageSource } from '../Player';
import { FAIRY_AEGIS_STATUS, type StatusEffect } from '../core/StatusEffect';
import { AEGIS_DAMAGE_SCALE } from '../core/statusTuning';
import { MOB_MAX_PATH_DISTANCE_TILES, type GameMap } from '../map/GameMap';
import { verticalCollisionOffset } from '../map/collisionAnchors';
import type { ItemId } from '../core/ItemDefs';
import { randomInt } from '../utils';
import { AGGRO_PERSIST_MULTIPLIER, PLAYER_SPEED, WADE_SPEED_FACTOR } from '../core/constants';
import { tryConsumePathfind } from './pathfindBudget';
import { alertPackAround } from './packAlert';
import { activeRunStats } from '../core/GameStats';
import {
  scaledCooldownFramesForLevel,
  scaledDamageForLevel,
  levelledMaxHp,
  SHARED_LEVELLED_CURVE,
  speedScaleForLevel,
  type LevelledCurve,
} from './mobLevelScaling';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Rng } from '../sprites/person/rng';
import { knockbackStepPx } from '../core/knockbackEase';
import { MobTactics } from './tactics/MobTactics';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { retreatTowardHelper } from './tactics/retreat';
import { isMarkedGround, markedGroundEscape } from './tactics/markedGround';
import { stepAlongEscape } from '../systems/GroundHazardSource';
import { SEPARATION_RADIUS } from '../systems/mobSeparation';
import type { KiteAim, TacticalMove } from './tactics/tacticalFrame';
import type { SilhouetteLayer } from '../core/silhouetteComposite';
import type { SiegeCapable, SiegeDirective } from './siege/siegeTypes';
import {
  GUARD_KNOCKBACK_FRAMES,
  GUARD_KNOCKBACK_TILES,
  isGuardableBlow,
} from './tactics/blockGuard';

/**
 * The weapon a player-sourced blow was struck with, named so that everything
 * downstream of a hit — kill credit, ability XP, death animations, friendly-fire
 * immunity — can key off what actually landed. `null` is harm an attacker owns
 * but swung nothing for: a damage-over-time tick they applied.
 */
export type PlayerDamageType = 'melee' | 'missile' | 'shell' | 'smush' | 'explosion' | 'slingshot';

/**
 * The one damage type that ignores friendly-fire immunity, so the rule lives in
 * a single place rather than as a string literal repeated at every blast site.
 */
const EXPLOSION_DAMAGE_TYPE = 'explosion' satisfies PlayerDamageType;

/** The share of a dynamite blast any boss takes; see `Mob.blastDamageScale`. */
export const BOSS_BLAST_DAMAGE_SCALE = 0.25;

/**
 * How one of this mob's blows reached its victim.
 *
 * Only `'contact'` — the mob's own body, teeth or weapon touching the target —
 * can be sent back by reflect gear. A bolt, a thrown weight, a spit, a reaching
 * tongue or a shockwave that resolves over an area has nothing for the victim's
 * armour to bite into, so it does not reflect.
 */
export type MobBlowDelivery = 'contact' | 'ranged';

/** The damage source every blow a mob lands is described by. */
export type MobDamageSource = Extract<DamageSource, { kind: 'mob' }>;

/** Shared by every creature that has not opted in to any tactics trait. */
export const NO_TACTICS: readonly TacticsTrait[] = [];

/** A kite or regroup is walked at no more than this share of the player's speed. */
const TACTICAL_RETREAT_MAX_SPEED_RATIO = 0.8;
/**
 * The fastest a mob walks while falling back. A player who chases a kiter must
 * be able to catch it, and some creatures' own walk is quicker than the player's.
 */
export const TACTICAL_RETREAT_MAX_SPEED = PLAYER_SPEED * TACTICAL_RETREAT_MAX_SPEED_RATIO;

/** The floating label a guarded blow shows over the mob. */
const GUARD_LABEL = 'Blocked';

/** Stagger range for initial wander timer so mobs don't change direction together. */
const WANDER_TIMER_STAGGER_MAX = 119;

/**
 * The fraction of the player's own speed that levelling alone may take a mob to.
 *
 * Under one, so retreating always remains an option the player actually has: a
 * fight they cannot walk out of is the one shape of difficulty that no amount of
 * skill answers. Creatures authored faster than this keep their own speed — see
 * {@link Mob.levelledSpeedCap} — the bound is on what levelling adds.
 */
const LEVELLED_SPEED_PLAYER_RATIO = 0.9;
/** Per-level coin scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_COIN_SCALE = 0.25;
/** Per-level XP scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_XP_SCALE = 0.25;

/**
 * The most of its own walk step a mob may be displaced by separation in one
 * frame. Under 1 so the AI always wins the tug-of-war: a stack still comes
 * apart, but over several frames, as drift rather than as a bounce. See
 * {@link Mob.applySeparation}.
 */
const MAX_SEPARATION_STEP_FRACTION = 0.5;

/**
 * How far past the separation radius still counts as touching a crawler:
 * separation leaves a resting body exactly at the radius, and it has to read as
 * still in contact there, or it walks back in and is pushed out every frame.
 */
export const PARTY_CONTACT_SLACK_RATIO = 1.1;

/**
 * How close to the owner a crawler stands to count as with her rather than
 * left behind. The following crawler trails the active one by up to about two
 * and a half tiles on her own follow rules, so this covers that with room.
 */
export const PARTY_HUDDLE_TILES = 3;

/** Fraction of tile for center offset used in same-tile and LOS checks. */
const MOB_TILE_CENTER = 0.5;

/** Waypoint proximity threshold: pop when within this fraction of a tile. */
const ASTAR_WAYPOINT_CLOSE_FRACTION = 0.55;

/** Default A* path refresh interval in frames. */
const ASTAR_DEFAULT_REFRESH = 30;

/** Largest per-mob offset added to the refresh interval, spreading repaths over frames. */
const ASTAR_STAGGER_MAX = 15;

/**
 * Wait this long before retrying after A* found no route. An unreachable target
 * stays unreachable, so retrying twice a second only burns the expansion cap.
 *
 * Exported because it sets how long {@link Mob.astarSearchFailed} stays true:
 * that flag is a latch held for this whole window rather than a fresh verdict
 * each frame, so anything counting frames of failure has to outlast it or it is
 * really only measuring one search.
 */
export const ASTAR_FAILURE_BACKOFF_FRAMES = 120;

/**
 * Floor on how often a moved goal tile may trigger an early repath. A target
 * moving diagonally crosses tile boundaries almost every frame, which would
 * otherwise defeat the refresh interval entirely.
 */
const ASTAR_MIN_REPATH_GAP_FRAMES = 8;

/**
 * After this many consecutive frames of being denied by the per-frame search
 * budget, a mob searches regardless. Bounds how stale any one mob's path can
 * get when a large pack all want to repath at once.
 *
 * Exported alongside {@link ASTAR_FAILURE_BACKOFF_FRAMES} because it extends the
 * same latch: once the backoff expires the retry is only *wanted*, not run, and
 * a crowded frame can withhold it for this long on top. The true worst case for
 * how long `astarSearchFailed` can read true is the two added together.
 */
export const ASTAR_MAX_DENIED_FRAMES = 20;

/** Sentinel goal tile meaning "no path has been computed yet". */
const NO_ASTAR_GOAL = -1;

/** How long a line-of-sight result stays usable before it is recomputed. */
const LOS_REFRESH_FRAMES = 3;

/**
 * How long a *perception* result stays usable before it is recomputed.
 *
 * Deliberately much longer than `LOS_REFRESH_FRAMES`: noticing someone is not a
 * frame-accurate event, and a fifth of a second before an idle mob reacts to
 * someone stepping out of cover reads as reaction time rather than as lag. Only
 * mobs that have not engaged anything pay this cost, one ray per candidate per
 * window, so this constant is the direct lever on what the perception gate
 * costs across a crowded level.
 */
const NOTICE_REFRESH_FRAMES = 12;

/** Per-mob offset on the notice window so a pack never re-checks in lockstep. */
const NOTICE_STAGGER_MAX = NOTICE_REFRESH_FRAMES - 1;

/**
 * How long a target that hurt this mob stays noticed even without line of sight
 * (~5 seconds at 60 fps).
 *
 * Without this, the perception gate would make a mob ignore an archer shooting
 * it from behind a wall — the sight test says "nothing there" and the mob would
 * stand in the open being shot. Being hit is perception too.
 */
const ALERT_DURATION_FRAMES = 300;

/** How many stuck frames before flipping the perpendicular steer direction. */
const STUCK_FLIP_FRAMES = 50;

/**
 * How firmly a target must clear this mob's own centre, in tiles, before
 * `faceToward` is allowed to flip which side a mirrored sprite faces.
 *
 * Below this a target sitting almost directly above or below — or a player
 * strafing at melee range while the mob holds still to fight — pushes the
 * raw direction's sign back and forth every frame with nothing behind it but
 * a flickering sprite. Other bosses already work around the same underlying
 * instability by locking a copy of `facingX` before a committed swing
 * (`Troglodyte.lockedFacingX`, `TheLich.lockedFacingX`); this keeps the
 * source itself from chattering in the first place.
 */
export const FACING_FLIP_DEADZONE_TILE_RATIO = 0.12;

/** Speed multiplier while mob is slowed. */
export const MOB_SLOWED_SPEED_FRACTION = 0.35;

/** The outline a converted mob wears: soul green, so it never reads as an enemy still to fight. */
const CONVERTED_RIM: SilhouetteLayer = { rimColor: '#6ee7b7', rimAlpha: 0.95 };
/**
 * A converted mob heads back to its rally point once this far outside it, and
 * stops once it is this share of the radius inside — so it does not turn round
 * on the line and shuffle there.
 */
const ALLY_RALLY_SETTLE_FRACTION = 0.6;

/** Lifetime of a hit-applied slow — one frame, refreshed by each new impact. */
const HIT_SLOW_FRAMES = 1;

/**
 * How a creature with no swing of its own strikes a structure: the frames the
 * blow takes, the frame into it that the blow lands on, and the frames before
 * it may strike again, counted from the start of the swing.
 */
export interface StructureStrikeTiming {
  readonly swingFrames: number;
  readonly impactFrame: number;
  readonly cooldownFrames: number;
}

const DEFAULT_STRUCTURE_STRIKE_TIMING: StructureStrikeTiming = {
  swingFrames: 24,
  impactFrame: 12,
  cooldownFrames: 60,
};

/** What one generic blow on a structure deals at level 1, before the siege multiplier. */
const DEFAULT_STRUCTURE_STRIKE_BASE_DAMAGE = 2;

/** An assault creature's blow on a structure lands at its own full weight unless it says otherwise. */
const DEFAULT_SIEGE_STRUCTURE_MULTIPLIER = 1;

/** Tile edge fractions for wall collision (leading edge ahead/behind). */
const MOB_COLLISION_FRONT_FRACTION = 0.72;
const MOB_COLLISION_BACK_FRACTION = 0.28;

/** Frames to show the health bar after taking damage (~3 seconds at 60 fps). */
const HEALTH_BAR_VISIBLE_FRAMES = 180;
/**
 * A tick's share of that.
 *
 * Sized under the two-second gap between sepsis and poison ticks, because those
 * two are the ones that can outlast a fight — sepsis never expires at all — and
 * a bar that outlives the gap between its own ticks never goes out. The faster
 * DoTs (burn, spit venom) do hold the bar unbroken, which is correct: they are
 * seconds long, and a creature visibly on fire is a creature worth a bar.
 */
const STATUS_TICK_HEALTH_BAR_FRAMES = 90;
/** Frame count for damage flash. */
const MOB_DAMAGE_FLASH_FRAMES = 8;

/**
 * How long a mob brought back where it fell takes to stand up, during which it
 * refuses all damage and runs no AI. The same beat a summoned skeleton takes to
 * climb out of the ground, for the same reason: a return that can be cut down
 * before it has finished reads as never having happened.
 */
export const REVIVE_IN_PLACE_RISE_FRAMES = 40;
/** Frames at which health bar starts fading out. */
const HEALTH_BAR_FADE_FRAMES = 40;

/** Wander: probability of pausing instead of walking. */
const WANDER_PAUSE_CHANCE = 0.3;
/** Wander: speed fraction for random direction walks. */
const WANDER_SPEED_FRACTION = 0.35;
/** Wander: timer range between direction changes (frames). */
const WANDER_TIMER_MIN = 90;
const WANDER_TIMER_MAX = 219;
/** Wander: max radius from spawn before pulling back. */
const WANDER_MAX_RADIUS_TILES = 4;
/** Wander: speed fraction for pull-back-to-spawn movement. */
const WANDER_PULLBACK_SPEED_FRACTION = 0.4;

/** Default health potion drop chance. */
const DEFAULT_POTION_DROP_CHANCE = 0.25;
/** Default scroll of confusing fog drop chance. */
const DEFAULT_FOG_SCROLL_DROP_CHANCE = 0.05;
/** Speed Fizz drop chance from mobs (very rare — primary source is chests). */
const SPEED_FIZZ_DROP_CHANCE = 0.005;
/** Jugg Juice drop chance from mobs (very rare — primary source is chests). */
const JUGG_JUICE_DROP_CHANCE = 0.005;
/** Cooldown Crisp drop chance from mobs (very rare — primary source is chests). */
const COOLDOWN_CRISP_DROP_CHANCE = 0.003;
/** Stat Boost Potion drop chance from mobs (extremely rare — primary source is chests). */
const STAT_BOOST_DROP_CHANCE = 0.001;
/** Slingshot world-drop chance, on floors that enable it, per eligible mob kill. */
const SLINGSHOT_DROP_CHANCE = 0.005;

/** Aggro indicator font size. */
const AGGRO_INDICATOR_FONT_SIZE = 18;
/** Aggro indicator stroke line width. */
const AGGRO_INDICATOR_LINE_WIDTH = 3;
/** Aggro indicator Y offset above mob. */
const AGGRO_INDICATOR_Y_OFFSET = 3;

/** Star drawn beside the health bar of a mob that rolled at least one tactics trait. */
const TACTICS_RANK_MARK = '★';
/** Gap between the health bar's right edge and the rank mark. */
const TACTICS_RANK_MARK_GAP = 3;

/** Septic label Y offset above health bar. */
const SEPTIC_LABEL_Y_OFFSET = 12;
/** Septic label secondary Y offset. */
const SEPTIC_LABEL_Y2_OFFSET = 7;
/** Septic label font size. */
const SEPTIC_LABEL_SIZE = 9;
/** Septic pulse amplitude (fraction added to base brightness). */
const SEPTIC_PULSE_AMP = 0.3;
/** Septic pulse base brightness. */
const SEPTIC_PULSE_BASE = 0.7;
/** Septic pulse oscillation speed. */
const SEPTIC_PULSE_SPEED = 0.006;

/** Minimal shell API exposed to mobs — avoids a circular import with SpellSystem. */
export interface ShellContext {
  isPointInsideShell(cx: number, cy: number): boolean;
  addBlockXp(amount: number): void;
}

export interface LootDrop {
  coins: number;
  items: Array<{ id: ItemId; quantity: number }>;
  goldDoubled?: boolean;
}

/** A mob drawn no larger than its own tile needs only a tile of slack. */
const DEFAULT_CULL_MARGIN_TILES = 1;

/** Slack the hit flash keeps around any mob, however small it claims to be. */
const MIN_HIT_FLASH_MARGIN_TILES = 1.5;

/**
 * Abstract base for all enemy mobs. Subclasses define their own AI, appearance,
 * and speed. `updateAI` is called every frame by the game loop.
 */
/**
 * How far inside its leash a camp resident walks before it stops walking home.
 * Hysteresis: turning around exactly on the line makes it oscillate there.
 */
const LEASH_SETTLE_FRACTION = 0.5;

/** How far ahead a resident paths on each leg of its walk home, in tiles. */
const LEASH_RETURN_HOP_TILES = 10;

export abstract class Mob extends Player {
  protected speed: number;
  abstract readonly xpValue: number;

  /**
   * How far outside its own tile this mob's art reaches, in tiles — the render
   * pipeline keeps it alive this far past the screen edge. Override in any mob
   * drawn larger than its tile, or it pops in with part of it already on screen.
   * An override must not exceed `MAX_MOB_CULL_MARGIN_TILES`, the width of the
   * pipeline's own query.
   */
  get cullMarginTiles(): number {
    return DEFAULT_CULL_MARGIN_TILES;
  }

  /**
   * A mob already declares how far its art overreaches its tile, so the hit
   * flash reuses that answer rather than asking every mob the same thing twice.
   *
   * Floored, because the two costs are not symmetric: a mob that under-declares
   * its margin only pops in at the screen edge, but a flash cut to the same box
   * would slice the sprite in half in the middle of a fight.
   */
  protected override get hitFlashMarginTiles(): number {
    return Math.max(this.cullMarginTiles, MIN_HIT_FLASH_MARGIN_TILES);
  }

  /** The player this mob is currently chasing/attacking. Set each frame in updateAI. */
  currentTarget: Player | null = null;

  /**
   * Where this mob belongs, and how far it will stray from it — set only for the
   * residents of a floor-3 camp.
   *
   * **Both are optional and default to unset, and unset means the old behaviour
   * exactly.** `isBeyondLeash` returns false and `returnHomeOrWander` falls
   * straight through to `doWander`, so a goblin on floor 1 takes a code path
   * that is unchanged: no extra branch it can fail, no field it can read stale.
   * The camp spawner is the only writer.
   *
   * A leash exists because a camp is a landmark. Residents that chase a player
   * across half the map leave the landmark empty, and what the player then finds
   * on their way back is an abandoned camp with nothing to say.
   *
   * `homePoint` is in **pixels**, like `x`/`y`; `leashRadiusTiles` is in tiles
   * and is multiplied by `tileSize` at every comparison.
   */
  homePoint?: { x: number; y: number };
  /** Set beside `homePoint`; both in the same units the mob's own `x`/`y` are. */
  leashRadiusTiles?: number;
  /**
   * The `campSiteKey` of the camp this mob was spawned to live in, or null for
   * everything that is not a camp resident. Held on the mob rather than in a
   * per-camp list, so nothing outside the roster pins a resident once it is
   * gone. Written by the camp spawner only.
   */
  campKey: string | null = null;

  /** Tracks how much damage each player has dealt to this mob (for XP split). */
  readonly damageTakenBy = new Map<Player, number>();

  private _hasStruckPlayer = false;
  private _framesSinceStruckPlayer = Number.MAX_SAFE_INTEGER;

  /**
   * Whether this mob has actually landed a blow on a crawler.
   *
   * Half of the companion's answer to "is this fight ours" — the other half is
   * {@link wasDamagedByParty}. `currentTarget` used to stand in for both, and it
   * cannot: it is set by proximity, sometimes without line of sight, so a mob
   * that had merely turned its head read as a mob the party was fighting. That
   * is what sent the companion across the level after something behind a wall,
   * and what let it open a boss fight through a doorway nobody had crossed.
   * Blood is a fact; noticing is not.
   */
  get hasStruckPlayer(): boolean {
    return this._hasStruckPlayer;
  }

  /**
   * Frames since this mob last landed a blow on a crawler, and effectively
   * infinite for one that never has.
   *
   * {@link hasStruckPlayer} answers "has this mob ever fought us", which is the
   * right question for a boss room — a fight, once started, has started. It is
   * the wrong question for "is this mob biting the player *now*", because it
   * latches for good: a wasp that spat on somebody once at the top of the floor
   * would read as an active threat for the rest of it.
   */
  get framesSinceStruckPlayer(): number {
    return this._framesSinceStruckPlayer;
  }

  /**
   * Whether either crawler has landed a blow on this mob — read off the damage
   * ledger, which only real damage writes to, rather than exposing the map.
   *
   * Credited rather than literal, so a wound the pet dealt counts as the cat's:
   * a mob the party's summon is fighting is a mob the party is fighting.
   */
  get wasDamagedByParty(): boolean {
    for (const dealer of this.damageTakenBy.keys()) {
      if (dealer.xpCreditTarget.isCrawler) return true;
    }
    return false;
  }

  /**
   * Record that one of this mob's attacks landed on `target`.
   *
   * Called for you by {@link dealDamage} and {@link dealPreScaledDamage}. Any
   * other route a mob's harm can take must call it itself, or the companion
   * will not count that mob as having engaged anybody — and half the game's
   * damage takes another route. A subclass that prices its own blow (a
   * trample, a roll) does it inline; an arrow, a bolt or a thrown rock is
   * resolved by the system that owns the projectile, long after the mob that
   * launched it has moved on, which is why this is public rather than
   * protected.
   *
   * Only ever called for a blow that actually connected: a swing the target
   * dodged, or one a safe room swallowed, is not blood.
   */
  noteStruckPlayer(target: Player): void {
    if (!target.isCrawler) return;
    this._hasStruckPlayer = true;
    this._framesSinceStruckPlayer = 0;
  }

  /** Set to true on the frame this mob's HP reaches 0; game loop reads and resets it. */
  justDied = false;

  /** Loot generated when this mob dies; null if nothing dropped. */
  droppedLoot: LootDrop | null = null;

  /**
   * Set when something brought this mob back where it fell, so the second death
   * pays nothing. A kill is paid for once: without this, a mob raised over and
   * over would be an XP and loot farm.
   */
  wasResurrected = false;

  /**
   * Set on a mob whose kill must never pay: XP, coin or loot. For bodies that
   * exist only because an enemy conjured them mid-fight, where the enemy can
   * conjure more than the party could ever be meant to earn from.
   */
  paysNoRewards = false;

  /**
   * Whether this mob's death counts as a kill — in the run's kill tally and
   * toward kill achievements. False only for something whose death is never a
   * feat, like a village cow caught in a blast.
   */
  get countsAsKill(): boolean {
    // An ally's death is a loss, not a feat.
    return !this.isConverted;
  }

  /** Whether killing this mob pays XP, coin and loot. */
  get paysRewards(): boolean {
    return !this.wasResurrected && !this.paysNoRewards;
  }

  private reviveRiseFramesLeft = 0;

  /** True while a mob brought back by {@link reviveInPlace} is still standing up. */
  get isReviving(): boolean {
    return this.reviveRiseFramesLeft > 0;
  }

  /** 0 to 1 across a {@link reviveInPlace} rise, or null when none is playing. */
  get reviveRiseProgress(): number | null {
    if (this.reviveRiseFramesLeft <= 0) return null;
    return 1 - this.reviveRiseFramesLeft / REVIVE_IN_PLACE_RISE_FRAMES;
  }

  /**
   * Brings this dead mob back to life where it fell, at `hpFraction` of its
   * max HP, already hunting the party, and never paying for a second kill.
   *
   * Built on {@link reviveForCheckpoint} so that every subclass's own death
   * state — a burst animation, a phase latch — is unwound by the same override
   * that already unwinds it for a checkpoint; only the teleport to the spawn
   * tile is undone afterward.
   *
   * @param grid The mob grid, which the mob left when it died and must rejoin
   *   to be drawn, targeted and hit again.
   */
  reviveInPlace(hpFraction: number, grid: SpatialGrid<Mob>): void {
    const fellAtX = this.x;
    const fellAtY = this.y;
    grid.remove(this);
    this.reviveForCheckpoint();
    this.x = fellAtX;
    this.y = fellAtY;
    this.hp = Math.max(1, Math.min(this.maxHp, Math.round(this.maxHp * hpFraction)));
    this.forceAggro = true;
    this.wasResurrected = true;
    // A first death nobody in the party earned leaves its roll on the corpse,
    // and the second death, which pays nothing, must not hand it out.
    this.droppedLoot = null;
    this.reviveRiseFramesLeft = REVIVE_IN_PLACE_RISE_FRAMES;
    grid.insert(this);
  }

  /**
   * Whether every route into this mob's health is refusing damage right now:
   * its own {@link isDamageImmune}, or a {@link reviveInPlace} rise. Public so
   * a caster outside the class can skip a target a ward or heal would be wasted
   * on.
   */
  get refusesDamage(): boolean {
    return this.isDamageImmune || this.reviveRiseFramesLeft > 0;
  }

  /**
   * The most HP a fairy's heal may lift this mob to. Max HP unless a phased
   * boss overrides it, so healing can never carry a boss back up across a
   * phase threshold the party has already fought it through.
   */
  get fairyHealCeiling(): number {
    return this.maxHp;
  }

  /** Coin drop range — subclasses override with their own min/max. */
  protected coinDropMin = 0;
  protected coinDropMax = 0;

  /** Frames remaining to show the health bar (set on each hit). */
  healthBarTimer = 0;

  /** World-pixel position this mob spawned at — used to cap wander radius. */
  protected readonly spawnX: number;
  protected readonly spawnY: number;

  /** Last target position this mob had a clear LOS to — used for wall-aware navigation. */
  protected lastKnownTargetX = 0;
  protected lastKnownTargetY = 0;

  /** Target the cached line-of-sight result refers to; see `hasLOS`. */
  private losCacheTarget: Player | null = null;
  private losCacheResult = false;
  private losCacheAge = LOS_REFRESH_FRAMES;

  /**
   * Sight results for aggro candidates, refreshed as a whole set; see `canNotice`.
   *
   * Kept separate from `losCache*` rather than reusing it: that cache holds
   * exactly one target and is read every frame by the mob's *engaged* logic, so
   * asking it about the other candidates in an aggro scan would evict the
   * engaged target's entry and turn both questions into a fresh traversal per
   * call — the one outcome this whole change has to avoid.
   */
  private readonly noticeCache = new Map<Player, boolean>();
  private noticeCacheFrames = 0;
  private readonly noticeStagger = randomInt(0, NOTICE_STAGGER_MAX);

  /**
   * Targets that have hurt this mob recently, mapped to the frames of alert
   * remaining. An alerted target is noticed regardless of line of sight.
   */
  private readonly alertedTo = new Map<Player, number>();

  /** Cached A* waypoint list (tile coords). Followed by followTargetAStar. */
  private astarPath: Array<{ x: number; y: number }> = [];
  /** Frames until the A* path is recalculated. */
  private astarTimer = 0;
  /** Per-mob offset on the refresh interval so a pack doesn't repath in lockstep. */
  private readonly astarStagger = randomInt(0, ASTAR_STAGGER_MAX);
  /** Goal tile the cached path leads to; when the goal moves off it, repath early. */
  private astarGoalTX = NO_ASTAR_GOAL;
  private astarGoalTY = NO_ASTAR_GOAL;
  private astarFramesSinceRepath = 0;
  /** Consecutive frames this mob wanted to repath but the frame budget was spent. */
  private astarDeniedFrames = 0;
  /** True when the last search found no route — holds off the goal-moved trigger. */
  private astarLastSearchFailed = false;

  /** Frames the mob has been fully stuck (both axes blocked) — triggers steering flip. */
  private stuckFrames = 0;
  /** +1 or -1: direction to rotate the movement vector when stuck. */
  private steerSign = 1;

  protected wanderTimer: number;
  protected wanderDx = 0;
  protected wanderDy = 0;

  protected map: GameMap | null = null;

  /**
   * Whether this mob has been given the map it lives on.
   *
   * Exposed only so a bounty def's contract can be *checked* — a mob spawned
   * without one has no collision and never pathfinds (`moveWithCollision` adds
   * its delta unconditionally), and nothing about that is visible until the
   * fight starts. See `scripts/verify-bounty.ts`.
   */
  get hasMap(): boolean {
    return this.map !== null;
  }

  /** Shell context injected by DungeonScene — used by subclasses to check shell state. */
  protected spells: ShellContext | null = null;

  /** True for boss-tier mobs — used by DungeonScene to identify which mob belongs to which boss room. */
  isBoss = false;

  /**
   * Whether killing this counts toward the run's "bosses slain".
   *
   * Separate from {@link isBoss}, which commits a mob to a boss room's lock and
   * clamp: the Lich, the spider-lab spider, the arena's Ball of Swine and the
   * circus's Terror are bosses to the player without being room bosses, and
   * setting the flag on them would drag them into machinery they have no room
   * for. Each overrides this instead.
   */
  get countsAsBossKill(): boolean {
    return this.isBoss;
  }

  /**
   * Knee-high: a blow thrown at chest height passes over it. The crawler's
   * animator throws punts and stomps at a low-profile target rather than
   * punches — he earned Foot Soldier punting rats.
   */
  get lowProfile(): boolean {
    return false;
  }
  /** Set each frame by DungeonScene when this mob is inside an active confusing fog. */
  isConfused = false;

  /**
   * Opt-out from the Scroll of Confusing Fog. Read by SpellSystem so `isConfused`
   * is never set in the first place — flagging and then ignoring would lie to
   * every other reader of that flag.
   */
  immuneToConfusion = false;

  /**
   * The most of a victim's own max HP any one blow from this mob may take, or
   * null for no cap. Set on encounters that promise no blow ever kills from
   * full (a bounty's mark and escort) and carried on every source this mob's
   * harm is dealt through — its own blows and the projectiles it launches — so
   * the victim can hold it after its own difficulty scaling.
   */
  blowCapShareOfTargetHp: number | null = null;

  /** `source` with this mob's blow cap on it, if it has one. */
  stampBlowCap(source: MobDamageSource): MobDamageSource {
    if (this.blowCapShareOfTargetHp === null) return source;
    return { ...source, maxShareOfTargetHp: this.blowCapShareOfTargetHp };
  }

  /**
   * When true this mob hunts players sheltering inside the town safe zone.
   * Ambient mobs leave it false and deaggro at the town line; scripted spawns
   * (Quill's summons, a bounty encounter lured home) set it so a player cannot
   * simply outrun the fight to the plaza.
   *
   * Only mobs whose `acquireTarget` passes a town-safe-zone predicate consult
   * it; classes with no such predicate are already aggressive everywhere.
   */
  ignoresTownSafeZone = false;

  /** Set each frame by BarrierSystem when this mob is adjacent to a placed barrier. */
  slowedByBarrier = false;

  /** Frames left on a slow applied by a hit; see `applyHitSlow`. */
  private hitSlowFrames = 0;

  /**
   * Derived rather than stored: a slow has several independent sources, and a
   * stored flag left each of them able to strand the mob at reduced speed.
   */
  get isSlowed(): boolean {
    return (
      this.slowedByBarrier ||
      this.hitSlowFrames > 0 ||
      this.hazardSlowFrames > 0 ||
      this.hasStatus('electrified')
    );
  }

  /** Frames left on a slow laid by standing in hazard ground; see {@link applyHazardSlow}. */
  private hazardSlowFrames = 0;

  /**
   * Slows this mob for `frames` because it is standing in something that
   * drags at it — a cloud or a mire an ally laid. The owner of the ground
   * refreshes it every frame the mob stays inside, so the slow lifts a moment
   * after it walks out rather than needing anyone to clear it.
   */
  applyHazardSlow(frames: number): void {
    this.hazardSlowFrames = Math.max(this.hazardSlowFrames, frames);
  }

  /** Frames left on a root; see {@link root}. */
  private rootFrames = 0;
  /** Whatever rooted this mob, so only it can release the hold early. */
  private rootSource: object | null = null;

  /**
   * Holds this mob in place for `frames`: its own steps — chase, wander,
   * separation — are refused, the way a knockback refuses them, while it may
   * still attack anything in reach and a knockback still carries it. A snare
   * stopping an enemy in place, where the party's defences can reach it.
   *
   * Deliberately not {@link aiHeld}: that stops the AI outright, dropping the
   * target and every attack with it, which would turn a snare into a stun. A
   * rooted undead on the wall line keeps clawing at the wall, and that is the
   * point — it is held where the trebuchets can hit it.
   *
   * A longer hold already running is kept; `source` is recorded so only the
   * thing that rooted the mob can let it go early ({@link releaseRoot}).
   */
  root(frames: number, source: object): void {
    if (frames <= 0) return;
    if (frames >= this.rootFrames) this.rootSource = source;
    this.rootFrames = Math.max(this.rootFrames, frames);
  }

  /** Ends a hold early, if `source` is what is holding this mob. */
  releaseRoot(source: object): void {
    if (this.rootSource !== source) return;
    this.rootFrames = 0;
    this.rootSource = null;
  }

  /** Whether this mob is held in place. */
  get isRooted(): boolean {
    return this.rootFrames > 0;
  }

  /** What is holding this mob in place, or null. */
  get rootedBy(): object | null {
    return this.rootFrames > 0 ? this.rootSource : null;
  }

  /**
   * Whether separation must leave this mob where it stands and push its
   * neighbours the whole way instead. A rooted mob refuses the step anyway;
   * without this its share of the push is simply lost, and a body pressed
   * against it overlaps it for the whole hold.
   */
  get separationAnchored(): boolean {
    return this.rootFrames > 0;
  }

  /**
   * Slows this mob for a single frame. Refreshed by every impact, so the slow
   * holds only while the mob is under continuous fire.
   */
  applyHitSlow(): void {
    this.hitSlowFrames = HIT_SLOW_FRAMES;
  }

  /**
   * Set only on a mob the village assault enlisted (`enlistInSiege` in
   * `src/creatures/siege/siegeCapability.ts`); null everywhere else, which
   * leaves every creature's behaviour outside the siege exactly as it was.
   */
  siegeCapable: SiegeCapable | null = null;

  /**
   * What the assault has this mob doing instead of its own AI this frame —
   * marching on the wall, holding off it, or walking back out after a lost
   * siege. The mob loop asks it before `updateAI`. Null outside the assault.
   */
  siegeDirective: SiegeDirective | null = null;

  /**
   * How hard this creature's blows land on a structure, as a multiple of the
   * blow itself, when the assault enlists it. A creature that must never
   * batter walls — an archer, whose job is the defenders — answers zero.
   */
  get siegeStructureMultiplier(): number {
    return DEFAULT_SIEGE_STRUCTURE_MULTIPLIER;
  }

  /**
   * Whether this mob walks the siege itself from its own `updateAI` rather
   * than being marched by a siege directive: the Grave Bull, whose march ends
   * in a telegraphed charge, and the necromancer, who never approaches at all.
   */
  get ownsSiegeMovement(): boolean {
    return false;
  }

  private structureStrikeFramesLeft = 0;
  private structureStrikeTotalFrames = 0;
  private structureStrikeFramesToImpact = 0;
  private structureStrikeCooldownFrames = 0;
  private structureStrikeImpact: (() => void) | null = null;

  /** How this creature's blow on a structure is timed; its own swing where it has one. */
  protected get structureStrikeTiming(): StructureStrikeTiming {
    return DEFAULT_STRUCTURE_STRIKE_TIMING;
  }

  /** The level-1 damage of one blow on a structure, before the siege multiplier. */
  protected get structureStrikeBaseDamage(): number {
    return DEFAULT_STRUCTURE_STRIKE_BASE_DAMAGE;
  }

  /**
   * One blow on a structure, before the siege multiplier. Not levelled: a
   * wall's health is fixed by its tier and never grows with the party, so a
   * blow that grew with the mob would make the same stone wall worth less
   * the further the party had come.
   */
  get structureStrikeDamage(): number {
    return this.structureStrikeBaseDamage;
  }

  /** Whether a blow on a structure is being swung right now. */
  get isStrikingStructure(): boolean {
    return this.structureStrikeFramesLeft > 0;
  }

  /** 0 to 1 through a blow on a structure, or null when none is being swung. For the sprite. */
  protected get structureStrikeProgress(): number | null {
    if (this.structureStrikeFramesLeft <= 0 || this.structureStrikeTotalFrames <= 0) return null;
    return 1 - this.structureStrikeFramesLeft / this.structureStrikeTotalFrames;
  }

  /**
   * Starts one blow at a structure, calling `onImpact` on the frame it lands.
   * Refused while a blow is already swinging or its cooldown runs. Driven from
   * `tickTimers`, which every active mob gets each frame whichever branch the
   * mob loop takes, so a siege directive that skips `updateAI` still lands it.
   */
  playStructureStrike(onImpact: () => void): boolean {
    if (this.structureStrikeFramesLeft > 0 || this.structureStrikeCooldownFrames > 0) return false;
    const timing = this.structureStrikeTiming;
    this.structureStrikeTotalFrames = timing.swingFrames;
    this.structureStrikeFramesLeft = timing.swingFrames;
    this.structureStrikeFramesToImpact = Math.max(1, timing.impactFrame);
    this.structureStrikeCooldownFrames = Math.max(
      timing.swingFrames,
      this.scaledCooldownFrames(timing.cooldownFrames),
    );
    this.structureStrikeImpact = onImpact;
    this.isMoving = false;
    return true;
  }

  private tickStructureStrike(): void {
    if (this.structureStrikeCooldownFrames > 0) this.structureStrikeCooldownFrames--;
    if (this.structureStrikeFramesLeft <= 0) return;
    this.structureStrikeFramesLeft--;
    this.isMoving = false;
    if (this.structureStrikeFramesToImpact <= 0) return;
    this.structureStrikeFramesToImpact--;
    if (this.structureStrikeFramesToImpact > 0) return;
    const impact = this.structureStrikeImpact;
    this.structureStrikeImpact = null;
    if (this.isAlive) impact?.();
  }

  private clearStructureStrike(): void {
    this.structureStrikeFramesLeft = 0;
    this.structureStrikeTotalFrames = 0;
    this.structureStrikeFramesToImpact = 0;
    this.structureStrikeCooldownFrames = 0;
    this.structureStrikeImpact = null;
  }

  /**
   * One step of a siege march in direction (`dirX`, `dirY`) at this mob's own
   * walk speed, through the same collision, root and slow rules as a chase.
   */
  marchStep(dirX: number, dirY: number): void {
    const length = Math.hypot(dirX, dirY);
    if (length === 0) {
      this.isMoving = false;
      return;
    }
    const speed = this.isSlowed ? this.speed * MOB_SLOWED_SPEED_FRACTION : this.speed;
    this.facingX = dirX / length;
    this.facingY = dirY / length;
    this.moveWithCollision((dirX / length) * speed, (dirY / length) * speed);
    this.isMoving = true;
  }

  /** True for airborne mobs that pass over ground mobs without physical collision. */
  isFlying = false;

  /**
   * True while a mob should be excluded from the ground separation pass, both
   * as pusher and as pushed — a companion mid-collapse or mid-recall that
   * needs to close on its owner in a straight line rather than being shoved
   * around whatever it is running past.
   */
  get ignoresMobCollision(): boolean {
    return false;
  }

  /**
   * Opt-in for mobs that swing and threaten but can never actually hurt anyone —
   * the tutorial's goblins. Gated here rather than by zeroing `attackDamage`,
   * because subclasses re-read their damage from a weapon table on every swing.
   */
  readonly harmless: boolean = false;

  /**
   * Opt-in for mobs that leave a body behind. Kill resolution normally drops a
   * mob out of the spatial grid the frame it dies, which also stops it being
   * drawn; setting this keeps it in the world so its corpse can play out.
   *
   * A mob that sets this **must** also override `tickCorpse` and
   * `corpseExpired` — the defaults would leave the corpse expired from the
   * outset, so it would silently never render. The corpse clock is driven by
   * `resolveKills`, so this only works in scenes that call it every frame.
   */
  readonly rendersWhenDead: boolean = false;

  /**
   * Advances a corpse by one frame. Only called for `rendersWhenDead` mobs,
   * which get no other updates once they are dead.
   *
   * Call {@link advanceCorpse} rather than this — the per-frame bookkeeping a
   * corpse still owes lives there, and overrides of this method do not run it.
   */
  tickCorpse(): void {
    // Corpse-less mobs have nothing to advance.
  }

  /**
   * One frame of corpse life: the shared bookkeeping every corpse owes, then
   * the mob's own animation.
   *
   * The killing blow leaves a hit flash behind, and the regular update that
   * would burn it down stops the moment the mob dies — so without this the
   * corpse holds that frame's tint forever and reads as a glowing body.
   */
  advanceCorpse(): void {
    if (this.damageFlash > 0) this.damageFlash--;
    this.tickCorpse();
  }

  /** True once a corpse has finished and can be dropped from the world. */
  get corpseExpired(): boolean {
    return true;
  }

  /**
   * Called exactly once, the frame a mob dies (from `resolveKills`, alongside
   * `justDied`). No-op by default — override it to release any per-instance
   * resource a mob baked for itself and will never draw again once dead. A dead
   * mob can otherwise sit in
   * `this.mobs` for the rest of the scene's life (see `restoreFromCheckpoint`'s
   * "the dead are never spliced out" note in `DungeonScene`), so freeing on
   * death rather than on removal from the array is what actually bounds this.
   *
   * Not called for every kind of removal: `MongoSystem` and `MercenarySystem`
   * both intercept their companion's lethal damage and clear `justDied` before
   * `resolveKills` runs, so kill resolution never processes them as a slain
   * enemy. A dead hireling's body then plays out through the corpse sweep and
   * is spliced out of the mob list by `MercenarySystem` once it has faded.
   * Neither overrides `dispose()` today since neither bakes a per-instance
   * resource, but a future one that does would need its own cleanup hook
   * rather than assuming this path covers it.
   */
  dispose(): void {
    // Nothing to release by default.
  }

  /**
   * Drops anything this mob has in the air.
   *
   * A projectile a mob owns is advanced from that mob's own AI, so it only moves
   * while the mob's roster is being ticked. A shot left in flight on a floor the
   * party walks away from would hang there and resume — landing a hit a minute
   * later, from a caster the player has already forgotten — and a rewound world
   * would keep the bolts the fight it is rewinding had thrown.
   */
  clearAirborneAttacks(): void {
    // Nothing in the air by default.
  }

  /**
   * The inverse of {@link dispose}: re-acquires whatever that released, because
   * a checkpoint restore can bring this mob back to life. Any override of
   * `dispose()` needs a matching override here, or the revived mob draws
   * nothing where its baked resource used to be.
   */
  reacquireDisposedResources(): void {
    // Nothing to re-acquire by default.
  }

  /**
   * Whether this mob still needs a slot in the spatial grid — living mobs
   * always do, the dead only while a corpse is still on screen.
   */
  get belongsInMobGrid(): boolean {
    return this.isAlive || (this.rendersWhenDead && !this.corpseGone);
  }

  /** Set by {@link vanish}: the body left no corpse at all. */
  private vanished = false;

  /**
   * Takes a dead body out of the world with no corpse to play out — a turned
   * ally crumbling to dust when its borrowed life runs out. A checkpoint
   * revive clears it with the rest of the death.
   */
  vanish(): void {
    this.vanished = true;
  }

  /**
   * Whether a dead mob's corpse is finished: it has played out, or the body
   * vanished without one. Read in place of {@link corpseExpired}, which
   * creatures override without knowing about a vanish.
   */
  get corpseGone(): boolean {
    return this.vanished || this.corpseExpired;
  }

  /**
   * Physical mass used for separation weighting. Heavier mobs move less when bumped.
   * Cockroaches (0.3) barely disturb anything; bosses (10) are nearly immovable.
   */
  mass = 1;

  /**
   * Whether walking into this mob shoves a crawler back out of it, or it back
   * out of a crawler.
   *
   * True for anything with a body. False for a pet that walks through its own
   * party, and for the prop-shaped mobs that exist only to be hit — a counterweight hung on a grate, a timber driven through a
   * wall — because separation is not a soft nudge: it pushes the crawler a full
   * `SEPARATION_RADIUS`, which is one whole tile, and a rooted prop cannot give
   * any of that ground back (`applySeparation` caps a mob's own displacement
   * against its walk speed, and a prop's is zero). One standing in a one-tile
   * corridor is therefore a wall, and a puzzle prop is often standing in exactly
   * the doorway it guards.
   */
  get displacesPlayers(): boolean {
    return true;
  }

  /**
   * Whether this mob's death can trigger a floor's `onMobKilledSpawns` rule.
   * False for a thing that was never a creature in its own right — an egg a
   * boss laid — whose smashing must not seed a swarm that outlives the fight.
   */
  get seedsOnKillSpawns(): boolean {
    return true;
  }

  /**
   * Whether an AI companion goes for this mob on sight even though it targets
   * nobody. Companions otherwise answer only mobs already fighting the party,
   * which leaves a threat that never attacks — a ticking egg — unanswered.
   */
  get drawsCompanionAggro(): boolean {
    return false;
  }

  /**
   * Whether this mob can hold an absorbing ward or overheal. False for a mob
   * whose whole promise is that one hit ends it; fairies read this before
   * choosing a target, so they never spend a cast on something that drops it.
   */
  get acceptsWards(): boolean {
    return true;
  }

  /**
   * Whether this is a companion travelling with the party — a pet or a
   * hireling — that steps aside for a crawler rather than shoving her. Such a
   * mob takes the whole of a crawler collision itself (`MobUpdateLoop`, capped
   * like any separation at half its walk step, so it still gains ground past
   * her) and never moves either crawler. Other friendly NPCs keep ordinary
   * collision: a rooted one blocking a doorway may be the point of it.
   */
  get yieldsToParty(): boolean {
    return this.isConverted;
  }

  /**
   * Whether this mob keeps off the damaging ground the scene's hazard owners
   * have marked (`tactics/markedGround`): none of its own steps may enter it,
   * and {@link stepOffMarkedGround} walks it out when it finds itself inside.
   *
   * The party's travelling companions only. A hostile mob standing in a
   * telegraphed blast is part of the fight the player is reading, and its
   * tactics already refuse marked ground on their own terms.
   */
  protected get avoidsMarkedGround(): boolean {
    return this.yieldsToParty;
  }

  /**
   * Walks one step out of marked ground, if this mob is standing on any, and
   * returns whether it did — the caller then skips every other step it would
   * have taken this frame. Above following, fighting and recalling alike: none
   * of those is a reason to wait under a falling ball, and a flee that shares
   * the frame with a follow step is two rules taking turns on the rim.
   *
   * A knockback owns the mob's feet until it ends (`moveWithCollision` refuses
   * the step), so a shoved companion flees on the frame it lands.
   */
  protected stepOffMarkedGround(speed: number): boolean {
    if (!this.avoidsMarkedGround) return false;
    const escape = markedGroundEscape(this.x, this.y);
    if (escape === null) return false;
    stepAlongEscape(this, escape, speed, (dx, dy) => this.moveWithCollision(dx, dy));
    this.facingX = escape.dx;
    this.facingY = escape.dy;
    this.isMoving = true;
    return true;
  }

  /**
   * Whether a companion walking back to `owner` has come up against another of
   * the party standing with her — touching a crawler, or another companion
   * that travels with the party (Mongo), who is nearer the owner than it is and
   * within {@link PARTY_HUDDLE_TILES} of her. Whatever body holds the spot its
   * follow band wants, it can get no closer than touching it. That is as close as
   * it can get: walking on only presses it into her, where separation pushes it
   * back at half the pace it walks in, so neither ever wins and the companion
   * rests inside her, flickering between its walk and its idle every frame. A
   * companion's follow counts this as arrived.
   *
   * Judged by where the crawler in the way stands, never by where the companion
   * does. Its own distance is what separation keeps changing — a rule on it
   * latches when the push lets it in and drops when the push takes it out, and
   * the flicker comes back. And a crawler left standing where the owner walked
   * away from — told to wait, say — is not with her: that one is walked round.
   * Other mobs, friendly or not, are never rested against: they are not with
   * the party, and separation between mobs moves both of them.
   */
  protected restsAgainstParty(owner: Player, party: readonly Player[]): boolean {
    const toOwner = Math.hypot(owner.x - this.x, owner.y - this.y);
    const contactPx = SEPARATION_RADIUS * PARTY_CONTACT_SLACK_RATIO;
    const huddlePx = PARTY_HUDDLE_TILES * this.tileSize;
    return party.some((member) => {
      if (member === owner || member === this || !member.isAlive) return false;
      const travelsWithTheParty =
        member.isCrawler || (member instanceof Mob && member.yieldsToParty);
      if (!travelsWithTheParty) return false;
      const touching = Math.hypot(member.x - this.x, member.y - this.y) <= contactPx;
      const memberToOwner = Math.hypot(owner.x - member.x, owner.y - member.y);
      return touching && memberToOwner < toOwner && memberToOwner <= huddlePx;
    });
  }

  /** Set by the spawner from `LevelDef.slingshotDrops`; gates the rare world-drop roll. */
  allowSlingshotDrop = false;

  /**
   * When set to a live Mob, this mob will chase and attack it as a priority target.
   * Used so that Brindled Vespa acid hits cause enemy mobs to retaliate.
   * DungeonScene injects this mob into the mob's target list each frame.
   */
  retaliateMob: Mob | null = null;

  /** When true (set by DungeonScene for locked boss rooms), ignores aggro range. */
  forceAggro = false;

  /**
   * True while a scripted encounter has put this mob in the room but has not
   * yet handed it the fight — the beat a party spends reading an intro banner
   * before they have control.
   *
   * A held mob runs no AI at all, rather than being handed an empty target
   * list: with no target a caster wanders, and wandering is exactly how one
   * posted safely outside its own aggro range of the party's arrival tile
   * closes that range before the player can answer for it.
   */
  aiHeld = false;

  /**
   * True while a scripted encounter has this mob in the room but has not begun
   * its fight, and nothing on the party's side — a companion crawler, Mongo, a
   * hire — may pick it out to fight.
   *
   * Separate from {@link aiHeld}, which only stops the mob's own AI: a staggered
   * bounty member is held too, and striking it is what lets it loose early. A
   * mob held for an intro card cannot answer a blow at all, so an ally going for
   * it would be taking free kills while the player is still reading.
   */
  offLimitsToAllies = false;

  /**
   * How far this one mob's A* searches may reach, in tiles.
   *
   * The map-wide default keeps routine pathfinding cheap, but a scripted
   * encounter that guarantees pursuit across a whole arena needs a route long
   * enough to detour around the scenery in it: past the budget `findPath`
   * returns nothing at all, and the straight-line fallback walks into the wall
   * it was supposed to go around. Raised per instance rather than globally
   * because the global constant is what bounds the cost of every other mob on
   * the floor.
   */
  pathDistanceBudgetTiles = MOB_MAX_PATH_DISTANCE_TILES;

  /** Difficulty level of this mob instance (1 = base). Set by applyMobLevel(). */
  mobLevel = 1;

  /**
   * The spawn-table key this mob was asked for, stamped by `createMob`; null for
   * one built by calling its constructor directly.
   *
   * The key rather than the class, because it is what spawn *rules* are written
   * in — it exists so a rule can ask how many of its own kind are already alive
   * without anything having to map a key back to a constructor.
   */
  spawnTypeKey: string | null = null;

  /** Display name shown in hover tooltip. Subclasses should override. */
  displayName = 'Unknown';

  /** Key into BodyPartGoreSystem's registry; null means no body-part gore for this mob. */
  readonly bodyPartKey: string | null = null;

  /** Short description shown in hover tooltip. Subclasses should override. */
  description = '';

  /** Sound category key for attack audio (e.g. 'goblin', 'rat', 'llama'). Empty string = no sound. */
  readonly audioTag: string = '';

  /**
   * Identifies this mob's type for death-cause tracking. Returns the class name by default;
   * subclasses with multiple stages or variants should override this.
   */
  get mobType(): string {
    return this.constructor.name;
  }

  /** Set to true when this mob deals damage; polled and cleared by the scene each frame. */
  attackSoundPending = false;

  /** Set to true when this mob fires a projectile; polled and cleared by the scene each frame. */
  projectileSoundPending = false;

  /** Set to true when this mob takes damage worth a pain cue; polled and cleared by the scene each frame. */
  damageSoundPending = false;

  /**
   * Set to true when this mob performs its one signature action with a cue of
   * its own — the Hoarder's vomit, the Juicer's throw, the Ball of Swine's
   * roll. Generic rather than per-subclass so the audio pass stays a single
   * walk over the mob list driven by `audioTag`, with no `instanceof` chain.
   */
  specialSoundPending = false;

  /** Set when this mob guards a blow; polled and cleared by the scene each frame. */
  guardSoundPending = false;

  /**
   * The behaviours this mob learned at spawn, and the live state of any of
   * them in progress. See {@link rollTactics} and {@link tacticsEligibility}.
   */
  readonly tactics = new MobTactics();
  /** Reused every frame so asking the tactics where the target was allocates nothing. */
  private readonly tacticalTargetPoint = { x: 0, y: 0 };

  private _lastBlowWasGuarded = false;

  /** True only inside {@link advanceKnockback}'s own step; see `moveWithCollision`. */
  private knockbackStepInProgress = false;

  /**
   * Whether the most recent {@link takeDamageFrom} was turned aside by this
   * mob's guard. Read by whoever landed the blow straight after the call, so an
   * on-hit rider — a sepsis proc, a stun — is not applied through a guard.
   */
  get lastBlowWasGuarded(): boolean {
    return this._lastBlowWasGuarded;
  }

  /**
   * Which side this mob is on. Every mob starts hostile; {@link convertToAlly}
   * turns one to the party's side for the rest of its life.
   */
  private allegiance: 'hostile' | 'party' = 'hostile';
  /** The crawler who turned this mob, while it is converted. */
  private _convertedBy: Player | null = null;
  /** Whether it paid rewards as an enemy, restored if a rewind turns it back into one. */
  private paidRewardsBeforeConversion = true;

  /**
   * The bodies a converted mob fights, handed to its `updateAI` in place of
   * the party. Refilled every frame by whoever keeps the ally; empty for a mob
   * that was never converted.
   */
  readonly allyTargets: Player[] = [];

  /**
   * Where a converted mob idles when nothing is left to fight: back within
   * `radiusPx` of `anchor`, rather than wandering round its old spawn.
   */
  allyRally: { readonly anchor: Player; readonly radiusPx: number } | null = null;

  /**
   * Whether this mob is currently hostile toward players. True unless it has
   * been converted; override for neutral NPCs.
   *
   * Every system re-reads this each frame, which is what lets a conversion
   * carry through the whole game at once: auto-aim, friendly fire, the pet,
   * the hirelings and their bolts all stop treating a converted mob as prey
   * the frame it turns.
   */
  get isHostile(): boolean {
    return this.allegiance === 'hostile';
  }

  /**
   * Whether this mob's presence should be treated as an unfinished fight by
   * room membership checks (the safe-descent gate, a chest's lock, Mongo's pet
   * button). Defaults to alive-and-hostile; a subclass overrides it when a
   * mob shouldn't hold a room "in combat" on its own. See `countsTowardRoomClear`
   * in `creatures/roomClear.ts`, the shared entry point every such check uses.
   */
  get countsTowardRoomClear(): boolean {
    return this.isAlive && this.isHostile;
  }

  /** The crawler who converted this mob, or null for one that was never turned. */
  get convertedBy(): Player | null {
    return this._convertedBy;
  }

  get isConverted(): boolean {
    return this._convertedBy !== null;
  }

  /**
   * Whether {@link convertToAlly} may turn this mob. Only an enemy — never
   * the party's own (a cow, a soldier, the pet, a hireling), a boss or a
   * boss's scripted add, a quest bystander, or one already turned.
   *
   * A subclass that overrides `isHostile` with a constant ignores allegiance
   * entirely, so turning one would be a lie; the caller holds an allow-list of
   * the creatures proven to fight well on the party's side
   * (`CONVERTIBLE_MOB_TYPES`), and none of those overrides it.
   */
  canBeConverted(): boolean {
    return (
      this.isAlive &&
      this.isHostile &&
      this.allegiance === 'hostile' &&
      !this.isBoss &&
      !this.countsAsBossKill &&
      !this.isBossAdd &&
      this.isDefendTarget !== true
    );
  }

  /**
   * Turns this mob to the party's side for the rest of its life: it stops
   * fighting the party, forgets who it was chasing and every alert it heard,
   * answers to nobody's pack, and credits whatever it kills to `owner`.
   */
  convertToAlly(owner: Player): void {
    if (!this.canBeConverted()) return;
    this.allegiance = 'party';
    this._convertedBy = owner;
    this.creditTarget = owner;
    // Whatever the party dealt it as an enemy is forgiven: an ally that falls
    // is a loss, and must not pay out as a kill to whoever wounded it first.
    this.damageTakenBy.clear();
    // The party's own burns, poisons and the like would go on hurting its new
    // ally; whatever an enemy laid on it stays.
    this.statusEffects = this.statusEffects.filter(
      (effect) => effect.applier?.xpCreditTarget.isCrawler !== true,
    );
    this.paidRewardsBeforeConversion = !this.paysNoRewards;
    this.paysNoRewards = true;
    this.currentTarget = null;
    this.retaliateMob = null;
    this.forceAggro = false;
    this.isDefendTarget = false;
    this.alertedTo.clear();
    this.noticeCache.clear();
    this.rootFrames = 0;
    this.rootSource = null;
    // It deserts the siege it was marching in: no directive may walk an ally at the wall.
    this.siegeCapable = null;
    this.tactics.disengage();
    this.clearAStarPath();
  }

  /**
   * Undoes a conversion, for a rewind to before it happened: the checkpoint
   * saw an enemy, so the restored floor has one.
   */
  private revertConversion(): void {
    if (this._convertedBy === null) return;
    this.allegiance = 'hostile';
    this._convertedBy = null;
    this.creditTarget = this;
    this.paysNoRewards = !this.paidRewardsBeforeConversion;
    this.allyTargets.length = 0;
    this.allyRally = null;
  }

  protected override get allegianceRim(): SilhouetteLayer | null {
    return this._convertedBy === null ? null : CONVERTED_RIM;
  }

  /**
   * Whether a player-sourced blow of this kind is allowed to land on this mob.
   *
   * A non-hostile mob — Mongo, a hired mercenary, a quest ally — is immune to
   * every aimed player weapon, so the cat firing a missile through her own pet
   * can never cost the player their friend. Explosives are the deliberate
   * exception: a blast already hurts whoever lit it, and being indiscriminate
   * is the whole character of the item.
   */
  takesPlayerDamage(damageType: PlayerDamageType | null): boolean {
    return this.isHostile || damageType === EXPLOSION_DAMAGE_TYPE;
  }

  /**
   * Whether the cat's pet raptor will pick a fight with this mob.
   *
   * Defaults to {@link isHostile}, which already excludes every quest ally and
   * summon in the game. Overridden to `true` by mobs that are calm toward
   * players but that Mongo hunts anyway — he is an animal, not a diplomat.
   */
  get isPetAttackable(): boolean {
    return this.isHostile;
  }

  /**
   * Whether a checkpoint restore should fully reset this mob — teleport it back
   * to its spawn tile and clear its aggro/phase state via `resetToSpawn()` —
   * rather than just healing it and clearing status effects in place via
   * `healAndForgetFight()`.
   *
   * Defaults to {@link isHostile}: an enemy's spawn tile is where the encounter
   * began, so a death should rewind it there. Override to `true` for a
   * non-hostile mob that is still spawn-anchored rather than a temporary
   * summon — e.g. Signet, whose spawn tile is the leash anchor she fights
   * around, unlike Mongo or a hired mercenary, whose "spawn tile" is wherever
   * they happened to be summoned or hired.
   */
  get resetsFullyOnCheckpoint(): boolean {
    // A converted mob was an enemy when the checkpoint was taken, and
    // `resetToSpawn` turns it back into one.
    return this.isHostile || this.isConverted;
  }

  /**
   * Whether this mob was already in the world when the last checkpoint was
   * captured. False on a fresh mob, so anything summoned, hired or staged after
   * the safe room is identifiable — and deletable — on a restore.
   *
   * Stored on the mob rather than as a collection in the checkpoint on purpose:
   * `BossRoomSystem` compacts spent Cockroaches out of the scene's mob array
   * once it grows past its threshold, and a `Set<Mob>` held by the checkpoint
   * would pin exactly those corpses past their removal.
   */
  presentAtCheckpoint = false;

  /**
   * Whether this mob was alive at the last checkpoint. Read only when
   * {@link presentAtCheckpoint} is true; a mob that was alive then and is dead
   * now was killed after the safe room, so the kill is rewound.
   */
  aliveAtCheckpoint = false;

  /**
   * {@link wasResurrected} as it stood at the last checkpoint. A rewind puts it
   * back rather than clearing it: a raise the checkpoint already saw has had its
   * one paid kill, and a rewind must not hand that kill out again.
   */
  resurrectedAtCheckpoint = false;

  /**
   * When true, the AI-controlled companion will flee from this mob instead of attacking it.
   * Override in subclasses for enemies that are temporarily untargetable or instakill on contact.
   */
  get avoidInstead(): boolean {
    return false;
  }

  /**
   * When true, the AI-controlled companion uses evasive movement (orbiting/circling)
   * instead of standing still while fighting this mob. Set this on enemies whose attacks
   * are telegraphed and dodgeable so the companion automatically sidesteps.
   */
  get requiresEvasion(): boolean {
    return false;
  }

  /**
   * When true, this mob's AI ticks regardless of its distance to any player.
   *
   * The activation radius exists so a floor's worth of sleeping enemies costs
   * nothing, and every enemy is happy to be frozen off-screen. A *summon* is
   * not: the thing it is trying to do is get back to the party, so freezing it
   * the moment it falls behind is precisely the failure that leaves a pet stood
   * in an empty corridor with no way to recover. Opt in only for mobs whose
   * whole existence is following the party — the cost is one permanently active
   * mob for as long as it is in the world.
   */
  get exemptFromAiActivationRadius(): boolean {
    // A converted mob follows the crawler who turned it, so it must keep
    // thinking when she walks off — like any other summon. An assault mob
    // advances from its lane whether or not anyone is near to watch it.
    return this.isConverted || this.siegeCapable !== null;
  }

  /** Whether this mob is currently in an enraged state. Subclasses (e.g. Juicer) set this. */
  isEnraged?: boolean;

  /** The player who dealt the killing blow; set when hp reaches 0. */
  killedBy: Player | null = null;

  /**
   * The entity that actually landed the killing blow, which is not always who
   * gets credited for it.
   *
   * `killedBy` is mapped through {@link Player.xpCreditTarget} so a summon's kill
   * reads as its owner's everywhere that already keys off the killer — loot
   * tables, achievements, XP. This field keeps the literal dealer, for the one
   * question those cannot answer: whether it was the pet rather than the cat.
   */
  killedByDealer: Player | null = null;

  /** The type of attack that landed the killing blow. */
  killType: PlayerDamageType | null = null;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp: number, speed: number) {
    super(tileX, tileY, tileSize, { maxHp });
    this.speed = speed;
    this._authoredSpeed = speed;
    this.spawnX = tileX * tileSize;
    this.spawnY = tileY * tileSize;
    this.lastKnownTargetX = this.spawnX;
    this.lastKnownTargetY = this.spawnY;
    // Stagger wander timers so mobs don't all change direction together
    this.wanderTimer = randomInt(0, WANDER_TIMER_STAGGER_MAX);
  }

  /**
   * What this mob's level multiplied its authored speed by, and the curve its
   * max HP was levelled on.
   *
   * Kept because a good many creatures write those two fields again later in
   * their lives — a grub that evolves, a boss that enrages, a sky fowl that
   * breaks into a chase, anything reset by `resetToSpawn` — and every one of
   * those writes is a flat authored constant. A plain reassignment silently
   * throws the level away and leaves a boss with levelled HP moving at level-1
   * speed — an HP sponge with none of the matching threat.
   * Anything reassigning those fields must go through {@link setBaseSpeed} or
   * {@link setBaseMaxHp}.
   */
  private _levelSpeedMultiplier = 1;
  private _levelledCurve: LevelledCurve = SHARED_LEVELLED_CURVE;

  /**
   * The HP and damage curve this mob was levelled on. Anything spawned at this
   * mob's level — a summon, a burst, a tentacle — is levelled on it too, so it
   * matches the floor it appears on.
   */
  get levelledCurve(): LevelledCurve {
    return this._levelledCurve;
  }

  /**
   * The walk speed this mob was authored at, before any level scaling.
   *
   * Kept so {@link levelledSpeedCap} can tell "this creature is meant to be
   * fast" apart from "levelling made this creature fast" — the default ceiling
   * bounds the second without touching the first.
   */
  private _authoredSpeed = 0;

  /**
   * Ceiling on this mob's post-level walk speed.
   *
   * The unbounded per-level speed multiplier meeting a bounty's full-party-level
   * escorts is what let a level-20 goblin outrun the player at 141% of their
   * speed. The default holds every creature to
   * {@link LEVELLED_SPEED_PLAYER_RATIO} of the player's speed, or to its own
   * authored speed if it was already written faster than that — so levelling can
   * never turn a mob into something the player cannot walk away from, while a
   * creature deliberately authored quick (a lemur, a spider) keeps the speed its
   * designer gave it.
   *
   * Both {@link applyMobLevel} and {@link setBaseSpeed} consult it, so an
   * enrage, an evolution or a checkpoint reset cannot climb back over it.
   * Override in a subclass for a tighter ceiling, or for one of the few
   * creatures whose whole identity is outrunning the player.
   */
  protected get levelledSpeedCap(): number {
    return Math.max(this._authoredSpeed, PLAYER_SPEED * LEVELLED_SPEED_PLAYER_RATIO);
  }

  /** Re-author this mob's speed from a base constant, keeping its level scaling. */
  protected setBaseSpeed(baseSpeed: number): void {
    this._authoredSpeed = baseSpeed;
    this.speed = this.clampToSpeedCap(baseSpeed * this._levelSpeedMultiplier);
  }

  private clampToSpeedCap(speed: number): number {
    return Math.min(speed, this.levelledSpeedCap);
  }

  /**
   * This mob's current walk speed, in pixels per frame.
   *
   * Read-only and public purely so the invariant above is checkable from
   * outside: `scripts/verify-difficulty.ts` asserts that a checkpoint reset
   * leaves a levelled mob's speed alone, and there is no way to see that
   * through a protected field.
   */
  get moveSpeed(): number {
    return this.speed;
  }

  /** Re-author this mob's max HP from a base constant, keeping its level scaling. */
  protected setBaseMaxHp(baseMaxHp: number): void {
    this.setFixedMaxHp(levelledMaxHp(baseMaxHp, this.mobLevel, this._levelledCurve));
  }

  /**
   * Scale this mob's stats for the given difficulty level. Level 1 is the
   * authored stats.
   *
   * Max HP and walk speed are multiplied here by the curves in
   * `mobLevelScaling.ts`; damage and attack cadence are scaled where each blow
   * is dealt and each cooldown is reset (see {@link scaledDamage} and
   * {@link scaledCooldownFrames}); coins and XP by their own per-level rates.
   *
   * @param curve the HP and damage curve to level on: the spawning floor's
   *   `levelledCurve`, or the curve of the mob this one was spawned from. A
   *   level-1 mob returns before it is read, so it never moves an unlevelled mob.
   */
  applyMobLevel(level: number, curve: LevelledCurve = SHARED_LEVELLED_CURVE) {
    if (level <= 1) return;
    // Every multiplier below reads the mob's *current* stats, so a second call
    // compounds: a level-7 mark levelled twice arrives with ~5× the HP it was
    // designed for and reads as a bug in the encounter rather than in the
    // caller. Refused and reported rather than applied, because a mob at the
    // wrong level is a tuning problem while a mob at the square of its level is
    // an unwinnable fight.
    if (this.mobLevel > 1) {
      console.warn(
        `[Mob] ${this.mobType} is already level ${this.mobLevel}; ignoring re-level to ${level}`,
      );
      return;
    }
    this.mobLevel = level;
    const extra = level - 1;

    this._levelledCurve = curve;
    this.setFixedMaxHp(levelledMaxHp(this.maxHp, level, curve));
    this.hp = this.maxHp;

    this._levelSpeedMultiplier = speedScaleForLevel(level);
    this.speed = this.clampToSpeedCap(this.speed * this._levelSpeedMultiplier);

    this.coinDropMin = Math.ceil(this.coinDropMin * (1 + extra * MOB_LEVEL_COIN_SCALE));
    this.coinDropMax = Math.ceil(this.coinDropMax * (1 + extra * MOB_LEVEL_COIN_SCALE));
  }

  private _difficultyRewardsApplied = false;
  private _difficultyXpScale = 1;

  /**
   * Applies the active difficulty's explicit reward scale, alongside
   * {@link applyMobLevel} at every spawn site. A separate method rather than a
   * parameter on `applyMobLevel`: that method early-returns for `level <= 1`,
   * so piggybacking here would silently skip reward scaling for every
   * level-1 mob. Idempotent the same way `applyMobLevel` is, so a mob cannot
   * be double-scaled by a caller that runs twice.
   */
  applyDifficultyRewards(xpScale: number, coinScale: number): void {
    if (this._difficultyRewardsApplied) {
      console.warn(`[Mob] ${this.mobType} already has difficulty rewards applied; ignoring`);
      return;
    }
    this._difficultyRewardsApplied = true;
    this._difficultyXpScale = xpScale;
    this.coinDropMin = Math.ceil(this.coinDropMin * coinScale);
    this.coinDropMax = Math.ceil(this.coinDropMax * coinScale);
  }

  /**
   * A base cooldown or wind-up length shortened for this mob's level.
   *
   * Every creature owns its own private timer, so this is the one shared
   * mechanism rather than a field applied for them: call it wherever a timer is
   * *reset*, never where one is compared, or the remaining time changes meaning
   * halfway through a swing.
   *
   * Never below one frame, and never below `base × CADENCE_SCALE_FLOOR` — that lower
   * bound is the explicit floor the fairness rules require, and it comes from
   * the curve itself rather than from a second constant per creature that could
   * disagree with it.
   */
  protected scaledCooldownFrames(baseFrames: number): number {
    return scaledCooldownFramesForLevel(baseFrames, this.mobLevel);
  }

  /** Returns XP value scaled by mob level and the active difficulty's reward scale. */
  get scaledXpValue(): number {
    const levelMultiplier = this.mobLevel <= 1 ? 1 : 1 + (this.mobLevel - 1) * MOB_LEVEL_XP_SCALE;
    return Math.ceil(this.xpValue * levelMultiplier * this._difficultyXpScale);
  }

  /**
   * Deal level-scaled damage to a target. Mobs should call this instead of
   * target.takeDamage() directly so damage scales with mob level.
   *
   * Pass `attackType` for special named attacks (e.g. 'slam', 'screech') so the
   * death screen can describe the specific ability that killed the player.
   *
   * @returns whether the blow connected. Attacks that also inflict a status
   *   should gate the status on this, so a dodged hit doesn't still poison.
   */
  protected dealDamage(target: Player, baseDamage: number, attackType?: string): boolean {
    return this.deliverBlow(target, this.scaledDamage(baseDamage), attackType, 'contact');
  }

  /**
   * Level-scaled damage from a blow that never touched the victim: a projectile,
   * a spit, a thrown weight, a reach or an area effect.
   *
   * Identical to {@link dealDamage} in every respect but one — reflect gear has
   * nothing to send back down, so it doesn't.
   */
  protected dealRangedDamage(target: Player, baseDamage: number, attackType?: string): boolean {
    return this.deliverBlow(target, this.scaledDamage(baseDamage), attackType, 'ranged');
  }

  /**
   * The single route every `deal*Damage` helper resolves through, so the sound,
   * the engagement flag and the reflect rule cannot drift apart between them.
   */
  private deliverBlow(
    target: Player,
    damage: number,
    attackType: string | undefined,
    delivery: MobBlowDelivery,
  ): boolean {
    // The swing still lands audibly and visibly; only the harm is withheld.
    if (this.harmless) {
      this.attackSoundPending = true;
      return false;
    }
    const source = this.stampBlowCap({
      kind: 'mob',
      mobType: this.mobType,
      attackType,
      from: {
        x: this.x + this.tileSize * MOB_TILE_CENTER,
        y: this.y + this.tileSize * MOB_TILE_CENTER,
      },
    });
    const connected =
      this.isConverted && target instanceof Mob
        ? this.strikeAsAlly(target, damage)
        : target.takeDamage(damage, source);
    if (connected) {
      this.noteStruckPlayer(target);
      if (delivery === 'contact') this.reflectMeleeDamage(target, damage);
    }
    this.attackSoundPending = true;
    return connected;
  }

  /**
   * A converted mob's blow on an enemy, landed in its own name the way the
   * party's pet lands his: the damage ledger records this mob, which credits
   * its converter through `xpCreditTarget`, and the victim turns on it rather
   * than on the crawler standing behind it.
   *
   * No weapon type: the converter swung nothing, so the kill must not train
   * her pugilism or count toward a weapon's kill achievements.
   */
  private strikeAsAlly(target: Mob, damage: number): boolean {
    const before = target.hp;
    target.takeDamageFrom(damage, this, null);
    if (target.isAlive) target.retaliateMob = this;
    return target.hp < before;
  }

  /**
   * Send a share of a landed blow back at this mob when the victim's gear
   * reflects it.
   *
   * Routed through `takeDamageFrom` with the crawler as the attacker so a kill
   * by reflection credits them — otherwise thorns-style gear would quietly cost
   * the player the XP and loot of everything it killed.
   */
  protected reflectMeleeDamage(target: Player, damage: number): void {
    const pct = target.inventory.equipment.getDamageReflectPct();
    if (pct <= 0) return;
    // Struck by nobody: the mob hurt itself on the gear, so there is no blow
    // to guard and none that should count as breaking a run of guards.
    this.takeCreditedDamage(Math.max(1, Math.ceil(damage * pct)), target, 'melee', null);
  }

  /**
   * Deal damage that has **already** been sized, skipping the level multiplier.
   *
   * For attacks priced as a share of the victim's own max HP. Those already
   * scale with everything that matters — a tougher party takes a proportionally
   * bigger hit — so putting them through {@link dealDamage} multiplies the
   * scaling in twice. At the level a bounty mark spawns at that is a ~3.8×
   * multiplier on a number that was already most of a health bar, which is an
   * instant kill dressed up as a tuning value.
   *
   * Everything else about the blow is identical to `dealDamage`, including the
   * `harmless` early-out and the attack sound.
   */
  protected dealPreScaledDamage(target: Player, damage: number, attackType?: string): boolean {
    return this.deliverBlow(target, damage, attackType, 'contact');
  }

  /**
   * Already-sized damage from a blow that never touched the victim.
   *
   * {@link dealPreScaledDamage} and {@link dealRangedDamage} in one: for the
   * area attacks priced as a share of the victim's own max HP.
   */
  protected dealPreScaledRangedDamage(
    target: Player,
    damage: number,
    attackType?: string,
  ): boolean {
    return this.deliverBlow(target, damage, attackType, 'ranged');
  }

  /**
   * This mob's damage number on the curve it was levelled on, and zero if it
   * is harmless.
   *
   * For attacks that cannot go through {@link dealDamage} because the harm is
   * resolved somewhere else — a projectile that outlives its owner, say. It
   * shares the scaling with `dealDamage` so a mob's ranged attack cannot drift
   * away from its melee one when the level curve is retuned.
   */
  protected scaledDamage(baseDamage: number): number {
    if (this.harmless) return 0;
    return scaledDamageForLevel(baseDamage, this.mobLevel, this._levelledCurve);
  }

  setMap(map: GameMap) {
    this.map = map;
  }

  setSpells(s: ShellContext): void {
    this.spells = s;
  }

  /** Returns true if this mob and `target` occupy the same map tile. */
  protected onSameTile(target: Player): boolean {
    const ts = this.tileSize;
    return (
      Math.floor((this.x + ts * MOB_TILE_CENTER) / ts) ===
        Math.floor((target.x + ts * MOB_TILE_CENTER) / ts) &&
      Math.floor((this.y + ts * MOB_TILE_CENTER) / ts) ===
        Math.floor((target.y + ts * MOB_TILE_CENTER) / ts)
    );
  }

  /**
   * True when the most recent A* search found no route to its goal.
   *
   * `followTargetAStar` falls back to a straight-line walk in that case, which
   * for an unreachable goal means pressing into the wall between here and there.
   * A subclass that can pick a *different* goal should ask this and do so.
   */
  protected get astarSearchFailed(): boolean {
    return this.astarLastSearchFailed;
  }

  /**
   * Waypoints left on the cached A* route, one per tile still to walk; zero
   * when there is no route or the mob is on its last leg. Unlike the straight
   * distance to the goal, this falls on every step of a route that first has
   * to lead away from the goal to get round a wall.
   */
  protected get astarWaypointsLeft(): number {
    return this.astarPath.length;
  }

  /**
   * Throws away the cached route so the next AI tick searches from where the mob
   * actually stands.
   *
   * Public because the mob itself cannot tell that it is wedged: the stuck
   * counters inside `followTargetCollide` only see one blocked step, while a mob
   * grinding against a tent corner takes a *successful* sidestep every frame and
   * arrives nowhere. Whoever is measuring real displacement over time is the one
   * that knows, and it is never the mob.
   */
  forceRepath(): void {
    this.clearAStarPath();
  }

  /** Clears the cached A* path so it is recomputed on the next followTargetAStar call. */
  protected clearAStarPath() {
    this.astarPath = [];
    this.astarTimer = 0;
    this.astarGoalTX = NO_ASTAR_GOAL;
    this.astarGoalTY = NO_ASTAR_GOAL;
    this.astarFramesSinceRepath = ASTAR_MIN_REPATH_GAP_FRAMES;
    this.astarLastSearchFailed = false;
  }

  /**
   * Wall-aware navigation using A* pathfinding. Recalculates the path to the
   * goal every `refreshInterval` frames, then steers toward each waypoint in
   * turn using moveWithCollision. Falls back to direct followTargetCollide
   * if no path can be found (e.g. goal is unreachable or cap exceeded).
   */
  protected followTargetAStar(
    targetPixelX: number,
    targetPixelY: number,
    speed: number,
    minDist: number,
    refreshInterval = ASTAR_DEFAULT_REFRESH,
  ) {
    if (!this.map) {
      this.followTargetCollide(targetPixelX, targetPixelY, speed, minDist);
      return;
    }
    const ts = this.tileSize;
    const goalTileX = Math.floor((targetPixelX + ts * MOB_TILE_CENTER) / ts);
    const goalTileY = Math.floor((targetPixelY + ts * MOB_TILE_CENTER) / ts);

    if (this.astarTimer > 0) this.astarTimer--;
    this.astarFramesSinceRepath++;

    const goalTileMoved = goalTileX !== this.astarGoalTX || goalTileY !== this.astarGoalTY;
    // A goal that moved is worth chasing early — but not while the last search
    // failed, or an unreachable target would be retried every few frames, which
    // is exactly what the failure backoff exists to prevent.
    const goalMoveIsDue =
      goalTileMoved &&
      !this.astarLastSearchFailed &&
      this.astarFramesSinceRepath >= ASTAR_MIN_REPATH_GAP_FRAMES;
    const wantsRepath = this.astarTimer <= 0 || goalMoveIsDue;

    if (wantsRepath) {
      // Over budget: keep following the stale path rather than adding to a
      // spike. A mob denied for too long searches anyway, so a crowded frame
      // order can never starve the same mob indefinitely.
      const mustSearch = this.astarDeniedFrames >= ASTAR_MAX_DENIED_FRAMES;
      if (mustSearch || tryConsumePathfind()) {
        const myTileX = Math.floor((this.x + ts * MOB_TILE_CENTER) / ts);
        const myTileY = Math.floor((this.y + ts * MOB_TILE_CENTER) / ts);
        const foundPath = this.map.findPath(
          myTileX,
          myTileY,
          goalTileX,
          goalTileY,
          this.pathDistanceBudgetTiles,
          this.isHostile,
        );
        this.astarPath = foundPath;
        // Drop the first waypoint — that's the tile we're already on
        if (this.astarPath.length > 0) this.astarPath.shift();
        this.astarGoalTX = goalTileX;
        this.astarGoalTY = goalTileY;
        this.astarFramesSinceRepath = 0;
        this.astarDeniedFrames = 0;
        this.astarLastSearchFailed = foundPath.length === 0;
        this.astarTimer = this.astarLastSearchFailed
          ? ASTAR_FAILURE_BACKOFF_FRAMES
          : refreshInterval + this.astarStagger;
      } else {
        this.astarDeniedFrames++;
      }
    }

    // Pop waypoints that are already close enough
    while (this.astarPath.length > 0) {
      const wp = this.astarPath[0];
      if (Math.hypot(wp.x * ts - this.x, wp.y * ts - this.y) < ts * ASTAR_WAYPOINT_CLOSE_FRACTION) {
        this.astarPath.shift();
      } else {
        break;
      }
    }

    if (this.astarPath.length > 0) {
      // Navigate toward the next waypoint; stop distance 0 for intermediate hops
      const wp = this.astarPath[0];
      this.followTargetCollide(wp.x * ts, wp.y * ts, speed, 0);
    } else {
      // End of path — close in with the real stop distance
      this.followTargetCollide(targetPixelX, targetPixelY, speed, minDist);
    }
  }

  /**
   * True if there is a clear line of sight from this mob's centre to the
   * target's centre.
   *
   * The result is cached for a few frames: most creatures ask twice per frame
   * (once to track the target, once to gate an attack), and LOS to a moving
   * target is not a quantity anything can perceive at frame accuracy.
   */
  protected hasLOS(target: Player): boolean {
    if (!this.map) return true;
    if (this.losCacheTarget === target && this.losCacheAge < LOS_REFRESH_FRAMES) {
      return this.losCacheResult;
    }
    const ts = this.tileSize;
    this.losCacheResult = this.map.hasLineOfSight(
      this.x + ts * MOB_TILE_CENTER,
      this.y + ts * MOB_TILE_CENTER,
      target.x + ts * MOB_TILE_CENTER,
      target.y + ts * MOB_TILE_CENTER,
    );
    this.losCacheTarget = target;
    this.losCacheAge = 0;
    return this.losCacheResult;
  }

  /**
   * True if there is a clear line of sight from this mob's centre to a bare
   * world point, for a target that keeps no `Player` interface of its own —
   * a trebuchet a hostile has noticed and gone to attack.
   */
  hasSightOfPoint(x: number, y: number): boolean {
    if (!this.map) return true;
    const ts = this.tileSize;
    return this.map.hasLineOfSight(
      this.x + ts * MOB_TILE_CENTER,
      this.y + ts * MOB_TILE_CENTER,
      x,
      y,
    );
  }

  /**
   * Whether this mob can *notice* `target` — the perception gate on starting a
   * fight, as opposed to `hasLOS`, which gates acts inside one that has already
   * started.
   *
   * True when the mob has clear sight of the target, or when the target has hurt
   * it recently: something shooting from behind a wall is unseen but is very
   * much noticed.
   */
  protected canNotice(target: Player): boolean {
    if (!this.map) return true;
    if (this.alertedTo.has(target)) return true;
    if (this.noticeCacheFrames <= 0) {
      this.noticeCache.clear();
      this.noticeCacheFrames = NOTICE_REFRESH_FRAMES + this.noticeStagger;
    }
    const cached = this.noticeCache.get(target);
    if (cached !== undefined) return cached;
    const ts = this.tileSize;
    const seen = this.map.hasLineOfSight(
      this.x + ts * MOB_TILE_CENTER,
      this.y + ts * MOB_TILE_CENTER,
      target.x + ts * MOB_TILE_CENTER,
      target.y + ts * MOB_TILE_CENTER,
    );
    this.noticeCache.set(target, seen);
    return seen;
  }

  /**
   * The target this mob should be fighting this frame, or null to disengage.
   *
   * Replaces the nearest-living-target-in-range scan that every subclass used to
   * inline, and adds the gate that scan was missing: a mob that is not already
   * fighting someone has to be able to *notice* them first, so walls, trees and
   * furniture genuinely hide the player until a fight starts.
   *
   * Once engaged the gate is gone — the mob saw where its quarry went and chases
   * it around the corner — and the engaged target alone gets the widened
   * `AGGRO_PERSIST_MULTIPLIER` range. That per-target widening is why this reads
   * `currentTarget` instead of taking an "am I aggroed" flag: a mob two rooms
   * deep in a chase should not thereby acquire a *second*, unseen target at
   * double range.
   *
   * `accept` filters candidates a subclass refuses to fight; it runs before the
   * sight test, which is the expensive one. `forceAggro` bypasses range and
   * sight both, so scripted encounters behave exactly as before.
   *
   * A defend target is refused outright, ahead of `accept` and of `forceAggro`.
   * Quest-critical bystanders — the defend quest's NPC, Tsarina Signet at her
   * own circus — used to be kept out of reach by never appearing in any target
   * list, which held only for as long as nobody added one; the single mob that
   * *does* fight one goes through its own `defendTarget` field rather than
   * through this scan.
   */
  protected acquireTarget(
    targets: readonly Player[],
    aggroRangePx: number,
    accept?: (target: Player) => boolean,
  ): Player | null {
    const engagedTarget = this.currentTarget;
    const persistRangePx = aggroRangePx * AGGRO_PERSIST_MULTIPLIER;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (target.isDefendTarget === true) continue;
      if (accept && !accept(target)) continue;
      const dist = Math.hypot(target.x - this.x, target.y - this.y);
      if (dist >= nearestDist) continue;
      if (this.forceAggro) {
        nearestDist = dist;
        nearest = target;
        continue;
      }
      const isEngagedTarget = target === engagedTarget;
      if (dist >= (isEngagedTarget ? persistRangePx : aggroRangePx)) continue;
      if (!isEngagedTarget && !this.canNotice(target)) continue;
      nearestDist = dist;
      nearest = target;
    }
    // The frame a fight starts is the only frame worth shouting on: a mob that
    // was already engaged has an `engagedTarget`, so the search below runs a
    // handful of times per fight rather than once per mob per frame.
    // A converted mob answers to no pack: its old packmates would be called
    // onto the enemy it just picked — one of their own.
    if (
      nearest !== null &&
      engagedTarget === null &&
      this.isHostile &&
      this.packAlertRadiusTiles > 0
    ) {
      alertPackAround(this, this.packAlertRadiusTiles * this.tileSize, nearest);
    }
    return nearest;
  }

  /**
   * How far this mob's kind calls for help when a fight starts or when it is
   * hurt, in tiles. Zero — the default — leaves a mob fighting alone exactly as
   * before, so this is opt-in per creature rather than a change to all of them.
   */
  protected get packAlertRadiusTiles(): number {
    return 0;
  }

  /**
   * Who answers this mob's call for help.
   *
   * Its own class by default, which is what "a room of goblins fights as one"
   * means for four archetypes that are all `Goblin`. Overridden where two
   * *classes* belong to one group: a goblin archer that only ever called other
   * archers would stand and watch its own melee line be pulled apart one goblin
   * at a time, which is precisely the tactic it exists to punish.
   */
  get packKind(): string {
    return this.mobType;
  }

  /**
   * Told by a packmate where the fight is.
   *
   * Sets the target *and* registers it as alerted, which are two different
   * things: the target makes this mob engage, and the alert is what stops the
   * perception gate from immediately dropping a target it has no line of sight
   * to — a goblin answering a shout from the next room can't see anything yet.
   *
   * A mob already fighting something is left alone. That is also what bounds the
   * mechanism; see {@link alertPackAround}.
   */
  noticeTarget(target: Player): void {
    if (!this.isAlive || !target.isAlive) return;
    // A shout cannot recruit a bystander. Nothing else writes an ally's
    // `currentTarget`, and that field is what the companion AI reads to decide
    // who is fighting the party.
    if (!this.isHostile) return;
    if (this.currentTarget !== null) return;
    this.currentTarget = target;
    this.alertedTo.set(target, ALERT_DURATION_FRAMES);
  }

  /**
   * Whether `target` has hurt *this* mob, recently.
   *
   * Exposed so an ally can ask it from outside: "which mob is the cat fighting"
   * has no answer on the cat, who does not track what she swung at, but every
   * mob already records who hit it and how long ago.
   *
   * Both halves are needed and neither is sufficient. `alertedTo` carries the
   * recency but not the target — a pack shout registers the alert on every
   * packmate in the radius, so a mob the attacker has never touched reports the
   * alert for the full window. `damageTakenBy` carries the target but not the
   * recency; nothing clears it short of death. Together they mean what the name
   * says.
   */
  wasRecentlyHurtBy(target: Player): boolean {
    return this.alertedTo.has(target) && this.damageTakenBy.has(target);
  }

  /** Straight-line distance in pixels from this mob to `target`. */
  protected distanceTo(target: { readonly x: number; readonly y: number }): number {
    return Math.hypot(target.x - this.x, target.y - this.y);
  }

  /**
   * Records the target's current position as the last known location when LOS
   * is clear. Call each frame while a target is being chased.
   */
  protected updateLastKnown(target: Player) {
    if (this.hasLOS(target)) {
      this.lastKnownTargetX = target.x;
      this.lastKnownTargetY = target.y;
    }
  }

  /**
   * Point this mob at a target.
   *
   * Facing is otherwise written in only two places — `followTargetCollide` and
   * `doWander` — and `followTargetCollide` returns *before* writing it once
   * inside its stop radius. So the moment a mob closes to attack range, nothing
   * points it at anything, and it plays its whole strike aimed wherever it
   * happened to be walking. Call this in any branch that holds position to
   * fight; guard it on the mob's own swing timer where re-facing mid-animation
   * would flip the arc.
   */
  protected faceToward(target: { readonly x: number; readonly y: number }): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const deadzonePx = this.tileSize * FACING_FLIP_DEADZONE_TILE_RATIO;
    // A target inside the dead zone that would flip the mirror is a wobble
    // across dead centre, not a turn: hold the side already facing and let
    // only the depth component (used for reach/aim, not mirroring) track it.
    const wouldFlipMirror = Math.sign(dx) !== 0 && Math.sign(dx) !== Math.sign(this.facingX);
    if (wouldFlipMirror && Math.abs(dx) < deadzonePx) {
      this.facingY = dy / distance;
      return;
    }
    this.facingX = dx / distance;
    this.facingY = dy / distance;
  }

  /** Whether this mob is standing in river water. */
  isWading(): boolean {
    if (!this.map) return false;
    const ts = this.tileSize;
    return this.map.isWadeable(
      Math.floor((this.x + ts / 2) / ts),
      Math.floor((this.y + ts / 2) / ts),
    );
  }

  /**
   * Puts the mob at (`x`, `y`) for an outside push that ignores walls — the
   * edge of a protective shell — unless the mob refuses that ground
   * ({@link acceptsShove}), in which case each axis is tried on its own so it
   * still slides as far as it may.
   */
  shoveTo(x: number, y: number): void {
    if (this.acceptsShove(x, y)) {
      this.x = x;
      this.y = y;
      return;
    }
    if (this.acceptsShove(x, this.y)) {
      this.x = x;
      return;
    }
    if (this.acceptsShove(this.x, y)) this.y = y;
  }

  /**
   * Whether an outside push may leave this mob's top-left at (`x`, `y`). Every
   * mob accepts by default; one that must stay on its own ground (livestock
   * in its pen) refuses the rest.
   */
  protected acceptsShove(_x: number, _y: number): boolean {
    return true;
  }

  /**
   * Whether {@link shoveTo} would set this mob down at (`x`, `y`) — for a
   * caller choosing between several places to push it, which must pick one
   * the mob will take rather than find out after the push.
   */
  canBeShovedTo(x: number, y: number): boolean {
    return this.acceptsShove(x, y);
  }

  /**
   * Moves by (dx, dy) with per-axis wall collision, mirroring the player's
   * movement so mobs can slide along walls instead of passing through them.
   */
  protected moveWithCollision(dx: number, dy: number) {
    // A mob being shoved goes where the shove takes it. Its own chase, wander
    // and separation steps would otherwise walk straight back into the room
    // the shove was meant to give the player. Facing and attack timers are
    // untouched, so the stagger reads as a stumble, not a freeze.
    if (this.knockbackFramesRemaining > 0 && !this.knockbackStepInProgress) return;
    // A root holds the mob's own feet the same way; a shove still carries it.
    if (this.rootFrames > 0 && !this.knockbackStepInProgress) return;
    // Only a step that *enters* marked ground is refused: one taken from inside
    // it is the flee, and refusing that would pin the mob in the fire. Without
    // the refusal the flee and the follow take turns — the flee steps it clear,
    // the follow walks it straight back to the owner standing in the circle.
    // A shove goes where it goes.
    const guardsMarkedGround = this.avoidsMarkedGround && !this.knockbackStepInProgress;
    if (guardsMarkedGround && !isMarkedGround(this.x, this.y)) {
      const beforeX = this.x;
      const beforeY = this.y;
      this.stepThroughWalls(dx, dy);
      if (isMarkedGround(this.x, this.y)) {
        this.x = beforeX;
        this.y = beforeY;
      }
      return;
    }
    this.stepThroughWalls(dx, dy);
  }

  /** {@link moveWithCollision} without the knockback and marked-ground rules. */
  private stepThroughWalls(dx: number, dy: number): void {
    if (!this.map) {
      this.x += dx;
      this.y += dy;
      return;
    }
    const ts = this.tileSize;
    // A mob in the river wades exactly as the player does. Scaled here rather
    // than at each caller because every one of them — chase, wander, leash
    // return, flee — arrives through this method, and a mob that crossed water
    // at a run while the player laboured would make the river look like a
    // player-only obstacle.
    if (this.isWading()) {
      dx *= WADE_SPEED_FACTOR;
      dy *= WADE_SPEED_FACTOR;
    }
    // A chill slows a mob's own steps the way it slows a crawler's, and for the
    // same reason as the wade it is applied here. A shove is not the mob's own
    // step, so a knockback carries its full distance. Only the party is ever
    // chilled, so hostile movement never passes through this factor.
    if (!this.knockbackStepInProgress) {
      const statusFactor = this.statusMoveFactor;
      dx *= statusFactor;
      dy *= statusFactor;
    }
    if (dx !== 0) {
      const nextX = this.x + dx;
      const tileXnext =
        dx >= 0
          ? Math.floor((nextX + ts * MOB_COLLISION_FRONT_FRACTION) / ts)
          : Math.floor((nextX + ts * MOB_COLLISION_BACK_FRACTION) / ts);
      const tileYcur = Math.floor((this.y + ts / 2) / ts);
      if (
        this.map.isWalkableFor(tileXnext, tileYcur, this.isHostile) &&
        !this.map.isStairwellTile(tileXnext, tileYcur)
      )
        this.x = nextX;
    }
    if (dy !== 0) {
      const nextY = this.y + dy;
      const tileXcur = Math.floor((this.x + ts / 2) / ts);
      // Feet-first when walking south, centre otherwise — the same rule the
      // player follows. Without it a mob walks until its waist meets a south
      // wall and stands with its whole lower half on the masonry.
      const tileYnext = Math.floor((nextY + ts * verticalCollisionOffset(dy)) / ts);
      if (
        this.map.isWalkableFor(tileXcur, tileYnext, this.isHostile) &&
        !this.map.isStairwellTile(tileXcur, tileYnext)
      )
        this.y = nextY;
    }
  }

  /**
   * Wall-aware equivalent of Player.followTarget. Updates facing direction and
   * uses moveWithCollision so the mob slides along walls while chasing.
   * When fully stuck (both axes blocked), rotates the movement vector ±90° to
   * steer around corners. Flips steering direction after 50 stuck frames.
   */
  protected followTargetCollide(targetX: number, targetY: number, speed: number, minDist: number) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      this.isMoving = false;
      return;
    }
    const effectiveSpeed = this.isSlowed ? speed * MOB_SLOWED_SPEED_FRACTION : speed;
    const step = Math.min(effectiveSpeed, dist - minDist);
    const nx = dx / dist;
    const ny = dy / dist;
    this.facingX = nx;
    this.facingY = ny;

    const preX = this.x;
    const preY = this.y;
    this.moveWithCollision(nx * step, ny * step);

    if (this.x === preX && this.y === preY) {
      // Fully stuck — try perpendicular steering direction
      const perpX = -ny * this.steerSign;
      const perpY = nx * this.steerSign;
      this.moveWithCollision(perpX * step, perpY * step);
      if (this.x === preX && this.y === preY) {
        this.stuckFrames++;
        if (this.stuckFrames > STUCK_FLIP_FRAMES) {
          this.steerSign *= -1;
          this.stuckFrames = 0;
        }
      } else {
        this.stuckFrames = 0;
      }
    } else {
      this.stuckFrames = 0;
    }

    this.isMoving = true;
  }

  /**
   * Whether this mob currently refuses all damage.
   *
   * A scripted boss hiding behind something the party has to destroy first —
   * Grimaldi's tendrils, Miss Quill's capacitor — is the only user. This is
   * *the* switch: every route into this mob's health asks it, the swung one and
   * the damage-over-time one alike. A shield that guarded only the swing let one
   * crown proc dissolve the whole "kill the adds first" mechanic and be paid the
   * kill credit, the XP and the boss chest for doing it.
   */
  protected get isDamageImmune(): boolean {
    return false;
  }

  /**
   * Shows the player that a blow was refused rather than missed. Overridden by
   * whichever boss is doing the refusing, because the tell belongs to its own
   * art — a flare across the tendrils, a crack of the capacitor's field.
   */
  protected onDamageBlocked(): void {
    // Nothing to show by default; only a shielded boss has a tell.
  }

  /**
   * Fractional damage reduction, applied in `takeDamageFrom` and `takeDamage`
   * at the same points that consult {@link isDamageImmune}. A mob that wants a
   * partial guard rather than the all-or-nothing shield above — the Krakaren's
   * guard tentacles — overrides this instead. Applying it at both entry points
   * keeps a swung hit and a status/DoT tick under the same guard, for the same
   * reason `isDamageImmune` is consulted at both.
   */
  protected get incomingDamageScale(): number {
    return 1;
  }

  /**
   * Share of a dynamite blast's enemy damage this mob takes.
   *
   * Every boss answers {@link BOSS_BLAST_DAMAGE_SCALE}, not only the ones that
   * set {@link isBoss}: that flag also routes boss-room ownership, and several
   * bosses run by their own systems leave it false on purpose. Those override
   * this getter instead. A stick scaled to level a floor's rank and file would
   * otherwise let a bag bought for a few dozen gold skip a boss fight outright.
   */
  get blastDamageScale(): number {
    return this.isBoss ? BOSS_BLAST_DAMAGE_SCALE : 1;
  }

  /**
   * Only scales a genuine hit. Zero/negative amounts pass through untouched so
   * the "amount <= 0" guards further down the pipeline (dodge rolls, no-op
   * ticks) still see the caller's original value instead of a floor-forced 1.
   */
  private scaleIncomingDamage(amount: number): number {
    if (amount <= 0) return amount;
    return Math.max(1, Math.round(amount * this.incomingDamageScale * this.statusDamageScale));
  }

  /**
   * Damage reduction a status grants, kept apart from
   * {@link incomingDamageScale} so a creature that overrides that for its own
   * guard still takes the reduction on top of it.
   */
  get statusDamageScale(): number {
    return this.hasStatus(FAIRY_AEGIS_STATUS) ? AEGIS_DAMAGE_SCALE : 1;
  }

  /**
   * A shield that swallows the damage swallows the cause with it.
   *
   * Otherwise the sepsis a crown proc paid for lands on a boss that cannot be
   * hurt, counts its duration down against the shield, and is gone by the time
   * the tendrils are — which is worse than not proccing at all, because the
   * player watched it apply.
   */
  override applyStatus(effect: StatusEffect): void {
    if (this.refusesDamage) return;
    super.applyStatus(effect);
  }

  /**
   * The body that physically delivered the blow now resolving in
   * {@link takeDamageFrom}, when a {@link takeCreditedDamage} call named one
   * other than the credited attacker. Set only for the length of that call, so
   * it reaches the base implementation through every subclass override without
   * each of them having to forward it.
   */
  private _creditedStrike: { readonly striker: Player | null } | null = null;

  /**
   * {@link takeDamageFrom} for harm credited to one body but delivered by
   * another: a hireling's sword or thrown boulder credited to the crawler who
   * paid for it, or reflect gear credited to its wearer.
   *
   * `striker` is what a guard is judged against and shoved away from. `null`
   * means nothing struck at all — reflected damage — which can neither be
   * guarded nor count as the clean hit that ends a run of guards.
   */
  takeCreditedDamage(
    amount: number,
    creditedTo: Player | null,
    damageType: PlayerDamageType | null,
    striker: Player | null,
  ): void {
    this._creditedStrike = { striker };
    try {
      this.takeDamageFrom(amount, creditedTo, damageType);
    } finally {
      this._creditedStrike = null;
    }
  }

  /**
   * Counts damage toward the run's "damage dealt".
   *
   * Called from the two places a mob's hp is written with a dealer attached —
   * the blow door and the applied-tick door — and every party weapon reaches
   * one of them exactly once, so this is the one count. A hireling's blow and a
   * summon's arrive credited to the crawler they fight for. Harm to an ally
   * (a crawler's own dynamite catching Mongo) is not damage dealt.
   */
  private notePartyDamage(dealer: Player, amount: number): void {
    if (!this.isHostile || !dealer.xpCreditTarget.isCrawler) return;
    activeRunStats()?.recordDamageDealt(amount);
  }

  /**
   * Deal damage and attribute it to an attacker for kill-credit / XP tracking.
   * Also triggers the damage flash and shows the health bar.
   *
   * `damageType` names the weapon, and takes `null` for harm an attacker owns
   * but swung nothing for — a damage-over-time tick they applied. Everything
   * that keys off `killType` already treats null as "not killed by a blow", so
   * a status finish trains no weapon skill while still crediting the kill.
   */
  takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ) {
    this._lastBlowWasGuarded = false;
    const striker = this._creditedStrike === null ? attacker : this._creditedStrike.striker;
    if (this.refusesDamage) {
      this.onDamageBlocked();
      return;
    }
    // The friendly-fire rule is enforced at the door as well as at each attack
    // site, so a weapon added later cannot wound an ally by forgetting to ask.
    // A mob attacker is exempt: an enemy hitting a non-hostile mob is the fight
    // working, not friendly fire.
    const isCrawlerAttack = attacker !== null && !(attacker instanceof Mob);
    if (isCrawlerAttack && !this.takesPlayerDamage(damageType)) return;
    if (attacker !== null && striker !== null) {
      if (this.tryGuardBlow(amount, attacker, striker, damageType)) return;
    }
    const scaled = this.scaleIncomingDamage(amount);
    const wasHeldInvulnerable = this.isHeldInvulnerable;
    // Wards on either side soak a struck blow: a hireling's Shield on Mongo, or
    // overheal on a hostile — and a shield fairy's ward stops it outright.
    const unabsorbed = this.soakWithWards(scaled);
    // Counted the moment the ward is reached at all, blocked outright or only
    // blunted (easy mode's `Resist`): either way the crawler just watched a
    // hit not do its job, which is the thing the explainer bark answers.
    if (wasHeldInvulnerable && scaled > 0 && attacker !== null && !(attacker instanceof Mob)) {
      attacker.noteWardBlockedHit();
    }
    if (unabsorbed <= 0 && scaled > 0) return;
    const prev = this.hp;
    this.hp = Math.max(0, this.hp - unabsorbed);
    const actual = prev - this.hp;
    if (actual > 0) {
      this.damageFlash = MOB_DAMAGE_FLASH_FRAMES;
      this.healthBarTimer = HEALTH_BAR_VISIBLE_FRAMES;
      // A tick is not a blow, and reflected damage was struck by nobody, so
      // only a weapon that someone swung breaks a run of guards.
      if (damageType !== null && striker !== null) this.tactics.noteCleanHit();
      if (attacker) {
        this.damageTakenBy.set(attacker, (this.damageTakenBy.get(attacker) ?? 0) + actual);
        this.notePartyDamage(attacker, actual);
        this.noteAttackedBy(attacker);
      }
    }
    if (this.hp === 0 && prev > 0) this._resolveDeath(attacker, damageType);
  }

  /**
   * Ends this mob's life outright, for an effect that is a verdict rather than
   * a blow — a shield fairy's crushing ward closing on a vespa. Skips every
   * door a blow goes through (`scaleIncomingDamage`, wards, `refusesDamage`):
   * those all exist to answer "how much of this damage gets through", and this
   * carries no damage number to scale down or absorb in the first place. Still
   * runs the one path that matters afterward — `_resolveDeath` sets `justDied`,
   * which is what `resolveKills` reads to remove the mob from the mob grid,
   * play its death and (were there a ledger) pay out a kill; with `attacker`
   * null here there is no ledger, so no XP or coin credit is possible. A no-op
   * on a mob already dead, so a kill that lands twice in one frame cannot fire
   * `_resolveDeath` twice.
   */
  killOutright(): void {
    if (!this.isAlive) return;
    this.hp = 0;
    this._resolveDeath(null, null);
  }

  /**
   * Turn `attacker` toward this mob as an enemy, wounded or not.
   *
   * Shared by a blow that landed and a blow this mob guarded: a guard is still
   * being attacked, and a mob that shrugged off the first swing and then stood
   * idle would read as broken rather than skilled.
   */
  private noteAttackedBy(attacker: Player): void {
    this.alertedTo.set(attacker, ALERT_DURATION_FRAMES);
    // Being shot from cover is the case a sight-based alert cannot cover:
    // nobody in the pack has noticed anything, and without this the archer
    // picks them off one at a time from outside everyone's aggro range.
    //
    // Only while unengaged. A mob already fighting shouted when it acquired
    // its target, so repeating it here would buy nothing and would run a
    // spatial query per damage tick for the whole of every fight.
    if (this.currentTarget === null && this.isHostile && this.packAlertRadiusTiles > 0) {
      alertPackAround(this, this.packAlertRadiusTiles * this.tileSize, attacker);
    }
  }

  /**
   * Which tactics traits this creature can ever roll. None by default: bosses,
   * quest NPCs, summons, props and allies keep their authored behaviour, and a
   * regular creature opts in only to what makes sense for its body.
   */
  protected get tacticsEligibility(): readonly TacticsTrait[] {
    return NO_TACTICS;
  }

  /**
   * Set by whatever conjures this mob into a fight, before the spawn roll. A
   * summon is part of its summoner's authored fight, so it learns nothing even
   * when its creature, spawned on a floor in its own right, could.
   */
  isSummon = false;

  /**
   * Set by the system that stages a boss's own adds — the Hoarder's roaches,
   * the Krakaren's tentacles, the ball's Tusklings — as it spawns them. Their
   * number and timing are the boss's script, so a necromancer standing one back
   * up would be rewriting that fight.
   */
  isBossAdd = false;

  /**
   * Roll this mob's tactics traits from its level. Call once, at spawn, straight
   * after {@link applyMobLevel} — `applySpawnDifficulty` does both halves of that
   * for every spawn site.
   */
  rollTactics(chanceScale: number, rng: Rng): void {
    const eligibility = this.isSummon ? NO_TACTICS : this.tacticsEligibility;
    this.tactics.roll(this.mobLevel, eligibility, chanceScale, rng);
  }

  /**
   * The traits this mob rolled that its current body still acts on.
   *
   * Traits are rolled once and kept for life, but a creature whose body changes
   * mid-life — a grub that becomes a hornet — can outgrow what it learned. Its
   * eligibility then narrows and the rest go dormant rather than being
   * stripped. The rank mark, the first-meeting notices and the trait-fight
   * telemetry all promise the player a behaviour, so they read this list, not
   * every trait ever rolled.
   */
  get activeTacticsTraits(): readonly TacticsTrait[] {
    if (!this.tactics.hasAnyTrait) return this.tactics.traits;
    const eligibility = this.tacticsEligibility;
    return this.tactics.traits.filter((trait) => eligibility.includes(trait));
  }

  /** Whether {@link activeTacticsTraits} is non-empty, without building the list. */
  get hasActiveTactics(): boolean {
    if (!this.tactics.hasAnyTrait) return false;
    const eligibility = this.tacticsEligibility;
    return this.tactics.traits.some((trait) => eligibility.includes(trait));
  }

  /**
   * Ask this mob's tactics where to walk this frame, for a creature that chases
   * its last sighting of `target` with {@link followTargetAStar}. Null — and
   * nothing asked — for a mob with no movement trait, so an untrained mob pays
   * nothing and behaves exactly as it always has.
   *
   * Drops the cached route whenever the answer changes kind: a mob following
   * its old chase path would step *toward* the player it has just started
   * backing away from, until the next repath.
   */
  protected chooseTacticalStep(
    target: Player,
    attackRangePx: number,
    canBreakOff: boolean,
    kiteAim: KiteAim = retreatTowardHelper,
  ): TacticalMove | null {
    if (!this.tactics.hasMovementTraits) return null;
    const previous = this.tactics.lastMove;
    this.tacticalTargetPoint.x = this.lastKnownTargetX;
    this.tacticalTargetPoint.y = this.lastKnownTargetY;
    const move = this.tactics.chooseMove({
      self: this,
      map: this.map,
      tileSize: this.tileSize,
      target,
      targetPoint: this.tacticalTargetPoint,
      attackRangePx,
      canBreakOff,
      kiteAim,
      flankStagingTiles: this.flankStagingTiles,
      regroupAim: this.regroupAim,
    });
    if ((move?.behaviour ?? null) !== previous) this.clearAStarPath();
    return move;
  }

  /**
   * How far from its quarry, in tiles, this creature stages a flank. Undefined
   * — the brawler's default — unless a creature that fights from range
   * overrides it with its own stand-off.
   */
  protected get flankStagingTiles(): number | undefined {
    return undefined;
  }

  /**
   * Where this creature regroups to, given the friend it regroups on.
   * Undefined — walk up to the friend itself, as a brawler does — unless a
   * creature that fights from range overrides it; see
   * `TacticalFrame.regroupAim`.
   */
  protected get regroupAim(): KiteAim | undefined {
    return undefined;
  }

  /**
   * Walk one frame of a move from {@link chooseTacticalStep}, then face
   * `target` if the walk stopped: `followTargetCollide` writes no facing inside
   * its stop radius, so a mob arriving where its tactic sent it would otherwise
   * stand looking the way it walked.
   *
   * Held while {@link isSwingAnimating}, as `faceToward` asks: an arc that
   * flips direction halfway through reads as the sprite glitching.
   *
   * A retreat is walked no faster than {@link TACTICAL_RETREAT_MAX_SPEED}, so a
   * creature quick enough to outpace the player still cannot kite out of reach.
   *
   * A retreat is also walked in a straight line rather than along a route. Its
   * planner only accepts a walk whose straight line is open and keeps clear of
   * the player, and a route through tile centres bends off that line — for a
   * brawler starting in contact, toward the player, where the separation that
   * keeps bodies apart then shoves the player along the whole walk.
   */
  protected walkTacticalStep(move: TacticalMove, target: Player): void {
    if (move.breaksOff) {
      const speed = Math.min(this.speed, TACTICAL_RETREAT_MAX_SPEED);
      this.followTargetCollide(move.x, move.y, speed, move.stopPx);
    } else {
      this.followTargetAStar(move.x, move.y, this.speed, move.stopPx);
    }
    if (!this.isMoving && !this.isSwingAnimating) this.faceToward(target);
  }

  /**
   * Whether a swing's animation is playing, so turning now would flip its
   * arc. False by default; a creature whose swing animation can still be
   * running while a tactic walks it says so.
   */
  protected get isSwingAnimating(): boolean {
    return false;
  }

  /**
   * Roll this mob's guard against one incoming blow, and on success turn it
   * aside: no damage, a "Blocked" label, and a shove away from whoever struck
   * it that buys the player the space the lost hit cost them.
   *
   * Judged against `striker`, the body that swung, rather than `attacker`, the
   * one credited: a hireling's sword is a creature's blow even when the crawler
   * who hired it collects the kill.
   *
   * Not recorded in the damage ledger, so a guard alone does not count as the
   * party having fought this mob — but the mob is still told it was attacked.
   */
  private tryGuardBlow(
    amount: number,
    attacker: Player,
    striker: Player,
    damageType: PlayerDamageType | null,
  ): boolean {
    const guardable = isGuardableBlow({
      amount,
      damageType,
      fromCrawler: striker.isCrawler,
      hp: this.hp,
      maxHp: this.maxHp,
    });
    if (!guardable || !this.tactics.tryGuard()) return false;
    this._lastBlowWasGuarded = true;
    this.healthBarTimer = HEALTH_BAR_VISIBLE_FRAMES;
    this.queueFloatingText(GUARD_LABEL, 'block');
    this.guardSoundPending = true;
    this.shoveAwayFrom(striker);
    this.noteAttackedBy(attacker);
    return true;
  }

  /** Start a guard's knockback, directed from `striker` through this mob. */
  private shoveAwayFrom(striker: Player): void {
    let dirX = this.x - striker.x;
    let dirY = this.y - striker.y;
    // Standing exactly on the striker gives no direction, so step back the
    // way this mob is facing away from.
    if (dirX === 0 && dirY === 0) {
      dirX = -this.facingX;
      dirY = -this.facingY;
    }
    if (dirX === 0 && dirY === 0) return;
    this.applyKnockback(dirX, dirY, GUARD_KNOCKBACK_TILES * this.tileSize, GUARD_KNOCKBACK_FRAMES);
  }

  /**
   * Advance an in-progress knockback by one frame through this mob's own wall
   * collision, so a mob shoved into masonry simply stops against it.
   *
   * The caller owns the spatial grid and must re-bucket the mob afterwards;
   * `MobUpdateLoop` does, by running this inside the span its `mobGrid.move`
   * already covers.
   */
  advanceKnockback(): void {
    if (this.knockbackFramesRemaining <= 0) return;
    const step = knockbackStepPx(this, this.tileSize);
    this.knockbackStepInProgress = true;
    try {
      this.moveWithCollision(this.knockbackDirX * step, this.knockbackDirY * step);
    } finally {
      this.knockbackStepInProgress = false;
    }
    this.knockbackFramesRemaining--;
    if (this.knockbackFramesRemaining <= 0) this.clearKnockback();
  }

  /**
   * A wound that kills, whatever dealt it: `justDied`, kill credit, and the loot
   * roll. Everything downstream of a kill hangs off `justDied` — the `mobKilled`
   * event, and with it the gore, the XP, the loot and the removal from the mob
   * grid.
   */
  private _resolveDeath(attacker: Player | null, damageType: PlayerDamageType | null): void {
    this.justDied = true;
    // Credited rather than literal: a pet attacks in its own name so that mobs
    // retaliate against *it*, but every killer-keyed reward in the game — loot
    // chances, achievements, kill XP — belongs to the owner who sent it in.
    const credited = attacker?.xpCreditTarget ?? null;
    this.killedBy = credited;
    this.killedByDealer = attacker;
    this.killType = damageType;
    this.droppedLoot = null;
    if (!this.paysRewards) return;
    const rolled = this.rollLootDrop(credited);
    if (rolled.coins > 0 || rolled.items.length > 0) {
      this.droppedLoot = rolled;
    }
  }

  /**
   * One pass over this mob's loot table. Public because a boss chest must never
   * open empty: the defeat-transition safety net in `DungeonScene` fills a chest
   * the kill pipeline could not, and by then `droppedLoot` may be null because
   * the original roll came up with nothing at all.
   *
   * @param killer Who the roll is for — subclasses give different drops to
   *   different crawlers. Null when nobody earned the kill.
   */
  rollLootDrop(killer: Player | null): LootDrop {
    return {
      coins: randomInt(this.coinDropMin, this.coinDropMax),
      items: this.rollLootItems(killer),
    };
  }

  /**
   * Damage that arrives outside a swing — a burn, a poison tick, an acid pool,
   * the doomsday clock. `Player.takeDamage` writes hp and nothing else, so a mob
   * finished by one of these used to hit zero with `justDied` still false: no
   * death event, and therefore no gore, no loot, no XP, and a nought-HP body
   * left standing in `mobs` and in the mob grid until something else culled it.
   *
   * A damage-over-time tick that somebody *applied* is a blow they landed, just
   * a late one: it goes into the damage ledger and credits the kill, so the
   * sepsis crown's proc earns its wearer the XP, the loot, the achievement and
   * the boss chest exactly as the hit that applied it would have.
   *
   * `killType` stays null even then. The union names weapons — melee, missile,
   * shell, smush, explosion — and a status is none of them; a DoT finish trains
   * no ability, which is the deliberate price of not having to teach every
   * `killType` consumer a case for a kill nobody aimed.
   */
  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (this.refusesDamage) {
      this.onDamageBlocked();
      return false;
    }
    const prev = this.hp;
    const connected = super.takeDamage(this.scaleIncomingDamage(amount), source);
    if (!connected) return false;
    const applier = source?.kind === 'status' ? source.applier : null;
    const dealt = prev - this.hp;
    if (dealt > 0) {
      // Raised to the tick's share, never lowered to it. Without a bar at all a
      // mob melting to the sepsis crown gives the player nothing to read but
      // the corpse at the end; with a bar held longer than the gap between
      // ticks it never lapses, and sepsis is permanent, so every mob ever
      // procced would wear one for the rest of the run. And a plain assignment
      // would let a tick landing mid-fight cut short the longer bar the blow
      // before it had earned.
      this.healthBarTimer = Math.max(this.healthBarTimer, STATUS_TICK_HEALTH_BAR_FRAMES);
      if (applier !== null) {
        this.damageTakenBy.set(applier, (this.damageTakenBy.get(applier) ?? 0) + dealt);
        this.notePartyDamage(applier, dealt);
      }
    }
    if (this.hp === 0 && prev > 0 && !this.justDied) {
      this._resolveDeath(applier, null);
    }
    return connected;
  }

  /**
   * Generates the item portion of this mob's loot drop.
   * Subclasses may override to add extra drops based on who killed them.
   */
  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    const items: LootDrop['items'] = [];
    if (Math.random() < DEFAULT_POTION_DROP_CHANCE)
      items.push({ id: 'health_potion', quantity: 1 });
    if (Math.random() < DEFAULT_FOG_SCROLL_DROP_CHANCE)
      items.push({ id: 'scroll_of_confusing_fog', quantity: 1 });
    if (Math.random() < SPEED_FIZZ_DROP_CHANCE) items.push({ id: 'speed_fizz', quantity: 1 });
    if (Math.random() < JUGG_JUICE_DROP_CHANCE) items.push({ id: 'jugg_juice', quantity: 1 });
    if (Math.random() < COOLDOWN_CRISP_DROP_CHANCE)
      items.push({ id: 'cooldown_crisp', quantity: 1 });
    if (Math.random() < STAT_BOOST_DROP_CHANCE)
      items.push({ id: 'stat_boost_potion', quantity: 1 });
    if (this.allowSlingshotDrop && this.slingshotEligible && Math.random() < SLINGSHOT_DROP_CHANCE)
      items.push({ id: 'slingshot', quantity: 1 });
    return items;
  }

  /** Whether this mob may roll the rare Slingshot world drop. */
  protected get slingshotEligible(): boolean {
    return true;
  }

  /** Extends Player.tickTimers to also decrement the health bar visibility timer. */
  tickTimers() {
    super.tickTimers();
    if (this.reviveRiseFramesLeft > 0) {
      this.reviveRiseFramesLeft--;
      this.isMoving = false;
    }
    if (this.healthBarTimer > 0) this.healthBarTimer--;
    if (this.hitSlowFrames > 0) this.hitSlowFrames--;
    if (this.hazardSlowFrames > 0) this.hazardSlowFrames--;
    if (this.rootFrames > 0) {
      this.rootFrames--;
      if (this.rootFrames === 0) this.rootSource = null;
    }
    this.tactics.tick();
    this.tickStructureStrike();
    // Saturating rather than wrapping: this counter is only ever compared
    // against a small window, and a mob that has not hit anybody for two years
    // of game time must not roll back around to "just did".
    if (this._framesSinceStruckPlayer < Number.MAX_SAFE_INTEGER) this._framesSinceStruckPlayer++;
    this.losCacheAge++;
    if (this.noticeCacheFrames > 0) this.noticeCacheFrames--;
    if (this.alertedTo.size > 0) {
      for (const [target, framesLeft] of this.alertedTo) {
        if (framesLeft <= 1) this.alertedTo.delete(target);
        else this.alertedTo.set(target, framesLeft - 1);
      }
    }
  }

  /**
   * Whether **this mob** has strayed past its leash and should break off.
   *
   * Read carefully: it takes a position because it is asked about the mob's own,
   * and it is consulted only where a chase is decided — never in a perception
   * loop, a melee loop or a damage loop.
   *
   * The first version filtered *targets* by their distance from home, inside the
   * aggro scan, the melee scan and the strike-damage loop. It looked like
   * `RuinsGhoul`'s safe-zone break-off and it was a different thing entirely: a
   * player standing a tile outside the leash became **invisible** to every
   * resident. They would not aggro, would not retaliate when hit, and a
   * troglodyte already mid-strike dealt no damage if its target stepped over the
   * line — the whole camp could be cleared at range with nothing fighting back.
   * The precedent does not transfer because a town safe zone is somewhere the
   * player has no reason to fight from, whereas a circle round a camp is exactly
   * where the fight happens.
   *
   * A leash limits how far a mob will *travel*. It has nothing to say about what
   * the mob can see or hit.
   */
  protected isBeyondLeash(x: number, y: number): boolean {
    const home = this.homePoint;
    const radiusTiles = this.leashRadiusTiles;
    if (home === undefined || radiusTiles === undefined) return false;
    return Math.hypot(x - home.x, y - home.y) > radiusTiles * this.tileSize;
  }

  /**
   * Idle behaviour for a mob with nothing to chase: walk back to its camp if it
   * has wandered out of it, otherwise mill about.
   *
   * For an unleashed mob this *is* `doWander`, unchanged.
   *
   * It walks back until it is **well** inside the leash, not merely inside it.
   * Turning around the instant it crosses the line makes a resident oscillate on
   * the boundary — one step in, wander a step out, turn round again — and
   * measured that way a goblin dragged thirty tiles out settled anywhere from
   * four to eighteen tiles from home, i.e. often still outside its own camp.
   */
  protected returnHomeOrWander(): void {
    // A converted mob's home is whoever turned it; `doWander` rallies to them.
    if (this.isConverted) {
      this.doWander();
      return;
    }
    const home = this.homePoint;
    const radiusTiles = this.leashRadiusTiles;
    if (home === undefined || radiusTiles === undefined) {
      this.doWander();
      return;
    }
    const settledRadiusPx = radiusTiles * this.tileSize * LEASH_SETTLE_FRACTION;
    if (Math.hypot(this.x - home.x, this.y - home.y) <= settledRadiusPx) {
      this.doWander();
      return;
    }
    // Toward a waypoint a bounded distance along the way, not toward home
    // itself. Two simpler versions each failed a different way, and the numbers
    // are worth keeping: pathing straight to home leaves A* asked for a
    // thirty-tile route, which it declines to return, and the mob then stood
    // still for a full minute of frames on about one run in six. Steering
    // directly instead always moves but snags on the first tree, and got home on
    // only two runs in six. A short hop is inside A*'s reach, so it routes round
    // obstacles *and* always has an answer; the mob simply makes the journey in
    // stages.
    //
    // Measured honestly: from an artificial worst case — teleported thirty tiles
    // out in one frame, onto reachable ground — the walk completes within a
    // minute of frames on about two runs in three. The remainder are hemmed in by
    // scenery at the start and work loose only as the wander drifts them. The
    // *break-off* half of the leash, which is what actually keeps a camp
    // populated, is unconditional: see `isBeyondLeash`.
    const toHomeX = home.x - this.x;
    const toHomeY = home.y - this.y;
    const distance = Math.hypot(toHomeX, toHomeY);
    const hop = Math.min(distance, LEASH_RETURN_HOP_TILES * this.tileSize);
    this.followTargetAStar(
      this.x + (toHomeX / distance) * hop,
      this.y + (toHomeY / distance) * hop,
      this.speed,
      this.tileSize,
    );
  }

  /**
   * Idle wandering: picks a random direction every ~2 s, slowly moves within
   * a 4-tile radius of the spawn point.
   */
  doWander() {
    if (this.walkToAllyRally()) return;
    if (this.wanderTimer > 0) {
      this.wanderTimer--;
    } else {
      if (Math.random() < WANDER_PAUSE_CHANCE) {
        // Pause for a moment
        this.wanderDx = 0;
        this.wanderDy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        this.wanderDx = Math.cos(angle) * this.speed * WANDER_SPEED_FRACTION;
        this.wanderDy = Math.sin(angle) * this.speed * WANDER_SPEED_FRACTION;
      }
      this.wanderTimer = randomInt(WANDER_TIMER_MIN, WANDER_TIMER_MAX);
    }

    if (this.wanderDx !== 0 || this.wanderDy !== 0) {
      // Pull back toward spawn if too far
      const dx = this.spawnX - this.x;
      const dy = this.spawnY - this.y;
      const distToSpawn = Math.hypot(dx, dy);
      const MAX_WANDER_PX = this.tileSize * WANDER_MAX_RADIUS_TILES;
      if (distToSpawn > MAX_WANDER_PX) {
        const nx = dx / distToSpawn;
        const ny = dy / distToSpawn;
        this.wanderDx = nx * this.speed * WANDER_PULLBACK_SPEED_FRACTION;
        this.wanderDy = ny * this.speed * WANDER_PULLBACK_SPEED_FRACTION;
      }
      // Face the way we are actually walking. `followTargetCollide` does this
      // for a mob that is chasing something, but a wandering one used to keep
      // whatever facing its last chase left it with — so any sprite that mirrors
      // on `facingX` moonwalks for as long as the wander happens to run the
      // other way, which is most of the time an unaggroed mob is on screen.
      const wanderSpeed = Math.hypot(this.wanderDx, this.wanderDy);
      if (wanderSpeed > 0) {
        this.facingX = this.wanderDx / wanderSpeed;
        this.facingY = this.wanderDy / wanderSpeed;
      }
      this.moveWithCollision(this.wanderDx, this.wanderDy);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  /**
   * Walks a converted mob back toward its rally point when it has strayed
   * past it, and reports whether it did — the wander is skipped that frame.
   * Latched on the way in so it settles well inside the radius instead of
   * stopping on the line.
   */
  private walkToAllyRally(): boolean {
    const rally = this.allyRally;
    if (rally?.anchor.isAlive !== true) return false;
    const distance = Math.hypot(rally.anchor.x - this.x, rally.anchor.y - this.y);
    if (!this.rallyReturning && distance <= rally.radiusPx) return false;
    const settlePx = rally.radiusPx * ALLY_RALLY_SETTLE_FRACTION;
    if (distance <= settlePx) {
      this.rallyReturning = false;
      return false;
    }
    this.rallyReturning = true;
    this.followTargetAStar(rally.anchor.x, rally.anchor.y, this.speed, settlePx);
    return true;
  }

  /** Whether a converted mob is on its way back to its rally point; see {@link walkToAllyRally}. */
  private rallyReturning = false;

  protected renderAggroIndicator(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ) {
    ctx.save();
    ctx.font = `bold ${AGGRO_INDICATOR_FONT_SIZE}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = AGGRO_INDICATOR_LINE_WIDTH;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText('!', sx + tileSize / 2, sy - AGGRO_INDICATOR_Y_OFFSET);
    ctx.fillStyle = 'rgba(239, 68, 68, 1)';
    ctx.fillText('!', sx + tileSize / 2, sy - AGGRO_INDICATOR_Y_OFFSET);
    ctx.restore();
  }

  /**
   * Renders the health bar only while it is visible (after taking damage).
   * Fades out over the last 40 frames.
   */
  protected renderMobHealthBar(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.healthBarTimer > 0) {
      const alpha =
        this.healthBarTimer < HEALTH_BAR_FADE_FRAMES
          ? this.healthBarTimer / HEALTH_BAR_FADE_FRAMES
          : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.renderHealthBar(ctx, sx, sy);
      // drawText sets its own globalAlpha from its `alpha` option rather than
      // reading the ambient one, so the fade above has to be threaded through
      // explicitly or the mark would snap straight to opaque.
      this.renderTacticsRankMark(ctx, sx, sy, alpha);
      ctx.restore();
    }
  }

  /**
   * A tiny star beside the health bar of a mob that still acts on at least one
   * tactics trait — enough for a player to tell a smart enemy from a dumb one
   * without spelling out which trait. Bosses author their own behaviour and
   * never carry a trait, but the boss check stays explicit rather than relying
   * on that, since a boss subclass could still override its eligibility.
   */
  private renderTacticsRankMark(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    alpha: number,
  ) {
    if (this.isBoss || !this.hasActiveTactics) return;
    const barTop = sy - HP_BAR_Y_OFFSET;
    const barCenterY = barTop + HP_BAR_HEIGHT / 2;
    drawText(ctx, TACTICS_RANK_MARK, {
      x: sx + this.tileSize + TACTICS_RANK_MARK_GAP,
      y: barCenterY - TEXT_PRESETS.tacticsMark.size / 2,
      align: 'left',
      alpha,
      ...TEXT_PRESETS.tacticsMark,
    });
  }

  /**
   * Status art and the septic label, drawn by {@link Player.render} *after* the
   * silhouette composite rather than from `drawSelf` — see the note there. The
   * anchor is the mob's own tile, so a mob that draws its art offset from its
   * tile (Signet stacks her overlay above hers) still gets its flames at its
   * feet instead of over its head.
   */
  /**
   * A corpse is not on fire. `drawSelf` returns early for dead mobs, so while
   * status art lived in there this came for free; drawing it outside means
   * saying so. It matters for the mobs that keep rendering after death — their
   * timers stop ticking too, so the fade never starts and a killed spider would
   * burn at full strength under its own corpse until it was culled.
   *
   * `BallOfSwine` reports itself alive through its burst, which is why this asks
   * the getter rather than testing hp.
   */
  protected override get wearsStatusPaint(): boolean {
    return this.isAlive;
  }

  protected override drawWorldFeedback(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (!this.wearsStatusPaint) return;
    super.drawWorldFeedback(ctx, sx, sy);
    this.renderSepticLabel(ctx, sx, sy);
  }

  /**
   * How far above its tile a mob's written status label has to start, in tiles,
   * to clear its own art. Zero suits a mob drawn inside its tile; a mob drawn
   * larger than that — Signet stands two tiles tall and has horns — must say so
   * or the label lands across its face.
   */
  protected get statusLabelClearanceTiles(): number {
    return 0;
  }

  /**
   * The one status that also gets a written label. Sepsis is permanent and its
   * whole point is that the mob is already dead on its feet, which no amount of
   * green haze conveys on its own.
   */
  private renderSepticLabel(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (!this.hasStatus('sepsis')) return;
    // The label and the status art want different origins. Flames belong at the
    // mob's feet, so they anchor to its tile; a written label belongs clear of
    // whatever the mob draws above that tile, which only the mob knows.
    const labelY = sy - this.statusLabelClearanceTiles * this.tileSize;
    const t = Date.now();
    const pulse = SEPTIC_PULSE_BASE + SEPTIC_PULSE_AMP * Math.sin(t * SEPTIC_PULSE_SPEED);
    drawText(ctx, 'Septic', {
      x: sx + this.tileSize * MOB_TILE_CENTER,
      y: labelY - SEPTIC_LABEL_Y_OFFSET - SEPTIC_LABEL_Y2_OFFSET,
      size: SEPTIC_LABEL_SIZE,
      bold: true,
      color: '#bef264',
      align: 'center',
      alpha: pulse,
      outline: '#65a30d',
      outlineWidth: 2,
    });
  }

  /**
   * Shove this mob out of an overlap, capped at a share of its own walk step.
   *
   * **The cap is what stops packs vibrating.** Separation is a position write
   * applied *after* `updateAI` has already moved the mob, while the AI's own
   * restoring step is clamped to `Math.min(speed, …)`. Uncapped, a third of a
   * tile of overlap displaced a goblin about 3 px against a walk step of 1.4 —
   * the AI pulled in a pixel, separation threw it out three, and the two
   * alternated forever. A group steering at one point (a bounty escort's shared
   * home point, or all of them chasing one player) can never reach a separated
   * equilibrium, so the forcing never stops and the oscillation never damps.
   *
   * Capping here rather than in the caller means every source of separation gets
   * it — the pairwise mob pass, and the player shove, which resolved its whole
   * overlap in a single frame and shook any mob whose stop distance sat inside
   * one tile.
   */
  applySeparation(dx: number, dy: number): void {
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const limit = this.speed * MAX_SEPARATION_STEP_FRACTION;
    if (length <= limit) {
      this.moveWithCollision(dx, dy);
      return;
    }
    const scale = limit / length;
    this.moveWithCollision(dx * scale, dy * scale);
  }

  /**
   * Returns this mob to its spawn tile at full health with no aggro, as if it
   * had never engaged. Used when the party respawns at a safe-room checkpoint —
   * a living mob must not keep the low HP, target lock or damage attribution
   * from the encounter that killed the player. Dead mobs are left alone
   * entirely; this is only ever called on the survivors.
   *
   * Boss subclasses with their own phase state (enrage, wind-ups, state
   * machines) put that in {@link clearEncounterPhase} rather than overriding
   * this, so that the other two ways a fight gets called off unwind it too.
   */
  resetToSpawn(): void {
    this.clearEncounterPhase();
    this.reviveRiseFramesLeft = 0;
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.hp = this.maxHp;
    this.currentTarget = null;
    this.retaliateMob = null;
    this.killedBy = null;
    this.killedByDealer = null;
    this.killType = null;
    this.damageTakenBy.clear();
    this._hasStruckPlayer = false;
    this._framesSinceStruckPlayer = Number.MAX_SAFE_INTEGER;
    this.alertedTo.clear();
    this.noticeCache.clear();
    this.justDied = false;
    this.droppedLoot = null;
    this.healthBarTimer = 0;
    // Both describe a hit that is being rewound. The flash matters most on the
    // revive path — a mob reset while alive burns its tint down over the next
    // few frames, but one brought back from the dead was frozen wearing the
    // white of the blow that killed it.
    this.damageFlash = 0;
    this.hitSlowFrames = 0;
    this.hazardSlowFrames = 0;
    this.rootFrames = 0;
    this.rootSource = null;
    this.clearStructureStrike();
    this.revertConversion();
    this.forceAggro = false;
    this.wanderDx = 0;
    this.wanderDy = 0;
    this.clearAStarPath();
    this.clearStatusEffects();
    this.clearTransientCombatState();
    // The traits stay: they were rolled at spawn and are who this mob is.
    this.tactics.clearLiveState();
  }

  /**
   * Unwinds whatever this mob latched during a fight that is being called off:
   * an enrage and the speed it bought, a wind-up half-played, a queued
   * projectile, a phase the encounter cannot start in.
   *
   * A boss room can rewind a fight in three different ways — a checkpoint
   * restore, an abort when nobody conscious is left inside, and the heal that
   * undoes damage dealt to a boss nobody ever walked in on. All three mean the
   * same thing to the boss: that fight did not happen. Without this, a Juicer
   * chipped to a third of its health and left alone came back at full health
   * and still permanently enraged, which is a harder boss than the one the
   * party first met.
   *
   * No-op by default. Override it — not `resetToSpawn`, which calls this —
   * anywhere a mob keeps state its own AI cannot climb back out of at full
   * health, because the enrage checks are all `if (!isEnraged && hurt)` and
   * never un-latch on their own.
   */
  protected clearEncounterPhase(): void {
    // Nothing latched by default.
  }

  /**
   * Brings a mob that died *after* the checkpoint back to its pre-fight state.
   *
   * The checkpoint is a point-in-time snapshot of the floor, so a kill scored
   * after it did not happen: the corpse has to stand back up rather than being
   * left as a body the player already earned XP and loot for. HP is restored
   * before `resetToSpawn()` because some bosses gate that call on being alive.
   *
   * Subclasses whose death leaves state `resetToSpawn()` does not clear (a
   * burst animation, a phase latch) must override this, clear that state, and
   * then call `super.reviveForCheckpoint()`.
   */
  reviveForCheckpoint(): void {
    this.vanished = false;
    this.hp = this.maxHp;
    this.justDied = false;
    // A checkpoint revive undoes the kill rather than granting a second life,
    // so the next death pays like the first.
    this.wasResurrected = false;
    this.reacquireDisposedResources();
    this.resetToSpawn();
  }

  /**
   * Puts a mob that was already dead at the checkpoint, then brought back by
   * something like {@link reviveInPlace}, back to dead — as if the
   * resurrection had never happened. The checkpoint already recorded this
   * kill as banked, so a rewind must not hand it out a second time by leaving
   * the mob standing.
   */
  undoResurrectionForCheckpoint(): void {
    this.hp = 0;
    this.wasResurrected = false;
    this.reviveRiseFramesLeft = 0;
    this.forceAggro = false;
    this.dispose();
  }

  /**
   * Heals this mob and unlearns the fight, without moving it or touching its
   * wander state — every trace that it was ever in one, including the ledger
   * the engagement checks read and any phase its own AI latched.
   *
   * Two callers, for the same reason. A non-hostile mob (a hired mercenary) on
   * a checkpoint restore: an ally is not the encounter that killed the party,
   * so it must not be teleported to its spawn tile the way `resetToSpawn()`
   * does, but it can still take real damage and must not stay critically
   * wounded once the party itself is fully healed. Not the pet — he is
   * dismissed before that runs, so his spent HP reaches the save rather than
   * being handed back for free. And a boss the party chipped at from outside
   * its room and then walked away from, which has to be as untouched next time
   * as it was the first time.
   */
  healAndForgetFight(): void {
    this.clearEncounterPhase();
    this.revertConversion();
    this.rootFrames = 0;
    this.rootSource = null;
    this.hazardSlowFrames = 0;
    this.hp = this.maxHp;
    this.currentTarget = null;
    this.retaliateMob = null;
    this.damageTakenBy.clear();
    this._hasStruckPlayer = false;
    this._framesSinceStruckPlayer = Number.MAX_SAFE_INTEGER;
    this.alertedTo.clear();
    this.noticeCache.clear();
    this.healthBarTimer = 0;
    this.clearStatusEffects();
    this.clearTransientCombatState();
    // The traits stay: they were rolled at spawn and are who this mob is.
    this.tactics.clearLiveState();
  }

  abstract updateAI(targets: Player[]): void;
}

/** Removes a mob from the roster and the grid, and disposes it. */
export function despawnMob(mob: Mob, mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
  const index = mobs.indexOf(mob);
  if (index >= 0) mobs.splice(index, 1);
  mobGrid.remove(mob);
  mob.dispose();
}
