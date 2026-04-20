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
  /** Active status effects (Burn, Frozen, Paralyzed, etc.). */
  statusEffects: StatusEffect[] = [];
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
    if (amount <= 0 || this.isProtected) return;
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
      }
      if (effect.type === 'poison' && elapsed > 0 && elapsed % 120 === 0) {
        this.takeDamage(1);
      }
      if (effect.type === 'sepsis' && elapsed > 0 && elapsed % 120 === 0) {
        this.takeDamage(1);
      }
      effect.ticksRemaining--;
      return effect.ticksRemaining >= 0;
    });
  }

  /** Returns the regen speed multiplier from equipped gear. */
  get regenMultiplier(): number {
    // Trollskin Shirt grants 2.5× health regeneration rate
    if (this.inventory.hasEquipped('trollskin_shirt')) return 2.5;
    return 1;
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
}
