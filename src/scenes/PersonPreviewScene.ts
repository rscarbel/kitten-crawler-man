/**
 * Localhost-only harness for eyeballing the procedural people generator: four
 * large "hero" figures walking in every facing, over a scrolling grid of unique
 * seeded people that auto-cycle direction. Click anywhere to reroll every seed.
 * Reached via `?people` in `devBootScene` (see `game.ts`); never on a
 * production path.
 */

import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import { drawText } from '../ui/TextBox';
import { generatePersonAppearance } from '../sprites/person/PersonAppearance';
import { drawPerson } from '../sprites/person/drawPerson';
import type { Facing } from '../sprites/person/skeleton';

const BG_COLOR = '#1b2436';
const GROUND_COLOR = '#26324a';

const HERO_SIZE = 150;
const GRID_SIZE = 88;
const GRID_CELL = 104;
const GRID_TOP = 250;
const MARGIN = 40;

const FACINGS: ReadonlyArray<Facing> = ['down', 'left', 'up', 'right'];
const HERO_LABELS: Record<Facing, string> = {
  down: 'toward',
  up: 'away',
  left: 'left',
  right: 'right',
};

// Frames a grid figure holds a facing before turning (~2.3s at 60fps).
const FACING_HOLD_FRAMES = 140;

const HERO_GROUND_FRAC = 0.92;
const GROUND_THICKNESS = 8;
// Decorrelates grid seeds from hero seeds and spreads each figure's turn/anim clock.
const GRID_SEED_STRIDE = 31;
const FACING_STAGGER = 0.37;
const PHASE_STAGGER = 11;

export class PersonPreviewScene extends Scene {
  private phase = 0;
  private seedBase = 1;

  constructor(private readonly sceneManager: SceneManager) {
    super();
  }

  handleClick(): void {
    this.seedBase += 997;
  }

  update(): void {
    this.phase += 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { width, height } = this.sceneManager.canvas;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    drawText(ctx, 'Procedural People — click to reroll seeds', {
      x: MARGIN,
      y: 16,
      size: 20,
      bold: true,
      color: '#e2e8f0',
      outline: true,
    });

    this.renderHeroes(ctx, width);
    this.renderGrid(ctx, width, height);
  }

  private renderHeroes(ctx: CanvasRenderingContext2D, width: number): void {
    const bandY = 60;
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, bandY + HERO_SIZE * HERO_GROUND_FRAC, width, GROUND_THICKNESS);

    const slot = width / (FACINGS.length + 1);
    FACINGS.forEach((facing, i) => {
      const appearance = generatePersonAppearance(this.seedBase + i);
      const sx = slot * (i + 1) - HERO_SIZE / 2;
      drawPerson(ctx, sx, bandY, HERO_SIZE, appearance, this.phase, facing, true);
      drawText(ctx, HERO_LABELS[facing], {
        x: slot * (i + 1),
        y: bandY + HERO_SIZE,
        size: 14,
        align: 'center',
        color: '#94a3b8',
      });
    });
  }

  private renderGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cols = Math.max(1, Math.floor((width - MARGIN * 2) / GRID_CELL));
    let index = 0;
    for (let y = GRID_TOP; y + GRID_CELL < height; y += GRID_CELL) {
      for (let col = 0; col < cols; col += 1) {
        const appearance = generatePersonAppearance(this.seedBase * GRID_SEED_STRIDE + index + 1);
        // Each figure turns on its own schedule so the crowd looks unchoreographed.
        const facingIndex =
          Math.floor(this.phase / FACING_HOLD_FRAMES + index * FACING_STAGGER) % FACINGS.length;
        const facing = FACINGS[facingIndex];
        const sx = MARGIN + col * GRID_CELL + (GRID_CELL - GRID_SIZE) / 2;
        drawPerson(
          ctx,
          sx,
          y,
          GRID_SIZE,
          appearance,
          this.phase + index * PHASE_STAGGER,
          facing,
          true,
        );
        index += 1;
      }
    }
  }
}
