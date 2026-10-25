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
 *   waits for the swing's own impact frame.
 */

import {
  HIGH_STRIKER_BELL_STRIKE_S,
  HIGH_STRIKER_CUT_FADE_S,
  HIGH_STRIKER_RING_THRESHOLD,
  highStrikerCutAtS,
  highStrikerPeakAtS,
  highStrikerPuckUp,
} from '../src/systems/circus/highStrikerTimeline.js';
import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { MINE_IMPACT_FRAME, MINE_TICKS_PER_FRAME } from '../src/sprites/art/human/actionsGather';
import { TICKS_PER_SECOND } from '../src/sprites/art/human/timing';
import { HighStrikerSystem } from '../src/systems/circus/HighStrikerSystem';
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
    now += 1 / TICKS_PER_SECOND;
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

console.log(
  `latest cut ends at ${latestCutEnd.toFixed(4)} s (power ${latestCutPower}); ` +
    `the bell sounds at ${HIGH_STRIKER_BELL_STRIKE_S} s`,
);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
  console.log(`\n${failures.length} high striker timing check(s) failed`);
  process.exit(1);
}
console.log('ok   every short swing is cut before the bell');
