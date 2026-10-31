/**
 * A lit frame round a patch of floor: a soft glowing border just outside its
 * edges with brighter brackets at the corners, breathing on the same rhythm
 * as the light beam.
 *
 * It lights the edges and nothing inside them, so whatever lies on the patch
 * (a padlocked seal) is seen in its own colours. Drawn with `'lighter'`, like
 * the beam, so it reads as light on the floor rather than paint.
 */

export interface ObjectiveFramePlacement {
  /** Screen-x of the patch's west edge. */
  readonly left: number;
  /** Screen-y of the patch's north edge. */
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Tile size in pixels; every stroke and gap scales against it. */
  readonly tileSize: number;
  /** `#rrggbb` or any canvas colour. */
  readonly color: string;
  /** 0–1 overall strength. */
  readonly strength: number;
  /** Monotonic clock driving the pulse. */
  readonly timeMs: number;
}

/** How far outside the patch's edges the border runs, so it frames the patch rather than its rim. */
const OUTSET_TILES = 0.08;
/** The pulse pushes the corner brackets out and back by this much. */
const BRACKET_BREATHE_TILES = 0.05;
const CORNER_RADIUS_TILES = 0.14;

/** The glow is drawn as stacked strokes, widest and faintest first, so it feathers outward. */
const GLOW_STROKES: ReadonlyArray<{ readonly widthTiles: number; readonly alpha: number }> = [
  { widthTiles: 0.3, alpha: 0.1 },
  { widthTiles: 0.16, alpha: 0.2 },
  { widthTiles: 0.06, alpha: 0.55 },
];
/** The widest glow stroke, in tiles: how far the glow reaches past the frame. */
const WIDEST_GLOW_TILES = Math.max(...GLOW_STROKES.map((stroke) => stroke.widthTiles));

/** Each corner bracket's arm, as a share of the shorter side. */
const BRACKET_ARM_FRACTION = 0.28;
const BRACKET_WIDTH_TILES = 0.1;
const BRACKET_GLOW_WIDTH_TILES = 0.24;
const BRACKET_ALPHA = 0.95;
const BRACKET_GLOW_ALPHA = 0.3;

const FULL_TURN_RADIANS = Math.PI * 2;
const PULSE_PERIOD_MS = 2100;
/** The pulse swings the frame's strength by this fraction either way. */
const PULSE_DEPTH = 0.18;
const HALF = 0.5;

function pulseAt(timeMs: number): number {
  return Math.sin((timeMs / PULSE_PERIOD_MS) * FULL_TURN_RADIANS);
}

function isOffScreen(
  bounds: { left: number; top: number; right: number; bottom: number },
  view: { readonly viewWidth: number; readonly viewHeight: number },
): boolean {
  return (
    bounds.right < 0 ||
    bounds.left > view.viewWidth ||
    bounds.bottom < 0 ||
    bounds.top > view.viewHeight
  );
}

function traceCornerBrackets(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  arm: number,
): void {
  ctx.beginPath();
  ctx.moveTo(left, top + arm);
  ctx.lineTo(left, top);
  ctx.lineTo(left + arm, top);
  ctx.moveTo(right - arm, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, top + arm);
  ctx.moveTo(right, bottom - arm);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right - arm, bottom);
  ctx.moveTo(left + arm, bottom);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left, bottom - arm);
}

/**
 * Paints the frame, or nothing when it falls wholly outside the view.
 *
 * @param ctx  Canvas context, under the world transform with the camera's offset taken out
 * @param view How much of the world the camera shows, which the frame is culled against
 */
export function drawObjectiveFrame(
  ctx: CanvasRenderingContext2D,
  view: { readonly viewWidth: number; readonly viewHeight: number },
  placement: ObjectiveFramePlacement,
): void {
  const { tileSize, color } = placement;
  const pulse = pulseAt(placement.timeMs);
  const outset = tileSize * OUTSET_TILES;
  const glowReach = tileSize * WIDEST_GLOW_TILES;
  const left = placement.left - outset;
  const top = placement.top - outset;
  const right = placement.left + placement.width + outset;
  const bottom = placement.top + placement.height + outset;
  if (
    isOffScreen(
      {
        left: left - glowReach,
        top: top - glowReach,
        right: right + glowReach,
        bottom: bottom + glowReach,
      },
      view,
    )
  ) {
    return;
  }
  const strength = placement.strength * (1 + pulse * PULSE_DEPTH);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const stroke of GLOW_STROKES) {
    ctx.globalAlpha = Math.min(1, stroke.alpha * strength);
    ctx.lineWidth = tileSize * stroke.widthTiles;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, tileSize * CORNER_RADIUS_TILES);
    ctx.stroke();
  }

  const breathe = tileSize * BRACKET_BREATHE_TILES * (pulse + 1) * HALF;
  const arm = Math.min(right - left, bottom - top) * BRACKET_ARM_FRACTION;
  const bracketLeft = left - breathe;
  const bracketTop = top - breathe;
  const bracketRight = right + breathe;
  const bracketBottom = bottom + breathe;
  traceCornerBrackets(ctx, bracketLeft, bracketTop, bracketRight, bracketBottom, arm);
  ctx.globalAlpha = Math.min(1, BRACKET_GLOW_ALPHA * strength);
  ctx.lineWidth = tileSize * BRACKET_GLOW_WIDTH_TILES;
  ctx.stroke();
  ctx.globalAlpha = Math.min(1, BRACKET_ALPHA * strength);
  ctx.lineWidth = tileSize * BRACKET_WIDTH_TILES;
  ctx.stroke();

  ctx.restore();
}
