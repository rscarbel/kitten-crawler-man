import { drawDumbbellHeld } from './gymEquipmentSprite';
import { drawText } from '../ui/TextBox';
import {
  drawSpriteKey,
  progressFrameIndex,
  timeFrameIndex,
  walkFrameIndex,
} from '../core/SpriteRenderer';
import {
  JUICER_IDLE_FRAMES,
  JUICER_PUNCH_FRAMES,
  JUICER_SPRINT_FRAMES,
  JUICER_THROW_FRAMES,
  JUICER_THROW_RELEASE_PROGRESS,
  JUICER_WALK_FRAMES,
} from './juicerAttackTiming';
import {
  JUICER_CARRY_HAND_ANCHORS,
  JUICER_THROW_HAND_ANCHORS,
  TILE_CENTRE_FRACTION,
  type JuicerHandView,
  type TileFraction,
} from './juicerHandAnchor';

/**
 * The three views the sheet carries. The profile is mirrored for the other
 * direction; mirroring a head-on view would swap his eyes and his lifting
 * gloves onto the wrong sides every time he turned around.
 */
type JuicerView = JuicerHandView;

type JuicerBase = 'idle' | 'walk' | 'sprint' | 'throw' | 'punch';

type JuicerState =
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
 * Exhaustive by construction: a row added to the manifest but not to this map
 * is a compile error, which is safer than reading the count off the sheet —
 * `drawSprite` *clamps* the frame index, so a row that got shorter would
 * silently freeze on its last frame instead of failing.
 */
const FRAME_COUNT: Record<JuicerState, number> = {
  idle: JUICER_IDLE_FRAMES,
  idle_side: JUICER_IDLE_FRAMES,
  idle_away: JUICER_IDLE_FRAMES,
  walk: JUICER_WALK_FRAMES,
  walk_side: JUICER_WALK_FRAMES,
  walk_away: JUICER_WALK_FRAMES,
  sprint: JUICER_SPRINT_FRAMES,
  sprint_side: JUICER_SPRINT_FRAMES,
  sprint_away: JUICER_SPRINT_FRAMES,
  throw: JUICER_THROW_FRAMES,
  throw_side: JUICER_THROW_FRAMES,
  throw_away: JUICER_THROW_FRAMES,
  punch: JUICER_PUNCH_FRAMES,
  punch_side: JUICER_PUNCH_FRAMES,
  punch_away: JUICER_PUNCH_FRAMES,
};

/**
 * The severed pieces, in the order the bake lays them into the gore row.
 * `BodyPartGoreSystem` silently skips a state it cannot find, so this list and
 * `GORE_STATES` in the generator are held equal by a bake gate.
 */
export const JUICER_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_torso',
  'gore_arm',
  'gore_forearm',
  'gore_thigh',
  'gore_shin',
  'gore_entrails',
  'gore_tail',
];

export const JUICER_BODY_PART_KEY = 'juicer';

/**
 * How far above his tile's top edge his standing art reaches, in tiles.
 *
 * Measured off the baked sheet: the manifest anchors his tile 100 sheet px
 * down each 176 px frame at a tile scale of 64, and the idle row's ink starts
 * 7 px down, which puts the top of his head 93/64 of a tile above the tile he
 * stands on. Anything written over him — the health bar, the taunt bubble, the
 * septic label — is lifted by this or it is painted across his chest.
 */
export const JUICER_HEAD_CLEARANCE_TILES = 1.45;

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
 * The enraged treatment: hotter blood under the hide, not a palette swap. The
 * old sheet paid for `_enraged` copies of every row; at five states across
 * three views that would have doubled a sheet several times its size.
 */
const ENRAGED_FILTER = 'saturate(1.6) brightness(1.08)';

/**
 * The hit flash. It wins outright over {@link ENRAGED_FILTER} rather than
 * composing with it: `ctx.filter` takes one value, and an enraged Juicer whose
 * flash was diluted would stop reading as "that landed" for the whole second
 * half of his fight, which is exactly when the player needs the feedback.
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

export interface JuicerSpriteState {
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
function viewFor(facingX: number, facingY: number): JuicerView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: JuicerBase, view: JuicerView): JuicerState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * The dumbbell, drawn at a hand anchor rather than baked into the row: he is
 * empty-handed for part of every fight, and one sheet cannot carry a
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
  key: JuicerState,
  frame: number,
  sx: number,
  sy: number,
  tileSize: number,
  view: JuicerView,
  flipX: boolean,
  dumbbell: { readonly anchor: TileFraction; readonly swing: number } | null,
): void {
  const carryDrawsFirst = view === 'away';
  const paintDumbbell = (): void => {
    if (dumbbell === null) return;
    drawHeldDumbbell(ctx, sx, sy, tileSize, dumbbell.anchor, flipX, dumbbell.swing);
  };

  if (carryDrawsFirst) paintDumbbell();
  drawSpriteKey(ctx, 'juicer', key, frame, sx, sy, tileSize, { flipX });
  if (!carryDrawsFirst) paintDumbbell();
}

/**
 * Draws the Juicer.
 *
 * Priority is punch → throw → sprint → walk → idle, so a committed attack
 * always wins over the locomotion it interrupted.
 */
export function drawJuicerSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  state: JuicerSpriteState,
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
    const stillHolding = carrying && throwProgress < JUICER_THROW_RELEASE_PROGRESS;
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
    const carryAnchor = carrying ? JUICER_CARRY_HAND_ANCHORS[view] : null;
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
function throwHandAnchor(view: JuicerView, frame: number): TileFraction | null {
  const anchors = JUICER_THROW_HAND_ANCHORS[view];
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

/**
 * The gap between the top of his head and the bottom of the taunt bubble, in
 * tiles.
 */
const BUBBLE_HEAD_GAP_TILES = 0.15;

/** Render a speech bubble with the Juicer's taunt above his head. */
export function drawJuicerSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  text: string,
  pulse: number,
): void {
  const cx = sx + s * TILE_CENTRE_FRACTION;
  const bubbleY = sy - s * (JUICER_HEAD_CLEARANCE_TILES + BUBBLE_HEAD_GAP_TILES);

  ctx.save();
  ctx.font = 'bold 9px monospace';
  const textWidth = ctx.measureText(text).width;
  const padX = 8;
  const bw = textWidth + padX * 2;
  const bh = 18;
  const bx = cx - bw * 0.5;
  const by = bubbleY - bh - 2;

  const alpha = 0.85 + 0.1 * Math.sin(pulse * 0.1);
  ctx.globalAlpha = alpha;

  // Bubble background
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 5);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 5);
  ctx.stroke();

  // Tail pointing down toward head
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh);
  ctx.lineTo(cx + 4, by + bh);
  ctx.lineTo(cx, bubbleY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.moveTo(cx + 4, by + bh - 1);
  ctx.lineTo(cx, bubbleY);
  ctx.stroke();

  drawText(ctx, text, {
    x: cx,
    y: by + bh * 0.5 - 9 / 2,
    size: 9,
    bold: true,
    font: 'monospace',
    color: '#1a1a1a',
    alpha,
    align: 'center',
  });

  ctx.restore();
}
