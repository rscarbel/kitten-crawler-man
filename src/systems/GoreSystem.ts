const PUDDLE_LIFETIME = 1800; // 30s @ 60fps
const PUDDLE_FADE_START = 300; // start fading 5s before despawn
const PARTICLE_LIFETIME = 55;
const PARTICLE_GRAVITY = 0.08;

interface BloodParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
}

interface BloodPuddle {
  x: number;
  y: number;
  rx: number; // x radius of ellipse
  ry: number; // y radius
  life: number;
}

import type { GameSystem } from './GameSystem';

export class GoreSystem implements GameSystem {
  private particles: BloodParticle[] = [];
  private puddles: BloodPuddle[] = [];

  spawnGore(cx: number, cy: number): void {
    // 8-14 splatter particles
    const count = 8 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 6,
        y: cy + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 2,
        life: PARTICLE_LIFETIME,
        maxLife: PARTICLE_LIFETIME,
      });
    }

    // 1-3 puddles spread slightly from centre
    const puddles = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puddles; i++) {
      const offX = (Math.random() - 0.5) * 14;
      const offY = (Math.random() - 0.5) * 10;
      this.puddles.push({
        x: cx + offX,
        y: cy + offY,
        rx: 6 + Math.random() * 9,
        ry: 4 + Math.random() * 6,
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
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.puddles.length - 1; i >= 0; i--) {
      this.puddles[i].life--;
      if (this.puddles[i].life <= 0) this.puddles.splice(i, 1);
    }
  }

  renderPuddles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.puddles) {
      const sx = p.x - camX;
      const sy = p.y - camY;
      const alpha = p.life <= PUDDLE_FADE_START ? p.life / PUDDLE_FADE_START : 1;
      ctx.save();
      ctx.globalAlpha = alpha * 0.75;
      ctx.beginPath();
      ctx.ellipse(sx, sy, p.rx, p.ry, 0, 0, Math.PI * 2);
      // Dark blood puddle with slightly lighter center
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, p.rx);
      grad.addColorStop(0, '#7a0000');
      grad.addColorStop(1, '#3a0000');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }
  }

  renderParticles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.particles) {
      const sx = p.x - camX;
      const sy = p.y - camY;
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#cc0000';
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
