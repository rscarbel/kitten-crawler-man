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
  constitution = 1;
  levelUpStat: string | null = null;
  levelUpFlash = 0;
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
    this.hp = Math.max(0, this.hp - amount);
  }

  gainXp(amount: number) {
    if (amount <= 0) return;
    this.xp += amount;
    const xpNeeded = this.level * 10;
    if (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      const roll = Math.floor(Math.random() * 3);
      if (roll === 0) {
        this.strength++;
        this.levelUpStat = 'STR';
      } else if (roll === 1) {
        this.intelligence++;
        this.levelUpStat = 'INT';
      } else {
        this.constitution++;
        this.maxHp += 2;
        this.hp = Math.min(this.hp + 2, this.maxHp);
        this.levelUpStat = 'CON';
      }
      this.levelUpFlash = 120;
    }
  }

  tickTimers() {
    if (this.levelUpFlash > 0) this.levelUpFlash--;
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
    if (dist <= minDist) return;
    const step = Math.min(speed, dist - minDist);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
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
}
