/**
 * The lighting rig: a key light that snaps on over the two crawlers
 * during the reveal and holds there, and two fainter searchlights that sweep
 * the hall slowly while the idle loop runs. Each is a soft cone of haze from
 * above the screen to a pool on the floor, added over the dark.
 *
 * This layer owns how bright the key light is: it writes `stage.lights.spotlight`
 * every update, and the heroes read it to come up out of the dark. Every level
 * is a function of the clock; the one thing remembered is how bright the key
 * light was when a dive began, because a dive only ever dims it from there.
 */

import { TILE_SIZE } from '../../../core/constants';
import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../../../core/rendering/canvasSurface';
import { canvasGeneration } from '../../../core/rendering/canvasRecovery';
import { renderQuality } from '../../../core/perf/RenderQuality';
import { TITLE_INK, titleRgba, type TitleRgb } from '../../../ui/theme/titleInk';
import type { TitleClock } from '../titleClock';
import { applyTitleCamera, type TitleDepth, type TitleLayer, type TitlePoint } from '../titleLayer';
import type { TitleStage } from '../titleStage';
import { SPOTLIGHT_ON_AT_MS } from '../titleTimeline';

/** The key light rides the heroes' plane, so its pool stays under their feet as the camera drifts. */
const KEY_DEPTH: TitleDepth = 0.8;
/** The searchlights land on the floor further back, between the heroes and the hall. */
const SWEEP_DEPTH: TitleDepth = 0.5;

// ── how bright the key light is ──────────────────────────────────────────────

/**
 * The key light catches like an arc lamp: on, a stutter, then on for good,
 * flaring past full and settling. Times are from the spotlight cue.
 */
const STUTTER_OFF_AT_MS = 55;
const STUTTER_ON_AT_MS = 105;
const STUTTER_LEVEL = 0.35;
const SNAP_FLARE_PEAK = 0.45;
const SNAP_FLARE_SETTLE_MS = 420;
/** With reduced motion the key light fades up with no stutter or flare. */
const REDUCED_FADE_IN_MS = 240;
/** The dive dims the key light slowly at first, then all at once, with the torches. */
const DIVE_EASE_EXPONENT = 2;
/** How much the music's energy brightens the rig: a breath, not a strobe. */
const MUSIC_PULSE_GAIN = 0.1;

// ── the key light's shape ────────────────────────────────────────────────────

/** Where the lamp hangs, above the screen and a little toward its middle from the heroes. */
const KEY_SOURCE_ABOVE_SHARE = 0.12;
const KEY_SOURCE_TOWARD_CENTRE = 0.3;
/** The pool on the floor round the heroes, in hero tiles. */
const KEY_POOL_RADIUS_TILES = 1.55;
/** The pool's centre sits a little behind the feet, so the light falls across them. */
const KEY_POOL_BEHIND_TILES = 0.08;
const KEY_BEAM_ALPHA = 0.32;
const KEY_POOL_ALPHA = 0.45;

// ── the searchlights ─────────────────────────────────────────────────────────

/** Each lamp hangs above one top corner; the two sweep out of step with each other. */
const LEFT_LAMP_X_SHARE = 0.14;
const RIGHT_LAMP_X_SHARE = 0.86;
const SWEEP_SOURCE_X_SHARES = [LEFT_LAMP_X_SHARE, RIGHT_LAMP_X_SHARE] as const;
const SWEEP_SOURCE_ABOVE_SHARE = 0.1;
/** One full sweep, there and back: slow enough to read as a show warming up, not a disco. */
const SWEEP_PERIOD_MS = 15000;
/** The second lamp's sweep starts this far round its cycle from the first. */
const SWEEP_PHASE_STEP = 0.43;
/** How far each pool swings either side of the hall's middle, as a share of the width. */
const SWEEP_SWING_SHARE = 0.32;
/** Where the pools land, as a share of the way from the horizon down to the heroes' floor line. */
const SWEEP_FLOOR_SHARE = 0.4;
const SWEEP_POOL_RADIUS_TILES = 1.05;
const SWEEP_BEAM_ALPHA = 0.14;
const SWEEP_POOL_ALPHA = 0.22;
/** The searchlights come up after the reveal, over this long, rather than popping on. */
const SWEEP_FADE_IN_MS = 1400;

// ── the baked shapes ─────────────────────────────────────────────────────────

/** The cone of haze, baked once: narrow at the lamp, as wide as its pool at the floor. */
const BEAM_TEXTURE_WIDTH = 64;
const BEAM_TEXTURE_HEIGHT = 256;
const BEAM_TOP_WIDTH_SHARE = 0.1;
/**
 * The haze is dense near the lamp and has all but thinned out by the time it
 * reaches the heroes, so it lights the air above them without washing them out.
 */
const BEAM_TOP_ALPHA = 1;
const BEAM_BOTTOM_ALPHA = 0.1;
const BEAM_THINNING_EXPONENT = 1.3;
/** Across the cone, light holds near its axis and falls away to nothing at its edges. */
const BEAM_EDGE_FALLOFF: readonly { readonly at: number; readonly weight: number }[] = [
  { at: 0, weight: 0 },
  { at: 0.28, weight: 0.55 },
  { at: 0.5, weight: 1 },
  { at: 0.72, weight: 0.55 },
  { at: 1, weight: 0 },
];
const POOL_TEXTURE_PX = 128;
const POOL_FALLOFF: readonly { readonly at: number; readonly weight: number }[] = [
  { at: 0, weight: 1 },
  { at: 0.45, weight: 0.75 },
  { at: 0.8, weight: 0.25 },
  { at: 1, weight: 0 },
];
/** The floor is seen at a glancing angle, so a pool is an ellipse this much flatter than wide. */
const POOL_SQUASH = 0.26;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI * HALF;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The key light during the reveal, past full while it flares; 0 before its cue. */
function keyLevelInIgnition(clock: TitleClock): number {
  const sinceOn = clock.stateElapsedMs - SPOTLIGHT_ON_AT_MS;
  if (sinceOn < 0) return 0;
  if (clock.reducedMotion) return clamp01(sinceOn / REDUCED_FADE_IN_MS);
  if (sinceOn >= STUTTER_OFF_AT_MS && sinceOn < STUTTER_ON_AT_MS) return STUTTER_LEVEL;
  const flare = SNAP_FLARE_PEAK * clamp01(1 - sinceOn / SNAP_FLARE_SETTLE_MS);
  return 1 + flare;
}

function keyLevel(clock: TitleClock, levelAtDive: number): number {
  switch (clock.state) {
    case 'dormant':
      return 0;
    case 'ignition':
      return keyLevelInIgnition(clock);
    case 'alive':
      return 1;
    case 'dive':
      return levelAtDive * (1 - Math.pow(clock.diveProgress, DIVE_EASE_EXPONENT));
  }
}

/** How far the searchlights are up, 0 to 1: only in the idle loop, and never for less motion. */
function sweepLevel(clock: TitleClock, levelAtDive: number): number {
  if (clock.reducedMotion) return 0;
  if (clock.state === 'alive') return clamp01(clock.stateElapsedMs / SWEEP_FADE_IN_MS);
  if (clock.state === 'dive') {
    return levelAtDive * (1 - Math.pow(clock.diveProgress, DIVE_EASE_EXPONENT));
  }
  return 0;
}

function bakeBeam(ink: TitleRgb): CanvasSurface {
  const texture = allocCanvas('title', BEAM_TEXTURE_WIDTH, BEAM_TEXTURE_HEIGHT);
  const ctx = surfaceContext(texture);
  const centre = BEAM_TEXTURE_WIDTH * HALF;
  for (let row = 0; row < BEAM_TEXTURE_HEIGHT; row++) {
    const down = row / (BEAM_TEXTURE_HEIGHT - 1);
    const halfWidth = centre * (BEAM_TOP_WIDTH_SHARE + (1 - BEAM_TOP_WIDTH_SHARE) * down);
    const thinning = 1 - Math.pow(1 - down, BEAM_THINNING_EXPONENT);
    const strength = BEAM_TOP_ALPHA + (BEAM_BOTTOM_ALPHA - BEAM_TOP_ALPHA) * thinning;
    const across = ctx.createLinearGradient(centre - halfWidth, 0, centre + halfWidth, 0);
    for (const { at, weight } of BEAM_EDGE_FALLOFF) {
      across.addColorStop(at, titleRgba(ink, strength * weight));
    }
    ctx.fillStyle = across;
    ctx.fillRect(centre - halfWidth, row, halfWidth * 2, 1);
  }
  return texture;
}

function bakePool(ink: TitleRgb): CanvasSurface {
  const texture = allocCanvas('title', POOL_TEXTURE_PX, POOL_TEXTURE_PX);
  const ctx = surfaceContext(texture);
  const centre = POOL_TEXTURE_PX * HALF;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  for (const { at, weight } of POOL_FALLOFF) gradient.addColorStop(at, titleRgba(ink, weight));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POOL_TEXTURE_PX, POOL_TEXTURE_PX);
  return texture;
}

interface RigTextures {
  readonly keyBeam: CanvasSurface;
  readonly keyPool: CanvasSurface;
  readonly sweepBeam: CanvasSurface;
  readonly sweepPool: CanvasSurface;
  readonly generation: number;
}

interface Lamp {
  readonly source: TitlePoint;
  readonly target: TitlePoint;
  readonly poolRadius: number;
  readonly beamAlpha: number;
  readonly poolAlpha: number;
}

/** A cone of haze from the lamp to its pool, and the pool itself. */
function paintLamp(
  ctx: CanvasRenderingContext2D,
  lamp: Lamp,
  beam: CanvasSurface,
  pool: CanvasSurface,
): void {
  const { source, target, poolRadius } = lamp;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return;
  ctx.save();
  ctx.translate(source.x, source.y);
  ctx.rotate(Math.atan2(dy, dx) - QUARTER_TURN);
  ctx.globalAlpha = clamp01(lamp.beamAlpha);
  ctx.drawImage(beam, -poolRadius, 0, poolRadius * 2, length);
  ctx.restore();

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.scale(1, POOL_SQUASH);
  ctx.globalAlpha = clamp01(lamp.poolAlpha);
  ctx.drawImage(pool, -poolRadius, -poolRadius, poolRadius * 2, poolRadius * 2);
  ctx.restore();
}

function keyLamp(stage: TitleStage, level: number): Lamp {
  const tile = TILE_SIZE * stage.heroScale;
  const { heroSpot } = stage;
  const centreX = stage.width * HALF;
  return {
    source: {
      x: heroSpot.x + (centreX - heroSpot.x) * KEY_SOURCE_TOWARD_CENTRE,
      y: -stage.height * KEY_SOURCE_ABOVE_SHARE,
    },
    target: { x: heroSpot.x, y: heroSpot.y - KEY_POOL_BEHIND_TILES * tile },
    poolRadius: KEY_POOL_RADIUS_TILES * tile,
    beamAlpha: KEY_BEAM_ALPHA * level,
    poolAlpha: KEY_POOL_ALPHA * level,
  };
}

function sweepLamps(stage: TitleStage, clock: TitleClock, level: number): Lamp[] {
  const tile = TILE_SIZE * stage.heroScale;
  const floorY = stage.horizonY + (stage.floorY - stage.horizonY) * SWEEP_FLOOR_SHARE;
  const centreX = stage.width * HALF;
  return SWEEP_SOURCE_X_SHARES.map((sourceShare, index) => {
    const turn = clock.elapsedMs / SWEEP_PERIOD_MS + index * SWEEP_PHASE_STEP;
    const swing = Math.sin(turn * FULL_TURN) * SWEEP_SWING_SHARE * stage.width;
    return {
      source: { x: sourceShare * stage.width, y: -stage.height * SWEEP_SOURCE_ABOVE_SHARE },
      target: { x: centreX + swing, y: floorY },
      poolRadius: SWEEP_POOL_RADIUS_TILES * tile,
      beamAlpha: SWEEP_BEAM_ALPHA * level,
      poolAlpha: SWEEP_POOL_ALPHA * level,
    };
  });
}

export function spotlightLayer(): TitleLayer {
  let textures: RigTextures | null = null;
  // Until an update has run, the stage is as the scene opens it: dark.
  let latestKey = 0;
  let latestSweep = 0;
  let keyAtDive = 0;
  let sweepAtDive = 0;
  let key = 0;
  let sweep = 0;

  const releaseTextures = (): void => {
    const baked = textures;
    if (baked === null) return;
    for (const texture of [baked.keyBeam, baked.keyPool, baked.sweepBeam, baked.sweepPool]) {
      releaseSurface(texture);
    }
    textures = null;
  };

  const currentTextures = (): RigTextures => {
    const generation = canvasGeneration();
    if (textures !== null && textures.generation === generation) return textures;
    releaseTextures();
    const ink = TITLE_INK.spotlight;
    const baked: RigTextures = {
      keyBeam: bakeBeam(ink.beam),
      keyPool: bakePool(ink.pool),
      sweepBeam: bakeBeam(ink.sweep),
      sweepPool: bakePool(ink.sweep),
      generation,
    };
    textures = baked;
    return baked;
  };

  return {
    id: 'spotlight',
    depth: KEY_DEPTH,
    update: (clock, stage) => {
      key = keyLevel(clock, keyAtDive);
      sweep = sweepLevel(clock, sweepAtDive);
      if (clock.state !== 'dive') {
        latestKey = key;
        latestSweep = sweep;
      }
      stage.lights.spotlight = clamp01(key);
    },
    onCue: (cue) => {
      // A moment entered part-way hands over every cue before it with no update between, so the cues themselves say where the rig stands.
      if (cue === 'settle') {
        latestKey = 1;
        latestSweep = 1;
      }
      if (cue === 'diveStart') {
        keyAtDive = latestKey;
        sweepAtDive = latestSweep;
      }
    },
    render: (ctx, clock, stage, camera) => {
      if (key <= 0 && sweep <= 0) return;
      const baked = currentTextures();
      const pulse = 1 + MUSIC_PULSE_GAIN * clock.musicPulse;
      ctx.globalCompositeOperation = 'lighter';
      if (sweep > 0 && renderQuality.fullDetail) {
        ctx.save();
        applyTitleCamera(ctx, camera, SWEEP_DEPTH);
        for (const lamp of sweepLamps(stage, clock, sweep * pulse)) {
          paintLamp(ctx, lamp, baked.sweepBeam, baked.sweepPool);
        }
        ctx.restore();
      }
      if (key > 0) {
        applyTitleCamera(ctx, camera, KEY_DEPTH);
        paintLamp(ctx, keyLamp(stage, key * pulse), baked.keyBeam, baked.keyPool);
      }
    },
    dispose: releaseTextures,
  };
}
