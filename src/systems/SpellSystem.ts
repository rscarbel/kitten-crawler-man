import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { getProtectiveShellStats, type ProtectiveShellStats } from '../abilities/protectiveShell';
import { normalize } from '../utils';
import { drawText } from '../ui/TextBox';
import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

interface ActiveShell {
  x: number;
  y: number;
  radiusPx: number;
  framesRemaining: number;
  totalFrames: number;
  didInitialDamage: boolean;
  abilityLevel: number;
  catWasInside: boolean;
  continuousDamageThrottle: number;
  /** Mobs pushed at least once this cast (for touch-XP tracking). */
  touchedMobIds: Set<Mob>;
}

interface MiniShell {
  /** Center x in world pixels (follows cat). */
  framesRemaining: number; // 180 frames = 3 seconds
  radiusPx: number;
}

interface ChainLightningBolt {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  framesLeft: number;
}

interface ShockwaveRipple {
  x: number;
  y: number;
  maxRadius: number;
  currentRadius: number;
  framesLeft: number;
  totalFrames: number;
}

interface ActiveFog {
  owner: HumanPlayer | CatPlayer;
  x: number;
  y: number;
  framesLeft: number;
  totalFrames: number;
  radiusPx: number;
  /** Pre-rendered fog cloud texture (drawn once at cast time). */
  cachedCanvas: HTMLCanvasElement;
  cachedSize: number;
}

const CLOUD_BLOBS = [
  { dx: 0.0, dy: 0.0, sr: 0.44 },
  { dx: 0.38, dy: -0.28, sr: 0.37 },
  { dx: -0.38, dy: -0.22, sr: 0.35 },
  { dx: 0.52, dy: 0.22, sr: 0.31 },
  { dx: -0.5, dy: 0.28, sr: 0.32 },
  { dx: 0.18, dy: 0.48, sr: 0.3 },
  { dx: -0.22, dy: 0.44, sr: 0.28 },
  { dx: 0.42, dy: -0.46, sr: 0.27 },
  { dx: -0.42, dy: -0.42, sr: 0.25 },
];

// On mobile, use fewer blobs to reduce the offscreen-canvas render cost
const FOG_BLOBS = platform.isMobile ? CLOUD_BLOBS.slice(0, 5) : CLOUD_BLOBS;

/** Pre-render the fog cloud texture to an offscreen canvas (called once per fog). */
function bakeFogCloud(radiusPx: number): { canvas: HTMLCanvasElement; size: number } {
  const margin = 4;
  const size = Math.ceil(radiusPx * 2 + margin * 2);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const center = size * 0.5;

  if (ctx === null) {
    throw new Error('2d context cannot be found');
  }

  for (const blob of FOG_BLOBS) {
    const bx = center + blob.dx * radiusPx;
    const by = center + blob.dy * radiusPx;
    const br = blob.sr * radiusPx;
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    grad.addColorStop(0, 'rgba(215, 215, 225, 0.72)');
    grad.addColorStop(0.55, 'rgba(200, 200, 215, 0.45)');
    grad.addColorStop(1, 'rgba(185, 185, 205, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  return { canvas, size };
}

export class SpellSystem implements GameSystem {
  private activeShell: ActiveShell | null = null;
  private _shellCooldown = 0;
  private _shellCooldownMax = 7200;
  private activeFogs: ActiveFog[] = [];
  private shellOwner: HumanPlayer | null = null;
  private catMiniShell: MiniShell | null = null;
  private chainLightningBolts: ChainLightningBolt[] = [];
  private shockwaveRipples: ShockwaveRipple[] = [];

  /** Touch XP pending drain by DungeonScene (1 per unique mob pushed). */
  private _pendingTouchXp = 0;

  /** Block XP pending drain — incremented each time the shell deflects a projectile or tongue. */
  private _pendingBlockXp = 0;

  /** Pending shockwave event for level-15 shell expiry. */
  private _pendingShockwave: { x: number; y: number; radiusPx: number } | null = null;

  /** Pending chain lightning origin points (mob died inside shell). */
  private _pendingChainLightningOrigins: Array<{ x: number; y: number }> = [];

  /** Reusable Set to avoid allocating per queryCircle call each frame. */
  private readonly _querySet = new Set<Mob>();

  get shellCooldown(): number {
    return this._shellCooldown;
  }

  get shellCooldownMax(): number {
    return this._shellCooldownMax;
  }

  get activeShellLevel(): number {
    return this.activeShell?.abilityLevel ?? 0;
  }

  /** Returns true if the tile-top-left point (px, py) is inside the active shell. */
  isInsideShell(px: number, py: number): boolean {
    if (!this.activeShell) return false;
    const { x, y, radiusPx } = this.activeShell;
    const cx = px + TILE_SIZE * 0.5;
    const cy = py + TILE_SIZE * 0.5;
    return Math.hypot(cx - x, cy - y) < radiusPx;
  }

  drainTouchXp(): number {
    const v = this._pendingTouchXp;
    this._pendingTouchXp = 0;
    return v;
  }

  /** True if the given center point (world pixels) is inside the active shell. */
  isPointInsideShell(cx: number, cy: number): boolean {
    if (!this.activeShell) return false;
    return Math.hypot(cx - this.activeShell.x, cy - this.activeShell.y) < this.activeShell.radiusPx;
  }

  /** Called by mobs when the shell deflects one of their attacks. */
  addBlockXp(amount: number): void {
    this._pendingBlockXp += amount;
  }

  drainBlockXp(): number {
    const v = this._pendingBlockXp;
    this._pendingBlockXp = 0;
    return v;
  }

  drainPendingShockwave(): { x: number; y: number; radiusPx: number } | null {
    const v = this._pendingShockwave;
    this._pendingShockwave = null;
    return v;
  }

  drainChainLightningOrigins(): Array<{ x: number; y: number }> {
    const v = this._pendingChainLightningOrigins;
    this._pendingChainLightningOrigins = [];
    return v;
  }

  /** Queue a chain lightning origin (called from DungeonScene when a mob dies inside the shell). */
  addChainLightningOrigin(x: number, y: number): void {
    this._pendingChainLightningOrigins.push({ x, y });
  }

  /** Add a visual bolt for the chain lightning effect. */
  addChainLightningBolt(fromX: number, fromY: number, toX: number, toY: number): void {
    this.chainLightningBolts.push({ fromX, fromY, toX, toY, framesLeft: 20 });
  }

  /** Add an expanding shockwave ring for visual effect. */
  addShockwaveRipple(x: number, y: number, radiusPx: number): void {
    this.shockwaveRipples.push({
      x,
      y,
      maxRadius: radiusPx + TILE_SIZE * 2,
      currentRadius: radiusPx * 0.5,
      framesLeft: 40,
      totalFrames: 40,
    });
  }

  /**
   * Attempt to activate the protective shell.
   * @returns true if the shell was successfully triggered (i.e. not on cooldown).
   */
  triggerProtectiveShell(
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
    abilityLevel: number,
  ): boolean {
    if (this._shellCooldown > 0) return false;

    const stats = getProtectiveShellStats(abilityLevel);
    const radiusPx = stats.radiusTiles * TILE_SIZE;
    const shellX = human.x + TILE_SIZE * 0.5;
    const shellY = human.y + TILE_SIZE * 0.5;

    this.activeShell = {
      x: shellX,
      y: shellY,
      radiusPx,
      framesRemaining: stats.durationFrames,
      totalFrames: stats.durationFrames,
      didInitialDamage: false,
      abilityLevel,
      catWasInside: false,
      continuousDamageThrottle: 0,
      touchedMobIds: new Set<Mob>(),
    };

    this._shellCooldown = stats.cooldownFrames;
    this._shellCooldownMax = stats.cooldownFrames;
    this.shellOwner = human;

    // Level 15: instant ally heal + clear status effects
    if (stats.isFullPower) {
      human.hp = human.maxHp;
      human.statusEffects = [];
      cat.hp = cat.maxHp;
      cat.statusEffects = [];
    }

    const shell = this.activeShell;
    const catDist = Math.hypot(cat.x + TILE_SIZE * 0.5 - shellX, cat.y + TILE_SIZE * 0.5 - shellY);
    shell.catWasInside = catDist < radiusPx;

    this.pushMobsFromShell(mobGrid, stats);

    return true;
  }

  castConfusingFog(caster: HumanPlayer | CatPlayer): void {
    if (!caster.inventory.removeOne('scroll_of_confusing_fog')) return;
    const MAX_FOG_RADIUS_TILES = 16; // 32-tile diameter cap
    const radiusPx = Math.min(
      (3 + caster.intelligence * 0.5) * TILE_SIZE,
      MAX_FOG_RADIUS_TILES * TILE_SIZE,
    );
    const totalFrames = caster.intelligence * 5 * 60;
    const { canvas, size } = bakeFogCloud(radiusPx);
    this.activeFogs.push({
      owner: caster,
      x: caster.x + TILE_SIZE * 0.5,
      y: caster.y + TILE_SIZE * 0.5,
      framesLeft: totalFrames,
      totalFrames,
      radiusPx,
      cachedCanvas: canvas,
      cachedSize: size,
    });
  }

  /** Called every gameplay frame. Ticks cooldowns, pushes shell mobs, marks confused mobs. */
  update(ctx: SystemContext): void {
    const { mobs, mobGrid, cat, human } = ctx;

    if (this._shellCooldown > 0) this._shellCooldown--;

    if (this.activeShell) {
      // Clear heal boost from previous frame; re-applied below if ally is still inside
      cat.clearRegenModifier('shell');
      human.clearRegenModifier('shell');

      const shell = this.activeShell;
      const stats = getProtectiveShellStats(shell.abilityLevel);

      shell.framesRemaining--;

      // Push mobs outward every frame
      this.pushMobsFromShell(mobGrid, stats);

      // Level 10+: boost healing for allies inside the shell
      const catCx = cat.x + TILE_SIZE * 0.5;
      const catCy = cat.y + TILE_SIZE * 0.5;
      const catDist = Math.hypot(catCx - shell.x, catCy - shell.y);
      const catIsInside = catDist < shell.radiusPx;
      const humanDist = Math.hypot(
        human.x + TILE_SIZE * 0.5 - shell.x,
        human.y + TILE_SIZE * 0.5 - shell.y,
      );
      const humanIsInside = humanDist < shell.radiusPx;

      if (stats.allyHealingMultiplier > 1) {
        if (catIsInside) cat.setRegenModifier('shell', stats.allyHealingMultiplier);
        if (humanIsInside) human.setRegenModifier('shell', stats.allyHealingMultiplier);
      }

      // Level 14+: mini-shield for cat when it exits the shell
      if (stats.miniShieldEnabled) {
        if (shell.catWasInside && !catIsInside) {
          // Cat just left — give it a mini-shell
          this.catMiniShell = { framesRemaining: 180, radiusPx: TILE_SIZE * 1.5 };
        }
        shell.catWasInside = catIsInside;
      }

      // Level 14+: continuous boundary damage (every 60 frames)
      if (stats.continuousDamageEnabled) {
        shell.continuousDamageThrottle++;
        if (shell.continuousDamageThrottle >= 60) {
          shell.continuousDamageThrottle = 0;
          this._querySet.clear();
          const boundaryMobs = mobGrid.queryCircle(
            shell.x,
            shell.y,
            shell.radiusPx + TILE_SIZE,
            this._querySet,
          );
          for (const mob of boundaryMobs) {
            if (!mob.isAlive) continue;
            const dx = mob.x + TILE_SIZE * 0.5 - shell.x;
            const dy = mob.y + TILE_SIZE * 0.5 - shell.y;
            const dist = Math.hypot(dx, dy);
            // "On the boundary" = within 1 tile outside the shell edge
            if (dist >= shell.radiusPx && dist < shell.radiusPx + TILE_SIZE) {
              mob.takeDamageFrom(1, this.shellOwner, 'shell');
            }
          }
        }
      }

      // Level 15+: magic protection — continuously clear magic-type status effects from human
      if (stats.isFullPower) {
        human.statusEffects = human.statusEffects.filter(
          (e) => e.type !== 'magic_burn' && e.type !== 'electrified',
        );
      }

      if (shell.framesRemaining <= 0) {
        cat.clearRegenModifier('shell');
        human.clearRegenModifier('shell');
        if (stats.isFullPower) {
          this._pendingShockwave = { x: shell.x, y: shell.y, radiusPx: shell.radiusPx };
        }
        this.activeShell = null;
        this.shellOwner = null;
      }
    }

    // Tick cat mini-shell
    if (this.catMiniShell) {
      this.catMiniShell.framesRemaining--;

      // Push mobs away from cat center using the mini-shell
      const miniRadius = this.catMiniShell.radiusPx;
      this._querySet.clear();
      const catCx = cat.x + TILE_SIZE * 0.5;
      const catCy = cat.y + TILE_SIZE * 0.5;
      const nearMobs = mobGrid.queryCircle(catCx, catCy, miniRadius + TILE_SIZE, this._querySet);
      for (const mob of nearMobs) {
        if (!mob.isAlive) continue;
        const mcx = mob.x + TILE_SIZE * 0.5;
        const mcy = mob.y + TILE_SIZE * 0.5;
        const dx = mcx - catCx;
        const dy = mcy - catCy;
        const dist = Math.hypot(dx, dy);
        if (dist < miniRadius) {
          const ox = mob.x;
          const oy = mob.y;
          const nx = dist > 0 ? dx / dist : 1;
          const ny = dist > 0 ? dy / dist : 0;
          const push = miniRadius - dist + 2;
          mob.x += nx * push;
          mob.y += ny * push;
          mobGrid.move(mob, ox, oy);
        }
      }

      if (this.catMiniShell.framesRemaining <= 0) {
        this.catMiniShell = null;
      }
    }

    // Tick chain lightning bolts (visual only) — iterate backwards to allow splice
    this.chainLightningBolts = this.chainLightningBolts.filter((bolt) => {
      bolt.framesLeft--;
      return bolt.framesLeft > 0;
    });

    // Tick shockwave ripples (visual only)
    this.shockwaveRipples = this.shockwaveRipples.filter((ripple) => {
      ripple.framesLeft--;
      ripple.currentRadius +=
        (ripple.maxRadius - ripple.currentRadius) / Math.max(1, ripple.framesLeft);
      return ripple.framesLeft > 0;
    });

    // Reset confusion, then re-mark mobs inside active fogs
    for (const mob of mobs) mob.isConfused = false;
    this.activeFogs = this.activeFogs.filter((fog) => {
      fog.framesLeft--;
      if (fog.framesLeft <= 0) return false;
      this._querySet.clear();
      const inFog = mobGrid.queryCircle(fog.x, fog.y, fog.radiusPx + TILE_SIZE, this._querySet);
      const rSq = fog.radiusPx * fog.radiusPx;
      for (const mob of inFog) {
        if (!mob.isAlive) continue;
        const dx = mob.x + TILE_SIZE * 0.5 - fog.x;
        const dy = mob.y + TILE_SIZE * 0.5 - fog.y;
        if (dx * dx + dy * dy <= rSq) {
          mob.isConfused = true;
        }
      }
      return true;
    });
  }

  private pushMobsFromShell(mobGrid: SpatialGrid<Mob>, stats: ProtectiveShellStats): void {
    if (!this.activeShell) return;
    const shell = this.activeShell;
    const { x, y, radiusPx } = shell;

    this._querySet.clear();
    const nearShell = mobGrid.queryCircle(x, y, radiusPx + TILE_SIZE, this._querySet);
    for (const mob of nearShell) {
      if (!mob.isAlive) continue;
      const mcx = mob.x + TILE_SIZE * 0.5;
      const mcy = mob.y + TILE_SIZE * 0.5;
      const dx = mcx - x;
      const dy = mcy - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radiusPx) {
        const ox = mob.x;
        const oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const push = radiusPx - dist + 2;
        mob.x += nx * push;
        mob.y += ny * push;

        // Expansion damage: only on the very first push frame (initial cast)
        if (!shell.didInitialDamage && stats.expandDamageEnabled) {
          mob.takeDamageFrom(stats.expandDamage, this.shellOwner, 'shell');
        }

        // Track unique mobs touched for XP
        if (!shell.touchedMobIds.has(mob)) {
          shell.touchedMobIds.add(mob);
          this._pendingTouchXp++;
        }

        mobGrid.move(mob, ox, oy);
      } else if (dist < radiusPx + 4) {
        // Thin outer buffer: push mobs back so they can't re-enter from outside
        const ox = mob.x;
        const oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        mob.x += nx * (radiusPx + 4 - dist);
        mob.y += ny * (radiusPx + 4 - dist);
        mobGrid.move(mob, ox, oy);
      }
    }
    shell.didInitialDamage = true;
  }

  renderShell(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.activeShell) return;
    const { x, y, radiusPx, framesRemaining, totalFrames, abilityLevel } = this.activeShell;
    const sx = x - camX;
    const sy = y - camY;
    const isFullPower = abilityLevel >= 15;

    // Offscreen culling
    const extent = radiusPx + 25;
    if (
      sx + extent < 0 ||
      sy + extent < 0 ||
      sx - extent > ctx.canvas.width ||
      sy - extent > ctx.canvas.height
    )
      return;

    const elapsed = (totalFrames - framesRemaining) / 60;
    const fadeIn = Math.min(1, (totalFrames - framesRemaining) / 30);
    const fadeOut = Math.min(1, framesRemaining / 60);
    const alpha = Math.min(fadeIn, fadeOut);

    const appearing = totalFrames - framesRemaining < 30;
    const expiring = framesRemaining < 60;

    let state: SpriteStates['protective_shell'];
    let frame: number;
    if (appearing) {
      state = isFullPower ? 'appear_full_power' : 'appear';
      frame = progressFrameIndex((totalFrames - framesRemaining) / 30, 8);
    } else if (expiring) {
      state = 'expire';
      frame = progressFrameIndex(1 - framesRemaining / 60, 8);
    } else {
      state = isFullPower ? 'full_power' : 'active';
      frame = timeFrameIndex(elapsed, 8, 8);
    }

    // tileSize chosen so frameWidth * (tileSize/tileScale) = radiusPx * 2
    // protective_shell: frameWidth=400, tileScale=32 → tileSize = radiusPx * 64 / 400
    const tileSize = (radiusPx * 64) / 400;
    drawSpriteKey(ctx, 'protective_shell', state, frame, sx, sy, tileSize, { alpha });

    const secs = Math.ceil(framesRemaining / 60);
    const timerColor = isFullPower ? '#fbbf24' : '#93c5fd';
    drawText(ctx, `${secs}s`, {
      x: sx,
      y: sy - radiusPx - 14,
      size: 10,
      bold: true,
      color: timerColor,
      alpha: alpha * 0.8,
      align: 'center',
    });
  }

  renderCatMiniShell(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cat: CatPlayer,
  ): void {
    if (!this.catMiniShell) return;
    const { framesRemaining, radiusPx } = this.catMiniShell;
    const sx = cat.x + TILE_SIZE * 0.5 - camX;
    const sy = cat.y + TILE_SIZE * 0.5 - camY;

    const miniTotalFrames = 180;
    const elapsed = (miniTotalFrames - framesRemaining) / 60;
    const fadeOut = Math.min(1, framesRemaining / 30);
    const alpha = fadeOut * 0.7;
    const frame = timeFrameIndex(elapsed, 8, 8);

    // protective_shell_mini: frameWidth=192, tileScale=32 → tileSize = radiusPx * 64 / 192
    const tileSize = (radiusPx * 64) / 192;
    drawSpriteKey(ctx, 'protective_shell_mini', 'active', frame, sx, sy, tileSize, { alpha });
  }

  renderChainLightning(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.chainLightningBolts.length === 0) return;
    ctx.save();
    for (const bolt of this.chainLightningBolts) {
      const alpha = bolt.framesLeft / 20;
      const fromSx = bolt.fromX - camX;
      const fromSy = bolt.fromY - camY;
      const toSx = bolt.toX - camX;
      const toSy = bolt.toY - camY;

      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();

      // Jittered midpoints simulate a non-linear lightning arc
      const { x: perpX, y: perpY } = normalize(-(toSy - fromSy), toSx - fromSx);
      const steps = 5;
      ctx.moveTo(fromSx, fromSy);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const mx = fromSx + (toSx - fromSx) * t;
        const my = fromSy + (toSy - fromSy) * t;
        const jitter = (Math.random() - 0.5) * 8;
        ctx.lineTo(mx + perpX * jitter, my + perpY * jitter);
      }
      ctx.lineTo(toSx, toSy);
      ctx.stroke();

      // White core
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  renderShockwaveRipples(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.shockwaveRipples.length === 0) return;
    for (const ripple of this.shockwaveRipples) {
      if (ripple.currentRadius < 1) continue;
      const sx = ripple.x - camX;
      const sy = ripple.y - camY;
      const alpha = (ripple.framesLeft / ripple.totalFrames) * 0.7;
      const progress = 1 - ripple.framesLeft / ripple.totalFrames;
      const frame = progressFrameIndex(progress, 8);

      // protective_shell_shockwave: frameWidth=480, tileScale=32 → tileSize = currentRadius * 64 / 480
      const tileSize = (ripple.currentRadius * 64) / 480;
      drawSpriteKey(ctx, 'protective_shell_shockwave', 'expand', frame, sx, sy, tileSize, {
        alpha,
      });
    }
  }

  renderFogs(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    for (const fog of this.activeFogs) {
      const cx = fog.x - camX;
      const cy = fog.y - camY;
      const half = fog.cachedSize * 0.5;

      // Offscreen culling
      if (cx + half < 0 || cy + half < 0 || cx - half > cw || cy - half > ch) continue;

      const fadeIn = Math.min(1, (fog.totalFrames - fog.framesLeft) / 40);
      const fadeOut = Math.min(1, fog.framesLeft / 60);
      const alpha = Math.min(fadeIn, fadeOut);
      const pulse = 0.92 + 0.08 * Math.sin(fog.framesLeft * 0.04);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        fog.cachedCanvas,
        cx - half * pulse,
        cy - half * pulse,
        fog.cachedSize * pulse,
        fog.cachedSize * pulse,
      );
      ctx.restore();

      // Timer countdown above fog: size=10, old baseline = cy - fog.radiusPx - 6
      // top = (cy - fog.radiusPx - 6) - round(10*0.8) = (cy - fog.radiusPx - 6) - 8 = cy - fog.radiusPx - 14
      drawText(ctx, `${Math.ceil(fog.framesLeft / 60)}s`, {
        x: cx,
        y: cy - fog.radiusPx - 14,
        size: 10,
        bold: true,
        color: '#d0d0e0',
        alpha: alpha * 0.8,
        align: 'center',
      });
    }
  }
}
