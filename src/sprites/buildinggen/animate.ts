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

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { hashLattice } from '../../map/tilegen/noise';
import { chimneyPotMouth } from './materials/roofFurniture';
import { groundHeightToFrameY, project, type Projection } from './projection';
import { getRamp, rgba, sampleRamp, type RGB } from './ramps';
import { frameHeightPx, frameWidthPx, type BuildingSpec, type LifeEffectSpec } from './spec';

/** The game's own 2D context — the offline bakers bridge node-canvas to it. */
type Ctx = CanvasRenderingContext2D;

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
 * `NoiseField.value` is the obvious tool but the wrong one here: it divides its
 * coordinates by `wrapSize / period`, so with a wrap size of a few hundred
 * pixels and the small periods these effects need, one lattice cell would span
 * sixty to a hundred pixels against indices and phases in the range zero to
 * ten — every sample would land inside a single cell, and the flicker, spark
 * spread and tongue width these effects depend on would collapse to nothing.
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

export function paintLifeFrame(spec: BuildingSpec, step: number): CanvasSurface {
  const projection = project(spec);
  const canvas = allocCanvas(frameWidthPx(spec), frameHeightPx(spec));
  const ctx = surfaceContext(canvas);

  for (const [index, effect] of spec.life.effects.entries()) {
    const phase = effectPhase(effect, step, spec.life.frames);
    paintEffect(ctx, projection, spec, effect, phase, spec.seed + SEED_LIFE + index * 97);
  }
  return canvas;
}

function paintEffect(
  ctx: Ctx,
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
    case 'roof_perch':
      paintRoofPerch(ctx, projection, effect, phase, seed);
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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

function paintCrowdBody(ctx: Ctx, projection: Projection, rect: EffectRect, body: CrowdBody): void {
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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

/**
 * How far the flank lifts at the top of a breath, in bake pixels. One and a half
 * bake pixels is one pixel at the 32 px display tile: enough to see, not so
 * much that the cat reads as panting.
 */
const CAT_BREATH_RISE_PX = 1.5;
/** The head rides the breath only a little; a sleeping head barely moves. */
const CAT_HEAD_BREATH_SHARE = 0.3;
/**
 * The silhouette's ink, in bake pixels. Painted as a stroke twice this wide
 * under the coat, so half of it lands outside the fill.
 */
const CAT_OUTLINE_PX = 1.4;

/** Proportions of the effect rect: width for x, height for y, measured up from the sill. */
const CAT_BODY_CENTRE_X = 0.55;
const CAT_BODY_RADIUS_X = 0.34;
const CAT_BODY_HEIGHT = 0.62;
const CAT_HAUNCH_CENTRE_X = 0.74;
const CAT_HAUNCH_RADIUS_X = 0.2;
const CAT_HAUNCH_HEIGHT = 0.74;
const CAT_HEAD_CENTRE_X = 0.22;
const CAT_HEAD_CENTRE_Y = 0.4;
const CAT_HEAD_RADIUS = 0.34;
/** Ears as fractions of the head radius: where the base sits and how tall the point stands. */
const CAT_EAR_BASE_INNER = 0.05;
const CAT_EAR_BASE_OUTER = 0.9;
const CAT_EAR_BASE_DROP = 0.45;
const CAT_EAR_TIP_OFFSET = 0.6;
const CAT_EAR_TIP_RISE = 1.55;
const CAT_PAW_CENTRE_X = 0.24;
const CAT_PAW_RADIUS_X = 0.1;
const CAT_PAW_HEIGHT = 0.18;
const CAT_TAIL_ROOT_X = 0.92;
const CAT_TAIL_ROOT_Y = 0.3;
const CAT_TAIL_TIP_X = 0.36;
const CAT_TAIL_TIP_Y = 0.24;
const CAT_TAIL_SAG_Y = 0.02;
const CAT_TAIL_WIDTH = 0.19;
/** The closed eye's half-width and droop, as fractions of the head radius. */
const CAT_EYE_OFFSET_X = -0.3;
const CAT_EYE_OFFSET_Y = 0.02;
const CAT_EYE_HALF_WIDTH = 0.34;
const CAT_EYE_DROOP = 0.22;
const CAT_EYE_LINE_PX = 1.2;
const CAT_MUZZLE_OFFSET_X = -0.55;
const CAT_MUZZLE_OFFSET_Y = 0.45;
const CAT_MUZZLE_RADIUS = 0.42;
/** Tabby bars across the back, as x fractions of the body. */
const CAT_STRIPE_XS = [0.42, 0.56, 0.7] as const;
const CAT_STRIPE_LENGTH = 0.36;
const CAT_STRIPE_PX = 1.6;
const CAT_STRIPE_ALPHA = 0.75;
/** How far a tabby bar bows off vertical, in bake pixels. */
const CAT_STRIPE_LEAN_PX = 1;
const CAT_BELLY_SHADE_ALPHA = 0.55;
const CAT_BACK_LIGHT_ALPHA = 0.7;
/** Where, top to sill, the back's light has faded out and the belly's shade begins. */
const CAT_LIGHT_FADE_STOP = 0.45;
const CAT_SHADE_START_STOP = 0.7;
const CAT_SHADOW_ALPHA = 0.45;
const CAT_SHADOW_SPREAD = 0.52;
const CAT_SHADOW_DEPTH_PX = 2;
/** The contact shadow is a smear along the sill, not a pool. */
const CAT_SHADOW_FLATTEN = 0.18;

/** One smooth breath per cycle, rising from and settling to zero where the loop wraps. */
function breathEnvelope(phase: number): number {
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

interface CatShape {
  readonly left: number;
  readonly sill: number;
  readonly width: number;
  readonly height: number;
  /** 0..1 through one breath. */
  readonly breath: number;
}

function catX(shape: CatShape, fraction: number): number {
  return shape.left + shape.width * fraction;
}

function catY(shape: CatShape, fractionUp: number): number {
  return shape.sill - shape.height * fractionUp;
}

/** The loaf and the haunch: the body the head is laid against. */
function traceCatSilhouette(ctx: Ctx, shape: CatShape): void {
  const rise = shape.breath * CAT_BREATH_RISE_PX;
  const bodyHalfHeight = (shape.height * CAT_BODY_HEIGHT + rise) / 2;
  ctx.moveTo(catX(shape, CAT_BODY_CENTRE_X + CAT_BODY_RADIUS_X), shape.sill - bodyHalfHeight);
  ctx.ellipse(
    catX(shape, CAT_BODY_CENTRE_X),
    shape.sill - bodyHalfHeight,
    shape.width * CAT_BODY_RADIUS_X,
    bodyHalfHeight,
    0,
    0,
    Math.PI * 2,
  );
  const haunchHalfHeight = (shape.height * CAT_HAUNCH_HEIGHT + rise) / 2;
  ctx.moveTo(catX(shape, CAT_HAUNCH_CENTRE_X + CAT_HAUNCH_RADIUS_X), shape.sill - haunchHalfHeight);
  ctx.ellipse(
    catX(shape, CAT_HAUNCH_CENTRE_X),
    shape.sill - haunchHalfHeight,
    shape.width * CAT_HAUNCH_RADIUS_X,
    haunchHalfHeight,
    0,
    0,
    Math.PI * 2,
  );
}

/** The head and its two ears, outlined on their own so the head reads apart from the flank. */
function traceCatHead(ctx: Ctx, shape: CatShape): void {
  const head = catHead(shape);
  ctx.moveTo(head.x + head.radius, head.y);
  ctx.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
  for (const side of [-1, 1]) {
    ctx.moveTo(
      head.x + side * head.radius * CAT_EAR_BASE_INNER,
      head.y - head.radius * CAT_EAR_BASE_DROP * 2,
    );
    ctx.lineTo(
      head.x + side * head.radius * CAT_EAR_TIP_OFFSET,
      head.y - head.radius * CAT_EAR_TIP_RISE,
    );
    ctx.lineTo(
      head.x + side * head.radius * CAT_EAR_BASE_OUTER,
      head.y - head.radius * CAT_EAR_BASE_DROP,
    );
    ctx.closePath();
  }
}

function catHead(shape: CatShape): { x: number; y: number; radius: number } {
  const headRise = shape.breath * CAT_BREATH_RISE_PX * CAT_HEAD_BREATH_SHARE;
  return {
    x: catX(shape, CAT_HEAD_CENTRE_X),
    y: catY(shape, CAT_HEAD_CENTRE_Y) - headRise,
    radius: shape.height * CAT_HEAD_RADIUS,
  };
}

function traceCatTail(ctx: Ctx, shape: CatShape): void {
  ctx.moveTo(catX(shape, CAT_TAIL_ROOT_X), catY(shape, CAT_TAIL_ROOT_Y));
  ctx.quadraticCurveTo(
    catX(shape, (CAT_TAIL_ROOT_X + CAT_TAIL_TIP_X) / 2),
    catY(shape, CAT_TAIL_SAG_Y),
    catX(shape, CAT_TAIL_TIP_X),
    catY(shape, CAT_TAIL_TIP_Y),
  );
}

/**
 * A ginger tabby curled asleep on an upstairs sill, in front of the lit glass,
 * its flank rising and falling.
 *
 * Everything that makes a lump read as a cat at 32 px is here on purpose: two
 * pointed ears standing clear of the glow, a tail wrapped round the front, a
 * closed-eye line and cream paws under the chin, all inside a dark rim — the
 * glow behind it is brighter than the coat, and without the rim the ginger
 * melts into the amber and the silhouette is lost.
 *
 * The whole cat lives here rather than in `idle`, because the flank is most of
 * its silhouette and a still copy behind it would read as a second cat.
 */
function paintSleepingCat(
  ctx: Ctx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  const ink = getRamp('ink_outline');
  const shape: CatShape = {
    left: rect.x,
    sill: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    breath: breathEnvelope(phase),
  };
  const tailWidth = rect.height * CAT_TAIL_WIDTH;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  paintSoftBlob(
    ctx,
    catX(shape, CAT_BODY_CENTRE_X),
    shape.sill + CAT_SHADOW_DEPTH_PX,
    rect.width * CAT_SHADOW_SPREAD,
    ink.shadow,
    CAT_SHADOW_ALPHA,
    { scaleX: 1, scaleY: CAT_SHADOW_FLATTEN },
  );

  const coat = (trace: (target: Ctx) => void, stripes: boolean): void => {
    ctx.beginPath();
    trace(ctx);
    ctx.strokeStyle = rgba(ink.mid, 1);
    ctx.lineWidth = CAT_OUTLINE_PX * 2;
    ctx.stroke();
    ctx.fillStyle = rgba(ramp.mid, 1);
    ctx.fill();
    // Lit from above and shaded underneath, clipped to the coat: one flat
    // ginger fill is a cut-out, and a curled cat is the roundest thing on the
    // street.
    ctx.save();
    ctx.clip();
    const lightBand = ctx.createLinearGradient(0, catY(shape, 1), 0, shape.sill);
    lightBand.addColorStop(0, rgba(ramp.light, CAT_BACK_LIGHT_ALPHA));
    lightBand.addColorStop(CAT_LIGHT_FADE_STOP, rgba(ramp.light, 0));
    lightBand.addColorStop(CAT_SHADE_START_STOP, rgba(ramp.shadow, 0));
    lightBand.addColorStop(1, rgba(ramp.shadow, CAT_BELLY_SHADE_ALPHA));
    ctx.fillStyle = lightBand;
    ctx.fillRect(rect.x - rect.width, catY(shape, 2), rect.width * 3, rect.height * 3);
    if (stripes) paintCatStripes(ctx, shape, ramp.shadow);
    ctx.restore();
  };

  coat((target) => traceCatSilhouette(target, shape), true);

  ctx.beginPath();
  traceCatTail(ctx, shape);
  ctx.strokeStyle = rgba(ink.mid, 1);
  ctx.lineWidth = tailWidth + CAT_OUTLINE_PX * 2;
  ctx.stroke();
  ctx.strokeStyle = rgba(ramp.mid, 1);
  ctx.lineWidth = tailWidth;
  ctx.stroke();

  coat((target) => traceCatHead(target, shape), false);

  const head = catHead(shape);
  ctx.save();
  ctx.beginPath();
  ctx.arc(head.x, head.y, head.radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = rgba(ramp.accent, 1);
  ctx.beginPath();
  ctx.arc(
    head.x + head.radius * CAT_MUZZLE_OFFSET_X,
    head.y + head.radius * CAT_MUZZLE_OFFSET_Y,
    head.radius * CAT_MUZZLE_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  // Paws last, tucked under the chin in front of it: cream against the
  // ginger is the one spot of high contrast at the head end.
  const pawHalfHeight = (shape.height * CAT_PAW_HEIGHT) / 2;
  ctx.beginPath();
  ctx.ellipse(
    catX(shape, CAT_PAW_CENTRE_X),
    shape.sill - pawHalfHeight,
    shape.width * CAT_PAW_RADIUS_X,
    pawHalfHeight,
    0,
    0,
    Math.PI * 2,
  );
  ctx.strokeStyle = rgba(ink.mid, 1);
  ctx.lineWidth = CAT_OUTLINE_PX * 2;
  ctx.stroke();
  ctx.fillStyle = rgba(ramp.accent, 1);
  ctx.fill();

  const eyeX = head.x + head.radius * CAT_EYE_OFFSET_X;
  const eyeY = head.y + head.radius * CAT_EYE_OFFSET_Y;
  const eyeHalf = head.radius * CAT_EYE_HALF_WIDTH;
  ctx.strokeStyle = rgba(ink.shadow, 1);
  ctx.lineWidth = CAT_EYE_LINE_PX;
  ctx.beginPath();
  ctx.moveTo(eyeX - eyeHalf, eyeY);
  ctx.quadraticCurveTo(eyeX, eyeY + head.radius * CAT_EYE_DROOP * 2, eyeX + eyeHalf, eyeY);
  ctx.stroke();
  ctx.restore();
}

/** Tabby bars across the back, riding the breath with the flank they are painted on. */
function paintCatStripes(ctx: Ctx, shape: CatShape, color: RGB): void {
  ctx.strokeStyle = rgba(color, CAT_STRIPE_ALPHA);
  ctx.lineWidth = CAT_STRIPE_PX;
  const rise = shape.breath * CAT_BREATH_RISE_PX;
  const length = shape.height * CAT_STRIPE_LENGTH;
  for (const stripeX of CAT_STRIPE_XS) {
    const x = catX(shape, stripeX);
    const top = catY(shape, CAT_HAUNCH_HEIGHT) - rise;
    ctx.beginPath();
    ctx.moveTo(x - CAT_STRIPE_LEAN_PX, top);
    ctx.quadraticCurveTo(x + CAT_STRIPE_LEAN_PX, top + length / 2, x, top + length);
    ctx.stroke();
  }
}

// ── the temple's finial ────────────────────────────────────────────────────

const GLINT_TRAVEL_FRACTION = 1.2;
const GLINT_RADIUS_TILES = 0.2;
const GLINT_ALPHA = 0.8;

function paintFinialGlint(
  ctx: Ctx,
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
  ctx: Ctx,
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
  ctx: Ctx,
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

// ── The Quiet Needle's doorway ───────────────────────────────────────────────────────

const BEAD_STRAND_COUNT = 7;
const BEAD_PER_STRAND = 6;
const BEAD_SWAY_PX = 2.2;
const BEAD_RADIUS_PX = 1.4;

function paintBeadCurtainSway(
  ctx: Ctx,
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

// ── Roost ledges: a skyfowl citizen perched on the roofline ─────────────────

/**
 * The idle bird occupying a skyfowl-run building's roost ledge.
 *
 * Painted here rather than as a static facade decal because a baked silhouette
 * would compete pixel-for-pixel with the citizen figure cache for the same
 * shape once the skyfowl cast exists — this is deliberately a `life` effect,
 * not geometry, so the roost reads as *occupied* rather than decorated. The
 * shape is a legible painted silhouette (head, foreshortened beak, a folded
 * wing with feather-tip notches, two digitigrade legs) rather than a stand-in
 * for the real cast, which has its own rig and belongs to a different module.
 */
const PERCH_BODY_WIDTH_FRACTION = 0.5;
const PERCH_BODY_HEIGHT_FRACTION = 0.56;
const PERCH_HEAD_RADIUS_FRACTION = 0.22;
const PERCH_BEAK_LENGTH_FRACTION = 0.16;
const PERCH_LEG_HEIGHT_FRACTION = 0.22;
const PERCH_BOB_PX = 1.4;
const PERCH_HEAD_TURN_PX = 1.6;
/** Feather-tip notches along the folded wing's trailing edge. */
const PERCH_WING_NOTCHES = 4;
const PERCH_WING_NOTCH_DEPTH_FRACTION = 0.08;

/**
 * Life effects carry no shared silhouette-outline pass of their own — that
 * runs once, over the idle bake, and a roof-life cell is composited over it
 * separately — so a bird painted in flat fills alone has no dark line to
 * separate it from the roof and sky behind it and reads as a soft blob of
 * colour. Every shape below is stroked with this same dark ink as it is
 * filled, the same "silhouette gets a line, nothing internal does" rule the
 * rest of the town's outline policy already follows.
 */
const PERCH_OUTLINE_WIDTH_PX = 1;

function paintRoofPerch(
  ctx: Ctx,
  projection: Projection,
  effect: LifeEffectSpec,
  phase: number,
  seed: number,
): void {
  const rect = effectRect(projection, effect);
  const ramp = getRamp(effect.ramp);
  // Sampled from the shadow half of the ramp: a bird on a roost ledge reads
  // against open sky, and a dark, near-silhouette body is what separates it
  // from the building rather than blending into whatever ramp it was handed.
  const body = sampleRamp(ramp, 0.16);
  const shade = sampleRamp(ramp, 0.04);
  const accent = sampleRamp(ramp, 0.88);
  const ink = sampleRamp(getRamp('ink_outline'), 0.2);
  ctx.lineJoin = 'round';

  // A slow settle-and-lift bob, plus an occasional head turn — enough
  // per-frame ink to register at the 32px display tile; near-zero deltas read
  // as a still roof.
  const bob = pulseEnvelope(phase) * PERCH_BOB_PX;
  const headTurn = (loopNoise(seed, 0, phase) - 0.5) * 2 * PERCH_HEAD_TURN_PX;

  const legHeight = rect.height * PERCH_LEG_HEIGHT_FRACTION;
  const footY = rect.y + rect.height - bob;
  const bodyBottomY = footY - legHeight;
  const bodyWidth = rect.width * PERCH_BODY_WIDTH_FRACTION;
  const bodyHeight = rect.height * PERCH_BODY_HEIGHT_FRACTION;
  const centreX = rect.x + rect.width / 2;

  ctx.strokeStyle = rgba(ink, 0.9);
  ctx.lineWidth = Math.max(1, rect.width * 0.05);
  ctx.lineCap = 'round';
  const legSpread = bodyWidth * 0.18;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(centreX + side * legSpread, bodyBottomY);
    ctx.lineTo(centreX + side * legSpread * 1.3, footY);
    ctx.stroke();
  }

  ctx.lineWidth = PERCH_OUTLINE_WIDTH_PX;
  ctx.strokeStyle = rgba(ink, 0.95);
  ctx.fillStyle = rgba(body, 1);
  ctx.beginPath();
  ctx.ellipse(
    centreX,
    bodyBottomY - bodyHeight / 2,
    bodyWidth / 2,
    bodyHeight / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.stroke();

  // The folded wing: a lens over the body's trailing half, with a few
  // feather-tip notches cut into its lower edge so it doesn't read as a blob.
  // Unoutlined — it sits entirely inside the body's own outlined silhouette,
  // and a second line here would be the internal seam the town's outline
  // policy reserves for nothing but a shape's outer edge.
  ctx.fillStyle = rgba(shade, 1);
  ctx.beginPath();
  ctx.ellipse(
    centreX + bodyWidth * 0.08,
    bodyBottomY - bodyHeight * 0.42,
    bodyWidth * 0.4,
    bodyHeight * 0.44,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  const notchY = bodyBottomY - bodyHeight * 0.12;
  const notchSpan = bodyWidth * 0.5;
  ctx.fillStyle = rgba(body, 1);
  for (let notch = 0; notch < PERCH_WING_NOTCHES; notch++) {
    const t = (notch + 0.5) / PERCH_WING_NOTCHES;
    const x = centreX - notchSpan * 0.1 + notchSpan * t;
    ctx.beginPath();
    ctx.moveTo(x, notchY);
    ctx.lineTo(
      x + notchSpan / PERCH_WING_NOTCHES / 2,
      notchY + bodyHeight * PERCH_WING_NOTCH_DEPTH_FRACTION,
    );
    ctx.lineTo(x + notchSpan / PERCH_WING_NOTCHES, notchY);
    ctx.closePath();
    ctx.fill();
  }

  // A short tail wedge behind the body, so the rear silhouette isn't just the
  // folded wing's own curve — kept small to stay inside the effect's ink
  // budget.
  const tailLength = bodyWidth * 0.22;
  ctx.fillStyle = rgba(shade, 1);
  ctx.beginPath();
  ctx.moveTo(centreX + bodyWidth * 0.44, bodyBottomY - bodyHeight * 0.52);
  ctx.lineTo(centreX + bodyWidth * 0.44 + tailLength, bodyBottomY - bodyHeight * 0.6);
  ctx.lineTo(centreX + bodyWidth * 0.44, bodyBottomY - bodyHeight * 0.38);
  ctx.closePath();
  ctx.fill();

  // Head, forward of the body and turning gently on the loop.
  const headRadius = rect.width * PERCH_HEAD_RADIUS_FRACTION;
  const headY = bodyBottomY - bodyHeight - headRadius * 0.4;
  const headX = centreX - bodyWidth * 0.32 + headTurn;
  ctx.fillStyle = rgba(body, 1);
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // A hooked beak, not a straight spike — the down-turned tip is most of what
  // reads as "bird of prey" rather than "duck" at this size.
  const beakLength = rect.width * PERCH_BEAK_LENGTH_FRACTION;
  ctx.fillStyle = rgba(accent, 1);
  ctx.beginPath();
  ctx.moveTo(headX - headRadius * 0.8, headY - headRadius * 0.2);
  ctx.quadraticCurveTo(
    headX - headRadius * 0.8 - beakLength,
    headY - beakLength * 0.15,
    headX - headRadius * 0.8 - beakLength * 0.85,
    headY + beakLength * 0.35,
  );
  ctx.lineTo(headX - headRadius * 0.8, headY + headRadius * 0.3);
  ctx.closePath();
  ctx.fill();
}
