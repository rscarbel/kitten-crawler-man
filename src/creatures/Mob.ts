import { Player } from '../Player';
import type { DamageSource } from '../Player';
import type { StatusEffect } from '../core/StatusEffect';
import type { GameMap } from '../map/GameMap';
import { verticalCollisionOffset } from '../map/collisionAnchors';
import type { ItemId } from '../core/ItemDefs';
import { randomInt } from '../utils';
import { AGGRO_PERSIST_MULTIPLIER, WADE_SPEED_FACTOR } from '../core/constants';
import { tryConsumePathfind } from './pathfindBudget';
import { alertPackAround } from './packAlert';
import { drawText } from '../ui/TextBox';

/**
 * The weapon a player-sourced blow was struck with, named so that everything
 * downstream of a hit — kill credit, ability XP, death animations, friendly-fire
 * immunity — can key off what actually landed. `null` is harm an attacker owns
 * but swung nothing for: a damage-over-time tick they applied.
 */
export type PlayerDamageType = 'melee' | 'missile' | 'shell' | 'smush' | 'explosion';

/**
 * The one damage type that ignores friendly-fire immunity, so the rule lives in
 * a single place rather than as a string literal repeated at every blast site.
 */
const EXPLOSION_DAMAGE_TYPE = 'explosion' satisfies PlayerDamageType;

/** Stagger range for initial wander timer so mobs don't change direction together. */
const WANDER_TIMER_STAGGER_MAX = 119;

/** Per-level HP scaling multiplier increment (+30% per level above 1). */
const MOB_LEVEL_HP_SCALE = 0.3;
/** Per-level speed scaling multiplier increment (+8% per level above 1). */
const MOB_LEVEL_SPEED_SCALE = 0.08;
/** Per-level coin scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_COIN_SCALE = 0.25;
/** Per-level XP scaling multiplier increment (+25% per level above 1). */
const MOB_LEVEL_XP_SCALE = 0.25;
/** Per-level damage scaling multiplier increment (+20% per level). */
const MOB_LEVEL_DAMAGE_SCALE = 0.2;

/**
 * The shortest a scaled cooldown ever gets, as a fraction of its level-1 value.
 *
 * The fourth scaling axis, alongside HP, speed and damage. Threat is damage ×
 * cadence × hit-rate × count, and before this only the first of those moved with
 * level: a level-8 goblin swung on exactly the level-1 goblin's clock, so
 * levelling made enemies survive longer without ever making them more dangerous
 * — the definition of an HP sponge. The fix this codebase commits to is
 * pressure over sponge: scale the attack clock with level rather than
 * inflating HP, so a higher level reads as a more dangerous fight and not
 * just a longer one.
 *
 * Asymptotic and floored rather than linear, because the failure mode at the far
 * end is a machine gun: the curve is steepest over the first few levels, where
 * the player feels it, and flattens out well before it becomes unreactable.
 */
const CADENCE_FLOOR = 0.55;
/** How quickly {@link CADENCE_FLOOR} is approached; larger is faster. */
const CADENCE_RATE = 0.12;

/**
 * Multiplier a mob of this level applies to any of its own attack cooldowns and
 * wind-ups: 1.00 at level 1, ~0.79 at level 8, approaching {@link CADENCE_FLOOR}.
 *
 * A free function as well as {@link Mob.scaledCooldownFrames} so
 * `scripts/verify-difficulty.ts` can assert the curve's shape directly, rather
 * than against a copy of it that could drift.
 */
export function cooldownScaleForLevel(level: number): number {
  const extra = Math.max(0, level - 1);
  return CADENCE_FLOOR + (1 - CADENCE_FLOOR) / (1 + CADENCE_RATE * extra);
}

/** The value {@link cooldownScaleForLevel} approaches but never reaches. */
export const CADENCE_SCALE_FLOOR = CADENCE_FLOOR;

/**
 * A base cooldown or wind-up shortened for a given level, never below one frame.
 *
 * The single implementation behind {@link Mob.scaledCooldownFrames} and behind
 * every creature that exposes its own scaled timing as a free function, so
 * `scripts/verify-difficulty.ts` checks the real arithmetic rather than a copy.
 */
export function scaledCooldownFramesForLevel(baseFrames: number, level: number): number {
  return Math.max(1, Math.round(baseFrames * cooldownScaleForLevel(level)));
}

/**
 * The most of its own walk step a mob may be displaced by separation in one
 * frame. Under 1 so the AI always wins the tug-of-war: a stack still comes
 * apart, but over several frames, as drift rather than as a bounce. See
 * {@link Mob.applySeparation}.
 */
const MAX_SEPARATION_STEP_FRACTION = 0.5;

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

/** Speed multiplier while mob is slowed. */
const MOB_SLOWED_SPEED_FRACTION = 0.35;

/** Lifetime of a hit-applied slow — one frame, refreshed by each new impact. */
const HIT_SLOW_FRAMES = 1;

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

/** Aggro indicator font size. */
const AGGRO_INDICATOR_FONT_SIZE = 18;
/** Aggro indicator stroke line width. */
const AGGRO_INDICATOR_LINE_WIDTH = 3;
/** Aggro indicator Y offset above mob. */
const AGGRO_INDICATOR_Y_OFFSET = 3;

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
  /** Set each frame by DungeonScene when this mob is inside an active confusing fog. */
  isConfused = false;

  /**
   * Opt-out from the Scroll of Confusing Fog. Read by SpellSystem so `isConfused`
   * is never set in the first place — flagging and then ignoring would lie to
   * every other reader of that flag.
   */
  immuneToConfusion = false;

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
    return this.slowedByBarrier || this.hitSlowFrames > 0 || this.hasStatus('electrified');
  }

  /**
   * Slows this mob for a single frame. Refreshed by every impact, so the slow
   * holds only while the mob is under continuous fire.
   */
  applyHitSlow(): void {
    this.hitSlowFrames = HIT_SLOW_FRAMES;
  }

  /** True for airborne mobs that pass over ground mobs without physical collision. */
  isFlying = false;

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
   * resource a mob baked for itself and will never draw again once dead (e.g.
   * `SkyFowl`'s per-instance clothing canvas). A dead mob can otherwise sit in
   * `this.mobs` for the rest of the scene's life (see `restoreFromCheckpoint`'s
   * "the dead are never spliced out" note in `DungeonScene`), so freeing on
   * death rather than on removal from the array is what actually bounds this.
   *
   * Not called for every kind of removal: `MongoSystem`/`MercenarySystem`
   * intercept their companion's lethal damage and clear `justDied` (Mongo) or
   * splice themselves out directly (Mercenary) specifically so `resolveKills`
   * never processes them — neither overrides `dispose()` today since neither
   * bakes a per-instance resource, but a future one that does would need its
   * own cleanup hook rather than assuming this path covers it.
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
    return this.isAlive || (this.rendersWhenDead && !this.corpseExpired);
  }

  /**
   * Physical mass used for separation weighting. Heavier mobs move less when bumped.
   * Cockroaches (0.3) barely disturb anything; bosses (10) are nearly immovable.
   */
  mass = 1;

  /**
   * When set to a live Mob, this mob will chase and attack it as a priority target.
   * Used so that Brindled Vespa acid hits cause enemy mobs to retaliate.
   * DungeonScene injects this mob into the mob's target list each frame.
   */
  retaliateMob: Mob | null = null;

  /** When true (set by DungeonScene for locked boss rooms), ignores aggro range. */
  forceAggro = false;

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

  /** Whether this mob is currently hostile toward players. Defaults to true; override for neutral NPCs. */
  get isHostile(): boolean {
    return true;
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
    return this.isHostile;
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
    return false;
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
    this.spawnX = tileX * tileSize;
    this.spawnY = tileY * tileSize;
    this.lastKnownTargetX = this.spawnX;
    this.lastKnownTargetY = this.spawnY;
    // Stagger wander timers so mobs don't all change direction together
    this.wanderTimer = randomInt(0, WANDER_TIMER_STAGGER_MAX);
  }

  /**
   * What this mob's level multiplied its authored speed and max HP by.
   *
   * Kept because a good many creatures write those two fields again later in
   * their lives — a grub that evolves, a boss that enrages, a sky fowl that
   * breaks into a chase, anything reset by `resetToSpawn` — and every one of
   * those writes is a flat authored constant. Before this pass none of them were
   * ever levelled so it never showed; now that they are, a plain reassignment
   * silently throws the level away and leaves a boss with levelled HP moving at
   * level-1 speed — an HP sponge with none of the matching threat, which is the
   * exact failure mode {@link cooldownScaleForLevel} exists to avoid elsewhere.
   * Anything reassigning those fields must go through {@link setBaseSpeed} or
   * {@link setBaseMaxHp}.
   */
  private _levelSpeedMultiplier = 1;
  private _levelHpMultiplier = 1;

  /** Re-author this mob's speed from a base constant, keeping its level scaling. */
  protected setBaseSpeed(baseSpeed: number): void {
    this.speed = baseSpeed * this._levelSpeedMultiplier;
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
    this.setFixedMaxHp(Math.ceil(baseMaxHp * this._levelHpMultiplier));
  }

  /**
   * Scale this mob's stats for the given difficulty level.
   * Level 1 = base stats. Each level above 1 increases:
   *   HP:     +30% per level
   *   Speed:  +8% per level
   *   XP:     +25% per level
   *   Coins:  +25% per level
   * Damage is scaled via dealDamage() at +20% per level.
   */
  applyMobLevel(level: number) {
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

    // HP
    this._levelHpMultiplier = 1 + extra * MOB_LEVEL_HP_SCALE;
    this.setFixedMaxHp(Math.ceil(this.maxHp * this._levelHpMultiplier));
    this.hp = this.maxHp;

    // Speed
    this._levelSpeedMultiplier = 1 + extra * MOB_LEVEL_SPEED_SCALE;
    this.speed = this.speed * this._levelSpeedMultiplier;

    // Coins
    this.coinDropMin = Math.ceil(this.coinDropMin * (1 + extra * MOB_LEVEL_COIN_SCALE));
    this.coinDropMax = Math.ceil(this.coinDropMax * (1 + extra * MOB_LEVEL_COIN_SCALE));
  }

  /**
   * A base cooldown or wind-up length shortened for this mob's level.
   *
   * Every creature owns its own private timer, so this is the one shared
   * mechanism rather than a field applied for them: call it wherever a timer is
   * *reset*, never where one is compared, or the remaining time changes meaning
   * halfway through a swing.
   *
   * Never below one frame, and never below `base × CADENCE_FLOOR` — that lower
   * bound is the explicit floor the fairness rules require, and it comes from
   * the curve itself rather than from a second constant per creature that could
   * disagree with it.
   */
  protected scaledCooldownFrames(baseFrames: number): number {
    return scaledCooldownFramesForLevel(baseFrames, this.mobLevel);
  }

  /** Returns XP value scaled by mob level. */
  get scaledXpValue(): number {
    if (this.mobLevel <= 1) return this.xpValue;
    return Math.ceil(this.xpValue * (1 + (this.mobLevel - 1) * MOB_LEVEL_XP_SCALE));
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
    // The swing still lands audibly and visibly; only the harm is withheld.
    if (this.harmless) {
      this.attackSoundPending = true;
      return false;
    }
    const source: DamageSource = { kind: 'mob', mobType: this.mobType, attackType };
    const connected = target.takeDamage(this.scaledDamage(baseDamage), source);
    if (connected) this.noteStruckPlayer(target);
    this.attackSoundPending = true;
    return connected;
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
    if (this.harmless) {
      this.attackSoundPending = true;
      return false;
    }
    const source: DamageSource = { kind: 'mob', mobType: this.mobType, attackType };
    const connected = target.takeDamage(damage, source);
    if (connected) this.noteStruckPlayer(target);
    this.attackSoundPending = true;
    return connected;
  }

  /**
   * This mob's damage number after its level multiplier, and zero if it is
   * harmless.
   *
   * For attacks that cannot go through {@link dealDamage} because the harm is
   * resolved somewhere else — a projectile that outlives its owner, say. It
   * shares the scaling with `dealDamage` so a mob's ranged attack cannot drift
   * away from its melee one when the level curve is retuned.
   */
  protected scaledDamage(baseDamage: number): number {
    if (this.harmless) return 0;
    const mult = 1 + (this.mobLevel - 1) * MOB_LEVEL_DAMAGE_SCALE;
    return Math.ceil(baseDamage * mult);
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
        const foundPath = this.map.findPath(myTileX, myTileY, goalTileX, goalTileY);
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
    if (nearest !== null && engagedTarget === null && this.packAlertRadiusTiles > 0) {
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
   * Moves by (dx, dy) with per-axis wall collision, mirroring the player's
   * movement so mobs can slide along walls instead of passing through them.
   */
  protected moveWithCollision(dx: number, dy: number) {
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
    if (dx !== 0) {
      const nextX = this.x + dx;
      const tileXnext =
        dx >= 0
          ? Math.floor((nextX + ts * MOB_COLLISION_FRONT_FRACTION) / ts)
          : Math.floor((nextX + ts * MOB_COLLISION_BACK_FRACTION) / ts);
      const tileYcur = Math.floor((this.y + ts / 2) / ts);
      if (
        this.map.isWalkable(tileXnext, tileYcur) &&
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
        this.map.isWalkable(tileXcur, tileYnext) &&
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
   * A shield that swallows the damage swallows the cause with it.
   *
   * Otherwise the sepsis a crown proc paid for lands on a boss that cannot be
   * hurt, counts its duration down against the shield, and is gone by the time
   * the tendrils are — which is worse than not proccing at all, because the
   * player watched it apply.
   */
  override applyStatus(effect: StatusEffect): void {
    if (this.isDamageImmune) return;
    super.applyStatus(effect);
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
    if (this.isDamageImmune) {
      this.onDamageBlocked();
      return;
    }
    // The friendly-fire rule is enforced at the door as well as at each attack
    // site, so a weapon added later cannot wound an ally by forgetting to ask.
    // A mob attacker is exempt: an enemy hitting a non-hostile mob is the fight
    // working, not friendly fire.
    const isCrawlerAttack = attacker !== null && !(attacker instanceof Mob);
    if (isCrawlerAttack && !this.takesPlayerDamage(damageType)) return;
    const prev = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    const actual = prev - this.hp;
    if (actual > 0) {
      this.damageFlash = MOB_DAMAGE_FLASH_FRAMES;
      this.healthBarTimer = HEALTH_BAR_VISIBLE_FRAMES;
      if (attacker) {
        this.damageTakenBy.set(attacker, (this.damageTakenBy.get(attacker) ?? 0) + actual);
        this.alertedTo.set(attacker, ALERT_DURATION_FRAMES);
        // Being shot from cover is the case a sight-based alert cannot cover:
        // nobody in the pack has noticed anything, and without this the archer
        // picks them off one at a time from outside everyone's aggro range.
        //
        // Only while unengaged. A mob already fighting shouted when it acquired
        // its target, so repeating it here would buy nothing and would run a
        // spatial query per damage tick for the whole of every fight.
        if (this.currentTarget === null && this.packAlertRadiusTiles > 0) {
          alertPackAround(this, this.packAlertRadiusTiles * this.tileSize, attacker);
        }
      }
    }
    if (this.hp === 0 && prev > 0) this._resolveDeath(attacker, damageType);
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
    if (this.isDamageImmune) {
      this.onDamageBlocked();
      return false;
    }
    const prev = this.hp;
    const connected = super.takeDamage(amount, source);
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
  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    void killer; // available for subclasses
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
    return items;
  }

  /** Extends Player.tickTimers to also decrement the health bar visibility timer. */
  tickTimers() {
    super.tickTimers();
    if (this.healthBarTimer > 0) this.healthBarTimer--;
    if (this.hitSlowFrames > 0) this.hitSlowFrames--;
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
      ctx.restore();
    }
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
    this.forceAggro = false;
    this.wanderDx = 0;
    this.wanderDy = 0;
    this.clearAStarPath();
    this.clearStatusEffects();
    this.clearTransientCombatState();
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
    this.hp = this.maxHp;
    this.justDied = false;
    this.reacquireDisposedResources();
    this.resetToSpawn();
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
  }

  abstract updateAI(targets: Player[]): void;
}
