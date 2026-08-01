import type { GameSystem } from './GameSystem';
import type { SpriteKey } from '../core/SpriteLoader';
import { getSpriteDefByKey } from '../core/SpriteLoader';
import { drawSpriteRotatedCenter } from '../core/SpriteRenderer';
import type { GameMap } from '../map/GameMap';

interface MobBodyPartConfig {
  readonly spriteKey: SpriteKey;
  readonly parts: ReadonlyArray<string>;
}

const GOBLIN_CONFIG: MobBodyPartConfig = {
  spriteKey: 'goblin_base',
  parts: [
    'gore_severed_arm_left',
    'gore_severed_arm_right',
    'gore_severed_leg_left',
    'gore_severed_leg_right',
    'gore_severed_torso',
    'gore_severed_head',
  ],
};

const HOARDER_CONFIG: MobBodyPartConfig = {
  spriteKey: 'hoarder',
  parts: [
    'gore_head',
    'gore_right_arm',
    'gore_left_arm',
    'gore_left_leg',
    'gore_right_leg',
    'gore_torso',
  ],
};

const BODY_PART_REGISTRY = new Map<string, MobBodyPartConfig>([
  ['goblin', GOBLIN_CONFIG],
  ['hoarder', HOARDER_CONFIG],
]);

const PART_LIFETIME = 6000; // 300s @ 60fps
const PART_FADE_START = 3000; // start fading 50s before despawn
const MAX_SETTLED_PARTS = 200;
/** Fraction of PI used for cone spread in impact direction (~100 degrees). */
const IMPACT_CONE_HALF_ANGLE_FRACTION = 0.5556;
/** Speed multiplier applied to parts launched with a known impact direction. */
const IMPACT_SPEED_MULT = 1.6;
/** Speed multiplier applied to parts with no known impact direction. */
const DEFAULT_SPEED_MULT = 1.0;
/** Extra upward pop multiplier when impact direction is known. */
const IMPACT_VZ_BOOST = 1.4;
/** Shadow falloff: controls how shadow shrinks with height. */
const SHADOW_HEIGHT_FALLOFF = 40;
/** Shadow opacity multiplier. */
const SHADOW_ALPHA = 0.2;
/** Shadow ellipse x radius in px. */
const SHADOW_ELLIPSE_RX = 10;
/** Shadow ellipse y radius in px. */
const SHADOW_ELLIPSE_RY = 5;
// Horizontal spread (world pixels per frame)
const XY_SPEED_MIN = 0.2;
const XY_SPEED_MAX = 0.8;
// Very light air friction — parts glide while airborne
const XY_FRICTION = 0.99;
// Initial upward pop (screen pixels, treated as height above ground)
const VZ_MIN = 2.0;
const VZ_MAX = 4.0;
// Downward pull applied to vz each frame
const GRAVITY = 0.1;
const SPIN_MIN = 0.04;
const SPIN_MAX = 0.14;
/**
 * Tumbles run for a fixed duration rather than a fixed speed: a part is drawn
 * over the wall it is escaping, so the artifact must clear quickly regardless
 * of how far it has to travel.
 */
const TUMBLE_DURATION_FRAMES = 30;
/** Spin carried into the tumble, so parts visibly roll rather than glide rigidly. */
const TUMBLE_SPIN = 0.06;
/** Wall thickness the exit slide is expected to cross; beyond this a part stays where it fell. */
const TUMBLE_SEARCH_RADIUS_TILES = 3;
/** Half-width of the random resting spread inside the target tile, as a fraction of it. */
const TUMBLE_SCATTER_RATIO = 0.25;
const TILE_CENTER_RATIO = 0.5;

interface FlyingPart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // height above ground in screen pixels
  vz: number; // vertical velocity (positive = rising)
  angle: number;
  spin: number;
  spriteKey: SpriteKey;
  stateName: string;
  tileSize: number;
}

/** A part that landed inside an unwalkable tile and is sliding toward open ground. */
interface TumblingPart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  targetX: number;
  targetY: number;
  framesLeft: number;
  spriteKey: SpriteKey;
  stateName: string;
  tileSize: number;
}

interface SettledPart {
  x: number;
  y: number;
  angle: number;
  spriteKey: SpriteKey;
  stateName: string;
  tileSize: number;
  life: number;
}

export class BodyPartGoreSystem implements GameSystem {
  private readonly flying: FlyingPart[] = [];
  private readonly tumbling: TumblingPart[] = [];
  private readonly settled: SettledPart[] = [];

  constructor(private readonly map: GameMap) {}

  /**
   * Drops in-flight/tumbling parts from the death frame. Settled parts are left
   * alone — they're floor history, same as a smashed prop, not combat state.
   */
  resetForCheckpoint(): void {
    this.flying.length = 0;
    this.tumbling.length = 0;
  }

  spawnParts(
    cx: number,
    cy: number,
    bodyPartKey: string | null,
    tileSize: number,
    impactDx = 0,
    impactDy = 0,
  ): void {
    if (!bodyPartKey) return;
    const config = BODY_PART_REGISTRY.get(bodyPartKey);
    if (!config) return;

    const hasDir = impactDx !== 0 || impactDy !== 0;
    const impactAngle = hasDir ? Math.atan2(impactDy, impactDx) : 0;

    for (const stateName of config.parts) {
      // When impact direction is known, parts fly in a ±100° cone away from the attacker
      const angle = hasDir
        ? impactAngle + (Math.random() * 2 - 1) * (Math.PI * IMPACT_CONE_HALF_ANGLE_FRACTION)
        : Math.random() * Math.PI * 2;
      const speedMult = hasDir ? IMPACT_SPEED_MULT : DEFAULT_SPEED_MULT;
      const speed = (XY_SPEED_MIN + Math.random() * (XY_SPEED_MAX - XY_SPEED_MIN)) * speedMult;
      const SPIN_DIRECTION_THRESHOLD = 0.5;
      const spinDir = Math.random() < SPIN_DIRECTION_THRESHOLD ? 1 : -1;
      const spin = spinDir * (SPIN_MIN + Math.random() * (SPIN_MAX - SPIN_MIN));
      // Higher upward pop when there's a strong impact — parts burst higher
      const vzBoost = hasDir ? IMPACT_VZ_BOOST : DEFAULT_SPEED_MULT;
      this.flying.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        z: 0,
        vz: (VZ_MIN + Math.random() * (VZ_MAX - VZ_MIN)) * vzBoost,
        angle: Math.random() * Math.PI * 2,
        spin,
        spriteKey: config.spriteKey,
        stateName,
        tileSize,
      });
    }
  }

  update(): void {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= XY_FRICTION;
      p.vy *= XY_FRICTION;
      p.z += p.vz;
      p.vz -= GRAVITY;
      p.angle += p.spin;

      if (p.z <= 0 && p.vz < 0) {
        this._land(p);
        this.flying[i] = this.flying[this.flying.length - 1];
        this.flying.pop();
      }
    }

    for (let i = this.tumbling.length - 1; i >= 0; i--) {
      const p = this.tumbling[i];
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.framesLeft--;
      if (p.framesLeft <= 0) {
        this._settle(p.targetX, p.targetY, p.angle, p);
        this.tumbling[i] = this.tumbling[this.tumbling.length - 1];
        this.tumbling.pop();
      }
    }

    for (let i = this.settled.length - 1; i >= 0; i--) {
      this.settled[i].life--;
      if (this.settled[i].life <= 0) {
        this.settled[i] = this.settled[this.settled.length - 1];
        this.settled.pop();
      }
    }
  }

  /**
   * Resolves where a part comes to rest. Parts fly over walls while airborne,
   * so one can easily touch down inside a wall or other blocked tile; those
   * tumble toward the nearest open ground instead of resting inside geometry.
   */
  private _land(p: FlyingPart): void {
    // Tumbling parts are already spoken for against the cap, so a part with no
    // reserved slot is dropped at landing rather than vanishing mid-slide.
    const partsHoldingASettledSlot = this.settled.length + this.tumbling.length;
    if (partsHoldingASettledSlot >= MAX_SETTLED_PARTS) return;

    if (this._isOnWalkableGround(p.x, p.y, p.tileSize)) {
      this._settle(p.x, p.y, p.angle, p);
      return;
    }

    const restingSpot = this._findTumbleTarget(p.x, p.y, p.tileSize);
    if (restingSpot === null) {
      this._settle(p.x, p.y, p.angle, p);
      return;
    }

    const rollDirection = p.spin < 0 ? -TUMBLE_SPIN : TUMBLE_SPIN;
    this.tumbling.push({
      x: p.x,
      y: p.y,
      vx: (restingSpot.x - p.x) / TUMBLE_DURATION_FRAMES,
      vy: (restingSpot.y - p.y) / TUMBLE_DURATION_FRAMES,
      angle: p.angle,
      spin: rollDirection,
      targetX: restingSpot.x,
      targetY: restingSpot.y,
      framesLeft: TUMBLE_DURATION_FRAMES,
      spriteKey: p.spriteKey,
      stateName: p.stateName,
      tileSize: p.tileSize,
    });
  }

  /**
   * Finds the world position a part buried in geometry should slide to: the
   * closest walkable tile by ring search, scattered within that tile so the six
   * parts of one corpse don't stack on a single pixel.
   */
  private _findTumbleTarget(
    x: number,
    y: number,
    tileSize: number,
  ): { x: number; y: number } | null {
    const originTileX = Math.floor(x / tileSize);
    const originTileY = Math.floor(y / tileSize);

    for (let radius = 1; radius <= TUMBLE_SEARCH_RADIUS_TILES; radius++) {
      let closestTile: { x: number; y: number } | null = null;
      let closestDistSq = Infinity;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const onRing = Math.max(Math.abs(dx), Math.abs(dy)) === radius;
          if (!onRing) continue;
          const tileX = originTileX + dx;
          const tileY = originTileY + dy;
          if (!this.map.isWalkable(tileX, tileY)) continue;
          const centerX = (tileX + TILE_CENTER_RATIO) * tileSize;
          const centerY = (tileY + TILE_CENTER_RATIO) * tileSize;
          const distSq = (centerX - x) ** 2 + (centerY - y) ** 2;
          if (distSq < closestDistSq) {
            closestDistSq = distSq;
            closestTile = { x: centerX, y: centerY };
          }
        }
      }

      if (closestTile !== null) {
        const scatterRange = tileSize * TUMBLE_SCATTER_RATIO;
        const scatterX = (Math.random() * 2 - 1) * scatterRange;
        const scatterY = (Math.random() * 2 - 1) * scatterRange;
        return { x: closestTile.x + scatterX, y: closestTile.y + scatterY };
      }
    }
    return null;
  }

  private _isOnWalkableGround(x: number, y: number, tileSize: number): boolean {
    return this.map.isWalkable(Math.floor(x / tileSize), Math.floor(y / tileSize));
  }

  private _settle(
    x: number,
    y: number,
    angle: number,
    source: Pick<FlyingPart, 'spriteKey' | 'stateName' | 'tileSize'>,
  ): void {
    this.settled.push({
      x,
      y,
      angle,
      spriteKey: source.spriteKey,
      stateName: source.stateName,
      tileSize: source.tileSize,
      life: PART_LIFETIME,
    });
  }

  renderSettled(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.settled) {
      const alpha = p.life <= PART_FADE_START ? p.life / PART_FADE_START : 1;
      this._drawPart(
        ctx,
        p.x - camX,
        p.y - camY,
        p.angle,
        p.spriteKey,
        p.stateName,
        p.tileSize,
        alpha,
      );
    }

    for (const p of this.tumbling) {
      this._drawPart(ctx, p.x - camX, p.y - camY, p.angle, p.spriteKey, p.stateName, p.tileSize, 1);
    }
  }

  renderFlying(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.flying) {
      const sx = p.x - camX;
      const sy = p.y - camY;

      // Shadow at ground position — helps read the arc height
      const SHADOW_MIN_SCALE = 0.3;
      const shadowScale = Math.max(SHADOW_MIN_SCALE, 1 - p.z / SHADOW_HEIGHT_FALLOFF);
      ctx.save();
      ctx.globalAlpha = SHADOW_ALPHA * shadowScale;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(
        sx,
        sy,
        SHADOW_ELLIPSE_RX * shadowScale,
        SHADOW_ELLIPSE_RY * shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      // Part drawn above its ground position by z pixels
      this._drawPart(ctx, sx, sy - p.z, p.angle, p.spriteKey, p.stateName, p.tileSize, 1);
    }
  }

  private _drawPart(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    angle: number,
    spriteKey: SpriteKey,
    stateName: string,
    tileSize: number,
    alpha: number,
  ): void {
    const def = getSpriteDefByKey(spriteKey);
    if (!def) return;
    const stateDef = def.states.get(stateName);
    if (!stateDef) return;
    drawSpriteRotatedCenter(ctx, def, stateDef, sx, sy, angle, tileSize, alpha);
  }
}
