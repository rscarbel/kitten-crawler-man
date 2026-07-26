/**
 * Signet's fireball — the ranged flourish she throws while fighting alongside
 * the player. It is deliberately feeble: the spectacle sells her participation
 * while the player still does the real damage.
 */

import type { Mob } from './Mob';
import type { GameMap } from '../map/GameMap';
import { normalize } from '../utils';

export interface SignetFireball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Advances every frame; drives the flame flicker and trailing embers. */
  age: number;
  /** True once the fireball has struck something and is playing its burst. */
  exploding: boolean;
  explodeTick: number;
}

const FIREBALL_SPEED = 4.2;
const FIREBALL_RADIUS = 5;
const EXPLODE_TICKS = 14;
const MOB_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;
const EXPLOSION_EXPANSION = 2.4;
const EXPLOSION_ALPHA = 0.75;
const CORE_RADIUS_RATIO = 0.55;
const FLICKER_SPEED = 0.55;
const FLICKER_AMPLITUDE = 0.18;

/** Trailing embers, drawn behind the head along its own velocity. */
const TRAIL_LENGTH = 3;
const TRAIL_SPACING_PX = 4;
const TRAIL_SHRINK_PER_STEP = 0.22;
const TRAIL_ALPHA_PER_STEP = 0.26;

export function fireSignetFireball(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): SignetFireball {
  const n = normalize(toX - fromX, toY - fromY);
  return {
    x: fromX,
    y: fromY,
    vx: n.x * FIREBALL_SPEED,
    vy: n.y * FIREBALL_SPEED,
    age: 0,
    exploding: false,
    explodeTick: 0,
  };
}

/**
 * Advances every fireball one frame: wall collisions, hostile-mob hits (via
 * `onHit` so the caster owns the damage number), and the burst animation.
 * Returns the pruned list — callers should reassign their array.
 */
export function advanceSignetFireballs(
  fireballs: SignetFireball[],
  map: GameMap | null,
  tileSize: number,
  targets: readonly Mob[],
  onHit: (target: Mob) => void,
): SignetFireball[] {
  for (const fireball of fireballs) {
    fireball.age++;
    if (fireball.exploding) {
      fireball.explodeTick--;
      continue;
    }

    const nextX = fireball.x + fireball.vx;
    const nextY = fireball.y + fireball.vy;
    if (map) {
      const tileX = Math.floor(nextX / tileSize);
      const tileY = Math.floor(nextY / tileSize);
      if (!map.isWalkable(tileX, tileY)) {
        fireball.exploding = true;
        fireball.explodeTick = EXPLODE_TICKS;
        continue;
      }
    }
    fireball.x = nextX;
    fireball.y = nextY;

    const hitRadius = FIREBALL_RADIUS + tileSize * MOB_CENTER_RADIUS_RATIO;
    for (const target of targets) {
      if (!target.isAlive || !target.isHostile) continue;
      const cx = target.x + tileSize * CENTER_OFFSET;
      const cy = target.y + tileSize * CENTER_OFFSET;
      if (Math.hypot(fireball.x - cx, fireball.y - cy) < hitRadius) {
        onHit(target);
        fireball.exploding = true;
        fireball.explodeTick = EXPLODE_TICKS;
        break;
      }
    }
  }
  return fireballs.filter((f) => !f.exploding || f.explodeTick > 0);
}

/** Renders every fireball in screen space (call before the caster's own sprite). */
export function renderSignetFireballs(
  ctx: CanvasRenderingContext2D,
  fireballs: SignetFireball[],
  camX: number,
  camY: number,
): void {
  for (const fireball of fireballs) {
    const fx = fireball.x - camX;
    const fy = fireball.y - camY;

    if (fireball.exploding) {
      const progress = 1 - fireball.explodeTick / EXPLODE_TICKS;
      const burstRadius = FIREBALL_RADIUS * (1 + progress * EXPLOSION_EXPANSION);
      const alpha = fireball.explodeTick / EXPLODE_TICKS;
      ctx.beginPath();
      ctx.arc(fx, fy, burstRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 120, 30, ${alpha * EXPLOSION_ALPHA})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(fx, fy, burstRadius * CORE_RADIUS_RATIO, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 232, 160, ${alpha})`;
      ctx.fill();
      continue;
    }

    const flicker = 1 + Math.sin(fireball.age * FLICKER_SPEED) * FLICKER_AMPLITUDE;
    const heading = normalize(fireball.vx, fireball.vy);

    for (let step = TRAIL_LENGTH; step >= 1; step--) {
      const trailX = fx - heading.x * TRAIL_SPACING_PX * step;
      const trailY = fy - heading.y * TRAIL_SPACING_PX * step;
      const trailRadius = FIREBALL_RADIUS * flicker * (1 - TRAIL_SHRINK_PER_STEP * step);
      if (trailRadius <= 0) continue;
      ctx.beginPath();
      ctx.arc(trailX, trailY, trailRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(214, 78, 22, ${1 - TRAIL_ALPHA_PER_STEP * step})`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(fx, fy, FIREBALL_RADIUS * flicker, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fx, fy, FIREBALL_RADIUS * flicker * CORE_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
  }
}
