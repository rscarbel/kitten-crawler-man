/**
 * Draws a stairwell's seal in the world: the locked seal with its padlock's
 * slow glint, the unseal scene beat by beat, and the note over a seal a
 * crawler stepped onto without the key.
 *
 * Pure functions of what the stairwell system hands them. The seal's poses
 * come from the `stairwell_seal` sheet; what moves freely over them — the
 * key in flight, its sparks, the light, the motes and the dust — is painted
 * here each frame. Positions are world-view pixels, camera already taken off.
 */

import type { KeyKind } from '../core/keys/keyKinds';
import { drawSpriteKey } from '../core/spriteAssets/SpriteRenderer';
import { FULL_TURN_YAWS, paintKey, paintKeyTurned, warmKeyArt } from '../sprites/art/keyArt';
import { TIP as KEY_TIP } from '../sprites/art/keyArtShape';
import type { StairwellStyleId } from '../sprites/art/stairwellArt';
import {
  sealLockPoints,
  SEAL_COVER_FRAMES,
  sealOpenCell,
  type SealFrameId,
} from '../sprites/art/stairwellSealArt';
import { STAIRWELL_SEAL_SHEETS } from '../sprites/sheets/stairwellSealSheets';
import { hasEnvironmentSheet } from '../map/environmentArtCache';
import { withAlpha } from '../ui/theme/color';
import { rgbInkAt, worldPalette } from '../ui/theme/worldInk';
import { measureWorldText, worldText } from '../ui/world/worldText';
import { worldPlate } from '../ui/world/worldShapes';
import { clamp } from '../utils';
import { FULL_TURN, smoothstep } from '../sprites/lightMaps';
import { hashLattice } from '../map/tilegen/noise';
import { COVER_SETTLE_FRAMES, coverHitFrames, type UnsealBeat } from './stairwellUnseal';

type Ctx = CanvasRenderingContext2D;

interface Pt {
  readonly x: number;
  readonly y: number;
}

const SEAL_INK = worldPalette.stairwellSeal;

/** Where a seal is drawn: its footprint's top-left corner and side, in world-view pixels. */
export interface SealPlacement {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly style: StairwellStyleId;
}

/** What a seal is doing this frame. */
export type SealView =
  /**
   * Locked. `rattle` runs 1 to 0 after a crawler tried it without the key,
   * and `rattleTick` counts world ticks since, which the shake is timed by.
   */
  | { readonly kind: 'sealed'; readonly rattle: number; readonly rattleTick: number }
  | {
      readonly kind: 'unsealing';
      /** Null while the scene is queued behind another and has not begun. */
      readonly beat: UnsealBeat | null;
      /** World ticks into the beat. */
      readonly beatFrame: number;
      readonly beatLength: number;
      readonly reducedMotion: boolean;
    };

// ── Timing and size of what moves ───────────────────────────────────────────

const GLINT_PERIOD_MS = 2600;
/** The glint shows for this share of its period, so it reads as a catch of light, not a lamp. */
const GLINT_SHOW_SHARE = 0.35;
const GLINT_RADIUS = 0.075;
const GLINT_OFFSET = { x: -0.055, y: -0.035 } as const;
const GLINT_ARMS = 4;
const GLINT_WAIST = 0.22;

/** The padlock yanked and the chains rattling, in world pixels. */
const RATTLE_PX = 1.6;
/** Radians of the rattle's swing per world tick: about eighteen yanks a second. */
const RATTLE_RATE = 1.9;
/** The padlock shuddering as the key's last turn takes. */
const SHUDDER_PX = 1.2;
const SHUDDER_RATE = 2.7;
const SHUDDER_FROM = 0.55;

/** The key as it rises out of the Keys button, in world-view pixels. */
const KEY_DOCK_SIZE_PX = 26;
/** The key in the lock, as a share of the footprint. */
const KEY_IN_LOCK_SIZE = 0.34;
/** How far the key's tip is from its middle, as a share of its length. */
const KEY_TIP_REACH = KEY_TIP.x + KEY_TIP.radius;
/** How far the key sinks into the hole once seated, as a share of its length. */
const KEY_SEATED_DEPTH = 0.12;
/** The key slides home over this first share of the turn beat, then turns. */
const KEY_SEAT_SHARE = 0.15;
/** Over this last share of its flight the key tips from lying level to pointing down at the hole. */
const KEY_TIP_DOWN_SHARE = 0.3;
/** Pointing straight down the screen: the padlock lies on the cover, its keyhole facing up. */
const KEY_POINTING_DOWN = Math.PI / 2;
/** The flight's arc rises this share of its length above the straight line. */
const KEY_ARC_RISE = 0.3;
const KEY_SPARKS = 12;
/** How far behind the key each spark is, as a share of the flight. */
const KEY_SPARK_LAG = 0.022;
const KEY_SPARK_RADIUS_PX = 2.2;
const KEY_SPARK_SCATTER_PX = 5;
/** The key goes a quarter turn in this share of its turning, then the rest of a full turn. */
const KEY_QUARTER_SHARE = 0.4;
/** A full turn brings the key's bow back to facing the viewer. */
const KEY_TURNED_HOME = 0;

/** Turn poses through the turn beat. */
const TURN_FRAMES: readonly SealFrameId[] = ['turnQuarter', 'turnHalf', 'turnFull'];

/** The light's reach never quite closes to nothing, so its first frame still clips to a pixel. */
const RUNE_CLIP_MIN_PX = 1;
/** How far the gold light runs from the padlock, as a share of the footprint. */
const RUNE_REACH = 0.9;

/** Poses through the burst beat, in turn. */
const BURST_FRAMES: readonly SealFrameId[] = ['burst', 'chainsSlack', 'chainsFalling'];
const BURST_MOTES = 26;
const BURST_REACH = 0.55;
const BURST_MOTE_RADIUS_PX = 2.4;
/** The key dissolves with the padlock in the first share of the burst. */
const KEY_DISSOLVE_SHARE = 0.3;

const DUST_PUFFS = 12;
const DUST_REACH = 0.32;
const DUST_RADIUS = 0.11;
const DUST_ALPHA = 0.35;
const GUST_MOTES = 30;
const GUST_RISE = 0.9;
const GUST_MOTE_RADIUS_PX = 2;

const LIGHT_RADIUS = 0.75;
const LIGHT_ALPHA = 0.55;
/** The light swells over the first share of its beat, then settles. */
const LIGHT_SWELL_SHARE = 0.35;

const BANNER_RISE = 0.35;
const BANNER_FADE_SHARE = 0.25;
const BANNER_GLOW_BLUR = 10;

const NOTICE_PADDING_X = 7;
const NOTICE_PADDING_Y = 4;
const NOTICE_LIFT = 0.18;
const NOTICE_FADE_SHARE = 0.2;

/** The middle of a 0..1 scatter, to centre a jitter on zero. */
const HALF = 0.5;
const SCATTER_SEED = 0x5ea1;
/** Which scatter stream each use draws from, so no two share a pattern. */
const SCATTER_STREAM = {
  burstAngle: 1,
  burstReach: 2,
  dustAngle: 3,
  gustX: 4,
  gustY: 5,
  gustRise: 6,
} as const;

/** A fixed scatter in 0..1 per index, so the same mote takes the same line every frame. */
function moteScatter(index: number, salt: number): number {
  return hashLattice(index, salt, SCATTER_SEED);
}

/** A burst mote starts this share of the way out, so the padlock's own outline is never a hole. */
const BURST_INNER_SHARE = 0.35;
/** Motes shrink to this share of their size as the burst spends itself. */
const BURST_MOTE_SHRINK = 0.5;
/** The key's full turn after its quarter: three more quarters. */
const QUARTERS_AFTER_THE_FIRST = 3;
const KEY_REST_OF_TURN = (Math.PI / 2) * QUARTERS_AFTER_THE_FIRST;
/** The faintest spark is still this many pixels across. */
const KEY_SPARK_MIN_RADIUS_PX = 0.5;
const FOOTPRINT_CENTER = { x: 0.5, y: 0.5 } as const;
/** Dust starts where the cover's edges were, a little inside the footprint's half. */
const DUST_START = 0.3;
/** Seen from above at a slant, a ring of dust is squashed top to bottom. */
const DUST_SQUASH = 0.7;
const DUST_GROWTH = 0.6;
/** Gust motes rise from anywhere over the opening. */
const GUST_SPAN = { left: 0.1, width: 0.8, top: 0.15, height: 0.75 } as const;
const GUST_RISE_SPREAD = 0.5;
/** After its swell the light settles to this share of its peak. */
const LIGHT_SETTLE_DROP = 0.5;

/** A footprint fraction across, in world-view pixels. */
function atX(p: SealPlacement, fraction: number): number {
  return p.x + fraction * p.size;
}

/** A footprint fraction down, in world-view pixels. */
function atY(p: SealPlacement, fraction: number): number {
  return p.y + fraction * p.size;
}

function pickByProgress(frames: readonly SealFrameId[], progress: number): SealFrameId {
  const index = Math.min(frames.length - 1, Math.floor(clamp(progress, 0, 1) * frames.length));
  return frames[index] ?? 'sealed';
}

function drawSealFrame(
  ctx: Ctx,
  p: SealPlacement,
  frame: SealFrameId,
  dx = 0,
  dy = 0,
  alpha = 1,
): void {
  const sheets = STAIRWELL_SEAL_SHEETS[p.style];
  const x = p.x + dx;
  const y = p.y + dy;
  // The opening poses are painted as a key comes near; until they land, the seal stays shut.
  if (frame === 'sealed' || !hasEnvironmentSheet(sheets.open)) {
    drawSpriteKey(ctx, sheets.locked, 'sealed', 0, x, y, p.size, { alpha });
    return;
  }
  const cell = sealOpenCell(frame);
  drawSpriteKey(ctx, sheets.open, cell.row, cell.column, x, y, p.size, { alpha });
}

function paintGlint(ctx: Ctx, p: SealPlacement, nowMs: number): void {
  const phase = (nowMs % GLINT_PERIOD_MS) / GLINT_PERIOD_MS;
  if (phase > GLINT_SHOW_SHARE) return;
  const flare = Math.sin((phase / GLINT_SHOW_SHARE) * Math.PI);
  const centerX = atX(p, sealLockPoints(p.style).padlock.x + GLINT_OFFSET.x);
  const centerY = atY(p, sealLockPoints(p.style).padlock.y + GLINT_OFFSET.y);
  const reach = GLINT_RADIUS * p.size * flare;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = flare;
  ctx.beginPath();
  for (let arm = 0; arm < GLINT_ARMS * 2; arm++) {
    const angle = (arm / (GLINT_ARMS * 2)) * FULL_TURN;
    const r = arm % 2 === 0 ? reach : reach * GLINT_WAIST;
    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;
    if (arm === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = SEAL_INK.glint;
  ctx.fill();
  ctx.restore();
}

/** The seal and what it is doing, drawn over its stairwell as part of the floor. */
export function paintSealGround(ctx: Ctx, p: SealPlacement, view: SealView, nowMs: number): void {
  if (view.kind === 'sealed') {
    const shake = view.rattle * RATTLE_PX;
    const dx = Math.sin(view.rattleTick * RATTLE_RATE) * shake;
    drawSealFrame(ctx, p, 'sealed', dx, 0);
    paintGlint(ctx, p, nowMs);
    return;
  }
  const beat = view.beat;
  const progress = view.beatLength <= 0 ? 1 : clamp(view.beatFrame / view.beatLength, 0, 1);
  switch (beat) {
    case null:
    case 'approach':
    case 'keyFlight':
      drawSealFrame(ctx, p, 'sealed');
      paintGlint(ctx, p, nowMs);
      return;
    case 'keyTurn': {
      const shudder =
        progress > SHUDDER_FROM && !view.reducedMotion
          ? Math.sin(view.beatFrame * SHUDDER_RATE) * SHUDDER_PX
          : 0;
      drawSealFrame(ctx, p, pickByProgress(TURN_FRAMES, progress), shudder, 0);
      return;
    }
    case 'runes': {
      drawSealFrame(ctx, p, 'turnFull');
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        atX(p, sealLockPoints(p.style).padlock.x),
        atY(p, sealLockPoints(p.style).padlock.y),
        RUNE_REACH * p.size * smoothstep(0, 1, progress) + RUNE_CLIP_MIN_PX,
        0,
        FULL_TURN,
      );
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      drawSealFrame(ctx, p, 'runes');
      ctx.restore();
      return;
    }
    case 'burst':
      drawSealFrame(ctx, p, pickByProgress(BURST_FRAMES, progress));
      return;
    case 'cover':
      paintCoverBeat(ctx, p, view);
      return;
    case 'light':
    case 'return':
      return;
    default: {
      const unhandled: never = beat;
      return unhandled;
    }
  }
}

/** The cover's drawn angle nearest `progress` of the way open, starting from shut. */
function coverFrameAt(progress: number): SealFrameId {
  const step = Math.round(clamp(progress, 0, 1) * SEAL_COVER_FRAMES.length);
  return step === 0 ? 'chainsFalling' : (SEAL_COVER_FRAMES[step - 1] ?? 'cover8');
}

function paintCoverBeat(
  ctx: Ctx,
  p: SealPlacement,
  view: Extract<SealView, { kind: 'unsealing' }>,
): void {
  const hit = coverHitFrames(p.style);
  if (view.reducedMotion) {
    drawSealFrame(ctx, p, 'chainsFalling', 0, 0, 1 - clamp(view.beatFrame / hit, 0, 1));
    return;
  }
  if (view.beatFrame < hit) {
    drawSealFrame(ctx, p, coverFrameAt(view.beatFrame / hit));
    return;
  }
  const settle = clamp((view.beatFrame - hit) / COVER_SETTLE_FRAMES, 0, 1);
  drawSealFrame(ctx, p, 'cover8', 0, 0, 1 - settle);
}

/** Where the key is in its flight, how big, and how it trails. */
function keyFlightAt(from: Pt, to: Pt, t: number): Pt {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * distance * KEY_ARC_RISE,
  };
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL_TURN);
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface UnsealAbove {
  /** The Keys button's centre in world-view pixels, or null when it is not on screen. */
  readonly keyFrom: Pt | null;
  readonly keyKind: KeyKind;
  /** "The way down is open", or the run-end floor's words. */
  readonly banner: string;
}

/**
 * What crosses in front of everything during the unseal: the key, its sparks,
 * the burst, the dust and the gust, the light from below and the banner.
 */
export function paintUnsealAbove(
  ctx: Ctx,
  p: SealPlacement,
  view: Extract<SealView, { kind: 'unsealing' }>,
  above: UnsealAbove,
): void {
  const beat = view.beat;
  if (beat === null) return;
  const progress = view.beatLength <= 0 ? 1 : clamp(view.beatFrame / view.beatLength, 0, 1);
  const lockSize = KEY_IN_LOCK_SIZE * p.size;
  const keyhole = sealLockPoints(p.style).keyhole;
  const holeX = atX(p, keyhole.x);
  const holeY = atY(p, keyhole.y);
  if (beat === 'approach' || beat === 'keyFlight') {
    // Every angle the key turns through is baked while it is on its way.
    warmKeyArt(ctx, lockSize, above.keyKind, [{ look: 'key', yaws: FULL_TURN_YAWS }]);
  }
  switch (beat) {
    case 'approach':
      return;
    case 'keyFlight': {
      const t = smoothstep(0, 1, progress);
      const tilt =
        KEY_POINTING_DOWN * smoothstep(0, 1, (t - (1 - KEY_TIP_DOWN_SHARE)) / KEY_TIP_DOWN_SHARE);
      // Aimed so that, tipped as it is by then, its tip lands in the hole.
      const tipReach = KEY_TIP_REACH * lockSize;
      const landing = {
        x: holeX - Math.cos(tilt) * tipReach,
        y: holeY - Math.sin(tilt) * tipReach,
      };
      const from = above.keyFrom ?? { x: landing.x, y: landing.y - p.size };
      for (let spark = KEY_SPARKS; spark >= 1; spark--) {
        const lagged = t - spark * KEY_SPARK_LAG;
        if (lagged <= 0) continue;
        const at = keyFlightAt(from, landing, lagged);
        const fade = 1 - spark / (KEY_SPARKS + 1);
        const jitterX = (moteScatter(spark, view.beatFrame) - HALF) * KEY_SPARK_SCATTER_PX;
        const jitterY =
          (moteScatter(spark + KEY_SPARKS, view.beatFrame) - HALF) * KEY_SPARK_SCATTER_PX;
        ctx.save();
        ctx.globalAlpha = fade;
        disc(
          ctx,
          at.x + jitterX,
          at.y + jitterY,
          KEY_SPARK_RADIUS_PX * fade + KEY_SPARK_MIN_RADIUS_PX,
          SEAL_INK.mote,
        );
        ctx.restore();
      }
      const at = keyFlightAt(from, landing, t);
      const size = KEY_DOCK_SIZE_PX + (lockSize - KEY_DOCK_SIZE_PX) * t;
      // Tipping over in the plane of the screen, as it drops toward the hole.
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate(tilt);
      paintKey(ctx, 0, 0, size, above.keyKind, progress, Math.max(KEY_DOCK_SIZE_PX, lockSize));
      ctx.restore();
      return;
    }
    case 'keyTurn': {
      const seated = smoothstep(0, 1, progress / KEY_SEAT_SHARE);
      const turning = clamp((progress - KEY_SEAT_SHARE) / (1 - KEY_SEAT_SHARE), 0, 1);
      const yaw =
        turning < KEY_QUARTER_SHARE
          ? (turning / KEY_QUARTER_SHARE) * (Math.PI / 2)
          : Math.PI / 2 +
            ((turning - KEY_QUARTER_SHARE) / (1 - KEY_QUARTER_SHARE)) * KEY_REST_OF_TURN;
      paintKeyInLock(ctx, holeX, holeY, lockSize, above.keyKind, {
        yaw,
        depth: seated * KEY_SEATED_DEPTH,
        alpha: 1,
      });
      return;
    }
    case 'runes':
      paintKeyInLock(ctx, holeX, holeY, lockSize, above.keyKind, {
        yaw: KEY_TURNED_HOME,
        depth: KEY_SEATED_DEPTH,
        alpha: 1,
        glint: progress,
      });
      return;
    case 'burst': {
      const dissolve = clamp(progress / KEY_DISSOLVE_SHARE, 0, 1);
      if (dissolve < 1) {
        paintKeyInLock(ctx, holeX, holeY, lockSize, above.keyKind, {
          yaw: KEY_TURNED_HOME,
          depth: KEY_SEATED_DEPTH,
          alpha: 1 - dissolve,
        });
      }
      paintBurst(ctx, p, progress);
      return;
    }
    case 'cover':
      paintCoverEffects(ctx, p, view);
      return;
    case 'light':
      paintLightFromBelow(ctx, p, progress);
      paintBanner(ctx, p, above.banner, progress, 'in');
      return;
    case 'return':
      paintBanner(ctx, p, above.banner, progress, 'out');
      return;
    default: {
      const unhandled: never = beat;
      return unhandled;
    }
  }
}

/** How the key stands in the lock: turned `yaw` about its shank, sunk `depth` of its length. */
interface KeyInLock {
  readonly yaw: number;
  readonly depth: number;
  readonly alpha: number;
  readonly glint?: number;
}

/**
 * The key standing in the padlock's keyhole at (`holeX`, `holeY`). The
 * padlock lies on the cover with its keyhole facing up, so the key points
 * straight down into it, bow up; turning it is a turn about its own shank,
 * drawn per angle by the key art as its bow goes edge-on and back. What has
 * gone into the hole is hidden.
 */
function paintKeyInLock(
  ctx: Ctx,
  holeX: number,
  holeY: number,
  size: number,
  kind: KeyKind,
  pose: KeyInLock,
): void {
  const centerY = holeY - (KEY_TIP_REACH - pose.depth) * size;
  ctx.save();
  ctx.globalAlpha = pose.alpha;
  ctx.beginPath();
  ctx.rect(holeX - size, holeY - size * 2, size * 2, size * 2);
  ctx.clip();
  ctx.translate(holeX, centerY);
  ctx.rotate(KEY_POINTING_DOWN);
  paintKeyTurned(ctx, 0, 0, size, kind, pose.yaw, { axis: 'length', glint: pose.glint });
  ctx.restore();
}

function paintBurst(ctx: Ctx, p: SealPlacement, progress: number): void {
  const centerX = atX(p, sealLockPoints(p.style).padlock.x);
  const centerY = atY(p, sealLockPoints(p.style).padlock.y);
  const reach = BURST_REACH * p.size * Math.sqrt(progress);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let mote = 0; mote < BURST_MOTES; mote++) {
    const angle = moteScatter(mote, SCATTER_STREAM.burstAngle) * FULL_TURN;
    const distance =
      reach *
      (BURST_INNER_SHARE + moteScatter(mote, SCATTER_STREAM.burstReach) * (1 - BURST_INNER_SHARE));
    ctx.globalAlpha = 1 - progress;
    disc(
      ctx,
      centerX + Math.cos(angle) * distance,
      centerY + Math.sin(angle) * distance,
      BURST_MOTE_RADIUS_PX * (1 - progress * BURST_MOTE_SHRINK),
      SEAL_INK.mote,
    );
  }
  ctx.restore();
}

function paintCoverEffects(
  ctx: Ctx,
  p: SealPlacement,
  view: Extract<SealView, { kind: 'unsealing' }>,
): void {
  const hit = coverHitFrames(p.style);
  if (view.reducedMotion || view.beatFrame < hit) return;
  const settle = clamp((view.beatFrame - hit) / COVER_SETTLE_FRAMES, 0, 1);
  const centerX = atX(p, FOOTPRINT_CENTER.x);
  const centerY = atY(p, FOOTPRINT_CENTER.y);
  ctx.save();
  for (let puff = 0; puff < DUST_PUFFS; puff++) {
    const angle = (puff / DUST_PUFFS) * FULL_TURN + moteScatter(puff, SCATTER_STREAM.dustAngle);
    const distance = p.size * (DUST_START + DUST_REACH * settle);
    disc(
      ctx,
      centerX + Math.cos(angle) * distance,
      centerY + Math.sin(angle) * distance * DUST_SQUASH,
      DUST_RADIUS * p.size * (DUST_GROWTH + settle * DUST_GROWTH),
      rgbInkAt(SEAL_INK.dust, DUST_ALPHA * (1 - settle)),
    );
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let mote = 0; mote < GUST_MOTES; mote++) {
    const startX =
      p.x + p.size * (GUST_SPAN.left + moteScatter(mote, SCATTER_STREAM.gustX) * GUST_SPAN.width);
    const startY =
      p.y + p.size * (GUST_SPAN.top + moteScatter(mote, SCATTER_STREAM.gustY) * GUST_SPAN.height);
    const rise =
      GUST_RISE *
      p.size *
      settle *
      (GUST_RISE_SPREAD + moteScatter(mote, SCATTER_STREAM.gustRise) * GUST_RISE_SPREAD);
    ctx.globalAlpha = Math.sin(settle * Math.PI);
    disc(ctx, startX, startY - rise, GUST_MOTE_RADIUS_PX, SEAL_INK.mote);
  }
  ctx.restore();
}

function paintLightFromBelow(ctx: Ctx, p: SealPlacement, progress: number): void {
  const swell =
    progress < LIGHT_SWELL_SHARE
      ? progress / LIGHT_SWELL_SHARE
      : 1 - ((progress - LIGHT_SWELL_SHARE) / (1 - LIGHT_SWELL_SHARE)) * LIGHT_SETTLE_DROP;
  const centerX = atX(p, FOOTPRINT_CENTER.x);
  const centerY = atY(p, FOOTPRINT_CENTER.y);
  const radius = LIGHT_RADIUS * p.size;
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  glow.addColorStop(0, rgbInkAt(SEAL_INK.lightFromBelow, LIGHT_ALPHA * swell));
  glow.addColorStop(1, rgbInkAt(SEAL_INK.lightFromBelow, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  ctx.restore();
}

function paintBanner(
  ctx: Ctx,
  p: SealPlacement,
  banner: string,
  progress: number,
  phase: 'in' | 'out',
): void {
  const alpha =
    phase === 'in' ? clamp(progress / BANNER_FADE_SHARE, 0, 1) : 1 - clamp(progress, 0, 1);
  const y = p.y - BANNER_RISE * p.size * (phase === 'in' ? smoothstep(0, 1, progress) : 1);
  worldText(ctx, banner, {
    x: p.x + p.size / 2,
    y,
    style: 'sealBanner',
    align: 'center',
    baseline: 'alphabetic',
    alpha,
    glow: SEAL_INK.bannerGlow,
    glowBlur: BANNER_GLOW_BLUR,
  });
}

/**
 * The note over a seal a crawler stepped onto without the key: "Sealed: 1 of
 * 2 fragments". `life` runs 1 to 0 over the note's time on screen.
 */
export function paintSealedNotice(ctx: Ctx, p: SealPlacement, text: string, life: number): void {
  const alpha = clamp(life / NOTICE_FADE_SHARE, 0, 1);
  const measured = measureWorldText(ctx, text, { style: 'sealNotice' });
  const width = measured.width + NOTICE_PADDING_X * 2;
  const height = measured.totalHeight + NOTICE_PADDING_Y * 2;
  const left = p.x + p.size / 2 - width / 2;
  const top = p.y - NOTICE_LIFT * p.size - height;
  worldPlate(
    ctx,
    { x: left, y: top, w: width, h: height },
    { style: 'sealNotice', alpha, shadow: withAlpha(worldPalette.shade, alpha) },
  );
  worldText(ctx, text, {
    x: p.x + p.size / 2,
    y: top + NOTICE_PADDING_Y,
    style: 'sealNotice',
    align: 'center',
    alpha,
  });
}
