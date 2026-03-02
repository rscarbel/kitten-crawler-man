import { Scene, SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import {
  TILE_SIZE,
  PLAYER_SPEED,
  FOLLOWER_SPEED,
  CAT_KITE_DIST,
  CAT_BEHIND_HUMAN_OFFSET,
  HUMAN_ENGAGE_RANGE,
} from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { Mob } from '../creatures/Mob';
import type { LevelDef } from '../levels/types';
import { spawnForLevel } from '../levels/spawner';
import { drawHUD } from '../ui/HUD';
import { PauseMenu } from '../ui/PauseMenu';
import { DeathScreen } from '../ui/DeathScreen';

export class DungeonScene extends Scene {
  private gameMap: GameMap;
  private human: HumanPlayer;
  private cat: CatPlayer;
  private mobs: Mob[];

  private pauseMenu: PauseMenu;
  private deathScreen: DeathScreen;
  private gameOver = false;

  /** Oscillation counter passed to HUD for the skill-point notification pulse. */
  private notifPulse = { value: 0 };

  // ── Cat idle-wander state ──────────────────────────────────────────────────
  private catWanderTargetX = 0;
  private catWanderTargetY = 0;
  private catWanderTimer = 0;
  /** Angle used by the cat's kiting orbit. Increments every frame. */
  private catKiteAngle = 0;

  // ── Companion auto-potion cooldowns (frames) ───────────────────────────────
  private humanAutoPotionCooldown = 0;
  private catAutoPotionCooldown = 0;

  // ── Action-key listeners registered in onEnter / removed in onExit ─────────
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private actionHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly levelDef: LevelDef,
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
  ) {
    super();
    this.gameMap = new GameMap(levelDef.mapSize, TILE_SIZE);
    const { x: sx, y: sy } = this.gameMap.startTile;

    this.human = new HumanPlayer(sx, sy, TILE_SIZE);
    this.cat = new CatPlayer(sx + 1, sy, TILE_SIZE);
    this.catWanderTargetX = (sx + 1) * TILE_SIZE;
    this.catWanderTargetY = sy * TILE_SIZE;
    this.human.isActive = true;

    this.mobs = spawnForLevel(levelDef, this.gameMap);
    this.cat.setMap(this.gameMap);

    this.pauseMenu = new PauseMenu();
    this.deathScreen = new DeathScreen();
  }

  // ── Scene lifecycle ─────────────────────────────────────────────────────────

  onEnter(): void {
    // Esc: toggle pause (independent of pause state check)
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (!this.gameOver) {
        this.pauseMenu.toggle();
        if (!this.pauseMenu.isOpen) this.input.clear();
      }
    };

    // Game action keys — suppressed while paused
    this.actionHandler = (e: KeyboardEvent) => {
      if (this.pauseMenu.isOpen) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        this.human.isActive = !this.human.isActive;
        this.cat.isActive = !this.cat.isActive;
        this.cat.autoTarget = null;
        this.human.autoTarget = null;
        return;
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
        return;
      }

      if ((e.key === 'q' || e.key === 'Q') && !e.repeat) {
        e.preventDefault();
        if (this.human.isActive) this.human.usePotion();
        else this.cat.usePotion();
      }
    };

    window.addEventListener('keydown', this.escHandler);
    window.addEventListener('keydown', this.actionHandler);
  }

  onExit(): void {
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    if (this.actionHandler)
      window.removeEventListener('keydown', this.actionHandler);
  }

  handleClick(mx: number, my: number): void {
    // Death screen takes priority
    if (this.gameOver) {
      if (this.deathScreen.handleClick(mx, my, this.sceneManager.canvas)) {
        this.sceneManager.replace(
          new DungeonScene(this.levelDef, this.input, this.sceneManager),
        );
      }
      return;
    }

    // Pause menu buttons
    if (this.pauseMenu.isOpen) {
      this.pauseMenu.handleClick(mx, my);
      return;
    }

    // Pause button (top-right corner)
    const pb = this.pauseButtonRect();
    if (mx >= pb.x && mx <= pb.x + pb.w && my >= pb.y && my <= pb.y + pb.h) {
      this.pauseMenu.toggle();
    }
  }

  // ── Main update / render ────────────────────────────────────────────────────

  update(): void {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    this.updateGameplay();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const canvas = this.sceneManager.canvas;
    const { x: camX, y: camY } = this.camera();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.gameMap.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);

    for (const mob of this.mobs) mob.render(ctx, camX, camY, TILE_SIZE);

    // Inactive companion renders behind active player
    this.inactive().render(ctx, camX, camY, TILE_SIZE);
    this.active().render(ctx, camX, camY, TILE_SIZE);

    this.renderLevelUpFlash(ctx, camX, camY);

    drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse);

    if (this.gameOver) {
      this.deathScreen.render(ctx, canvas);
    }

    if (this.pauseMenu.isOpen) {
      this.pauseMenu.render(ctx, canvas, this.human, this.cat);
    }

    this.drawPauseButton(ctx, canvas);
  }

  // ── Core gameplay update ────────────────────────────────────────────────────

  private updateGameplay(): void {
    const player = this.active();
    const mapPx = this.gameMap.structure.length * TILE_SIZE;

    let dx = 0;
    let dy = 0;
    if (this.input.has('ArrowUp') || this.input.has('w')) dy -= 1;
    if (this.input.has('ArrowDown') || this.input.has('s')) dy += 1;
    if (this.input.has('ArrowLeft') || this.input.has('a')) dx -= 1;
    if (this.input.has('ArrowRight') || this.input.has('d')) dx += 1;

    player.isMoving = dx !== 0 || dy !== 0;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }
    dx *= PLAYER_SPEED;
    dy *= PLAYER_SPEED;

    // Per-axis collision for the active player
    const nextX = Math.max(0, Math.min(mapPx - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXnext, tileYcur)) player.x = nextX;

    const nextY = Math.max(0, Math.min(mapPx - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE / 2) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
    if (this.gameMap.isWalkable(tileXcur, tileYnext)) player.y = nextY;

    // ── Follower movement ──────────────────────────────────────────────────
    if (this.human.isActive) {
      if (this.cat.autoTarget && this.cat.autoTarget.isAlive) {
        const enemy = this.cat.autoTarget as Mob;
        if (enemy.currentTarget === this.cat) {
          this.doCatKite(enemy);
        } else if (enemy.currentTarget === this.human) {
          this.doCatBehindHuman(enemy);
        } else {
          this.companionFollow(
            this.cat,
            enemy.x,
            enemy.y,
            FOLLOWER_SPEED,
            TILE_SIZE * 2.5,
          );
        }
      } else {
        this.catWanderTimer--;
        if (this.catWanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * TILE_SIZE;
          this.catWanderTargetX = this.human.x + Math.cos(angle) * radius;
          this.catWanderTargetY = this.human.y + Math.sin(angle) * radius;
          this.catWanderTimer = 160 + Math.floor(Math.random() * 240);
        }
        if (
          Math.hypot(this.cat.x - this.human.x, this.cat.y - this.human.y) >
          TILE_SIZE * 3.5
        ) {
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
      if (this.human.autoTarget && this.human.autoTarget.isAlive) {
        this.companionFollow(
          this.human,
          this.human.autoTarget.x,
          this.human.autoTarget.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 0.9,
        );
      } else {
        this.companionFollow(
          this.human,
          this.cat.x,
          this.cat.y,
          FOLLOWER_SPEED,
          TILE_SIZE * 1.8,
        );
      }
    }

    // ── Update attack / missile state ──────────────────────────────────────
    this.human.updateAttack();
    this.cat.updateMissiles();

    // ── Mob AI ────────────────────────────────────────────────────────────
    const playerTargets = [this.human, this.cat];
    for (const mob of this.mobs) {
      mob.updateAI(playerTargets);
      mob.tickTimers();
    }

    this.updateAutoAI();
    this.resolvePlayerAttacks();
    this.resolveKills();

    this.human.tickTimers();
    this.cat.tickTimers();

    this.updateCompanionPotion();

    // ── Death check ───────────────────────────────────────────────────────
    if (!this.human.isAlive || !this.cat.isAlive) {
      this.gameOver = true;
      this.deathScreen.activate();
    }
  }

  // ── Cat positioning helpers ─────────────────────────────────────────────────

  private doCatKite(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const cx = this.cat.x + TILE_SIZE * 0.5;
    const cy = this.cat.y + TILE_SIZE * 0.5;
    const distToEnemy = Math.hypot(cx - ex, cy - ey);

    this.catKiteAngle += 0.022;

    if (distToEnemy < CAT_KITE_DIST * 0.75) {
      if (distToEnemy > 0) {
        const nx = (cx - ex) / distToEnemy;
        const ny = (cy - ey) / distToEnemy;
        const cos = Math.cos(0.4),
          sin = Math.sin(0.4);
        const sx2 = nx * cos - ny * sin;
        const sy2 = nx * sin + ny * cos;
        this.entityMoveWithCollision(
          this.cat,
          sx2 * FOLLOWER_SPEED * 1.35,
          sy2 * FOLLOWER_SPEED * 1.35,
        );
        this.cat.isMoving = true;
      }
    } else {
      const targetX =
        ex + Math.cos(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      const targetY =
        ey + Math.sin(this.catKiteAngle) * CAT_KITE_DIST - TILE_SIZE * 0.5;
      this.companionFollow(
        this.cat,
        targetX,
        targetY,
        FOLLOWER_SPEED,
        TILE_SIZE * 0.5,
      );
    }
  }

  private doCatBehindHuman(enemy: Mob) {
    const ex = enemy.x + TILE_SIZE * 0.5;
    const ey = enemy.y + TILE_SIZE * 0.5;
    const hx = this.human.x + TILE_SIZE * 0.5;
    const hy = this.human.y + TILE_SIZE * 0.5;

    const dx = hx - ex;
    const dy = hy - ey;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const targetX = hx + nx * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    const targetY = hy + ny * CAT_BEHIND_HUMAN_OFFSET - TILE_SIZE * 0.5;
    this.companionFollow(
      this.cat,
      targetX,
      targetY,
      FOLLOWER_SPEED,
      TILE_SIZE * 0.5,
    );
  }

  // ── Companion AI ────────────────────────────────────────────────────────────

  private updateAutoAI() {
    if (this.human.isActive) {
      if (this.cat.autoTarget && !this.cat.autoTarget.isAlive)
        this.cat.autoTarget = null;

      const mobTargetingCat =
        this.mobs.find((m) => m.isAlive && m.currentTarget === this.cat) ??
        null;
      const mobTargetingHuman =
        this.mobs.find((m) => m.isAlive && m.currentTarget === this.human) ??
        null;

      if (mobTargetingCat) {
        this.cat.autoTarget = mobTargetingCat;
      } else if (!this.cat.autoTarget && mobTargetingHuman) {
        this.cat.autoTarget = mobTargetingHuman;
      }

      if (this.cat.autoTarget) this.cat.autoFireTick();
    } else {
      if (this.human.autoTarget && !this.human.autoTarget.isAlive)
        this.human.autoTarget = null;

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

      if (this.human.autoTarget) this.human.autoFightTick();
    }
  }

  private snapFacingToNearestMob(
    player: HumanPlayer | CatPlayer,
    range: number,
  ) {
    const px = player.x + TILE_SIZE * 0.5;
    const py = player.y + TILE_SIZE * 0.5;
    let bestDist = range;
    let bestMob: Mob | null = null;
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      const dx = mob.x + TILE_SIZE * 0.5 - px;
      const dy = mob.y + TILE_SIZE * 0.5 - py;
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
      const dx = bestMob.x + TILE_SIZE * 0.5 - px;
      const dy = bestMob.y + TILE_SIZE * 0.5 - py;
      const d = Math.hypot(dx, dy);
      player.facingX = dx / d;
      player.facingY = dy / d;
    }
  }

  // ── Combat resolution ───────────────────────────────────────────────────────

  private resolvePlayerAttacks() {
    const centerOf = (e: { x: number; y: number }) => ({
      x: e.x + TILE_SIZE * 0.5,
      y: e.y + TILE_SIZE * 0.5,
    });

    // Human melee — fires once at the peak frame
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
        const dot =
          (dx / dist) * this.human.facingX + (dy / dist) * this.human.facingY;
        if (dot <= 0.3) continue;
        if (!this.gameMap.hasLineOfSight(hc.x, hc.y, mc.x, mc.y)) continue;
        mob.takeDamageFrom(damage, this.human);
      }
    }

    // Cat missiles
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

  // ── Companion auto-potion ───────────────────────────────────────────────────

  private updateCompanionPotion() {
    if (this.humanAutoPotionCooldown > 0) this.humanAutoPotionCooldown--;
    if (this.catAutoPotionCooldown > 0) this.catAutoPotionCooldown--;

    if (this.human.isActive) {
      if (
        this.cat.isAlive &&
        this.cat.hp < this.cat.maxHp * 0.5 &&
        this.catAutoPotionCooldown === 0
      ) {
        if (this.cat.usePotion()) this.catAutoPotionCooldown = 180;
      }
    } else {
      if (
        this.human.isAlive &&
        this.human.hp < this.human.maxHp * 0.5 &&
        this.humanAutoPotionCooldown === 0
      ) {
        if (this.human.usePotion()) this.humanAutoPotionCooldown = 180;
      }
    }
  }

  // ── Movement / collision helpers ────────────────────────────────────────────

  private entityMoveWithCollision(
    entity: { x: number; y: number },
    dx: number,
    dy: number,
  ) {
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const ts = TILE_SIZE;
    if (dx !== 0) {
      const nextX = Math.max(0, Math.min(mapPx - ts, entity.x + dx));
      const tileXnext = Math.floor((nextX + ts / 2) / ts);
      const tileYcur = Math.floor((entity.y + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXnext, tileYcur)) entity.x = nextX;
    }
    if (dy !== 0) {
      const nextY = Math.max(0, Math.min(mapPx - ts, entity.y + dy));
      const tileXcur = Math.floor((entity.x + ts / 2) / ts);
      const tileYnext = Math.floor((nextY + ts / 2) / ts);
      if (this.gameMap.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
    }
  }

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
    this.entityMoveWithCollision(
      entity,
      (dx / dist) * step,
      (dy / dist) * step,
    );
    entity.isMoving = true;
  }

  // ── Camera ──────────────────────────────────────────────────────────────────

  private camera() {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPx = this.gameMap.structure.length * TILE_SIZE;
    const camX = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const camY = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x: Math.max(0, Math.min(mapPx - canvas.width, camX)),
      y: Math.max(0, Math.min(mapPx - canvas.height, camY)),
    };
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────

  private renderLevelUpFlash(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
  ) {
    for (const p of [this.human, this.cat] as const) {
      if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
      const alpha = p.levelUpFlash / 120;
      const rise = (1 - alpha) * 28;
      const sx = p.x - camX + TILE_SIZE / 2;
      const sy = p.y - camY - 12 - rise;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#facc15';
      ctx.fillText(`LEVEL UP! +${p.levelUpStat}`, sx, sy);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  private pauseButtonRect() {
    return {
      x: this.sceneManager.canvas.width - 84,
      y: 8,
      w: 76,
      h: 28,
    };
  }

  private drawPauseButton(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ) {
    if (this.gameOver || this.pauseMenu.isOpen) return;
    const pb = this.pauseButtonRect();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Pause (Esc)', pb.x + pb.w / 2, pb.y + pb.h / 2 + 4);
    ctx.textAlign = 'left';
  }

  // ── Convenience accessors ───────────────────────────────────────────────────

  private active(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.human : this.cat;
  }

  private inactive(): HumanPlayer | CatPlayer {
    return this.human.isActive ? this.cat : this.human;
  }
}
