/**
 * Gates the construction art — every palisade tier at every damage look and
 * joint, the breach and gap rubble, the gate at every swing, the trebuchet in
 * every state and the snare in every look — and writes review sheets:
 *
 * - `preview/construction-palisade.png`: a small stepped-corner ring per tier
 *   and damage look, then with spikes, at game scale, with Carl for size;
 * - `preview/construction-structures.png`: breach and gap rubble, the gate
 *   closed / half / open, trebuchets and snares in each state.
 *
 * Gates, per painted look:
 *  - G1 non-empty: it paints a real amount of solid ink;
 *  - G2 inside its columns: no solid pixel left or right of the tile columns
 *    it stands on (height above is allowed, sideways never — ground beside a
 *    wall is ground a crawler walks on);
 *  - G3 inside its declared reach: nothing above or below the reach the
 *    renderer sizes its cache and its cull to.
 *
 *   npm run gates:construction-art [-- --fault=overhang]
 *
 * `--fault=overhang` paints every look one tile to the right of where its
 * columns are measured, which must turn G2 red.
 */

import { createCanvas, type Canvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const { PALISADE_DIRS, PALISADE_REACH_UP_TILES, paintGapPiece, paintGate, paintPalisadeForReview } =
  await import('../src/map/tiles/hollowPalisadeTiles.js');
const { drawTrebuchet, TREBUCHET_COCKED_ANGLE, TREBUCHET_LOOSED_ANGLE, TREBUCHET_REACH_UP_TILES } =
  await import('../src/sprites/art/trebuchetArt.js');
const { drawSnare, SNARE_REACH_UP_TILES } = await import('../src/sprites/art/snareArt.js');
const { drawText } = await import('../src/ui/TextBox.js');

type PalisadeTier = 'fence' | 'wood' | 'stone' | 'fortified';
type Side = 'north' | 'south' | 'east' | 'west';

const TILE = 32;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Above this a pixel counts as painted rather than anti-aliasing fringe. */
const SOLID_ALPHA = 60;
/** A look must paint at least this share of its tile's area. */
const MIN_SOLID_SHARE = 0.04;
/** Reach below the tile a palisade may use on a north–south run. */
const PALISADE_REACH_DOWN_TILES = 0.4;
const GATE_REACH_UP_TILES = 1.6;
const GATE_HALF_SPAN_TILES = 1.5;
const GATE_POST_WIDTH_TILES = 0.44;

const fault = process.argv.find((arg) => arg.startsWith('--fault='))?.split('=')[1] ?? null;
const faultShiftPx = fault === 'overhang' ? TILE : 0;

const failures: string[] = [];
let looksChecked = 0;

interface Measured {
  /** Columns (in pixels, relative to the look's origin) it may paint. */
  readonly left: number;
  readonly right: number;
  /** Rows it may paint, relative to its origin. */
  readonly top: number;
  readonly bottom: number;
  /** Area its non-empty test is measured against. */
  readonly area: number;
}

/**
 * Paints `draw` onto a padded scratch canvas with its origin at (pad, pad)
 * and checks it against `bounds`.
 */
function gateLook(
  label: string,
  bounds: Measured,
  draw: (ctx: CanvasRenderingContext2D, ox: number, oy: number) => void,
): void {
  looksChecked++;
  const pad = TILE * 3;
  const width = Math.ceil(bounds.right - bounds.left + pad * 2);
  const height = Math.ceil(bounds.bottom - bounds.top + pad * 2);
  const canvas = createCanvas(width, height);
  const ctx = asGameContext(canvas.getContext('2d'));
  const ox = pad - bounds.left;
  const oy = pad - bounds.top;
  draw(ctx, ox + faultShiftPx, oy);
  const data = ctx.getImageData(0, 0, width, height).data;
  let solid = 0;
  let sideways = 0;
  let vertical = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA) continue;
      const rx = x - ox;
      const ry = y - oy;
      const insideColumns = rx >= bounds.left - 0.5 && rx < bounds.right + 0.5;
      const insideRows = ry >= bounds.top - 0.5 && ry < bounds.bottom + 0.5;
      if (!insideColumns) sideways++;
      else if (!insideRows) vertical++;
      else solid++;
    }
  }
  const needed = Math.ceil(bounds.area * MIN_SOLID_SHARE);
  if (solid < needed) failures.push(`G1 ${label}: only ${solid} solid px, need ${needed}`);
  if (sideways > 0) failures.push(`G2 ${label}: ${sideways} solid px outside its tile columns`);
  if (vertical > 0) failures.push(`G3 ${label}: ${vertical} solid px past its declared reach`);
}

// ── Palisade ─────────────────────────────────────────────────────────────────

const TIERS: readonly PalisadeTier[] = ['fence', 'wood', 'stone', 'fortified'];
const SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];
const MASKS: ReadonlyArray<{ name: string; mask: number }> = [
  { name: 'east-west', mask: PALISADE_DIRS.east | PALISADE_DIRS.west },
  { name: 'north-south', mask: PALISADE_DIRS.north | PALISADE_DIRS.south },
  { name: 'north-east', mask: PALISADE_DIRS.north | PALISADE_DIRS.east },
  { name: 'north-west', mask: PALISADE_DIRS.north | PALISADE_DIRS.west },
  { name: 'south-east', mask: PALISADE_DIRS.south | PALISADE_DIRS.east },
  { name: 'south-west', mask: PALISADE_DIRS.south | PALISADE_DIRS.west },
  { name: 'end-east', mask: PALISADE_DIRS.east },
  { name: 'end-west', mask: PALISADE_DIRS.west },
];
const STAGES = [0, 1, 2] as const;
const VARIANTS = [0, 1, 2, 3] as const;

const palisadeBounds: Measured = {
  left: 0,
  right: TILE,
  top: -Math.ceil(TILE * PALISADE_REACH_UP_TILES),
  bottom: TILE + Math.ceil(TILE * PALISADE_REACH_DOWN_TILES),
  area: TILE * TILE,
};

for (const tier of TIERS) {
  for (const stage of STAGES) {
    if (tier === 'fence' && stage > 0) continue;
    for (const { name, mask } of MASKS) {
      for (const outside of SIDES) {
        for (const spiked of tier === 'fence' ? [false] : [false, true]) {
          for (const buttress of tier === 'fortified' ? [false, true] : [false]) {
            for (const variant of VARIANTS) {
              gateLook(
                `palisade ${tier} stage${stage} ${name} out-${outside}${spiked ? ' spiked' : ''}${buttress ? ' buttress' : ''} v${variant}`,
                palisadeBounds,
                (ctx, ox, oy) =>
                  paintPalisadeForReview(ctx, ox, oy, TILE, {
                    tier,
                    stage,
                    mask,
                    outside,
                    spiked,
                    buttress,
                    variant,
                  }),
              );
            }
          }
        }
      }
    }
  }
}

const gapBounds: Measured = { left: 0, right: TILE, top: 0, bottom: TILE, area: TILE * TILE };
for (const tier of [null, ...TIERS] as const) {
  for (const seed of [1, 2, 3, 4, 5]) {
    gateLook(`gap ${tier ?? 'plain'} seed${seed}`, gapBounds, (ctx, ox, oy) =>
      paintGapPiece(ctx, ox, oy, TILE, tier, seed),
    );
  }
}

// ── Gate ─────────────────────────────────────────────────────────────────────

const gateSide = Math.ceil(TILE * (GATE_HALF_SPAN_TILES + GATE_POST_WIDTH_TILES));
const gateBounds: Measured = {
  left: -gateSide,
  right: gateSide,
  top: -Math.ceil(TILE * GATE_REACH_UP_TILES),
  bottom: TILE,
  area: TILE * TILE * 3,
};
for (const open of [0, 0.25, 0.5, 0.75, 1]) {
  for (const shakePx of [0, 2]) {
    gateLook(`gate open${open} shake${shakePx}`, gateBounds, (ctx, ox, oy) =>
      paintGate(ctx, ox, oy, TILE, { open, shakePx }),
    );
  }
}

// ── Trebuchet ────────────────────────────────────────────────────────────────

const trebuchetBounds: Measured = {
  left: 0,
  right: TILE * 2,
  top: -Math.ceil(TILE * TREBUCHET_REACH_UP_TILES),
  bottom: TILE * 3,
  area: TILE * TILE * 6,
};
interface TrebuchetCase {
  readonly label: string;
  readonly state: Parameters<typeof drawTrebuchet>[4];
}
const baseTrebuchet = {
  armAngle: TREBUCHET_COCKED_ANGLE,
  slingPhase: 0,
  broken: false,
  damageStage: 0,
  spikes: false,
  ammoFraction: 0,
  infernal: false,
};
const TREBUCHET_CASES: TrebuchetCase[] = [];
for (const armAngle of [
  TREBUCHET_COCKED_ANGLE,
  (TREBUCHET_COCKED_ANGLE + TREBUCHET_LOOSED_ANGLE) / 2,
  TREBUCHET_LOOSED_ANGLE,
]) {
  for (const slingPhase of [0, 0.5]) {
    TREBUCHET_CASES.push({
      label: `arm${armAngle.toFixed(2)} sling${slingPhase}`,
      state: { ...baseTrebuchet, armAngle, slingPhase },
    });
  }
}
for (const damageStage of [0, 1, 2]) {
  for (const broken of [false, true]) {
    TREBUCHET_CASES.push({
      label: `stage${damageStage}${broken ? ' broken' : ''}`,
      state: { ...baseTrebuchet, damageStage, broken },
    });
  }
}
for (const ammoFraction of [0, 0.4, 1]) {
  TREBUCHET_CASES.push({ label: `ammo${ammoFraction}`, state: { ...baseTrebuchet, ammoFraction } });
}
TREBUCHET_CASES.push({
  label: 'spikes',
  state: { ...baseTrebuchet, spikes: true, ammoFraction: 1 },
});
TREBUCHET_CASES.push({
  label: 'infernal',
  state: { ...baseTrebuchet, infernal: true, timeSeconds: 0.2 },
});
for (const progress of [0.1, 0.5, 0.9]) {
  TREBUCHET_CASES.push({ label: `scaffold${progress}`, state: { ...baseTrebuchet, progress } });
}
for (const { label, state } of TREBUCHET_CASES) {
  gateLook(`trebuchet ${label}`, trebuchetBounds, (ctx, ox, oy) =>
    drawTrebuchet(ctx, ox, oy, TILE, state),
  );
}

// ── Snare ────────────────────────────────────────────────────────────────────

const snareBounds: Measured = {
  left: 0,
  right: TILE,
  top: -Math.ceil(TILE * SNARE_REACH_UP_TILES),
  bottom: TILE,
  area: TILE * TILE * 0.5,
};
const SNARE_LOOKS = ['set', 'sprung', 'broken'] as const;
for (const look of SNARE_LOOKS) {
  for (const spikes of [false, true]) {
    gateLook(`snare ${look}${spikes ? ' spikes' : ''}`, snareBounds, (ctx, ox, oy) =>
      drawSnare(ctx, ox, oy, TILE, { look, spikes, timeSeconds: 0.6 }),
    );
  }
}

// ── Review sheets ────────────────────────────────────────────────────────────

const GRASS = '#4c6a34';
const GRASS_DARK = '#40592c';
const LABEL_COLOR = '#f1e6c8';
/** Review scale: twice game size, as Retina shows it. */
const REVIEW_SCALE = 2;

function background(canvas: Canvas): CanvasRenderingContext2D {
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = GRASS_DARK;
  for (let y = 0; y < canvas.height; y += TILE * REVIEW_SCALE) {
    for (
      let x = (y / (TILE * REVIEW_SCALE)) % 2 === 0 ? 0 : TILE * REVIEW_SCALE;
      x < canvas.width;
      x += TILE * REVIEW_SCALE * 2
    ) {
      ctx.fillRect(x, y, TILE * REVIEW_SCALE, TILE * REVIEW_SCALE);
    }
  }
  return ctx;
}

/** A 9 × 7 ring with two-thick stepped corners, the palisade's own shape in miniature. */
const RING_W = 9;
const RING_H = 7;
const CHAMFER = 2;
function isRing(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= RING_W || y >= RING_H) return false;
  const corner = Math.min(
    x + y,
    RING_W - 1 - x + y,
    x + RING_H - 1 - y,
    RING_W - 1 - x + RING_H - 1 - y,
  );
  if (corner < CHAMFER) return false;
  const onEdge = x === 0 || y === 0 || x === RING_W - 1 || y === RING_H - 1;
  return onEdge || corner <= CHAMFER + 1;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  tier: PalisadeTier,
  stage: number,
  spiked: boolean,
): void {
  const ts = TILE * REVIEW_SCALE;
  for (let y = 0; y < RING_H; y++) {
    for (let x = 0; x < RING_W; x++) {
      if (!isRing(x, y)) continue;
      let mask = 0;
      if (isRing(x, y - 1)) mask |= PALISADE_DIRS.north;
      if (isRing(x + 1, y)) mask |= PALISADE_DIRS.east;
      if (isRing(x, y + 1)) mask |= PALISADE_DIRS.south;
      if (isRing(x - 1, y)) mask |= PALISADE_DIRS.west;
      const dx = (x + 0.5 - RING_W / 2) / (RING_W / 2);
      const dy = (y + 0.5 - RING_H / 2) / (RING_H / 2);
      const outside: Side =
        Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : dx < 0 ? 'west' : 'east';
      paintPalisadeForReview(ctx, left + x * ts, top + y * ts, ts, {
        tier,
        stage,
        mask,
        outside,
        spiked,
        buttress: tier === 'fortified' && (x + y) % 3 === 1,
        variant: (x * 7 + y * 3) % 4,
      });
    }
  }
}

const ringCellW = (RING_W + 1) * TILE * REVIEW_SCALE;
const ringCellH = (RING_H + 2) * TILE * REVIEW_SCALE;
const palisadeRows: Array<{ label: string; tier: PalisadeTier; stage: number; spiked: boolean }> =
  [];
for (const tier of TIERS) {
  for (const stage of STAGES) {
    if (tier === 'fence' && stage > 0) continue;
    palisadeRows.push({ label: `${tier} stage ${stage}`, tier, stage, spiked: false });
  }
  if (tier !== 'fence')
    palisadeRows.push({ label: `${tier} spiked`, tier, stage: 0, spiked: true });
}
const PER_ROW = 4;
const palisadeSheet = createCanvas(
  ringCellW * PER_ROW,
  ringCellH * Math.ceil(palisadeRows.length / PER_ROW),
);
const palisadeCtx = background(palisadeSheet);
palisadeRows.forEach((row, index) => {
  const left = (index % PER_ROW) * ringCellW + TILE;
  const top = Math.floor(index / PER_ROW) * ringCellH + TILE * REVIEW_SCALE * 1.4;
  drawRing(palisadeCtx, left, top, row.tier, row.stage, row.spiked);
  drawText(palisadeCtx, row.label, {
    x: left,
    y: top - TILE * REVIEW_SCALE * 1.3,
    size: 20,
    color: LABEL_COLOR,
    outline: true,
  });
});
const palisadePath = writePreviewPng(
  `${PREVIEW_DIR}/construction-palisade.png`,
  palisadeSheet.toBuffer('image/png'),
);

const ts = TILE * REVIEW_SCALE;
const structuresSheet = createCanvas(ts * 22, ts * 17);
const structuresCtx = background(structuresSheet);
[null, ...TIERS].forEach((tier, index) => {
  paintGapPiece(structuresCtx, ts * (1 + index * 2), ts * 1, ts, tier, index + 3);
  drawText(structuresCtx, tier ?? 'gap', {
    x: ts * (1 + index * 2),
    y: ts * 0.3,
    size: 16,
    color: LABEL_COLOR,
    outline: true,
  });
});
[0, 0.5, 1].forEach((open, index) => {
  paintGate(structuresCtx, ts * (3 + index * 5), ts * 4, ts, { open, shakePx: 0 });
  drawText(structuresCtx, `gate ${open}`, {
    x: ts * (1 + index * 5),
    y: ts * 2.4,
    size: 16,
    color: LABEL_COLOR,
    outline: true,
  });
});
TREBUCHET_CASES.slice(0, 10).forEach(({ label, state }, index) => {
  const x = ts * (1 + (index % 10) * 2.1);
  drawTrebuchet(structuresCtx, x, ts * 8, ts, state);
  drawText(structuresCtx, label, { x, y: ts * 11.2, size: 11, color: LABEL_COLOR, outline: true });
});
TREBUCHET_CASES.slice(10, 20).forEach(({ label, state }, index) => {
  const x = ts * (1 + (index % 10) * 2.1);
  drawTrebuchet(structuresCtx, x, ts * 13, ts, state);
  drawText(structuresCtx, label, { x, y: ts * 16.2, size: 11, color: LABEL_COLOR, outline: true });
});
SNARE_LOOKS.forEach((look, index) => {
  for (const spikes of [false, true]) {
    const x = ts * (13 + index * 2 + (spikes ? 1 : 0) * 0);
    const y = ts * (spikes ? 5.5 : 3.5);
    drawSnare(structuresCtx, x, y, ts, { look, spikes, timeSeconds: 0.6 });
  }
  drawText(structuresCtx, look, {
    x: ts * (13 + index * 2),
    y: ts * 1.4,
    size: 14,
    color: LABEL_COLOR,
    outline: true,
  });
});
const structuresPath = writePreviewPng(
  `${PREVIEW_DIR}/construction-structures.png`,
  structuresSheet.toBuffer('image/png'),
);

console.log(`construction art: ${looksChecked} looks checked`);
console.log(`review: ${palisadePath}`);
console.log(`review: ${structuresPath}`);
if (failures.length > 0) {
  const shown = failures.slice(0, 20);
  for (const failure of shown) console.error(`  FAIL ${failure}`);
  if (failures.length > shown.length)
    console.error(`  … and ${failures.length - shown.length} more`);
  console.error(`gates:construction-art FAILED (${failures.length})`);
  process.exit(1);
}
console.log('gates:construction-art passed');
