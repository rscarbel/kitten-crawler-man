/**
 * The Magic Missile art gates.
 *
 * The two sheets are gone, so every invariant the old bake enforced by throwing
 * — and the ones it only enforced by being looked at — is enforced here against
 * cells painted from `MAGIC_MISSILE_PROJECTILE_FIGURE` and
 * `MAGIC_MISSILE_EXPLOSION_FIGURE`, baked exactly the way the runtime cache
 * bakes them.
 *
 * The spell's whole design is that four level bands escalate and the fifteenth
 * level breaks the pattern, so most of what is worth asserting is about the
 * bands: that the runtime can still name every one of them, that the blast a
 * band paints matches the damage that band deals, and that the warm palette
 * belongs to level 15 alone.
 *
 * Failures accumulate rather than throwing one at a time. A gate that cannot
 * find what it measures fails loudly, and so does one whose filtered loop
 * examined nothing.
 *
 * Run by the review harness: `npm run render:magic-missile`.
 */

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_FIGURES,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from '../src/sprites/art/magicMissileFigure.js';
import { projectilePhase } from '../src/sprites/art/magicMissileArt.js';
import {
  MAGIC_MISSILE_DEF,
  getMagicMissileStats,
  getMagicMissileVisualTier,
} from '../src/abilities/magicMissile.js';
import { SUB_MISSILE_VARIANT } from '../src/sprites/catSprite.js';
import { MISSILE_SPLASH_RADIUS_TILES } from '../src/systems/CombatSystem.js';

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const RED_OFFSET = 0;
const BLUE_OFFSET = 2;
const INK_ALPHA_THRESHOLD = 24;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_ALPHA = 255;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/** Fails a gate whose filtered loop ran zero times. */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

interface Cell {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

const cellCache = new Map<string, Cell>();

/** One cell's RGBA, baked the way the runtime cache bakes it. */
function cellOf(def: FigureDef, state: string, frame: number): Cell {
  const key = `${def.id}/${state}[${frame}]`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const { frameWidth, frameHeight } = def;
  const baked = bakeFigureCell(def, state, frame);
  const { data } = baked.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const cell: Cell = { pixels: data, width: frameWidth, height: frameHeight };
  cellCache.set(key, cell);
  return cell;
}

function alphaAt(cell: Cell, x: number, y: number): number {
  return cell.pixels[(y * cell.width + x) * CHANNELS + ALPHA_OFFSET];
}

/** Share of pixels whose ink state differs between two cells. */
function frameDelta(a: Cell, b: Cell): number {
  let differing = 0;
  const count = a.width * a.height;
  for (let i = 0; i < count; i++) {
    const inkedA = a.pixels[i * CHANNELS + ALPHA_OFFSET] >= INK_ALPHA_THRESHOLD;
    const inkedB = b.pixels[i * CHANNELS + ALPHA_OFFSET] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
  }
  return differing / count;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ── M1 structure ─────────────────────────────────────────────────────────────

/**
 * The shared structural gates over both figures: every declared band paints
 * every declared frame, nothing is clipped by the cell wall, and neither cell is
 * mostly empty.
 *
 * The projectile's cell is wide because its anchor sits near the leading edge
 * and the tail streams the other way, so the widest band fills three quarters
 * of it rather than all of it — neither figure needs a fill exemption.
 */
function gateStructure(): void {
  let figuresMeasured = 0;
  for (const def of MAGIC_MISSILE_FIGURES) {
    figuresMeasured++;
    for (const failure of figureStructuralFailures(def, {
      blankFrames: BLANK_FRAMES.get(def.id),
    })) {
      fail('M1', failure);
    }
  }
  failUnlessMeasured('M1', figuresMeasured, 'figures');
}

/**
 * The one frame in either figure that legitimately paints nothing: the level-1
 * blast is the only band with no smoke, no embers and no shards, so by the last
 * tenth of its life every layer it does have has faded under the threshold
 * below which painting is a solid smear rather than a dim glow.
 *
 * Declared both ways by the shared gate — a frame named here that paints ink
 * fails as loudly as an undeclared frame that paints none — so the exemption
 * cannot quietly grow to cover a NaN.
 */
const FADED_TO_NOTHING_BAND = 'tier1';

function lastFrameOf(def: FigureDef, state: string): ReadonlySet<number> {
  const frames = def.states.get(state)?.frames ?? 0;
  return new Set(frames > 0 ? [frames - 1] : []);
}

const BLANK_FRAMES = new Map<string, ReadonlyMap<string, ReadonlySet<number>>>([
  [
    MAGIC_MISSILE_EXPLOSION_FIGURE.id,
    new Map([
      [FADED_TO_NOTHING_BAND, lastFrameOf(MAGIC_MISSILE_EXPLOSION_FIGURE, FADED_TO_NOTHING_BAND)],
    ]),
  ],
]);

// ── M2 the cell wall ─────────────────────────────────────────────────────────

/**
 * Alpha a frame's outermost pixels may carry, ported from the bake this
 * replaces. Anything above it means the art ran into the cell wall and was cut
 * along a straight line; the bolt is drawn rotated, so such a cut sweeps around
 * with it and is impossible to miss in motion.
 *
 * Kept alongside the shared clipping gate rather than folded into it: this one
 * is about a soft bloom lapping the wall at an alpha the shared gate's ink
 * cutoff would not even count as ink.
 */
const MAX_EDGE_ALPHA = 6;

function gateNoEdgeBleed(): void {
  let framesMeasured = 0;
  for (const def of MAGIC_MISSILE_FIGURES) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const cell = cellOf(def, state, frame);
        let worst = 0;
        for (let x = 0; x < cell.width; x++) {
          worst = Math.max(worst, alphaAt(cell, x, 0), alphaAt(cell, x, cell.height - 1));
        }
        for (let y = 0; y < cell.height; y++) {
          worst = Math.max(worst, alphaAt(cell, 0, y), alphaAt(cell, cell.width - 1, y));
        }
        if (worst > MAX_EDGE_ALPHA) {
          fail(
            'M2',
            `${def.id}.${state}[${frame}] paints its own border at alpha ${worst} (limit ` +
              `${MAX_EDGE_ALPHA}); the art is clipped by the cell. Shrink the layer or grow ` +
              'the frame envelope.',
          );
        }
      }
    }
  }
  failUnlessMeasured('M2', framesMeasured, 'frames for edge bleed');
}

// ── M3 the bands the runtime can ask for ─────────────────────────────────────

/**
 * Every band name the runtime can reach, derived the way the runtime derives
 * it: one walk of every level the ability can be at, plus the shrapnel's own
 * row. Written as a walk rather than as a list so renaming a tier shows up
 * here instead of silently dropping out of both sides of the comparison.
 */
function reachableVariants(): string[] {
  const names = new Set<string>();
  for (let level = 1; level <= MAGIC_MISSILE_DEF.maxLevel; level++) {
    names.add(getMagicMissileVisualTier(level));
  }
  names.add(SUB_MISSILE_VARIANT);
  return [...names];
}

/**
 * Both directions. A name the runtime builds and a figure does not paint is an
 * invisible missile and no log line; a row a figure declares and the runtime can
 * never ask for is memory and bake time nobody spends usefully.
 */
function gateVariantNames(): void {
  const reachable = reachableVariants();
  failUnlessMeasured('M3', reachable.length, 'variant names the runtime can reach');
  for (const def of MAGIC_MISSILE_FIGURES) {
    for (const failure of missingStateFailures(def, reachable, `${def.id}'s draw calls`)) {
      fail('M3', failure);
    }
    for (const state of def.states.keys()) {
      if (reachable.includes(state)) continue;
      fail(
        'M3',
        `${def.id} paints a "${state}" row that no ability level and no sub-missile ever ` +
          'asks for',
      );
    }
  }
}

// ── M4 the bolt's loop closes ────────────────────────────────────────────────

/**
 * How far the wrap from the last frame back to the first may exceed the row's
 * *largest* ordinary step.
 *
 * Against the largest rather than the second-largest or the median: a bolt's
 * braid moves a different amount on every frame, so a median-relative limit is
 * swamped by the high-motion tiers, and dropping the largest step from the
 * comparison only widens a band that is already the loosest thing here.
 * Re-measured over all five shipped rows, whose wraps run 0.81x, 0.89x, 0.91x,
 * 0.97x and 1.07x their largest ordinary step; the limit sits 12% above the
 * worst of them.
 *
 * What this catches is a cycle that stops *short* of closing. An overrunning
 * one it cannot catch and no pixel threshold would: the metric is the share of
 * the cell whose ink state changed, and a bolt's braid decorrelates completely
 * within about a third of a turn, so past that the wrap and an ordinary step
 * measure the same saturated number. `gatePhaseCoverage` is the ceiling for
 * that half of the failure mode, and the floor below for the other.
 */
const SEAM_VS_LARGEST_LIMIT = 1.2;
/**
 * How far *short* of the row's median step the wrap may fall.
 *
 * A ceiling alone is passed by a cycle that does not turn over at all: sampling
 * the phase at `frame / (frames - 1)` makes the last frame identical to the
 * first, the wrap goes to zero, and the row spends a whole frame held still.
 * The shipped rows wrap at 0.93x to 1.62x their median step, so a floor at 0.6
 * clears every one of them and still catches a stalled seam. Against the median
 * rather than the narrowest step, because a row may legitimately hold two
 * adjacent frames still, which would collapse the floor into `wrap >= 0`.
 */
const SEAM_VS_MEDIAN_FLOOR = 0.6;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

/**
 * The ceiling in the units the defect is actually in: the bolt's spin mapping
 * spends exactly one turn over the row's declared frames, in equal steps, so
 * the frame after the last lands on the first.
 */
function gatePhaseCoverage(state: string, frames: number): void {
  const turns = projectilePhase(frames) - projectilePhase(0);
  if (Math.abs(turns - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'M4',
      `${state} spins ${turns.toFixed(4)} of a turn over its ${frames} frames rather than ` +
        'exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = projectilePhase(1) - projectilePhase(0);
  let stepsMeasured = 0;
  for (let frame = 1; frame < frames; frame++) {
    stepsMeasured++;
    const step = projectilePhase(frame) - projectilePhase(frame - 1);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'M4',
      `${state} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled spin stutters`,
    );
  }
  failUnlessMeasured('M4', stepsMeasured, `phase steps of ${state}`);
}

function gateBoltLoops(): void {
  let rowsMeasured = 0;
  for (const [state, declared] of MAGIC_MISSILE_PROJECTILE_FIGURE.states) {
    const cells = Array.from({ length: declared.frames }, (_unused, frame) =>
      cellOf(MAGIC_MISSILE_PROJECTILE_FIGURE, state, frame),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length < 2) {
      fail('M4', `${state} has ${steps.length} steps, too few to judge a loop by`);
      continue;
    }
    rowsMeasured++;
    gatePhaseCoverage(state, declared.frames);
    const largest = Math.max(...steps);
    const typical = median(steps);
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const ceiling = largest * SEAM_VS_LARGEST_LIMIT;
    const floor = typical * SEAM_VS_MEDIAN_FLOOR;
    console.log(
      `  M4 ${state}: wrap ${(seam * 100).toFixed(3)}% of the cell, median step ` +
        `${(typical * 100).toFixed(3)}%, largest ${(largest * 100).toFixed(3)}%`,
    );
    if (seam > ceiling) {
      fail(
        'M4',
        `${state} pops once per cycle: the wrap is ${(seam * 100).toFixed(3)}% of the cell ` +
          `against a largest step of ${(largest * 100).toFixed(3)}% (limit ` +
          `${(ceiling * 100).toFixed(3)}%)`,
      );
    }
    if (seam < floor) {
      fail(
        'M4',
        `${state} holds still across its wrap: it is ${(seam * 100).toFixed(3)}% of the cell ` +
          `against a median step of ${(typical * 100).toFixed(3)}% (floor ` +
          `${(floor * 100).toFixed(3)}%), so the cycle does not turn over`,
      );
    }
  }
  failUnlessMeasured('M4', rowsMeasured, 'looping bolt rows');
}

// ── M5 the blast against the damage it deals ─────────────────────────────────

/**
 * How far past the splash radius the level-15 blast may reach.
 *
 * Level 15 is the one tier allowed past it at all — it is the blast that also
 * fires a death shockwave, so light beyond the splash is light the player is
 * about to be given a reason for. Every other band paints light only where the
 * splash actually lands.
 */
const FULL_POWER_OVERREACH_TILES = 0.1;
/**
 * The share of the splash radius a *splashing* band's blast must cover. A blast
 * drawn well inside the radius it damages out to teaches the player to stand
 * somewhere that hurts.
 */
const MIN_SPLASH_COVERAGE = 0.8;
/**
 * How far a band that does *not* splash may paint its blast, in tiles.
 *
 * Judging every band against the splash radius made the ceiling vacuous for the
 * bands that have no splash: a level-1 blast painted out to the full 1.5 tiles
 * would have passed the very check whose stated purpose is that a blast must
 * not promise damage it does not deal. A single-target hit belongs to the tile
 * it lands on; the shipped ones reach 0.95 (tier1) and 0.83 (the shrapnel),
 * which this clears by a fifth while still failing a blast drawn at splash
 * size.
 */
const SINGLE_TARGET_BLAST_CEILING_TILES = 1.15;

/**
 * The bands whose ability level is high enough to splash at all, read out of
 * the ability's own stat table rather than restated as a level number here.
 */
function splashingVariants(): string[] {
  const names = new Set<string>();
  for (let level = 1; level <= MAGIC_MISSILE_DEF.maxLevel; level++) {
    if (!getMagicMissileStats(level).hasAoeSplash) continue;
    names.add(getMagicMissileVisualTier(level));
  }
  return [...names];
}

function fullPowerVariant(): string {
  return getMagicMissileVisualTier(MAGIC_MISSILE_DEF.maxLevel);
}

/** The blast's furthest ink from the impact point, in tiles. */
function blastReachTiles(state: string, frames: number): number {
  const def = MAGIC_MISSILE_EXPLOSION_FIGURE;
  let reach = 0;
  for (let frame = 0; frame < frames; frame++) {
    const cell = cellOf(def, state, frame);
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (alphaAt(cell, x, y) < INK_ALPHA_THRESHOLD) continue;
        reach = Math.max(reach, Math.hypot(x + 0.5 - def.tileX, y + 0.5 - def.tileY));
      }
    }
  }
  return reach / def.tileScale;
}

function blastCeilingTiles(
  state: string,
  fullPower: string,
  splashing: ReadonlySet<string>,
): number {
  if (state === fullPower) return MISSILE_SPLASH_RADIUS_TILES + FULL_POWER_OVERREACH_TILES;
  if (splashing.has(state)) return MISSILE_SPLASH_RADIUS_TILES;
  return SINGLE_TARGET_BLAST_CEILING_TILES;
}

function gateBlastMatchesSplash(): void {
  const splashing = new Set(splashingVariants());
  const fullPower = fullPowerVariant();
  let statesMeasured = 0;
  for (const [state, declared] of MAGIC_MISSILE_EXPLOSION_FIGURE.states) {
    statesMeasured++;
    const reach = blastReachTiles(state, declared.frames);
    const ceiling = blastCeilingTiles(state, fullPower, splashing);
    console.log(
      `  M5 ${state}: blast reaches ${reach.toFixed(3)} tiles against a ` +
        `${MISSILE_SPLASH_RADIUS_TILES}-tile splash (ceiling ${ceiling.toFixed(3)})`,
    );
    if (reach > ceiling) {
      fail(
        'M5',
        `${state} paints light out to ${reach.toFixed(3)} tiles against a ceiling of ` +
          `${ceiling.toFixed(3)}; the blast promises damage it does not deal`,
      );
    }
    if (!splashing.has(state)) continue;
    const floor = MISSILE_SPLASH_RADIUS_TILES * MIN_SPLASH_COVERAGE;
    if (reach < floor) {
      fail(
        'M5',
        `${state} splashes out to ${MISSILE_SPLASH_RADIUS_TILES} tiles but paints only ` +
          `${reach.toFixed(3)}, so ${(MISSILE_SPLASH_RADIUS_TILES - reach).toFixed(3)} tiles of ` +
          `live damage look like clean floor (floor ${floor.toFixed(3)})`,
      );
    }
  }
  failUnlessMeasured('M5', statesMeasured, 'blast states');
}

// ── M6 the level-15 tell ─────────────────────────────────────────────────────

/**
 * Mean red-minus-blue over a cell's ink. The whole point of the fourth band is
 * that it leaves the violet family, so this separates it from every other band
 * by a wide margin in both figures — the shipped art measures +127 for it
 * against -30 or colder for the rest.
 */
function warmth(def: FigureDef, state: string, frame: number): number {
  const cell = cellOf(def, state, frame);
  let red = 0;
  let blue = 0;
  let counted = 0;
  const pixels = cell.width * cell.height;
  for (let i = 0; i < pixels; i++) {
    if (cell.pixels[i * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) continue;
    red += cell.pixels[i * CHANNELS + RED_OFFSET];
    blue += cell.pixels[i * CHANNELS + BLUE_OFFSET];
    counted++;
  }
  if (counted === 0) return 0;
  return (red - blue) / counted;
}

/**
 * How warm the level-15 band must read, and how cool every other band must
 * stay. Two thresholds with a gap between them rather than one at zero: the
 * claim is that the palettes are different *families*, and a band drifting to
 * neutral is the failure this is about.
 */
const FULL_POWER_MIN_WARMTH = 40;
const LOWER_BAND_MAX_WARMTH = -10;

function gatePaletteBreak(): void {
  const fullPower = fullPowerVariant();
  let bandsMeasured = 0;
  for (const def of MAGIC_MISSILE_FIGURES) {
    for (const [state] of def.states) {
      bandsMeasured++;
      const measured = warmth(def, state, 0);
      if (state === fullPower) {
        if (measured < FULL_POWER_MIN_WARMTH) {
          fail(
            'M6',
            `${def.id}.${state} reads ${measured.toFixed(1)} on red-minus-blue, under the ` +
              `${FULL_POWER_MIN_WARMTH} the level-15 palette break is held to — the last level ` +
              'no longer changes family',
          );
        }
        continue;
      }
      if (measured > LOWER_BAND_MAX_WARMTH) {
        fail(
          'M6',
          `${def.id}.${state} reads ${measured.toFixed(1)} on red-minus-blue, warmer than the ` +
            `${LOWER_BAND_MAX_WARMTH} the violet family is held to — it is encroaching on the ` +
            'level-15 tell',
        );
      }
    }
  }
  failUnlessMeasured('M6', bandsMeasured, 'bands for palette family');
}

// ── M7 no dropped `rgba()` ───────────────────────────────────────────────────

/**
 * Share of a cell's alpha budget a frame may fill.
 *
 * This is the tripwire for a computed alpha reaching exponent notation. Node's
 * canvas parses `rgba(…, 5e-17)` as *opaque* rather than as invisible, so a
 * gradient stop or a fill authored to vanish paints at full strength instead
 * and the frame becomes a solid smear of whatever colour was fading out. Both
 * figures are almost entirely thin additive glow — the heaviest shipped frame
 * fills under a quarter of its cell's alpha — so a limit at 40% clears the
 * shipped art comfortably while a dropped stop on either figure's main glow
 * takes it to 70% or more.
 *
 * Measured as summed alpha rather than as a count of opaque pixels: the smear
 * arrives through a gradient and through `globalAlpha`, so it shows up as a
 * cell that is uniformly far too solid rather than as a patch of 255s.
 */
const MAX_INK_MASS_SHARE = 0.4;

function gateNoDroppedAlpha(): void {
  let framesMeasured = 0;
  for (const def of MAGIC_MISSILE_FIGURES) {
    for (const [state, declared] of def.states) {
      for (let frame = 0; frame < declared.frames; frame++) {
        framesMeasured++;
        const cell = cellOf(def, state, frame);
        const pixels = cell.width * cell.height;
        let mass = 0;
        for (let i = 0; i < pixels; i++) mass += cell.pixels[i * CHANNELS + ALPHA_OFFSET];
        const share = mass / (pixels * MAX_ALPHA);
        if (share > MAX_INK_MASS_SHARE) {
          fail(
            'M7',
            `${def.id}.${state}[${frame}] fills ${(share * 100).toFixed(1)}% of its cell's alpha ` +
              `against a ${(MAX_INK_MASS_SHARE * 100).toFixed(0)}% limit — an additive effect ` +
              'that solid is a colour whose alpha was written in exponent notation and parsed ' +
              'as opaque',
          );
        }
      }
    }
  }
  failUnlessMeasured('M7', framesMeasured, 'frames for solidity');
}

// ── M8 warm-row budget ───────────────────────────────────────────────────────

/**
 * The widest warm row's memory, reported whether or not it passes. A painted
 * figure is admitted to the cache one row at a time, so the number that decides
 * whether it fits is its widest row's bytes rather than the sum of every row.
 */
const ROW_BUDGET_MEGABYTES = 6;

function reportWarmRow(def: FigureDef): void {
  const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of def.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('M8', statesMeasured, `states of ${def.id}`);
  if (statesMeasured === 0) return;
  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  M8 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} bands warm at once would be ` +
      `${allWarm.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'M8',
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

/** Runs every Magic Missile gate and returns one message per failure. */
export function magicMissileGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateNoEdgeBleed();
  gateVariantNames();
  gateBoltLoops();
  gateBlastMatchesSplash();
  gatePaletteBreak();
  gateNoDroppedAlpha();
  for (const def of MAGIC_MISSILE_FIGURES) reportWarmRow(def);
  return [...failures];
}
