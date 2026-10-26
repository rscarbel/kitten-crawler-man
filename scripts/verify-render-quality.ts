#!/usr/bin/env tsx
/**
 * Headless gate for `RenderQualityController`'s lag ladder and starting tier.
 *
 *  - Breached windows of synthetic frame intervals walk the ladder one rung
 *    per window, each judged on a fresh window: paint-bound windows take
 *    variety rungs, the others the render scale then scenery detail, and the
 *    other kind once the preferred kind is used up.
 *  - Hidden-tab and loading-cover frames never count towards a window, nor
 *    do the repaint frames just after a canvas recovery.
 *  - `sharp` never steps on lag; `performance` gives up only variety.
 *  - The starting tier follows the device's memory scale and the preset, and
 *    only ever lowers the tier.
 *
 * The controller runs against a stand-in canvas owner and environment, and
 * every frame carries an invented cost, so nothing here is a timing.
 *
 *   npm run verify:render-quality
 */

import type { FrameCost } from '../src/core/perf/frameCost.js';
import {
  PAINT_BOUND_SHARE,
  PERFORMANCE_PRESET_VARIETY_TIER,
  PROBE_SAMPLE_MS,
  PROBE_WARMUP_FRAMES,
  RECOVERY_SETTLE_MS,
  RenderQualityController,
  SAFETY_NET_WINDOW_MS,
  STUTTER_INTERVAL_MS,
  startingVarietyTier,
} from '../src/core/perf/RenderQuality.js';
import {
  MAX_SHARP_RENDER_SCALE,
  PERFORMANCE_RENDER_SCALE,
  type QualityPreset,
} from '../src/core/input/Settings.js';
import { FULL_SCALE, HALF_DENSITY_SCALE } from '../src/core/perf/deviceMemoryBudget.js';
import {
  FULL_VARIETY_TIER,
  LEAN_VARIETY_TIER,
  MINIMAL_VARIETY_TIER,
  SHARED_LOOKS_TIER,
  TRIMMED_VARIETY_TIER,
  forceVarietyTier,
  varietyTier,
} from '../src/core/perf/varietyTier.js';

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

/** Comfortably past the stutter threshold, and far above the throttled-rAF floor. */
const BREACH_INTERVAL_MS = STUTTER_INTERVAL_MS * 2;
/** Comfortably inside the budget. */
const SMOOTH_INTERVAL_MS = STUTTER_INTERVAL_MS / 2;
/** How far either side of the paint-bound threshold a window's bake share sits. */
const SHARE_MARGIN = 0.01;
const PAINT_BOUND_BAKE_MS = BREACH_INTERVAL_MS * PAINT_BOUND_SHARE * (1 + SHARE_MARGIN);
const UPDATE_BOUND_BAKE_MS = BREACH_INTERVAL_MS * PAINT_BOUND_SHARE * (1 - SHARE_MARGIN);
/** Frames a fresh window may run past its length before it must have been judged. */
const JUDGEMENT_SLACK_FRAMES = 2;
const WINDOW_DEADLINE_MS = SAFETY_NET_WINDOW_MS + JUDGEMENT_SLACK_FRAMES * BREACH_INTERVAL_MS;
const PROBE_SPAN_MS = PROBE_SAMPLE_MS + JUDGEMENT_SLACK_FRAMES * BREACH_INTERVAL_MS;
/** Windows played past the end of the ladder, to see that nothing more is taken. */
const WINDOWS_PAST_THE_END = 2;
/** Long enough that a window that should never close would have closed several times. */
const IGNORED_SPAN_MS = SAFETY_NET_WINDOW_MS * 3;
const HALF_WINDOW_MS = SAFETY_NET_WINDOW_MS / 2;
/** A memory scale below half, like a small phone's. */
const BELOW_HALF_SCALE = HALF_DENSITY_SCALE / 2;

type RungEvent = 'variety' | 'scale' | 'detail';

interface LadderState {
  readonly tier: number;
  readonly scale: number;
  readonly fullDetail: boolean;
}

class Harness {
  readonly controller: RenderQualityController;
  renderScale: number = PERFORMANCE_RENDER_SCALE;
  preset: QualityPreset;
  hidden = false;
  deviceMemoryScale: number;
  now = 0;
  private readonly recoveryHandlers: (() => void)[] = [];

  constructor(preset: QualityPreset, deviceMemoryScale: number = FULL_SCALE) {
    this.preset = preset;
    this.deviceMemoryScale = deviceMemoryScale;
    this.controller = new RenderQualityController({
      preset: () => this.preset,
      storePreset: (next) => {
        this.preset = next;
      },
      documentHidden: () => this.hidden,
      deviceMemoryScale: () => this.deviceMemoryScale,
      sharpRenderScale: () => MAX_SHARP_RENDER_SCALE,
      subscribeCanvasRecovery: (handler) => {
        this.recoveryHandlers.push(handler);
      },
    });
    this.controller.attach(this);
  }

  recoverCanvases(): void {
    for (const handler of this.recoveryHandlers) handler();
  }

  setRenderScale(scale: number): void {
    this.renderScale = scale;
  }

  state(): LadderState {
    return { tier: varietyTier(), scale: this.renderScale, fullDetail: this.controller.fullDetail };
  }

  frame(intervalMs: number, bakeMs: number): RungEvent | null {
    const before = this.state();
    this.now += intervalMs;
    const cost: FrameCost = { updateMs: 0, renderMs: 0, bakeMs };
    this.controller.recordFrame(this.now, cost);
    return rungBetween(before, this.state());
  }

  /** Every rung taken while playing `spanMs` of identical frames. */
  play(spanMs: number, intervalMs: number, bakeMs: number): RungEvent[] {
    const events: RungEvent[] = [];
    const endsAt = this.now + spanMs;
    while (this.now < endsAt) {
      const event = this.frame(intervalMs, bakeMs);
      if (event !== null) events.push(event);
    }
    return events;
  }

  /** Arms the safety net: a level entry, a passing probe, then one hidden frame to open a fresh window. */
  enterLevel(): void {
    this.controller.requestProbe();
    this.frame(SMOOTH_INTERVAL_MS, 0);
    const probeSpanMs = PROBE_WARMUP_FRAMES * SMOOTH_INTERVAL_MS + PROBE_SAMPLE_MS;
    this.play(probeSpanMs + SMOOTH_INTERVAL_MS, SMOOTH_INTERVAL_MS, 0);
    this.resync();
  }

  resync(): void {
    this.hidden = true;
    this.frame(SMOOTH_INTERVAL_MS, 0);
    this.hidden = false;
  }

  /** Plays breached frames until a rung is taken or a window's deadline passes. */
  breachWindow(paintBound: boolean): { event: RungEvent | null; elapsedMs: number } {
    const bakeMs = paintBound ? PAINT_BOUND_BAKE_MS : UPDATE_BOUND_BAKE_MS;
    const startedAt = this.now;
    while (this.now - startedAt < WINDOW_DEADLINE_MS) {
      const event = this.frame(BREACH_INTERVAL_MS, bakeMs);
      if (event !== null) return { event, elapsedMs: this.now - startedAt };
    }
    return { event: null, elapsedMs: this.now - startedAt };
  }
}

function rungBetween(before: LadderState, after: LadderState): RungEvent | null {
  if (after.tier !== before.tier) return 'variety';
  if (after.scale !== before.scale) return 'scale';
  if (after.fullDetail !== before.fullDetail) return 'detail';
  return null;
}

/** The rung the ladder's rule says a breached window takes from `state`. */
function expectedRung(
  state: LadderState,
  preset: QualityPreset,
  paintBound: boolean,
  varietyPinned: boolean,
): RungEvent | null {
  const renderRung: RungEvent | null =
    preset !== 'auto'
      ? null
      : state.scale > PERFORMANCE_RENDER_SCALE
        ? 'scale'
        : state.fullDetail
          ? 'detail'
          : null;
  const varietyRung: RungEvent | null =
    preset !== 'sharp' && !varietyPinned && state.tier < MINIMAL_VARIETY_TIER ? 'variety' : null;
  return paintBound ? (varietyRung ?? renderRung) : (renderRung ?? varietyRung);
}

const RENDER_RUNGS = 2;
const VARIETY_RUNGS = MINIMAL_VARIETY_TIER - FULL_VARIETY_TIER;

/**
 * Plays breached windows of the given kinds in turn until the ladder is
 * exhausted and a few windows past it, checking each window takes exactly the
 * rung the rule names, on a window of its own.
 */
function walkLadder(
  label: string,
  harness: Harness,
  kinds: (index: number) => boolean,
  varietyPinned = false,
): RungEvent[] {
  const taken: RungEvent[] = [];
  const windows = RENDER_RUNGS + VARIETY_RUNGS + WINDOWS_PAST_THE_END;
  let wrongRung = '';
  let staleWindow = '';
  for (let index = 0; index < windows; index++) {
    const paintBound = kinds(index);
    const expected = expectedRung(harness.state(), harness.preset, paintBound, varietyPinned);
    const { event, elapsedMs } = harness.breachWindow(paintBound);
    if (event !== expected && wrongRung === '') {
      wrongRung = `window ${index} (${paintBound ? 'paint' : 'update'}-bound) took ${event ?? 'nothing'}, expected ${expected ?? 'nothing'}`;
    }
    if (event !== null) {
      taken.push(event);
      if (elapsedMs < SAFETY_NET_WINDOW_MS && staleWindow === '') {
        staleWindow = `window ${index} was judged ${elapsedMs.toFixed(0)} ms after the last`;
      }
    }
  }
  check(
    wrongRung === '',
    `${label}: every window takes the rule's rung${wrongRung === '' ? '' : ` — ${wrongRung}`}`,
  );
  check(
    staleWindow === '',
    `${label}: every rung is judged on a fresh ${SAFETY_NET_WINDOW_MS} ms window${staleWindow === '' ? '' : ` — ${staleWindow}`}`,
  );
  return taken;
}

function freshHarness(preset: QualityPreset, deviceMemoryScale: number = FULL_SCALE): Harness {
  forceVarietyTier(FULL_VARIETY_TIER);
  return new Harness(preset, deviceMemoryScale);
}

function countOf(events: RungEvent[], kind: RungEvent): number {
  return events.filter((event) => event === kind).length;
}

console.log('\n── The lag ladder under auto');
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  const taken = walkLadder('paint-bound windows', harness, () => true);
  check(
    taken.slice(0, VARIETY_RUNGS).every((event) => event === 'variety'),
    `the first ${VARIETY_RUNGS} paint-bound breaches take variety rungs (${taken.join(', ')})`,
  );
  check(
    taken.slice(VARIETY_RUNGS).join(',') === 'scale,detail',
    'once variety runs out they take the render scale, then detail',
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  const taken = walkLadder('update-bound windows', harness, () => false);
  check(
    taken.slice(0, RENDER_RUNGS).join(',') === 'scale,detail',
    `update-bound breaches take the render scale, then detail first (${taken.join(', ')})`,
  );
  check(
    countOf(taken.slice(RENDER_RUNGS), 'variety') === VARIETY_RUNGS,
    `once those run out they take every variety rung down to ${MINIMAL_VARIETY_TIER}`,
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  const taken = walkLadder('alternating windows', harness, (index) => index % 2 === 0);
  check(
    taken.length === RENDER_RUNGS + VARIETY_RUNGS,
    `alternating windows take all ${RENDER_RUNGS + VARIETY_RUNGS} rungs and no more (${taken.length})`,
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  const smooth = harness.play(IGNORED_SPAN_MS, SMOOTH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  check(smooth.length === 0, `windows within budget take no rung (${smooth.length} taken)`);
}

console.log('\n── The level-entry probe');
{
  const harness = freshHarness('auto');
  harness.controller.requestProbe();
  harness.play(PROBE_WARMUP_FRAMES * SMOOTH_INTERVAL_MS, SMOOTH_INTERVAL_MS, 0);
  const probed = harness.play(PROBE_SPAN_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  check(
    probed.join(',') === 'variety',
    `a paint-bound breach in the probe takes a variety rung (${probed.join(', ') || 'nothing'})`,
  );
}
{
  const harness = freshHarness('auto');
  harness.controller.requestProbe();
  harness.play(PROBE_WARMUP_FRAMES * SMOOTH_INTERVAL_MS, SMOOTH_INTERVAL_MS, 0);
  const probed = harness.play(PROBE_SPAN_MS, BREACH_INTERVAL_MS, UPDATE_BOUND_BAKE_MS);
  check(
    probed.join(',') === 'scale',
    `an update-bound breach in the probe takes the render scale (${probed.join(', ') || 'nothing'})`,
  );
}

console.log('\n── Frames that never count');
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  harness.play(HALF_WINDOW_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.hidden = true;
  const whileHidden = harness.play(IGNORED_SPAN_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.hidden = false;
  check(whileHidden.length === 0, `a hidden tab takes no rung (${whileHidden.length} taken)`);
  const { event, elapsedMs } = harness.breachWindow(true);
  check(
    event !== null && elapsedMs >= SAFETY_NET_WINDOW_MS,
    `after the tab shows again a whole fresh window is needed (rung after ${elapsedMs.toFixed(0)} ms)`,
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  harness.play(HALF_WINDOW_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.controller.beginLoadingCover();
  const whileCovered = harness.play(IGNORED_SPAN_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.controller.endLoadingCover();
  check(whileCovered.length === 0, `a loading cover takes no rung (${whileCovered.length} taken)`);
  const { event, elapsedMs } = harness.breachWindow(true);
  check(
    event !== null && elapsedMs >= SAFETY_NET_WINDOW_MS,
    `after the cover lifts a whole fresh window is needed (rung after ${elapsedMs.toFixed(0)} ms)`,
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  const nearlyWholeWindowMs = SAFETY_NET_WINDOW_MS - RECOVERY_SETTLE_MS / 2;
  harness.play(nearlyWholeWindowMs, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.recoverCanvases();
  const settleSpanMs = RECOVERY_SETTLE_MS - BREACH_INTERVAL_MS;
  const whileSettling = harness.play(settleSpanMs, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  check(
    whileSettling.length === 0,
    `the repaint after a canvas recovery takes no lag rung (${whileSettling.length} taken)`,
  );
  const { event, elapsedMs } = harness.breachWindow(true);
  check(
    event !== null && elapsedMs >= SAFETY_NET_WINDOW_MS,
    `after the recovery settles a whole fresh window is needed (rung after ${elapsedMs.toFixed(0)} ms)`,
  );
}
{
  const harness = freshHarness('auto');
  harness.enterLevel();
  walkLadder('ladder before a hidden spell', harness, () => true);
  const tierBefore = varietyTier();
  harness.hidden = true;
  harness.play(IGNORED_SPAN_MS, BREACH_INTERVAL_MS, PAINT_BOUND_BAKE_MS);
  harness.hidden = false;
  check(varietyTier() === tierBefore, 'a hidden spell at the bottom of the ladder changes nothing');
}

console.log('\n── Presets');
{
  const harness = freshHarness('sharp');
  harness.enterLevel();
  const taken = walkLadder('sharp', harness, (index) => index % 2 === 0);
  check(taken.length === 0, `sharp never steps on lag (${taken.length} rungs taken)`);
  check(varietyTier() === FULL_VARIETY_TIER, 'sharp keeps the full variety tier');
}
{
  const harness = freshHarness('performance');
  harness.enterLevel();
  const scaleBefore = harness.renderScale;
  const taken = walkLadder('performance', harness, (index) => index % 2 === 0);
  check(
    taken.every((event) => event === 'variety') &&
      taken.length === MINIMAL_VARIETY_TIER - PERFORMANCE_PRESET_VARIETY_TIER,
    `performance gives up only variety, from ${PERFORMANCE_PRESET_VARIETY_TIER} to ${MINIMAL_VARIETY_TIER} (${taken.join(', ')})`,
  );
  check(harness.renderScale === scaleBefore, 'performance never moves the render scale on lag');
}
{
  const harness = freshHarness('auto');
  harness.controller.pinVarietyTier(FULL_VARIETY_TIER);
  harness.enterLevel();
  const taken = walkLadder('a pinned tier', harness, () => true, true);
  check(
    countOf(taken, 'variety') === 0 && varietyTier() === FULL_VARIETY_TIER,
    `a pinned tier stays put; lag takes render rungs only (${taken.join(', ')})`,
  );
}

console.log('\n── The starting tier');
{
  const presets: QualityPreset[] = ['auto', 'sharp', 'performance'];
  const byScale: ReadonlyArray<{ scale: number; tier: number }> = [
    { scale: FULL_SCALE, tier: FULL_VARIETY_TIER },
    { scale: HALF_DENSITY_SCALE, tier: SHARED_LOOKS_TIER },
    { scale: BELOW_HALF_SCALE, tier: TRIMMED_VARIETY_TIER },
  ];
  for (const preset of presets) {
    for (const { scale, tier } of byScale) {
      const expected = preset === 'performance' ? PERFORMANCE_PRESET_VARIETY_TIER : tier;
      check(
        startingVarietyTier(preset, scale) === expected,
        `${preset} at memory scale ${scale.toFixed(2)} starts at tier ${expected}`,
      );
      freshHarness(preset, scale);
      check(varietyTier() === expected, `  …and attaching the controller puts the tier there`);
    }
  }

  forceVarietyTier(LEAN_VARIETY_TIER);
  const alreadyLean = new Harness('auto', FULL_SCALE);
  check(
    alreadyLean.state().tier === LEAN_VARIETY_TIER,
    'the starting tier never raises a lower tier',
  );

  const late = freshHarness('auto', FULL_SCALE);
  late.deviceMemoryScale = HALF_DENSITY_SCALE;
  late.controller.requestProbe();
  check(
    varietyTier() === SHARED_LOOKS_TIER,
    'a memory report overridden after attach is honoured at the next level entry',
  );

  const switched = freshHarness('auto', FULL_SCALE);
  switched.controller.setPreset('performance');
  check(
    varietyTier() === PERFORMANCE_PRESET_VARIETY_TIER,
    `choosing performance mid-session lowers the tier to ${PERFORMANCE_PRESET_VARIETY_TIER}`,
  );
  switched.controller.setPreset('auto');
  check(
    varietyTier() === PERFORMANCE_PRESET_VARIETY_TIER,
    'handing control back to auto does not raise it again',
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-render-quality: all checks passed');
