import { drawDumbbellHeld } from '../../sprites/gymEquipmentSprite';
import { progressFrameIndex, timeFrameIndex, walkFrameIndex } from '../../core/SpriteRenderer';
import { drawFigureCached } from '../../sprites/figure/figureFrameCache';
import { IRON_IGGY_FIGURE } from './ironIggyFigure';
import {
  IRON_IGGY_IDLE_FRAMES,
  IRON_IGGY_PUNCH_FRAMES,
  IRON_IGGY_SPRINT_FRAMES,
  IRON_IGGY_THROW_FRAMES,
  IRON_IGGY_THROW_RELEASE_PROGRESS,
  IRON_IGGY_WALK_FRAMES,
} from './ironIggyAttackTiming';
import {
  IRON_IGGY_CARRY_HAND_ANCHORS,
  IRON_IGGY_THROW_HAND_ANCHORS,
  TILE_CENTRE_FRACTION,
  type IronIggyHandView,
  type TileFraction,
} from './ironIggyHandAnchor';

/**
 * The three views the figure paints. The profile is mirrored for the other
 * direction; mirroring a head-on view would swap his eyes and his lifting
 * gloves onto the wrong sides every time he turned around.
 */
type IronIggyView = IronIggyHandView;

type IronIggyBase = 'idle' | 'walk' | 'sprint' | 'throw' | 'punch';

type IronIggyState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'sprint'
  | 'sprint_side'
  | 'sprint_away'
  | 'throw'
  | 'throw_side'
  | 'throw_away'
  | 'punch'
  | 'punch_side'
  | 'punch_away';

/**
 * Exhaustive by construction: a state added to the figure but not to this map
 * is a compile error, which is safer than reading the count off the figure —
 * the draw call *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<IronIggyState, number> = {
  idle: IRON_IGGY_IDLE_FRAMES,
  idle_side: IRON_IGGY_IDLE_FRAMES,
  idle_away: IRON_IGGY_IDLE_FRAMES,
  walk: IRON_IGGY_WALK_FRAMES,
  walk_side: IRON_IGGY_WALK_FRAMES,
  walk_away: IRON_IGGY_WALK_FRAMES,
  sprint: IRON_IGGY_SPRINT_FRAMES,
  sprint_side: IRON_IGGY_SPRINT_FRAMES,
  sprint_away: IRON_IGGY_SPRINT_FRAMES,
  throw: IRON_IGGY_THROW_FRAMES,
  throw_side: IRON_IGGY_THROW_FRAMES,
  throw_away: IRON_IGGY_THROW_FRAMES,
  punch: IRON_IGGY_PUNCH_FRAMES,
  punch_side: IRON_IGGY_PUNCH_FRAMES,
  punch_away: IRON_IGGY_PUNCH_FRAMES,
};

/**
 * The severed pieces, in the order the figure paints them.
 * `BodyPartGoreSystem` silently skips a state it cannot find, so this list and
 * `GORE_STATES` in the figure are held equal by an art gate.
 */
export const IRON_IGGY_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_arm',
  'gore_forearm',
  'gore_thigh',
  'gore_shin',
  'gore_entrails',
  'gore_tail',
];

export const IRON_IGGY_BODY_PART_KEY = 'iron_iggy';

/**
 * How far above his tile's top edge his standing art reaches, in tiles.
 *
 * Measured off the painted cell: the figure anchors his tile 100 px down each
 * 176 px cell at a tile scale of 64, and the idle row's ink starts 7 px down,
 * which puts the top of his head 93/64 of a tile above the tile he stands on.
 * Anything written over him — a health bar, a speech bubble, a status label —
 * is lifted by this or it is painted across his chest.
 */
export const IRON_IGGY_HEAD_CLEARANCE_TILES = 1.45;

/** Frames per second the idle cycle runs at, off the wall clock. */
const IDLE_FPS = 8;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * How much faster the idle breath and the walk cycle run once he enrages.
 * The enrage read is a treatment rather than a baked row, so the cadence is
 * carrying half of it — a hue shift alone reads as a lighting change.
 */
const ENRAGED_CADENCE_MULTIPLIER = 1.25;

/**
 * The enraged treatment: hotter blood under the hide, not a palette swap.
 * Baked `_enraged` copies of every row, at five states across three views,
 * would double the largest bake this figure has.
 */
const ENRAGED_FILTER = 'saturate(1.6) brightness(1.08)';

/**
 * The hit flash. It wins outright over {@link ENRAGED_FILTER} rather than
 * composing with it: `ctx.filter` takes one value, and an enraged Iron Iggy
 * whose flash was diluted would stop reading as "that landed" for as long as
 * the rage lasts, which is exactly when that feedback matters most.
 */
const DAMAGE_FLASH_FILTER = 'brightness(3)';

/** The held dumbbell's size, as a fraction of a tile. Sized to his fist. */
const CARRY_DUMBBELL_TILE_SCALE = 1;

/**
 * The swing value that draws the dumbbell's bar level. `drawDumbbellHeld`
 * rotates from pulled-back at 0 to swung-forward at 1, so the midpoint is the
 * neutral carry pose.
 */
const CARRY_SWING_PROGRESS = 0.5;

/** The mirror axis a flipped sprite is reflected about, matching `drawSprite`. */
const MIRROR_AXIS_FRACTION = TILE_CENTRE_FRACTION;

export interface IronIggySpriteState {
  /** Walk-cycle phase in radians, as `Mob` advances it from distance travelled. */
  readonly walkFrame?: number;
  /**
   * Sprint-cycle phase in radians, on its own clock. The sprint covers several
   * times the ground the walk does per frame, so sampling it off the shared
   * distance-driven walk phase would skip frames and read as a vibration
   * rather than a charge.
   */
  readonly sprintFrame?: number;
  readonly isMoving?: boolean;
  readonly isSprinting?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0–1 through the dumbbell throw, or null when he is not throwing. */
  readonly throwProgress?: number | null;
  /** 0–1 through the ground punch, or null when he is not punching. */
  readonly punchProgress?: number | null;
  /** Whether he is carrying a dumbbell, which is drawn as a separate overlay. */
  readonly heldDumbbell?: boolean;
  readonly isEnraged?: boolean;
  readonly isDamageFlashing?: boolean;
  /** Pins the clock-driven idle, for the preview harness. */
  readonly idleFrame?: number;
}

/** Views split on whichever axis he is facing hardest along. */
function viewFor(facingX: number, facingY: number): IronIggyView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: IronIggyBase, view: IronIggyView): IronIggyState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * The dumbbell, drawn at a hand anchor rather than baked into the row: he is
 * empty-handed between throws, and one animation row cannot carry a
 * conditional prop.
 */
function drawHeldDumbbell(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  anchor: TileFraction,
  flipX: boolean,
  swing: number,
): void {
  ctx.save();
  if (flipX) {
    const mirrorAxis = sx + tileSize * MIRROR_AXIS_FRACTION;
    ctx.translate(mirrorAxis, 0);
    ctx.scale(-1, 1);
    ctx.translate(-mirrorAxis, 0);
  }
  drawDumbbellHeld(
    ctx,
    sx + anchor.x * tileSize,
    sy + anchor.y * tileSize,
    tileSize * CARRY_DUMBBELL_TILE_SCALE,
    swing,
  );
  ctx.restore();
}

/**
 * Draws the body row with the dumbbell overlay on the correct side of it.
 *
 * The gripping hand is his right, which is the near hand in profile and in the
 * head-on views, so the prop belongs in front of the body there — behind it,
 * his own chest would swallow it. On the away rows that same hand is on the far
 * side of him, so the carry draws first and his back occludes it.
 */
function paintBody(
  ctx: CanvasRenderingContext2D,
  key: IronIggyState,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
  view: IronIggyView,
  flipX: boolean,
  dumbbell: { readonly anchor: TileFraction; readonly swing: number } | null,
): void {
  const carryDrawsFirst = view === 'away';
  const paintDumbbell = (): void => {
    if (dumbbell === null) return;
    drawHeldDumbbell(ctx, sx, sy, tileSize, dumbbell.anchor, flipX, dumbbell.swing);
  };

  if (carryDrawsFirst) paintDumbbell();
  drawFigureCached(ctx, IRON_IGGY_FIGURE, key, frame, sx, sy, tileSize, { flipX });
  if (!carryDrawsFirst) paintDumbbell();
}

/**
 * Draws Iron Iggy.
 *
 * Priority is punch → throw → sprint → walk → idle, so a committed attack
 * always wins over the locomotion it interrupted.
 */
export function drawIronIggySprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: IronIggySpriteState,
): void {
  const facingX = state.facingX ?? 1;
  const facingY = state.facingY ?? 0;
  const view = viewFor(facingX, facingY);
  const flipX = view === 'side' && facingX < 0;
  const carrying = state.heldDumbbell === true;
  const cadence = state.isEnraged === true ? ENRAGED_CADENCE_MULTIPLIER : 1;

  ctx.save();
  if (state.isDamageFlashing === true) ctx.filter = DAMAGE_FLASH_FILTER;
  else if (state.isEnraged === true) ctx.filter = ENRAGED_FILTER;

  const punchProgress = state.punchProgress ?? null;
  const throwProgress = state.throwProgress ?? null;

  if (punchProgress !== null) {
    const key = stateFor('punch', view);
    // No overlay: the anchor contract covers the carry and the throw, and a
    // dumbbell pinned to a carry anchor would float beside a rearing punch.
    paintBody(
      ctx,
      key,
      progressFrameIndex(punchProgress, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      view,
      flipX,
      null,
    );
  } else if (throwProgress !== null) {
    const key = stateFor('throw', view);
    const frame = progressFrameIndex(throwProgress, FRAME_COUNT[key]);
    // Past the release the airborne projectile is the dumbbell, so the overlay
    // has to be gone on the same frame or there are two of them on screen.
    const stillHolding = carrying && throwProgress < IRON_IGGY_THROW_RELEASE_PROGRESS;
    const anchor = stillHolding ? throwHandAnchor(view, frame) : null;
    paintBody(
      ctx,
      key,
      frame,
      sx,
      sy,
      tileSize,
      view,
      flipX,
      anchor === null ? null : { anchor, swing: throwProgress },
    );
  } else if (state.isSprinting === true) {
    const key = stateFor('sprint', view);
    // He sprints to a dumbbell, so the carry only starts after the pickup and
    // the sprint rows are always empty-handed.
    paintBody(
      ctx,
      key,
      walkFrameIndex(state.sprintFrame ?? 0, FRAME_COUNT[key]),
      sx,
      sy,
      tileSize,
      view,
      flipX,
      null,
    );
  } else {
    const walking = state.isMoving === true;
    const key = stateFor(walking ? 'walk' : 'idle', view);
    const nowSeconds = performance.now() / MILLISECONDS_PER_SECOND;
    // The idle is clock-driven rather than timer-driven so that he does not
    // breathe in lockstep with anything else running the same row.
    const frame = walking
      ? walkFrameIndex((state.walkFrame ?? 0) * cadence, FRAME_COUNT[key])
      : (state.idleFrame ?? timeFrameIndex(nowSeconds, IDLE_FPS * cadence, FRAME_COUNT[key]));
    const carryAnchor = carrying ? IRON_IGGY_CARRY_HAND_ANCHORS[view] : null;
    paintBody(
      ctx,
      key,
      frame,
      sx,
      sy,
      tileSize,
      view,
      flipX,
      carryAnchor === null ? null : { anchor: carryAnchor, swing: CARRY_SWING_PROGRESS },
    );
  }

  ctx.restore();
}

/** The gripping hand on one frame of the throw, or null if the row is short. */
function throwHandAnchor(view: IronIggyView, frame: number): TileFraction | null {
  const anchors = IRON_IGGY_THROW_HAND_ANCHORS[view];
  return anchors[Math.min(frame, anchors.length - 1)] ?? null;
}

/**
 * How far the dumbbell turns each game frame while it is in the air.
 *
 * Frame-driven rather than wall-clock: a stall dispatches its queued time all
 * at once, and a spin read off `Date.now()` then jumps a quarter turn between
 * two consecutive draws of a projectile that only moved a few pixels.
 */
const THROWN_SPIN_RADIANS_PER_FRAME = 0.25;

/** Speed below which the motion trail is not drawn, in pixels per frame. */
const TRAIL_MIN_SPEED_PX = 0.5;
const TRAIL_SEGMENTS = 4;
const TRAIL_SPACING_TILES = 0.14;
const TRAIL_RADIUS_TILES = 0.14;
const TRAIL_PEAK_ALPHA = 0.15;
const THROWN_DUMBBELL_TILE_SCALE = 0.8;
const THROWN_SWING_PROGRESS = 0.5;

/**
 * @param age  Game frames the projectile has been in flight, which drives its
 *             spin.
 */
export function drawThrownDumbbell(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  camX: number,
  camY: number,
  s: number,
  vx: number,
  vy: number,
  age: number,
): void {
  const sx = wx - camX;
  const sy = wy - camY;

  const speed = Math.hypot(vx, vy);
  if (speed > TRAIL_MIN_SPEED_PX) {
    const nx = vx / speed;
    const ny = vy / speed;
    for (let i = 1; i <= TRAIL_SEGMENTS; i++) {
      const tx = sx - nx * i * s * TRAIL_SPACING_TILES;
      const ty = sy - ny * i * s * TRAIL_SPACING_TILES;
      ctx.save();
      ctx.globalAlpha = (TRAIL_PEAK_ALPHA * (TRAIL_SEGMENTS + 1 - i)) / TRAIL_SEGMENTS;
      ctx.fillStyle = '#888';
      ctx.beginPath();
      ctx.arc(tx, ty, s * TRAIL_RADIUS_TILES, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(age * THROWN_SPIN_RADIANS_PER_FRAME);
  drawDumbbellHeld(ctx, 0, 0, s * THROWN_DUMBBELL_TILE_SCALE, THROWN_SWING_PROGRESS);
  ctx.restore();
}
