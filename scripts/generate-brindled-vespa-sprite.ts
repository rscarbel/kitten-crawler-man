#!/usr/bin/env tsx
/**
 * Generates the Brindled Vespa sprite sheet — the flying, final stage of the
 * Brindle Grub lifecycle. Modelled directly on `scripts/generate-mantid-sprite.ts`:
 * the anatomy and painting live in `brindledVespaArt.ts`, the gore pieces in
 * `brindledVespaGore.ts`, and this file is the choreography plus the bake.
 *
 * Rows (see the `brindled_vespa` entry in src/images/enemies/manifest.json):
 *    hover / hover_side / hover_away              — the wingbeat-driven loop
 *    spit_windup / spit_windup_side / spit_windup_away  — the rear-back charge
 *                                                     before the acid spit fires
 *    gore                                          — the eight severed pieces
 *
 * Run: npm run gen:vespa
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  BRINDLED_VESPA_BUILD,
  GROUND_Y,
  drawVespaAway,
  drawVespaFront,
  drawVespaSide,
  restVespaPose,
  windupPose,
  type VespaBuild,
  type VespaPose,
} from './brindledVespaArt.js';
import { brindledVespaGorePieces } from './brindledVespaGore.js';
// The runtime's own copy of the piece order, imported so the bake can police it.
import { BRINDLED_VESPA_GORE_PARTS } from '../src/sprites/brindledVespaSprite.js';

export const TILE_SCALE = 64;
const SUPERSAMPLE = 2;
const FRAME_PADDING = 8;
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

const HOVER_FRAMES = 8;
const WINDUP_FRAMES = 9;

function hoverPose(phase: number): VespaPose {
  const angle = phase * Math.PI * 2;
  return {
    ...restVespaPose(),
    bob: Math.sin(angle * 2) * 0.012,
    sway: Math.sin(angle) * 0.01,
    lean: Math.sin(angle) * 0.02,
    wingbeat: phase,
    wingSpread: 1,
    headPitch: Math.sin(angle) * 0.006,
    abdomenCurl: Math.sin(angle) * 0.03,
    legs: [
      { swing: Math.sin(angle) * 0.06, tuck: 0 },
      { swing: Math.sin(angle + 0.6) * 0.06, tuck: 0 },
      { swing: Math.sin(angle + 1.2) * 0.06, tuck: 0 },
    ],
    time: phase,
  };
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

type View = 'front' | 'side' | 'away';
type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: View;
  readonly pose: ((t: number) => VespaPose) | null;
}

const GORE_PIECES = brindledVespaGorePieces();
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);
const GORE_PIECE_SCALE = 1.3;

const ROWS: readonly RowSpec[] = [
  {
    name: 'hover',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'front',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'hover_side',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'side',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'hover_away',
    frameCount: HOVER_FRAMES,
    kind: 'loop',
    view: 'away',
    pose: (f) => hoverPose(cyclePhase(f, HOVER_FRAMES)),
  },
  {
    name: 'spit_windup',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'front',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  {
    name: 'spit_windup_side',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'side',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  {
    name: 'spit_windup_away',
    frameCount: WINDUP_FRAMES,
    kind: 'oneShot',
    view: 'away',
    pose: (f) => windupPose(shotProgress(f, WINDUP_FRAMES)),
  },
  {
    name: 'gore',
    frameCount: GORE_PIECES.length,
    kind: 'gore',
    view: 'side',
    pose: null,
  },
];

export interface Variant {
  readonly build: VespaBuild;
  readonly scale: number;
  readonly rows: readonly RowSpec[];
  readonly sheetPath: string;
  readonly manifestPath: string;
}

/** A hornet reads as dangerous at a size that visibly outsizes the grub stages. */
const VESPA_SCALE = 1.4;

export const VARIANT: Variant = {
  build: BRINDLED_VESPA_BUILD,
  scale: VESPA_SCALE,
  rows: ROWS,
  sheetPath: 'src/images/enemies/brindled_vespa.png',
  manifestPath: 'enemies/brindled_vespa.png',
};

// ── Bake ─────────────────────────────────────────────────────────────────────

interface Pt {
  readonly x: number;
  readonly y: number;
}

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  readonly anchor: 'origin' | 'cellCentre';
  readonly paint: (ctx: Ctx, originX: number, originY: number) => void;
}

function buildJobs(variant: Variant, goreOffsets?: ReadonlyMap<number, Pt>): FrameJob[] {
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE * variant.scale;
  const jobs: FrameJob[] = [];
  for (const row of variant.rows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = GORE_PIECES[frame];
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          paint: (ctx, originX, originY) => {
            ctx.save();
            ctx.translate(originX + recentre.x * goreUnit, originY + recentre.y * goreUnit);
            ctx.scale(goreUnit, goreUnit);
            piece.paint(ctx, variant.build);
            ctx.restore();
          },
        });
        continue;
      }

      const { pose, view } = row;
      if (pose === null) throw new Error(`row "${row.name}" is not gore but has no pose function`);
      jobs.push({
        row,
        frame,
        anchor: 'origin',
        paint: (ctx, originX, originY) => {
          ctx.save();
          ctx.translate(originX, originY);
          ctx.scale(TILE_SCALE, TILE_SCALE);
          ctx.translate(0, GROUND_Y);
          ctx.scale(variant.scale, variant.scale);
          ctx.translate(0, -GROUND_Y);
          if (view === 'front') drawVespaFront(ctx, variant.build, pose(frame));
          else if (view === 'away') drawVespaAway(ctx, variant.build, pose(frame));
          else drawVespaSide(ctx, variant.build, pose(frame));
          ctx.restore();
        },
      });
    }
  }
  return jobs;
}

const INK_ALPHA_THRESHOLD = 24;
const MEASURE_SIZE = 768;

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
  readonly goreRadius: number;
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  readonly blankFrames: readonly string[];
  readonly clippedFrames: readonly string[];
}

function measure(variant: Variant, jobs: readonly FrameJob[]): Extents {
  const goreUnit = TILE_SCALE * GORE_PIECE_SCALE * variant.scale;
  const canvas = createCanvas(MEASURE_SIZE, MEASURE_SIZE);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_SIZE / 2;
  const originY = MEASURE_SIZE / 2;

  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
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

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      const previous = goreOffsets.get(job.frame) ?? { x: 0, y: 0 };
      goreOffsets.set(job.frame, {
        x: previous.x + (originX - inkCentreX) / goreUnit,
        y: previous.y + (originY - inkCentreY) / goreUnit,
      });
      const halfWidth = (box.maxX - box.minX) / 2;
      const halfHeight = (box.maxY - box.minY) / 2;
      goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight));
      continue;
    }

    left = Math.max(left, originX - box.minX);
    right = Math.max(right, box.maxX - originX);
    up = Math.max(up, originY - box.minY);
    down = Math.max(down, box.maxY - originY);
  }

  return { left, right, up, down, goreRadius, goreOffsets, blankFrames, clippedFrames };
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
  const goreSpan = (extents.goreRadius + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(
    Math.max(originY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
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

const GORE_AREA_INFLATION_LIMIT = 2;

export function bake(variant: Variant): BakedSheet {
  const measured = measure(variant, buildJobs(variant));
  const jobs = buildJobs(variant, measured.goreOffsets);
  const extents = measure(variant, jobs);

  if (extents.blankFrames.length > 0) {
    throw new Error(
      `these frames painted nothing, which almost always means a NaN in the pose: ` +
        extents.blankFrames.join(', '),
    );
  }
  if (extents.clippedFrames.length > 0) {
    throw new Error(
      `these frames ran off the ${MEASURE_SIZE}px measuring canvas: ${extents.clippedFrames.join(', ')}`,
    );
  }

  const geometry = geometryFor(extents);
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const animationArea = animationOnly.frameWidth * animationOnly.frameHeight;
  const inflation = (geometry.frameWidth * geometry.frameHeight) / animationArea;
  if (inflation > GORE_AREA_INFLATION_LIMIT) {
    throw new Error(
      `the gore pieces inflate every cell to ${inflation.toFixed(2)}x the area the animation rows need`,
    );
  }

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
    const originY =
      job.anchor === 'cellCentre' ? geometry.frameHeight / 2 : geometry.tileY + TILE_SCALE / 2;
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
  readonly colOffset?: number;
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
    if (row.kind === 'gore') {
      GORE_STATES.forEach((state, column) => {
        states[state] = { row: index, colOffset: column, frameCount: 1 };
      });
      return;
    }
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

function verifyManifest(sheet: BakedSheet): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntryFor(sheet);
  if (canonicalJson(manifest.brindled_vespa) !== canonicalJson(required)) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Replace its "brindled_vespa" entry with:\n` +
        `${JSON.stringify({ brindled_vespa: required }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function assertGoreStatesMatchRuntime(): void {
  const baked = GORE_STATES.join(', ');
  const runtime = BRINDLED_VESPA_GORE_PARTS.join(', ');
  if (baked !== runtime) {
    throw new Error(
      'the gore pieces this bake produces are not the ones the runtime asks for.\n' +
        `  baked   (scripts/brindledVespaGore.ts): ${baked}\n` +
        `  runtime (src/sprites/brindledVespaSprite.ts): ${runtime}`,
    );
  }
}

function writeSheets(): void {
  assertGoreStatesMatchRuntime();
  console.log(`Generating brindled_vespa sprite sheet (scale=${VARIANT.scale})…`);
  const sheet = bake(VARIANT);
  writeFileSync(resolve(VARIANT.sheetPath), sheet.buffer);
  console.log(`  → ${VARIANT.sheetPath}`);
  console.log(
    `  → ${sheet.columns * sheet.geometry.frameWidth}×${VARIANT.rows.length * sheet.geometry.frameHeight}px  ` +
      `(${VARIANT.rows.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  VARIANT.rows.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames, ${row.view})`);
  });
  console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
  verifyManifest(sheet);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}
