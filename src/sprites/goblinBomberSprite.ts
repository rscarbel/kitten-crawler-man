/**
 * The bomber goblins at runtime: the timing a creature plays their rows over,
 * the animator that picks a row and a frame, the draw call, the eye placement
 * and the prewarm hooks.
 *
 * A creature drives this exactly as `GoblinArcher` drives `goblinSprite.ts`:
 * tick the animator in `tickTimers` with the ground its own feet covered, start
 * a flinch when it is hurt outside an action, and in `drawSelf` resolve the row
 * and frame and hand them to {@link drawGoblinBomberSprite}.
 */

import { mulberry32, type Rng } from './person/rng';
import {
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import type { FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { EyePlacement } from './eyePlacement';
import {
  GOBLIN_BOMBER_EVENT_FRAMES,
  GOBLIN_BOMBER_FIGURES,
  goblinBomberGroundPerCycleTiles,
  goblinBomberRowFrameCount,
  goblinBomberSkeleton,
  type GoblinBomberActionRow,
  type GoblinBomberRow,
} from './art/goblinBomberFigure';
import { BOMBER_SCALE, GOBLIN_BOMBER_STYLES } from './art/goblinBomberArt';
import { GOBLIN_GORE_STATES } from './art/goblinFigure';
import { GOBLIN_NEAR_EYE, rotatePt, type GoblinBomberArchetype } from './art/goblinArt';
import { GOBLIN_IDLE_FPS } from './goblinSprite';

export type { GoblinBomberArchetype, GoblinBomberActionRow, GoblinBomberRow };

/** A one-shot row samples the middle of each frame, so an event lands half a frame past its index. */
const FRAME_MIDPOINT = 0.5;

function eventGameFrame(animFrames: number, spriteFrame: number, spriteFrames: number): number {
  return Math.round((animFrames * (spriteFrame + FRAME_MIDPOINT)) / spriteFrames);
}

/**
 * The game frame of the throw animation the explosive leaves the hand on, for
 * a throw row played over `throwFrames` game frames (the difficulty's
 * `BomberTuning.actionFrames`). The projectile spawns on this frame, which is
 * the frame the art shows the hand empty for the first time.
 */
export function goblinBombReleaseFrame(
  archetype: GoblinBomberArchetype,
  throwFrames: number,
): number {
  return eventGameFrame(
    throwFrames,
    GOBLIN_BOMBER_EVENT_FRAMES[archetype].release,
    goblinBomberRowFrameCount(archetype, 'throw'),
  );
}

/**
 * A point on a bomber's figure, in tiles: forward of the tile's centre the
 * way the figure faces, and up from the ground at the bottom of its tile.
 */
export interface BomberFigureOffset {
  readonly forwardTiles: number;
  readonly upTiles: number;
}

function releaseHandOf(archetype: GoblinBomberArchetype): BomberFigureOffset {
  const releaseSpriteFrame = GOBLIN_BOMBER_EVENT_FRAMES[archetype].release;
  const hand = goblinBomberSkeleton(archetype, 'throw', releaseSpriteFrame).nearArm.end;
  const scale = BOMBER_SCALE[archetype];
  // The rig's y grows downward from the ground.
  return { forwardTiles: hand.x * scale, upTiles: -hand.y * scale };
}

const RELEASE_HAND: Readonly<Record<GoblinBomberArchetype, BomberFigureOffset>> = {
  dynamite: releaseHandOf('dynamite'),
  black_powder: releaseHandOf('black_powder'),
};

/**
 * Where the throwing hand is on the frame the explosive leaves it
 * ({@link goblinBombReleaseFrame}), measured off the rig so a redraw of the
 * throw cannot leave the projectile behind. Forward is mirrored to `facingX`.
 */
export function goblinBombReleaseHand(
  archetype: GoblinBomberArchetype,
  facingX: number,
): BomberFigureOffset {
  const hand = RELEASE_HAND[archetype];
  const facing = Math.sign(facingX) || 1;
  return { forwardTiles: facing * hand.forwardTiles, upTiles: hand.upTiles };
}

/**
 * The game frame of the light animation the fuse catches on, for a light row
 * played over `lightFrames` game frames: the frame the spark bursts where the
 * fuse meets the flame, and the frame the fuse-lit sound belongs on.
 */
export function goblinFuseCatchFrame(
  archetype: GoblinBomberArchetype,
  lightFrames: number,
): number {
  return eventGameFrame(
    lightFrames,
    GOBLIN_BOMBER_EVENT_FRAMES[archetype].fuseCatch,
    goblinBomberRowFrameCount(archetype, 'light'),
  );
}

/** How a bomber is moving this frame. A run is for backing off and repositioning at speed. */
export type GoblinBomberLocomotion = 'still' | 'walk' | 'run';

/**
 * The action rows one bomber paints. Only the black powder goblin aims, so a
 * dynamite goblin asking for its aim row is a compile error rather than a
 * silently empty frame.
 */
export type GoblinBomberActionRowOf<A extends GoblinBomberArchetype> = A extends 'black_powder'
  ? GoblinBomberActionRow
  : Exclude<GoblinBomberActionRow, 'aim'>;

/** An action under way and how far through it is, 0–1. */
export interface GoblinBomberAction<A extends GoblinBomberArchetype = GoblinBomberArchetype> {
  readonly row: GoblinBomberActionRowOf<A>;
  readonly progress: number;
}

export interface ResolvedBomberFrame {
  readonly state: GoblinBomberRow;
  readonly frame: number;
}

/** Frames a flinch plays for: short, so it never eats a throw. */
export const GOBLIN_BOMBER_FLINCH_FRAMES = 12;

const GOBLIN_BOMBER_COSMETIC_SEED = 0xb0b;

/**
 * The draws that only decide how a bomber looks. A stream of their own, so a
 * cosmetic draw never reshuffles a seeded fight's rolls.
 */
const cosmeticRandom: Rng = mulberry32(GOBLIN_BOMBER_COSMETIC_SEED);

/**
 * One bomber's animation timers.
 *
 * Walking and running share one gait phase, so switching between them keeps
 * the feet where they are; each advances it at the rate its own stride covers
 * ground, which is what keeps a planted foot still on the floor.
 */
export class GoblinBomberAnimator<A extends GoblinBomberArchetype = GoblinBomberArchetype> {
  private readonly idlePhaseOffset: number;
  private readonly walkRadiansPerPx: number;
  private readonly runRadiansPerPx: number;
  private readonly walkFrames: number;
  private readonly runFrames: number;
  private readonly idleFrames: number;
  private readonly flinchRowFrames: number;
  private gaitPhase = 0;
  private flinchFramesLeft = 0;

  constructor(private readonly archetype: A) {
    this.walkFrames = goblinBomberRowFrameCount(archetype, 'walk');
    this.runFrames = goblinBomberRowFrameCount(archetype, 'run');
    this.idleFrames = goblinBomberRowFrameCount(archetype, 'idle');
    this.flinchRowFrames = goblinBomberRowFrameCount(archetype, 'flinch');
    this.idlePhaseOffset = cosmeticRandom() * (this.idleFrames / GOBLIN_IDLE_FPS);
    this.walkRadiansPerPx =
      (Math.PI * 2) / (goblinBomberGroundPerCycleTiles(archetype, 'walk') * TILE_SIZE);
    this.runRadiansPerPx =
      (Math.PI * 2) / (goblinBomberGroundPerCycleTiles(archetype, 'run') * TILE_SIZE);
  }

  reset(): void {
    this.gaitPhase = 0;
    this.flinchFramesLeft = 0;
  }

  startFlinch(): void {
    this.flinchFramesLeft = GOBLIN_BOMBER_FLINCH_FRAMES;
  }

  get isFlinching(): boolean {
    return this.flinchFramesLeft > 0;
  }

  /**
   * Advances the timers by one game frame, with the ground the bomber's own
   * feet covered this frame (not what a knockback or a shove carried it).
   */
  tick(locomotion: GoblinBomberLocomotion, ownStridePx: number): void {
    if (this.flinchFramesLeft > 0) this.flinchFramesLeft--;
    if (locomotion === 'still') {
      this.gaitPhase = 0;
      return;
    }
    const running = locomotion === 'run';
    const radiansPerPx = running ? this.runRadiansPerPx : this.walkRadiansPerPx;
    // One frame of the row per tick at most: past that a tick skips frames,
    // and skipped frames strobe instead of reading as a faster stride.
    const maxAdvance = (Math.PI * 2) / (running ? this.runFrames : this.walkFrames);
    const advance = Math.min(ownStridePx * radiansPerPx, maxAdvance);
    this.gaitPhase = (this.gaitPhase + advance) % (Math.PI * 2);
  }

  /** The row and frame to draw. Priority is action → flinch → run/walk → idle. */
  resolve(
    elapsedSeconds: number,
    locomotion: GoblinBomberLocomotion,
    action: GoblinBomberAction<A> | null,
  ): ResolvedBomberFrame {
    if (action !== null) {
      const frames = goblinBomberRowFrameCount(this.archetype, action.row);
      return { state: action.row, frame: progressFrameIndex(action.progress, frames) };
    }
    if (this.flinchFramesLeft > 0) {
      const progress = 1 - this.flinchFramesLeft / GOBLIN_BOMBER_FLINCH_FRAMES;
      return { state: 'flinch', frame: progressFrameIndex(progress, this.flinchRowFrames) };
    }
    if (locomotion === 'run') {
      return { state: 'run', frame: walkFrameIndex(this.gaitPhase, this.runFrames) };
    }
    if (locomotion === 'walk') {
      return { state: 'walk', frame: walkFrameIndex(this.gaitPhase, this.walkFrames) };
    }
    const phased = elapsedSeconds + this.idlePhaseOffset;
    return { state: 'idle', frame: timeFrameIndex(phased, GOBLIN_IDLE_FPS, this.idleFrames) };
  }
}

export interface GoblinBomberSpriteState {
  readonly archetype: GoblinBomberArchetype;
  readonly x: number;
  readonly y: number;
  readonly tileSize: number;
  readonly facingX: number;
  readonly state: GoblinBomberRow;
  readonly frame: number;
}

/** Draw one bomber frame. Every figure faces +X, so the runtime mirrors it. */
export function drawGoblinBomberSprite(
  ctx: CanvasRenderingContext2D,
  sprite: GoblinBomberSpriteState,
): void {
  drawFigureCached(
    ctx,
    GOBLIN_BOMBER_FIGURES[sprite.archetype],
    sprite.state,
    sprite.frame,
    sprite.x,
    sprite.y,
    sprite.tileSize,
    { flipX: sprite.facingX < 0 },
  );
}

export function goblinBomberFigure(archetype: GoblinBomberArchetype): FigureDef {
  return GOBLIN_BOMBER_FIGURES[archetype];
}

/** The gore art a dead bomber's flying pieces come from: `BodyPartGoreSystem` keys on this. */
export function goblinBomberBodyPartKey(archetype: GoblinBomberArchetype): string {
  return GOBLIN_BOMBER_FIGURES[archetype].id;
}

/** The nine pieces a bomber comes apart into, the same names every goblin uses. */
export const GOBLIN_BOMBER_GORE_PARTS: ReadonlyArray<string> = GOBLIN_GORE_STATES;

/** Every row a bomber can be drawn in, for the gates' runtime-name check. */
export function goblinBomberStates(
  archetype: GoblinBomberArchetype,
): ReadonlyArray<GoblinBomberRow> {
  const shared: GoblinBomberRow[] = ['light', 'throw', 'flinch', 'run', 'walk', 'idle'];
  return archetype === 'black_powder' ? ['aim', ...shared] : shared;
}

/** What a bomber draws the moment it arrives: it stands and walks. */
const SPAWN_WARMED: ReadonlyArray<GoblinBomberRow> = ['idle', 'walk'];

/** Warms the rows a bomber about to exist will draw, where its spawn is scheduled. */
export function prewarmGoblinBomber(archetype: GoblinBomberArchetype): void {
  const figure = GOBLIN_BOMBER_FIGURES[archetype];
  for (const state of SPAWN_WARMED) prewarmFigureState(figure, state);
}

/**
 * Warms every row a fight draws, from the moment a bomber notices a target:
 * the light, aim and throw follow straight on from it, and a run or a flinch
 * has no telegraph of its own. The gore is drawn all at once with no warning.
 */
export function prewarmGoblinBomberCombat(archetype: GoblinBomberArchetype): void {
  const figure = GOBLIN_BOMBER_FIGURES[archetype];
  for (const state of goblinBomberStates(archetype)) prewarmFigureState(figure, state);
  for (const part of GOBLIN_BOMBER_GORE_PARTS) prewarmFigureState(figure, part);
}

/** The gap between the two eyes in the profile, the far one half hidden behind the snout. */
const EYE_SPACING_TILES = 0.08;
/** The idle frame the eyes are measured on: the rest pose every row hands back to. */
const EYE_REST_FRAME = 0;

function eyePlacementOf(archetype: GoblinBomberArchetype): EyePlacement {
  const skeleton = goblinBomberSkeleton(archetype, 'idle', EYE_REST_FRAME);
  const p = GOBLIN_BOMBER_STYLES[archetype].proportions;
  const local = rotatePt(
    {
      x: GOBLIN_NEAR_EYE.x * p.headRadius * p.headWidthFactor,
      y: GOBLIN_NEAR_EYE.y * p.headRadius,
    },
    skeleton.headAngle,
  );
  const scale = BOMBER_SCALE[archetype];
  const forward = (skeleton.headCentre.x + local.x) * scale;
  // The figure's origin is on the ground at the bottom of its tile.
  const height = 1 + (skeleton.headCentre.y + local.y) * scale;
  return {
    sideForward: forward,
    sideHeight: height,
    sideSpacing: EYE_SPACING_TILES,
    frontMirrors: true,
    frontAcross: forward,
    frontHeight: height,
    frontSpacing: EYE_SPACING_TILES,
  };
}

const EYE_PLACEMENT: Readonly<Record<GoblinBomberArchetype, EyePlacement>> = {
  dynamite: eyePlacementOf('dynamite'),
  black_powder: eyePlacementOf('black_powder'),
};

/**
 * Where a bomber's eyes are, for the eye-shine, measured off the rig's own
 * rest pose and head constants so a redraw cannot leave them behind.
 */
export function goblinBomberEyePlacement(archetype: GoblinBomberArchetype): EyePlacement {
  return EYE_PLACEMENT[archetype];
}
