import type { StatusEffect } from './core/StatusEffect';
import {
  makeSpeedFizz,
  makeJuggJuice,
  makeCooldownCrisp,
  makeDrunk,
  WHETSTONE_MELEE_DAMAGE_BONUS,
} from './core/StatusEffect';
import { Inventory } from './core/Inventory';
import { drawText } from './ui/TextBox';
import { DRUNK_MELEE_DAMAGE_BONUS } from './core/DrunkEffect';
import { computeDodgeChance } from './core/dodge';
import {
  SkillManager,
  cockroachRechargeMs,
  COCKROACH_IFRAME_FRAMES,
  IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL,
  type CrawlerKind,
  type SkillId,
} from './core/SkillManager';
import type { FloatingTextRequest, FloatingTextStyle } from './core/FloatingText';
import { hitFlashLayer } from './core/hitFlash';
import { drawWithSilhouetteLayers, type SilhouetteLayer } from './core/silhouetteComposite';
import {
  statusBodyLayers,
  statusFade,
  statusVisual,
  type StatusVisualFrame,
} from './sprites/status/statusEffectVisuals';

/**
 * Every stat a crawler carries — the single vocabulary the whole stat system
 * speaks, and the iteration order for anything that walks all stats. A permanent
 * boost (potion or tattoo) can raise any of them.
 */
export const ALL_STATS = ['strength', 'intelligence', 'constitution', 'dexterity'] as const;
export type StatName = (typeof ALL_STATS)[number];

/** Short labels shown by the level-up flash and the HUD. */
export const STAT_CODE: Record<StatName, string> = {
  strength: 'STR',
  intelligence: 'INT',
  constitution: 'CON',
  dexterity: 'DEX',
};

const STAT_NAME_LOOKUP = new Set<string>(ALL_STATS);

/** Narrows an arbitrary string (AI tool argument, save field) to a known stat. */
export function isStatName(value: string): value is StatName {
  return STAT_NAME_LOOKUP.has(value);
}

/** A stat change that reverts itself after a fixed number of ticks. */
export interface TempStatMod {
  ticksRemaining: number;
  stat: StatName;
  delta: number;
}

/** Species-level configuration handed up to the {@link Player} constructor. */
export interface PlayerConfig {
  /**
   * Fixed max HP. Mobs pass this; crawlers omit it so max HP stays derived from
   * constitution and never has to be kept in sync by hand.
   */
  maxHp?: number;
  /** Starting base values. Any stat left out starts at {@link MIN_STAT_VALUE}. */
  baseStats?: Partial<Record<StatName, number>>;
  /** Species HP floor added on top of the constitution-derived HP. */
  baseHpOffset?: number;
  /** Which crawler this is, for skill eligibility. Omitted by mobs and NPCs. */
  crawlerKind?: CrawlerKind;
}

/**
 * Describes what caused a damage event. Stored as `lastDamageSource` on the player
 * so the death screen can explain how the player died.
 */
export type DamageSource =
  | {
      readonly kind: 'mob';
      readonly mobType: string;
      readonly attackType?: string;
      /**
       * Set for standing damage fields (acid puddles and the like). They are
       * attributed to the mob that laid them so the death screen can name it,
       * but there is nothing to sidestep — dodging a floor you are standing on
       * makes no sense, and would let a player farm dodge-trained skills by
       * parking in a puddle.
       */
      readonly undodgeable?: boolean;
    }
  | {
      readonly kind: 'status';
      readonly effectType: string;
      /**
       * Whoever applied the status this tick came from, copied off the effect —
       * see {@link StatusEffect.applier}. `Mob` reads it to credit a kill that
       * lands on a damage-over-time tick, which is the only channel a tick has:
       * by the time it fires, the blow that applied it is long gone.
       */
      readonly applier: Player | null;
    }
  | { readonly kind: 'dynamite' }
  | {
      readonly kind: 'environmental';
      /**
       * Which standing hazard did it. Optional because `environmental` had a
       * single producer for a long time and the burning tree is still the one
       * an untagged source means; a second hazard reporting "a burning tree"
       * on the death screen is the failure this discriminates away.
       */
      readonly hazard?: 'burningTree' | 'lavaFlames' | 'clownGas';
    }
  | { readonly kind: 'doomsday' };

const DEFAULT_POTION_COOLDOWN_SECONDS = 5.75;
const DENOMINATOR_OFFSET = 30;
const NUMERATOR_ASYMPTOTE_SLOPE = 3;

const INITIAL_HEALTH_POTIONS = 10;
/** Ceiling on undrained feedback labels, so a scene with no drainer can't leak. */
const MAX_PENDING_FLOATING_TEXT = 16;
/** Same, for queued System lines. */
const MAX_PENDING_SYSTEM_NOTICES = 4;
/** No stat can be driven below this by debuffs or refunds. */
export const MIN_STAT_VALUE = 1;
/** Species HP floor used when a subclass doesn't declare one (mobs, which pass a fixed maxHp). */
const DEFAULT_BASE_HP_OFFSET = 0;
const DAMAGE_FLASH_FRAMES = 8;
/**
 * How long a hit holds passive regeneration off, in frames (5 s at 60 fps).
 *
 * Lives here rather than beside the other regen constants in `PlayerTickSystem`
 * because it is a property of the character being hit, not of the tick that
 * heals them: the counter it bounds is written by {@link Player.takeDamage},
 * which the tick system never sees.
 */
export const REGEN_SUPPRESS_FRAMES = 300;
const LEVEL_UP_FLASH_FRAMES = 120;
const SPEND_POINT_FLASH_FRAMES = 60;
const XP_PER_LEVEL_MULTIPLIER = 10;
/** Max HP granted by each point of constitution. The single source for this ratio. */
export const CON_HP_BONUS_PER_POINT = 2;
const POTION_HEAL_FRACTION = 0.5;
/**
 * Half what a health potion gives back. The Dirty Shirley is a cocktail with a
 * drawback attached, not a medicine — matching the pub's Boozy Milk, which is
 * the same trade at a bar you cannot carry home.
 */
const DIRTY_SHIRLEY_HEAL_FRACTION = 0.25;
const FRAMES_PER_SECOND = 60;
/** Iron Stomach can shorten a swallow's timers by a lot, but never to nothing. */
const MIN_IRON_STOMACH_TIME_SCALE = 0.4;

/** Tick intervals (in ticks) for each status effect type */
const BURN_TICK_INTERVAL = 60;
const POISON_TICK_INTERVAL = 120;
const SEPSIS_TICK_INTERVAL = 120;
const MAGIC_BURN_TICK_INTERVAL = 60;
const ELECTRIFIED_TICK_INTERVAL = 60;
const SPIT_VENOM_TICK_INTERVAL = 40;

/**
 * Default wading depth, used by every mob. Half a tile puts the surface at about
 * the waist of a humanoid mob drawn a tile tall, which is most of them; a mob
 * with a very different figure should override it as the crawlers do.
 */
const DEFAULT_WATERLINE_ABOVE_FOOT_PX = 16;

/** Walk animation speed constant */
export const WALK_FRAME_SPEED = 0.14;

/** Potion effect constants */
const SPEED_FIZZ_MULTIPLIER = 2;
const JUGG_JUICE_HP_MULTIPLIER_BONUS = 0.5;
const JUGG_JUICE_FLAT_BONUS = 5;
const STAT_BOOST_MIN = 2;
const STAT_BOOST_RANGE = 3;

/** Health bar display thresholds */
const HP_BAR_GREEN_THRESHOLD = 0.5;
const HP_BAR_YELLOW_THRESHOLD = 0.25;
const HP_BAR_HEIGHT = 4;
const HP_BAR_Y_OFFSET = 7;

/**
 * How far past their tile the crawlers' own art reaches, in tiles — enough to
 * take in the raised health bar and the status-effect flames above the head.
 */
export const PLAYER_HIT_FLASH_MARGIN_TILES = 2;

/**
 * Distinct starting point for every character's status-effect randomness. Two
 * mobs burning side by side off the same seed flicker in perfect lockstep, which
 * the eye reads as one wide fire rather than two burning creatures.
 */
let nextVisualSeed = 1;
/** Coprime-ish stride, so consecutive spawns land far apart in the hash. */
const VISUAL_SEED_STRIDE = 97;

/**
 * Where a character's drawn figure sits relative to its own tile, in tile
 * fractions. See {@link Player.statusFigureBox}.
 */
export interface StatusFigureBox {
  /** Horizontal centre of the figure, 0 at the tile's left edge. */
  readonly centerX: number;
  /** Top of the figure. Negative when the art reaches above its tile. */
  readonly top: number;
  /** The figure's ground line, normally at or near the tile's bottom edge. */
  readonly bottom: number;
  /** Half the figure's width. */
  readonly halfWidth: number;
}

/** The default figure box: exactly the character's tile. */
const TILE_FIGURE_BOX: StatusFigureBox = {
  centerX: 0.5,
  top: 0,
  bottom: 1,
  halfWidth: 0.5,
};

/** KO overlay parameters */
const KO_OVERLAY_ALPHA = 0.55;
const KO_RING_ALPHA_BASE = 0.45;
const KO_RING_ALPHA_RANGE = 0.3;
const KO_RING_LINE_WIDTH = 2;
const KO_RING_BASE_FRACTION = 0.48;
const KO_RING_PULSE_FRACTION = 0.06;
const KO_PULSE_SPEED = 0.004;
const HALF = 0.5;
const KO_FONT_REVIVING_FRACTION = 0.28;
const KO_FONT_KO_FRACTION = 0.38;
const KO_LABEL_Y_PADDING = 2;

export abstract class Player {
  x: number;
  y: number;
  isActive = false;
  facingX = 1;
  facingY = 0;
  hp: number;
  xp = 0;
  level = 1;
  /**
   * Stored stat values: species starting points plus spent level-up points plus
   * permanent boosts (potions, tattoos). Equipment and temporary modifiers are
   * *not* folded in here — the effective getters add those on every read, so a
   * paired equip/unequip can never drift.
   */
  private readonly baseStats: Record<StatName, number>;
  /** Species HP floor. See {@link maxHp}. */
  private readonly baseHpOffset: number;
  /** Fixed max HP for entities that don't derive it from constitution (mobs). */
  private _maxHpOverride: number | null;
  /** Max HP as of the last {@link syncHpToMaxHp}, so growth can be credited once. */
  private _maxHpAtLastSync: number;
  /** Flat bonus applied to every stat while god mode is on. */
  private _godModeStatBonus = 0;
  levelUpStat: string | null = null;
  levelUpFlash = 0;
  damageFlash = 0;
  isMoving = false;
  walkFrame = 0;
  /**
   * Radians of walk cycle added per moving frame. Subclasses whose figure is
   * drawn at a larger scale, or who move at a fraction of their top speed, can
   * slow this so the stride matches the ground actually covered.
   */
  protected walkFrameSpeed = WALK_FRAME_SPEED;
  /**
   * How far above the sprite's foot line the river surface cuts across it, in
   * pixels at the in-game tile size. Everything below is clipped away and
   * replaced by the waterline, so this is literally how deep the crawler wades.
   *
   * Per-crawler rather than one world-wide water depth, and that is a deliberate
   * lie about the river. A single depth that puts the human in at the waist is
   * over a cat's head, and a depth a cat can stand in barely wets a boot. Each
   * figure instead wades to its own fraction of its own height, so both read as
   * "in the water" from the same river.
   */
  readonly waterlineAboveFootPx: number = DEFAULT_WATERLINE_ABOVE_FOOT_PX;
  /** Set when a status effect deals a damage tick; DungeonScene reads and clears it to play the sound. */
  effectDamageSoundPending = false;
  /** Feedback labels awaiting pickup by `FloatingCombatTextSystem`. */
  readonly pendingFloatingText: FloatingTextRequest[] = [];
  /**
   * System-AI lines queued by code with no scene in scope (save migration),
   * drained by `SystemNoticeSystem`.
   */
  readonly pendingSystemNotices: string[] = [];
  /**
   * Dodges landed since the last drain. Counted separately from the floating
   * text so that the cosmetic label's backpressure cap can never decide whether
   * a gameplay event fires.
   */
  pendingDodges = 0;
  /**
   * Frames since this character last took damage, counted up to
   * {@link REGEN_SUPPRESS_FRAMES} and held there. Starts at the ceiling so a
   * character that has never been hit is not treated as freshly wounded.
   */
  private framesSinceDamaged = REGEN_SUPPRESS_FRAMES;
  /**
   * Damage taken since the last drain, for the difficulty overlay.
   *
   * Only the two crawlers' copies are drained, by `DifficultyTelemetrySystem`;
   * a mob writes one nobody reads, exactly as it does with {@link pendingDodges}.
   */
  pendingDamageTaken = 0;
  /** Shared inventory for this player (separate from the other player's). */
  readonly inventory = new Inventory();
  /** Trained skills. Starts empty — every skill has to be found in the dungeon. */
  readonly skills: SkillManager;
  /**
   * Wall-clock time (ms since epoch) when Cockroach can next save this crawler,
   * or null when it has never fired.
   */
  cockroachReadyAt: number | null = null;
  /**
   * Frames of blanket damage immunity.
   *
   * Separate from {@link isProtected}, which `PlayerManager` recomputes from
   * safe-room membership every single frame and would therefore erase any
   * timed invulnerability written into it.
   */
  invulnerableFrames = 0;
  /** Gold coins collected — displayed in the inventory panel. */
  coins = 0;
  /**
   * Which stat Signet's ink raised, or null if this crawler is still unmarked.
   * One tattoo per character, permanent — carried through building round-trips by
   * PlayerSnapshot so it can't be re-bought by stepping outside and back in.
   */
  tattooStat: StatName | null = null;
  /**
   * The skill Signet's brass mark taught this crawler, or null if unmarked.
   * Tracked separately from {@link tattooStat} so one stat tattoo and one skill
   * tattoo can coexist — but never two of either.
   */
  skillTattoo: SkillId | null = null;
  unspentPoints = 0;
  /** Frames remaining before the next potion can be used. Zero means ready. */
  potionCooldownFrames = 0;

  /** Computed count of health potions across inventory + hotbar. */
  get healthPotions(): number {
    return this.inventory.countOf('health_potion');
  }
  /** When true, incoming damage is ignored (standing in the Safe Room). */
  isProtected = false;
  /** When true, incoming damage is ignored permanently (god mode). */
  godMode = false;
  /** When true, all damage this player deals to mobs is suppressed. */
  zeroDamage = false;
  /** Base speed multiplier (set by god mode, etc.). Combined with potion boost in the getter. */
  private _baseSpeedMultiplier = 1;
  /** Speed multiplier contributed by active Speed Fizz. Reset to 1 on expiry. */
  private _potionSpeedBoost = 1;
  /** Movement speed multiplier — product of base and any active potion boost. */
  get speedMultiplier(): number {
    return this._baseSpeedMultiplier * this._potionSpeedBoost;
  }
  set speedMultiplier(v: number) {
    this._baseSpeedMultiplier = v;
  }
  /** The base speed multiplier before any potion boost is applied. Snapshot this (not speedMultiplier) to avoid baking an active potion boost into the restored base. */
  get baseSpeedMultiplier(): number {
    return this._baseSpeedMultiplier;
  }
  /** The maxHp added by an active Jugg Juice effect — reversed on expiry. */
  private _juggJuiceHpBoost = 0;
  /** Active status effects (Burn, Frozen, Paralyzed, etc.). */
  statusEffects: StatusEffect[] = [];
  /** See {@link nextVisualSeed}. Fixed for this character's whole life. */
  private readonly visualSeed = (nextVisualSeed += VISUAL_SEED_STRIDE);
  /** When true, mob AI treats this player as a defend target and will not attack other targets. */
  isDefendTarget?: boolean;
  /** The last damage source that reduced this player's HP — used to explain the cause of death. */
  lastDamageSource: DamageSource | null = null;
  /** When true, this player has been downed by a fatal blow and awaits revival. */
  isKnockedOut = false;
  /** Frames elapsed since this player was knocked out — used for the 90-second revival timer. */
  knockedOutFrames = 0;
  /** Frames of uninterrupted revival progress (0–300 = 5 seconds). Resets if the reviver moves away. */
  reviveProgress = 0;
  /** Named multipliers applied to HP regen rate. Each entry stacks multiplicatively. */
  private readonly _regenModifiers = new Map<string, number>();
  /** Pending AI stat adjustments that will be reverted after their duration expires. */
  tempStatMods: TempStatMod[] = [];
  protected tileSize: number;

  constructor(tileX: number, tileY: number, tileSize: number, config: PlayerConfig = {}) {
    this.x = tileX * tileSize;
    this.y = tileY * tileSize;
    this.tileSize = tileSize;
    this.baseHpOffset = config.baseHpOffset ?? DEFAULT_BASE_HP_OFFSET;
    this.baseStats = {
      strength: MIN_STAT_VALUE,
      intelligence: MIN_STAT_VALUE,
      constitution: MIN_STAT_VALUE,
      dexterity: MIN_STAT_VALUE,
      ...config.baseStats,
    };
    this.skills = new SkillManager(config.crawlerKind ?? null);
    this._maxHpOverride = config.maxHp ?? null;
    this.hp = this.maxHp;
    this._maxHpAtLastSync = this.maxHp;
    this.inventory.addItem('health_potion', INITIAL_HEALTH_POTIONS);
  }

  get isAlive() {
    return this.hp > 0;
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  /**
   * Effective value of a stat: stored base, plus the bonus from everything
   * currently equipped, plus any live temporary modifiers.
   */
  private effectiveStat(stat: StatName): number {
    let total = this.baseStats[stat] + this.inventory.getEquippedStatBonus()[stat];
    for (const mod of this.tempStatMods) {
      if (mod.stat === stat) total += mod.delta;
    }
    return Math.max(MIN_STAT_VALUE, total + this._godModeStatBonus);
  }

  get strength(): number {
    return this.effectiveStat('strength');
  }

  get intelligence(): number {
    return this.effectiveStat('intelligence');
  }

  /** HP growth stat — displayed as "HP" in the UI, same as health. */
  get constitution(): number {
    return this.effectiveStat('constitution');
  }

  /** Agility stat — drives the chance to dodge an incoming mob attack. */
  get dexterity(): number {
    return this.effectiveStat('dexterity');
  }

  /** Stored value of a stat, before equipment and temporary modifiers. */
  getBaseStat(stat: StatName): number {
    return this.baseStats[stat];
  }

  /**
   * Overwrite a stored stat value. Save restore and migration use this; ordinary
   * gameplay should go through {@link spendPoint} or {@link applyPermanentStat}.
   */
  setBaseStat(stat: StatName, value: number): void {
    this.baseStats[stat] = Math.max(MIN_STAT_VALUE, Math.round(value));
    this.syncHpToMaxHp();
  }

  /**
   * Last step of a save restore: a hook for reconciling stored stats with rules
   * that postdate the save. Base implementation does nothing.
   *
   * @param snapshotVersion Format version of the snapshot being restored, so a
   *   migration can tell an old save from one already written under the rule.
   */
  migrateRestoredStats(snapshotVersion: number): void {
    void snapshotVersion; // nothing to reconcile for a generic player
  }

  /** Queue a System line for the scene to show as a hotbar toast. */
  queueSystemNotice(line: string): void {
    if (this.pendingSystemNotices.length >= MAX_PENDING_SYSTEM_NOTICES) return;
    this.pendingSystemNotices.push(line);
  }

  /**
   * Max HP. Derived for crawlers so equipping, unequipping, refunding or
   * debuffing constitution can never leave a stale total behind; mobs pass a
   * fixed value to the constructor and keep it.
   */
  get maxHp(): number {
    const base =
      this._maxHpOverride ?? this.baseHpOffset + this.constitution * CON_HP_BONUS_PER_POINT;
    return Math.max(1, base + this._juggJuiceHpBoost);
  }

  /**
   * Pins max HP to a fixed value, permanently opting this entity out of the
   * constitution-derived formula.
   *
   * Protected, and deliberately not a `maxHp` setter: one stray assignment on a
   * crawler would silently freeze her max HP forever, which is precisely the
   * drift this model exists to eliminate. Mobs, whose HP is authored per
   * creature rather than derived, are the only legitimate callers.
   */
  protected setFixedMaxHp(value: number): void {
    this._maxHpOverride = Math.max(1, Math.round(value));
    this.syncHpToMaxHp();
  }

  /**
   * Reconcile current HP after max HP moved: the change is applied to current HP
   * one-for-one, in both directions.
   *
   * Both halves are load-bearing, and they have to mirror. Crediting growth
   * alone would make an equip/unequip round trip a free full heal — put the
   * Trollskin Shirt on at 2 HP, take it off, walk away at full — while clamping
   * alone would bleed HP away on every gear swap. Mirroring is also what makes
   * Jugg Juice's expiry actually repay the max-HP loan rather than gifting it.
   */
  syncHpToMaxHp(): void {
    const currentMax = this.maxHp;
    const delta = currentMax - this._maxHpAtLastSync;
    // Both branches skip the downed: a crawler at 0 HP is waiting on a revive,
    // and gearing them up from the companion inventory must not stand them back
    // up. A living one is likewise never dropped to 0 by losing max HP —
    // shedding your own gear should not be a way to die.
    if (this.hp > 0) {
      this.hp = delta > 0 ? this.hp + delta : Math.max(1, this.hp + delta);
    }
    this._maxHpAtLastSync = currentMax;
    if (this.hp > currentMax) this.hp = currentMax;
  }

  /**
   * Called after this player's equipment changed. Stat totals recompute
   * themselves; only current HP has to be reconciled with the new maximum.
   */
  onEquipmentChanged(): void {
    this.syncHpToMaxHp();
  }

  /** Raise or clear the god-mode flat bonus applied to every stat. Pass 0 to clear. */
  setGodModeStatBonus(bonus: number): void {
    this._godModeStatBonus = bonus;
    this.syncHpToMaxHp();
  }

  /**
   * @returns whether the attack connected. False when it was dodged, or when the
   *   safe room, god mode, a knockout or i-frames swallowed it — attackers use
   *   this to hold back the status riders they apply alongside their damage, so a
   *   `MISS!` does not come with a helping of poison.
   */
  takeDamage(amount: number, source?: DamageSource): boolean {
    if (amount <= 0 || this.isProtected || this.godMode || this.isKnockedOut) return false;
    if (this.invulnerableFrames > 0) return false;
    // Only a swung, thrown or bitten attack can be dodged. Status ticks, your own
    // dynamite, standing damage fields and the doomsday clock all land regardless.
    if (source?.kind === 'mob' && source.undodgeable !== true && this.rollDodge()) {
      this.onDodged();
      return false;
    }
    const hpBeforeBlow = this.hp;
    const remainingHp = Math.max(0, this.hp - amount);
    this.damageFlash = DAMAGE_FLASH_FRAMES;
    // Every route into this method refreshes the counter, which is what makes a
    // damage-over-time effect hold regen off for as long as it is burning
    // rather than only on the frame it was applied.
    this.framesSinceDamaged = 0;
    if (source !== undefined) this.lastDamageSource = source;
    // Deliberately *before* hp is written: every death check in the game reads hp
    // after takeDamage returns, so absorbing the blow here means neither the
    // game-over check nor the companion knockout path ever sees a dead crawler.
    if (remainingHp === 0 && this.tryCockroach()) {
      this.pendingDamageTaken += hpBeforeBlow - this.hp;
      return true;
    }
    this.hp = remainingHp;
    this.pendingDamageTaken += hpBeforeBlow - remainingHp;
    return true;
  }

  /**
   * Whether passive regeneration is currently held off by a recent wound.
   *
   * Never true inside a safe room: recovery between fights is meant to stay
   * free, and a party that has just retreated to one is precisely the party the
   * suppression window would otherwise punish for nothing.
   */
  get isRegenSuppressed(): boolean {
    return !this.isProtected && this.framesSinceDamaged < REGEN_SUPPRESS_FRAMES;
  }

  /**
   * Cockroach: the crawler walks away from a fatal blow at 1 HP, then the skill
   * goes cold for a few minutes.
   *
   * The recharge is a wall-clock deadline, not a frame counter, because scenes
   * are rebuilt from scratch on every floor change and building doorway — a
   * frame counter would reset itself every time the player stepped indoors.
   *
   * @returns whether the skill absorbed the blow.
   */
  private tryCockroach(): boolean {
    if (!this.skills.isUnlocked('cockroach')) return false;
    if (this.cockroachReadyAt !== null && Date.now() < this.cockroachReadyAt) return false;

    this.hp = 1;
    this.invulnerableFrames = COCKROACH_IFRAME_FRAMES;
    this.skills.recordTrigger('cockroach');
    // Credit the use before reading the level back: surviving is how the skill
    // trains, and a level gained on this very blow should shorten this recharge.
    this.skills.recordUse('cockroach');
    this.cockroachReadyAt = Date.now() + cockroachRechargeMs(this.skills.getLevel('cockroach'));
    this.queueFloatingText('COCKROACH!', 'trigger');
    return true;
  }

  /** True once Cockroach has finished recharging (or was never spent). */
  get isCockroachReady(): boolean {
    return this.cockroachReadyAt === null || Date.now() >= this.cockroachReadyAt;
  }

  /** How far through the recharge Cockroach is, 0–1. Returns 1 when ready. */
  cockroachRechargeFraction(): number {
    if (this.cockroachReadyAt === null) return 1;
    const total = cockroachRechargeMs(this.skills.getLevel('cockroach'));
    const remaining = this.cockroachReadyAt - Date.now();
    if (remaining <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - remaining / total));
  }

  /**
   * Whether this entity's dexterity translates into dodging. Off by default so
   * mobs and NPCs never dodge the player's attacks; the two crawlers opt in.
   */
  protected get canDodge(): boolean {
    return false;
  }

  /** Flat dodge chance from skills, added on top of the dexterity curve. */
  protected get dodgeFlatBonus(): number {
    return 0;
  }

  /** The chance this player has of dodging the next mob attack, 0–1. */
  get dodgeChance(): number {
    if (!this.canDodge) return 0;
    return computeDodgeChance(this.dexterity, this.dodgeFlatBonus);
  }

  private rollDodge(): boolean {
    if (!this.canDodge) return false;
    return Math.random() < this.dodgeChance;
  }

  /** Feedback (and, for the cat, skill progress) for a dodge that just landed. */
  protected onDodged(): void {
    this.pendingDodges++;
    this.queueFloatingText('MISS!', 'miss');
  }

  /**
   * Queue a world-anchored feedback label for `FloatingCombatTextSystem` to draw.
   * Bounded because scenes without that system (non-combat interiors) never drain it.
   */
  queueFloatingText(text: string, style: FloatingTextStyle): void {
    if (this.pendingFloatingText.length >= MAX_PENDING_FLOATING_TEXT) return;
    this.pendingFloatingText.push({ text, style });
  }

  /** Returns the potion cooldown in frames for the current constitution level. */
  computePotionCooldown(): number {
    const rechargeNumerator = NUMERATOR_ASYMPTOTE_SLOPE * this.constitution;
    const rechargeDenominator = this.constitution + DENOMINATOR_OFFSET;
    const cooldownReduction = rechargeNumerator / rechargeDenominator;
    const cooldownSeconds = DEFAULT_POTION_COOLDOWN_SECONDS - cooldownReduction;
    return Math.max(1, Math.round(cooldownSeconds * FRAMES_PER_SECOND * this.ironStomachTimeScale));
  }

  /**
   * Multiplier Iron Stomach applies to anything a crawler swallows: potion
   * cooldowns and how long a drink keeps the room spinning. 1 when unlearned.
   */
  get ironStomachTimeScale(): number {
    const level = this.skills.getLevel('iron_stomach');
    if (level === 0) return 1;
    return Math.max(
      MIN_IRON_STOMACH_TIME_SCALE,
      1 - IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL * level,
    );
  }

  /**
   * Credit an Iron Stomach use. Called from every place a crawler swallows
   * something — potions, Bopca dishes, tavern rounds — so the skill trains on
   * the whole habit rather than one source.
   */
  recordSwallowed(): void {
    this.skills.recordUse('iron_stomach');
  }

  /**
   * Drink a health potion — heals 50 % of max HP. Returns false if none
   * available, already at full HP, or on cooldown.
   *
   * @param consume Removes the bottle. Defaults to the first copy anywhere in
   *   the pack, which is what a keybind or an auto-drink wants; a click on one
   *   particular stack passes a slot-scoped remover so that stack is the one
   *   that goes down.
   */
  usePotion(consume: () => boolean = () => this.inventory.removeOne('health_potion')): boolean {
    if (this.hp >= this.maxHp) return false;
    if (this.potionCooldownFrames > 0) return false;
    if (!consume()) return false;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * POTION_HEAL_FRACTION));
    this.potionCooldownFrames = this.computePotionCooldown();
    this.recordSwallowed();
    return true;
  }

  /** Total XP required to advance from the current level to the next. */
  get xpNeededForNextLevel(): number {
    return this.level * XP_PER_LEVEL_MULTIPLIER;
  }

  /** XP still missing before the next level-up fires. */
  get xpRemainingToNextLevel(): number {
    return Math.max(0, this.xpNeededForNextLevel - this.xp);
  }

  /**
   * Who should be credited with damage this entity deals.
   *
   * Almost always itself. A summon points it at its owner, so a pet can attack
   * in its own name — which is what makes mobs retaliate against the pet rather
   * than against the player standing behind it — without the kill XP quietly
   * going to a creature that has no XP bar.
   *
   * A field rather than an overridable getter returning `this`: the credit
   * target of a summon is a *different* Player, not a narrower one, so a `this`
   * return type would be actively wrong.
   */
  protected creditTarget: Player = this;

  get xpCreditTarget(): Player {
    return this.creditTarget;
  }

  gainXp(amount: number): boolean {
    if (amount <= 0) return false;
    this.xp += amount;
    const xpNeeded = this.xpNeededForNextLevel;
    if (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      this.unspentPoints++;
      this.levelUpStat = 'POINT';
      this.levelUpFlash = LEVEL_UP_FLASH_FRAMES;
      return true;
    }
    return false;
  }

  /**
   * Consume one unspent level-up point and flash the given stat label.
   * Returns false (spending nothing) when no points are banked.
   */
  protected consumePointFor(statLabel: string): boolean {
    if (this.unspentPoints <= 0) return false;
    this.unspentPoints--;
    this.levelUpStat = statLabel;
    this.levelUpFlash = SPEND_POINT_FLASH_FRAMES;
    return true;
  }

  /**
   * Whether a banked level-up point may be invested in `stat`.
   *
   * Only *spending* is gated. Equipment `statBonus`, stat-boost potions and
   * Signet's tattoos all still raise a locked stat through
   * {@link applyPermanentStat} — the lock models the System refusing an
   * allocation, not the attribute being frozen in place.
   */
  canSpendPointInto(stat: StatName): boolean {
    void stat; // every stat is open unless a subclass says otherwise
    return true;
  }

  spendPoint(stat: StatName): void {
    if (!this.canSpendPointInto(stat)) return;
    if (!this.consumePointFor(STAT_CODE[stat])) return;
    this.baseStats[stat]++;
    this.syncHpToMaxHp();
  }

  /** Liquid courage: a drunk crawler swings harder even as the room tilts. */
  get drunkDamageBonus(): number {
    return this.hasStatus('drunk') ? DRUNK_MELEE_DAMAGE_BONUS : 0;
  }

  /**
   * The Desperado Club's signature, drunk from the bag: a quarter of your health
   * back and the liquid courage that comes with it.
   *
   * It lives here rather than in a scene branch because both the dungeon and the
   * building interiors let you drink one, and a house special that heals
   * differently depending on which room you are standing in is a bug waiting to
   * be reported.
   */
  drinkDirtyShirley(): void {
    this.recordSwallowed();
    this.applyStatus(makeDrunk(this.ironStomachTimeScale));
    const healed = this.hp + Math.round(this.maxHp * DIRTY_SHIRLEY_HEAL_FRACTION);
    this.hp = Math.min(this.maxHp, healed);
  }

  /**
   * Whether a Dirty Shirley would do anything at all — there is something to
   * mend, or the courage is not already running.
   *
   * Asked before the bottle is spent rather than folded into the swallow, so the
   * two can be ordered consume-then-effect: an effect applied ahead of a consume
   * that then fails is a free drink for the rest of the run.
   */
  get dirtyShirleyWouldHelp(): boolean {
    return this.hp < this.maxHp || !this.hasStatus('drunk');
  }

  /**
   * Puts this crawler back on their feet at full health.
   *
   * Writing `hp = maxHp` is not enough on its own: a knocked-out crawler stays
   * knocked out at any HP, so a service that advertises mending the pair would
   * otherwise take the coin and leave the companion face-down at full health.
   */
  reviveToFull(): void {
    this.isKnockedOut = false;
    this.knockedOutFrames = 0;
    this.reviveProgress = 0;
    this.hp = this.maxHp;
  }

  /** The Rusty Anvil's edge, for as long as it holds. */
  get whetstoneDamageBonus(): number {
    return this.hasStatus('whetstone') ? WHETSTONE_MELEE_DAMAGE_BONUS : 0;
  }

  /**
   * Every melee bonus that comes from a temporary status. Subclasses add this to
   * their own damage rather than each status separately, so a new one lands in
   * both crawlers' swings at once.
   */
  get statusMeleeDamageBonus(): number {
    return this.drunkDamageBonus + this.whetstoneDamageBonus;
  }

  /**
   * Removes every listed status, returning how many were actually cleared —
   * the apothecary charges only for a cure that had something to cure.
   *
   * Routed through the same expiry cleanup as `clearStatusEffects`, so a status
   * that loans the player something (Jugg Juice's max HP, Speed Fizz's
   * multiplier) still pays it back if a caller ever names one.
   */
  cureStatuses(types: ReadonlyArray<string>): number {
    const kept: StatusEffect[] = [];
    let cleared = 0;
    for (const effect of this.statusEffects) {
      if (!types.includes(effect.type)) {
        kept.push(effect);
        continue;
      }
      cleared++;
      if (effect.type === 'speed_fizz') {
        this._potionSpeedBoost = 1;
      }
      if (effect.type === 'jugg_juice') {
        this._juggJuiceHpBoost = 0;
      }
    }
    if (cleared === 0) return 0;
    this.statusEffects = kept;
    this.syncHpToMaxHp();
    return cleared;
  }

  /** Returns true if the player currently has the given status active. */
  hasStatus(type: string): boolean {
    // A plain loop rather than `some`: this is called several times per entity
    // per frame, almost always over an empty list, and the closure was the only
    // allocation in the whole call.
    for (const effect of this.statusEffects) {
      if (effect.type === type) return true;
    }
    return false;
  }

  /**
   * Apply a status effect. If the same type is already active it is refreshed
   * (replaced) rather than stacked.
   */
  applyStatus(effect: StatusEffect) {
    const idx = this.statusEffects.findIndex((e) => e.type === effect.type);
    if (idx >= 0) {
      this.statusEffects[idx] = effect;
    } else {
      this.statusEffects.push(effect);
    }
  }

  /**
   * Advance all active status effects by one tick and apply their per-tick
   * behaviour. Called automatically from tickTimers().
   *
   * Per-type rules:
   *   burn  — 1 damage every 60 ticks (1 /second); 8 hits over 480 ticks.
   *   (future: frozen → block movement in scene; paralyzed → block all input)
   */
  private tickStatusEffects() {
    if (this.statusEffects.length === 0) return;
    // Compacted in place with a write cursor rather than a fresh filtered array:
    // an entity with no effects — which is most entities on most frames — costs
    // nothing, and the common one-or-two case allocates neither array nor
    // closure. Forward order matters: several effects can damage on the same
    // tick, and the last one to land owns the death cause.
    let kept = 0;
    for (const effect of this.statusEffects) {
      const elapsed = effect.totalTicks - effect.ticksRemaining;
      if (effect.type === 'burn' && elapsed > 0 && elapsed % BURN_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'burn', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'poison' && elapsed > 0 && elapsed % POISON_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'poison', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'sepsis' && elapsed > 0 && elapsed % SEPSIS_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'sepsis', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'magic_burn' && elapsed > 0 && elapsed % MAGIC_BURN_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'magic_burn', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      if (
        effect.type === 'electrified' &&
        elapsed > 0 &&
        elapsed % ELECTRIFIED_TICK_INTERVAL === 0
      ) {
        this.takeDamage(1, { kind: 'status', effectType: 'electrified', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'spit_venom' && elapsed > 0 && elapsed % SPIT_VENOM_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'spit_venom', applier: effect.applier });
        this.effectDamageSoundPending = true;
      }
      effect.ticksRemaining--;
      const justExpired = effect.ticksRemaining < 0;
      if (justExpired && effect.type === 'speed_fizz') {
        this._potionSpeedBoost = 1;
      }
      if (justExpired && effect.type === 'jugg_juice') {
        this._juggJuiceHpBoost = 0;
        this.syncHpToMaxHp();
      }
      if (effect.ticksRemaining >= 0) {
        this.statusEffects[kept] = effect;
        kept++;
      }
    }
    this.statusEffects.length = kept;
  }

  /** Extra max HP the active Jugg Juice is contributing, or 0 when none is active. */
  get juggJuiceHpBoost(): number {
    return this._juggJuiceHpBoost;
  }

  /**
   * Reinstate serialised status effects on a freshly-built player (see
   * `PlayerSnapshot`). The two effects that hold state outside the effect record —
   * Speed Fizz's speed multiplier and Jugg Juice's max-HP loan — are re-derived
   * here, because without them the buff would either do nothing or, worse, never
   * be paid back when it expires.
   */
  restoreStatusEffects(effects: ReadonlyArray<StatusEffect>, juggJuiceHpBoost: number): void {
    this.clearStatusEffects();
    for (const effect of effects) this.statusEffects.push({ ...effect });
    this._potionSpeedBoost = this.hasStatus('speed_fizz') ? SPEED_FIZZ_MULTIPLIER : 1;
    // Screened like every other restored numeric: this one feeds max HP directly,
    // so a non-finite value from a save would make the whole stat block NaN.
    const boost = Number.isFinite(juggJuiceHpBoost) ? Math.max(0, juggJuiceHpBoost) : 0;
    this._juggJuiceHpBoost = this.hasStatus('jugg_juice') ? boost : 0;
    this.syncHpToMaxHp();
  }

  /**
   * Clears all active status effects, running any necessary expiry cleanup first.
   * Use this instead of assigning statusEffects = [] directly so that effects like
   * Jugg Juice (which mutates maxHp) are properly reversed.
   */
  clearStatusEffects(): void {
    for (const effect of this.statusEffects) {
      if (effect.type === 'speed_fizz') {
        this._potionSpeedBoost = 1;
      }
      if (effect.type === 'jugg_juice') {
        this._juggJuiceHpBoost = 0;
        this.syncHpToMaxHp();
      }
    }
    this.statusEffects = [];
  }

  /** Register (or overwrite) a named regen bonus. Value is a multiplier where 1 = no effect; bonuses above 1 stack additively. */
  setRegenModifier(key: string, multiplier: number): void {
    this._regenModifiers.set(key, multiplier);
  }

  /** Remove a named regen bonus. No-op if the key was never set. */
  clearRegenModifier(key: string): void {
    this._regenModifiers.delete(key);
  }

  /**
   * Clears combat/consumable state that `PlayerSnapshot` does not cover: temporary
   * stat mods, potion and i-frame timers, named regen modifiers, and the last
   * damage source. Used when restoring to a checkpoint, where nothing from the
   * encounter that killed the player should carry over.
   */
  clearTransientCombatState(): void {
    this.tempStatMods.length = 0;
    this.potionCooldownFrames = 0;
    this.invulnerableFrames = 0;
    this._regenModifiers.clear();
    this.lastDamageSource = null;
    // A party restored to a checkpoint is out of the fight that wounded it, so
    // it must not spend the next five seconds unable to heal from a blow that
    // has been rewound out of existence.
    this.framesSinceDamaged = REGEN_SUPPRESS_FRAMES;
  }

  /** Returns the combined HP regen rate multiplier from all equipped gear and active modifiers.
   *  Item modifiers stack multiplicatively; _regenModifiers bonuses (value − 1) stack additively on top. */
  get regenMultiplier(): number {
    let result = 1;
    for (const item of this.inventory.equippedItems()) {
      const m = item.regenMultiplier;
      if (m !== undefined) result *= m;
    }
    for (const m of this._regenModifiers.values()) {
      result += m - 1;
    }
    return result;
  }

  /**
   * How many extra cooldown ticks to consume per frame.
   * Returns 2 while Cooldown Crisp is active (halving effective cooldown time), 1 normally.
   */
  get abilitySpeedMultiplier(): number {
    return this.hasStatus('cooldown_crisp') ? 2 : 1;
  }

  /**
   * Decrement a cooldown counter by one tick per frame, or by two if Cooldown Crisp is active.
   * Use this instead of manual `counter--` wherever ability speed should affect the timer.
   */
  tickCooldown(current: number): number {
    if (current <= 0) return current;
    const decremented = current - 1;
    return this.abilitySpeedMultiplier > 1 && decremented > 0 ? decremented - 1 : decremented;
  }

  /** Activate Speed Fizz: doubles movement speed for 25 seconds. */
  activateSpeedFizz(): void {
    this._potionSpeedBoost = SPEED_FIZZ_MULTIPLIER;
    this.applyStatus(makeSpeedFizz());
  }

  /** Activate Jugg Juice: boosts max HP by 50% + 5 and heals to full for 30 seconds. */
  activateJuggJuice(): void {
    // Read maxHp before the boost is stored — the getter already includes it.
    const boost = Math.round(this.maxHp * JUGG_JUICE_HP_MULTIPLIER_BONUS + JUGG_JUICE_FLAT_BONUS);
    this._juggJuiceHpBoost = boost;
    this.syncHpToMaxHp();
    this.hp = this.maxHp;
    this.applyStatus(makeJuggJuice());
  }

  /** Activate Cooldown Crisp: halves all ability cooldowns for 25 seconds. */
  activateCooldownCrisp(): void {
    this.applyStatus(makeCooldownCrisp());
  }

  /**
   * Permanently raise one stat, flashing the same feedback a spent level-up point
   * does. Shared by the stat-boost potion and Signet's tattoos.
   */
  applyPermanentStat(stat: StatName, amount: number): void {
    this.baseStats[stat] += amount;
    this.levelUpStat = STAT_CODE[stat];
    this.levelUpFlash = SPEND_POINT_FLASH_FRAMES;
    this.syncHpToMaxHp();
  }

  /**
   * Permanently boost a randomly chosen stat by 2–4 points.
   *
   * @returns which stat won and by how much, so the caller can tell the player —
   *   the roll happens in here and is not recoverable from the result.
   */
  applyStatBoost(): { stat: StatName; amount: number } {
    const stat = ALL_STATS[Math.floor(Math.random() * ALL_STATS.length)];
    const amount = STAT_BOOST_MIN + Math.floor(Math.random() * STAT_BOOST_RANGE);
    this.applyPermanentStat(stat, amount);
    return { stat, amount };
  }

  tickTimers() {
    // Held at the ceiling rather than counted forever: the only question anyone
    // asks of it is whether it has reached that value.
    if (this.framesSinceDamaged < REGEN_SUPPRESS_FRAMES) this.framesSinceDamaged++;
    if (this.invulnerableFrames > 0) this.invulnerableFrames--;
    if (this.levelUpFlash > 0) this.levelUpFlash--;
    if (this.damageFlash > 0) this.damageFlash--;
    this.potionCooldownFrames = this.tickCooldown(this.potionCooldownFrames);
    if (this.isMoving) {
      this.walkFrame = (this.walkFrame + this.walkFrameSpeed) % (Math.PI * 2);
    } else {
      this.walkFrame = 0;
    }
    this.tickStatusEffects();
    this.tickTempStatMods();
  }

  /**
   * Age out expired temporary stat modifiers. Nothing needs un-applying: the
   * effective getters read this list live, so dropping an entry *is* the revert.
   */
  private tickTempStatMods() {
    if (this.tempStatMods.length === 0) return;
    let kept = 0;
    for (const mod of this.tempStatMods) {
      mod.ticksRemaining--;
      if (mod.ticksRemaining > 0) {
        this.tempStatMods[kept] = mod;
        kept++;
      }
    }
    const expiredAny = kept !== this.tempStatMods.length;
    this.tempStatMods.length = kept;
    if (expiredAny) this.syncHpToMaxHp();
  }

  /**
   * Draw this character's own art. Subclasses implement this instead of
   * `render` so hit feedback can be shaped by whatever they draw.
   */
  protected abstract drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void;

  /**
   * Draw the character, painting hit feedback and status effects through its own
   * silhouette so both land on the figure rather than on its tile.
   *
   * The two share a single composite pass on purpose: running them separately
   * would draw the character twice, and the second pass would overwrite the
   * first — a burning crawler would stop flashing when hit.
   *
   * Sealed: a subclass that overrode this would opt itself out of both without
   * saying so. Subclasses override {@link drawSelf}.
   */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.x - camX;
    const sy = this.y - camY;

    // Checked before building anything: the overwhelming majority of characters
    // on screen are neither hurt nor afflicted, and a town crowd would otherwise
    // allocate a layer array per citizen per frame to discover it is empty.
    const needsComposite =
      (this.wearsStatusPaint && this.statusEffects.length > 0) || this.hitFlashProgress() > 0;
    const layers = needsComposite ? this.silhouetteLayers(sx, sy, tileSize) : [];

    if (layers.length === 0) {
      this.drawSelf(ctx, camX, camY, tileSize);
    } else {
      const margin = this.silhouetteMarginTiles * tileSize;
      const bounds = {
        x: sx - margin,
        y: sy - margin,
        width: tileSize + margin * 2,
        height: tileSize + margin * 2,
      };
      drawWithSilhouetteLayers(ctx, bounds, layers, (target) =>
        this.drawSelf(target, camX, camY, tileSize),
      );
    }

    // Deliberately outside the composite. Anything drawn inside it becomes part
    // of the silhouette every layer is masked by — so flames drawn in there
    // would be repainted by their own body coat, wear the rim meant for the
    // character's outline, turn red under a hit flash, and be clipped to the
    // composite's box mid-plume.
    this.drawWorldFeedback(ctx, sx, sy);
  }

  /**
   * Whether this character still shows the statuses it is carrying.
   *
   * The single predicate for both halves of a status: the coats painted through
   * the silhouette *and* the art drawn in the world. Splitting them is how you
   * get a corpse washed in a full-strength fire glow with no flames anywhere
   * near it — worse than either half alone.
   */
  protected get wearsStatusPaint(): boolean {
    return true;
  }

  /**
   * Feedback that belongs in the world rather than on the character: status
   * effects, and whatever a subclass stacks above them.
   */
  protected drawWorldFeedback(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    if (!this.wearsStatusPaint) return;
    this.renderStatusEffects(ctx, sx, sy);
  }

  /** Every coat of paint this character's shape is wearing this frame. */
  private silhouetteLayers(sx: number, sy: number, tileSize: number): SilhouetteLayer[] {
    // Status coats go on first so a fresh hit still reads red over the top of
    // them, which is the one piece of feedback the player cannot afford to miss.
    const layers = this.wearsStatusPaint
      ? statusBodyLayers(this.statusEffects, (effect) =>
          this.statusFrameAt(effect, sx, sy, tileSize),
        )
      : [];
    const flash = hitFlashLayer(this.hitFlashProgress());
    if (flash !== null) layers.push(flash);
    return layers;
  }

  /**
   * 1 on the frame of impact, falling to 0 as the flash expires.
   *
   * Capped, because several attacks set a longer flash than the standard hit —
   * those read as a flash that holds, not as one that burns brighter.
   */
  protected hitFlashProgress(): number {
    if (this.damageFlash <= 0) return 0;
    return Math.min(1, this.damageFlash / DAMAGE_FLASH_FRAMES);
  }

  /**
   * How far past its own tile this character's art reaches, in tiles. The hit
   * flash is composited through a box this size, so art beyond it is cut out of
   * the flash — mobs answer with their own cull margin.
   */
  protected get hitFlashMarginTiles(): number {
    return PLAYER_HIT_FLASH_MARGIN_TILES;
  }

  followTarget(targetX: number, targetY: number, speed: number, minDist: number) {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      this.isMoving = false;
      return;
    }
    const step = Math.min(speed, dist - minDist);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    this.isMoving = true;
  }

  protected renderHealthBar(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    const barW = this.tileSize;
    const barH = HP_BAR_HEIGHT;
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(sx, sy - HP_BAR_Y_OFFSET, barW, barH);
    ctx.fillStyle =
      ratio > HP_BAR_GREEN_THRESHOLD
        ? '#4ade80'
        : ratio > HP_BAR_YELLOW_THRESHOLD
          ? '#facc15'
          : '#ef4444';
    ctx.fillRect(sx, sy - HP_BAR_Y_OFFSET, Math.ceil(barW * ratio), barH);
  }

  /**
   * How far past its tile the composite's box reaches, in tiles.
   *
   * Separate from {@link hitFlashMarginTiles} because the two answer different
   * questions now. A hit flash lasts a few frames, so art clipped at its edge
   * flickers and is forgiven. A status lasts seconds to minutes, and everything
   * `drawSelf` draws outside this box — including attack telegraphs, which some
   * bosses draw there — is cut off with a straight edge for that whole time.
   * Anything whose `drawSelf` reaches further than its flash margin must widen
   * this or lose the difference while it is burning.
   */
  protected get silhouetteMarginTiles(): number {
    return this.hitFlashMarginTiles;
  }

  /**
   * The box this character's drawn figure occupies, in tile fractions measured
   * from its own tile: `top`/`bottom` down from the tile's top edge, `halfWidth`
   * out from `centerX`.
   *
   * Overridden by anything whose art is not tile-shaped. The default is the tile
   * itself, which is right for the majority of mobs and merely conservative for
   * the rest — a status on an over-large figure stays inside it rather than
   * spilling off, which is the failure worth having.
   */
  protected get statusFigureBox(): StatusFigureBox {
    return TILE_FIGURE_BOX;
  }

  /** Builds the paint description for one status effect on this character. */
  private statusFrameAt(
    effect: StatusEffect,
    sx: number,
    sy: number,
    size: number,
  ): StatusVisualFrame {
    const figure = this.statusFigureBox;
    return {
      centerX: sx + figure.centerX * size,
      footY: sy + figure.bottom * size,
      width: figure.halfWidth * 2 * size,
      height: (figure.bottom - figure.top) * size,
      timeMs: Date.now(),
      seed: this.visualSeed,
      fade: statusFade(effect),
      moving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
    };
  }

  /**
   * Draws the world-space half of every active status effect — flames, silk,
   * arcs, drips. The half that paints the character's own art is contributed by
   * {@link silhouetteLayers} instead, because it has to reach the compositor
   * before the sprite is drawn.
   */
  protected renderStatusEffects(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.statusEffects.length === 0) return;
    ctx.save();
    for (const effect of this.statusEffects) {
      const overlay = statusVisual(effect.type)?.overlay;
      if (overlay === undefined) continue;
      overlay(ctx, this.statusFrameAt(effect, sx, sy, this.tileSize));
      // Each overlay is free to leave alpha and blend mode wherever it landed;
      // resetting between them is cheaper than making every one of them tidy up.
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /** Draws an unconscious overlay when this player is in the knocked-out state. */
  protected renderKnockedOutOverlay(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    if (!this.isKnockedOut) return;
    const s = this.tileSize;
    const cx = sx + s / 2;
    const t = Date.now();
    const pulse = HALF + HALF * Math.sin(t * KO_PULSE_SPEED);

    ctx.save();

    // Dark desaturating overlay
    ctx.globalAlpha = KO_OVERLAY_ALPHA;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sx, sy, s, s);

    // Pulsing red ring
    ctx.globalAlpha = KO_RING_ALPHA_BASE + KO_RING_ALPHA_RANGE * pulse;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = KO_RING_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(
      cx,
      sy + s / 2,
      s * (KO_RING_BASE_FRACTION + KO_RING_PULSE_FRACTION * pulse),
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    // Badge above the tile: "Reviving" while being revived, "KO" otherwise
    const isReviving = this.reviveProgress > 0;
    const label = isReviving ? 'Reviving' : 'KO';
    const fontSize = Math.round(s * (isReviving ? KO_FONT_REVIVING_FRACTION : KO_FONT_KO_FRACTION));
    drawText(ctx, label, {
      x: cx,
      y: sy - fontSize - KO_LABEL_Y_PADDING,
      align: 'center',
      size: fontSize,
      bold: true,
      color: isReviving ? '#ffffff' : '#ef4444',
      outline: true,
    });

    ctx.restore();
  }
}
