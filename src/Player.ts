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
  healthPotions = 10;
  unspentPoints = 0;
  protected tileSize: number;

  constructor(tileX: number, tileY: number, tileSize: number, maxHp = 10) {
    this.x = tileX * tileSize;
    this.y = tileY * tileSize;
    this.tileSize = tileSize;
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get isAlive() {
    return this.hp > 0;
  }

  takeDamage(amount: number) {
    if (amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.damageFlash = 8;
  }

  /** Drink a health potion — heals 50 % of max HP. Returns false if none available. */
  usePotion(): boolean {
    if (this.healthPotions <= 0 || this.hp >= this.maxHp) return false;
    this.healthPotions--;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.5));
    return true;
  }

  gainXp(amount: number) {
    if (amount <= 0) return;
    this.xp += amount;
    const xpNeeded = this.level * 10;
    if (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      this.unspentPoints++;
      this.levelUpStat = 'POINT';
      this.levelUpFlash = 120;
    }
  }

  spendPoint(stat: 'STR' | 'INT' | 'CON') {
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

  tickTimers() {
    if (this.levelUpFlash > 0) this.levelUpFlash--;
    if (this.damageFlash > 0) this.damageFlash--;
    if (this.isMoving) {
      this.walkFrame = (this.walkFrame + 0.14) % (Math.PI * 2);
    } else {
      this.walkFrame = 0;
    }
  }

  abstract render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void;

  followTarget(
    targetX: number,
    targetY: number,
    speed: number,
    minDist: number,
  ) {
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
}
