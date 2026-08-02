#!/usr/bin/env tsx
/**
 * Bakes the Magic Missile sheets into `src/images/effects/`.
 *
 *   magic_missile_projectile.png — one row per visual tier plus the level-10
 *                                  sub-missile, 8 looping frames each
 *   magic_missile_explosion.png  — the same five rows, 10 frames each
 *
 * The manifest for `src/images/effects/` is edited by hand rather than rewritten
 * here: that directory also holds the shell, blood and icon sheets this script
 * knows nothing about, and `townSheets.writeSheets` owns a whole directory's
 * manifest. Frame geometry lives in `magicMissileArt.ts` and is echoed at the
 * end of a run so a manifest drift is caught by eye.
 *
 * Run: npm run gen:magic-missile
 */

import { createCanvas } from 'canvas';
import type { ImageData } from 'canvas';
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
  TILE_SCALE,
  drawMagicMissileExplosion,
  drawMagicMissileProjectile,
  type ProjectileVariant,
} from './magicMissileArt.js';

const OUT_DIR = resolve('src/images/effects');

/**
 * Alpha a frame's outermost pixels may carry before the bake is rejected.
 * Anything above this means the art ran into the cell wall and was cut along a
 * straight line — permanently, in the PNG. The projectile is drawn rotated, so
 * such a cut sweeps around with the bolt and is impossible to miss in motion.
 */
const MAX_EDGE_ALPHA = 6;

function assertFramesDoNotBleed(
  pixels: ImageData,
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
  label: string,
): void {
  const ALPHA_CHANNEL_OFFSET = 3;
  const CHANNELS = 4;
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_CHANNEL_OFFSET];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = column * frameWidth;
      const top = row * frameHeight;
      const right = left + frameWidth - 1;
      const bottom = top + frameHeight - 1;
      let worst = 0;
      for (let x = left; x <= right; x++)
        worst = Math.max(worst, alphaAt(x, top), alphaAt(x, bottom));
      for (let y = top; y <= bottom; y++)
        worst = Math.max(worst, alphaAt(left, y), alphaAt(right, y));
      if (worst > MAX_EDGE_ALPHA) {
        throw new Error(
          `${label}: frame (row ${row}, column ${column}) paints its own border ` +
            `at alpha ${worst}; the art is clipped by the frame. Shrink the layer ` +
            `or grow the frame envelope.`,
        );
      }
    }
  }
}

/** Row order is the manifest's row order — changing it silently reskins tiers. */
const PROJECTILE_ROWS: ReadonlyArray<ProjectileVariant> = [...MISSILE_TIERS, 'sub_missile'];
const EXPLOSION_ROWS: ReadonlyArray<ExplosionVariant> = [...MISSILE_TIERS, 'sub_missile'];

function bakeProjectileSheet(): void {
  const canvas = createCanvas(
    PROJECTILE_FRAME_COUNT * PROJECTILE_FRAME_WIDTH,
    PROJECTILE_ROWS.length * PROJECTILE_FRAME_HEIGHT,
  );
  const ctx = canvas.getContext('2d');

  PROJECTILE_ROWS.forEach((variant, row) => {
    for (let frame = 0; frame < PROJECTILE_FRAME_COUNT; frame++) {
      const cellX = frame * PROJECTILE_FRAME_WIDTH;
      const cellY = row * PROJECTILE_FRAME_HEIGHT;
      ctx.save();
      // Clipping is what stops a long tail or a wide bloom bleeding into the
      // neighbouring frame, which would show up in game as a ghost missile.
      ctx.beginPath();
      ctx.rect(cellX, cellY, PROJECTILE_FRAME_WIDTH, PROJECTILE_FRAME_HEIGHT);
      ctx.clip();
      drawMagicMissileProjectile(
        ctx,
        cellX + PROJECTILE_TILE_X,
        cellY + PROJECTILE_TILE_Y,
        variant,
        frame,
      );
      ctx.restore();
    }
  });

  assertFramesDoNotBleed(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    PROJECTILE_FRAME_WIDTH,
    PROJECTILE_FRAME_HEIGHT,
    PROJECTILE_FRAME_COUNT,
    PROJECTILE_ROWS.length,
    'magic_missile_projectile',
  );
  writeFileSync(resolve(OUT_DIR, 'magic_missile_projectile.png'), canvas.toBuffer('image/png'));
  console.log(
    `magic_missile_projectile.png  ${canvas.width}×${canvas.height}px  ` +
      `${PROJECTILE_ROWS.length} row(s): ${PROJECTILE_ROWS.join(', ')}`,
  );
}

function bakeExplosionSheet(): void {
  const canvas = createCanvas(
    EXPLOSION_FRAME_COUNT * EXPLOSION_FRAME_SIZE,
    EXPLOSION_ROWS.length * EXPLOSION_FRAME_SIZE,
  );
  const ctx = canvas.getContext('2d');

  EXPLOSION_ROWS.forEach((variant, row) => {
    for (let frame = 0; frame < EXPLOSION_FRAME_COUNT; frame++) {
      const cellX = frame * EXPLOSION_FRAME_SIZE;
      const cellY = row * EXPLOSION_FRAME_SIZE;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cellX, cellY, EXPLOSION_FRAME_SIZE, EXPLOSION_FRAME_SIZE);
      ctx.clip();
      drawMagicMissileExplosion(
        ctx,
        cellX + EXPLOSION_TILE_OFFSET,
        cellY + EXPLOSION_TILE_OFFSET,
        variant,
        frame,
      );
      ctx.restore();
    }
  });

  assertFramesDoNotBleed(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    EXPLOSION_FRAME_SIZE,
    EXPLOSION_FRAME_SIZE,
    EXPLOSION_FRAME_COUNT,
    EXPLOSION_ROWS.length,
    'magic_missile_explosion',
  );
  writeFileSync(resolve(OUT_DIR, 'magic_missile_explosion.png'), canvas.toBuffer('image/png'));
  console.log(
    `magic_missile_explosion.png   ${canvas.width}×${canvas.height}px  ` +
      `${EXPLOSION_ROWS.length} row(s): ${EXPLOSION_ROWS.join(', ')}`,
  );
}

bakeProjectileSheet();
bakeExplosionSheet();

console.log('\nManifest geometry:');
console.log(
  `  magic_missile_projectile: frameWidth=${PROJECTILE_FRAME_WIDTH} frameHeight=${PROJECTILE_FRAME_HEIGHT} ` +
    `tileX=${PROJECTILE_TILE_X} tileY=${PROJECTILE_TILE_Y} tileScale=${TILE_SCALE} frameCount=${PROJECTILE_FRAME_COUNT}`,
);
console.log(
  `  magic_missile_explosion:  frameWidth=${EXPLOSION_FRAME_SIZE} frameHeight=${EXPLOSION_FRAME_SIZE} ` +
    `tileX=${EXPLOSION_TILE_OFFSET} tileY=${EXPLOSION_TILE_OFFSET} tileScale=${TILE_SCALE} frameCount=${EXPLOSION_FRAME_COUNT}`,
);
