/**
 * Draws the Krakaren Clone boss through the figure cache, plus the two
 * ground-slam floor decals that stay runtime-drawn.
 *
 * The decals are not painted into a cell on purpose: their radius is the slam's
 * actual kill radius, and what the player sees sweep the floor has to be
 * exactly what kills them. A cached burst could drift from that number without
 * anything failing.
 */

import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { KRAKAREN_FIGURE, KRAKAREN_SLAM_FIGURE } from './art/krakarenFigure';

/** Which of the three drawn viewpoints a facing resolves to. */
export type KrakarenView = 'front' | 'side' | 'away';

type KrakarenBase = 'idle' | 'swipe' | 'channel';

/** The pose states her body paints, as the runtime names them. */
export type KrakarenPoseState = KrakarenBase | `${KrakarenBase}_side` | `${KrakarenBase}_away`;

/**
 * Every pose state her AI can enter, in the order a prewarm should warm them.
 *
 * Her body is the one figure in the fleet whose cells cost milliseconds rather
 * than microseconds to paint, so a state that reaches the draw call cold pays
 * for itself in that frame. The list is what the intro warms and what
 * `scripts/gates-krakaren.ts` checks she actually paints.
 */
export const KRAKAREN_POSE_STATES: readonly KrakarenPoseState[] = [
  'idle',
  'idle_side',
  'idle_away',
  'swipe',
  'swipe_side',
  'swipe_away',
  'channel',
  'channel_side',
  'channel_away',
];

/** The sheet's severed pieces, in the order the bake lays them into the gore row. */
export const KRAKAREN_GORE_PARTS: ReadonlyArray<string> = [
  'gore_mantle',
  'gore_stub',
  'gore_eye',
  'gore_tentacle_a',
  'gore_tentacle_b',
  'gore_mouth_cluster',
  'gore_entrails',
];

export const KRAKAREN_BODY_PART_KEY = 'krakaren';

/**
 * Enrage is a runtime treatment rather than a baked row, so the whole sheet
 * stays half its size. A damage flash outranks it: a hit landing has to be
 * readable through whatever else is tinting her.
 */
export const KRAKAREN_ENRAGED_FILTER = 'saturate(1.5) brightness(1.1)';

const TWO_PI = Math.PI * 2;
const MILLISECONDS_PER_SECOND = 1000;

/** Loop speeds for the clock-driven rows. */
const IDLE_FPS = 6;
const CHANNEL_FPS = 10;

/**
 * Read off the figure rather than hand-tabled, because the draw path *clamps*
 * the frame index: a state that lost frames would silently freeze on its last
 * one instead of failing.
 */
function frameCountOf(state: KrakarenPoseState): number {
  return figureFrameCount(KRAKAREN_FIGURE, state);
}

/** Views split on whichever axis she is facing hardest along; a tie reads as profile. */
function viewFor(facingX: number, facingY: number): KrakarenView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: KrakarenBase, view: KrakarenView): KrakarenPoseState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the body sprite needs to pick a pose. All fields optional. */
export interface KrakarenSpriteState {
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through the melee lash; null when she is not swinging. */
  readonly swipeProgress?: number | null;
  /** Set while she is braced for a ground slam, which has its own silhouette. */
  readonly isChanneling?: boolean;
  /** Pins whichever clock-driven loop is playing, for the preview harness. */
  readonly idleFrame?: number | null;
}

/**
 * Draw the Krakaren Clone's body.
 *
 * Priority is swipe → channel → idle, so a committed melee lash still reads as
 * a lash even on the frame a slam starts charging.
 *
 * Only the profile rows are mirrored; flipping a head-on view would put her
 * eyes and beak on the wrong sides every time she turned around.
 */
export function drawKrakarenSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakarenSpriteState = {},
): void {
  const {
    facingX = 0,
    facingY = 1,
    swipeProgress = null,
    isChanneling = false,
    idleFrame = null,
  } = state;

  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;
  const opts = { flipX };

  if (swipeProgress !== null) {
    const key = stateFor('swipe', view);
    drawFigureCached(
      ctx,
      KRAKAREN_FIGURE,
      key,
      progressFrameIndex(swipeProgress, frameCountOf(key)),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;

  if (isChanneling) {
    const key = stateFor('channel', view);
    const count = frameCountOf(key);
    drawFigureCached(
      ctx,
      KRAKAREN_FIGURE,
      key,
      idleFrame ?? timeFrameIndex(nowSeconds, CHANNEL_FPS, count),
      sx,
      sy,
      tileSize,
      opts,
    );
    return;
  }

  const key = stateFor('idle', view);
  const count = frameCountOf(key);
  drawFigureCached(
    ctx,
    KRAKAREN_FIGURE,
    key,
    idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS, count),
    sx,
    sy,
    tileSize,
    opts,
  );
}

/**
 * Warms every pose her body can be drawn in.
 *
 * Her cells cost milliseconds to paint rather than microseconds, so a state
 * reaching the draw call cold spends that whole cost inside one frame. The
 * cache spreads the work at one cell per frame under its own budget, which is
 * why this wants the longest lead available: the boss intro, before she is on
 * screen at all.
 */
export function prewarmKrakarenBody(): void {
  for (const state of KRAKAREN_POSE_STATES) prewarmFigureState(KRAKAREN_FIGURE, state);
}

/**
 * Warms the one pose the next draw will actually ask for.
 *
 * The intro's blanket warm is a convenience and not the coverage: rows the
 * fight has not played for the cache's idle window are released, so the attack
 * she is about to throw may well be cold by the time she throws it. This is the
 * hook with real lead — a windup or a telegraph names its state before a single
 * frame of it is drawn, and facing is locked across both.
 */
export function prewarmKrakarenPoseForFacing(
  base: 'idle' | 'swipe' | 'channel',
  facingX: number,
  facingY: number,
): void {
  prewarmFigureState(KRAKAREN_FIGURE, stateFor(base, viewFor(facingX, facingY)));
}

/**
 * Warms her severed pieces.
 *
 * All seven are drawn on the single frame she comes apart, with no telegraph of
 * their own, so the moment worth warming from is the one where she can still
 * die — she has engaged and the player is hitting her.
 */
export function prewarmKrakarenGore(): void {
  for (const part of KRAKAREN_GORE_PARTS) prewarmFigureState(KRAKAREN_FIGURE, part);
}

/** Warms the four beats of a ground slam, from the telegraph that starts one. */
export function prewarmKrakarenSlam(): void {
  for (const phase of KRAKAREN_SLAM_PHASES) prewarmFigureState(KRAKAREN_SLAM_FIGURE, phase);
}

/** Clear air left between the top of her art and anything hung over her head. */
const KRAKAREN_OVERHEAD_CLEARANCE_TILES = 0.2;

/**
 * How far her painted cell reaches around her tile.
 *
 * Read off the figure's own declared geometry rather than copied, because every
 * one of these numbers moves whenever the cell is resized — and a stale copy
 * fails silently, as a health bar drawn across her mantle.
 */
const KRAKAREN_ART_TOP_TILES = KRAKAREN_FIGURE.tileY / KRAKAREN_FIGURE.tileScale;
const KRAKAREN_ART_HEIGHT_TILES = KRAKAREN_FIGURE.frameHeight / KRAKAREN_FIGURE.tileScale;

/** Tiles her art rises above her tile origin. */
export function krakarenArtTopTiles(_fallbackTiles: number): number {
  return KRAKAREN_ART_TOP_TILES;
}

/** Height of one baked cell in tiles — the divisor for sizing a portrait. */
export function krakarenArtHeightTiles(_fallbackTiles: number): number {
  return KRAKAREN_ART_HEIGHT_TILES;
}

/** How far above her tile origin to hang a health bar so it clears the mantle. */
export function krakarenOverheadLiftTiles(_fallbackTiles: number): number {
  return KRAKAREN_ART_TOP_TILES + KRAKAREN_OVERHEAD_CLEARANCE_TILES;
}

const ENRAGE_GLOW_BASE_ALPHA = 0.25;
const ENRAGE_GLOW_PULSE_AMPLITUDE = 0.15;
const ENRAGE_GLOW_PULSE_FREQ = 4;
const ENRAGE_GLOW_LINEWIDTH = 3;
const ENRAGE_GLOW_RX_TILES = 1.3;
const ENRAGE_GLOW_RY_TILES = 0.45;
const ENRAGE_GLOW_CENTER_X_TILES = 0.5;
const ENRAGE_GLOW_CENTER_Y_TILES = 0.5;
const ENRAGE_GLOW_COLOR = '#ff2020';

/**
 * The red ring that says she has passed her enrage threshold.
 *
 * Drawn under the sprite rather than baked into it, because the sheet's tint
 * treatment alone is easy to miss on a boss this saturated to begin with.
 */
export function drawKrakarenEnrageGlow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  animTime: number,
): void {
  ctx.save();
  ctx.globalAlpha =
    ENRAGE_GLOW_BASE_ALPHA +
    ENRAGE_GLOW_PULSE_AMPLITUDE * Math.sin(animTime * ENRAGE_GLOW_PULSE_FREQ);
  ctx.strokeStyle = ENRAGE_GLOW_COLOR;
  ctx.lineWidth = ENRAGE_GLOW_LINEWIDTH;
  ctx.beginPath();
  ctx.ellipse(
    sx + tileSize * ENRAGE_GLOW_CENTER_X_TILES,
    sy + tileSize * ENRAGE_GLOW_CENTER_Y_TILES,
    tileSize * ENRAGE_GLOW_RX_TILES,
    tileSize * ENRAGE_GLOW_RY_TILES,
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * The slam's kill radius in tiles.
 *
 * `KrakarenClone`'s `SLAM_KILL_RADIUS_TILE_MULTIPLIER` is the same number and
 * has to stay the same number: the telegraph ring is the player's only reading
 * of where the instant kill lands, so a decal drawn at any other radius is a
 * lie about the hitbox.
 */
export const SLAM_KILL_RADIUS_TILES = 1.5;

const SLAM_SHADOW_ALPHA_BASE = 0.15;
const SLAM_SHADOW_ALPHA_GROWTH = 0.5;
const SLAM_SHADOW_PULSE_CYCLES = 6;
const SLAM_SHADOW_PULSE_AMPLITUDE = 0.08;
const SLAM_SHADOW_INNER_SCALE = 0.8;
const SLAM_SHADOW_FILL_ALPHA_SCALE = 0.4;
const SLAM_SHADOW_LINEWIDTH_BASE = 2;
const SLAM_SHADOW_LINEWIDTH_GROWTH = 2;
const SLAM_SHADOW_RING_COLOR = '#ff0000';
const SLAM_SHADOW_INNER_COLOR = '#200000';

/**
 * Extra opacity carried by the ring while the tentacle is diving, on top of
 * whatever the telegraph progress already earns it.
 *
 * The dive is the moment the thing goes under, and the ring is where it comes
 * back up: pushing the ring hardest exactly then is what makes the two read as
 * one movement rather than two unrelated effects.
 */
const SLAM_SHADOW_DIVE_ALPHA_BOOST = 0.25;

/**
 * The ground telegraph: a red ring at exactly the kill radius that fills in as
 * the tentacle travels underground toward it.
 *
 * @param progress 0–1 through the telegraph window, 1 being the impact frame.
 * @param diveProgress 0–1 through the tentacle's dive, 0 whenever it is not diving.
 */
export function drawSlamShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
  diveProgress = 0,
): void {
  const radius = tileSize * SLAM_KILL_RADIUS_TILES;
  const alpha =
    SLAM_SHADOW_ALPHA_BASE +
    progress * SLAM_SHADOW_ALPHA_GROWTH +
    diveProgress * SLAM_SHADOW_DIVE_ALPHA_BOOST;
  const pulseScale =
    1 + Math.sin(progress * Math.PI * SLAM_SHADOW_PULSE_CYCLES) * SLAM_SHADOW_PULSE_AMPLITUDE;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = SLAM_SHADOW_RING_COLOR;
  ctx.lineWidth = SLAM_SHADOW_LINEWIDTH_BASE + progress * SLAM_SHADOW_LINEWIDTH_GROWTH;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale, 0, TWO_PI);
  ctx.stroke();

  ctx.fillStyle = SLAM_SHADOW_INNER_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, radius * progress * SLAM_SHADOW_INNER_SCALE, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = SLAM_SHADOW_RING_COLOR;
  ctx.globalAlpha = alpha * SLAM_SHADOW_FILL_ALPHA_SCALE;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulseScale, 0, TWO_PI);
  ctx.fill();

  ctx.restore();
}

const DUST_RING_ALPHA = 0.55;
const DUST_RING_LINEWIDTH = 3;
const DUST_RING_COLOR = 'rgba(196,174,158,1)';
const DUST_PUFF_COUNT = 12;
const DUST_PUFF_ALPHA = 0.35;
const DUST_PUFF_COLOR = 'rgba(168,146,130,1)';
/** Where the puffs sit at the moment of impact, as a fraction of the kill radius. */
const DUST_PUFF_START_FRACTION = 0.72;
/** How much further out they drift over the impact window, in kill radii. */
const DUST_PUFF_DRIFT_FRACTION = 0.22;
const DUST_PUFF_RADIUS_TILES = 0.1;
const DUST_PUFF_SHRINK = 0.6;

/**
 * The impact decal: a low skirt of dust at the kill radius.
 *
 * The baked `smash` row carries the hit itself, so this deliberately does not
 * try to be an explosion — it only draws the boundary the smash tentacle just
 * landed inside, which is the part the art cannot promise to be accurate about.
 *
 * @param progress 0–1 through the impact window, 0 being the frame of the hit.
 */
export function drawSlamImpact(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
): void {
  const radius = tileSize * SLAM_KILL_RADIUS_TILES;
  const fade = 1 - progress;

  ctx.save();

  ctx.globalAlpha = fade * DUST_RING_ALPHA;
  ctx.strokeStyle = DUST_RING_COLOR;
  ctx.lineWidth = DUST_RING_LINEWIDTH * fade;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.stroke();

  ctx.globalAlpha = fade * DUST_PUFF_ALPHA;
  ctx.fillStyle = DUST_PUFF_COLOR;
  const puffDistance = radius * (DUST_PUFF_START_FRACTION + progress * DUST_PUFF_DRIFT_FRACTION);
  const puffRadius = tileSize * DUST_PUFF_RADIUS_TILES * (1 - progress * DUST_PUFF_SHRINK);
  for (let i = 0; i < DUST_PUFF_COUNT; i++) {
    const angle = (i / DUST_PUFF_COUNT) * TWO_PI;
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * puffDistance,
      y + Math.sin(angle) * puffDistance,
      puffRadius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.restore();
}

/**
 * The four beats of a ground slam, which are exactly the slam figure's states:
 * the tentacle rises beside her, looms, dives back under, and smashes up
 * through the marked ground.
 */
export type KrakarenSlamPhase = 'rise' | 'loom' | 'dive' | 'smash';

/** Every slam beat, in the order they play; the prewarm and the gates read it. */
export const KRAKAREN_SLAM_PHASES: readonly KrakarenSlamPhase[] = ['rise', 'loom', 'dive', 'smash'];

function slamFrameCountOf(state: KrakarenSlamPhase): number {
  return figureFrameCount(KRAKAREN_SLAM_FIGURE, state);
}

/**
 * How much of the impact window, at its tail end, is spent easing the
 * tentacle's alpha down to 0 instead of leaving it visible.
 *
 * The kill is already decided by the shadow reticle before this row ever
 * plays, so nothing about fairness depends on exactly when the model itself
 * disappears — but a solid limb popping straight to nothing reads as a
 * rendering glitch. Fading it out over the last stretch, the same way
 * {@link drawSlamImpact}'s dust ring already tapers, gives the sink under the
 * floor a visible end instead of a cut.
 */
const SLAM_TENTACLE_FADE_START_PROGRESS = 0.85;

/**
 * Which frame of `smash` is showing at a given point in the impact window.
 *
 * The row is played start to finish: the emergence and the downward strike
 * are baked into its first frames (both complete by
 * {@link SLAM_SMASH_IMPACT_PROGRESS} through the row's own timeline), and the
 * rest of the row is the recoil and retract. Playing the whole thing is what
 * makes the strike itself visible instead of only ever showing its aftermath.
 */
function smashFrameIndex(progress: number, frameCount: number): number {
  return progressFrameIndex(progress, frameCount);
}

/** 1 through most of the window, easing to 0 over its tail. */
function smashAlpha(progress: number): number {
  if (progress <= SLAM_TENTACLE_FADE_START_PROGRESS) return 1;
  const tail =
    (progress - SLAM_TENTACLE_FADE_START_PROGRESS) / (1 - SLAM_TENTACLE_FADE_START_PROGRESS);
  return Math.max(0, 1 - tail);
}

/** Everything the slam tentacle needs to pick a frame. */
export interface KrakarenSlamSpriteState {
  readonly phase: KrakarenSlamPhase;
  /** 0–1 within the current phase. */
  readonly progress: number;
  /** The slam target is west of her, so the art leans toward it. */
  readonly mirrored?: boolean;
}

/**
 * Draw the big slam tentacle.
 *
 * No mob owns this sheet: the rise happens beside the boss and the smash lands
 * wherever the telegraph is, up to the full aggro range away, so it is drawn
 * from `KrakarenClone`'s marker by `BossRoomSystem` rather than out of any
 * creature's own `drawSelf` and its cull margin.
 *
 * @param sx Screen x of the tile the tentacle stands on, top-left.
 * @param sy Screen y of the tile the tentacle stands on, top-left.
 */
export function drawKrakarenSlamTentacle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakarenSlamSpriteState,
): void {
  const { phase, progress, mirrored = false } = state;
  const frameCount = slamFrameCountOf(phase);
  const frame =
    phase === 'smash'
      ? smashFrameIndex(progress, frameCount)
      : progressFrameIndex(progress, frameCount);
  const alpha = phase === 'smash' ? smashAlpha(progress) : 1;
  drawFigureCached(ctx, KRAKAREN_SLAM_FIGURE, phase, frame, sx, sy, tileSize, {
    flipX: mirrored,
    alpha,
  });
}
