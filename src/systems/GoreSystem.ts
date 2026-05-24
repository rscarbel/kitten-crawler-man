import type { GameSystem } from './GameSystem';
import { randomInt } from '../utils';
import { getSpriteDef } from '../core/SpriteLoader';

const PUDDLE_LIFETIME = 18000; // 300s @ 60fps
const PUDDLE_FADE_START = 3000; // start fading 50s before despawn
const PARTICLE_LIFETIME = 55;
const PARTICLE_GRAVITY = 0.08;

// Gore particle spawning
const GORE_PARTICLE_COUNT_MIN = 20;
const GORE_PARTICLE_COUNT_MAX = 35;
const GORE_FORWARD_CONE_PROBABILITY = 0.72;
const GORE_FORWARD_CONE_ANGLE_NUMERATOR = 2;
const GORE_FORWARD_CONE_ANGLE_DENOMINATOR = 3;
const GORE_FORWARD_CONE_SPEED_SCALE = 1.3;
const GORE_RANDOM_SPEED_SCALE = 1.0;
const GORE_SPEED_MIN = 1.5;
const GORE_SPEED_MAX = 3.5;
const GORE_RADIUS_MIN = 1.5;
const GORE_RADIUS_MAX = 2;
const GORE_SPAWN_OFFSET_MAX = 6;
const GORE_TEAR_PROBABILITY = 0.5;

// Gore puddle spawning
const GORE_PUDDLE_COUNT_MIN = 1;
const GORE_PUDDLE_COUNT_MAX = 3;
const GORE_PUDDLE_SCATTER = 7;
const GORE_PUDDLE_X_MULT = 6;
const GORE_PUDDLE_Y_MULT = 6;
const GORE_PUDDLE_SCATTER_X_MULT = 2;
const GORE_PUDDLE_SCATTER_Y_MULT = 1.4;
const GORE_PUDDLE_RX_MIN = 6;
const GORE_PUDDLE_RX_MAX = 9;
const GORE_PUDDLE_RY_MIN = 4;
const GORE_PUDDLE_RY_MAX = 6;
const GORE_VARIANT_COUNT = 6;
const PARTICLE_OFFSET_RANGE = 0.5;

// Puddle rendering
const PUDDLE_ALPHA_BASE = 0.75;

interface BloodParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  variant: number; // 0–5 frame index
  isTear: boolean; // drop (false) or tear (true) state row
  life: number;
  maxLife: number;
}

interface BloodPuddle {
  x: number;
  y: number;
  rx: number;
  ry: number;
  variant: number; // 0–5 frame index
  life: number;
}

export class GoreSystem implements GameSystem {
  private particles: BloodParticle[] = [];
  private puddles: BloodPuddle[] = [];

  spawnGore(cx: number, cy: number, impactDx = 0, impactDy = 0): void {
    const hasDir = impactDx !== 0 || impactDy !== 0;
    const impactAngle = hasDir ? Math.atan2(impactDy, impactDx) : 0;

    const count = randomInt(GORE_PARTICLE_COUNT_MIN, GORE_PARTICLE_COUNT_MAX);
    for (let i = 0; i < count; i++) {
      let angle: number;
      let speedScale: number;
      if (hasDir && Math.random() < GORE_FORWARD_CONE_PROBABILITY) {
        // Forward cone ±120° around impact direction
        angle =
          impactAngle +
          (Math.random() * 2 - 1) *
            (Math.PI * (GORE_FORWARD_CONE_ANGLE_NUMERATOR / GORE_FORWARD_CONE_ANGLE_DENOMINATOR));
        speedScale = GORE_FORWARD_CONE_SPEED_SCALE;
      } else {
        angle = Math.random() * Math.PI * 2;
        speedScale = GORE_RANDOM_SPEED_SCALE;
      }
      const speed = (GORE_SPEED_MIN + Math.random() * GORE_SPEED_MAX) * speedScale;
      this.particles.push({
        x: cx + (Math.random() - PARTICLE_OFFSET_RANGE) * GORE_SPAWN_OFFSET_MAX,
        y: cy + (Math.random() - PARTICLE_OFFSET_RANGE) * GORE_SPAWN_OFFSET_MAX,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: GORE_RADIUS_MIN + Math.random() * GORE_RADIUS_MAX,
        variant: Math.floor(Math.random() * GORE_VARIANT_COUNT),
        isTear: Math.random() < GORE_TEAR_PROBABILITY,
        life: PARTICLE_LIFETIME,
        maxLife: PARTICLE_LIFETIME,
      });
    }

    const puddleCount = randomInt(GORE_PUDDLE_COUNT_MIN, GORE_PUDDLE_COUNT_MAX);
    for (let i = 0; i < puddleCount; i++) {
      // Puddles shift toward the impact direction when we know it
      const scatter = hasDir ? GORE_PUDDLE_SCATTER : GORE_PUDDLE_SCATTER;
      const offX =
        impactDx * GORE_PUDDLE_X_MULT * Math.random() +
        (Math.random() - PARTICLE_OFFSET_RANGE) * scatter * GORE_PUDDLE_SCATTER_X_MULT;
      const offY =
        impactDy * GORE_PUDDLE_Y_MULT * Math.random() +
        (Math.random() - PARTICLE_OFFSET_RANGE) * scatter * GORE_PUDDLE_SCATTER_Y_MULT;
      this.puddles.push({
        x: cx + offX,
        y: cy + offY,
        rx: GORE_PUDDLE_RX_MIN + Math.random() * GORE_PUDDLE_RX_MAX,
        ry: GORE_PUDDLE_RY_MIN + Math.random() * GORE_PUDDLE_RY_MAX,
        variant: Math.floor(Math.random() * GORE_VARIANT_COUNT),
        life: PUDDLE_LIFETIME,
      });
    }
  }

  update(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += PARTICLE_GRAVITY;
      p.vx *= 0.92;
      p.life--;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
      }
    }

    for (let i = this.puddles.length - 1; i >= 0; i--) {
      this.puddles[i].life--;
      if (this.puddles[i].life <= 0) {
        this.puddles[i] = this.puddles[this.puddles.length - 1];
        this.puddles.pop();
      }
    }
  }

  renderPuddles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const def = getSpriteDef('blood_puddle');
    if (!def) return;
    const stateDef = def.states.get('puddle');
    if (!stateDef) return;
    const { img, frameWidth, frameHeight } = def;

    ctx.save();
    for (const p of this.puddles) {
      const sx = p.x - camX;
      const sy = p.y - camY;
      const alpha = p.life <= PUDDLE_FADE_START ? p.life / PUDDLE_FADE_START : 1;
      const srcX = p.variant * frameWidth;
      const srcY = stateDef.row * frameHeight;
      ctx.globalAlpha = alpha * PUDDLE_ALPHA_BASE;
      ctx.drawImage(
        img,
        srcX,
        srcY,
        frameWidth,
        frameHeight,
        sx - p.rx,
        sy - p.ry,
        p.rx * 2,
        p.ry * 2,
      );
    }
    ctx.restore();
  }

  renderParticles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const def = getSpriteDef('blood_particle');
    if (!def) return;
    const dropState = def.states.get('drop');
    const tearState = def.states.get('tear');
    if (!dropState || !tearState) return;
    const { img, frameWidth, frameHeight } = def;

    ctx.save();
    for (const p of this.particles) {
      const sx = p.x - camX;
      const sy = p.y - camY;
      const stateDef = p.isTear ? tearState : dropState;
      const srcX = p.variant * frameWidth;
      const srcY = stateDef.row * frameHeight;
      const displaySize = p.radius * 2;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.drawImage(
        img,
        srcX,
        srcY,
        frameWidth,
        frameHeight,
        sx - p.radius,
        sy - p.radius,
        displaySize,
        displaySize,
      );
    }
    ctx.restore();
  }
}
