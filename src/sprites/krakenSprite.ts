/**
 * Draws the Kraken boss through the figure cache, plus the ground slam's
 * impact decal that stays runtime-drawn (its warnings are in
 * `krakenTelegraphs.ts`).
 *
 * The decal is not painted into a cell on purpose: its radius is the slam's
 * actual kill radius, and what the player sees sweep the floor has to be
 * exactly what kills them. A cached burst could drift from that number without
 * anything failing.
 */

import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  GROUND_OFFSET_PX,
  KRAKEN_FIGURE,
  KRAKEN_SLAM_FIGURE,
  TILE_SCALE,
} from './art/krakenFigure';

/** Which of the three drawn viewpoints a facing resolves to. */
export type KrakenView = 'front' | 'side' | 'away';

type KrakenBase = 'idle' | 'swipe' | 'channel';

/** The pose states her body paints, as the runtime names them. */
export type KrakenPoseState = KrakenBase | `${KrakenBase}_side` | `${KrakenBase}_away`;

/**
 * Every pose state her AI can enter, in the order a prewarm should warm them.
 *
 * Her body is the one figure in the fleet whose cells cost milliseconds rather
 * than microseconds to paint, so a state that reaches the draw call cold pays
 * for itself in that frame. The list is what the intro warms and what
 * `scripts/gates-kraken.ts` checks she actually paints.
 */
export const KRAKEN_POSE_STATES: readonly KrakenPoseState[] = [
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
export const KRAKEN_GORE_PARTS: ReadonlyArray<string> = [
  'gore_mantle',
  'gore_stub',
  'gore_eye',
  'gore_tentacle_a',
  'gore_tentacle_b',
  'gore_mouth_cluster',
  'gore_entrails',
];

export const KRAKEN_BODY_PART_KEY = 'kraken';

/**
 * Enrage is a runtime treatment rather than a baked row, so the whole sheet
 * stays half its size. A damage flash outranks it: a hit landing has to be
 * readable through whatever else is tinting her.
 */
export const KRAKEN_ENRAGED_FILTER = 'saturate(1.5) brightness(1.1)';

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
function frameCountOf(state: KrakenPoseState): number {
  return figureFrameCount(KRAKEN_FIGURE, state);
}

/** Views split on whichever axis she is facing hardest along; a tie reads as profile. */
function viewFor(facingX: number, facingY: number): KrakenView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: KrakenBase, view: KrakenView): KrakenPoseState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/** Everything the body sprite needs to pick a pose. All fields optional. */
export interface KrakenSpriteState {
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
 * Draw the Kraken's body.
 *
 * Priority is swipe → channel → idle, so a committed melee lash still reads as
 * a lash even on the frame a slam starts charging.
 *
 * Only the profile rows are mirrored; flipping a head-on view would put her
 * eyes and beak on the wrong sides every time she turned around.
 */
export function drawKrakenSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakenSpriteState = {},
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
      KRAKEN_FIGURE,
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
      KRAKEN_FIGURE,
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
    KRAKEN_FIGURE,
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
export function prewarmKrakenBody(): void {
  for (const state of KRAKEN_POSE_STATES) prewarmFigureState(KRAKEN_FIGURE, state);
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
export function prewarmKrakenPoseForFacing(
  base: 'idle' | 'swipe' | 'channel',
  facingX: number,
  facingY: number,
): void {
  prewarmFigureState(KRAKEN_FIGURE, stateFor(base, viewFor(facingX, facingY)));
}

/**
 * Warms her severed pieces.
 *
 * All seven are drawn on the single frame she comes apart, with no telegraph of
 * their own, so the moment worth warming from is the one where she can still
 * die — she has engaged and the player is hitting her.
 */
export function prewarmKrakenGore(): void {
  for (const part of KRAKEN_GORE_PARTS) prewarmFigureState(KRAKEN_FIGURE, part);
}

/** Warms the four beats of a ground slam, from the telegraph that starts one. */
export function prewarmKrakenSlam(): void {
  for (const phase of KRAKEN_SLAM_PHASES) prewarmFigureState(KRAKEN_SLAM_FIGURE, phase);
}

/**
 * How far her painted cell reaches around her tile.
 *
 * Read off the figure's own declared geometry rather than copied, because every
 * one of these numbers moves whenever the cell is resized — and a stale copy
 * fails silently, as a health bar drawn across her mantle.
 */
export const KRAKEN_ART_TOP_TILES = KRAKEN_FIGURE.tileY / KRAKEN_FIGURE.tileScale;
/** Height of one painted cell in tiles: the divisor for sizing a portrait. */
export const KRAKEN_ART_HEIGHT_TILES = KRAKEN_FIGURE.frameHeight / KRAKEN_FIGURE.tileScale;

/** Where every Kraken figure's ground line sits in its tile, as a fraction of the tile. */
const KRAKEN_GROUND_LINE_TILE_FRACTION = GROUND_OFFSET_PX / TILE_SCALE;

/**
 * The tile origin to draw her art from at `artTileSize` so it stands where a
 * `tileSize` figure drawn from (`sx`, `sy`) would: centred on that tile and on
 * its ground line.
 *
 * The figure cache places a tile by its top-left corner, so a scaled-up tile
 * drawn from the one-tile origin grows right and down from it — at triple size
 * her art would stand a tile to the right of and two tiles below the point the
 * fight measures her from, and the slam tentacle would come down that far from
 * where its kill lands.
 */
export function krakenScaledArtOrigin(
  sx: number,
  sy: number,
  tileSize: number,
  artTileSize: number,
): { x: number; y: number } {
  const growth = artTileSize - tileSize;
  return {
    x: sx - growth / 2,
    y: sy - growth * KRAKEN_GROUND_LINE_TILE_FRACTION,
  };
}

/**
 * How far above her ground line the surface cuts her while she waits in the
 * flood, in her art's tiles: her crown, upper eyes and raised arms stand clear
 * and the mantle's skirt and lower eyes are under.
 */
const KRAKEN_SUBMERGED_WATERLINE_TILES = 0.34;

/**
 * The water is opaque, so nothing of her below the surface shows: only a
 * faint dark swell where her bulk heaves the water up, in her art's tiles.
 */
const SUBMERGED_MURK_RX_TILES = 0.95;
const SUBMERGED_MURK_RY_TILES = 0.36;
const SUBMERGED_MURK_DROP_TILES = 0.1;
const SUBMERGED_MURK_COLOR = 'rgba(14, 18, 15, 0.22)';
const SUBMERGED_MURK_CLEAR = 'rgba(14, 18, 15, 0)';
/** The surface lapping round her where she breaks it. */
const SUBMERGED_COLLAR_RX_TILES = 0.78;
const SUBMERGED_COLLAR_FLATTEN = 0.22;
const SUBMERGED_COLLAR_FILL = 'rgba(150, 172, 196, 0.16)';
const SUBMERGED_COLLAR_RIM = 'rgba(196, 210, 224, 0.55)';
const SUBMERGED_RIPPLE_COLOR = 'rgba(170, 190, 210, 0.4)';
const SUBMERGED_RIPPLE_RINGS = 2;
const SUBMERGED_RIPPLE_PERIOD_TICKS = 120;
const SUBMERGED_RIPPLE_GROWTH = 0.7;
const SUBMERGED_LINE_WIDTH_TILES = 1 / 64;
/** Foam churned up round her where she breaks the surface, circling and swelling. */
const SUBMERGED_FOAM_COLOR = 'rgba(196, 210, 224, 0.6)';
const SUBMERGED_FOAM_BEADS = 16;
const SUBMERGED_FOAM_RADIUS_TILES = 1 / 110;
const SUBMERGED_FOAM_SWELL_TILES = 1 / 170;
/** Beads wander in and out of the collar's rim by up to this share, so they are a churn, not a ring. */
const SUBMERGED_FOAM_SCATTER = 0.16;
/** Scatters each bead's distance off the rim by its index. */
const SUBMERGED_FOAM_SCATTER_STEP = 7.3;
const SUBMERGED_FOAM_TURN_TICKS = 240;
const SUBMERGED_FOAM_SWELL_TICKS = 26;
/** Spreads the beads' swells so neighbours are never in step. */
const SUBMERGED_FOAM_PHASE_STEP = 2.3;

/**
 * Draws her waiting in the flood: only what stands above
 * {@link KRAKEN_SUBMERGED_WATERLINE_TILES} is drawn, her bulk shows as a dark
 * shape under the surface, and the water laps round her in rings that widen
 * with the world tick `frame`. Takes the same origin and art tile size as
 * {@link drawKrakenSprite}, so swapping between the two never moves her.
 */
export function drawKrakenSubmergedSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  frame: number,
  state: KrakenSpriteState = {},
): void {
  const cx = sx + tileSize / 2;
  const groundY = sy + tileSize * KRAKEN_GROUND_LINE_TILE_FRACTION;
  const waterY = Math.round(groundY - tileSize * KRAKEN_SUBMERGED_WATERLINE_TILES);

  const murkY = waterY + tileSize * SUBMERGED_MURK_DROP_TILES;
  const murkRx = tileSize * SUBMERGED_MURK_RX_TILES;
  const murk = ctx.createRadialGradient(cx, murkY, 0, cx, murkY, murkRx);
  murk.addColorStop(0, SUBMERGED_MURK_COLOR);
  murk.addColorStop(1, SUBMERGED_MURK_CLEAR);
  ctx.save();
  ctx.translate(cx, murkY);
  ctx.scale(1, SUBMERGED_MURK_RY_TILES / SUBMERGED_MURK_RX_TILES);
  ctx.translate(-cx, -murkY);
  ctx.fillStyle = murk;
  ctx.beginPath();
  ctx.arc(cx, murkY, murkRx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  ctx.save();
  try {
    ctx.beginPath();
    // Everything above the surface, as wide and tall as any cell of hers can reach.
    const reach = tileSize * KRAKEN_ART_HEIGHT_TILES;
    ctx.rect(cx - reach, waterY - reach, reach * 2, reach);
    ctx.clip();
    drawKrakenSprite(ctx, sx, sy, tileSize, state);
  } finally {
    ctx.restore();
  }

  const collarRx = tileSize * SUBMERGED_COLLAR_RX_TILES;
  const lineWidth = Math.max(1, tileSize * SUBMERGED_LINE_WIDTH_TILES);
  ctx.fillStyle = SUBMERGED_COLLAR_FILL;
  ctx.beginPath();
  ctx.ellipse(cx, waterY, collarRx, collarRx * SUBMERGED_COLLAR_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = SUBMERGED_COLLAR_RIM;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(cx, waterY, collarRx, collarRx * SUBMERGED_COLLAR_FLATTEN, 0, 0, Math.PI);
  ctx.stroke();

  ctx.fillStyle = SUBMERGED_FOAM_COLOR;
  const spin = (frame / SUBMERGED_FOAM_TURN_TICKS) * TWO_PI;
  for (let bead = 0; bead < SUBMERGED_FOAM_BEADS; bead++) {
    const angle = (bead / SUBMERGED_FOAM_BEADS) * TWO_PI + spin;
    const swell = Math.sin(
      (frame / SUBMERGED_FOAM_SWELL_TICKS) * TWO_PI + bead * SUBMERGED_FOAM_PHASE_STEP,
    );
    const radius = tileSize * (SUBMERGED_FOAM_RADIUS_TILES + swell * SUBMERGED_FOAM_SWELL_TILES);
    if (radius <= 0) continue;
    const reach =
      collarRx * (1 + Math.sin(bead * SUBMERGED_FOAM_SCATTER_STEP) * SUBMERGED_FOAM_SCATTER);
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * reach,
      waterY + Math.sin(angle) * reach * SUBMERGED_COLLAR_FLATTEN,
      radius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.strokeStyle = SUBMERGED_RIPPLE_COLOR;
  for (let ring = 0; ring < SUBMERGED_RIPPLE_RINGS; ring++) {
    const life = (frame / SUBMERGED_RIPPLE_PERIOD_TICKS + ring / SUBMERGED_RIPPLE_RINGS) % 1;
    const rx = collarRx * (1 + life * SUBMERGED_RIPPLE_GROWTH);
    ctx.globalAlpha = 1 - life;
    ctx.beginPath();
    ctx.ellipse(cx, waterY, rx, rx * SUBMERGED_COLLAR_FLATTEN, 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
export function drawKrakenEnrageGlow(
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
 * How far from its target point the slam reaches, in tiles.
 *
 * The one number both the telegraph ring and `Kraken`'s hit test read: the
 * ring is the player's only reading of where the blow lands, so a decal drawn
 * at any other radius would be a lie about the hitbox.
 */
export const KRAKEN_SLAM_RADIUS_TILES = 1.5;

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
  const radius = tileSize * KRAKEN_SLAM_RADIUS_TILES;
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
export type KrakenSlamPhase = 'rise' | 'loom' | 'dive' | 'smash';

/** Every slam beat, in the order they play; the prewarm and the gates read it. */
export const KRAKEN_SLAM_PHASES: readonly KrakenSlamPhase[] = ['rise', 'loom', 'dive', 'smash'];

function slamFrameCountOf(state: KrakenSlamPhase): number {
  return figureFrameCount(KRAKEN_SLAM_FIGURE, state);
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
export interface KrakenSlamSpriteState {
  readonly phase: KrakenSlamPhase;
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
 * from `Kraken`'s marker by `BossRoomSystem` rather than out of any
 * creature's own `drawSelf` and its cull margin.
 *
 * @param sx Screen x of the tile the tentacle stands on, top-left.
 * @param sy Screen y of the tile the tentacle stands on, top-left.
 */
export function drawKrakenSlamTentacle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: KrakenSlamSpriteState,
): void {
  const { phase, progress, mirrored = false } = state;
  const frameCount = slamFrameCountOf(phase);
  const frame =
    phase === 'smash'
      ? smashFrameIndex(progress, frameCount)
      : progressFrameIndex(progress, frameCount);
  const alpha = phase === 'smash' ? smashAlpha(progress) : 1;
  drawFigureCached(ctx, KRAKEN_SLAM_FIGURE, phase, frame, sx, sy, tileSize, {
    flipX: mirrored,
    alpha,
  });
}
