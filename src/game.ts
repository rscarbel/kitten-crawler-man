import { GameMap } from './GameMap';
import { HumanPlayer } from './creatures/HumanPlayer';
import { CatPlayer } from './creatures/CatPlayer';
import { Mob } from './creatures/Mob';
import { Goblin } from './creatures/Goblin';
import { Llama } from './creatures/Llama';
import { Rat } from './creatures/Rat';

const TILE_SIZE = 32;
const PLAYER_SPEED = 2.5;
const FOLLOWER_SPEED = 3.5;

/** Chance (0–1) that any given spawn point produces a llama instead of a goblin. */
const LLAMA_CHANCE = 0.15;

/** How close an enemy must wander before the human auto-engages (cat-active mode). */
const HUMAN_ENGAGE_RANGE = TILE_SIZE * 5;

/**
 * Cat's preferred kiting distance from an enemy that is targeting her.
 * She orbits at this radius and flees inward if the enemy gets too close.
 */
const CAT_KITE_DIST = TILE_SIZE * 3.5;

/**
 * When helping the human, the cat stands this many pixels behind the human
 * (on the side away from the enemy) so the human acts as a shield.
 */
const CAT_BEHIND_HUMAN_OFFSET = TILE_SIZE * 2.2;

type GoblinVariant = { weapon: 'club' | 'hammer'; skin: string; eye: string };
const GOBLIN_VARIANTS: GoblinVariant[] = [
  { weapon: 'club',   skin: '#3d6b32', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#4f8a3e', eye: '#fbbf24' },
  { weapon: 'club',   skin: '#7ab86a', eye: '#ef4444' },
  { weapon: 'hammer', skin: '#3d6b32', eye: '#fbbf24' },
];

/** Spawn a random mob at the given tile coordinates and wire it to the map. */
function spawnMob(tileX: number, tileY: number, map: GameMap): Mob {
  let mob: Mob;
  if (Math.random() < LLAMA_CHANCE) {
    mob = new Llama(tileX, tileY, TILE_SIZE);
  } else {
    const v = GOBLIN_VARIANTS[Math.floor(Math.random() * GOBLIN_VARIANTS.length)];
    mob = new Goblin(tileX, tileY, TILE_SIZE, v.weapon, v.skin, v.eye);
  }
  mob.setMap(map);
  return mob;
}


class GameStage {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gameMap: GameMap;
  private human: HumanPlayer;
  private cat: CatPlayer;
  private mobs: Mob[];
  private keys = new Set<string>();
  /** Absolute world-pixel position the cat idles at during wander. */
  private catWanderTargetX = 0;
  private catWanderTargetY = 0;
  private catWanderTimer = 0;
  /** Angle used by the cat's kiting orbit. Increments every frame during kite mode. */
  private catKiteAngle = 0;
  /** Cooldown (frames) before the inactive companion auto-drinks another potion. */
  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;
  /** True once either player has died — freezes update, shows death overlay. */
  private gameOver = false;
  private deathOverlayAlpha = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = 'block';
    document.getElementById('game')!.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.gameMap = new GameMap(100, TILE_SIZE);
    const { x: sx, y: sy } = this.gameMap.startTile;
    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.catWanderTargetX = (sx + 1) * TILE_SIZE;
    this.catWanderTargetY = sy * TILE_SIZE;
    this.human.isActive = true;
    this.mobs = [
      ...this.gameMap.mobSpawnPoints.map(({ x, y }) => spawnMob(x, y, this.gameMap)),
      ...this.gameMap.hallwaySpawnPoints.map(({ x, y }) => {
        const rat = new Rat(x, y, TILE_SIZE);
        rat.setMap(this.gameMap);
        return rat;
      }),
    ];
    this.cat.setMap(this.gameMap);

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
        if (this.human.isActive) {
          this.snapFacingToNearestMob(this.human, TILE_SIZE * 3);
          this.human.triggerAttack();
        } else {
          this.snapFacingToNearestMob(this.cat, TILE_SIZE * 5);
          this.cat.triggerAttack();
        }
      }
      // Q — drink a health potion (active character)
      if ((e.key === 'q' || e.key === 'Q') && !e.repeat) {
        e.preventDefault();
        if (this.human.isActive) this.human.usePotion();
        else this.cat.usePotion();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.gameOver || this.deathOverlayAlpha < 0.5) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const btnW = 210;
      const btnH = 48;
      const btnX = w / 2 - btnW / 2;
      const btnY = h / 2 + 44;
      if (mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH) {
        this.resetGame();
      }
    });

    this.loop();
  }

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }

  /** Moves `entity` by (dx, dy) with per-axis tile collision. */
  private entityMoveWithCollision(entity: { x: number; y: number }, dx: number, dy: number) {
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const ts = TILE_SIZE;
    if (dx !== 0) {
      const nextX = Math.max(0, Math.min(mapPx - ts, entity.x + dx));
      const tileXnext = Math.floor((nextX    + ts / 2) / ts);
      const tileYcur  = Math.floor((entity.y + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXnext, tileYcur)) entity.x = nextX;
    }
    if (dy !== 0) {
      const nextY = Math.max(0, Math.min(mapPx - ts, entity.y + dy));
      const tileXcur  = Math.floor((entity.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY    + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
    }
  }

  /** Wall-aware followTarget for companions. */
  private companionFollow(
    entity: { x: number; y: number; isMoving: boolean },
    targetX: number,
    targetY: number,
    speed: number,
    minDist: number,
  ) {
    const dx = targetX - entity.x;
    const dy = targetY - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= minDist) {
      entity.isMoving = false;
      return;
    }
    const step = Math.min(speed, dist - minDist);
    this.entityMoveWithCollision(entity, (dx / dist) * step, (dy / dist) * step);
    entity.isMoving = true;
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

    // Track movement for walk animation
    player.isMoving = (dx !== 0 || dy !== 0);

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
      // Cat follower: position depends on combat mode
      if (this.cat.autoTarget && this.cat.autoTarget.isAlive) {
        const enemy = this.cat.autoTarget as Mob;
        if (enemy.currentTarget === this.cat) {
          // Enemy is targeting the cat → kite around the enemy
          this.doCatKite(enemy);
        } else if (enemy.currentTarget === this.human) {
          // Enemy is targeting the human → shelter behind the human
          this.doCatBehindHuman(enemy);
        } else {
          // Enemy isn't targeting anyone we know → standard fight offset
          this.companionFollow(this.cat, enemy.x, enemy.y, FOLLOWER_SPEED, TILE_SIZE * 2.5);
        }
      } else {
        // Idle: wander near the human using an absolute pixel target so the
        // cat stays still (isMoving=false, no walk animation) once she arrives.
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE;
          this.catWanderTargetX = this.human.x + Math.cos(angle) * radius;
          this.catWanderTargetY = this.human.y + Math.sin(angle) * radius;
          this.catWanderTimer = 160 + Math.floor(Math.random() * 240);
        }
        // If the cat has drifted too far from the human, walk back directly.
        if (Math.hypot(this.cat.x - this.human.x, this.cat.y - this.human.y) > TILE_SIZE * 3.5) {
          this.catWanderTargetX = this.human.x;
          this.catWanderTargetY = this.human.y;
        }
        this.companionFollow(
          this.cat,
          this.catWanderTargetX,
          this.catWanderTargetY,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.5,
        );
      }
    } else {
      // Human: charge auto-target when fighting, otherwise follow cat
      if (this.human.autoTarget && this.human.autoTarget.isAlive) {
        this.companionFollow(
          this.human,
          this.human.autoTarget.x,
          this.human.autoTarget.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.9,
        );
      } else {
        this.companionFollow(this.human, this.cat.x, this.cat.y, FOLLOWER_SPEED, TILE_SIZE * 1.8);
      }
    }

    // Update attack states
    this.human.updateAttack();
    this.cat.updateMissiles();

    // Mob AI + timer ticking
    const playerTargets = [this.human, this.cat];
    for (const mob of this.mobs) {
      mob.updateAI(playerTargets);
      mob.tickTimers();
    }

    // Companion auto-combat AI
    this.updateAutoAI();

    // Player attacks → mobs (with attacker tracking)
    this.resolvePlayerAttacks();

    // Award XP for kills this frame
    this.resolveKills();

    // Tick level-up / damage flash timers for players
    this.human.tickTimers();
    this.cat.tickTimers();

    // Auto-potion: inactive companion drinks if below 50 % HP
    this.updateCompanionPotion();

    // Death check
    if (!this.gameOver && (!this.human.isAlive || !this.cat.isAlive)) {
      this.gameOver = true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cat positioning helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Kiting: the cat orbits the enemy at CAT_KITE_DIST and flees sideways when
   * the enemy closes in. She keeps firing via autoFireTick (called separately).
   */
  private doCatKite(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const cx = this.cat.x + TILE_SIZE * 0.5;
    const cy = this.cat.y + TILE_SIZE * 0.5;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);

    this.catKiteAngle += 0.022;

    if (distToEnemy < CAT_KITE_DIST * 0.75) {
      // Too close: flee directly away + slight lateral strafe
      if (distToEnemy > 0) {
        const nx = (cx - ex) / distToEnemy;
        const ny = (cy - ey) / distToEnemy;
        // Rotate flee vector slightly for strafe
        const cos = Math.cos(0.4), sin = Math.sin(0.4);
        const sx2 = nx * cos - ny * sin;
        const sy2 = nx * sin + ny * cos;
        this.entityMoveWithCollision(this.cat, sx2 * FOLLOWER_SPEED * 1.35, sy2 * FOLLOWER_SPEED * 1.35);
        this.cat.isMoving = true;
      }
    } else {
      // Orbit: move to a point at kite distance at the current kite angle
      const targetX = ex + Math.cos(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      const targetY = ey + Math.sin(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      this.companionFollow(this.cat, targetX, targetY, FOLLOWER_SPEED, TILE_SIZE * 0.5);
    }
  }

  /**
   * Shield position: cat moves to a point 2+ tiles behind the human
   * (on the side away from the enemy) so the human is between them.
   */
  private doCatBehindHuman(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const hx = this.human.x + TILE_SIZE * 0.5;
    const hy = this.human.y + TILE_SIZE * 0.5;

    // Direction from enemy → human
    const dx = hx - ex;
    const dy = hy - ey;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    // Target: stand behind the human, even farther from the enemy
    const targetX = hx + nx * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    const targetY = hy + ny * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    this.companionFollow(this.cat, targetX, targetY, FOLLOWER_SPEED, TILE_SIZE * 0.5);
  }

  // ─────────────────────────────────────────────────────────────────────────

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
   * If a mob is within `range` px and roughly in the player's facing direction
   * (dot product > 0.25), snaps the player's facing toward the nearest such mob.
   * Called before the player manually triggers an attack so the hit connects.
   */
  private snapFacingToNearestMob(player: HumanPlayer | CatPlayer, range: number) {
    const px = player.x + TILE_SIZE * 0.5;
    const py = player.y + TILE_SIZE * 0.5;
    let bestDist = range;
    let bestMob: Mob | null = null;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      const dx = (mob.x + TILE_SIZE * 0.5) - px;
      const dy = (mob.y + TILE_SIZE * 0.5) - py;
      const dist = Math.hypot(dx, dy);
      if (dist > range) continue;
      const dot = (dx / dist) * player.facingX + (dy / dist) * player.facingY;
      if (dot < 0.25) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestMob = mob;
      }
    }
    if (bestMob) {
      const dx = (bestMob.x + TILE_SIZE * 0.5) - px;
      const dy = (bestMob.y + TILE_SIZE * 0.5) - py;
      const d = Math.hypot(dx, dy);
      player.facingX = dx / d;
      player.facingY = dy / d;
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
    // Fill black so void/outside-map areas and canvas edges are always dark
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

    if (this.gameOver) {
      this.renderDeathScreen();
    }
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
    ctx.fillRect(8, 8, 340, 176);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`Playing as: ${activeLabel}`, 16, 28);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.fillText('WASD/Arrows: Move  |  Tab: Switch', 16, 46);
    ctx.fillText(`Space: ${atkLabel}  |  Q: Potion`, 16, 62);

    this.drawHUDPlayerBlock(ctx, activeLabel,   activePlayer,   16,  74);
    this.drawHUDPlayerBlock(ctx, inactiveLabel, inactivePlayer, 16, 128);
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

    // Stats + potions
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px monospace';
    ctx.fillText(
      `STR:${player.strength}  INT:${player.intelligence}  HP:${player.constitution}  🧪${player.healthPotions}`,
      barX, y2 + barH + 12,
    );
  }

  private loop() {
    if (!this.gameOver) this.update();
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Companion auto-potion
  // ─────────────────────────────────────────────────────────────────────────

  private updateCompanionPotion() {
    if (this.humanAutoPotionCooldown > 0) this.humanAutoPotionCooldown--;
    if (this.catAutoPotionCooldown > 0) this.catAutoPotionCooldown--;

    if (this.human.isActive) {
      // Cat is the inactive companion
      if (this.cat.isAlive && this.cat.hp < this.cat.maxHp * 0.5 && this.catAutoPotionCooldown === 0) {
        if (this.cat.usePotion()) this.catAutoPotionCooldown = 180;
      }
    } else {
      // Human is the inactive companion
      if (this.human.isAlive && this.human.hp < this.human.maxHp * 0.5 && this.humanAutoPotionCooldown === 0) {
        if (this.human.usePotion()) this.humanAutoPotionCooldown = 180;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Death screen + restart
  // ─────────────────────────────────────────────────────────────────────────

  private renderDeathScreen() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Fade in dark overlay
    if (this.deathOverlayAlpha < 0.82) this.deathOverlayAlpha = Math.min(0.82, this.deathOverlayAlpha + 0.018);
    ctx.fillStyle = `rgba(0,0,0,${this.deathOverlayAlpha})`;
    ctx.fillRect(0, 0, w, h);

    // Wait until overlay is visible enough before showing text
    if (this.deathOverlayAlpha < 0.45) return;
    const textAlpha = Math.min(1, (this.deathOverlayAlpha - 0.45) / 0.37);

    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = 'center';

    // "YOU DIED"
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 72px monospace';
    ctx.fillText('YOU DIED', w / 2, h / 2 - 52);

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px monospace';
    ctx.fillText('All stats and progress on this level are lost.', w / 2, h / 2 + 8);

    // Restart button
    const btnW = 210;
    const btnH = 48;
    const btnX = w / 2 - btnW / 2;
    const btnY = h / 2 + 44;
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    // Button border
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('Restart Level', w / 2, btnY + 30);

    ctx.restore();
  }

  private resetGame() {
    this.gameOver = false;
    this.deathOverlayAlpha = 0;
    this.keys.clear();

    this.gameMap = new GameMap(100, TILE_SIZE);
    const { x: sx, y: sy } = this.gameMap.startTile;

    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat   = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.catWanderTargetX = (sx + 1) * TILE_SIZE;
    this.catWanderTargetY = sy * TILE_SIZE;
    this.human.isActive = true;
    this.cat.isActive   = false;
    this.catKiteAngle   = 0;
    this.catWanderTimer = 0;

    this.mobs = [
      ...this.gameMap.mobSpawnPoints.map(({ x, y }) => spawnMob(x, y, this.gameMap)),
      ...this.gameMap.hallwaySpawnPoints.map(({ x, y }) => {
        const rat = new Rat(x, y, TILE_SIZE);
        rat.setMap(this.gameMap);
        return rat;
      }),
    ];
    this.cat.setMap(this.gameMap);

    this.humanAutoPotionCooldown = 0;
    this.catAutoPotionCooldown   = 0;
  }
}

new GameStage();
