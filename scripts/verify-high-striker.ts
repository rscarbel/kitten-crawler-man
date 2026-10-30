/**
 * Checks the high striker's timing against its recording, without a canvas:
 *
 *   npm run verify:high-striker
 *
 * - every swing short of the bell has its recording cut, and the cut's fade
 *   is over before the bell's onset in `high_striker_bell`;
 * - a stronger short swing peaks no sooner than a weaker one, so the
 *   strongest short swing bounds them all;
 * - a ringing swing is never cut, and its puck meets the bell on the onset;
 * - a short swing's puck peaks at a height proportional to its power;
 * - the human, walking as he locks the meter in, is set down on the striking spot
 *   without a stride: his swing is not ended as a walk-off, and the bell
 *   waits for the swing's own impact frame;
 * - with the nearer striking spot walkable but shut in, either crawler is set
 *   down on the far one instead and walks away from it after the swing;
 * - on grounds whose cliff ledges run up to the clearance band beside the
 *   striker, both striking spots are open ground joined to the forecourt.
 */

import {
  HIGH_STRIKER_BELL_STRIKE_S,
  HIGH_STRIKER_CUT_FADE_S,
  HIGH_STRIKER_RING_THRESHOLD,
  highStrikerCutAtS,
  highStrikerPeakAtS,
  highStrikerPuckUp,
} from '../src/systems/circus/highStrikerTimeline.js';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../src/core/constants';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { applyMovement } from '../src/systems/GameLoopPhases';
import { MINE_IMPACT_FRAME, MINE_TICKS_PER_FRAME } from '../src/sprites/art/human/actionsGather';
import { HighStrikerSystem, walksToForecourt } from '../src/systems/circus/HighStrikerSystem';
import { CIRCUS_TERRAIN_CLEARANCE_TILES } from '../src/map/overworld/circusGroundsLayout';
import { CLIFF } from '../src/map/tileTypes';
import { buildCircusSite } from './verifyCircusGrounds/site.js';
import {
  HIGH_STRIKER_PUCK,
  HIGH_STRIKER_PUCK_STRIKE_UP,
} from '../src/sprites/art/circusOverlayAnchors.js';

/** Powers sampled across the meter. */
const SAMPLES = 1000;
/** How close a measured height must come to the expected one, in tiles. */
const HEIGHT_TOLERANCE_TILES = 1e-6;

/** A hair under the ring threshold: the strongest swing that falls short, checked exactly. */
const JUST_SHORT = 1e-9;

const failures: string[] = [];
let latestCutEnd = 0;
let latestCutPower = 0;
let previousPeak = -Infinity;
const powers = Array.from({ length: SAMPLES + 1 }, (_unused, index) => index / SAMPLES);
powers.push(HIGH_STRIKER_RING_THRESHOLD - JUST_SHORT);
powers.sort((a, b) => a - b);
for (const power of powers) {
  const cut = highStrikerCutAtS(power);
  if (power >= HIGH_STRIKER_RING_THRESHOLD) {
    if (cut !== null) failures.push(`power ${power} rings but is cut at ${cut}`);
    if (highStrikerPeakAtS(power) !== HIGH_STRIKER_BELL_STRIKE_S) {
      failures.push(`power ${power} rings but peaks off the bell's onset`);
    }
    continue;
  }
  if (cut === null) {
    failures.push(`power ${power} falls short but is never cut`);
    continue;
  }
  const cutEnd = cut + HIGH_STRIKER_CUT_FADE_S;
  if (cutEnd > latestCutEnd) {
    latestCutEnd = cutEnd;
    latestCutPower = power;
  }
  if (cutEnd >= HIGH_STRIKER_BELL_STRIKE_S) {
    failures.push(`power ${power}: cut fades out at ${cutEnd.toFixed(4)} s, not before the bell`);
  }
  const peak = highStrikerPeakAtS(power);
  if (peak < previousPeak) failures.push(`power ${power} peaks sooner than a weaker swing`);
  previousPeak = peak;
  const track = HIGH_STRIKER_PUCK_STRIKE_UP - HIGH_STRIKER_PUCK.restUp;
  const expectedUp = HIGH_STRIKER_PUCK.restUp + track * power;
  if (Math.abs(highStrikerPuckUp(peak, power) - expectedUp) > HEIGHT_TOLERANCE_TILES) {
    failures.push(`power ${power}: puck peaks off its proportional height`);
  }
}

/** The seed whose grounds the swing is checked on, as `render:high-striker` renders. */
const SWING_SEED = 7919;
/** Meter ticks before the lock-in: past the press the meter swallows as a bounce. */
const METER_TICKS = 30;
/** Ticks from the lock-in to the mallet's bite on his pick swing. */
const IMPACT_TICK = MINE_IMPACT_FRAME * MINE_TICKS_PER_FRAME;
/** Ticks the swing is followed for: well past the bite. */
const FOLLOW_TICKS = IMPACT_TICK * 2;

function checkWalkingLockIn(): void {
  const site = buildCircusSite(SWING_SEED);
  if (typeof site === 'string') {
    failures.push(`seed ${SWING_SEED}: ${site}`);
    return;
  }
  const placed = site.map.circusGrounds?.structures.find(
    (structure) => structure.structure === 'high_striker',
  );
  if (placed === undefined) {
    failures.push(`seed ${SWING_SEED}: no high striker`);
    return;
  }
  let now = 0;
  const system = new HighStrikerSystem({ audio: null, clock: () => now });
  system.update(site.map, false);
  const human = new HumanPlayer(placed.rect.x, placed.rect.y + 1, TILE_SIZE);
  human.isActive = true;
  const tick = (): void => {
    now += 1 / WORLD_TICKS_PER_SECOND;
    human.tickTimers();
    system.update(site.map, false);
  };
  if (!system.tryInteract(human)) {
    failures.push('The human south of the striker could not raise its meter');
    return;
  }
  for (let index = 0; index < METER_TICKS; index++) tick();
  // A direction key held through the press: he reads as walking when he is set down.
  human.isMoving = true;
  const startX = human.x;
  system.claimPress(human);
  if (human.x === startX) failures.push('The human was not stepped to a striking spot');
  let struckOnTick: number | null = null;
  for (let index = 1; index <= FOLLOW_TICKS && struckOnTick === null; index++) {
    tick();
    if (system.latestImpactAt() !== null) struckOnTick = index;
  }
  if (struckOnTick === null) failures.push('a walking lock-in never struck');
  else if (struckOnTick < IMPACT_TICK) {
    failures.push(
      `a walking lock-in struck on tick ${struckOnTick}, before the impact frame on tick ${IMPACT_TICK}: the swing was ended as a walk-off`,
    );
  }
  console.log(
    `walking lock-in struck on tick ${struckOnTick ?? 'never'} (impact frame ${IMPACT_TICK})`,
  );
}
checkWalkingLockIn();

/**
 * A world seed whose escarpment runs up to the clearance band beside the
 * striker: a cliff ledge stands within {@link CLIFF_PAST_BAND_TILES} of the
 * band's outer edge, as {@link checkTerrainClearsStriker} confirms.
 */
const CLIFF_SEED = 1035485787;
/**
 * How far past the clearance band the seed's nearest cliff ledge may stand and
 * still count as running up to it.
 */
const CLIFF_PAST_BAND_TILES = 2;
/** Ticks a crawler is given to land the swing and walk off the spot: far past either swing. */
const WALK_AWAY_TICKS = FOLLOW_TICKS * 2;
/** Frames of held movement the walk off the striking spot is given. */
const WALK_FRAMES = 30;
/** The least distance, in tiles, a crawler walking off the spot must cover. */
const WALK_AWAY_MIN_TILES = 1;
const SHUT_IN_NEIGHBOURS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;

/**
 * Shuts in the striking spot west of the striker with blocked tiles on its
 * three open sides, so it stays walkable but leads nowhere. A crawler then
 * walks west from the tile south of the pad until the block south of the
 * pocket stops them, which leaves them nearer the shut-in spot than the open
 * one, and locks in.
 */
function checkShutInSpot(kind: 'human' | 'cat'): void {
  const site = buildCircusSite(SWING_SEED);
  if (typeof site === 'string') {
    failures.push(`seed ${SWING_SEED}: ${site}`);
    return;
  }
  const grounds = site.map.circusGrounds;
  const placed = grounds?.structures.find((structure) => structure.structure === 'high_striker');
  if (grounds === null || placed === undefined) {
    failures.push(`seed ${SWING_SEED}: no high striker`);
    return;
  }
  const pocket = { x: placed.rect.x - 1, y: placed.rect.y };
  const farSpot = { x: placed.rect.x + 1, y: placed.rect.y };
  if (
    !site.map.isWalkable(pocket.x, pocket.y, 'walker') ||
    !walksToForecourt(site.map, grounds, farSpot)
  ) {
    failures.push(`seed ${SWING_SEED}: both striking spots must start open for the shut-in check`);
    return;
  }
  for (const step of SHUT_IN_NEIGHBOURS) {
    site.map.blockTilePermanently(pocket.x + step.dx, pocket.y + step.dy);
  }
  if (
    !site.map.isWalkable(pocket.x, pocket.y, 'walker') ||
    walksToForecourt(site.map, grounds, pocket)
  ) {
    failures.push(
      `seed ${SWING_SEED}: the west striking spot is not a walkable dead end once shut in`,
    );
    return;
  }
  let now = 0;
  const system = new HighStrikerSystem({ audio: null, clock: () => now });
  system.update(site.map, false);
  const approach = { x: placed.rect.x, y: placed.rect.y + 1 };
  const crawler =
    kind === 'human'
      ? new HumanPlayer(approach.x, approach.y, TILE_SIZE)
      : new CatPlayer(approach.x, approach.y, TILE_SIZE);
  crawler.isActive = true;
  for (let index = 0; index < WALK_FRAMES; index++) {
    applyMovement(crawler, { dx: -1, dy: 0, isMobile: false }, site.map, 'waist');
  }
  crawler.isMoving = false;
  const crawlerToSpot = (spot: { readonly x: number; readonly y: number }): number =>
    Math.hypot(spot.x * TILE_SIZE - crawler.x, spot.y * TILE_SIZE - crawler.y);
  if (crawlerToSpot(pocket) >= crawlerToSpot(farSpot)) {
    failures.push(
      `the ${kind} walking west south of the striker never came nearer the shut-in spot`,
    );
    return;
  }
  const tick = (): void => {
    now += 1 / WORLD_TICKS_PER_SECOND;
    crawler.tickTimers();
    system.update(site.map, false);
  };
  if (!system.tryInteract(crawler)) {
    failures.push(`the ${kind} south of the striker could not raise its meter`);
    return;
  }
  for (let index = 0; index < METER_TICKS; index++) tick();
  system.claimPress(crawler);
  if (crawler.x === pocket.x * TILE_SIZE && crawler.y === pocket.y * TILE_SIZE) {
    failures.push(`the ${kind} was set down in a shut-in striking spot`);
    return;
  }
  if (crawler.x !== farSpot.x * TILE_SIZE || crawler.y !== farSpot.y * TILE_SIZE) {
    failures.push(`the ${kind} was not set down on the open striking spot east of the striker`);
  }
  for (let index = 0; index < WALK_AWAY_TICKS && system.holdsCrawler(crawler); index++) tick();
  if (system.holdsCrawler(crawler)) {
    failures.push(`the ${kind} was still held at the striker ${WALK_AWAY_TICKS} ticks on`);
    return;
  }
  const startY = crawler.y;
  for (let index = 0; index < WALK_FRAMES; index++) {
    applyMovement(crawler, { dx: 0, dy: 1, isMobile: false }, site.map, 'waist');
  }
  if (crawler.y - startY < WALK_AWAY_MIN_TILES * TILE_SIZE) {
    failures.push(`the ${kind} could not walk south off the striking spot`);
  }
}
checkShutInSpot('human');
checkShutInSpot('cat');

/**
 * Neither striking spot is lost to the terrain on grounds whose hillside runs
 * up to the striker: both walk out to the forecourt.
 */
function checkTerrainClearsStriker(): void {
  const site = buildCircusSite(CLIFF_SEED);
  if (typeof site === 'string') {
    failures.push(`seed ${CLIFF_SEED}: ${site}`);
    return;
  }
  const grounds = site.map.circusGrounds;
  const placed = grounds?.structures.find((structure) => structure.structure === 'high_striker');
  if (grounds === null || placed === undefined) {
    failures.push(`seed ${CLIFF_SEED}: no high striker`);
    return;
  }
  const nearestCliffTiles = nearestTileOfType(site.map.structure, CLIFF, placed.rect);
  const cliffReachTiles = CIRCUS_TERRAIN_CLEARANCE_TILES + CLIFF_PAST_BAND_TILES;
  if (nearestCliffTiles > cliffReachTiles) {
    failures.push(
      `seed ${CLIFF_SEED}: the nearest cliff ledge stands ${nearestCliffTiles.toFixed(1)} tiles from the striker, past ${cliffReachTiles}: pick a seed whose escarpment runs up to the grounds`,
    );
  }
  for (const side of [-1, 1] as const) {
    const spot = { x: placed.rect.x + side, y: placed.rect.y };
    if (!walksToForecourt(site.map, grounds, spot)) {
      failures.push(
        `seed ${CLIFF_SEED}: the striking spot at (${spot.x}, ${spot.y}) is blocked or cut off from the forecourt`,
      );
    }
  }
}
checkTerrainClearsStriker();

/**
 * Straight-line distance, in tiles, from `from` to the nearest tile of `type`;
 * Infinity when there is none.
 */
function nearestTileOfType(
  structure: ReadonlyArray<ReadonlyArray<{ readonly type: number }>>,
  type: number,
  from: { readonly x: number; readonly y: number },
): number {
  let nearest = Infinity;
  structure.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile.type === type) nearest = Math.min(nearest, Math.hypot(x - from.x, y - from.y));
    });
  });
  return nearest;
}

console.log(
  `latest cut ends at ${latestCutEnd.toFixed(4)} s (power ${latestCutPower}); ` +
    `the bell sounds at ${HIGH_STRIKER_BELL_STRIKE_S} s`,
);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
  console.log(`\n${failures.length} high striker check(s) failed`);
  process.exit(1);
}
console.log('ok   every short swing is cut before the bell');
