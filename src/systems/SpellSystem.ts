import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';

interface ActiveShell {
  x: number;
  y: number;
  radiusPx: number;
  framesRemaining: number;
  totalFrames: number;
  didInitialDamage: boolean;
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
  private activeFogs: ActiveFog[] = [];
  private shellOwner: HumanPlayer | null = null;

  /** Reusable Set to avoid allocating per queryCircle call each frame. */
  private readonly _querySet = new Set<Mob>();

  private readonly SHELL_COOLDOWN = 7200; // 2 min @ 60 fps
  private readonly SHELL_DURATION = 1200; // 20 s  @ 60 fps

  get shellCooldown(): number {
    return this._shellCooldown;
  }

  get shellCooldownMax(): number {
    return this.SHELL_COOLDOWN;
  }

  triggerProtectiveShell(human: HumanPlayer, mobGrid: SpatialGrid<Mob>): void {
    if (this._shellCooldown > 0) return;
    const radiusTiles = 3 + human.intelligence * 0.5;
    const radiusPx = radiusTiles * TILE_SIZE;
    this.activeShell = {
      x: human.x + TILE_SIZE * 0.5,
      y: human.y + TILE_SIZE * 0.5,
      radiusPx,
      framesRemaining: this.SHELL_DURATION,
      totalFrames: this.SHELL_DURATION,
      didInitialDamage: false,
    };
    this._shellCooldown = this.SHELL_COOLDOWN;
    this.shellOwner = human;
    this.pushMobsFromShell(mobGrid);
  }

  castConfusingFog(caster: HumanPlayer | CatPlayer): void {
    if (!caster.inventory.removeOne('scroll_of_confusing_fog')) return;
    const radiusPx = (3 + caster.intelligence * 0.5) * TILE_SIZE;
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
    const { mobs, mobGrid } = ctx;
    if (this._shellCooldown > 0) this._shellCooldown--;
    if (this.activeShell) {
      this.activeShell.framesRemaining--;
      this.pushMobsFromShell(mobGrid);
      if (this.activeShell.framesRemaining <= 0) {
        this.activeShell = null;
        this.shellOwner = null;
      }
    }

    // Reset confusion, then re-mark mobs inside active fogs
    for (const mob of mobs) mob.isConfused = false;
    for (let fi = this.activeFogs.length - 1; fi >= 0; fi--) {
      const fog = this.activeFogs[fi];
      fog.framesLeft--;
      if (fog.framesLeft <= 0) {
        this.activeFogs.splice(fi, 1);
        continue;
      }
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
    }
  }

  private pushMobsFromShell(mobGrid: SpatialGrid<Mob>): void {
    if (!this.activeShell) return;
    const { x, y, radiusPx } = this.activeShell;
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
        const ox = mob.x,
          oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const push = radiusPx - dist + 2;
        mob.x += nx * push;
        mob.y += ny * push;
        if (this.shellOwner && !this.activeShell.didInitialDamage) {
          mob.takeDamageFrom(3, this.shellOwner);
        }
        mobGrid.move(mob, ox, oy);
      }
    }
    this.activeShell.didInitialDamage = true;
  }

  renderShell(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.activeShell) return;
    const { x, y, radiusPx, framesRemaining, totalFrames } = this.activeShell;
    const sx = x - camX;
    const sy = y - camY;

    // Offscreen culling
    const extent = radiusPx + 25; // 25 = max glow offset (i*5 at i=4 + lineWidth)
    if (
      sx + extent < 0 ||
      sy + extent < 0 ||
      sx - extent > ctx.canvas.width ||
      sy - extent > ctx.canvas.height
    )
      return;

    const fadeIn = Math.min(1, (totalFrames - framesRemaining) / 30);
    const fadeOut = Math.min(1, framesRemaining / 60);
    const alpha = Math.min(fadeIn, fadeOut);

    ctx.save();

    for (let i = 4; i >= 1; i--) {
      ctx.globalAlpha = alpha * (0.06 * i);
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = i * 3;
      ctx.beginPath();
      ctx.arc(sx, sy, radiusPx + i * 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const pulse = 0.7 + 0.3 * Math.sin(framesRemaining * 0.12);
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.06;
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    const secs = Math.ceil(framesRemaining / 60);
    ctx.fillText(`${secs}s`, sx, sy - radiusPx - 6);
    ctx.textAlign = 'left';

    ctx.restore();
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

      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#d0d0e0';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(fog.framesLeft / 60)}s`, cx, cy - fog.radiusPx - 6);
      ctx.textAlign = 'left';

      ctx.restore();
    }
  }
}
