import type { GameSystem } from './GameSystem';
import { randomInt } from '../utils';
import { getSpriteDef } from '../core/SpriteLoader';

const PUDDLE_LIFETIME = 18000; // 300s @ 60fps
const PUDDLE_FADE_START = 3000; // start fading 50s before despawn
const PARTICLE_LIFETIME = 55;
const PARTICLE_GRAVITY = 0.08;

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

  spawnGore(cx: number, cy: number): void {
    const count = randomInt(20, 35);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 6,
        y: cy + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 2,
        variant: Math.floor(Math.random() * 6),
        isTear: Math.random() < 0.5,
        life: PARTICLE_LIFETIME,
        maxLife: PARTICLE_LIFETIME,
      });
    }

    const puddleCount = randomInt(1, 3);
    for (let i = 0; i < puddleCount; i++) {
      const offX = (Math.random() - 0.5) * 14;
      const offY = (Math.random() - 0.5) * 10;
      this.puddles.push({
        x: cx + offX,
        y: cy + offY,
        rx: 6 + Math.random() * 9,
        ry: 4 + Math.random() * 6,
        variant: Math.floor(Math.random() * 6),
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
      ctx.globalAlpha = alpha * 0.75;
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
