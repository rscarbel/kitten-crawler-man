/**
 * Soul bolts — the cult's signature ranged attack: a shrieking violet orb of
 * harvested soul-stuff. Shared by CityElfCultist and MissQuill so the
 * projectile physics and look stay identical between the foot soldiers and
 * their mistress.
 */

import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import { normalize } from '../utils';

export interface SoulBolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** When true the bolt has hit something and is playing its burst animation. */
  exploding: boolean;
  explodeTick: number;
}

const BOLT_SPEED = 1.6;
const BOLT_RADIUS = 6;
const EXPLODE_TICKS = 18;
const PLAYER_CENTER_RADIUS_RATIO = 0.35;
const CENTER_OFFSET = 0.5;
const EXPLOSION_EXPANSION = 2.0;
const EXPLOSION_ALPHA = 0.7;
const CORE_RADIUS_RATIO = 0.55;
const WISP_RADIUS_RATIO = 0.3;

/** Creates a bolt travelling from (fromX, fromY) toward (toX, toY). */
export function fireSoulBolt(fromX: number, fromY: number, toX: number, toY: number): SoulBolt {
  const n = normalize(toX - fromX, toY - fromY);
  return {
    x: fromX,
    y: fromY,
    vx: n.x * BOLT_SPEED,
    vy: n.y * BOLT_SPEED,
    exploding: false,
    explodeTick: 0,
  };
}

/**
 * Advances all bolts one frame: wall collisions, target hits (via `onHit` so
 * the owning mob applies its own level-scaled damage), and burst animation.
 * Returns the pruned list — callers should reassign their array.
 */
export function advanceSoulBolts(
  bolts: SoulBolt[],
  map: GameMap | null,
  tileSize: number,
  targets: Player[],
  onHit: (target: Player) => void,
): SoulBolt[] {
  for (const bolt of bolts) {
    if (bolt.exploding) {
      bolt.explodeTick--;
      continue;
    }
    const nextX = bolt.x + bolt.vx;
    const nextY = bolt.y + bolt.vy;
    if (map) {
      const tx = Math.floor(nextX / tileSize);
      const ty = Math.floor(nextY / tileSize);
      if (!map.isWalkable(tx, ty)) {
        bolt.exploding = true;
        bolt.explodeTick = EXPLODE_TICKS;
        continue;
      }
    }
    bolt.x = nextX;
    bolt.y = nextY;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const cx = t.x + tileSize * CENTER_OFFSET;
      const cy = t.y + tileSize * CENTER_OFFSET;
      if (
        Math.hypot(bolt.x - cx, bolt.y - cy) <
        BOLT_RADIUS + tileSize * PLAYER_CENTER_RADIUS_RATIO
      ) {
        onHit(t);
        bolt.exploding = true;
        bolt.explodeTick = EXPLODE_TICKS;
        break;
      }
    }
  }
  return bolts.filter((b) => !b.exploding || b.explodeTick > 0);
}

/** Renders all bolts in screen space (call before the caster's own sprite). */
export function renderSoulBolts(
  ctx: CanvasRenderingContext2D,
  bolts: SoulBolt[],
  camX: number,
  camY: number,
): void {
  for (const bolt of bolts) {
    const bx = bolt.x - camX;
    const by = bolt.y - camY;

    if (bolt.exploding) {
      const progress = 1 - bolt.explodeTick / EXPLODE_TICKS;
      const r = BOLT_RADIUS * (1 + progress * EXPLOSION_EXPANSION);
      const alpha = bolt.explodeTick / EXPLODE_TICKS;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(150, 80, 255, ${alpha * EXPLOSION_ALPHA})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, r * CORE_RADIUS_RATIO, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(230, 200, 255, ${alpha})`;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(bx, by, BOLT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#6d28d9';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, BOLT_RADIUS * CORE_RADIUS_RATIO, 0, Math.PI * 2);
      ctx.fillStyle = '#a78bfa';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, BOLT_RADIUS * WISP_RADIUS_RATIO, 0, Math.PI * 2);
      ctx.fillStyle = '#f5f3ff';
      ctx.fill();
    }
  }
}
