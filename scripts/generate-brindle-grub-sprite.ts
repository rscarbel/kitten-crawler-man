#!/usr/bin/env tsx
/**
 * Generates the two Brindle Grub sprite sheets:
 *
 *   `brindle_grub`     — the passive first-instar larva
 *   `cow_tailed_grub`  — the biting second instar, bigger and tailed
 *
 * Both are baked from one drawing engine (`scripts/grubArt.ts`) with different
 * `GrubBuild`s and different scales, the way the Mantid boss and crony share
 * `mantidArt.ts`. Only the cow-tailed grub carries the bite-attack rows and the
 * tail appendage.
 *
 * Rows (see the `brindle_grub` / `cow_tailed_grub` entries in
 * src/images/enemies/manifest.json):
 *    idle                              — a slow single-frame breathing hold
 *    walk / walk_side / walk_away      — the peristaltic crawl
 *    attack / attack_side / attack_away  (cow-tailed grub only) — the bite
 *
 * The frame geometry is measured rather than declared, the same way the
 * Mantid bake is: a bite lunge reaches noticeably past the resting silhouette,
 * and a hand-guessed cell is how a striking grub ends up sheared at the edge.
 *
 * Run: npm run gen:grub
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  BRINDLE_GRUB_BUILD,
  COW_TAILED_GRUB_BUILD,
  GROUND_Y,
  bitePose,
  drawGrubAway,
  drawGrubFront,
  drawGrubSide,
  restGrubPose,
  type GrubBuild,
  type GrubPose,
} from './grubArt.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

export const TILE_SCALE = 64;
const SUPERSAMPLE = 2;
const FRAME_PADDING = 6;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 1;
const ATTACK_FRAMES = 7;

const IDLE_BREATHE_PHASE = 0.3;

function idlePose(): GrubPose {
  return { ...restGrubPose(), breathe: IDLE_BREATHE_PHASE };
}

function walkPose(phase: number): GrubPose {
  return { ...restGrubPose(), crawlPhase: phase, sway: Math.sin(phase * Math.PI * 2), time: phase };
}

// ── Row manifest ─────────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'away';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: View;
  readonly pose: (t: number) => GrubPose;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const SHARED_ROWS: readonly RowSpec[] = [
  { name: 'idle', frameCount: IDLE_FRAMES, view: 'front', pose: () => idlePose() },
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'away',
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
];

const BITE_ROWS: readonly RowSpec[] = [
  {
    name: 'attack',
    frameCount: ATTACK_FRAMES,
    view: 'front',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'attack_side',
    frameCount: ATTACK_FRAMES,
    view: 'side',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
  {
    name: 'attack_away',
    frameCount: ATTACK_FRAMES,
    view: 'away',
    pose: (f) => bitePose(shotProgress(f, ATTACK_FRAMES)),
  },
];

// ── Variants ─────────────────────────────────────────────────────────────────

export type VariantId = 'brindle_grub' | 'cow_tailed_grub';

export interface Variant {
  readonly id: VariantId;
  readonly build: GrubBuild;
  readonly scale: number;
  readonly rows: readonly RowSpec[];
  readonly sheetPath: string;
  readonly manifestPath: string;
}

/** The first instar is a small but clearly-detailed larva. */
const BRINDLE_GRUB_SCALE = 0.95;
/** The second instar has visibly grown, tail and all. */
const COW_TAILED_GRUB_SCALE = 1.25;

export const VARIANTS: readonly Variant[] = [
  {
    id: 'brindle_grub',
    build: BRINDLE_GRUB_BUILD,
    scale: BRINDLE_GRUB_SCALE,
    rows: SHARED_ROWS,
    sheetPath: 'src/images/enemies/brindle_grub.png',
    manifestPath: 'enemies/brindle_grub.png',
  },
  {
    id: 'cow_tailed_grub',
    build: COW_TAILED_GRUB_BUILD,
    scale: COW_TAILED_GRUB_SCALE,
    rows: [...SHARED_ROWS, ...BITE_ROWS],
    sheetPath: 'src/images/enemies/cow_tailed_grub.png',
    manifestPath: 'enemies/cow_tailed_grub.png',
  },
];

export function variantById(id: string): Variant {
  const found = VARIANTS.find((variant) => variant.id === id);
  if (found === undefined) throw new Error(`no grub variant named "${id}"`);
  return found;
}

// ── Bake ─────────────────────────────────────────────────────────────────────

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(variant: Variant): FrameJob[] {
  const jobs: FrameJob[] = [];
  for (const row of variant.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      jobs.push({
        row,
        frame,
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          // Scaled about the ground line so the bigger second instar still
          // stands on the tile its underside belongs to.
          ctx.translate(0, GROUND_Y);
          ctx.scale(variant.scale, variant.scale);
          ctx.translate(0, -GROUND_Y);
          const pose = row.pose(frame);
          if (row.view === 'front') drawGrubFront(ctx, variant.build, pose);
          else if (row.view === 'away') drawGrubAway(ctx, variant.build, pose);
          else drawGrubSide(ctx, variant.build, pose);
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

const INK_ALPHA_THRESHOLD = 24;
const MEASURE_SIZE = 512;

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBoxOf(ctx: Ctx, width: number, height: number): InkBox | null {
  const { data } = ctx.getImageData(0, 0, width, height);
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

interface Extents {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  readonly blankFrames: readonly string[];
  readonly clippedFrames: readonly string[];
}

function measure(jobs: readonly FrameJob[]): Extents {
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  const blankFrames: string[] = [];
  const clippedFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_SIZE, MEASURE_SIZE);
    job.paint(ctx, originX, originY);
    const box = inkBoxOf(ctx, MEASURE_SIZE, MEASURE_SIZE);
    if (box === null) {
      blankFrames.push(`${job.row.name}[${job.frame}]`);
      continue;
    }
    if (
      box.minX <= 0 ||
      box.minY <= 0 ||
      box.maxX >= MEASURE_SIZE - 1 ||
      box.maxY >= MEASURE_SIZE - 1
    ) {
      clippedFrames.push(`${job.row.name}[${job.frame}]`);
    }
    left = Math.max(left, originX - box.minX);
    right = Math.max(right, box.maxX - originX);
    up = Math.max(up, originY - box.minY);
    down = Math.max(down, box.maxY - originY);
  }

  return { left, right, up, down, blankFrames, clippedFrames };
}

export interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function geometryFor(extents: Extents): SheetGeometry {
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(originY + extents.down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  return {
    frameWidth,
    frameHeight,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: originY - TILE_SCALE / 2,
  };
}

export interface BakedSheet {
  readonly variant: Variant;
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

export function bake(variant: Variant): BakedSheet {
  const jobs = buildJobs(variant);
  const extents = measure(jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `[${variant.id}] these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }
  if (extents.clippedFrames.length > 0) {
    throw new Error(
      `[${variant.id}] these frames ran off the ${MEASURE_SIZE}px measuring canvas: ` +
        extents.clippedFrames.join(', '),
    );
  }

  const geometry = geometryFor(extents);
  const columns = Math.max(...variant.rows.map((row) => row.frameCount));
  const sheet = createCanvas(
    columns * geometry.frameWidth,
    variant.rows.length * geometry.frameHeight,
  );
  const sheetCtx = sheet.getContext('2d');

  const cell = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  const rowIndexOf = new Map(variant.rows.map((row, index) => [row.name, index]));
  for (const job of jobs) {
    const rowIndex = rowIndexOf.get(job.row.name);
    if (rowIndex === undefined) throw new Error(`row "${job.row.name}" is not in the variant`);

    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    const originY = geometry.tileY + TILE_SCALE / 2;
    job.paint(cellCtx, geometry.frameWidth / 2, originY);
    cellCtx.restore();

    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      job.frame * geometry.frameWidth,
      rowIndex * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );
  }

  return {
    variant,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns,
  };
}

// ── Manifest verification ────────────────────────────────────────────────────

const MANIFEST_PATH = 'src/images/enemies/manifest.json';

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

function manifestEntryFor(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  sheet.variant.rows.forEach((row, index) => {
    states[row.name] = { row: index, frameCount: row.frameCount };
  });
  return {
    path: sheet.variant.manifestPath,
    frameWidth: sheet.geometry.frameWidth,
    frameHeight: sheet.geometry.frameHeight,
    tileX: sheet.geometry.tileX,
    tileY: sheet.geometry.tileY,
    tileScale: TILE_SCALE,
    states,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

function verifyManifest(sheets: readonly BakedSheet[]): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };

  let mismatched = false;
  for (const sheet of sheets) {
    const required = manifestEntryFor(sheet);
    if (canonicalJson(manifest[sheet.variant.id]) !== canonicalJson(required)) {
      console.error(
        `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "${sheet.variant.id}" entry with:\n` +
          `${JSON.stringify({ [sheet.variant.id]: required }, null, 2)}\n`,
      );
      mismatched = true;
    }
  }
  if (mismatched) {
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function writeSheets(): void {
  const sheets: BakedSheet[] = [];
  for (const variant of VARIANTS) {
    console.log(`Generating ${variant.id} sprite sheet (scale=${variant.scale})…`);
    const sheet = bake(variant);
    writeFileSync(resolve(variant.sheetPath), sheet.buffer);
    sheets.push(sheet);
    console.log(`  → ${variant.sheetPath}`);
    console.log(
      `  → ${sheet.columns * sheet.geometry.frameWidth}×${variant.rows.length * sheet.geometry.frameHeight}px  ` +
        `(${variant.rows.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
    );
    variant.rows.forEach((row, index) => {
      console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
    });
    console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  }
  verifyManifest(sheets);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}
