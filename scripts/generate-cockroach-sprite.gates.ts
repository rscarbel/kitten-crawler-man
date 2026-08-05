#!/usr/bin/env tsx
/**
 * The bake gate for the cockroach sheet, and the entry point the npm script
 * runs — **not** `generate-cockroach-sprite.ts` itself.
 *
 * A sheet that fails a gate must never reach disk. This module bakes into
 * memory, measures the baked pixels and the pose stream, fails with a numeric
 * message naming what it measured and what the limit was, and only then lets the
 * generator write.
 *
 * Every gate here exists because something on this animal was wrong in a way
 * that `typecheck`, `lint` and reading the drawing code could not see.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  BITE_FRAMES,
  BITE_IMPACT_FRAME,
  GORE_STATES,
  ROWS,
  TILE_SCALE,
  bake,
  biteProgressOf,
  bitePose,
  type BakedSheet,
} from './generate-cockroach-sprite';
import { ANTENNA_MIN_SPAN_TILES } from './cockroachArt';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha above which a pixel counts as *body* rather than as an antialiased edge. */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** The size the sprite renders at in game; the runtime scale is this over TILE_SCALE. */
const IN_GAME_TILE = 32;

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

async function decode(sheet: BakedSheet): Promise<Canvas> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function gridOf(canvas: Canvas): Grid {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

function alphaAt(grid: Grid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  return grid.data[(y * grid.width + x) * CHANNELS + ALPHA_OFFSET];
}

interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Every painted pixel of one cell, as a flat alpha array. */
function cellAlpha(grid: Grid, sheet: BakedSheet, cell: Cell): Uint8ClampedArray {
  const { frameWidth, frameHeight } = sheet.geometry;
  const out = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      out[y * frameWidth + x] = alphaAt(
        grid,
        cell.col * frameWidth + x,
        cell.row * frameHeight + y,
      );
    }
  }
  return out;
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function inkStatsOf(
  alpha: Uint8ClampedArray,
  width: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < threshold) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    count++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    count,
    centroidX: count === 0 ? 0 : sumX / count,
    centroidY: count === 0 ? 0 : sumY / count,
    minX,
    maxX,
    minY,
    maxY,
  };
}

/** How many pixels differ between two cells of the same row. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inA = a[i] >= INK_ALPHA_THRESHOLD;
    const inB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inA !== inB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

const SKITTER_ROWS: readonly string[] = ['skitter', 'skitter_side', 'skitter_back'];
const IDLE_ROWS: readonly string[] = ['idle', 'idle_side', 'idle_back'];

function rowIndexOf(name: string): number {
  return ROWS.findIndex((row) => row.name === name);
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * `G1` — no ink on any cell border.
 *
 * A frame that paints outside its cell is sheared flat by the sheet blit and
 * baked in, and nothing downstream can detect it. On this animal the first thing
 * to go over the edge is always an antenna, which is also the cue the silhouette
 * can least afford to lose.
 */
function gateBorderClip(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  ROWS.forEach((row, index) => {
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: index }), frameWidth);
      if (stats.count === 0) {
        fail('G1', `${row.name}[${col}] painted nothing at all`);
        continue;
      }
      if (
        stats.minX === 0 ||
        stats.minY === 0 ||
        stats.maxX === frameWidth - 1 ||
        stats.maxY === frameHeight - 1
      ) {
        fail(
          'G1',
          `${row.name}[${col}] paints on its cell border ` +
            `(ink box ${stats.minX}..${stats.maxX} × ${stats.minY}..${stats.maxY} ` +
            `in a ${frameWidth}×${frameHeight} cell)`,
        );
      }
    }
  });
}

/**
 * `G2` — the tile anchor is the centre of the cell, and the animal is on it.
 *
 * This creature registers on its **body centre** rather than on a ground line,
 * so the whole contract is that the painter's origin, the cell centre and the
 * middle of the declared tile are the same point. Health bars and aggro markers
 * key off it, and a redraw moves it silently.
 *
 * The measurement is the *solid* ink's centroid, which weights the plates rather
 * than the antennae: the two filaments sweep forward together and would drag any
 * whole-ink centroid a long way off the body they hang from.
 */
/**
 * The tolerance has to clear the antennae. They are solid ink, they are a third
 * of the animal's own length, and they both sweep forward — so the mass of the animal
 * legitimately sits well ahead of the body's. The construction guarantees the
 * anchor; this check is the net that catches a gross break, not a fine one.
 */
const ANCHOR_TOLERANCE_PX = 14;

function gateAnchor(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight, tileX, tileY } = sheet.geometry;
  const wantTileX = frameWidth / 2 - TILE_SCALE / 2;
  const wantTileY = frameHeight / 2 - TILE_SCALE / 2;
  if (tileX !== wantTileX || tileY !== wantTileY) {
    fail(
      'G2',
      `the tile is declared at (${tileX}, ${tileY}) but a body-centred anchor in a ` +
        `${frameWidth}×${frameHeight} cell puts it at (${wantTileX}, ${wantTileY})`,
    );
  }
  for (const name of IDLE_ROWS) {
    const index = rowIndexOf(name);
    if (index < 0) continue;
    const alpha = cellAlpha(grid, sheet, { col: 0, row: index });
    const stats = inkStatsOf(alpha, frameWidth, SOLID_ALPHA_THRESHOLD);
    const off = Math.hypot(stats.centroidX - frameWidth / 2, stats.centroidY - frameHeight / 2);
    if (off > ANCHOR_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] carries its body mass at (${stats.centroidX.toFixed(1)}, ` +
          `${stats.centroidY.toFixed(1)}) against a cell centre of ` +
          `(${frameWidth / 2}, ${frameHeight / 2}) — ${off.toFixed(1)}px off the anchor, ` +
          `limit ${ANCHOR_TOLERANCE_PX}`,
      );
    }
  }
}

/**
 * `G3` — a looping row's last→first delta is no worse than the steps inside it.
 *
 * This is the gate that catches a gait that pops once per cycle, which is
 * invisible on a contact sheet because every individual frame is fine.
 *
 * The comparison is against the median step *and* the largest legitimate step in
 * the cycle. A sine-driven sweep is steepest at its own zero crossing, which
 * lands on the seam by construction — measured against the median alone that
 * correct animation fails, and loosening the median limit far enough to let it
 * through stops the gate catching anything.
 */
const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

function gateLoopClosure(grid: Grid, sheet: BakedSheet): void {
  for (const name of [...SKITTER_ROWS, ...IDLE_ROWS]) {
    const index = rowIndexOf(name);
    if (index < 0) {
      fail('G3', `row "${name}" is missing from ROWS`);
      continue;
    }
    const row = ROWS[index];
    const cells = Array.from({ length: row.frameCount }, (_unused, col) =>
      cellAlpha(grid, sheet, { col, row: index }),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    const worst = Math.max(...steps);
    if (typical === 0) continue;
    const allowed = Math.max(typical * LOOP_SEAM_LIMIT, worst * LOOP_SEAM_VS_WORST_STEP);
    if (seam > allowed) {
      fail(
        'G3',
        `${name} pops across its loop seam: last→first differs by ${seam}px against a median ` +
          `step of ${typical}px and a worst in-cycle step of ${worst}px ` +
          `(allowed ${allowed.toFixed(0)}px)`,
      );
    }
  }
}

/**
 * `G4` — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped knee, a mid-swing draw-order flip and an antenna that jumps
 * sides. One-shots are allowed a bigger spike than loops, because a lunge is
 * *meant* to have one violent frame in it — that is what a lunge is.
 */
const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * A step this small is not visible however large its ratio to the row's median.
 * Without a floor the gate is loudest on the rows that move least — and the idle
 * on this animal is deliberately near the threshold of visibility.
 */
const STEP_FLOOR_SHARE = 0.005;

function gateMotionContinuity(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, index) => {
    if (row.kind === 'gore') return;
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const cells = Array.from({ length: row.frameCount }, (_unused, col) =>
      cellAlpha(grid, sheet, { col, row: index }),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical === 0) return;
    const floor = sheet.geometry.frameWidth * sheet.geometry.frameHeight * STEP_FLOOR_SHARE;
    steps.forEach((step, i) => {
      const ratio = step / typical;
      if (ratio > limit && step > floor) {
        fail(
          'G4',
          `${row.name} jumps between frames ${i} and ${i + 1}: ${step}px against a median of ` +
            `${typical}px (${ratio.toFixed(2)}×, limit ${limit})`,
        );
      }
    });
  });
}

/**
 * `G5` — a skitter cycle runs on the spot rather than travelling across its cell.
 *
 * Measured as each frame's ink centroid against the **mean** centroid of the
 * whole loop, not as first-against-last. A gait is periodic by construction, so
 * the last frame is one step short of the first and a first-vs-last check
 * measures that step instead of the drift; the mean is the only reading that
 * says "this animal is not walking out of its own tile".
 */
const CENTROID_WANDER_LIMIT_PX = 4;

function gateCentroidWander(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  for (const name of SKITTER_ROWS) {
    const index = rowIndexOf(name);
    if (index < 0) continue;
    const row = ROWS[index];
    const centroids = Array.from({ length: row.frameCount }, (_unused, col) =>
      inkStatsOf(cellAlpha(grid, sheet, { col, row: index }), frameWidth),
    );
    const meanX = centroids.reduce((sum, s) => sum + s.centroidX, 0) / centroids.length;
    const meanY = centroids.reduce((sum, s) => sum + s.centroidY, 0) / centroids.length;
    centroids.forEach((stats, frame) => {
      const wander = Math.hypot(stats.centroidX - meanX, stats.centroidY - meanY);
      if (wander > CENTROID_WANDER_LIMIT_PX) {
        fail(
          'G5',
          `${name}[${frame}] sits ${wander.toFixed(2)}px from the loop's own mean centroid ` +
            `(limit ${CENTROID_WANDER_LIMIT_PX}) — the cycle is travelling, not skittering in place`,
        );
      }
    });
  }
}

/**
 * `G6` — every gore piece is big enough to be identified as it tumbles.
 *
 * Measured in *screen* pixels, at the 0.5× the runtime applies, not in sheet
 * pixels. A roach's parts are the smallest in the bestiary and this is the gate
 * that stops them shipping as eight brown flecks.
 */
const GORE_MIN_SHORT_AXIS_PX = 8;

function gateGoreLegibility(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  const goreRow = ROWS.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) return;
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  GORE_STATES.forEach((state, col) => {
    const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: goreRow }), frameWidth);
    if (stats.count === 0) {
      fail('G6', `${state} painted nothing`);
      return;
    }
    const shortAxis = Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis at the size it renders ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}) — nothing that thin can be told from anything else`,
      );
    }
  });
}

/**
 * `G7` — no two gore pieces are the same shape.
 *
 * Compared as small binary masks. Scale is normalised away but **aspect is
 * not**: stretching each piece to fill its own bounding box maps every convex
 * blob onto a filled square and measures the normalisation rather than the art.
 */
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(alpha: Uint8ClampedArray, width: number, stats: InkStats): boolean[] {
  const boxW = Math.max(1, stats.maxX - stats.minX);
  const boxH = Math.max(1, stats.maxY - stats.minY);
  const span = Math.max(boxW, boxH);
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = (i % width) - stats.minX;
    const y = Math.floor(i / width) - stats.minY;
    const mx = Math.min(DISTINCT_MASK - 1, Math.floor((x / span) * DISTINCT_MASK));
    const my = Math.min(DISTINCT_MASK - 1, Math.floor((y / span) * DISTINCT_MASK));
    mask[my * DISTINCT_MASK + mx] = true;
  }
  return mask;
}

function gateGoreDistinctness(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  const goreRow = ROWS.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) return;
  const masks = GORE_STATES.map((_unused, col) => {
    const alpha = cellAlpha(grid, sheet, { col, row: goreRow });
    return maskOf(alpha, frameWidth, inkStatsOf(alpha, frameWidth));
  });
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} are ${(iou * 100).toFixed(0)}% the same shape ` +
            `(limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
        );
      }
    }
  }
}

/**
 * `G8` — the antennae carry the silhouette to its declared span on every
 * skitter frame.
 *
 * The antennae are most of what makes this shape an insect rather than a seed,
 * and they are also the first thing a cell-size change crops. Cropping is
 * silent: `G1` only fires if the ink actually touches the border, and a painter
 * change that shortens the sweep does not touch it at all. Measured as the
 * frame's own ink box, in tiles.
 */
function gateAntennaReach(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  for (const name of SKITTER_ROWS) {
    const index = rowIndexOf(name);
    if (index < 0) continue;
    const row = ROWS[index];
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: index }), frameWidth);
      const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY) / TILE_SCALE;
      if (span < ANTENNA_MIN_SPAN_TILES) {
        fail(
          'G8',
          `${name}[${col}] spans only ${span.toFixed(3)} tiles across its longest axis against a ` +
            `declared antenna reach of ${ANTENNA_MIN_SPAN_TILES} — the antennae are being cropped ` +
            `or have been shortened, and they are the whole insect cue`,
        );
      }
    }
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * `G9` — the lunge peaks on exactly the frame the mob deals its damage.
 *
 * A timing table that drifted from the choreography puts the roach at full reach
 * two frames after the player has already been bitten.
 */
function gateBiteImpactIsThePeak(): void {
  let peakFrame = 0;
  let peakSurge = -Infinity;
  for (let frame = 0; frame < BITE_FRAMES; frame++) {
    const { surge } = bitePose(biteProgressOf(frame));
    if (surge > peakSurge) {
      peakSurge = surge;
      peakFrame = frame;
    }
  }
  if (peakFrame !== BITE_IMPACT_FRAME) {
    fail(
      'G9',
      `the bite lunges furthest on frame ${peakFrame} (surge ${peakSurge.toFixed(4)}) but the mob ` +
        `deals its damage on frame ${BITE_IMPACT_FRAME} — the two have drifted apart`,
    );
  }
}

/**
 * `G10` — the runtime's gore part list is the bake's own, in the bake's order.
 *
 * The order runs `cockroachGorePieces()` → the sheet's columns → the manifest's
 * `colOffset`s → `COCKROACH_GORE_PARTS`. Every other link in that chain fails
 * loudly; this one fails by dropping a body part on the floor and saying
 * nothing, because `BodyPartGoreSystem` skips a state it cannot find.
 *
 * The runtime module does not exist until the wiring lands, so a miss prints the
 * list to paste rather than failing. Once the file is there the gate binds.
 */
const RUNTIME_SPRITE_SOURCE = 'src/sprites/cockroachSprite.ts';
const RUNTIME_SPRITE_MODULE = '../src/sprites/cockroachSprite.js';
const RUNTIME_GORE_EXPORT = 'COCKROACH_GORE_PARTS';

function goreListFrom(loaded: unknown): readonly string[] | null {
  if (typeof loaded !== 'object' || loaded === null) return null;
  const namespace: Record<string, unknown> = { ...loaded };
  const parts: unknown = namespace[RUNTIME_GORE_EXPORT];
  if (!Array.isArray(parts)) return null;
  const names: string[] = [];
  for (const entry of parts) {
    if (typeof entry !== 'string') return null;
    names.push(entry);
  }
  return names;
}

async function gateGoreContract(): Promise<void> {
  if (!existsSync(resolve(RUNTIME_SPRITE_SOURCE))) {
    console.log(
      `  ${RUNTIME_SPRITE_SOURCE} does not exist yet — paste this into it:\n` +
        `    export const ${RUNTIME_GORE_EXPORT} = [\n` +
        GORE_STATES.map((state) => `      '${state}',`).join('\n') +
        `\n    ] as const;`,
    );
    return;
  }
  // The specifier is held in a variable on purpose: written as a literal, this
  // import is resolved at compile time and the whole gate module stops
  // typechecking on any checkout where the runtime file has not landed yet.
  const specifier = RUNTIME_SPRITE_MODULE;
  const loaded: unknown = await import(specifier);
  const parts = goreListFrom(loaded);
  if (parts === null) {
    fail(
      'G10',
      `${RUNTIME_SPRITE_SOURCE} exists but does not export ${RUNTIME_GORE_EXPORT} as an array ` +
        `of strings`,
    );
    return;
  }
  if (parts.length !== GORE_STATES.length) {
    fail(
      'G10',
      `the runtime lists ${parts.length} gore parts against the ${GORE_STATES.length} the bake ` +
        `produces`,
    );
    return;
  }
  GORE_STATES.forEach((state, index) => {
    if (parts[index] === state) return;
    fail(
      'G10',
      `gore piece ${index} bakes as "${state}" but the runtime spawns "${parts[index]}" in that slot`,
    );
  });

  gateTimingContract(loaded);
}

/**
 * `G10b` — the row lengths and the impact frame the runtime declares are the
 * ones the sheet actually has.
 *
 * `drawSprite` clamps the frame index, so a row that lost a frame does not
 * error: it freezes on its last cell and the animation quietly stops short. The
 * impact frame matters for the same reason in reverse — the roach's bite lands
 * on it, so a drift between the two puts the damage on a frame where the sprite
 * is nowhere near the player.
 */
const RUNTIME_BITE_FRAMES_EXPORT = 'COCKROACH_BITE_FRAMES';
const RUNTIME_BITE_IMPACT_EXPORT = 'COCKROACH_BITE_IMPACT_FRAME';

function numberFrom(loaded: unknown, exportName: string): number | null {
  if (typeof loaded !== 'object' || loaded === null) return null;
  const namespace: Record<string, unknown> = { ...loaded };
  const value: unknown = namespace[exportName];
  return typeof value === 'number' ? value : null;
}

function gateTimingContract(loaded: unknown): void {
  const biteRow = ROWS.find((row) => row.name === 'bite');
  if (biteRow === undefined) {
    fail('G10b', 'there is no bite row in ROWS to hold the runtime against');
    return;
  }

  const runtimeBiteFrames = numberFrom(loaded, RUNTIME_BITE_FRAMES_EXPORT);
  if (runtimeBiteFrames === null) {
    fail('G10b', `${RUNTIME_SPRITE_SOURCE} does not export ${RUNTIME_BITE_FRAMES_EXPORT}`);
  } else if (runtimeBiteFrames !== biteRow.frameCount) {
    fail(
      'G10b',
      `the bite row bakes ${biteRow.frameCount} frames and the runtime declares ` +
        `${runtimeBiteFrames}; the shorter of the two is the one that freezes`,
    );
  }

  const runtimeImpact = numberFrom(loaded, RUNTIME_BITE_IMPACT_EXPORT);
  if (runtimeImpact === null) {
    fail('G10b', `${RUNTIME_SPRITE_SOURCE} does not export ${RUNTIME_BITE_IMPACT_EXPORT}`);
  } else if (runtimeImpact !== BITE_IMPACT_FRAME) {
    fail(
      'G10b',
      `the lunge peaks on frame ${BITE_IMPACT_FRAME} and the runtime deals its damage on ` +
        `frame ${runtimeImpact}`,
    );
  }
}

/**
 * `G11` — the sheet is not quietly getting expensive.
 *
 * Reported even when it passes: every sheet in this game is preloaded at boot
 * and held decoded, so a row added without thought is memory nobody sees spent.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 1.9;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

function gateTextureSize(sheet: BakedSheet): void {
  const pixels =
    sheet.columns * sheet.geometry.frameWidth * ROWS.length * sheet.geometry.frameHeight;
  const megapixels = pixels / 1e6;
  const decodedMb = (pixels * BYTES_PER_PIXEL) / BYTES_PER_MEGABYTE;
  console.log(`  texture: ${megapixels.toFixed(2)}MP, ${decodedMb.toFixed(1)}MB decoded`);
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G11',
      `the sheet totals ${megapixels.toFixed(2)} megapixels against a budget of ` +
        `${TEXTURE_BUDGET_MEGAPIXELS} — it is preloaded and held decoded at boot`,
    );
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runGates(): Promise<void> {
  console.log('Gating the cockroach bake…');
  const sheet = bake();
  const grid = gridOf(await decode(sheet));

  gateBorderClip(grid, sheet);
  gateAnchor(grid, sheet);
  gateLoopClosure(grid, sheet);
  gateMotionContinuity(grid, sheet);
  gateCentroidWander(grid, sheet);
  gateGoreLegibility(grid, sheet);
  gateGoreDistinctness(grid, sheet);
  gateAntennaReach(grid, sheet);
  gateBiteImpactIsThePeak();
  await gateGoreContract();
  gateTextureSize(sheet);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log('  all gates passed');
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runGates()
    .then(async () => {
      const { writeSheet } = await import('./generate-cockroach-sprite');
      writeSheet();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
