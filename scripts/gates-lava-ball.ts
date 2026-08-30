/**
 * The Lava Llama's spit gates.
 *
 * The three sheets are gone, so every invariant the deleted bake threw on is
 * enforced here against cells painted from the three `FigureDef`s, baked
 * exactly the way the runtime cache bakes them — plus the ones the bake could
 * not reach at all, because the numbers they are about live in
 * `LavaBallSystem`: how far the blast damages, and how far the fire patch
 * burns. Paint that does not agree with those is the art teaching the player
 * the wrong radius.
 *
 * Failures accumulate rather than throwing one at a time. A gate that cannot
 * find the figure or row it names fails loudly, and so does one whose filtered
 * loop examined nothing.
 *
 * Run by the review harness: `npm run render:lava-ball`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  LAVA_BALL_FIGURES,
  LLAMA_LAVA_BOLT_FIGURE,
  LLAMA_LAVA_BURST_FIGURE,
  LLAMA_LAVA_FLAME_FIGURE,
  cyclePhase,
} from '../src/sprites/art/lavaBallFigure.js';
import { BURST_RADIUS_TILES, FLAME_RADIUS_TILES } from '../src/systems/LavaBallSystem.js';

/**
 * Alpha a pixel may carry before it counts as ink. Downsampling a supersampled
 * cell leaves a haze of near-zero alpha around everything, and a gate counting
 * that haze would measure the antialiaser rather than the art.
 */
const INK_ALPHA = 6;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/** Fails a gate whose filtered loop ran zero times. */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

interface Cell {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const { data } = bakeFigureCell(def, state, frame)
    .getContext('2d')
    .getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const cell: Cell = { alpha, width: frameWidth, height: frameHeight };
  cellCache.set(key, cell);
  return cell;
}

function isInk(cell: Cell, x: number, y: number): boolean {
  return cell.alpha[y * cell.width + x] > INK_ALPHA;
}

/** The one state each of these figures declares, or null after failing. */
function onlyStateOf(def: FigureDef, gateId: string): string | null {
  const names = [...def.states.keys()];
  if (names.length !== 1) {
    fail(gateId, `${def.id} declares ${names.length} states; these effects each have exactly one`);
    return null;
  }
  return names[0];
}

function frameCountOf(def: FigureDef, state: string): number {
  return def.states.get(state)?.frames ?? 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Alpha difference at which a pixel counts as having changed between frames. */
const FRAME_CHANGE_ALPHA = 24;

/** Share of inked pixels whose alpha differs between two cells. */
function changeShare(a: Cell, b: Cell): number {
  let changed = 0;
  let inked = 0;
  for (let i = 0; i < a.alpha.length; i++) {
    if (a.alpha[i] > INK_ALPHA || b.alpha[i] > INK_ALPHA) inked++;
    if (Math.abs(a.alpha[i] - b.alpha[i]) >= FRAME_CHANGE_ALPHA) changed++;
  }
  if (inked === 0) return 0;
  return changed / inked;
}

// ── L1 structure ─────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const def of LAVA_BALL_FIGURES) {
    for (const failure of figureStructuralFailures(def)) fail('L1', failure);
  }
}

// ── L2 the cell wall ─────────────────────────────────────────────────────────

/**
 * Ported from the deleted bake. The bolt is drawn rotated to its heading, so a
 * cut against the cell wall sweeps around with the ball and is impossible to
 * miss in motion.
 */
const MAX_EDGE_ALPHA = 6;

function gateEdgeBleed(): void {
  let framesMeasured = 0;
  for (const def of LAVA_BALL_FIGURES) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const cell = cellOf(def, state, frame);
        const right = cell.width - 1;
        const bottom = cell.height - 1;
        let worst = 0;
        for (let x = 0; x <= right; x++) {
          worst = Math.max(worst, cell.alpha[x], cell.alpha[bottom * cell.width + x]);
        }
        for (let y = 0; y <= bottom; y++) {
          worst = Math.max(worst, cell.alpha[y * cell.width], cell.alpha[y * cell.width + right]);
        }
        if (worst > MAX_EDGE_ALPHA) {
          fail(
            'L2',
            `${def.id}.${state}[${frame}] paints its own border at alpha ${worst}; the art is ` +
              'clipped by the cell. Grow the cell or shrink the effect.',
          );
        }
      }
    }
  }
  failUnlessMeasured('L2', framesMeasured, 'frames for edge bleed');
}

// ── L3 the effect fills the cell it costs ────────────────────────────────────

const MIN_INK_SPAN = 0.35;

function gateInkSpan(): void {
  let figuresMeasured = 0;
  for (const def of LAVA_BALL_FIGURES) {
    let widest = 0;
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        const cell = cellOf(def, state, frame);
        let minX = cell.width;
        let maxX = -1;
        for (let y = 0; y < cell.height; y++) {
          for (let x = 0; x < cell.width; x++) {
            if (!isInk(cell, x, y)) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
        if (maxX < 0) continue;
        widest = Math.max(widest, (maxX - minX) / cell.width);
      }
    }
    figuresMeasured++;
    if (widest < MIN_INK_SPAN) {
      fail(
        'L3',
        `${def.id} never spans more than ${(widest * 100).toFixed(0)}% of its cell width; shrink ` +
          'the frame envelope rather than paying for empty pixels on every frame',
      );
    }
  }
  failUnlessMeasured('L3', figuresMeasured, 'figures for ink span');
}

// ── L4 the looping rows actually move ────────────────────────────────────────

/**
 * Share of a pair's inked pixels that must change between consecutive frames.
 *
 * Well under the bake's own limit, because both of these rows are mostly a
 * static glow with a churning crust inside it — the shipped bolt changes about
 * 4% of its ink per frame and the flame about 3.5%. What this catches is the
 * churn being switched off entirely, which turns a ball of lava into an orange
 * dot sliding across the floor.
 */
const MIN_FRAME_CHANGE = 0.015;

/** The two rows the runtime plays on a clock; the burst is a one-shot. */
const LOOPING_FIGURES: readonly FigureDef[] = [LLAMA_LAVA_BOLT_FIGURE, LLAMA_LAVA_FLAME_FIGURE];

function gateLoopsMove(): void {
  let pairsMeasured = 0;
  for (const def of LOOPING_FIGURES) {
    const state = onlyStateOf(def, 'L4');
    if (state === null) continue;
    const frames = frameCountOf(def, state);
    for (let frame = 0; frame + 1 < frames; frame++) {
      pairsMeasured++;
      const share = changeShare(cellOf(def, state, frame), cellOf(def, state, frame + 1));
      if (share < MIN_FRAME_CHANGE) {
        fail(
          'L4',
          `${def.id} changes only ${(share * 100).toFixed(2)}% of its inked pixels between ` +
            `frames ${frame} and ${frame + 1}; the loop reads as a still`,
        );
      }
    }
  }
  failUnlessMeasured('L4', pairsMeasured, 'consecutive frame pairs');
}

// ── L5 the loops close ───────────────────────────────────────────────────────

/**
 * How far short of the row's median step the painted wrap may fall.
 *
 * The shipped rows wrap at 1.16x (bolt) and 1.10x (flame) their median step,
 * which is what a cycle that closes looks like. A floor at 0.65 clears both and
 * still catches a wrap that changes nothing, which is what sampling the phase
 * at `frame / (frames - 1)` produces.
 */
const WRAP_VS_MEDIAN_FLOOR = 0.65;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

function gateLoopsClose(): void {
  let rowsMeasured = 0;
  let wrapsMeasured = 0;
  for (const def of LOOPING_FIGURES) {
    const state = onlyStateOf(def, 'L5');
    if (state === null) continue;
    const frames = frameCountOf(def, state);
    rowsMeasured++;

    // The ceiling, in the units the defect is actually in. A row that runs more
    // or less than one turn pops once per cycle, and the pixels cannot say so:
    // both of these are a static glow with seeded churn inside it, so any phase
    // offset at all decorrelates the churn and the wrap measures the same few
    // per cent as an ordinary step whatever the cycle is doing.
    const span = cyclePhase(frames, frames) - cyclePhase(0, frames);
    if (Math.abs(span - ONE_TURN) > PHASE_EPSILON) {
      fail(
        'L5',
        `${def.id} spends ${span.toFixed(4)} of a turn over its ${frames} frames rather than ` +
          'exactly one, so the frame after the last does not land on the first',
      );
    }
    const firstStep = cyclePhase(1, frames) - cyclePhase(0, frames);
    let stepsMeasured = 0;
    for (let frame = 1; frame < frames; frame++) {
      stepsMeasured++;
      const step = cyclePhase(frame, frames) - cyclePhase(frame - 1, frames);
      if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
      fail(
        'L5',
        `${def.id} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
          `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
      );
    }
    failUnlessMeasured('L5', stepsMeasured, `phase steps of ${def.id}`);

    // The floor, in pixels.
    const steps: number[] = [];
    for (let frame = 0; frame + 1 < frames; frame++) {
      steps.push(changeShare(cellOf(def, state, frame), cellOf(def, state, frame + 1)));
    }
    if (steps.length === 0) continue;
    wrapsMeasured++;
    const wrap = changeShare(cellOf(def, state, frames - 1), cellOf(def, state, 0));
    const typical = median(steps);
    console.log(
      `  L5 ${def.id}: covers ${span.toFixed(3)} of a turn; the wrap changes ` +
        `${(wrap * 100).toFixed(2)}% of the ink against a median step of ` +
        `${(typical * 100).toFixed(2)}%`,
    );
    if (wrap < typical * WRAP_VS_MEDIAN_FLOOR) {
      fail(
        'L5',
        `${def.id} holds still across its wrap: it changes ${(wrap * 100).toFixed(2)}% of the ` +
          `ink against a median step of ${(typical * 100).toFixed(2)}%, so the cycle does not ` +
          'turn over',
      );
    }
  }
  failUnlessMeasured('L5', rowsMeasured, 'looping rows');
  failUnlessMeasured('L5', wrapsMeasured, 'painted wraps');
}

// ── L6 the blast matches the damage it deals ─────────────────────────────────

/** Ink reach from a cell's anchor, in tiles. */
function reachTiles(def: FigureDef, state: string, frame: number): number {
  const cell = cellOf(def, state, frame);
  let reach = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (!isInk(cell, x, y)) continue;
      reach = Math.max(reach, Math.hypot(x + 0.5 - def.tileX, y + 0.5 - def.tileY));
    }
  }
  return reach / def.tileScale;
}

function inkPixels(def: FigureDef, state: string, frame: number): number {
  const cell = cellOf(def, state, frame);
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (isInk(cell, x, y)) count++;
    }
  }
  return count;
}

/**
 * How far past the damage radius the fireball may throw light.
 *
 * An explosion is allowed a bloom outside the ring it actually hurts inside —
 * the alternative is a blast that stops in a hard circle — but not so much that
 * the player learns to stand a tile back from something that only reaches half
 * that. The shipped peak is 0.92 tiles against a 0.8-tile blast.
 */
const BURST_OVERREACH_TILES = 0.2;

function gateBurstMatchesBlast(): void {
  const def = LLAMA_LAVA_BURST_FIGURE;
  const state = onlyStateOf(def, 'L6');
  if (state === null) return;
  const frames = frameCountOf(def, state);
  let peakReach = 0;
  let peakInk = 0;
  let peakInkFrame = 0;
  let framesMeasured = 0;
  for (let frame = 0; frame < frames; frame++) {
    framesMeasured++;
    peakReach = Math.max(peakReach, reachTiles(def, state, frame));
    const ink = inkPixels(def, state, frame);
    if (ink <= peakInk) continue;
    peakInk = ink;
    peakInkFrame = frame;
  }
  failUnlessMeasured('L6', framesMeasured, 'burst frames');
  console.log(
    `  L6 burst reaches ${peakReach.toFixed(3)} tiles against a ${BURST_RADIUS_TILES}-tile ` +
      `blast; it is widest on frame ${peakInkFrame} of ${frames}`,
  );
  if (peakReach < BURST_RADIUS_TILES) {
    fail(
      'L6',
      `the burst reaches ${peakReach.toFixed(3)} tiles but damages out to ${BURST_RADIUS_TILES}, ` +
        `so ${(BURST_RADIUS_TILES - peakReach).toFixed(3)} tiles of live blast look like clean ` +
        'floor',
    );
  }
  const ceiling = BURST_RADIUS_TILES + BURST_OVERREACH_TILES;
  if (peakReach > ceiling) {
    fail(
      'L6',
      `the burst throws light out to ${peakReach.toFixed(3)} tiles against a ` +
        `${BURST_RADIUS_TILES}-tile blast (limit ${ceiling.toFixed(3)}); it promises damage it ` +
        'does not deal',
    );
  }
  // An impact whose ink peaks on its first frame is a disc shrinking, which is
  // the failure this effect exists to avoid.
  if (peakInkFrame === 0) {
    fail('L6', 'the burst is at its widest on frame 0, so it reads as a disc shrinking');
  }
}

// ── L7 the fire patch covers the floor it burns ──────────────────────────────

/**
 * How far past the burn radius the patch's base may spread.
 *
 * The tongues rise and lean, so the widest ink in the cell says nothing about
 * the floor; what is measured is the band of rows at the patch's own base,
 * which is the footprint a player reads as "this tile is on fire". Shipped it
 * is 0.59 tiles against a 0.55-tile burn.
 */
const FLAME_OVERREACH_TILES = 0.12;
/** Rows either side of the base anchor that count as the patch's footprint. */
const FLAME_BASE_BAND_PX = 3;

function gateFlameFootprint(): void {
  const def = LLAMA_LAVA_FLAME_FIGURE;
  const state = onlyStateOf(def, 'L7');
  if (state === null) return;
  let widestHalf = 0;
  let framesMeasured = 0;
  for (let frame = 0; frame < frameCountOf(def, state); frame++) {
    const cell = cellOf(def, state, frame);
    let minX = cell.width;
    let maxX = -1;
    const top = Math.max(0, def.tileY - FLAME_BASE_BAND_PX);
    const bottom = Math.min(cell.height - 1, def.tileY + FLAME_BASE_BAND_PX);
    for (let y = top; y <= bottom; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (!isInk(cell, x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX < 0) continue;
    framesMeasured++;
    widestHalf = Math.max(widestHalf, Math.max(def.tileX - minX, maxX - def.tileX) / def.tileScale);
  }
  failUnlessMeasured('L7', framesMeasured, 'flame frames with ink at the base');
  console.log(
    `  L7 flame base half-width ${widestHalf.toFixed(3)} tiles against a ` +
      `${FLAME_RADIUS_TILES}-tile burn`,
  );
  if (widestHalf < FLAME_RADIUS_TILES) {
    fail(
      'L7',
      `the patch's base spreads ${widestHalf.toFixed(3)} tiles but it burns out to ` +
        `${FLAME_RADIUS_TILES}, so floor that sets the player alight is painted clean`,
    );
  }
  const ceiling = FLAME_RADIUS_TILES + FLAME_OVERREACH_TILES;
  if (widestHalf > ceiling) {
    fail(
      'L7',
      `the patch's base spreads ${widestHalf.toFixed(3)} tiles against a ${FLAME_RADIUS_TILES}-` +
        `tile burn (limit ${ceiling.toFixed(3)}); it paints fire on floor that is safe to stand on`,
    );
  }
}

// ── L8 the bolt's trail streams behind its anchor ────────────────────────────

/**
 * The bolt's anchor is deliberately off-centre — the ball is at the anchor and
 * the trail streams out behind it — and the runtime rotates the cell about that
 * point. Art that drifts forward inside the cell puts the ball behind its own
 * simulated position, and the ball is the part that decides whether a dodge
 * worked.
 *
 * The shipped art reaches 1.31x further behind the anchor than ahead of it.
 */
const MIN_TRAIL_ASYMMETRY = 1.15;

function gateBoltTrailsBehind(): void {
  const def = LLAMA_LAVA_BOLT_FIGURE;
  const state = onlyStateOf(def, 'L8');
  if (state === null) return;
  let framesMeasured = 0;
  for (let frame = 0; frame < frameCountOf(def, state); frame++) {
    const cell = cellOf(def, state, frame);
    let minX = cell.width;
    let maxX = -1;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (!isInk(cell, x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX < 0) continue;
    const behind = def.tileX - minX;
    const ahead = maxX - def.tileX;
    if (ahead <= 0) {
      fail(
        'L8',
        `${def.id} frame ${frame} paints nothing ahead of its anchor, so there is no ball in ` +
          'front of the trail to measure the trail against',
      );
      continue;
    }
    // Counted here rather than at the top of the loop: a frame whose ink is all
    // behind the anchor is skipped by the clause above, and counting it before
    // that would let a row of such frames satisfy the minimum-sample check while
    // no asymmetry was compared at all.
    framesMeasured++;
    const asymmetry = behind / ahead;
    if (asymmetry >= MIN_TRAIL_ASYMMETRY) continue;
    fail(
      'L8',
      `${def.id} frame ${frame} reaches ${behind}px behind its anchor and ${ahead}px ahead ` +
        `(${asymmetry.toFixed(2)}x, minimum ${MIN_TRAIL_ASYMMETRY}x); the trail is no longer ` +
        'streaming out behind the ball',
    );
  }
  failUnlessMeasured('L8', framesMeasured, 'bolt frames');
}

// ── L9 the fire rises off its own base ───────────────────────────────────────

/**
 * The flame is anchored at its base rather than its centre, so that the patch
 * sits on a floor tile with the tongues above it. Ink that has drifted below
 * the anchor is fire painted underneath the floor.
 */
const MIN_INK_ABOVE_ANCHOR = 0.5;

function gateFlameRises(): void {
  const def = LLAMA_LAVA_FLAME_FIGURE;
  const state = onlyStateOf(def, 'L9');
  if (state === null) return;
  let framesMeasured = 0;
  for (let frame = 0; frame < frameCountOf(def, state); frame++) {
    const cell = cellOf(def, state, frame);
    let above = 0;
    let total = 0;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (!isInk(cell, x, y)) continue;
        total++;
        if (y < def.tileY) above++;
      }
    }
    if (total === 0) continue;
    framesMeasured++;
    const share = above / total;
    if (share >= MIN_INK_ABOVE_ANCHOR) continue;
    fail(
      'L9',
      `${def.id} frame ${frame} paints ${(share * 100).toFixed(1)}% of its ink above its base ` +
        `anchor, under the ${(MIN_INK_ABOVE_ANCHOR * 100).toFixed(0)}% it is held to; the patch ` +
        'has sunk into the floor it is supposed to sit on',
    );
  }
  failUnlessMeasured('L9', framesMeasured, 'flame frames');
}

// ── L10 the rows the runtime asks for ────────────────────────────────────────

/**
 * The state name every draw wrapper in `src/sprites/lavaBallSprite.ts` passes,
 * checked in both directions: a name the wrapper builds and a figure does not
 * paint is an invisible effect and no log line, and a row a figure declares
 * that nothing draws is bake time and memory nobody spends.
 */
const DRAWN_STATES: ReadonlyArray<{ readonly def: FigureDef; readonly state: string }> = [
  { def: LLAMA_LAVA_BOLT_FIGURE, state: 'fly' },
  { def: LLAMA_LAVA_BURST_FIGURE, state: 'burst' },
  { def: LLAMA_LAVA_FLAME_FIGURE, state: 'burn' },
];

function gateDrawnStates(): void {
  failUnlessMeasured('L10', DRAWN_STATES.length, 'states the draw wrappers ask for');
  for (const { def, state } of DRAWN_STATES) {
    for (const failure of missingStateFailures(def, [state], `${def.id}'s draw wrapper`)) {
      fail('L10', failure);
    }
  }
  for (const def of LAVA_BALL_FIGURES) {
    for (const state of def.states.keys()) {
      if (DRAWN_STATES.some((drawn) => drawn.def === def && drawn.state === state)) continue;
      fail('L10', `${def.id} paints a "${state}" row that no draw wrapper ever asks for`);
    }
  }
}

// ── L11 warm-row budget ──────────────────────────────────────────────────────

const ROW_BUDGET_MEGABYTES = 6;

function gateWarmRows(): void {
  let figuresMeasured = 0;
  for (const def of LAVA_BALL_FIGURES) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    for (const [state, declared] of def.states) {
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    if (widestFrames === 0) {
      fail('L11', `${def.id} declares no state with frames in it`);
      continue;
    }
    figuresMeasured++;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  L11 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget`,
    );
    if (megabytes > ROW_BUDGET_MEGABYTES) {
      fail(
        'L11',
        `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
          `${ROW_BUDGET_MEGABYTES} MB`,
      );
    }
  }
  failUnlessMeasured('L11', figuresMeasured, 'figures for warm-row cost');
}

/** Runs every lava-ball gate and returns one message per failure. */
export function lavaBallGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateEdgeBleed();
  gateInkSpan();
  gateLoopsMove();
  gateLoopsClose();
  gateBurstMatchesBlast();
  gateFlameFootprint();
  gateBoltTrailsBehind();
  gateFlameRises();
  gateDrawnStates();
  gateWarmRows();
  return [...failures];
}
