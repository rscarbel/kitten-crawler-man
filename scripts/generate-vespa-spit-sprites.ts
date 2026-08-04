#!/usr/bin/env tsx
/**
 * Bakes the Brindled Vespa's acid-spit sheets into `src/images/effects/`:
 *
 *   vespa_acid_spit_projectile.png — 6 looping frames, pulsing and dripping
 *   vespa_acid_spit_impact.png     — 8 frames, a bubbling splash that fires
 *                                    once then fades
 *
 * Modelled on `scripts/generate-magic-missile-sprites.ts`'s bolt/impact split
 * and its edge-bleed gate. The manifest for `src/images/effects/` is edited by
 * hand rather than rewritten here, for the same reason that generator gives:
 * the directory holds sheets this script knows nothing about.
 *
 * Run: npm run gen:vespa-spit
 */

import { createCanvas } from 'canvas';
import type { ImageData } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  IMPACT_FRAME_COUNT,
  IMPACT_FRAME_SIZE,
  IMPACT_TILE_OFFSET,
  PROJECTILE_FRAME_COUNT,
  PROJECTILE_FRAME_SIZE,
  PROJECTILE_TILE_OFFSET,
  TILE_SCALE,
  drawVespaAcidImpact,
  drawVespaAcidProjectile,
} from './vespaSpitArt.js';

const OUT_DIR = resolve('src/images/effects');
const MAX_EDGE_ALPHA = 6;

function assertFramesDoNotBleed(
  pixels: ImageData,
  frameSize: number,
  columns: number,
  label: string,
): void {
  const ALPHA_CHANNEL_OFFSET = 3;
  const CHANNELS = 4;
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_CHANNEL_OFFSET];

  for (let column = 0; column < columns; column++) {
    const left = column * frameSize;
    const top = 0;
    const right = left + frameSize - 1;
    const bottom = frameSize - 1;
    let worst = 0;
    for (let x = left; x <= right; x++)
      worst = Math.max(worst, alphaAt(x, top), alphaAt(x, bottom));
    for (let y = top; y <= bottom; y++)
      worst = Math.max(worst, alphaAt(left, y), alphaAt(right, y));
    if (worst > MAX_EDGE_ALPHA) {
      throw new Error(
        `${label}: frame ${column} paints its own border at alpha ${worst}; shrink the layer or ` +
          `grow the frame envelope.`,
      );
    }
  }
}

function bakeProjectileSheet(): void {
  const canvas = createCanvas(
    PROJECTILE_FRAME_COUNT * PROJECTILE_FRAME_SIZE,
    PROJECTILE_FRAME_SIZE,
  );
  const ctx = canvas.getContext('2d');

  for (let frame = 0; frame < PROJECTILE_FRAME_COUNT; frame++) {
    const cellX = frame * PROJECTILE_FRAME_SIZE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cellX, 0, PROJECTILE_FRAME_SIZE, PROJECTILE_FRAME_SIZE);
    ctx.clip();
    drawVespaAcidProjectile(
      ctx,
      cellX + PROJECTILE_TILE_OFFSET,
      PROJECTILE_TILE_OFFSET,
      frame,
      PROJECTILE_FRAME_COUNT,
    );
    ctx.restore();
  }

  assertFramesDoNotBleed(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    PROJECTILE_FRAME_SIZE,
    PROJECTILE_FRAME_COUNT,
    'vespa_acid_spit_projectile',
  );
  writeFileSync(resolve(OUT_DIR, 'vespa_acid_spit_projectile.png'), canvas.toBuffer('image/png'));
  console.log(`vespa_acid_spit_projectile.png  ${canvas.width}×${canvas.height}px`);
}

function bakeImpactSheet(): void {
  const canvas = createCanvas(IMPACT_FRAME_COUNT * IMPACT_FRAME_SIZE, IMPACT_FRAME_SIZE);
  const ctx = canvas.getContext('2d');

  for (let frame = 0; frame < IMPACT_FRAME_COUNT; frame++) {
    const cellX = frame * IMPACT_FRAME_SIZE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cellX, 0, IMPACT_FRAME_SIZE, IMPACT_FRAME_SIZE);
    ctx.clip();
    drawVespaAcidImpact(
      ctx,
      cellX + IMPACT_TILE_OFFSET,
      IMPACT_TILE_OFFSET,
      frame,
      IMPACT_FRAME_COUNT,
    );
    ctx.restore();
  }

  assertFramesDoNotBleed(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    IMPACT_FRAME_SIZE,
    IMPACT_FRAME_COUNT,
    'vespa_acid_spit_impact',
  );
  writeFileSync(resolve(OUT_DIR, 'vespa_acid_spit_impact.png'), canvas.toBuffer('image/png'));
  console.log(`vespa_acid_spit_impact.png      ${canvas.width}×${canvas.height}px`);
}

bakeProjectileSheet();
bakeImpactSheet();

console.log('\nManifest geometry:');
console.log(
  `  vespa_acid_spit_projectile: frameWidth=${PROJECTILE_FRAME_SIZE} frameHeight=${PROJECTILE_FRAME_SIZE} ` +
    `tileX=${PROJECTILE_TILE_OFFSET} tileY=${PROJECTILE_TILE_OFFSET} tileScale=${TILE_SCALE} frameCount=${PROJECTILE_FRAME_COUNT}`,
);
console.log(
  `  vespa_acid_spit_impact:     frameWidth=${IMPACT_FRAME_SIZE} frameHeight=${IMPACT_FRAME_SIZE} ` +
    `tileX=${IMPACT_TILE_OFFSET} tileY=${IMPACT_TILE_OFFSET} tileScale=${TILE_SCALE} frameCount=${IMPACT_FRAME_COUNT}`,
);
