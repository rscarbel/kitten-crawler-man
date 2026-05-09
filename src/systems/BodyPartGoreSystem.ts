import type { GameSystem } from './GameSystem';
import type { SpriteKey } from '../core/SpriteLoader';
import { getSpriteDefByKey } from '../core/SpriteLoader';
import { drawSpriteRotatedCenter } from '../core/SpriteRenderer';

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
  private readonly settled: SettledPart[] = [];

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
        ? impactAngle + (Math.random() * 2 - 1) * (Math.PI * (5 / 9))
        : Math.random() * Math.PI * 2;
      const speedMult = hasDir ? 1.6 : 1.0;
      const speed = (XY_SPEED_MIN + Math.random() * (XY_SPEED_MAX - XY_SPEED_MIN)) * speedMult;
      const spinDir = Math.random() < 0.5 ? 1 : -1;
      const spin = spinDir * (SPIN_MIN + Math.random() * (SPIN_MAX - SPIN_MIN));
      // Higher upward pop when there's a strong impact — parts burst higher
      const vzBoost = hasDir ? 1.4 : 1.0;
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
        if (this.settled.length < MAX_SETTLED_PARTS) {
          this.settled.push({
            x: p.x,
            y: p.y,
            angle: p.angle,
            spriteKey: p.spriteKey,
            stateName: p.stateName,
            tileSize: p.tileSize,
            life: PART_LIFETIME,
          });
        }
        this.flying[i] = this.flying[this.flying.length - 1];
        this.flying.pop();
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
  }

  renderFlying(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.flying) {
      const sx = p.x - camX;
      const sy = p.y - camY;

      // Shadow at ground position — helps read the arc height
      const shadowScale = Math.max(0.3, 1 - p.z / 40);
      ctx.save();
      ctx.globalAlpha = 0.2 * shadowScale;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 10 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
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
