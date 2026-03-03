import { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  drawDynamiteFloorSprite,
  drawDynamiteExplosion,
  drawDynamiteChargeBar,
} from '../sprites/dynamiteSprite';

// ── Goblin Dynamite constants ─────────────────────────────────────────────────
export const DYN_MAX_CHARGE = 120; // 2 s at 60 fps → full throw
export const DYN_DANGER = 240; // 4 s → charge bar turns red
const DYN_EXPLODE_HAND = 300; // 5 s → boom in hand
const DYN_FUSE = 300; // 5 s fuse after thrown/dropped
const DYN_TAP = 8; // frames: release faster than this = tap (drop at feet)
const DYN_SPEED_MIN = 2.0;
const DYN_SPEED_MAX = 21.0;
const DYN_BOUNCE = 0.6; // velocity fraction kept after wall bounce
const DYN_FRICTION = 0.88; // per-frame speed multiplier
const DYN_STOP = 0.08; // px/frame below which dynamite is considered stopped
const DYN_RADIUS = TILE_SIZE * 3; // AoE explosion radius (96 px)
const DYN_DAMAGE = 8; // damage dealt to all entities in radius
const DYN_ANIM_FRAMES = 45; // explosion animation duration

interface LiveDynamite {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseFrames: number;
  state: 'flying' | 'sliding' | 'stopped' | 'exploding';
  explodeTimer: number;
}

export class DynamiteSystem {
  private _charging: { hotbarIdx: number; chargeFrames: number } | null = null;
  private liveDynamites: LiveDynamite[] = [];

  constructor(private readonly gameMap: GameMap) {}

  get isCharging(): boolean {
    return this._charging !== null;
  }

  get chargeFrames(): number {
    return this._charging?.chargeFrames ?? 0;
  }

  get chargingHotbarIdx(): number | null {
    return this._charging?.hotbarIdx ?? null;
  }

  beginCharge(hotbarIdx: number): void {
    this._charging = { hotbarIdx, chargeFrames: 0 };
  }

  release(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    if (!this._charging) return;
    const { chargeFrames } = this._charging;
    this._charging = null;

    if (!human.inventory.removeOne('goblin_dynamite')) return;

    const isTap = chargeFrames < DYN_TAP;
    const chargeRatio = Math.min(1, chargeFrames / DYN_MAX_CHARGE);
    const speed = isTap
      ? 0
      : DYN_SPEED_MIN + (DYN_SPEED_MAX - DYN_SPEED_MIN) * chargeRatio;

    this.liveDynamites.push({
      x: human.x + TILE_SIZE * 0.5,
      y: human.y + TILE_SIZE * 0.5,
      vx: human.facingX * speed,
      vy: human.facingY * speed,
      fuseFrames: DYN_FUSE,
      state: isTap ? 'stopped' : 'flying',
      explodeTimer: 0,
    });
    void cat;
    void mobs;
    void mobGrid;
  }

  update(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    if (this._charging) {
      this._charging.chargeFrames++;
      if (this._charging.chargeFrames >= DYN_EXPLODE_HAND) {
        this.explodeInHand(human, cat, mobs, mobGrid);
        return;
      }
    }
    this.updatePhysics(human, cat, mobs, mobGrid);
  }

  private explodeInHand(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    this._charging = null;
    const cx = human.x + TILE_SIZE * 0.5;
    const cy = human.y + TILE_SIZE * 0.5;
    this.triggerExplosion(cx, cy, human, cat, mobs, mobGrid);
    this.liveDynamites.push({
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      fuseFrames: 0,
      state: 'exploding',
      explodeTimer: DYN_ANIM_FRAMES,
    });
  }

  private triggerExplosion(
    cx: number,
    cy: number,
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    const ts = TILE_SIZE;
    const nearBlast = mobGrid.queryCircle(cx, cy, DYN_RADIUS + ts);
    for (const mob of nearBlast) {
      if (!mob.isAlive) continue;
      if (
        Math.hypot(mob.x + ts * 0.5 - cx, mob.y + ts * 0.5 - cy) <= DYN_RADIUS
      ) {
        mob.takeDamageFrom(DYN_DAMAGE, human);
      }
    }
    void mobs;
    if (
      Math.hypot(human.x + ts * 0.5 - cx, human.y + ts * 0.5 - cy) <= DYN_RADIUS
    ) {
      human.takeDamage(DYN_DAMAGE);
    }
    if (
      Math.hypot(cat.x + ts * 0.5 - cx, cat.y + ts * 0.5 - cy) <= DYN_RADIUS
    ) {
      cat.takeDamage(DYN_DAMAGE);
    }
  }

  private updatePhysics(
    human: HumanPlayer,
    cat: CatPlayer,
    mobs: Mob[],
    mobGrid: SpatialGrid<Mob>,
  ): void {
    for (const dyn of this.liveDynamites) {
      if (dyn.state === 'exploding') {
        dyn.explodeTimer--;
        continue;
      }

      dyn.fuseFrames--;
      if (dyn.fuseFrames <= 0) {
        dyn.state = 'exploding';
        dyn.explodeTimer = DYN_ANIM_FRAMES;
        this.triggerExplosion(dyn.x, dyn.y, human, cat, mobs, mobGrid);
        continue;
      }

      if (dyn.state === 'flying' || dyn.state === 'sliding') {
        const nextX = dyn.x + dyn.vx;
        const txX = Math.floor(nextX / TILE_SIZE);
        const ty = Math.floor(dyn.y / TILE_SIZE);
        if (!this.gameMap.isWalkable(txX, ty)) {
          dyn.vx = -dyn.vx * DYN_BOUNCE;
        } else {
          dyn.x = nextX;
        }

        const nextY = dyn.y + dyn.vy;
        const tx = Math.floor(dyn.x / TILE_SIZE);
        const tyY = Math.floor(nextY / TILE_SIZE);
        if (!this.gameMap.isWalkable(tx, tyY)) {
          dyn.vy = -dyn.vy * DYN_BOUNCE;
        } else {
          dyn.y = nextY;
        }

        dyn.vx *= DYN_FRICTION;
        dyn.vy *= DYN_FRICTION;
        const spd = Math.hypot(dyn.vx, dyn.vy);
        if (spd < DYN_STOP) {
          dyn.state = 'stopped';
          dyn.vx = 0;
          dyn.vy = 0;
        } else if (spd < 1.5) {
          dyn.state = 'sliding';
        }
      }
    }

    this.liveDynamites = this.liveDynamites.filter(
      (d) => !(d.state === 'exploding' && d.explodeTimer <= 0),
    );
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const dyn of this.liveDynamites) {
      const sx = dyn.x - camX;
      const sy = dyn.y - camY;
      if (dyn.state !== 'exploding') {
        drawDynamiteFloorSprite(
          ctx,
          sx - TILE_SIZE * 0.5,
          sy - TILE_SIZE * 0.5,
          TILE_SIZE,
          dyn.fuseFrames,
          DYN_FUSE,
        );
      } else {
        drawDynamiteExplosion(
          ctx,
          sx,
          sy,
          TILE_SIZE,
          dyn.explodeTimer,
          DYN_ANIM_FRAMES,
          DYN_RADIUS,
        );
      }
    }
  }

  renderChargeBar(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
  ): void {
    if (!this._charging) return;
    const ratio = Math.min(1, this._charging.chargeFrames / DYN_MAX_CHARGE);
    drawDynamiteChargeBar(
      ctx,
      canvasW,
      canvasH,
      ratio,
      this._charging.chargeFrames,
      DYN_DANGER,
    );
  }
}
