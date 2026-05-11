import type { StatusEffect } from './core/StatusEffect';
import { Inventory } from './core/Inventory';
import type { InventoryItem } from './core/ItemDefs';

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
  /** Movement speed multiplier — 1 is normal, 2 is double speed. */
  speedMultiplier = 1;
  /** Active status effects (Burn, Frozen, Paralyzed, etc.). */
  statusEffects: StatusEffect[] = [];
  /** When true, mob AI treats this player as a defend target and will not attack other targets. */
  isDefendTarget?: boolean;
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

  constructor(tileX: number, tileY: number, tileSize: number, maxHp = 10) {
    this.x = tileX * tileSize;
    this.y = tileY * tileSize;
    this.tileSize = tileSize;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.inventory.addItem('health_potion', 10);
  }

  get isAlive() {
    return this.hp > 0;
  }

  takeDamage(amount: number) {
    if (amount <= 0 || this.isProtected || this.godMode || this.isKnockedOut) return;
    this.hp = Math.max(0, this.hp - amount);
    this.damageFlash = 8;
  }

  /** Drink a health potion — heals 50 % of max HP. Returns false if none available. */
  usePotion(): boolean {
    if (this.hp >= this.maxHp) return false;
    if (!this.inventory.removeOne('health_potion')) return false;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.5));
    return true;
  }

  gainXp(amount: number): boolean {
    if (amount <= 0) return false;
    this.xp += amount;
    const xpNeeded = this.level * 10;
    if (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      this.unspentPoints++;
      this.levelUpStat = 'POINT';
      this.levelUpFlash = 120;
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
      this.maxHp += 2;
      this.hp = Math.min(this.hp + 2, this.maxHp);
      this.levelUpStat = 'CON';
    }
    this.levelUpFlash = 60;
  }

  /** Apply stat bonuses from an item being equipped. */
  applyItemBonus(item: InventoryItem): void {
    const b = item.statBonus;
    if (!b) return;
    if (b.constitution) {
      this.constitution += b.constitution;
      this.maxHp += b.constitution * 2;
      this.hp = Math.min(this.hp + b.constitution * 2, this.maxHp);
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
      this.maxHp -= b.constitution * 2;
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
      if (effect.type === 'burn' && elapsed > 0 && elapsed % 60 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'poison' && elapsed > 0 && elapsed % 120 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'sepsis' && elapsed > 0 && elapsed % 120 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'magic_burn' && elapsed > 0 && elapsed % 60 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'electrified' && elapsed > 0 && elapsed % 60 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      if (effect.type === 'spit_venom' && elapsed > 0 && elapsed % 40 === 0) {
        this.takeDamage(1);
        this.effectDamageSoundPending = true;
      }
      effect.ticksRemaining--;
      return effect.ticksRemaining >= 0;
    });
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

  tickTimers() {
    if (this.levelUpFlash > 0) this.levelUpFlash--;
    if (this.damageFlash > 0) this.damageFlash--;
    if (this.isMoving) {
      this.walkFrame = (this.walkFrame + 0.14) % (Math.PI * 2);
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
    const barH = 4;
    const ratio = this.hp / this.maxHp;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(sx, sy - 7, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillRect(sx, sy - 7, Math.ceil(barW * ratio), barH);
  }

  protected renderDamageFlash(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.damageFlash <= 0) return;
    ctx.save();
    ctx.globalAlpha = (this.damageFlash / 8) * 0.55;
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
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.009);
        const flicker = Math.sin(t * 0.022) * 2.5;
        ctx.globalAlpha = 0.75 + 0.25 * pulse;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 6 + 5 * pulse;
        // Outer flame
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.ellipse(cx + flicker, sy - 10, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Inner flame
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(cx + flicker * 0.5, sy - 11, 3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'poison') {
        const t = Date.now();
        const drift = (t * 0.025) % (Math.PI * 2);
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#22c55e';
        // Three staggered green drips rising above the character
        for (let b = 0; b < 3; b++) {
          const phase = drift + b * 2.09; // 2π/3 apart
          const bx = cx + Math.sin(phase) * 4.5;
          const by = sy - 7 - b * 4.5 - Math.abs(Math.sin(phase * 0.5)) * 3;
          const r = 2.8 - b * 0.5;
          ctx.globalAlpha = 0.7 + 0.3 * Math.sin(phase);
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'stuck') {
        const t = Date.now();
        const pulse = 0.65 + 0.35 * Math.sin(t * 0.008);
        const cx2 = sx + this.tileSize / 2;
        const cy2 = sy + this.tileSize / 2;
        ctx.globalAlpha = pulse * 0.55;
        ctx.strokeStyle = '#6a880e';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        // Six web strands radiating outward from the character centre
        for (let s = 0; s < 6; s++) {
          const angle = (s / 6) * Math.PI * 2 + t * 0.001;
          const r1 = this.tileSize * 0.3;
          const r2 = this.tileSize * 0.62 + Math.sin(angle * 3 + t * 0.006) * 3;
          ctx.beginPath();
          ctx.moveTo(cx2 + Math.cos(angle) * r1, cy2 + Math.sin(angle) * r1);
          ctx.lineTo(cx2 + Math.cos(angle) * r2, cy2 + Math.sin(angle) * r2);
          ctx.stroke();
        }
        // Cross-strand connecting the tips (one ring)
        ctx.globalAlpha = pulse * 0.3;
        ctx.beginPath();
        ctx.arc(cx2, cy2, this.tileSize * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.type === 'spit_venom') {
        const t = Date.now();
        const cx2 = sx + this.tileSize / 2;
        const cy2 = sy + this.tileSize;
        ctx.shadowColor = '#8fb000';
        ctx.shadowBlur = 4;
        for (let d = 0; d < 5; d++) {
          const phase = (t * 0.003 + d * 1.26) % (Math.PI * 2);
          const dropX = cx2 + Math.sin(phase * 2.3 + d) * this.tileSize * 0.28;
          const dropY = cy2 + ((t * 0.04 + d * 14) % 18);
          const alpha = 0.5 + 0.5 * Math.sin(phase);
          ctx.globalAlpha = alpha * 0.75;
          ctx.fillStyle = d % 2 === 0 ? '#8fb000' : '#b5c800';
          ctx.beginPath();
          ctx.ellipse(dropX, dropY, 2.2, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      if (effect.type === 'sepsis') {
        const t = Date.now();
        const drift = (t * 0.02) % (Math.PI * 2);
        // Sickly yellow-green bubbles + dripping effect
        ctx.shadowColor = '#a3e635';
        ctx.shadowBlur = 4;
        for (let b = 0; b < 4; b++) {
          const phase = drift + b * 1.57; // π/2 apart
          const bx = cx + Math.sin(phase) * 5.5;
          const by = sy - 6 - b * 3.5 - Math.abs(Math.sin(phase * 0.7)) * 4;
          const r = 2.5 - b * 0.35;
          const pulse = 0.6 + 0.4 * Math.sin(phase + t * 0.005);
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
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.004);

    ctx.save();

    // Dark desaturating overlay
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sx, sy, s, s);

    // Pulsing red ring
    ctx.globalAlpha = 0.45 + 0.3 * pulse;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, sy + s / 2, s * (0.48 + 0.06 * pulse), 0, Math.PI * 2);
    ctx.stroke();

    // "KO" badge above the tile
    const fontSize = Math.round(s * 0.38);
    ctx.globalAlpha = 1;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ef4444';
    ctx.fillText('KO', cx, sy - 2);
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}
