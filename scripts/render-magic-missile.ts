#!/usr/bin/env tsx
/**
 * Headless review harness for the Magic Missile art.
 *
 * The baked sheets are transparent and almost entirely additive light, so
 * opening the PNGs directly shows pale smudges on white and says nothing about
 * how they read in a dungeon. This lays every frame of every tier over a dark
 * dungeon-ish floor at the size the game draws them, one contact sheet per
 * subject, which is the only way to judge the effect without a browser.
 *
 *   npx tsx scripts/render-magic-missile.ts --out=missiles.png
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type ExplosionVariant,
  EXPLOSION_FRAME_COUNT,
  EXPLOSION_FRAME_SIZE,
  EXPLOSION_TILE_OFFSET,
  MISSILE_TIERS,
  PROJECTILE_FRAME_COUNT,
  PROJECTILE_FRAME_HEIGHT,
  PROJECTILE_FRAME_WIDTH,
  PROJECTILE_TILE_X,
  PROJECTILE_TILE_Y,
  drawMagicMissileExplosion,
  drawMagicMissileProjectile,
  type ProjectileVariant,
} from './magicMissileArt.js';

const PROJECTILE_ROWS: ReadonlyArray<ProjectileVariant> = [...MISSILE_TIERS, 'sub_missile'];
const EXPLOSION_ROWS: ReadonlyArray<ExplosionVariant> = [...MISSILE_TIERS, 'sub_missile'];

const LABEL_HEIGHT = 22;
const LABEL_FONT = '14px sans-serif';
const LABEL_COLOR = '#f2ede4';
const CHECKER = 32;
const FLOOR_LIGHT = '#3a3630';
const FLOOR_DARK = '#2c2924';
const SECTION_GAP = 24;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

const projectileBandHeight = LABEL_HEIGHT + PROJECTILE_FRAME_HEIGHT;
const explosionBandHeight = LABEL_HEIGHT + EXPLOSION_FRAME_SIZE;
const width = Math.max(
  PROJECTILE_FRAME_COUNT * PROJECTILE_FRAME_WIDTH,
  EXPLOSION_FRAME_COUNT * EXPLOSION_FRAME_SIZE,
);
const projectileSectionHeight = PROJECTILE_ROWS.length * projectileBandHeight;
const explosionSectionHeight = EXPLOSION_ROWS.length * explosionBandHeight;
const height = projectileSectionHeight + SECTION_GAP + explosionSectionHeight;

const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

for (let y = 0; y < height; y += CHECKER) {
  for (let x = 0; x < width; x += CHECKER) {
    ctx.fillStyle = (x / CHECKER + y / CHECKER) % 2 === 0 ? FLOOR_DARK : FLOOR_LIGHT;
    ctx.fillRect(x, y, CHECKER, CHECKER);
  }
}

function label(text: string, x: number, y: number): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(text, x + 6, y + LABEL_HEIGHT - 6);
}

function inCell(
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number,
  paint: (target: NodeCtx) => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cellX, cellY, cellWidth, cellHeight);
  ctx.clip();
  paint(ctx);
  ctx.restore();
}

PROJECTILE_ROWS.forEach((variant, row) => {
  const bandTop = row * projectileBandHeight;
  label(`${variant} — projectile`, 0, bandTop);
  for (let frame = 0; frame < PROJECTILE_FRAME_COUNT; frame++) {
    const cellX = frame * PROJECTILE_FRAME_WIDTH;
    const cellY = bandTop + LABEL_HEIGHT;
    inCell(cellX, cellY, PROJECTILE_FRAME_WIDTH, PROJECTILE_FRAME_HEIGHT, (target) =>
      drawMagicMissileProjectile(
        target,
        cellX + PROJECTILE_TILE_X,
        cellY + PROJECTILE_TILE_Y,
        variant,
        frame,
      ),
    );
  }
});

EXPLOSION_ROWS.forEach((variant, row) => {
  const bandTop = projectileSectionHeight + SECTION_GAP + row * explosionBandHeight;
  label(`${variant} — impact`, 0, bandTop);
  for (let frame = 0; frame < EXPLOSION_FRAME_COUNT; frame++) {
    const cellX = frame * EXPLOSION_FRAME_SIZE;
    const cellY = bandTop + LABEL_HEIGHT;
    inCell(cellX, cellY, EXPLOSION_FRAME_SIZE, EXPLOSION_FRAME_SIZE, (target) =>
      drawMagicMissileExplosion(
        target,
        cellX + EXPLOSION_TILE_OFFSET,
        cellY + EXPLOSION_TILE_OFFSET,
        variant,
        frame,
      ),
    );
  }
});

const outPath = resolve(parseFlag('out', 'magic-missile.png'));
writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`Wrote ${outPath} (${width}×${height}px)`);
