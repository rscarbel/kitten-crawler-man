/**
 * The `life` overlay: the few dozen pixels per building that make the town
 * look inhabited.
 *
 * Every non-`idle` state in a building's manifest entry is composited over
 * `idle` by the runtime at a single shared 8 fps clock. Each building here gets
 * exactly one such state, named `life`, because the overlay cache key folds
 * every overlay state's frame index into one number — two states would multiply
 * their frame counts into the number of distinct composites cached, and one
 * state keeps it equal to the frame count.
 *
 * ## The mount is `idle`, the moving thing is `life`
 *
 * An overlay composites *over* the base frame; it cannot erase. So anything that
 * moves must not exist in `idle` at all, or the still copy shows through and the
 * building grows a second banner. The rule that falls out of that, and that
 * every effect here follows: **the bracket, the post, the pole and the canopy
 * are painted in `idle`; the cloth, the rooster, the beads and the valance are
 * painted in `life`, in every frame.** It is also why these frames still come
 * out over 95% transparent — the moving parts of a building are small.
 *
 * ## Nyquist
 *
 * At 8 fps anything oscillating faster than about 2.5 Hz aliases into strobing
 * or into a dead freeze. A six-to-ten frame loop is 0.75 s to 1.25 s long, so a
 * spec asking for one cycle across the loop lands near 1 Hz, which is where
 * smoke drift, banner sway and flicker all want to be. `cycles` is a whole
 * number for a different reason: a fractional count leaves the last frame
 * mid-stride from the first and the loop visibly jumps.
 *
 * ## Envelopes
 *
 * Built from explicit ease segments. The `hump(1 - d/w)` family that this
 * codebase has reached for before is zero at the centre of its own window, which
 * turns one blink into two.
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { hashLattice } from '../tilegen/noise.js';
import { chimneyPotMouth } from './materials/roofFurniture.js';
import { groundHeightToFrameY, project, type Projection } from './projection.js';
import { getRamp, rgba, sampleRamp, type RGB } from './ramps.js';
import { frameHeightPx, frameWidthPx, type BuildingSpec, type LifeEffectSpec } from './spec.js';

const SEED_LIFE = 4409;

/** Smooth 0 → 1 → 0 across one cycle, and continuous where the cycle wraps. */
function pulseEnvelope(phase: number): number {
  const HALF = 0.5;
  const rising = phase < HALF ? phase / HALF : (1 - phase) / HALF;
  return rising * rising * (3 - 2 * rising);
}

/** Smooth -1 → +1 → -1 across one cycle: a sway, not a pulse. */
function swayEnvelope(phase: number): number {
  return pulseEnvelope(phase) * 2 - 1;
}

/**
 * A rising particle's opacity over its own life: in fast, out slowly, and zero
 * at both ends so a particle never pops into or out of existence at the seam.
 */
const PARTICLE_FADE_IN = 0.18;
const PARTICLE_FADE_OUT_POWER = 1.6;

function particleAlpha(phase: number): number {
  const fadeIn = Math.min(1, phase / PARTICLE_FADE_IN);
  return fadeIn * Math.pow(1 - phase, PARTICLE_FADE_OUT_POWER);
}

/**
 * A value in [0, 1) that varies per element *and* around the loop, and closes.
 *
 * The obvious tool is `NoiseField.value`, and reaching for it here is a trap the
 * first version of this file fell into wholesale. That field divides its
 * coordinates by `wrapSize / period`; with a wrap size of a few hundred pixels
 * and the small periods these effects asked for, one lattice cell came out
 * sixty to a hundred pixels wide — and every call site was passing indices and
 * phases in the range zero to ten. Every sample landed inside a single cell, so
 * the "flicker" varied by less than a thousandth across a whole loop, seven
 * spark motes rose along one line, and three flame tongues never changed width.
 * Nothing measured it: the loop gate reads a whole-frame mean, and the parts of
 * those effects that *did* move covered for the parts that did not.
 *
 * So this hashes lattice points directly — no coordinate scaling to get wrong —
 * and interpolates between them around a ring, which is what makes the value
 * continuous in phase and identical at phase 0 and phase 1.
 */
const LOOP_NOISE_SAMPLES = 8;

function loopNoise(seed: number, element: number, phase: number): number {
  const position = phase * LOOP_NOISE_SAMPLES;
  const index = Math.floor(position);
  const blend = position - index;
  const from = hashLattice(element, index % LOOP_NOISE_SAMPLES, seed);
  const to = hashLattice(element, (index + 1) % LOOP_NOISE_SAMPLES, seed);
  const eased = blend * blend * (3 - 2 * blend);
  return from + (to - from) * eased;
}

/** A stable value in [0, 1) for one element, constant across the loop. */
function elementNoise(seed: number, element: number): number {
  return hashLattice(element, LOOP_NOISE_SAMPLES, seed);
}

/** Phase of `effect` at `step`, wrapped into [0, 1). */
function effectPhase(effect: LifeEffectSpec, step: number, frames: number): number {
  const raw = (step / frames) * effect.cycles + effect.phase;
  return raw - Math.floor(raw);
}

export function paintLifeFrame(spec: BuildingSpec, step: number): Canvas {
  const projection = project(spec);
  const canvas = createCanvas(frameWidthPx(spec), frameHeightPx(spec));
  const ctx = canvas.getContext('2d');

  for (const [index, effect] of spec.life.effects.entries()) {
    const phase = effectPhase(effect, step, spec.life.frames);
    paintEffect(ctx, projection, spec, effect, phase, spec.seed + SEED_LIFE + index * 97);
  }
  return canvas;
}

function paintEffect(
  ctx: NodeCtx,
  projection: Projection,
  spec: BuildingSpec,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  switch (effect.kind) {
    case 'chimney_smoke':
      paintChimneySmoke(ctx, projection, spec, effect, phase, seed);
      return;
    case 'window_breathe':
      paintWindowBreathe(ctx, projection, effect, phase);
      return;
    case 'window_crowd':
      paintWindowCrowd(ctx, projection, effect, phase, seed);
      return;
    case 'brazier_flame':
      paintFlame(ctx, projection, effect, phase, seed);
      return;
    case 'forge_pulse':
      paintForgePulse(ctx, projection, effect, phase);
      return;
    case 'spark_motes':
      paintSparkMotes(ctx, projection, effect, phase, seed);
      return;
    case 'banner_sway':
      paintBannerSway(ctx, projection, effect, phase);
      return;
    case 'awning_ripple':
      paintAwningRipple(ctx, projection, effect, phase);
      return;
    case 'hanging_sway':
      paintHangingSway(ctx, projection, effect, phase, seed);
      return;
    case 'lantern_flicker':
      paintLanternFlicker(ctx, projection, effect, phase, seed);
      return;
    case 'sleeping_cat':
      paintSleepingCat(ctx, projection, effect, phase);
      return;
    case 'finial_glint':
      paintFinialGlint(ctx, projection, effect, phase);
      return;
    case 'weathervane_swing':
      paintWeathervaneSwing(ctx, projection, effect, phase);
      return;
    case 'suit_lantern_sequence':
      paintSuitLanterns(ctx, projection, effect, phase);
      return;
    case 'bead_curtain_sway':
      paintBeadCurtainSway(ctx, projection, effect, phase, seed);
      return;
  }
}

/** Frame-space rectangle an effect's anchor names, seated on its stated height. */
interface EffectRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function effectRect(projection: Projection, effect: LifeEffectSpec): EffectRect {
  const height = effect.heightTiles * projection.scale;
  return {
    x: effect.col * projection.scale,
    y: groundHeightToFrameY(projection, effect.baseAboveGroundTiles) - height,
    width: effect.widthTiles * projection.scale,
    height,
  };
}

// ── smoke ──────────────────────────────────────────────────────────────────

/**
 * Three puffs evenly spaced around the loop, each completing exactly one rise.
 *
 * Evenly spaced is what makes the seam invisible: the set of puff phases at the
 * last frame is the set at the first frame, rotated onto itself, so there is no
 * frame at which the column of smoke is emptier than at any other.
 */
const SMOKE_PUFF_COUNT = 3;
const SMOKE_WIND_LEAN_TILES = 0.42;
const SMOKE_WOBBLE_PX = 5;
const SMOKE_START_RADIUS_TILES = 0.1;
const SMOKE_END_RADIUS_TILES = 0.34;
const SMOKE_PEAK_ALPHA = 0.42;
const SMOKE_BLOB_COUNT = 3;

function paintChimneySmoke(
  ctx: NodeCtx,
  projection: Projection,
  spec: BuildingSpec,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const smoking = spec.roof.chimneys.find((chimney) => chimney.smokes);
  const mouth =
    smoking === undefined
      ? { x: effect.col * projection.scale, y: effectRect(projection, effect).y }
      : chimneyPotMouth(projection, spec, smoking);
  const ramp = getRamp(effect.ramp);
  const rise = effect.heightTiles * projection.scale;

  for (let puff = 0; puff < SMOKE_PUFF_COUNT; puff++) {
    const puffPhase = (phase + puff / SMOKE_PUFF_COUNT) % 1;
    const alpha = particleAlpha(puffPhase) * SMOKE_PEAK_ALPHA;
    if (alpha <= 0) continue;
    const height = puffPhase * rise;
    const wobble = (loopNoise(seed, puff, puffPhase) - 0.5) * 2 * SMOKE_WOBBLE_PX;
    const centreX = mouth.x + wobble + SMOKE_WIND_LEAN_TILES * projection.scale * puffPhase;
    const centreY = mouth.y - height;
    const radius =
      (SMOKE_START_RADIUS_TILES + (SMOKE_END_RADIUS_TILES - SMOKE_START_RADIUS_TILES) * puffPhase) *
      projection.scale;
    // Three overlapping lobes rather than one disc: a single soft circle reads
    // as a decal, and smoke's silhouette is the only part of it anyone sees.
    for (let blob = 0; blob < SMOKE_BLOB_COUNT; blob++) {
      const angle = (blob / SMOKE_BLOB_COUNT) * Math.PI * 2 + puffPhase * Math.PI;
      const offset = radius * 0.4;
      paintSoftBlob(
        ctx,
        centreX + Math.cos(angle) * offset,
        centreY + Math.sin(angle) * offset * 0.6,
        radius,
        sampleRamp(ramp, 0.4 + puffPhase * 0.4),
        alpha,
      );
    }
  }
}

/** Optional anisotropy, so a blob can be shaped to the opening it comes out of. */
interface BlobShape {
  readonly scaleX: number;
  readonly scaleY: number;
}

function paintSoftBlob(
  ctx: NodeCtx,
  x: number,
  y: number,
  radius: number,
  color: RGB,
  alpha: number,
  shape?: BlobShape,
): void {
  if (radius <= 0) return;
  ctx.save();
  if (shape !== undefined) {
    ctx.translate(x, y);
    ctx.scale(shape.scaleX, shape.scaleY);
    ctx.translate(-x, -y);
  }
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const MID_STOP = 0.55;
  const MID_ALPHA_FRACTION = 0.55;
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(MID_STOP, rgba(color, alpha * MID_ALPHA_FRACTION));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── window light ───────────────────────────────────────────────────────────

const WINDOW_BREATHE_RAMP_T = 0.85;
const WINDOW_BREATHE_MIN = 0.1;
const WINDOW_BREATHE_MAX = 0.5;
const WINDOW_GLOW_BLEED_TILES = 0.08;

function paintWindowBreathe(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const alpha =
    WINDOW_BREATHE_MIN + (WINDOW_BREATHE_MAX - WINDOW_BREATHE_MIN) * pulseEnvelope(phase);
  const bleed = WINDOW_GLOW_BLEED_TILES * projection.scale;
  // Shaped to the opening rather than circled around it. A circle whose radius
  // is the window's longer side covers most of the wall on a wide shopfront, and
  // the alpha it lays down out there is invisible but is still ink the overlay
  // is supposed not to carry.
  paintSoftBlob(
    ctx,
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    Math.min(rect.width, rect.height) / 2 + bleed,
    sampleRamp(ramp, WINDOW_BREATHE_RAMP_T),
    alpha,
    {
      scaleX: rect.width / Math.min(rect.width, rect.height),
      scaleY: rect.height / Math.min(rect.width, rect.height),
    },
  );
}

/**
 * Bodies in a lit window: some standing at it, some walking past behind it.
 *
 * The first version gave every window two silhouettes walking clean across it,
 * evenly spaced in phase, once per loop each. That is a body crossing the glass
 * every half second in every lit window in the town, for ever — a treadmill.
 * The fault was the *rhythm*, not the walking: a room with nobody crossing it
 * is a dead room, and a crossing is the single clearest way to say a building
 * has an inside.
 *
 * So a window holds two kinds of body. **Standers** hold a station and do not
 * move at all, which is what most people in a taproom are doing at any instant,
 * and which gives the window something to show during the gaps. **Walkers**
 * cross the opening once per loop, but each is visible for only part of it and
 * is off the glass the rest, so the window empties of traffic between passes.
 *
 * ## Position is the only thing that animates
 *
 * An earlier pass gave the standers a slow lean and the walkers a rise and fall
 * per crossing, on the theory that a body carried on legs should not look slid.
 * At this size it did not read as either: a silhouette four pixels wide shifting
 * by three is not a person shifting their weight, it is a shape wobbling, and
 * the first thing said about it was that it was impossible to tell what it was
 * meant to be. A form too small to show what a motion *is* should not move —
 * legibility at 32 px is the constraint every sprite in this codebase loses to
 * first. So a body's position is the whole animation.
 *
 * ## Why speed and sparseness come out of the same budget
 *
 * A walker's path is fixed by the opening it crosses, so its speed is that path
 * divided by the slice of the loop it spends crossing. Widen the slice and the
 * walk slows but the pause shrinks; the pause cannot be recovered by any other
 * means, because the overlay repeats exactly and no gap can outlast the loop
 * containing it. Both therefore have to be bought with frames, and a frame of
 * `life` is a whole frame of decoded sheet. That is why walkers are declared per
 * window rather than given to every one: the pub's loop was tripled to pay for
 * its traffic, and windows that cannot afford the frames get standers only
 * rather than a fast pass every three-quarters of a second.
 *
 * Everything that could otherwise line up is drawn per-body from the effect's
 * own seed: how many there are, where each stands, how far into the room, which
 * way each walker crosses, how long it takes and where in the loop it sets off.
 * Two windows on the same building get different seeds, so nothing in one keeps
 * time with anything in the other.
 */
const CROWD_MIN_OCCUPANTS = 1;
const CROWD_MAX_OCCUPANTS = 3;
const CROWD_HEAD_RADIUS_TILES = 0.13;
const CROWD_SHOULDER_WIDTH_TILES = 0.34;
const CROWD_ALPHA_NEAR = 0.72;
const CROWD_ALPHA_FAR = 0.4;
/** Occupants further into the room are smaller as well as fainter. */
const CROWD_SIZE_NEAR = 1.05;
const CROWD_SIZE_FAR = 0.82;

/**
 * Element keys for the occupant streams.
 *
 * Spaced by more than `CROWD_MAX_OCCUPANTS` so no two streams can ever collide
 * on an index — sharing an element ties two of an occupant's traits together,
 * which is how a louvred shutter ended up always being the darker one.
 */
const CROWD_KEY_COUNT = 0;
const CROWD_KEY_STATION = 10;
const CROWD_KEY_DEPTH = 40;
const CROWD_KEY_WALK_DIRECTION = 100;
const CROWD_KEY_WALK_SPAN = 110;
const CROWD_KEY_WALK_START = 120;
const CROWD_KEY_WALK_DEPTH = 130;

/**
 * Fraction of the loop one walker spends actually crossing the glass.
 *
 * The rest of the loop it is off the opening entirely, which is where the pause
 * between passes comes from. This is the *only* control over how fast a walker
 * moves: the path length is fixed by the opening, so speed is travel ÷ (span ×
 * loop), and a slower walker costs either a larger span — which eats the pause
 * — or a longer loop, which costs decoded bytes. Chosen together with the pub's
 * 24-frame loop to put the crossing near a tile a second.
 */
const WALK_SPAN_MIN = 0.4;
const WALK_SPAN_MAX = 0.5;
/**
 * How far the hash may shift a walker's departure from the phase its window
 * declares.
 *
 * Deliberately a fraction of a loop rather than the whole of one. A free-running
 * start cancels the stagger the spec asked for: the pub's two windows declare
 * phases half a loop apart, drew start offsets that also differed by half a
 * loop, and put their walkers on the glass in the same frame — two windows on
 * one wall in lockstep, which is the whole thing this effect is trying not to
 * do. The declared phase decides who goes when; this only stops it being exact.
 */
const WALK_START_JITTER = 0.22;
/** Walkers cross in front of the standers, so they are drawn from the near half. */
const WALK_DEPTH_LIMIT = 0.5;

function paintWindowCrowd(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  paintWindowBreathe(ctx, projection, effect, phase);
  const rect = effectRect(projection, effect);
  const occupants =
    CROWD_MIN_OCCUPANTS +
    Math.floor(
      elementNoise(seed, CROWD_KEY_COUNT) * (CROWD_MAX_OCCUPANTS - CROWD_MIN_OCCUPANTS + 1),
    );

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  for (let occupant = 0; occupant < occupants; occupant++) {
    // Stratified so three occupants cannot all draw a station at the same end
    // of the sill and stack into one blob.
    const laneWidth = rect.width / occupants;
    const laneJitter = elementNoise(seed, CROWD_KEY_STATION + occupant);
    const STATION_LANE_MARGIN = 0.2;
    paintCrowdBody(ctx, projection, rect, {
      x:
        rect.x +
        (occupant + STATION_LANE_MARGIN + laneJitter * (1 - STATION_LANE_MARGIN * 2)) * laneWidth,
      depth: elementNoise(seed, CROWD_KEY_DEPTH + occupant),
    });
  }

  const walkers = effect.walkers ?? 0;
  for (let walker = 0; walker < walkers; walker++) {
    const departure = elementNoise(seed, CROWD_KEY_WALK_START + walker) * WALK_START_JITTER;
    const local = (phase - departure + 1) % 1;
    const span =
      WALK_SPAN_MIN +
      (WALK_SPAN_MAX - WALK_SPAN_MIN) * elementNoise(seed, CROWD_KEY_WALK_SPAN + walker);
    if (local > span) continue;

    const crossed = local / span;
    const depth = elementNoise(seed, CROWD_KEY_WALK_DEPTH + walker) * WALK_DEPTH_LIMIT;
    const shoulderWidth = crowdShoulderWidth(projection, depth);
    // The path clears the opening at both ends, so a walker is fully off the
    // glass when its span opens and closes and nothing pops into existence.
    const travel = rect.width + shoulderWidth * 2;
    const goesRight = elementNoise(seed, CROWD_KEY_WALK_DIRECTION + walker) < 0.5;
    const alongPath = goesRight ? crossed : 1 - crossed;

    paintCrowdBody(ctx, projection, rect, {
      x: rect.x - shoulderWidth + alongPath * travel,
      depth,
    });
  }
  ctx.restore();
}

interface CrowdBody {
  readonly x: number;
  /** How far into the room the body stands, 0 at the glass and 1 at the back wall. */
  readonly depth: number;
}

function crowdShoulderWidth(projection: Projection, depth: number): number {
  return (
    CROWD_SHOULDER_WIDTH_TILES *
    projection.scale *
    (CROWD_SIZE_NEAR + (CROWD_SIZE_FAR - CROWD_SIZE_NEAR) * depth)
  );
}

function crowdHeadRadius(projection: Projection, depth: number): number {
  return (
    CROWD_HEAD_RADIUS_TILES *
    projection.scale *
    (CROWD_SIZE_NEAR + (CROWD_SIZE_FAR - CROWD_SIZE_NEAR) * depth)
  );
}

const CROWD_SHOULDER_HEIGHT_FRACTION = 0.55;
const CROWD_NECK_HEAD_RADII = 1.6;
const CROWD_TORSO_HEIGHT_FRACTION = 0.45;

function paintCrowdBody(
  ctx: NodeCtx,
  projection: Projection,
  rect: EffectRect,
  body: CrowdBody,
): void {
  const headRadius = crowdHeadRadius(projection, body.depth);
  const shoulderY = rect.y + rect.height * CROWD_SHOULDER_HEIGHT_FRACTION;
  ctx.fillStyle = rgba(
    sampleRamp(getRamp('ink_outline'), 0.2),
    CROWD_ALPHA_NEAR + (CROWD_ALPHA_FAR - CROWD_ALPHA_NEAR) * body.depth,
  );
  ctx.beginPath();
  ctx.arc(body.x, shoulderY - headRadius * CROWD_NECK_HEAD_RADII, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    body.x,
    rect.y + rect.height,
    crowdShoulderWidth(projection, body.depth) / 2,
    rect.height * CROWD_TORSO_HEIGHT_FRACTION,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

// ── fire ───────────────────────────────────────────────────────────────────

const FLAME_TONGUE_COUNT = 3;
const FLAME_HEIGHT_MIN = 0.72;
const FLAME_CORE_FRACTION = 0.45;
const FLAME_GLOW_RADIUS_FACTOR = 1.0;
const FLAME_GLOW_ALPHA = 0.34;

function paintFlame(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const baseY = rect.y + rect.height;
  const centreX = rect.x + rect.width / 2;

  paintSoftBlob(
    ctx,
    centreX,
    baseY - rect.height * 0.4,
    rect.width * FLAME_GLOW_RADIUS_FACTOR,
    sampleRamp(ramp, 0.7),
    FLAME_GLOW_ALPHA * (FLAME_HEIGHT_MIN + (1 - FLAME_HEIGHT_MIN) * pulseEnvelope(phase)),
  );

  for (let tongue = 0; tongue < FLAME_TONGUE_COUNT; tongue++) {
    const tonguePhase = (phase + tongue / FLAME_TONGUE_COUNT) % 1;
    const flicker = loopNoise(seed, tongue, tonguePhase);
    const height =
      rect.height * (FLAME_HEIGHT_MIN + (1 - FLAME_HEIGHT_MIN) * pulseEnvelope(tonguePhase));
    const halfWidth = (rect.width / (FLAME_TONGUE_COUNT + 1)) * (0.7 + flicker * 0.5);
    const tipX = centreX + (tongue - (FLAME_TONGUE_COUNT - 1) / 2) * halfWidth * 1.1;
    const lean = swayEnvelope(tonguePhase) * halfWidth * 0.5;
    ctx.fillStyle = rgba(sampleRamp(ramp, 0.45), 0.9);
    ctx.beginPath();
    ctx.moveTo(tipX - halfWidth, baseY);
    ctx.quadraticCurveTo(tipX - halfWidth * 0.6, baseY - height * 0.6, tipX + lean, baseY - height);
    ctx.quadraticCurveTo(tipX + halfWidth * 0.6, baseY - height * 0.6, tipX + halfWidth, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(sampleRamp(ramp, 1), 0.85);
    ctx.beginPath();
    ctx.moveTo(tipX - halfWidth * FLAME_CORE_FRACTION, baseY);
    ctx.quadraticCurveTo(
      tipX - halfWidth * 0.3,
      baseY - height * 0.5,
      tipX + lean * 0.6,
      baseY - height * 0.62,
    );
    ctx.quadraticCurveTo(
      tipX + halfWidth * 0.3,
      baseY - height * 0.5,
      tipX + halfWidth * FLAME_CORE_FRACTION,
      baseY,
    );
    ctx.closePath();
    ctx.fill();
  }
}

const FORGE_GLOW_CENTRE_FRACTION = 0.6;
/**
 * The forge's halo, as a fraction of the opening it comes out of.
 *
 * Deliberately close to the opening's own size. A halo half as wide again reads
 * no hotter and covers a tenth of the frame in alpha so faint it is invisible,
 * which is exactly the ink an overlay is supposed not to carry.
 */
const FORGE_GLOW_RADIUS_FACTOR = 0.62;
const FORGE_GLOW_RAMP_T = 0.75;
const FORGE_PULSE_MIN = 0.3;
const FORGE_PULSE_MAX = 0.8;

function paintForgePulse(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const alpha = FORGE_PULSE_MIN + (FORGE_PULSE_MAX - FORGE_PULSE_MIN) * pulseEnvelope(phase);
  paintSoftBlob(
    ctx,
    rect.x + rect.width / 2,
    rect.y + rect.height * FORGE_GLOW_CENTRE_FRACTION,
    Math.max(rect.width, rect.height) * FORGE_GLOW_RADIUS_FACTOR,
    sampleRamp(ramp, FORGE_GLOW_RAMP_T),
    alpha,
  );
}

const SPARK_COUNT = 7;
const SPARK_RADIUS_PX = 1.2;
const SPARK_DRIFT_TILES = 0.3;

function paintSparkMotes(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  for (let spark = 0; spark < SPARK_COUNT; spark++) {
    const sparkPhase = (phase + spark / SPARK_COUNT) % 1;
    const alpha = particleAlpha(sparkPhase);
    if (alpha <= 0) continue;
    const lateral = (elementNoise(seed, spark) - 0.5) * 2;
    const x =
      rect.x +
      rect.width / 2 +
      lateral * rect.width * 0.5 +
      SPARK_DRIFT_TILES * projection.scale * sparkPhase;
    const y = rect.y + rect.height - sparkPhase * rect.height;
    ctx.fillStyle = rgba(sampleRamp(ramp, 1), alpha);
    ctx.beginPath();
    ctx.arc(x, y, SPARK_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── cloth ──────────────────────────────────────────────────────────────────

const BANNER_SWAY_ANGLE = 0.13;
const BANNER_TAIL_POINTS = 4;
const BANNER_FOLD_COUNT = 3;

/**
 * A hanging banner pivoting about its bracket.
 *
 * The bracket itself is painted in `idle`; only the cloth is here, or the still
 * copy would show through the sway.
 */
function paintBannerSway(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const angle = swayEnvelope(phase) * BANNER_SWAY_ANGLE;
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y);
  ctx.rotate(angle);
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.5), 1);
  ctx.beginPath();
  ctx.moveTo(-rect.width / 2, 0);
  ctx.lineTo(rect.width / 2, 0);
  ctx.lineTo(rect.width / 2, rect.height * 0.8);
  for (let point = BANNER_TAIL_POINTS; point >= 0; point--) {
    const t = point / BANNER_TAIL_POINTS;
    const x = -rect.width / 2 + rect.width * t;
    const notch = point % 2 === 0 ? rect.height : rect.height * 0.8;
    ctx.lineTo(x, notch);
  }
  ctx.closePath();
  ctx.fill();
  for (let fold = 1; fold < BANNER_FOLD_COUNT; fold++) {
    const x = -rect.width / 2 + (rect.width * fold) / BANNER_FOLD_COUNT;
    ctx.strokeStyle = rgba(sampleRamp(ramp, 0.2), 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + angle * rect.height, rect.height * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

const AWNING_SCALLOP_COUNT = 6;
const AWNING_RIPPLE_PX = 2.4;

/** The canopy is painted in `idle`; its valance is the only part that moves. */
function paintAwningRipple(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const scallopWidth = rect.width / AWNING_SCALLOP_COUNT;
  for (let scallop = 0; scallop < AWNING_SCALLOP_COUNT; scallop++) {
    const scallopPhase = (phase + scallop / AWNING_SCALLOP_COUNT) % 1;
    const drop = rect.height + swayEnvelope(scallopPhase) * AWNING_RIPPLE_PX;
    const x = rect.x + scallop * scallopWidth;
    ctx.fillStyle = rgba(sampleRamp(ramp, scallop % 2 === 0 ? 0.6 : 0.3), 1);
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x + scallopWidth, rect.y);
    ctx.quadraticCurveTo(x + scallopWidth / 2, rect.y + drop * 1.4, x, rect.y);
    ctx.closePath();
    ctx.fill();
  }
}

const HANGING_STRAND_COUNT = 3;
const HANGING_SWAY_ANGLE = 0.16;
const HANGING_LEAF_ROWS = 4;

/** Herb bundles hung under the eaves, swinging from their own tie. */
function paintHangingSway(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const bundleWidth = rect.width / HANGING_STRAND_COUNT;
  for (let bundle = 0; bundle < HANGING_STRAND_COUNT; bundle++) {
    const bundlePhase = (phase + bundle / (HANGING_STRAND_COUNT * 2)) % 1;
    const angle = swayEnvelope(bundlePhase) * HANGING_SWAY_ANGLE;
    const pivotX = rect.x + bundleWidth * (bundle + 0.5);
    ctx.save();
    ctx.translate(pivotX, rect.y);
    ctx.rotate(angle);
    ctx.strokeStyle = rgba(sampleRamp(ramp, 0.15), 1);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, rect.height);
    ctx.stroke();
    for (let row = 0; row < HANGING_LEAF_ROWS; row++) {
      const t = (row + 1) / (HANGING_LEAF_ROWS + 1);
      const spread = bundleWidth * 0.32 * (1 - t * 0.4);
      const tone = 0.35 + ((seed + bundle * 13 + row * 7) % 5) / 10;
      ctx.fillStyle = rgba(sampleRamp(ramp, tone), 1);
      ctx.beginPath();
      ctx.ellipse(
        -spread * 0.5,
        rect.height * t,
        spread * 0.7,
        rect.height * 0.16,
        -0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(
        spread * 0.5,
        rect.height * t,
        spread * 0.7,
        rect.height * 0.16,
        0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }
}

const LANTERN_SWAY_ANGLE = 0.09;
const LANTERN_FLICKER_MIN = 0.45;
const LANTERN_GLOW_RADIUS_FACTOR = 1.05;
const LANTERN_GLOW_RAMP_T = 0.8;
const LANTERN_GLOW_ALPHA = 0.4;

function paintLanternFlicker(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const angle = swayEnvelope(phase) * LANTERN_SWAY_ANGLE;
  const flicker = LANTERN_FLICKER_MIN + (1 - LANTERN_FLICKER_MIN) * loopNoise(seed, 0, phase);
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y);
  ctx.rotate(angle);
  ctx.strokeStyle = rgba(sampleRamp(getRamp('iron_black'), 0.4), 1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, rect.height * 0.3);
  ctx.stroke();
  const bodyY = rect.height * 0.3;
  ctx.fillStyle = rgba(sampleRamp(getRamp('iron_black'), 0.3), 1);
  ctx.fillRect(-rect.width / 2, bodyY, rect.width, rect.height * 0.7);
  ctx.fillStyle = rgba(sampleRamp(ramp, 0.85), flicker);
  ctx.fillRect(
    -rect.width * 0.32,
    bodyY + rect.height * 0.12,
    rect.width * 0.64,
    rect.height * 0.46,
  );
  ctx.restore();
  paintSoftBlob(
    ctx,
    rect.x + rect.width / 2 + angle * rect.height,
    rect.y + rect.height * 0.65,
    rect.width * LANTERN_GLOW_RADIUS_FACTOR,
    sampleRamp(ramp, LANTERN_GLOW_RAMP_T),
    flicker * LANTERN_GLOW_ALPHA,
  );
}

// ── the inn's cat ──────────────────────────────────────────────────────────

const CAT_BREATH_RISE_PX = 1.6;
const CAT_EAR_HEIGHT_FRACTION = 0.34;
const CAT_TAIL_CURL_FRACTION = 0.55;

/**
 * A cat asleep on an upstairs sill, its flank rising and falling.
 *
 * The whole cat lives here rather than in `idle`, because the flank is most of
 * its silhouette and a still copy behind it would read as a second cat.
 */
function paintSleepingCat(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const breath = pulseEnvelope(phase) * CAT_BREATH_RISE_PX;
  const baseY = rect.y + rect.height;
  const bodyHeight = rect.height * 0.62 + breath;
  const body = sampleRamp(ramp, 0.45);
  const belly = sampleRamp(ramp, 0.7);

  ctx.fillStyle = rgba(body, 1);
  ctx.beginPath();
  ctx.ellipse(
    rect.x + rect.width * 0.52,
    baseY - bodyHeight / 2,
    rect.width * 0.42,
    bodyHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // The tail curls round the near side of the body: without it a sleeping cat
  // is an oval, and an oval on a windowsill is a loaf of bread.
  ctx.strokeStyle = rgba(body, 1);
  ctx.lineWidth = Math.max(1.5, rect.height * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.width * 0.9, baseY - bodyHeight * 0.35);
  ctx.quadraticCurveTo(
    rect.x + rect.width * 1.02,
    baseY,
    rect.x + rect.width * CAT_TAIL_CURL_FRACTION,
    baseY - 1,
  );
  ctx.stroke();

  const headX = rect.x + rect.width * 0.2;
  const headY = baseY - bodyHeight * 0.55;
  const headRadius = rect.height * 0.24;
  ctx.fillStyle = rgba(body, 1);
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  const earHeight = rect.height * CAT_EAR_HEIGHT_FRACTION;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(headX + side * headRadius * 0.7, headY - headRadius * 0.5);
    ctx.lineTo(headX + side * headRadius * 0.35, headY - headRadius - earHeight * 0.5);
    ctx.lineTo(headX + side * headRadius * 0.05, headY - headRadius * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = rgba(belly, 0.7);
  ctx.beginPath();
  ctx.ellipse(
    rect.x + rect.width * 0.55,
    baseY - bodyHeight * 0.25,
    rect.width * 0.28,
    bodyHeight * 0.2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

// ── the temple's finial ────────────────────────────────────────────────────

const GLINT_TRAVEL_FRACTION = 1.2;
const GLINT_RADIUS_TILES = 0.2;
const GLINT_ALPHA = 0.8;

function paintFinialGlint(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const travel = rect.height * GLINT_TRAVEL_FRACTION;
  const y = rect.y + rect.height - phase * travel;
  const alpha = GLINT_ALPHA * pulseEnvelope(phase);
  paintSoftBlob(
    ctx,
    rect.x + rect.width / 2,
    y,
    GLINT_RADIUS_TILES * projection.scale,
    sampleRamp(ramp, 1),
    alpha,
  );
}

// ── the farm's weathervane ─────────────────────────────────────────────────

/** How narrow the rooster gets as it turns edge-on to the viewer. */
const VANE_EDGE_ON_SQUASH = 0.28;
const VANE_TAIL_FRACTION = 0.55;
const VANE_IRON_TONE = 0.35;

/** The post is painted in `idle`; the rooster that turns on it is here. */
function paintWeathervaneSwing(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const iron = sampleRamp(getRamp(effect.ramp), VANE_IRON_TONE);
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  // Foreshortened by the *signed* swing, so the rooster turns about its post
  // rather than sliding through the air. `cos(angle)` was wrong twice over: it
  // is an even function, so a swing from -a to +a squashed and unsquashed twice
  // per cycle — the vane spun at double the rate the spec asked for — and over
  // a fifth of a radian it varies by two per cent, which is no foreshortening at
  // all. Interpolating on the signed envelope gives one turn per cycle and a
  // depth cue you can actually see.
  const turn = swayEnvelope(phase);
  ctx.scale(VANE_EDGE_ON_SQUASH + (1 - VANE_EDGE_ON_SQUASH) * Math.abs(turn), 1);
  if (turn < 0) ctx.scale(-1, 1);
  ctx.fillStyle = rgba(iron, 1);
  ctx.beginPath();
  ctx.moveTo(-rect.width / 2, rect.height * 0.1);
  ctx.quadraticCurveTo(-rect.width * 0.1, -rect.height * 0.5, rect.width * 0.2, -rect.height * 0.2);
  ctx.lineTo(rect.width * 0.42, -rect.height * 0.42);
  ctx.lineTo(rect.width / 2, -rect.height * 0.1);
  ctx.quadraticCurveTo(
    rect.width * 0.2,
    rect.height * 0.4,
    -rect.width * VANE_TAIL_FRACTION,
    rect.height * 0.3,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── the club's neon ────────────────────────────────────────────────────────

const SUIT_LANTERN_COUNT = 4;
const SUIT_LANTERN_MIN = 0.25;
const SUIT_LANTERN_RADIUS_TILES = 0.24;

/**
 * Four card-suit lamps pulsing in sequence — the closest thing the Over City has
 * to neon, and the reason the Desperado reads as the loudest thing in the Low
 * Quarter from three streets away.
 */
function paintSuitLanterns(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  for (let lamp = 0; lamp < SUIT_LANTERN_COUNT; lamp++) {
    const lampPhase = (phase + lamp / SUIT_LANTERN_COUNT) % 1;
    const alpha = SUIT_LANTERN_MIN + (1 - SUIT_LANTERN_MIN) * pulseEnvelope(lampPhase);
    const x = rect.x + (rect.width * (lamp + 0.5)) / SUIT_LANTERN_COUNT;
    paintSoftBlob(
      ctx,
      x,
      rect.y + rect.height / 2,
      SUIT_LANTERN_RADIUS_TILES * projection.scale,
      sampleRamp(ramp, 0.9),
      alpha,
    );
  }
}

// ── Signet's doorway ───────────────────────────────────────────────────────

const BEAD_STRAND_COUNT = 7;
const BEAD_PER_STRAND = 6;
const BEAD_SWAY_PX = 2.2;
const BEAD_RADIUS_PX = 1.4;

function paintBeadCurtainSway(
  ctx: NodeCtx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  for (let strand = 0; strand < BEAD_STRAND_COUNT; strand++) {
    const strandPhase = (phase + strand / (BEAD_STRAND_COUNT * 2)) % 1;
    const sway = swayEnvelope(strandPhase) * BEAD_SWAY_PX;
    const x = rect.x + (rect.width * (strand + 0.5)) / BEAD_STRAND_COUNT;
    for (let bead = 0; bead < BEAD_PER_STRAND; bead++) {
      const t = (bead + 0.5) / BEAD_PER_STRAND;
      const tone = 0.3 + ((seed + strand * 5 + bead * 3) % 6) / 12;
      ctx.fillStyle = rgba(sampleRamp(ramp, tone), 1);
      ctx.beginPath();
      ctx.arc(x + sway * t, rect.y + rect.height * t, BEAD_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
