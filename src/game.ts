import { GameMap } from './GameMap';
import { HumanPlayer } from './creatures/HumanPlayer';
import { CatPlayer } from './creatures/CatPlayer';
import { Mob } from './creatures/Mob';
import { Goblin } from './creatures/Goblin';
import { Llama } from './creatures/Llama';

const TILE_SIZE = 32;
const PLAYER_SPEED = 2.5;
const FOLLOWER_SPEED = 3.5;

/** Chance (0–1) that any given spawn point produces a llama instead of a goblin. */
const LLAMA_CHANCE = 0.15;

/** How close an enemy must wander before the human auto-engages (cat-active mode). */
const HUMAN_ENGAGE_RANGE = TILE_SIZE * 5;

/** Cat stays this many px from its auto-target (within missile range of 3.5 tiles). */
const CAT_FIGHT_OFFSET = TILE_SIZE * 2.5;

type GoblinVariant = { weapon: 'club' | 'hammer'; skin: string; eye: string };
const GOBLIN_VARIANTS: GoblinVariant[] = [
  { weapon: 'club',   skin: '#3d6b32', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#4f8a3e', eye: '#fbbf24' },
  { weapon: 'club',   skin: '#7ab86a', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#3d6b32', eye: '#fbbf24' },
];

/** Spawn a random mob at the given tile coordinates. */
function spawnMob(tileX: number, tileY: number): Mob {
  if (Math.random() < LLAMA_CHANCE) {
    return new Llama(tileX, tileY, TILE_SIZE);
  }
  const v = GOBLIN_VARIANTS[Math.floor(Math.random() * GOBLIN_VARIANTS.length)];
  return new Goblin(tileX, tileY, TILE_SIZE, v.weapon, v.skin, v.eye);
}

/** Tile coordinates where mobs can spawn. */
const MOB_SPAWN_POINTS: [number, number][] = [
  [15,  8], [20, 15], [12, 22], [28, 10],
  [32, 18], [ 9, 28], [24, 32], [38, 12],
];

class GameStage {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gameMap: GameMap;
  private human: HumanPlayer;
  private cat: CatPlayer;
  private mobs: Mob[];
  private keys = new Set<string>();
  private catWanderX = 0;
  private catWanderY = 0;
  private catWanderTimer = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = 'block';
    document.getElementById('game')!.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.gameMap = new GameMap(100, TILE_SIZE);
    this.human = new HumanPlayer(5, 5, TILE_SIZE);
    this.cat = new CatPlayer(6, 5, TILE_SIZE);
    this.human.isActive = true;
    this.mobs = MOB_SPAWN_POINTS.map(([tx, ty]) => spawnMob(tx, ty));

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key);
      if (e.key === 'Tab') {
        e.preventDefault();
        this.human.isActive = !this.human.isActive;
        this.cat.isActive = !this.cat.isActive;
        // Clear auto-combat targets when the player manually switches
        this.cat.autoTarget = null;
        this.human.autoTarget = null;
      }
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        if (this.human.isActive) this.human.triggerAttack();
        else this.cat.triggerAttack();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });

    this.loop();
  }

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }

  private update() {
    const player = this.active();
    const mapPx = this.gameMap.structure.length * TILE_SIZE;

    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) dy -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) dy += 1;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) dx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) dx += 1;

    // Update facing direction from raw input (before speed scaling)
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }
    dx *= PLAYER_SPEED;
    dy *= PLAYER_SPEED;

    // Apply x movement, check walkability on center of sprite
    const nextX = Math.max(0, Math.min(mapPx - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXnext, tileYcur)) {
      player.x = nextX;
    }

    // Apply y movement separately
    const nextY = Math.max(0, Math.min(mapPx - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXcur, tileYnext)) {
      player.y = nextY;
    }

    // ── Follower movement ─────────────────────────────────────────────────
    if (this.human.isActive) {
      // Cat: close on her auto-target when fighting, otherwise wander near human
      if (this.cat.autoTarget && this.cat.autoTarget.isAlive) {
        this.cat.followTarget(
          this.cat.autoTarget.x,
          this.cat.autoTarget.y,
          FOLLOWER_SPEED,
          CAT_FIGHT_OFFSET,
        );
      } else {
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE * 1.5;
          this.catWanderX = Math.cos(angle) * radius;
          this.catWanderY = Math.sin(angle) * radius;
          this.catWanderTimer = 160 + Math.floor(Math.random() * 240);
        }
        this.cat.followTarget(
          this.human.x + this.catWanderX,
          this.human.y + this.catWanderY,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.3,
        );
      }
    } else {
      // Human: charge auto-target when fighting, otherwise follow cat
      if (this.human.autoTarget && this.human.autoTarget.isAlive) {
        this.human.followTarget(
          this.human.autoTarget.x,
          this.human.autoTarget.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.9,
        );
      } else {
        this.human.followTarget(this.cat.x, this.cat.y, FOLLOWER_SPEED, TILE_SIZE * 1.8);
      }
    }

    // Update attack states
    this.human.updateAttack();
    this.cat.updateMissiles();

    // Mob AI
    const playerTargets = [this.human, this.cat];
    for (const mob of this.mobs) {
      mob.updateAI(playerTargets);
    }

    // Companion auto-combat AI
    this.updateAutoAI();

    // Player attacks → mobs (with attacker tracking)
    this.resolvePlayerAttacks();

    // Award XP for kills this frame
    this.resolveKills();

    // Tick level-up flash timers
    this.human.tickTimers();
    this.cat.tickTimers();
  }

  /**
   * Decide which enemies the companion character auto-engages each frame.
   *
   * Human active → cat auto-fires:
   *   - Always prioritises any mob targeting the cat herself.
   *   - Keeps fighting her current target if it's still alive.
   *   - Otherwise picks up any mob that is targeting the human.
   *
   * Cat active → human auto-engages:
   *   - Only engages enemies that wander within HUMAN_ENGAGE_RANGE.
   *   - Finishes the current fight before switching to a new target.
   */
  private updateAutoAI() {
    if (this.human.isActive) {
      // Clear dead target
      if (this.cat.autoTarget && !this.cat.autoTarget.isAlive) {
        this.cat.autoTarget = null;
      }

      const mobTargetingCat   = this.mobs.find(m => m.isAlive && m.currentTarget === this.cat)   ?? null;
      const mobTargetingHuman = this.mobs.find(m => m.isAlive && m.currentTarget === this.human) ?? null;

      if (mobTargetingCat) {
        // Self-defence always overrides
        this.cat.autoTarget = mobTargetingCat;
      } else if (!this.cat.autoTarget && mobTargetingHuman) {
        // Help the human only when cat has no ongoing fight
        this.cat.autoTarget = mobTargetingHuman;
      }

      if (this.cat.autoTarget) {
        this.cat.autoFireTick();
      }
    } else {
      // Clear dead target (but don't interrupt an ongoing fight while alive)
      if (this.human.autoTarget && !this.human.autoTarget.isAlive) {
        this.human.autoTarget = null;
      }

      // Only look for a new target when not already fighting
      if (!this.human.autoTarget) {
        let closestDist = HUMAN_ENGAGE_RANGE;
        let closest: Mob | null = null;
        for (const mob of this.mobs) {
          if (!mob.isAlive) continue;
          const dist = Math.hypot(mob.x - this.human.x, mob.y - this.human.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = mob;
          }
        }
        this.human.autoTarget = closest;
      }

      if (this.human.autoTarget) {
        this.human.autoFightTick();
      }
    }
  }

  /**
   * Check whether current player attacks hit any mobs this frame.
   * Human melee fires on the single peak frame of the swing animation.
   * Cat missiles trigger on contact, then switch to exploding state.
   * Damage is attributed to the attacker for XP tracking.
   */
  private resolvePlayerAttacks() {
    const centerOf = (e: { x: number; y: number }) => ({
      x: e.x + TILE_SIZE * 0.5,
      y: e.y + TILE_SIZE * 0.5,
    });

    // Human melee — fires once at the peak frame of the swing
    if (this.human.isAttackPeak()) {
      const hc = centerOf(this.human);
      const range = this.human.getMeleeRange();
      const damage = this.human.getMeleeDamage();
      for (const mob of this.mobs) {
        if (!mob.isAlive) continue;
        const mc = centerOf(mob);
        const dx = mc.x - hc.x;
        const dy = mc.y - hc.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > range) continue;
        // Must be roughly in front of the player
        const dot = (dx / dist) * this.human.facingX + (dy / dist) * this.human.facingY;
        if (dot > 0.3) mob.takeDamageFrom(damage, this.human);
      }
    }

    // Cat missiles — each flying, un-hit missile checked against every mob
    for (const missile of this.cat.getMissiles()) {
      if (missile.state !== 'flying' || missile.hit) continue;
      const damage = this.cat.getMissileDamage();
      for (const mob of this.mobs) {
        if (!mob.isAlive) continue;
        const mc = centerOf(mob);
        const dist = Math.hypot(missile.x - mc.x, missile.y - mc.y);
        if (dist < TILE_SIZE * 0.7) {
          mob.takeDamageFrom(damage, this.cat);
          missile.hit = true;
          missile.state = 'exploding';
          break;
        }
      }
    }
  }

  /**
   * For each mob that died this frame, split XP among players proportionally
   * to the damage they dealt.
   */
  private resolveKills() {
    for (const mob of this.mobs) {
      if (!mob.justDied) continue;
      mob.justDied = false;

      let totalDmg = 0;
      for (const dmg of mob.damageTakenBy.values()) totalDmg += dmg;
      if (totalDmg === 0) continue;

      for (const [player, dmg] of mob.damageTakenBy) {
        const share = Math.max(1, Math.round((dmg / totalDmg) * mob.xpValue));
        player.gainXp(share);
      }
    }
  }

  private camera() {
    const player = this.active();
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const camX = player.x + TILE_SIZE / 2 - this.canvas.width / 2;
    const camY = player.y + TILE_SIZE / 2 - this.canvas.height / 2;
    return {
      x: Math.max(0, Math.min(mapPx - this.canvas.width, camX)),
      y: Math.max(0, Math.min(mapPx - this.canvas.height, camY)),
    };
  }

  private render() {
    const { x: camX, y: camY } = this.camera();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.gameMap.renderCanvas(
      this.ctx,
      camX,
      camY,
      this.canvas.width,
      this.canvas.height,
    );

    // Mobs render behind players
    for (const mob of this.mobs) {
      mob.render(this.ctx, camX, camY, TILE_SIZE);
    }

    // Draw inactive behind active
    this.inactive().render(this.ctx, camX, camY, TILE_SIZE);
    this.active().render(this.ctx, camX, camY, TILE_SIZE);

    // Level-up floating text over characters
    this.renderLevelUpFlash(camX, camY);

    this.drawHUD();
  }

  /** Floating "LEVEL UP! +STAT" text that rises and fades over the levelled-up character. */
  private renderLevelUpFlash(camX: number, camY: number) {
    for (const p of [this.human, this.cat] as const) {
      if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
      const alpha = p.levelUpFlash / 120;
      const rise = (1 - alpha) * 28; // drifts upward as it fades
      const sx = p.x - camX + TILE_SIZE / 2;
      const sy = p.y - camY - 12 - rise;

      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.font = 'bold 13px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#facc15';
      this.ctx.fillText(`LEVEL UP! +${p.levelUpStat}`, sx, sy);
      this.ctx.restore();
      this.ctx.textAlign = 'left';
    }
  }

  private drawHUD() {
    const activeLabel   = this.human.isActive ? 'Human' : 'Cat (Donut)';
    const inactiveLabel = this.human.isActive ? 'Cat' : 'Human';
    const atkLabel      = this.human.isActive ? 'Punch / Kick' : 'Magic Missile';
    const ctx = this.ctx;
    const activePlayer   = this.active();
    const inactivePlayer = this.inactive();

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 320, 150);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`Playing as: ${activeLabel}`, 16, 28);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.fillText('WASD/Arrows: Move  |  Tab: Switch', 16, 46);
    ctx.fillText(`Space: ${atkLabel}`, 16, 62);

    this.drawHUDPlayerBlock(ctx, activeLabel,   activePlayer,   16,  74);
    this.drawHUDPlayerBlock(ctx, inactiveLabel, inactivePlayer, 16, 112);
  }

  private drawHUDPlayerBlock(
    ctx: CanvasRenderingContext2D,
    label: string,
    player: HumanPlayer | CatPlayer,
    x: number,
    y: number,
  ) {
    const barX = x + 88;
    const barW = 90;
    const barH = 7;

    // HP bar
    const hpRatio = player.hp / player.maxHp;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`${label} Lv${player.level}:`, x, y + barH);

    ctx.fillStyle = '#374151';
    ctx.fillRect(barX, y, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillRect(barX, y, Math.ceil(barW * hpRatio), barH);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '10px monospace';
    ctx.fillText(`${player.hp}/${player.maxHp}`, barX + barW + 4, y + barH);

    // XP bar
    const xpNeeded = player.level * 10;
    const xpRatio  = Math.min(1, player.xp / xpNeeded);
    const y2 = y + 14;

    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText('XP:', x, y2 + barH);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, y2, barW, barH);
    ctx.fillStyle = '#818cf8';
    ctx.fillRect(barX, y2, Math.ceil(barW * xpRatio), barH);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`${player.xp}/${xpNeeded}`, barX + barW + 4, y2 + barH);

    // Stats
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px monospace';
    ctx.fillText(
      `STR:${player.strength}  INT:${player.intelligence}  CON:${player.constitution}`,
      barX, y2 + barH + 12,
    );
  }

  private loop() {
    this.update();
    this.render();
    requestAnimationFrame(() => this.loop());
  }
}

new GameStage();
