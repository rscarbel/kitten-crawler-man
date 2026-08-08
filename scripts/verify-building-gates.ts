/**
 * Proves the building gates can fail.
 *
 *   npm run verify:buildings
 *
 * A gate that has never been seen to fail is not yet a gate, and several of the
 * gates in `buildinggen/gates.ts` have thresholds that were tuned against real
 * art — which is exactly the situation where one quietly stops discriminating.
 * This runs each of them against a deliberately broken input and fails if the
 * gate reports green.
 *
 * It is also where the texture-richness floor's calibration lives. That gate's
 * threshold is a fraction of the *replaced* art's local contrast, and the number
 * only means something next to what a genuinely flat facade scores; measuring
 * that here keeps the justification in the repository rather than in a comment
 * citing a script somebody deleted.
 */

import { createCanvas } from 'canvas';
import { BUILDING_SPECS, findBuildingSpec } from './buildinggen/buildings.js';
import { bake, readFixture, runPixelGates, type BakedBuilding } from './buildinggen/bake.js';
import {
  GateResults,
  TEXTURE_RICHNESS_FLOOR_FRACTION,
  gateDoorway,
  gateWrittenSheetGeometry,
  measureTextureRichness,
} from './buildinggen/gates.js';
import { project, quadPath } from './buildinggen/projection.js';
import { getRamp, rgb, sampleRamp } from './buildinggen/ramps.js';

const failures: string[] = [];
const reports: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function report(message: string): void {
  reports.push(message);
}

// ── the flat-fill calibration ──────────────────────────────────────────────

/**
 * What the texture-richness metric reports for a facade with no texture at all:
 * every plane a single flat sample of its own ramp's mid value. This is the
 * failure the gate exists to catch, and the distance between this number and a
 * finished building is what makes the chosen fraction defensible.
 */
function flatFillRichness(key: string): number {
  const spec = findBuildingSpec(key);
  const projection = project(spec);
  const canvas = createCanvas(projection.frameWidth, projection.frameHeight);
  const ctx = canvas.getContext('2d');
  const planes = [
    { quad: projection.roofQuad, ramp: spec.roof.ramp },
    { quad: projection.roofReturnQuad, ramp: spec.roof.ramp },
    { quad: projection.facadeQuad, ramp: spec.facade.ground.ramp },
    { quad: projection.sideQuad, ramp: spec.facade.ground.ramp },
  ];
  const RAMP_MIDPOINT = 0.5;
  for (const plane of planes) {
    ctx.fillStyle = rgb(sampleRamp(getRamp(plane.ramp), RAMP_MIDPOINT));
    quadPath(ctx, plane.quad);
    ctx.fill();
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return measureTextureRichness({ data: pixels.data, width: canvas.width, height: canvas.height });
}

/**
 * The most a flat fill may score before the gate's floor stops being a
 * comfortable multiple of it. Well above what any flat fill actually measures —
 * this is here to catch the metric itself changing character, not to be tight.
 */
const FLAT_FILL_CEILING = 3;

/** How many times the flat-fill score the tightest real floor must be. */
const FLOOR_TO_FLAT_MULTIPLE = 5;

function calibrateTextureRichness(): void {
  const fixture = readFixture();
  let worstFlat = 0;
  for (const key of ['temple', 'sleeping_cat_inn', 'desperado_club']) {
    worstFlat = Math.max(worstFlat, flatFillRichness(key));
  }
  report(`a flat-fill facade scores at most ${worstFlat.toFixed(2)}`);
  if (!(worstFlat <= FLAT_FILL_CEILING)) {
    fail(
      `a flat fill measures ${worstFlat.toFixed(2)}, above the ${FLAT_FILL_CEILING} this ` +
        'calibration assumes — the texture metric no longer separates "flat" from "worked"',
    );
  }

  let tightestFloor = Infinity;
  for (const spec of BUILDING_SPECS) {
    const replaced = fixture.get(spec.replaces);
    if (replaced === undefined || replaced.textureRichness === null) {
      fail(`'${spec.replaces}' has no recorded texture richness, so its floor cannot be checked`);
      continue;
    }
    tightestFloor = Math.min(
      tightestFloor,
      replaced.textureRichness * TEXTURE_RICHNESS_FLOOR_FRACTION,
    );
  }
  report(
    `the tightest per-building floor is ${tightestFloor.toFixed(2)}, ` +
      `${(tightestFloor / worstFlat).toFixed(0)}x the flat-fill score`,
  );
  if (!(tightestFloor >= worstFlat * FLOOR_TO_FLAT_MULTIPLE)) {
    fail(
      `the tightest floor (${tightestFloor.toFixed(2)}) is under ${FLOOR_TO_FLAT_MULTIPLE}x the ` +
        `flat-fill score (${worstFlat.toFixed(2)}); the gate would no longer fail a flat facade`,
    );
  }
}

// ── the gates must fail when the property is broken ────────────────────────

/**
 * Runs the pixel gates over one building that has been damaged, and requires the
 * named gate to be among the failures.
 *
 * The damage callback may edit the sheet in place and may also return a replaced
 * `BakedBuilding` — some gates read the manifest entry rather than the pixels,
 * and that field is readonly.
 */
function expectGateFails(
  label: string,
  gate: string,
  damage: (baked: BakedBuilding) => BakedBuilding | void,
): void {
  const fixture = readFixture();
  const baked = bake(findBuildingSpec('sleeping_cat_inn'));
  const damaged = damage(baked) ?? baked;
  const results = new GateResults();
  runPixelGates(results, damaged, fixture);
  const caught = results.failures.some((failure) => failure.gate === gate);
  if (caught) {
    report(`${label}: '${gate}' went red, as it must`);
    return;
  }
  fail(
    `${label}: '${gate}' stayed green on art that breaks the property it names. ` +
      `Failures seen: ${results.failures.map((f) => f.gate).join(', ') || 'none'}`,
  );
}

const RAMP_MIDPOINT = 0.5;

function flattenEveryPlane(baked: BakedBuilding): void {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  const planes = [
    { quad: projection.roofQuad, ramp: baked.spec.roof.ramp },
    { quad: projection.roofReturnQuad, ramp: baked.spec.roof.ramp },
    { quad: projection.facadeQuad, ramp: baked.spec.facade.ground.ramp },
    { quad: projection.sideQuad, ramp: baked.spec.facade.ground.ramp },
  ];
  for (const plane of planes) {
    ctx.fillStyle = rgb(sampleRamp(getRamp(plane.ramp), RAMP_MIDPOINT));
    quadPath(ctx, plane.quad);
    ctx.fill();
  }
}

calibrateTextureRichness();

expectGateFails('a facade flattened to its ramps', 'texture-richness', flattenEveryPlane);

expectGateFails('a hole punched in the base course', 'silhouette', (baked) => {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  const HOLE_TILES = 2;
  ctx.clearRect(
    projection.facadeLeft,
    projection.facadeBaseY - projection.scale,
    HOLE_TILES * projection.scale,
    projection.scale,
  );
});

expectGateFails('a roof painted no brighter than its wall', 'plane-separation', (baked) => {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  const ROOF_DARKEN = 0.45;
  ctx.save();
  quadPath(ctx, projection.roofQuad);
  ctx.clip();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${ROOF_DARKEN})`;
  ctx.fillRect(0, 0, baked.sheet.width, baked.sheet.height);
  ctx.restore();
});

expectGateFails('a hue nothing in the spec declares', 'palette', (baked) => {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  const SMEAR_TILES = 1;
  ctx.fillStyle = 'rgb(0,255,64)';
  ctx.fillRect(
    0,
    projection.eavesY,
    SMEAR_TILES * projection.scale,
    SMEAR_TILES * projection.scale,
  );
});

/**
 * An overlay that has lost all but a fraction of its ink.
 *
 * Thinned by keeping one pixel in sixty-four, which lands the fullest cell around
 * 0.03% — under the floor, and firmly above zero. Two other mutations were tried
 * and are worth recording as traps: keeping the leftmost columns cleared *all*
 * the ink on this building, because its animation is nowhere near them; and
 * scaling the row's alpha does not work either, since the ink is bimodal (an
 * opaque cat and a soft glow), so the scale that dims the glow away still leaves
 * the cat whole and the next step down erases both. Either would have tested a
 * blank row while claiming to test a faint one — which is what the floor already
 * catches, and not what it is for.
 */
const INK_THINNING_STRIDE = 64;

expectGateFails(
  'an overlay that has lost all but a trace of its ink',
  'life-transparency',
  (baked) => {
    const ctx = baked.sheet.getContext('2d');
    const frameHeight = baked.idle.height;
    const row = ctx.getImageData(0, frameHeight, baked.sheet.width, frameHeight);
    const ALPHA_OFFSET = 3;
    const CHANNELS_PER_PIXEL = 4;
    for (let pixel = 0; pixel * CHANNELS_PER_PIXEL < row.data.length; pixel++) {
      if (pixel % INK_THINNING_STRIDE === 0) continue;
      row.data[pixel * CHANNELS_PER_PIXEL + ALPHA_OFFSET] = 0;
    }
    ctx.putImageData(row, 0, frameHeight);
  },
);

expectGateFails('an overlay that does not move', 'life-loop', (baked) => {
  const ctx = baked.sheet.getContext('2d');
  const idleHeight = baked.idle.height;
  for (let step = 1; step < baked.life.length; step++) {
    const left = step * baked.idle.width;
    ctx.clearRect(left, idleHeight, baked.idle.width, idleHeight);
    ctx.drawImage(baked.life[0], left, idleHeight);
  }
});

/**
 * A loop with one large deliberate move in it that also fails to close.
 *
 * Blanking the last cell leaves the animation's own steps intact, adds one big
 * interior step going into the blank, and makes the wrap back to frame 0 just as
 * big. Measured against the *worst* interior step that seam looks unremarkable —
 * which is how a real discontinuity hides behind a punchy animation — and
 * measured against the second-worst it is enormous. This case is the reason the
 * yardstick is the second-worst step, and it is the one that goes green if
 * anybody changes it back.
 */
expectGateFails('a seam hiding behind one big move', 'life-loop', (baked) => {
  const ctx = baked.sheet.getContext('2d');
  const frameHeight = baked.idle.height;
  const last = baked.life.length - 1;
  ctx.clearRect(last * baked.idle.width, frameHeight, baked.idle.width, frameHeight);
});

/**
 * A facade that has shrunk inside its own plot.
 *
 * The town reserves a plot as wide as the derived footprint whether the art
 * fills it or not, so this is the half of the silhouette gate that catches a
 * building leaving blocked, empty ground beside itself.
 *
 * The damage has to land *outside* the window the coverage check measures, and
 * that window is `[round(facadeLeft), round(facadeRight) - 1]` in absolute
 * projection coordinates — not, as an earlier version of this case assumed,
 * between the ink's own edges. Trimming inside it failed both halves of the
 * gate at once, which meant the span floor could have been deleted with this
 * case still red. The base row's ink genuinely runs wider than the facade
 * window on both sides, which is what leaves room to shorten the silhouette
 * without touching the wall.
 */
expectGateFails('a facade narrower than the plot it stands on', 'silhouette', (baked) => {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  const baseTop = projection.frameHeight - projection.scale;
  const leftEdge = Math.round(projection.facadeLeft);
  const rightEdge = Math.round(projection.facadeRight);
  // Everything outside the coverage window, cleared to the frame's own edges.
  // Clearing a sliver instead does nothing: the span is measured between the
  // outermost ink on the row, so ink further out still sets it.
  ctx.clearRect(0, baseTop, leftEdge, projection.scale);
  ctx.clearRect(rightEdge, baseTop, projection.frameWidth - rightEdge, projection.scale);
});

/**
 * A side return lit as brightly as the wall it turns away from.
 *
 * The two share a material, so any difference between them is lighting — this is
 * the comparison that catches a building which has lost its corner, and it is a
 * separate rule from the roof's, with its own way of going wrong.
 */
const SIDE_RETURN_BRIGHTEN = 0.55;

expectGateFails('a side return as bright as the front wall', 'plane-separation', (baked) => {
  const projection = project(baked.spec);
  const ctx = baked.sheet.getContext('2d');
  ctx.save();
  quadPath(ctx, projection.sideQuad);
  ctx.clip();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(255,255,255,${SIDE_RETURN_BRIGHTEN})`;
  ctx.fillRect(0, 0, baked.sheet.width, baked.sheet.height);
  ctx.restore();
});

/**
 * An overlay carrying far more ink than an overlay should.
 *
 * Distinct from the copy-of-idle case, which is opaque everywhere and would be
 * caught by any ceiling at all. This one is sized to land just the wrong side of
 * the real limit — a band a little over the 5% allowance — so the limit cannot
 * drift upward without this going green. An earlier version used a tenth of the
 * frame, which the ceiling could have been loosened to 0.89 without noticing.
 */
const OVERWEIGHT_OVERLAY_COVERAGE = 0.055;

expectGateFails('an overlay heavier than the limit', 'life-transparency', (baked) => {
  const ctx = baked.sheet.getContext('2d');
  const frameHeight = baked.idle.height;
  const bandHeight = frameHeight * OVERWEIGHT_OVERLAY_COVERAGE;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (let step = 0; step < baked.life.length; step++) {
    ctx.fillRect(step * baked.idle.width, frameHeight, baked.idle.width, bandHeight);
  }
});

expectGateFails('an overlay with too few frames to animate', 'life-frame-count', (baked) => {
  const TOO_FEW_FRAMES = 3;
  return {
    ...baked,
    spec: { ...baked.spec, life: { ...baked.spec.life, frames: TOO_FEW_FRAMES } },
  };
});

expectGateFails('an effect whose cycle does not close', 'life-frame-count', (baked) => {
  const FRACTIONAL_CYCLES = 1.5;
  return {
    ...baked,
    spec: {
      ...baked.spec,
      life: {
        ...baked.spec.life,
        effects: baked.spec.life.effects.map((effect) => ({
          ...effect,
          cycles: FRACTIONAL_CYCLES,
        })),
      },
    },
  };
});

expectGateFails('a painter reaching past its own cell', 'cell-bleed', (baked) => {
  // `idle` is one frame, so anything drawn in the columns after it is ink that
  // escaped its cell — at runtime, a stripe of one frame's art on the next.
  baked.sheet.getContext('2d').drawImage(baked.idle, baked.idle.width, 0);
});

expectGateFails(
  'a manifest claiming a column the sheet does not have',
  'frame-geometry',
  (baked) => {
    // The sheet keeps its size while the entry is told there is one more column.
    // This is the frame-size drift that bleeds a stripe of the neighbouring cell
    // into every frame, and it is the reason the entry and the canvas are compared
    // at all rather than each being trusted on its own.
    const EXTRA_COLUMN = 1;
    return {
      ...baked,
      entry: {
        ...baked.entry,
        states: {
          ...baked.entry.states,
          life: {
            ...baked.entry.states.life,
            frameCount: baked.entry.states.life.frameCount + EXTRA_COLUMN,
          },
        },
      },
    };
  },
);

expectGateFails('an overlay row copied from idle', 'life-transparency', (baked) => {
  const ctx = baked.sheet.getContext('2d');
  for (let step = 0; step < baked.life.length; step++) {
    ctx.drawImage(baked.idle, step * baked.idle.width, baked.idle.height);
  }
});

// ── the gates that do not run over a sheet ─────────────────────────────────

/**
 * The doorway gate, exercised directly.
 *
 * It is the highest-stakes check in the kit — the property it guards is what
 * `SpriteLoader` asserts at module load, so a building that breaks it takes the
 * game down at boot rather than merely looking wrong — and it is a pure function
 * over a plain object, so there is no excuse for it to be the one gate nothing
 * tests. The bake cannot reach these states with a well-formed spec, which is
 * exactly why they have to be constructed.
 */
function expectDoorwayGateFails(
  label: string,
  doorway:
    | { readonly dx: number; readonly dy: number; readonly dx0: number; readonly width: number }
    | undefined,
): void {
  const spec = findBuildingSpec('sleeping_cat_inn');
  const results = new GateResults();
  gateDoorway(results, spec, doorway);
  if (results.failures.some((failure) => failure.gate === 'doorway')) {
    report(`${label}: 'doorway' went red, as it must`);
    return;
  }
  fail(`${label}: 'doorway' stayed green on a doorway that breaks the property it names`);
}

const INN = findBuildingSpec('sleeping_cat_inn');
const INN_FRONT_ROW = INN.tilesHigh - 1;

expectDoorwayGateFails('no doorway at all', undefined);

expectDoorwayGateFails('an opening the spec did not ask for', {
  dx: INN.door.col,
  dy: INN_FRONT_ROW,
  dx0: INN.door.col + 1,
  width: INN.door.gapTiles,
});

expectDoorwayGateFails('an opening of the wrong width', {
  dx: INN.door.col,
  dy: INN_FRONT_ROW,
  dx0: INN.door.col,
  width: INN.door.gapTiles + 1,
});

expectDoorwayGateFails("a doorway above the facade's front row", {
  dx: INN.door.col,
  dy: INN_FRONT_ROW - 1,
  dx0: INN.door.col,
  width: INN.door.gapTiles,
});

expectDoorwayGateFails('a door tile outside its own opening', {
  dx: INN.door.col + INN.door.gapTiles,
  dy: INN_FRONT_ROW,
  dx0: INN.door.col,
  width: INN.door.gapTiles,
});

/**
 * The written-geometry gate, exercised directly.
 *
 * It normally reads files the bake has just produced, so the only way to hand it
 * a disagreeing pair is to call it with one.
 */
function expectWrittenGeometryFails(
  label: string,
  frameWidth: number,
  frameHeight: number,
  lifeFrameCount: number,
  sheetWidth: number,
  sheetHeight: number,
): void {
  const results = new GateResults();
  gateWrittenSheetGeometry(
    results,
    findBuildingSpec('sleeping_cat_inn'),
    { frameWidth, frameHeight, lifeFrameCount },
    sheetWidth,
    sheetHeight,
  );
  if (results.failures.some((failure) => failure.gate === 'written-geometry')) {
    report(`${label}: 'written-geometry' went red, as it must`);
    return;
  }
  fail(`${label}: 'written-geometry' stayed green on a manifest that does not describe its sheet`);
}

const WRITTEN_FRAME_WIDTH = 384;
const WRITTEN_FRAME_HEIGHT = 288;
const WRITTEN_LIFE_FRAMES = 8;
const WRITTEN_SHEET_WIDTH = WRITTEN_FRAME_WIDTH * WRITTEN_LIFE_FRAMES;
const WRITTEN_SHEET_HEIGHT = WRITTEN_FRAME_HEIGHT * 2;
const DRIFT_PX = 32;

expectWrittenGeometryFails(
  'a manifest frame wider than the sheet it describes',
  WRITTEN_FRAME_WIDTH + DRIFT_PX,
  WRITTEN_FRAME_HEIGHT,
  WRITTEN_LIFE_FRAMES,
  WRITTEN_SHEET_WIDTH,
  WRITTEN_SHEET_HEIGHT,
);

expectWrittenGeometryFails(
  'a manifest frame taller than the sheet it describes',
  WRITTEN_FRAME_WIDTH,
  WRITTEN_FRAME_HEIGHT + DRIFT_PX,
  WRITTEN_LIFE_FRAMES,
  WRITTEN_SHEET_WIDTH,
  WRITTEN_SHEET_HEIGHT,
);

for (const line of reports) console.log(`  ok   ${line}`);

if (failures.length > 0) {
  console.error('\nGATE VERIFICATION FAILURES:');
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log('\nEvery building gate failed the art that breaks it. All checks passed.');
