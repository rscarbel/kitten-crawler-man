/**
 * Art gates for the Briar Hollow ratkin cast.
 *
 * Cells are painted from the same `FigureDef`s the runtime cache paints, baked
 * the way the cache bakes them. Failures accumulate so one run reports
 * everything, and every filtering loop counts what it examined: a gate whose
 * narrowing matches nothing reports that, rather than passing.
 *
 *   C1  structure: nothing clipped, nothing blank, the cell is not mostly air
 *   C2  every state the sprite wrapper or the prewarm can ask for is painted,
 *       and every painted state is one the wrapper can reach
 *   C3  anchor: every character's soles stand on the tile the figure claims
 *   C4  stride sync against `RAT_KIN_TILES_PER_WALK_CYCLE`, per build
 *   C5  event frames land inside their rows
 *   C6  Mordecai's cells byte-identical to the stored baseline
 *   C7  silhouette distinctness of every pair of named characters at 32px
 *   C8  memory: the whole village on screen, and each figure fully warm
 *   C9  prewarm keeps re-asking while the party lingers near the palisade
 *   H1–H3 the summoned thrall, in `gates-thrall.ts`
 *
 * Run by `npm run render:ratkin-cast`, or alone: `npx tsx scripts/gates-ratkin-cast.ts`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { mordecaiIdentityFailures } from './verify-mordecai-identity.js';
import { thrallGateFailures } from './gates-thrall.js';
import { TILE_SIZE } from '../src/core/constants.js';
import {
  RAT_KIN_SCALE,
  STANCE_FRACTION,
  CONTRALATERAL_PHASE,
} from '../src/sprites/art/ratKinFigure.js';
import { RATKIN_BUILDS } from '../src/sprites/art/ratkin/outfit.js';
import {
  RATKIN_CAST_IDS,
  RATKIN_CAST_OUTFITS,
  type RatkinCastId,
} from '../src/sprites/art/ratkin/cast.js';
import { VILLAGER_IDS } from '../src/systems/briarHollow/ratkinDialogue.js';
import {
  RATKIN_CAST_TILE_SCALE,
  castRowsFor,
  ratkinCastFigure,
} from '../src/sprites/art/ratkinCastFigure.js';
import {
  ratkinCastArrivalStates,
  ratkinCastDrawnStates,
  ratkinCastTilesPerWalkCycle,
} from '../src/sprites/ratkinCastSprite.js';
import { RAT_KIN_TILES_PER_WALK_CYCLE } from '../src/sprites/ratKinSprite.js';
import {
  FIGURE_BYTE_BUDGET,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  RATKIN_PREWARM_RADIUS_TILES,
  RatkinCastPrewarm,
} from '../src/systems/briarHollow/ratkinCastPrewarm.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** Decimals a stride is printed to, matching the runtime constant's own precision. */
const TILES_DECIMALS = 4;
const SCORE_DECIMALS = 3;

let failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── C1 structure ─────────────────────────────────────────────────────────────

/**
 * The cast cell is sized for a spear held at full height and levelled on the
 * thrust; a child standing idle in it fills far less than a Mordecai-sized
 * cell would. The fill floor is the widest pose's box, so this is about the
 * figure's own largest pose, which for every cast member carries a prop or a
 * gesture out past the body.
 */
const CAST_MIN_INK_AREA_SHARE = 0.08;

function gateStructure(): void {
  for (const id of RATKIN_CAST_IDS) {
    for (const failure of figureStructuralFailures(ratkinCastFigure(id), {
      minInkAreaShare: CAST_MIN_INK_AREA_SHARE,
    })) {
      fail('C1', failure);
    }
  }
}

// ── C2 runtime state names ───────────────────────────────────────────────────

function gateStateNames(): void {
  let statesMeasured = 0;
  for (const id of RATKIN_CAST_IDS) {
    const figure = ratkinCastFigure(id);
    const drawn = ratkinCastDrawnStates(id);
    for (const failure of missingStateFailures(figure, drawn, `${id}'s sprite wrapper`))
      fail('C2', failure);
    for (const failure of missingStateFailures(
      figure,
      ratkinCastArrivalStates(id),
      `${id}'s prewarm`,
    )) {
      fail('C2', failure);
    }
    for (const [state] of figure.states) {
      statesMeasured++;
      if (drawn.includes(state)) continue;
      fail('C2', `${figure.id} paints "${state}", which the sprite wrapper never asks for`);
    }
  }
  failUnlessMeasured('C2', statesMeasured, 'declared states');
}

// ── C3 anchor ────────────────────────────────────────────────────────────────

/** Measured on the shipped art: soles sit 3–4 cell pixels above the tile floor, as Mordecai's do. */
const SOLES_ABOVE_TILE_FLOOR_MIN_PX = -2;
const SOLES_ABOVE_TILE_FLOOR_MAX_PX = 5;
const SOLID_ALPHA_THRESHOLD = 200;
const ANCHOR_MEASURE_PAD = 160;
/** Rows whose feet are meant to be on the floor on their first frame. */
const STANDING_ROLES = new Set(['walk', 'idle', 'talk', 'work', 'strike', 'hurt', 'down']);

function lowestSolidRow(figure: FigureDef, state: string, frame: number): number | null {
  const width = figure.frameWidth + ANCHOR_MEASURE_PAD * 2;
  const height = figure.frameHeight + ANCHOR_MEASURE_PAD * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(ANCHOR_MEASURE_PAD, ANCHOR_MEASURE_PAD);
  figure.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  let lowest = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] >= SOLID_ALPHA_THRESHOLD) lowest = y;
    }
  }
  return lowest < 0 ? null : lowest - ANCHOR_MEASURE_PAD;
}

function gateAnchor(): void {
  let rowsMeasured = 0;
  for (const id of RATKIN_CAST_IDS) {
    const figure = ratkinCastFigure(id);
    const tileFloor = figure.tileY + figure.tileScale;
    for (const row of castRowsFor(id)) {
      if (!STANDING_ROLES.has(row.role)) continue;
      const soleLine = lowestSolidRow(figure, row.name, 0);
      if (soleLine === null) {
        fail('C3', `${id}.${row.name}[0] painted no solid ink to stand on`);
        continue;
      }
      rowsMeasured++;
      const aboveFloor = tileFloor - soleLine;
      if (
        aboveFloor > SOLES_ABOVE_TILE_FLOOR_MAX_PX ||
        aboveFloor < SOLES_ABOVE_TILE_FLOOR_MIN_PX
      ) {
        fail(
          'C3',
          `${id}.${row.name}'s lowest solid ink is ${aboveFloor}px above the tile floor, outside ` +
            `[${SOLES_ABOVE_TILE_FLOOR_MIN_PX}, ${SOLES_ABOVE_TILE_FLOOR_MAX_PX}]`,
        );
      }
    }
  }
  failUnlessMeasured('C3', rowsMeasured, 'standing rows');
}

// ── C4 stride sync ───────────────────────────────────────────────────────────

const PLANTED_EPSILON = 1e-9;
const STRIDE_TOLERANCE = 0.00005;

/**
 * Re-measures each character's planted-foot travel off the walk_side poses
 * and holds it against what the sprite wrapper paces the cycle by. The base
 * gait is Mordecai's, so the unscaled measure must also agree with his
 * `RAT_KIN_TILES_PER_WALK_CYCLE`.
 */
function gateStrideSync(): void {
  let measured = 0;
  for (const id of RATKIN_CAST_IDS) {
    const walk = castRowsFor(id).find((row) => row.name === 'walk_side');
    if (walk === undefined) {
      fail('C4', `${id} paints no walk_side to measure a stride from`);
      continue;
    }
    let fastest = 0;
    let slides = 0;
    for (const side of ['near', 'far'] as const) {
      const offset = side === 'near' ? 0 : CONTRALATERAL_PHASE;
      let previousX: number | null = null;
      for (let frame = 0; frame < walk.frameCount; frame++) {
        const cycle = (((frame / walk.frameCount + offset) % 1) + 1) % 1;
        const pose = walk.pose(frame);
        const foot = side === 'near' ? pose.nearFoot : pose.farFoot;
        if (cycle >= STANCE_FRACTION) {
          previousX = null;
          continue;
        }
        if (previousX !== null) {
          const slide = previousX - foot.ball.x;
          if (slide <= PLANTED_EPSILON)
            fail('C4', `${id}'s ${side} foot slides forward while planted`);
          fastest = Math.max(fastest, slide);
          slides++;
        }
        previousX = foot.ball.x;
      }
    }
    if (slides === 0) {
      fail('C4', `${id}'s walk_side has no consecutive planted frames`);
      continue;
    }
    measured++;
    const baseTiles = fastest * walk.frameCount * RAT_KIN_SCALE;
    if (Math.abs(baseTiles - RAT_KIN_TILES_PER_WALK_CYCLE) > STRIDE_TOLERANCE) {
      fail(
        'C4',
        `${id}'s gait covers ${baseTiles.toFixed(TILES_DECIMALS)} tiles per cycle at Mordecai's size, ` +
          `against RAT_KIN_TILES_PER_WALK_CYCLE ${RAT_KIN_TILES_PER_WALK_CYCLE}`,
      );
    }
    const scaled = baseTiles * RATKIN_BUILDS[RATKIN_CAST_OUTFITS[id].build].scale;
    const paced = ratkinCastTilesPerWalkCycle(id);
    if (Math.abs(scaled - paced) > STRIDE_TOLERANCE) {
      fail(
        'C4',
        `${id} is paced at ${paced.toFixed(TILES_DECIMALS)} tiles per cycle but its feet cover ${scaled.toFixed(TILES_DECIMALS)}`,
      );
    }
  }
  failUnlessMeasured('C4', measured, 'walk_side strides');
}

// ── C5 event frames ──────────────────────────────────────────────────────────

function gateEventFrames(): void {
  let events = 0;
  for (const id of RATKIN_CAST_IDS) {
    for (const row of castRowsFor(id)) {
      for (const [name, frame] of Object.entries(row.events ?? {})) {
        events++;
        if (!Number.isInteger(frame) || frame < 0 || frame >= row.frameCount) {
          fail('C5', `${id}.${row.name}'s ${name} event is frame ${frame} of ${row.frameCount}`);
        }
      }
      if (row.role === 'strike' && row.events?.impact === undefined) {
        fail('C5', `${id}.${row.name} declares no impact frame for the hit to land on`);
      }
    }
  }
  if (castRowsFor('oren').find((row) => row.role === 'work')?.events?.strike === undefined) {
    fail('C5', "oren's hammer loop declares no strike frame for the sparks");
  }
  failUnlessMeasured('C5', events, 'event frames');
}

// ── C6 Mordecai ──────────────────────────────────────────────────────────────

function gateMordecaiIdentity(): void {
  for (const failure of mordecaiIdentityFailures()) fail('C6', failure);
}

// ── C7 silhouette distinctness ───────────────────────────────────────────────

/** Game pixels per cell pixel: the cast is painted at 64px tiles, the game draws 32. */
const GAME_SCALE = TILE_SIZE / RATKIN_CAST_TILE_SCALE;
const MASK_ALPHA = 128;
/** Channels darker than this are outline or shadow, not a character's colour. */
const DOMINANT_MIN_CHANNEL = 48;
const COLOUR_LEVELS = 8;
const CHANNEL_MAX = 255;
const RGB_DIAGONAL = Math.hypot(CHANNEL_MAX, CHANNEL_MAX, CHANNEL_MAX);

interface Signature {
  readonly mask: Uint8Array;
  readonly dominant: readonly [number, number, number];
}

function signatureOf(id: RatkinCastId): Signature {
  const figure = ratkinCastFigure(id);
  const cell = bakeFigureCell(figure, 'idle', 0);
  const width = Math.round(figure.frameWidth * GAME_SCALE);
  const height = Math.round(figure.frameHeight * GAME_SCALE);
  const small: Canvas = createCanvas(width, height);
  small.getContext('2d').drawImage(cell, 0, 0, width, height);
  const { data } = small.getContext('2d').getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * CHANNELS + ALPHA_OFFSET];
    if (alpha < MASK_ALPHA) continue;
    mask[i] = 1;
    const r = data[i * CHANNELS];
    const g = data[i * CHANNELS + 1];
    const b = data[i * CHANNELS + 2];
    if (Math.max(r, g, b) < DOMINANT_MIN_CHANNEL) continue;
    const q = (value: number): number =>
      Math.min(COLOUR_LEVELS - 1, Math.floor((value / (CHANNEL_MAX + 1)) * COLOUR_LEVELS));
    const key = (q(r) * COLOUR_LEVELS + q(g)) * COLOUR_LEVELS + q(b);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const bin of bins.values()) if (bin.count > best.count) best = bin;
  const dominant: [number, number, number] =
    best.count === 0 ? [0, 0, 0] : [best.r / best.count, best.g / best.count, best.b / best.count];
  return { mask, dominant };
}

function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 && b[i] === 1) both++;
    if (a[i] === 1 || b[i] === 1) either++;
  }
  return either === 0 ? 1 : both / either;
}

/**
 * The floor a pair's distinctness must clear: `(1 − mask IoU) + dominant-colour
 * distance / RGB diagonal`. Two identical figures score exactly 0. Set from the
 * shipped art: the closest named pair measures 0.171 (Merrit and Wicker — two
 * standard builds in blue-and-cream shirts, told apart by the straw hat and the
 * vest), so the floor sits under it with room for a small repaint and far above
 * what two copies of one outfit score.
 */
export const SILHOUETTE_DISTINCTNESS_FLOOR = 0.15;

function gateSilhouettes(): void {
  const named: readonly RatkinCastId[] = VILLAGER_IDS;
  const signatures = new Map(named.map((id) => [id, signatureOf(id)]));
  let pairs = 0;
  let closest = { score: Infinity, a: '', b: '' };
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = signatures.get(named[i]);
      const b = signatures.get(named[j]);
      if (a === undefined || b === undefined) continue;
      pairs++;
      const iou = maskIoU(a.mask, b.mask);
      const colour =
        Math.hypot(
          a.dominant[0] - b.dominant[0],
          a.dominant[1] - b.dominant[1],
          a.dominant[2] - b.dominant[2],
        ) / RGB_DIAGONAL;
      const score = 1 - iou + colour;
      if (process.env.RATKIN_GATE_DEBUG !== undefined) {
        console.log(
          `    ${named[i]}/${named[j]} iou ${iou.toFixed(SCORE_DECIMALS)} colour ${colour.toFixed(SCORE_DECIMALS)} a=${a.dominant.map(Math.round).join(',')} b=${b.dominant.map(Math.round).join(',')}`,
        );
      }
      if (score < closest.score) closest = { score, a: named[i], b: named[j] };
      if (score < SILHOUETTE_DISTINCTNESS_FLOOR) {
        fail(
          'C7',
          `${named[i]} and ${named[j]} are too alike at ${TILE_SIZE}px: mask IoU ${iou.toFixed(SCORE_DECIMALS)}, ` +
            `dominant-colour distance ${colour.toFixed(SCORE_DECIMALS)}, score ${score.toFixed(SCORE_DECIMALS)} under ${SILHOUETTE_DISTINCTNESS_FLOOR}`,
        );
      }
    }
  }
  failUnlessMeasured('C7', pairs, 'pairs of named characters');
  console.log(
    `  C7 silhouettes: closest pair ${closest.a} / ${closest.b} at ${closest.score.toFixed(SCORE_DECIMALS)} ` +
      `(floor ${SILHOUETTE_DISTINCTNESS_FLOOR}) over ${pairs} pairs`,
  );
}

// ── C8 memory ────────────────────────────────────────────────────────────────

/**
 * The ceiling for the whole village on screen at once. Above it, the six
 * most-idle characters' work rows go to half rate and the stationary
 * characters lose their walk_away row.
 */
const VILLAGE_ON_SCREEN_BUDGET_MEGABYTES = 40;

function rowFrames(figure: FigureDef, state: string): number {
  return figure.states.get(state)?.frames ?? 0;
}

/**
 * What the village keeps resident with everyone on screen: each character's
 * standing row, plus the working row for each worker and a walk for everyone
 * who strolls, since the cache holds only rows being played.
 */
function gateMemory(): void {
  let villageBytes = 0;
  let heaviest = { id: '', bytes: 0 };
  for (const id of RATKIN_CAST_IDS) {
    const figure = ratkinCastFigure(id);
    const cellBytes = figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
    const onScreen =
      rowFrames(figure, 'idle') +
      Math.max(rowFrames(figure, 'work'), rowFrames(figure, 'walk_side'));
    villageBytes += onScreen * cellBytes;
    let allBytes = 0;
    for (const [, declared] of figure.states) allBytes += declared.frames * cellBytes;
    if (allBytes > heaviest.bytes) heaviest = { id, bytes: allBytes };
    if (allBytes > FIGURE_BYTE_BUDGET) {
      fail(
        'C8',
        `${figure.id} fully warm is ${(allBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB, over its per-figure ceiling`,
      );
    }
  }
  const villageMegabytes = villageBytes / BYTES_PER_MEGABYTE;
  console.log(
    `  C8 memory: whole village on screen ≈ ${villageMegabytes.toFixed(1)} MB ` +
      `(budget ${VILLAGE_ON_SCREEN_BUDGET_MEGABYTES} MB); heaviest figure fully warm: ` +
      `${heaviest.id} ${(heaviest.bytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`,
  );
  if (villageMegabytes > VILLAGE_ON_SCREEN_BUDGET_MEGABYTES) {
    fail(
      'C8',
      `the village on screen holds ${villageMegabytes.toFixed(1)} MB, over ${VILLAGE_ON_SCREEN_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── C9 prewarm refresh ───────────────────────────────────────────────────────

/** Long enough to cover several release windows of loitering at the gate. */
const LINGER_WINDOWS = 4;
/** A palisade rect for the simulation; only its distance to the party matters. */
const SIM_PALISADE = { x: 0, y: 0, w: 20, h: 20 };
/** Tiles beyond the ring and its release margin: definitely away. */
const FAR_AWAY_TILES = 200;

/**
 * Rendered frames per gameplay update to simulate: 60 Hz, 120 Hz, 144 Hz and a
 * paused screen still refreshing at 144 Hz while updates run at a trickle. The
 * cache's idle clock ticks per rendered frame, so a refresh paced in updates
 * falls behind it on every fast display.
 */
const CACHE_FRAMES_PER_UPDATE: readonly number[] = [1, 2, 2.4, 8];

/**
 * Drives `RatkinCastPrewarm` headlessly against a simulated cache clock: a
 * party standing just inside the prewarm ring for several release windows must
 * have every cast member re-requested before the cache's idle sweep, measured
 * in the cache's own frames, could free the rows. A party far away must request
 * nothing.
 */
function gatePrewarmRefresh(): void {
  let measured = 0;
  const nearX = (SIM_PALISADE.x + SIM_PALISADE.w + RATKIN_PREWARM_RADIUS_TILES - 1) * TILE_SIZE;
  const farX = (SIM_PALISADE.x + SIM_PALISADE.w + FAR_AWAY_TILES) * TILE_SIZE;
  const lingerFrames = IDLE_FRAMES_BEFORE_RELEASE * LINGER_WINDOWS;
  for (const rate of CACHE_FRAMES_PER_UPDATE) {
    const requests = new Map<RatkinCastId, number[]>();
    let cacheFrame = 0;
    const prewarm = new RatkinCastPrewarm(
      (id) => {
        const at = requests.get(id) ?? [];
        at.push(Math.floor(cacheFrame));
        requests.set(id, at);
      },
      () => Math.floor(cacheFrame),
    );
    for (; cacheFrame < lingerFrames; cacheFrame += rate) prewarm.update(nearX, 0, SIM_PALISADE);

    for (const id of RATKIN_CAST_IDS) {
      const at = requests.get(id) ?? [];
      if (at.length === 0) {
        fail('C9', `${id} was never prewarmed at ${rate} cache frames per update`);
        continue;
      }
      measured++;
      const marks = [...at, lingerFrames];
      for (let i = 1; i < marks.length; i++) {
        const gap = marks[i] - marks[i - 1];
        if (gap < IDLE_FRAMES_BEFORE_RELEASE) continue;
        fail(
          'C9',
          `${id} went ${gap} cache frames without a prewarm request at ${rate} cache frames ` +
            `per update; the cache frees an untouched row after ${IDLE_FRAMES_BEFORE_RELEASE}`,
        );
        break;
      }
    }

    requests.clear();
    const awayUntil = cacheFrame + lingerFrames;
    for (; cacheFrame < awayUntil; cacheFrame += rate) prewarm.update(farX, 0, SIM_PALISADE);
    if (requests.size > 0) fail('C9', 'the cast was prewarmed with the party far from the village');
  }
  failUnlessMeasured('C9', measured, 'prewarmed cast members');
}

/** Runs every cast gate and returns the failures, one message each. */
export function ratkinCastGateFailures(): string[] {
  failures = [];
  gateStructure();
  gateStateNames();
  gateAnchor();
  gateStrideSync();
  gateEventFrames();
  gateMordecaiIdentity();
  gateSilhouettes();
  gateMemory();
  gatePrewarmRefresh();
  // The thrall is painted on this rig and cell, so it is gated with the cast.
  failures.push(...thrallGateFailures());
  return failures;
}

const invokedDirectly = process.argv[1]?.endsWith('gates-ratkin-cast.ts') ?? false;
if (invokedDirectly) {
  const found = ratkinCastGateFailures();
  for (const failure of found) console.error(`  FAIL ${failure}`);
  if (found.length > 0) process.exitCode = 1;
  else console.log('  ok   ratkin cast gates');
}
