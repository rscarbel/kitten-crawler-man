// Extracts floor tiles from hoarders_floor.png and splices them into
// row 7 (floor_hoarder) of dungeon_tileset.png.
//
// Also extracts the overworld tileset from overworld_tilemap_GENERATED.png
// and writes overworld_tileset.png + updates manifest.json.
//
// Run with: node scripts/extract-hoarder-tiles.mjs

import { createCanvas, loadImage } from 'canvas';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const SRC_PATH = 'src/images/environment/hoarders_floor.png';
const TILESET_PATH = 'src/images/environment/dungeon_tileset.png';
const FRAME_SIZE = 64;       // target frame size (px)
const FRAMES_NEEDED = 8;     // floor_hoarder has 8 variants
const HOARDER_ROW = 7;       // row index in dungeon_tileset

// Minimum average brightness to consider a row/column as tile content (not separator).
const SEPARATOR_THRESHOLD = 25;
// Minimum span (px) for a region to count as a tile, not noise.
const MIN_TILE_SPAN = 80;

/** Returns [{start, end}] ranges where average brightness > threshold. */
function findBrightRanges(brightness) {
  const ranges = [];
  let inBright = false;
  let start = 0;
  for (let i = 0; i < brightness.length; i++) {
    if (!inBright && brightness[i] > SEPARATOR_THRESHOLD) {
      inBright = true;
      start = i;
    } else if (inBright && brightness[i] <= SEPARATOR_THRESHOLD) {
      inBright = false;
      if (i - start >= MIN_TILE_SPAN) ranges.push({ start, end: i - 1 });
    }
  }
  if (inBright) {
    const end = brightness.length - 1;
    if (end - start >= MIN_TILE_SPAN) ranges.push({ start, end });
  }
  return ranges;
}

// ── Overworld tileset extraction ──────────────────────────────────────────────

const OW_SRC_PATH = 'src/images/environment/overworld_tilemap_GENERATED.png';
const OW_OUT_PATH = 'src/images/environment/overworld_tileset.png';
const MANIFEST_PATH = 'src/images/manifest.json';
const OW_FRAME_SIZE = 64;
// Row threshold 50: catches separators as low as 48.3 without cutting into tile content (≥54px).
const OW_ROW_THRESHOLD = 50;
// Col threshold 55: catches faint separators at ~44–51 brightness while skipping tile interiors.
const OW_COL_THRESHOLD = 55;
const OW_MIN_SPAN = 20;
const OW_NUM_ROWS = 11;
const OW_ROW_NAMES = [
  'grass',
  'dirt',
  'dirt_light_grass',
  'village_streets',
  'sand',
  'gravel',
  'cobblestone',
  'tile',
  'overgrown',
  'stone',
  'concrete',
];

/** Parameterized version of findBrightRanges used by the overworld extractor. */
function findRanges(brightness, threshold, minSpan) {
  const ranges = [];
  let inBright = false;
  let start = 0;
  for (let i = 0; i < brightness.length; i++) {
    if (!inBright && brightness[i] > threshold) {
      inBright = true;
      start = i;
    } else if (inBright && brightness[i] <= threshold) {
      inBright = false;
      if (i - start >= minSpan) ranges.push({ start, end: i - 1 });
    }
  }
  if (inBright) {
    const end = brightness.length - 1;
    if (end - start >= minSpan) ranges.push({ start, end });
  }
  return ranges;
}

/**
 * Splits the widest region repeatedly until ranges.length === targetCount.
 * Used when AI-generated images omit a separator between two adjacent tile rows/cols.
 */
function splitToTarget(ranges, targetCount) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  while (sorted.length < targetCount) {
    let maxIdx = 0;
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i].end - sorted[i].start) > (sorted[maxIdx].end - sorted[maxIdx].start)) {
        maxIdx = i;
      }
    }
    const r = sorted[maxIdx];
    const mid = Math.floor((r.start + r.end) / 2);
    sorted.splice(maxIdx, 1, { start: r.start, end: mid }, { start: mid + 1, end: r.end });
    sorted.sort((a, b) => a.start - b.start);
  }
  return sorted;
}

async function extractOverworldTileset() {
  const srcImg = await loadImage(OW_SRC_PATH);
  const srcCanvas = createCanvas(srcImg.width, srcImg.height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(srcImg, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcImg.width, srcImg.height);
  const { width: W, height: H } = srcImg;

  console.log(`\nOverworld tilemap: ${W}×${H}`);

  // Compute per-row and per-column average brightness
  const rowBright = new Float32Array(H);
  const colBright = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      sum += (srcData.data[i] + srcData.data[i + 1] + srcData.data[i + 2]) / 3;
    }
    rowBright[y] = sum / W;
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      sum += (srcData.data[i] + srcData.data[i + 1] + srcData.data[i + 2]) / 3;
    }
    colBright[x] = sum / H;
  }

  // Detect row regions; if the AI omitted a separator between two rows (giving a ~2× tall region),
  // splitToTarget splits the widest region until we reach OW_NUM_ROWS.
  const rawRowRanges = findRanges(Array.from(rowBright), OW_ROW_THRESHOLD, OW_MIN_SPAN);
  const rowRanges = splitToTarget(rawRowRanges, OW_NUM_ROWS);

  // Detect col regions with a slightly higher threshold to catch faint separators.
  // The image has a dark left border (~80px) and a right border pixel; both are excluded
  // automatically because their brightness is well below OW_COL_THRESHOLD.
  // The last detected column contains decorative objects — skip it.
  const allColRanges = findRanges(Array.from(colBright), OW_COL_THRESHOLD, OW_MIN_SPAN);
  const usableColRanges = allColRanges.slice(0, -1);

  console.log(`Row ranges (${rowRanges.length}/${OW_NUM_ROWS}):`);
  rowRanges.forEach((r, i) =>
    console.log(`  [${i}] ${OW_ROW_NAMES[i] ?? '?'}: rows ${r.start}-${r.end} (${r.end - r.start + 1}px)`)
  );
  console.log(`Col ranges: ${allColRanges.length} total, ${usableColRanges.length} usable (last skipped)`);

  if (rowRanges.length !== OW_NUM_ROWS) {
    console.error(`Expected ${OW_NUM_ROWS} row ranges but got ${rowRanges.length}. Adjust OW_ROW_THRESHOLD.`);
    process.exit(1);
  }

  const numCols = usableColRanges.length;
  const numRows = rowRanges.length;

  const outW = numCols * OW_FRAME_SIZE;
  const outH = numRows * OW_FRAME_SIZE;
  const outCanvas = createCanvas(outW, outH);
  const outCtx = outCanvas.getContext('2d');

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const rowR = rowRanges[row];
      const colR = usableColRanges[col];
      const tmp = createCanvas(OW_FRAME_SIZE, OW_FRAME_SIZE);
      const tmpCtx = tmp.getContext('2d');
      tmpCtx.drawImage(
        srcCanvas,
        colR.start, rowR.start, colR.end - colR.start + 1, rowR.end - rowR.start + 1,
        0, 0, OW_FRAME_SIZE, OW_FRAME_SIZE
      );
      outCtx.drawImage(
        tmp, 0, 0, OW_FRAME_SIZE, OW_FRAME_SIZE,
        col * OW_FRAME_SIZE, row * OW_FRAME_SIZE, OW_FRAME_SIZE, OW_FRAME_SIZE
      );
    }
  }

  writeFileSync(OW_OUT_PATH, outCanvas.toBuffer('image/png'));
  console.log(`\nSaved overworld tileset: ${OW_OUT_PATH} (${outW}×${outH})`);

  // Update manifest.json
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const states = {};
  OW_ROW_NAMES.forEach((name, i) => {
    states[name] = { row: i, frameCount: numCols };
  });
  manifest['overworld_tileset'] = {
    path: 'environment/overworld_tileset.png',
    frameWidth: OW_FRAME_SIZE,
    frameHeight: OW_FRAME_SIZE,
    tileX: 0,
    tileY: 0,
    tileScale: OW_FRAME_SIZE,
    states,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Updated manifest.json — overworld_tileset: ${numRows} rows × ${numCols} frames each`);
}

async function main() {
  // ── Hoarder floor extraction (skipped if source image is absent) ───────────
  if (!existsSync(SRC_PATH)) {
    console.log(`Skipping hoarder extraction: ${SRC_PATH} not found.`);
    await extractOverworldTileset();
    return;
  }

  // ── Load source image ──────────────────────────────────────────────────────
  const srcImg = await loadImage(SRC_PATH);
  const srcCanvas = createCanvas(srcImg.width, srcImg.height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(srcImg, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcImg.width, srcImg.height);
  const { width: W, height: H } = srcImg;

  console.log(`Source image: ${W}×${H}`);

  // ── Compute per-row and per-column average brightness ──────────────────────
  const rowBright = new Float32Array(H);
  const colBright = new Float32Array(W);

  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      sum += (srcData.data[i] + srcData.data[i + 1] + srcData.data[i + 2]) / 3;
    }
    rowBright[y] = sum / W;
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      sum += (srcData.data[i] + srcData.data[i + 1] + srcData.data[i + 2]) / 3;
    }
    colBright[x] = sum / H;
  }

  const rowRanges = findBrightRanges(Array.from(rowBright));
  const colRanges = findBrightRanges(Array.from(colBright));

  console.log(`Detected tile rows: ${rowRanges.length}  (${rowRanges.map(r => `${r.start}-${r.end}`).join(', ')})`);
  console.log(`Detected tile cols: ${colRanges.length}  (${colRanges.map(r => `${r.start}-${r.end}`).join(', ')})`);

  // ── Collect candidate tiles (cell regions from the detected grid) ──────────
  const candidates = [];
  for (const rowR of rowRanges) {
    for (const colR of colRanges) {
      const tileW = colR.end - colR.start + 1;
      const tileH = rowR.end - rowR.start + 1;
      const regionData = srcCtx.getImageData(colR.start, rowR.start, tileW, tileH);
      let mean = 0;
      for (let i = 0; i < regionData.data.length; i += 4) {
        mean += (regionData.data[i] + regionData.data[i + 1] + regionData.data[i + 2]) / 3;
      }
      mean /= (regionData.data.length / 4);
      let variance = 0;
      for (let i = 0; i < regionData.data.length; i += 4) {
        const b = (regionData.data[i] + regionData.data[i + 1] + regionData.data[i + 2]) / 3;
        variance += (b - mean) ** 2;
      }
      variance /= (regionData.data.length / 4);
      const score = (mean > 30 && mean < 180 && variance > 100) ? variance : -1;
      candidates.push({ colR, rowR, mean, variance, score, tileW, tileH });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, FRAMES_NEEDED);

  if (chosen.length === 0) {
    console.error('No suitable floor tiles found! Check SEPARATOR_THRESHOLD or image layout.');
    process.exit(1);
  }

  console.log(`\nChosen ${chosen.length} tiles:`);
  chosen.forEach((c, i) =>
    console.log(`  [${i}] col ${c.colR.start}-${c.colR.end}, row ${c.rowR.start}-${c.rowR.end}  mean=${c.mean.toFixed(1)} var=${c.variance.toFixed(0)} score=${c.score.toFixed(0)}`)
  );

  // ── Load dungeon_tileset and splice in the new row 7 ──────────────────────
  const tilesetImg = await loadImage(TILESET_PATH);
  const tilesetCanvas = createCanvas(tilesetImg.width, tilesetImg.height);
  const tilesetCtx = tilesetCanvas.getContext('2d');
  tilesetCtx.drawImage(tilesetImg, 0, 0);

  const destY = HOARDER_ROW * FRAME_SIZE;

  tilesetCtx.clearRect(0, destY, tilesetImg.width, FRAME_SIZE);

  for (let i = 0; i < chosen.length; i++) {
    const { colR, rowR } = chosen[i];
    const tileW = colR.end - colR.start + 1;
    const tileH = rowR.end - rowR.start + 1;

    const tmp = createCanvas(FRAME_SIZE, FRAME_SIZE);
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(
      srcCanvas,
      colR.start, rowR.start, tileW, tileH,
      0, 0, FRAME_SIZE, FRAME_SIZE
    );

    const destX = i * FRAME_SIZE;
    tilesetCtx.drawImage(tmp, 0, 0, FRAME_SIZE, FRAME_SIZE, destX, destY, FRAME_SIZE, FRAME_SIZE);
  }

  if (chosen.length < FRAMES_NEEDED) {
    for (let i = chosen.length; i < FRAMES_NEEDED; i++) {
      const srcX = (i % chosen.length) * FRAME_SIZE;
      tilesetCtx.drawImage(tilesetCanvas, srcX, destY, FRAME_SIZE, FRAME_SIZE, i * FRAME_SIZE, destY, FRAME_SIZE, FRAME_SIZE);
    }
  }

  const buf = tilesetCanvas.toBuffer('image/png');
  writeFileSync(TILESET_PATH, buf);
  console.log(`\nSaved updated tileset to ${TILESET_PATH}`);

  const preview = createCanvas(FRAMES_NEEDED * FRAME_SIZE, FRAME_SIZE);
  const previewCtx = preview.getContext('2d');
  previewCtx.drawImage(tilesetCanvas, 0, destY, FRAMES_NEEDED * FRAME_SIZE, FRAME_SIZE, 0, 0, FRAMES_NEEDED * FRAME_SIZE, FRAME_SIZE);
  writeFileSync('hoarder_row_preview.png', preview.toBuffer('image/png'));
  console.log('Preview saved to hoarder_row_preview.png — open it to verify the tiles look right.');

  // ── Extract overworld tileset ─────────────────────────────────────────────
  await extractOverworldTileset();
}

main().catch(err => { console.error(err); process.exit(1); });
