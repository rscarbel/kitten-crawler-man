#!/usr/bin/env tsx
/**
 * The bake gate for Mongo's three growth-stage sheets, and the entry point
 * behind `npm run gen:mongo`.
 *
 * The generator itself has no write path on purpose: this file bakes into
 * memory, measures both the baked pixels and the pose stream, throws on anything
 * wrong, and only then writes. A sheet that fails a gate must never reach disk,
 * because almost nothing downstream can detect a bad one — the runtime happily
 * renders a raptor whose knee snaps once per cycle, or whose pink crest quietly
 * disappeared from half its frames.
 *
 * Every gate carries an ID and reports the measured value *and* the limit, so a
 * failure says what to change rather than that something is wrong.
 *
 * Run: npm run gen:mongo
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import {
  CONTRALATERAL_PHASE,
  ROWS,
  STANCE_FRACTION,
  TILE_SCALE,
  bake,
  manifestMismatch,
  poseStream,
  sheetPathFor,
  type BakedSheet,
  type RowSpec,
  type SheetGeometry,
} from './generate-mongo-sprites.js';
import {
  GROUND_Y,
  MONGO_STAGES,
  MONGO_STAGE_ORDER,
  legReach,
  measureFootSickle,
  measureHandClaw,
  measureHead,
  measureLegs,
  type MongoStage,
} from './mongoArt.js';

/**
 * The measure→paste→re-run escape hatch: after a pose change the geometry moves,
 * so the manifest is knowingly stale for exactly one run. An explicit flag, not
 * a loosened threshold.
 */
const SKIP_MANIFEST_GATE = process.argv.includes('--skip-manifest-gate');

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha on a cell border above which the frame is judged to have overrun it. */
const BORDER_ALPHA_LIMIT = 8;
const MAX_ALPHA = 255;

interface Cell {
  /** RGBA, four bytes per pixel, row-major within the cell. */
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.pixels[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

function readCells(image: Image, sheet: BakedSheet): Map<string, Cell> {
  const { frameWidth, frameHeight } = sheet.geometry;
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);

  const cells = new Map<string, Cell>();
  ROWS.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pixels = new Uint8Array(frameWidth * frameHeight * CHANNELS);
      for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
          const source =
            ((rowIndex * frameHeight + y) * image.width + frame * frameWidth + x) * CHANNELS;
          const destination = (y * frameWidth + x) * CHANNELS;
          for (let channel = 0; channel < CHANNELS; channel++) {
            pixels[destination + channel] = data[source + channel];
          }
        }
      }
      cells.set(cellKey(row.name, frame), { pixels, width: frameWidth, height: frameHeight });
    }
  });
  return cells;
}

function cellKey(row: string, frame: number): string {
  return `${row}[${frame}]`;
}

function cellOf(cells: Map<string, Cell>, row: string, frame: number): Cell {
  const cell = cells.get(cellKey(row, frame));
  if (cell === undefined) throw new Error(`no baked cell for ${cellKey(row, frame)}`);
  return cell;
}

/** Mean absolute alpha difference between two cells, 0–255. */
function cellDelta(a: Cell, b: Cell): number {
  let total = 0;
  const count = a.width * a.height;
  for (let i = 0; i < count; i++) {
    total += Math.abs(
      a.pixels[i * CHANNELS + ALPHA_OFFSET] - b.pixels[i * CHANNELS + ALPHA_OFFSET],
    );
  }
  return total / count;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function inkCentroid(cell: Cell): Point {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < INK_ALPHA_THRESHOLD) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) throw new Error('a baked cell holds no ink at all');
  return { x: sumX / count, y: sumY / count };
}

interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBox(cell: Cell): InkBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, y) < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) throw new Error('a baked cell holds no ink at all');
  return { minX, minY, maxX, maxY };
}

const LOOP_ROWS = ROWS.filter((row) => row.kind === 'loop');

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * G1 — border clip. A frame that paints outside its cell is sheared flat by the
 * sheet blit and baked in, and nothing downstream can detect it.
 */
function gateBorderClip(stage: MongoStage, cells: Map<string, Cell>): void {
  for (const [key, cell] of cells) {
    for (let x = 0; x < cell.width; x++) {
      if (alphaAt(cell, x, 0) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${stage} ${key} paints off its top edge`);
      }
      if (alphaAt(cell, x, cell.height - 1) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${stage} ${key} paints off its bottom edge`);
      }
    }
    for (let y = 0; y < cell.height; y++) {
      if (alphaAt(cell, 0, y) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${stage} ${key} paints off its left edge`);
      }
      if (alphaAt(cell, cell.width - 1, y) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${stage} ${key} paints off its right edge`);
      }
    }
  }
}

/**
 * G2 — anchor. His feet must stand on the tile the manifest claims, or the
 * health bar, the aggro marker and the minimap dot all sit somewhere else.
 *
 * Checked on frame 0 of every row rather than on one sample: the head-on and
 * edge-on feet are painted by different code, and a view that stands a pixel
 * lower than the others is exactly the drift a single-row check cannot see.
 */
const ANCHOR_TOLERANCE_PX = 2;
/** How far below the soles the contact shadow legitimately reaches. */
const SHADOW_SPREAD_PX = 7;
/** Where the ground line falls inside the logical tile, measured from its top. */
const GROUND_OFFSET_IN_TILE = 0.5 + GROUND_Y;
/** The collapse's last frame, where he is finally lying down. */
const COLLAPSE_SETTLED_FRAME = 9;

function gateAnchor(stage: MongoStage, cells: Map<string, Cell>, geometry: SheetGeometry): void {
  const groundY = geometry.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  // Frame 0 of every row, plus the *last* frame of the collapse: that row is the
  // only one whose settled pose is at its end, and it is the one that reaches
  // the floor. Sampled at frame 0 alone the buckle can drive his jaw straight
  // through the ground and nothing notices.
  const samples: ReadonlyArray<readonly [string, number]> = [
    ...ROWS.map((row) => [row.name, 0] as const),
    ['collapse', COLLAPSE_SETTLED_FRAME],
  ];
  for (const [rowName, frame] of samples) {
    const row = { name: `${rowName}[${frame}]` };
    const box = inkBox(cellOf(cells, rowName, frame));
    // Signed, not absolute. The shadow allowance exists only for ink *below* the
    // soles; an absolute test spends it on the other side too and lets him float
    // a quarter of a tile above the floor everything else stands on.
    if (box.maxY < groundY - ANCHOR_TOLERANCE_PX) {
      throw new Error(
        `G2: ${stage} ${row.name}'s lowest ink is ${(groundY - box.maxY).toFixed(1)}px *above* ` +
          `the tile's ground line — he is floating`,
      );
    }
    if (box.maxY > groundY + SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX) {
      throw new Error(
        `G2: ${stage} ${row.name}'s lowest ink is ${(box.maxY - groundY).toFixed(1)}px below ` +
          `the ground line (limit ${SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX}px) — the manifest's ` +
          `tileY no longer describes where he stands`,
      );
    }
  }
}

/**
 * Floor under both delta gates, as a budget of fully-opaque pixels on the bake.
 *
 * Both gates are ratio tests, and a ratio against a near-zero median means
 * nothing: a head-on idle is *supposed* to sit near the threshold of visibility,
 * so its typical step is a fraction of a pixel's worth of antialiased edge and
 * any transition at all measures several times it.
 */
const SEAM_INK_BUDGET_PX = 30;

function deltaLimit(typical: number, factor: number, geometry: SheetGeometry): number {
  const floor = (SEAM_INK_BUDGET_PX * MAX_ALPHA) / (geometry.frameWidth * geometry.frameHeight);
  return Math.max(typical * factor, floor);
}

function rowSteps(cells: Map<string, Cell>, row: RowSpec): number[] {
  const steps: number[] = [];
  for (let frame = 1; frame < row.frameCount; frame++) {
    steps.push(cellDelta(cellOf(cells, row.name, frame - 1), cellOf(cells, row.name, frame)));
  }
  return steps;
}

/**
 * G3 — loop closure. A cycle whose last frame does not lead back into its first
 * pops once per lap, which is invisible on a contact sheet and obvious in motion.
 */
const LOOP_SEAM_LIMIT = 2.2;
/** How much larger than the largest in-loop step a closing seam may be. */
const SEAM_OVER_LARGEST_STEP = 1.2;

function gateLoopClosure(
  stage: MongoStage,
  cells: Map<string, Cell>,
  geometry: SheetGeometry,
): void {
  for (const row of LOOP_ROWS) {
    const steps = rowSteps(cells, row);
    const seam = cellDelta(cellOf(cells, row.name, row.frameCount - 1), cellOf(cells, row.name, 0));
    const typical = median(steps);
    // Against the biggest step *inside* the loop as well as against the median.
    // A cycle driven by a sine sampled at eight points has steps that alternate
    // between 0.71A and 0.29A, so its median is the small one and its seam is
    // legitimately 2.4× that — a median-only test fails a loop that closes
    // perfectly, which is worse than useless because the fix is to break it.
    const limit = Math.max(
      deltaLimit(typical, LOOP_SEAM_LIMIT, geometry),
      Math.max(...steps) * SEAM_OVER_LARGEST_STEP,
    );
    if (seam > limit) {
      throw new Error(
        `G3: ${stage} ${row.name}'s loop seam is ${seam.toFixed(2)} against a median step of ` +
          `${typical.toFixed(2)} and a largest step of ${Math.max(...steps).toFixed(2)} ` +
          `(limit ${limit.toFixed(2)})`,
      );
    }
  }
}

/**
 * G4 — motion continuity. A snapped knee, a mid-swing draw-order flip or an IK
 * clamp all show up as one consecutive-frame delta far above its neighbours.
 *
 * One-shots get a looser factor than loops on purpose: an attack is *supposed*
 * to have a fastest moment, and holding a strike to a walk's evenness would
 * force out the acceleration that makes it read as a strike.
 */
const LOOP_CONTINUITY_LIMIT = 2.4;
const ONE_SHOT_CONTINUITY_LIMIT = 4.2;

function gateContinuity(
  stage: MongoStage,
  cells: Map<string, Cell>,
  geometry: SheetGeometry,
): void {
  for (const row of ROWS) {
    const steps = rowSteps(cells, row);
    const typical = median(steps);
    const factor = row.kind === 'loop' ? LOOP_CONTINUITY_LIMIT : ONE_SHOT_CONTINUITY_LIMIT;
    const limit = deltaLimit(typical, factor, geometry);
    steps.forEach((step, index) => {
      if (step > limit) {
        throw new Error(
          `G4: ${stage} ${row.name} jumps ${step.toFixed(2)} between frames ${index} and ` +
            `${index + 1}, against a median step of ${typical.toFixed(2)} (limit ${limit.toFixed(2)})`,
        );
      }
    });
  }
}

/**
 * G5 — centroid drift. A walk cycle is drawn in place: the body must end the lap
 * where it started it, or he moonwalks along his own path.
 */
const CENTROID_DRIFT_LIMIT_PX = 1.5;
/** A seam step may be this much larger than a typical one before it reads. */
const CENTROID_SEAM_SHARE = 2;

function gateCentroidDrift(stage: MongoStage, cells: Map<string, Cell>): void {
  for (const row of LOOP_ROWS) {
    const first = inkCentroid(cellOf(cells, row.name, 0));
    const last = inkCentroid(cellOf(cells, row.name, row.frameCount - 1));
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      const before = inkCentroid(cellOf(cells, row.name, frame - 1));
      const after = inkCentroid(cellOf(cells, row.name, frame));
      steps.push(Math.hypot(after.x - before.x, after.y - before.y));
    }
    const seam = Math.hypot(first.x - last.x, first.y - last.y);
    // Against the largest in-loop step as well, for the same reason G3 is: a
    // cycle driven by a sine sampled at eight points has steps that alternate
    // large and small, so its median is the small one and a seam that closes
    // perfectly still measures over twice it.
    const limit = Math.max(
      CENTROID_DRIFT_LIMIT_PX,
      median(steps) * CENTROID_SEAM_SHARE,
      Math.max(...steps) * SEAM_OVER_LARGEST_STEP,
    );
    if (seam > limit) {
      throw new Error(
        `G5: ${stage} ${row.name}'s ink centroid steps ${seam.toFixed(2)}px across the loop ` +
          `seam, against a largest in-loop step of ${Math.max(...steps).toFixed(2)}px and a ` +
          `limit of ${limit.toFixed(2)}px`,
      );
    }
  }
}

/**
 * G-FEATHER — the three pink display zones.
 *
 * The brief puts pink in exactly three places: the head crest, the forearms and
 * the tail fan. It is an invariant, not a decoration: a frame that loses one has
 * lost the thing that separates Mongo from any other blue lizard, and a pose
 * change that hides the crest behind the body is invisible on a contact sheet
 * scrolled past at speed.
 */
const PINK_MIN_RED = 170;
const PINK_RED_OVER_GREEN = 45;
/**
 * How much pink a zone must hold, as a share of the frame's own ink.
 *
 * A share rather than a flat count: the juvenile's sheet is a third of the
 * adult's area, so an absolute floor either passes an adult whose crest has
 * vanished or fails a chick whose crest is perfectly visible.
 */
const PINK_MIN_SHARE = 0.006;
/** …with a hard floor, so a frame that draws almost nothing cannot pass by default. */
const PINK_MIN_PIXELS = 8;
/**
 * The band the crest has to appear in, as a share of the frame's ink height.
 *
 * Tight enough to be the head and nothing else. At half the ink box the tail —
 * which sweeps out at hip height in profile and above the hips axially — can
 * satisfy the check on its own, and a gate a second pink zone can pass for the
 * first proves nothing about either.
 */
const CREST_BAND_SHARE = 0.3;
/** And, in profile, the tail fan in the trailing third. */
const TAIL_BAND_SHARE = 0.3;

function isPink(cell: Cell, x: number, y: number): boolean {
  const at = (y * cell.width + x) * CHANNELS;
  if (cell.pixels[at + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) return false;
  const red = cell.pixels[at];
  const green = cell.pixels[at + 1];
  const blue = cell.pixels[at + 2];
  return red >= PINK_MIN_RED && red - green >= PINK_RED_OVER_GREEN && blue > green;
}

/**
 * Where in the cell the skull is, in pixels — for the profile rows, where
 * `measureHead` is exact.
 *
 * The bake scales about the ground line, so the same transform has to be applied
 * here or a stage's crest lands nowhere near where this thinks it is.
 */
function headPixelY(
  stage: MongoStage,
  row: RowSpec,
  frame: number,
  geometry: SheetGeometry,
): number {
  const prop = MONGO_STAGES[stage];
  const head = measureHead(row.pose(frame, prop), prop);
  const originY = geometry.tileY + TILE_SCALE / 2;
  return originY + TILE_SCALE * (GROUND_Y + (head.y - GROUND_Y) * prop.scale);
}

/** How far from the skull's centre the crest may sit and still count. */
const CREST_BAND_PX = 26;

function gateFeathers(stage: MongoStage, cells: Map<string, Cell>, geometry: SheetGeometry): void {
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const cell = cellOf(cells, row.name, frame);
      const box = inkBox(cell);
      let ink = 0;
      let total = 0;
      let inCrestBand = 0;
      let inTailBand = 0;
      const crestFloor =
        row.view === 'side' ? headPixelY(stage, row, frame, geometry) - CREST_BAND_PX : box.minY;
      // Anchored on the skull itself in profile, where its position is known
      // exactly. A band measured off the ink box instead fails the collapse —
      // where the head is *supposed* to be the lowest thing on the animal —
      // and, in the axial views, can be satisfied by the tail.
      const crestLimit =
        row.view === 'side'
          ? headPixelY(stage, row, frame, geometry) + CREST_BAND_PX
          : box.minY + (box.maxY - box.minY) * CREST_BAND_SHARE;
      // The profile art always faces +X, so the tail is always the left third.
      const tailLimit = box.minX + (box.maxX - box.minX) * TAIL_BAND_SHARE;
      for (let y = box.minY; y <= box.maxY; y++) {
        for (let x = box.minX; x <= box.maxX; x++) {
          if (alphaAt(cell, x, y) >= INK_ALPHA_THRESHOLD) ink++;
          if (!isPink(cell, x, y)) continue;
          total++;
          if (y <= crestLimit && y >= crestFloor) inCrestBand++;
          if (x <= tailLimit) inTailBand++;
        }
      }
      const where = `${stage} ${cellKey(row.name, frame)}`;
      const floor = Math.max(PINK_MIN_PIXELS, Math.round(ink * PINK_MIN_SHARE));
      if (total < floor) {
        throw new Error(
          `G-FEATHER: ${where} holds ${total} pink pixels against a floor of ${floor} — ` +
            `the display feathers have gone missing`,
        );
      }
      if (inCrestBand < floor) {
        throw new Error(
          `G-FEATHER: ${where} has ${inCrestBand} pink pixels in its ` +
            `crest band against a floor of ${floor} — ` +
            `the head crest is hidden`,
        );
      }
      if (row.view === 'side' && inTailBand < floor) {
        throw new Error(
          `G-FEATHER: ${where} has ${inTailBand} pink pixels in its trailing ` +
            `${(TAIL_BAND_SHARE * 100).toFixed(0)}% against a floor of ${floor} — ` +
            `the tail fan is hidden`,
        );
      }
    }
  }
}

/**
 * G-CLAW — the keratin claws are actually painted.
 *
 * G-ARC traces a *pose* point, so it is perfectly happy with a claw that exists
 * in the rig and is never drawn — which is how the sickle claw shipped
 * invisible once already. This one counts pixels.
 */
/**
 * What counts as claw keratin: a warm mid-tone where green leads blue.
 *
 * The `green > blue` term is what keeps the pink display feathers out — they are
 * every bit as bright and every bit as red, and without it a frame could satisfy
 * a claw gate with a crest. The red-over-blue floor keeps the (cooler, paler)
 * teeth out, so a bite frame cannot pass on its tooth row either.
 */
const KERATIN_MIN_RED = 160;
const KERATIN_RED_OVER_BLUE = 24;
/**
 * How much keratin a frame must hold, as a share of its own ink, with a hard
 * floor under it.
 *
 * A share for the same reason G-FEATHER uses one: the juvenile's sheet is a
 * third of the adult's area, so a flat count either passes an adult whose claw
 * has vanished or fails a chick whose claw is perfectly visible.
 */
const KERATIN_MIN_SHARE = 0.0015;
const KERATIN_MIN_PIXELS = 2;

function isKeratin(cell: Cell, x: number, y: number): boolean {
  const at = (y * cell.width + x) * CHANNELS;
  if (cell.pixels[at + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) return false;
  const red = cell.pixels[at];
  const green = cell.pixels[at + 1];
  const blue = cell.pixels[at + 2];
  return red >= KERATIN_MIN_RED && green > blue && red - blue >= KERATIN_RED_OVER_BLUE;
}

/**
 * The one row the claw gate cannot police.
 *
 * He is lying down with his legs folded under him; a killing claw hidden under a
 * collapsed body is the correct picture, not a missing one.
 */
const CLAW_EXEMPT_ROW = 'collapse';

function gateClaws(stage: MongoStage, cells: Map<string, Cell>): void {
  for (const row of ROWS) {
    if (row.name === CLAW_EXEMPT_ROW) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const cell = cellOf(cells, row.name, frame);
      const box = inkBox(cell);
      let ink = 0;
      let keratin = 0;
      for (let y = box.minY; y <= box.maxY; y++) {
        for (let x = box.minX; x <= box.maxX; x++) {
          if (alphaAt(cell, x, y) >= INK_ALPHA_THRESHOLD) ink++;
          if (isKeratin(cell, x, y)) keratin++;
        }
      }
      const floor = Math.max(KERATIN_MIN_PIXELS, Math.round(ink * KERATIN_MIN_SHARE));
      if (keratin < floor) {
        throw new Error(
          `G-CLAW: ${stage} ${cellKey(row.name, frame)} paints ${keratin} keratin pixels against ` +
            `a floor of ${floor} — the sickle claw is the single most diagnostic thing a ` +
            `dromaeosaur silhouette has, and this frame has not drawn one`,
        );
      }
    }
  }
}

/**
 * G-CLEARANCE — the health-bar lift.
 *
 * A redraw moves how far his art stands above his tile, and the runtime lifts
 * his health bar by a declared number that nothing else can check. Left stale,
 * the bar is simply painted across his back forever.
 */
const RUNTIME_SPRITE_PATH = 'src/sprites/mongoSprite.ts';
/** The attack rows take their counts from here, so G10 has to resolve into it too. */
const RUNTIME_TIMING_PATH = 'src/sprites/mongoAttackTiming.ts';
const CLEARANCE_TOLERANCE_TILES = 0.05;

function declaredRecord(source: string, name: string, stage: MongoStage): number {
  const block = new RegExp(`${name}[^{]*\\{([^}]*)\\}`).exec(source);
  if (block === null) throw new Error(`${RUNTIME_SPRITE_PATH} no longer declares ${name}`);
  const entry = new RegExp(`${stage}\\s*:\\s*([\\d.]+)`).exec(block[1]);
  if (entry === null) throw new Error(`${name} has no ${stage} entry`);
  return Number(entry[1]);
}

function gateHeadClearance(
  stage: MongoStage,
  cells: Map<string, Cell>,
  geometry: SheetGeometry,
  source: string,
): void {
  // Measured off the standing profile idle, which is the pose the health bar is
  // read against — not off the pounce, which leaves the ground.
  const box = inkBox(cellOf(cells, 'idle_side', 0));
  // Clamped at zero: a stage whose art fits inside its own tile needs no lift at
  // all, and a negative one would push the bar down into his back.
  const measured = Math.max(0, (geometry.tileY - box.minY) / TILE_SCALE);
  const declared = declaredRecord(source, 'MONGO_HEAD_CLEARANCE_TILES', stage);
  if (Math.abs(declared - measured) > CLEARANCE_TOLERANCE_TILES) {
    throw new Error(
      `G-CLEARANCE: ${RUNTIME_SPRITE_PATH} lifts the ${stage} health bar by ${declared} tiles, ` +
        `but his standing art reaches ${measured.toFixed(3)} tiles above his tile (tolerance ` +
        `${CLEARANCE_TOLERANCE_TILES})`,
    );
  }
  console.log(`  G-CLEARANCE ${stage}: art reaches ${measured.toFixed(3)} tiles above the tile`);
}

/**
 * G12 — texture size. Reported even when it passes, because quiet asset bloat is
 * the failure mode nobody goes looking for.
 */
const SHEET_BYTE_LIMIT = 1_400_000;

function gateTextureSize(sheet: BakedSheet): void {
  const bytes = sheet.buffer.byteLength;
  if (bytes > SHEET_BYTE_LIMIT) {
    throw new Error(
      `G12: the ${sheet.stage} sheet is ${bytes} bytes against a budget of ${SHEET_BYTE_LIMIT}`,
    );
  }
  console.log(
    `  G12 texture size ${sheet.stage}: ${(bytes / 1024).toFixed(1)}kB of a ` +
      `${(SHEET_BYTE_LIMIT / 1024).toFixed(0)}kB budget`,
  );
}

/**
 * G-STAGE-SCALE — the growth read.
 *
 * Frame geometry is quantised and each stage is measured independently, so
 * nothing structurally stops a tuning pass from making the adolescent taller
 * than the adult. Growing up has to be visible at a glance or the whole level-5
 * and level-10 payoff evaporates.
 */
const STAGE_GROWTH_MIN = 1.15;
const STAGE_GROWTH_MAX = 2.1;

function gateStageScale(heights: Map<MongoStage, number>): void {
  for (let i = 1; i < MONGO_STAGE_ORDER.length; i++) {
    const younger = MONGO_STAGE_ORDER[i - 1];
    const older = MONGO_STAGE_ORDER[i];
    const before = heights.get(younger);
    const after = heights.get(older);
    if (before === undefined || after === undefined)
      throw new Error('G-STAGE-SCALE: missing stage');
    const ratio = after / before;
    if (ratio < STAGE_GROWTH_MIN || ratio > STAGE_GROWTH_MAX) {
      throw new Error(
        `G-STAGE-SCALE: the ${older} stands ${ratio.toFixed(2)}× the ${younger}, outside the ` +
          `${STAGE_GROWTH_MIN}–${STAGE_GROWTH_MAX} band the growth has to read within`,
      );
    }
    console.log(
      `  G-STAGE-SCALE: ${older} is ${ratio.toFixed(2)}× the ${younger}'s standing height`,
    );
  }
}

/**
 * G11 — manifest sync. The single most common wiring bug after a redraw, and the
 * one whose symptom (a sprite drawn from the wrong pixels) looks like an art
 * problem rather than a data one.
 */
function gateManifest(sheet: BakedSheet): string | null {
  const mismatch = manifestMismatch(sheet);
  if (mismatch === null) {
    console.log(`  G11 manifest ${sheet.stage}: in sync`);
    return null;
  }
  if (SKIP_MANIFEST_GATE) return mismatch;
  throw new Error(`G11: ${mismatch}`);
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * G10 — timing table. The row names and frame counts the runtime expects have to
 * match the ones baked here; a row added in one place only is a blank animation.
 */
const EXPECTED_ROWS: ReadonlyArray<readonly [string, number]> = [
  ['idle', 8],
  ['idle_side', 8],
  ['idle_away', 8],
  ['walk', 8],
  ['walk_side', 8],
  ['walk_away', 8],
  ['bite', 10],
  ['bite_side', 10],
  ['bite_away', 10],
  ['slash', 10],
  ['slash_side', 10],
  ['slash_away', 10],
  ['pounce', 14],
  ['pounce_side', 14],
  ['pounce_away', 14],
  ['collapse', 10],
];

function gateTimingTable(): void {
  if (ROWS.length !== EXPECTED_ROWS.length) {
    throw new Error(`G10: the sheet has ${ROWS.length} rows against ${EXPECTED_ROWS.length}`);
  }
  ROWS.forEach((row, index) => {
    const [name, frameCount] = EXPECTED_ROWS[index];
    if (row.name !== name || row.frameCount !== frameCount) {
      throw new Error(
        `G10: row ${index} is ${row.name}×${row.frameCount}, expected ${name}×${frameCount}`,
      );
    }
  });
  // The runtime keeps its own copy of the frame counts, and a row that is one
  // frame longer there than here plays a blank cell at the end of every swing.
  const source = readFileSync(resolve(RUNTIME_SPRITE_PATH), 'utf8');
  const timingSource = readFileSync(resolve(RUNTIME_TIMING_PATH), 'utf8');
  for (const row of ROWS) {
    const declared = runtimeFrameCount(source + timingSource, row.name);
    if (declared !== row.frameCount) {
      throw new Error(
        `G10: ${RUNTIME_SPRITE_PATH} says ${row.name} has ${declared} frames, the bake has ` +
          `${row.frameCount}`,
      );
    }
  }
}

/**
 * Reads one row's frame count out of the runtime's `FRAME_COUNT` map.
 *
 * Resolves through a named constant when the entry is one, because every entry
 * is now — and throws when it cannot resolve at all. The version that skipped
 * silently on no-match was worth nothing: the day the last numeric literal in
 * that map became a constant, the whole check quietly stopped running and said
 * so to no one.
 */
function runtimeFrameCount(source: string, rowName: string): number {
  const entry = new RegExp(`\\b${rowName}\\s*:\\s*([A-Za-z0-9_]+)\\s*,`).exec(source);
  if (entry === null) {
    throw new Error(`G10: ${RUNTIME_SPRITE_PATH} declares no frame count for ${rowName}`);
  }
  const value = entry[1];
  if (/^\d+$/.test(value)) return Number(value);
  const constant = new RegExp(`\\b${value}\\s*=\\s*(\\d+)`).exec(source);
  if (constant === null) {
    throw new Error(
      `G10: ${rowName}'s frame count is ${value}, which is not a number and is defined in ` +
        `neither ${RUNTIME_SPRITE_PATH} nor ${RUNTIME_TIMING_PATH}`,
    );
  }
  return Number(constant[1]);
}

/**
 * G6 — reach headroom. Hip→ankle must stay inside the thigh and shank's combined
 * span on *every* frame. One clamped frame locks the leg straight, the next tuck
 * snaps it back, and the result reads as a hop rather than as a walk.
 */
const REACH_HEADROOM = 0.004;

function gateReachHeadroom(): void {
  let worst = 0;
  let worstAt = '';
  let worstLimit = Infinity;
  for (const { stage, prop, row, frame, pose } of poseStream()) {
    if (row.view !== 'side') continue;
    const limit = legReach(prop);
    const legs = measureLegs(pose, prop);
    for (const [side, leg] of Object.entries(legs)) {
      const share = leg.hipToAnkle / limit;
      if (share > worst / (worstLimit === Infinity ? 1 : worstLimit)) {
        worst = leg.hipToAnkle;
        worstLimit = limit;
        worstAt = `${stage} ${cellKey(row.name, frame)} ${side}`;
      }
    }
  }
  if (worst > worstLimit - REACH_HEADROOM) {
    throw new Error(
      `G6: ${worstAt} asks the leg to span ${worst.toFixed(4)} against a reach of ` +
        `${worstLimit.toFixed(4)} — shorten STRIDE_SHARE or drop the pelvis further at contact`,
    );
  }
  console.log(
    `  G6 reach headroom: worst frame spans ${worst.toFixed(4)} of ${worstLimit.toFixed(4)} ` +
      `(${worstAt})`,
  );
}

/**
 * G7 — foot slide. The classic moonwalk.
 *
 * A planted foot slides backward under the body at a *constant* rate — that is
 * what "the body travels over it" means — so any easing on stance is a skate
 * however monotonic it stays.
 *
 * Returns the ground one full cycle covers, in tiles, so G13 can check the
 * runtime against something measured rather than against a formula.
 */
const PLANTED_EPSILON = 1e-9;
const SLIDE_RATE_TOLERANCE = 1e-9;

function gateFootSlide(stage: MongoStage): number {
  const prop = MONGO_STAGES[stage];
  const walk = ROWS.find((row) => row.name === 'walk_side');
  if (walk === undefined) throw new Error('G7: there is no walk_side row to check');

  const slides: number[] = [];
  for (const side of ['near', 'far'] as const) {
    // Stance comes from the phase, not from the foot's height: once the toes
    // roll at push-off, height no longer distinguishes stance from swing.
    const phaseOffset = side === 'near' ? 0 : CONTRALATERAL_PHASE;
    let previous: { x: number; frame: number } | null = null;
    for (let frame = 0; frame < walk.frameCount; frame++) {
      const cycle = (((frame / walk.frameCount + phaseOffset) % 1) + 1) % 1;
      const pose = walk.pose(frame, prop);
      const foot = side === 'near' ? pose.nearLeg : pose.farLeg;
      if (cycle >= STANCE_FRACTION) {
        previous = null;
        continue;
      }
      if (foot.lift !== 0) {
        throw new Error(
          `G7: the ${side} foot is ${foot.lift.toFixed(4)} off the floor while its phase says it ` +
            `is planted, on ${stage} walk_side frame ${frame}`,
        );
      }
      if (previous !== null && foot.toeX >= previous.x - PLANTED_EPSILON) {
        throw new Error(
          `G7: the ${side} foot slides forward while planted on ${stage} — x went from ` +
            `${previous.x.toFixed(4)} on frame ${previous.frame} to ${foot.toeX.toFixed(4)} on ` +
            `frame ${frame}`,
        );
      }
      if (previous !== null) slides.push(previous.x - foot.toeX);
      previous = { x: foot.toeX, frame };
    }
  }

  if (slides.length === 0) throw new Error(`G7: no frame of ${stage} walk_side plants a foot`);
  const slowest = Math.min(...slides);
  const fastest = Math.max(...slides);
  if (fastest - slowest > SLIDE_RATE_TOLERANCE) {
    throw new Error(
      `G7: the planted foot slides unevenly on ${stage} — between ${slowest.toFixed(6)} and ` +
        `${fastest.toFixed(6)} per frame (limit ${SLIDE_RATE_TOLERANCE})`,
    );
  }
  // The rate, not the span: the last instant of stance falls between two frames
  // and is never drawn, so measuring the sampled span comes up a frame short.
  return fastest * walk.frameCount * prop.scale;
}

/**
 * G8 — both feet never leave the floor. He walks; he does not hop, so every
 * frame of a walk or an idle has at least one foot in contact. The attacks are
 * exempt: the pounce is a leap, and being airborne is the whole point of it.
 */
const GROUNDED_ROWS = new Set(['idle', 'idle_side', 'idle_away', 'walk', 'walk_side', 'walk_away']);

function gateGroundContact(): void {
  for (const { stage, row, frame, pose } of poseStream()) {
    if (!GROUNDED_ROWS.has(row.name)) continue;
    const lowest = Math.min(pose.nearLeg.lift, pose.farLeg.lift);
    if (lowest > 0) {
      throw new Error(
        `G8: ${stage} ${cellKey(row.name, frame)} has both feet off the floor (nearest contact ` +
          `${lowest.toFixed(4)} above it)`,
      );
    }
  }
}

/**
 * G9 — the digitigrade stack, which is the single most diagnostic thing about a
 * dromaeosaur leg and the thing a sign flip destroys silently.
 *
 * Edge-on: the knee has to sit *forward* of the hip→ankle line, and the ankle —
 * the high "reverse joint" that is really a heel — has to sit *behind* and
 * *above* the toes. Head-on that first test is meaningless, so what is policed
 * there is the metatarsus angle itself, which is what puts the ankle up off the
 * floor in the first place.
 */
const MIN_META_ANGLE = 0.1;
const MAX_META_ANGLE = Math.PI / 2 - 0.05;

function gateDigitigrade(): void {
  for (const { stage, prop, row, frame, pose } of poseStream()) {
    const where = `${stage} ${cellKey(row.name, frame)}`;
    for (const [side, leg] of Object.entries({ near: pose.nearLeg, far: pose.farLeg })) {
      if (leg.meta < MIN_META_ANGLE || leg.meta > MAX_META_ANGLE) {
        throw new Error(
          `G9: ${where}'s ${side} metatarsus is at ${leg.meta.toFixed(3)} rad, outside ` +
            `(${MIN_META_ANGLE}, ${MAX_META_ANGLE.toFixed(3)}) — the ankle is either on the floor ` +
            `or directly over the toes, and either way the leg stops reading as digitigrade`,
        );
      }
    }
    if (row.view !== 'side') continue;
    const legs = measureLegs(pose, prop);
    for (const [side, leg] of Object.entries(legs)) {
      if (leg.ankle.x >= leg.toeTip.x) {
        throw new Error(
          `G9: ${where}'s ${side} ankle is not behind its toes (ankle x ${leg.ankle.x.toFixed(4)}, ` +
            `toe x ${leg.toeTip.x.toFixed(4)})`,
        );
      }
      if (leg.ankle.y >= leg.toeTip.y) {
        throw new Error(`G9: ${where}'s ${side} ankle is not above its toes`);
      }
      // Signed area of hip→ankle against hip→knee. Facing +X with +Y down, a
      // knee forward of that line gives a negative cross product.
      const ankle = { x: leg.ankle.x - leg.hip.x, y: leg.ankle.y - leg.hip.y };
      const knee = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y };
      const cross = ankle.x * knee.y - ankle.y * knee.x;
      if (cross >= 0) {
        throw new Error(
          `G9: ${where}'s ${side} knee sits behind the hip→ankle line (cross ` +
            `${cross.toFixed(5)}) — the leg has hinged backward`,
        );
      }
    }
  }
}

/**
 * G-HEADLEVEL — avian head stabilisation.
 *
 * A walking bird's body bobs while its head holds a fixed height. It is the one
 * trait that sells "this is a real animal" harder than anything else in the
 * walk, and it is invisible on a contact sheet — every frame looks fine, and the
 * head simply bounces in motion.
 *
 * The body's own bob is measured too: a head that is level because *nothing*
 * moves would otherwise pass.
 */
/**
 * How much of the body's own bob the head is allowed to keep.
 *
 * A ratio, not a zero. Pinning the head to a constant height passes trivially
 * and looks like a skull glued in mid-air while the body slides under it; what
 * the trait actually is, is a head that moves *far less* than the body. The gate
 * has to police the thing that reads, not the thing that is easy to measure.
 */
const HEAD_SWING_MAX_SHARE = 0.4;
/** And a floor, so a head that holds still because nothing moves cannot pass. */
const MIN_BODY_BOB = 0.02;

function gateHeadLevel(): void {
  const stabilised = ['walk_side', 'idle_side'];
  for (const stage of MONGO_STAGE_ORDER) {
    const prop = MONGO_STAGES[stage];
    for (const name of stabilised) {
      const row = ROWS.find((candidate) => candidate.name === name);
      if (row === undefined) throw new Error(`G-HEADLEVEL: there is no ${name} row`);
      const headYs: number[] = [];
      const bodyYs: number[] = [];
      for (let frame = 0; frame < row.frameCount; frame++) {
        const pose = row.pose(frame, prop);
        headYs.push(measureHead(pose, prop).y);
        bodyYs.push(pose.rise);
      }
      const headSwing = Math.max(...headYs) - Math.min(...headYs);
      const bodySwing = Math.max(...bodyYs) - Math.min(...bodyYs);
      if (headSwing > bodySwing * HEAD_SWING_MAX_SHARE) {
        throw new Error(
          `G-HEADLEVEL: ${stage} ${name}'s head moves ${headSwing.toFixed(5)} vertically against ` +
            `a body bob of ${bodySwing.toFixed(5)} — over the ${HEAD_SWING_MAX_SHARE} share the ` +
            `stabilisation is supposed to hold it to`,
        );
      }
      if (bodySwing < MIN_BODY_BOB) {
        throw new Error(
          `G-HEADLEVEL: ${stage} ${name}'s body only bobs ${bodySwing.toFixed(5)} (floor ` +
            `${MIN_BODY_BOB}) — the head is level because nothing is moving, which proves nothing`,
        );
      }
    }
  }
}

/**
 * G-ARC — claw-tip arcs.
 *
 * A believable swing is a smooth arc; a cornered or teleporting one is a rig
 * bug, and it is the single thing about an attack that a still cannot show. The
 * hand claw traces the rake and the foot's sickle claw traces the pounce.
 */
const ARC_STEP_LIMIT = 3.2;
const ARC_TRACE_FLAG = '--arc-traces';
const ARC_TRACE_DIR = 'scripts/mongo-arc-traces';

function gateArcs(): void {
  const traces: string[] = [];
  for (const stage of MONGO_STAGE_ORDER) {
    const prop = MONGO_STAGES[stage];
    const arcs: ReadonlyArray<
      readonly [string, (pose: Parameters<typeof measureHandClaw>[0]) => Point]
    > = [
      ['slash_side', (pose) => measureHandClaw(pose, prop)],
      ['pounce_side', (pose) => measureFootSickle(pose, prop)],
    ];
    for (const [name, tip] of arcs) {
      const row = ROWS.find((candidate) => candidate.name === name);
      if (row === undefined) throw new Error(`G-ARC: there is no ${name} row`);
      const points: Point[] = [];
      for (let frame = 0; frame < row.frameCount; frame++) points.push(tip(row.pose(frame, prop)));
      const steps: number[] = [];
      for (let i = 1; i < points.length; i++) {
        steps.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
      }
      const typical = median(steps);
      steps.forEach((step, index) => {
        if (typical > 0 && step > typical * ARC_STEP_LIMIT) {
          throw new Error(
            `G-ARC: ${stage} ${name}'s claw tip jumps ${step.toFixed(4)} between frames ${index} ` +
              `and ${index + 1}, against a median step of ${typical.toFixed(4)} (limit ` +
              `${(typical * ARC_STEP_LIMIT).toFixed(4)}) — the swing corners rather than arcs`,
          );
        }
      });
      traces.push(
        `${stage} ${name}: ` +
          points.map((point) => `(${point.x.toFixed(3)},${point.y.toFixed(3)})`).join(' → '),
      );
    }
  }
  if (process.argv.includes(ARC_TRACE_FLAG)) {
    mkdirSync(resolve(ARC_TRACE_DIR), { recursive: true });
    const path = `${ARC_TRACE_DIR}/claw-arcs.txt`;
    writeFileSync(resolve(path), `${traces.join('\n')}\n`);
    console.log(`  G-ARC: wrote ${traces.length} traces to ${path}`);
    return;
  }
  console.log(`  G-ARC: ${traces.length} claw arcs are smooth (${ARC_TRACE_FLAG} to dump them)`);
}

/**
 * G13 — stride sync. `src/sprites/mongoSprite.ts` declares how much ground one
 * walk cycle covers so the runtime can advance the phase by distance travelled.
 * The two numbers live in different roots and cannot import each other, so this
 * reads the constant back out of the source.
 *
 * Checked against what G7 *measured* off the planted frames, not against a
 * hand-derived formula: a formula agrees with itself even after the keyframes it
 * claims to describe have been edited out from under it. Drift here does not
 * break anything visibly enough to notice — it just makes his feet skate,
 * quietly, forever.
 */
const STRIDE_TOLERANCE = 0.00005;

function gateStrideSync(stage: MongoStage, measured: number, source: string): void {
  const declared = declaredRecord(source, 'MONGO_TILES_PER_WALK_CYCLE', stage);
  if (Math.abs(declared - measured) > STRIDE_TOLERANCE) {
    throw new Error(
      `G13: ${RUNTIME_SPRITE_PATH} says one ${stage} walk cycle covers ${declared} tiles, but the ` +
        `baked choreography covers ${measured.toFixed(4)} — his feet will skate until they agree`,
    );
  }
  console.log(`  G13 stride sync ${stage}: one walk cycle covers ${declared} tiles (measured)`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Baking Mongo's three sheets (tileScale=${TILE_SCALE})…`);
  const source = readFileSync(resolve(RUNTIME_SPRITE_PATH), 'utf8');

  gateTimingTable();
  gateReachHeadroom();
  gateGroundContact();
  gateDigitigrade();
  gateHeadLevel();
  gateArcs();
  for (const stage of MONGO_STAGE_ORDER) {
    gateStrideSync(stage, gateFootSlide(stage), source);
  }

  const baked: BakedSheet[] = [];
  const standingHeights = new Map<MongoStage, number>();
  const mismatches: string[] = [];

  for (const stage of MONGO_STAGE_ORDER) {
    const sheet = bake(stage);
    const image = await loadImage(sheet.buffer);
    const cells = readCells(image, sheet);

    gateBorderClip(stage, cells);
    gateAnchor(stage, cells, sheet.geometry);
    gateLoopClosure(stage, cells, sheet.geometry);
    gateContinuity(stage, cells, sheet.geometry);
    gateCentroidDrift(stage, cells);
    gateFeathers(stage, cells, sheet.geometry);
    gateClaws(stage, cells);
    gateHeadClearance(stage, cells, sheet.geometry, source);
    gateTextureSize(sheet);

    const box = inkBox(cellOf(cells, 'idle_side', 0));
    standingHeights.set(stage, box.maxY - box.minY);
    const mismatch = gateManifest(sheet);
    if (mismatch !== null) mismatches.push(mismatch);
    baked.push(sheet);
  }

  gateStageScale(standingHeights);

  if (mismatches.length > 0) {
    console.warn(`\n  G11 SKIPPED — paste these and re-run without the flag:\n`);
    for (const mismatch of mismatches) console.warn(`${mismatch}\n`);
  }

  for (const sheet of baked) {
    const path = sheetPathFor(sheet.stage);
    writeFileSync(resolve(path), sheet.buffer);
    console.log(
      `  → ${path}  ${sheet.columns * sheet.geometry.frameWidth}×` +
        `${ROWS.length * sheet.geometry.frameHeight}px  ` +
        `(${ROWS.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×` +
        `${sheet.geometry.frameHeight})  tileX=${sheet.geometry.tileX} tileY=${sheet.geometry.tileY}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
