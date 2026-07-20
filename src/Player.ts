import type { StatusEffect } from './core/StatusEffect';
import { makeSpeedFizz, makeJuggJuice, makeCooldownCrisp } from './core/StatusEffect';
import { Inventory } from './core/Inventory';
import type { InventoryItem } from './core/ItemDefs';
import { drawText } from './ui/TextBox';

/**
 * Describes what caused a damage event. Stored as `lastDamageSource` on the player
 * so the death screen can explain how the player died.
 */
export type DamageSource =
  | { readonly kind: 'mob'; readonly mobType: string; readonly attackType?: string }
  | { readonly kind: 'status'; readonly effectType: string }
  | { readonly kind: 'dynamite' }
  | { readonly kind: 'environmental' }
  | { readonly kind: 'doomsday' };

const DEFAULT_POTION_COOLDOWN_SECONDS = 5.75;
const DENOMINATOR_OFFSET = 30;
const NUMERATOR_ASYMPTOTE_SLOPE = 3;

const INITIAL_HEALTH_POTIONS = 10;
const DEFAULT_MAX_HP = 10;
const DAMAGE_FLASH_FRAMES = 8;
const LEVEL_UP_FLASH_FRAMES = 120;
const SPEND_POINT_FLASH_FRAMES = 60;
const XP_PER_LEVEL_MULTIPLIER = 10;
const CON_HP_BONUS_PER_POINT = 2;
const POTION_HEAL_FRACTION = 0.5;
const FRAMES_PER_SECOND = 60;

/** Tick intervals (in ticks) for each status effect type */
const BURN_TICK_INTERVAL = 60;
const POISON_TICK_INTERVAL = 120;
const SEPSIS_TICK_INTERVAL = 120;
const MAGIC_BURN_TICK_INTERVAL = 60;
const ELECTRIFIED_TICK_INTERVAL = 60;
const SPIT_VENOM_TICK_INTERVAL = 40;

/** Walk animation speed constant */
const WALK_FRAME_SPEED = 0.14;

/** Potion effect constants */
const SPEED_FIZZ_MULTIPLIER = 2;
const JUGG_JUICE_HP_MULTIPLIER_BONUS = 0.5;
const JUGG_JUICE_FLAT_BONUS = 5;
const STAT_BOOST_MIN = 2;
const STAT_BOOST_RANGE = 3;
const STAT_BOOST_STAT_COUNT = 3;

/** Health bar display thresholds */
const HP_BAR_GREEN_THRESHOLD = 0.5;
const HP_BAR_YELLOW_THRESHOLD = 0.25;
const HP_BAR_HEIGHT = 4;
const HP_BAR_Y_OFFSET = 7;

/** Damage flash visual parameters */
const DAMAGE_FLASH_ALPHA_MULTIPLIER = 0.55;

/** Burn visual parameters */
const BURN_OUTER_FLAME_Y_OFFSET = 7;
const BURN_OUTER_FLAME_RADIUS_X = 5;
const BURN_OUTER_FLAME_RADIUS_Y = 7;
const BURN_INNER_FLAME_Y_OFFSET = 11;
const BURN_INNER_FLAME_RADIUS_X = 3;
const BURN_INNER_FLAME_RADIUS_Y = 4;
const BURN_PULSE_SPEED = 0.009;
const BURN_FLICKER_SPEED = 0.022;
const BURN_FLICKER_AMP = 2.5;
const BURN_ALPHA_BASE = 0.75;
const BURN_ALPHA_RANGE = 0.25;
const BURN_GLOW_MIN_SIZE = 6;
const BURN_GLOW_PULSE_RANGE = 5;
const BURN_INNER_X_FRACTION = 0.5;

/** Poison visual parameters */
const POISON_DRIFT_SPEED = 0.025;
const POISON_BUBBLE_COUNT = 3;
const POISON_PHASE_SPACING = 2.09;
const POISON_ORBIT_RADIUS = 4.5;
const POISON_Y_OFFSET = 7;
const POISON_Y_STEP = 4.5;
const POISON_RETRACT_SPEED = 0.5;
const POISON_MAX_RADIUS = 2.8;
const POISON_RADIUS_SHRINK = 0.5;
const POISON_ALPHA_BASE = 0.7;
const POISON_ALPHA_RANGE = 0.3;
const POISON_SHADOW_BLUR = 5;
const POISON_WAVE_AMP = 3;

/** Stuck visual parameters */
const STUCK_PULSE_BASE = 0.65;
const STUCK_PULSE_RANGE = 0.35;
const STUCK_ALPHA_PULSE_SPEED = 0.008;
const STUCK_STRAND_COUNT = 6;
const STUCK_LINE_WIDTH = 1.5;
const STUCK_INNER_RING_ALPHA = 0.3;
const STUCK_RING_FRACTION = 0.55;
const STUCK_WAVE_SPEED = 0.006;
const STUCK_INNER_RADIUS = 0.3;
const STUCK_OUTER_BASE_FRACTION = 0.62;
const STUCK_WAVE_AMP = 3;
const STUCK_ORBIT_SPEED = 0.001;

/** Spit venom visual parameters */
const SPIT_DROP_COUNT = 5;
const SPIT_DRIFT_SPEED = 0.003;
const SPIT_PHASE_STEP = 1.26;
const SPIT_WAVE_X_FREQ = 2.3;
const SPIT_ORBIT_FRACTION = 0.28;
const SPIT_DROP_SCROLL_SPEED = 0.04;
const SPIT_DROP_SPACING = 14;
const SPIT_DROP_SCROLL_RANGE = 18;
const SPIT_ALPHA_BASE = 0.5;
const SPIT_ALPHA_RANGE = 0.5;
const SPIT_ALPHA_OUTER = 0.75;
const SPIT_RADIUS_X = 2.2;
const SPIT_RADIUS_Y = 3.5;

/** Sepsis visual parameters */
const SEPSIS_DRIFT_SPEED = 0.02;
const SEPSIS_BUBBLE_COUNT = 4;
const SEPSIS_PHASE_SPACING = 1.57;
const SEPSIS_ORBIT_RADIUS = 5.5;
const SEPSIS_Y_OFFSET = 6;
const SEPSIS_Y_STEP = 3.5;
const SEPSIS_RETRACT_SPEED = 0.7;
const SEPSIS_MAX_RADIUS = 2.5;
const SEPSIS_RADIUS_SHRINK = 0.35;
const SEPSIS_PULSE_SPEED = 0.005;
const SEPSIS_ALPHA_BASE = 0.6;
const SEPSIS_ALPHA_RANGE = 0.4;
const SEPSIS_SHADOW_BLUR = 4;

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
  maxHp: number;
  xp = 0;
  level = 1;
  strength = 1;
  intelligence = 1;
  /** HP growth stat — displayed as "HP" in the UI, same as health. */
  constitution = 1;
  levelUpStat: string | null = null;
  levelUpFlash = 0;
  damageFlash = 0;
  isMoving = false;
  walkFrame = 0;
  /** Set when a status effect deals a damage tick; DungeonScene reads and clears it to play the sound. */
  effectDamageSoundPending = false;
  /** Shared inventory for this player (separate from the other player's). */
  readonly inventory = new Inventory();
  /** Gold coins collected — displayed in the inventory panel. */
  coins = 0;
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
  tempStatMods: Array<{
    ticksRemaining: number;
    stat: 'strength' | 'intelligence' | 'constitution';
    delta: number;
  }> = [];
  protected tileSize: number;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp = DEFAULT_MAX_HP) {
    this.x = tileX * tileSize;
    this.y = tileY * tileSize;
    this.tileSize = tileSize;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.inventory.addItem('health_potion', INITIAL_HEALTH_POTIONS);
  }

  get isAlive() {
    return this.hp > 0;
  }

  takeDamage(amount: number, source?: DamageSource) {
    if (amount <= 0 || this.isProtected || this.godMode || this.isKnockedOut) return;
    this.hp = Math.max(0, this.hp - amount);
    this.damageFlash = DAMAGE_FLASH_FRAMES;
    if (source !== undefined) this.lastDamageSource = source;
  }

  /** Returns the potion cooldown in frames for the current constitution level. */
  computePotionCooldown(): number {
    const rechargeNumerator = NUMERATOR_ASYMPTOTE_SLOPE * this.constitution;
    const rechargeDenominator = this.constitution + DENOMINATOR_OFFSET;
    const cooldownReduction = rechargeNumerator / rechargeDenominator;
    const cooldownSeconds = DEFAULT_POTION_COOLDOWN_SECONDS - cooldownReduction;
    return Math.round(cooldownSeconds * FRAMES_PER_SECOND);
  }

  /** Drink a health potion — heals 50 % of max HP. Returns false if none available or on cooldown. */
  usePotion(): boolean {
    if (this.hp >= this.maxHp) return false;
    if (this.potionCooldownFrames > 0) return false;
    if (!this.inventory.removeOne('health_potion')) return false;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * POTION_HEAL_FRACTION));
    this.potionCooldownFrames = this.computePotionCooldown();
    return true;
  }

  gainXp(amount: number): boolean {
    if (amount <= 0) return false;
    this.xp += amount;
    const xpNeeded = this.level * XP_PER_LEVEL_MULTIPLIER;
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

  spendPoint(stat: 'STR' | 'INT' | 'CON' | 'EXP') {
    if (this.unspentPoints <= 0) return;
    this.unspentPoints--;
    if (stat === 'STR') {
      this.strength++;
      this.levelUpStat = 'STR';
    } else if (stat === 'INT') {
      this.intelligence++;
      this.levelUpStat = 'INT';
    } else {
      this.constitution++;
      this.maxHp += CON_HP_BONUS_PER_POINT;
      this.hp = Math.min(this.hp + CON_HP_BONUS_PER_POINT, this.maxHp);
      this.levelUpStat = 'CON';
    }
    this.levelUpFlash = SPEND_POINT_FLASH_FRAMES;
  }

  /** Apply stat bonuses from an item being equipped. */
  applyItemBonus(item: InventoryItem): void {
    const b = item.statBonus;
    if (!b) return;
    if (b.constitution) {
      this.constitution += b.constitution;
      this.maxHp += b.constitution * CON_HP_BONUS_PER_POINT;
      this.hp = Math.min(this.hp + b.constitution * CON_HP_BONUS_PER_POINT, this.maxHp);
    }
    if (b.strength) this.strength += b.strength;
    if (b.intelligence) this.intelligence += b.intelligence;
  }

  /** Remove stat bonuses when an item is unequipped. */
  removeItemBonus(item: InventoryItem): void {
    const b = item.statBonus;
    if (!b) return;
    if (b.constitution) {
      this.constitution -= b.constitution;
      this.maxHp -= b.constitution * CON_HP_BONUS_PER_POINT;
      this.hp = Math.min(this.hp, this.maxHp);
    }
    if (b.strength) this.strength -= b.strength;
    if (b.intelligence) this.intelligence -= b.intelligence;
  }

  /** Returns true if the player currently has the given status active. */
  hasStatus(type: string): boolean {
    return this.statusEffects.some((e) => e.type === type);
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
    this.statusEffects = this.statusEffects.filter((effect) => {
      const elapsed = effect.totalTicks - effect.ticksRemaining;
      if (effect.type === 'burn' && elapsed > 0 && elapsed % BURN_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'burn' });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'poison' && elapsed > 0 && elapsed % POISON_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'poison' });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'sepsis' && elapsed > 0 && elapsed % SEPSIS_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'sepsis' });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'magic_burn' && elapsed > 0 && elapsed % MAGIC_BURN_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'magic_burn' });
        this.effectDamageSoundPending = true;
      }
      if (
        effect.type === 'electrified' &&
        elapsed > 0 &&
        elapsed % ELECTRIFIED_TICK_INTERVAL === 0
      ) {
        this.takeDamage(1, { kind: 'status', effectType: 'electrified' });
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'spit_venom' && elapsed > 0 && elapsed % SPIT_VENOM_TICK_INTERVAL === 0) {
        this.takeDamage(1, { kind: 'status', effectType: 'spit_venom' });
        this.effectDamageSoundPending = true;
      }
      effect.ticksRemaining--;
      const justExpired = effect.ticksRemaining < 0;
      if (justExpired && effect.type === 'speed_fizz') {
        this._potionSpeedBoost = 1;
      }
      if (justExpired && effect.type === 'jugg_juice') {
        this.maxHp = Math.max(1, this.maxHp - this._juggJuiceHpBoost);
        this._juggJuiceHpBoost = 0;
        this.hp = Math.min(this.hp, this.maxHp);
      }
      return effect.ticksRemaining >= 0;
    });
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
        this.maxHp = Math.max(1, this.maxHp - this._juggJuiceHpBoost);
        this._juggJuiceHpBoost = 0;
        this.hp = Math.min(this.hp, this.maxHp);
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
    const boost = Math.round(this.maxHp * JUGG_JUICE_HP_MULTIPLIER_BONUS + JUGG_JUICE_FLAT_BONUS);
    this._juggJuiceHpBoost = boost;
    this.maxHp += boost;
    this.hp = this.maxHp;
    this.applyStatus(makeJuggJuice());
  }

  /** Activate Cooldown Crisp: halves all ability cooldowns for 25 seconds. */
  activateCooldownCrisp(): void {
    this.applyStatus(makeCooldownCrisp());
  }

  /** Permanently boost a randomly chosen stat by 2–4 points. */
  applyStatBoost(): void {
    const stats = ['strength', 'intelligence', 'constitution'] as const;
    const stat = stats[Math.floor(Math.random() * STAT_BOOST_STAT_COUNT)];
    const amount = STAT_BOOST_MIN + Math.floor(Math.random() * STAT_BOOST_RANGE);
    if (stat === 'strength') {
      this.strength += amount;
      this.levelUpStat = 'STR';
    } else if (stat === 'intelligence') {
      this.intelligence += amount;
      this.levelUpStat = 'INT';
    } else {
      this.constitution += amount;
      this.maxHp += amount * CON_HP_BONUS_PER_POINT;
      this.hp = Math.min(this.hp + amount * CON_HP_BONUS_PER_POINT, this.maxHp);
      this.levelUpStat = 'CON';
    }
    this.levelUpFlash = SPEND_POINT_FLASH_FRAMES;
  }

  tickTimers() {
    if (this.levelUpFlash > 0) this.levelUpFlash--;
    if (this.damageFlash > 0) this.damageFlash--;
    this.potionCooldownFrames = this.tickCooldown(this.potionCooldownFrames);
    if (this.isMoving) {
      this.walkFrame = (this.walkFrame + WALK_FRAME_SPEED) % (Math.PI * 2);
    } else {
      this.walkFrame = 0;
    }
    this.tickStatusEffects();
    this.tickTempStatMods();
  }

  private tickTempStatMods() {
    this.tempStatMods = this.tempStatMods.filter((mod) => {
      mod.ticksRemaining--;
      if (mod.ticksRemaining > 0) return true;
      // Revert the stat change
      if (mod.stat === 'strength') {
        this.strength = Math.max(1, this.strength - mod.delta);
      } else if (mod.stat === 'intelligence') {
        this.intelligence = Math.max(1, this.intelligence - mod.delta);
      } else {
        const d = Math.round(mod.delta);
        this.constitution = Math.max(1, this.constitution - d);
        this.maxHp = Math.max(1, this.maxHp - d * 2);
        this.hp = Math.min(this.hp, this.maxHp);
      }
      return false;
    });
  }

  abstract render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void;

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

  protected renderDamageFlash(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.damageFlash <= 0) return;
    ctx.save();
    ctx.globalAlpha = (this.damageFlash / DAMAGE_FLASH_FRAMES) * DAMAGE_FLASH_ALPHA_MULTIPLIER;
    ctx.fillStyle = '#ff1f1f';
    ctx.fillRect(sx, sy, this.tileSize, this.tileSize);
    ctx.restore();
  }

  /** Renders world-space status effect indicators above the character sprite. */
  protected renderStatusEffects(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.statusEffects.length === 0) return;
    const cx = sx + this.tileSize / 2;
    ctx.save();
    for (const effect of this.statusEffects) {
      if (effect.type === 'burn') {
        const t = Date.now();
        const pulse = HALF + HALF * Math.sin(t * BURN_PULSE_SPEED);
        const flicker = Math.sin(t * BURN_FLICKER_SPEED) * BURN_FLICKER_AMP;
        ctx.globalAlpha = BURN_ALPHA_BASE + BURN_ALPHA_RANGE * pulse;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = BURN_GLOW_MIN_SIZE + BURN_GLOW_PULSE_RANGE * pulse;
        // Outer flame
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.ellipse(
          cx + flicker,
          sy - BURN_OUTER_FLAME_Y_OFFSET,
          BURN_OUTER_FLAME_RADIUS_X,
          BURN_OUTER_FLAME_RADIUS_Y,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        // Inner flame
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(
          cx + flicker * BURN_INNER_X_FRACTION,
          sy - BURN_INNER_FLAME_Y_OFFSET,
          BURN_INNER_FLAME_RADIUS_X,
          BURN_INNER_FLAME_RADIUS_Y,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'poison') {
        const t = Date.now();
        const drift = (t * POISON_DRIFT_SPEED) % (Math.PI * 2);
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = POISON_SHADOW_BLUR;
        ctx.fillStyle = '#22c55e';
        // Three staggered green drips rising above the character
        for (let b = 0; b < POISON_BUBBLE_COUNT; b++) {
          const phase = drift + b * POISON_PHASE_SPACING; // 2π/3 apart
          const bx = cx + Math.sin(phase) * POISON_ORBIT_RADIUS;
          const by =
            sy -
            POISON_Y_OFFSET -
            b * POISON_Y_STEP -
            Math.abs(Math.sin(phase * POISON_RETRACT_SPEED)) * POISON_WAVE_AMP;
          const r = POISON_MAX_RADIUS - b * POISON_RADIUS_SHRINK;
          ctx.globalAlpha = POISON_ALPHA_BASE + POISON_ALPHA_RANGE * Math.sin(phase);
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'stuck') {
        const t = Date.now();
        const pulse = STUCK_PULSE_BASE + STUCK_PULSE_RANGE * Math.sin(t * STUCK_ALPHA_PULSE_SPEED);
        const cx2 = sx + this.tileSize / 2;
        const cy2 = sy + this.tileSize / 2;
        ctx.globalAlpha = pulse * STUCK_RING_FRACTION;
        ctx.strokeStyle = '#6a880e';
        ctx.lineWidth = STUCK_LINE_WIDTH;
        ctx.lineCap = 'round';
        // Six web strands radiating outward from the character centre
        for (let s = 0; s < STUCK_STRAND_COUNT; s++) {
          const angle = (s / STUCK_STRAND_COUNT) * Math.PI * 2 + t * STUCK_ORBIT_SPEED;
          const r1 = this.tileSize * STUCK_INNER_RADIUS;
          const r2 =
            this.tileSize * STUCK_OUTER_BASE_FRACTION +
            Math.sin((angle * STUCK_STRAND_COUNT) / 2 + t * STUCK_WAVE_SPEED) * STUCK_WAVE_AMP;
          ctx.beginPath();
          ctx.moveTo(cx2 + Math.cos(angle) * r1, cy2 + Math.sin(angle) * r1);
          ctx.lineTo(cx2 + Math.cos(angle) * r2, cy2 + Math.sin(angle) * r2);
          ctx.stroke();
        }
        // Cross-strand connecting the tips (one ring)
        ctx.globalAlpha = pulse * STUCK_INNER_RING_ALPHA;
        ctx.beginPath();
        ctx.arc(cx2, cy2, this.tileSize * STUCK_RING_FRACTION, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.type === 'spit_venom') {
        const t = Date.now();
        const cx2 = sx + this.tileSize / 2;
        const cy2 = sy + this.tileSize;
        ctx.shadowColor = '#8fb000';
        ctx.shadowBlur = SEPSIS_SHADOW_BLUR;
        for (let d = 0; d < SPIT_DROP_COUNT; d++) {
          const phase = (t * SPIT_DRIFT_SPEED + d * SPIT_PHASE_STEP) % (Math.PI * 2);
          const dropX =
            cx2 + Math.sin(phase * SPIT_WAVE_X_FREQ + d) * this.tileSize * SPIT_ORBIT_FRACTION;
          const dropY =
            cy2 + ((t * SPIT_DROP_SCROLL_SPEED + d * SPIT_DROP_SPACING) % SPIT_DROP_SCROLL_RANGE);
          const alpha = SPIT_ALPHA_BASE + SPIT_ALPHA_RANGE * Math.sin(phase);
          ctx.globalAlpha = alpha * SPIT_ALPHA_OUTER;
          ctx.fillStyle = d % 2 === 0 ? '#8fb000' : '#b5c800';
          ctx.beginPath();
          ctx.ellipse(dropX, dropY, SPIT_RADIUS_X, SPIT_RADIUS_Y, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'sepsis') {
        const t = Date.now();
        const drift = (t * SEPSIS_DRIFT_SPEED) % (Math.PI * 2);
        // Sickly yellow-green bubbles + dripping effect
        ctx.shadowColor = '#a3e635';
        ctx.shadowBlur = SEPSIS_SHADOW_BLUR;
        for (let b = 0; b < SEPSIS_BUBBLE_COUNT; b++) {
          const phase = drift + b * SEPSIS_PHASE_SPACING; // π/2 apart
          const bx = cx + Math.sin(phase) * SEPSIS_ORBIT_RADIUS;
          const by =
            sy -
            SEPSIS_Y_OFFSET -
            b * SEPSIS_Y_STEP -
            Math.abs(Math.sin(phase * SEPSIS_RETRACT_SPEED)) * SEPSIS_SHADOW_BLUR;
          const r = SEPSIS_MAX_RADIUS - b * SEPSIS_RADIUS_SHRINK;
          const pulse =
            SEPSIS_ALPHA_BASE + SEPSIS_ALPHA_RANGE * Math.sin(phase + t * SEPSIS_PULSE_SPEED);
          ctx.globalAlpha = pulse;
          ctx.fillStyle = b % 2 === 0 ? '#bef264' : '#a3e635';
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
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
