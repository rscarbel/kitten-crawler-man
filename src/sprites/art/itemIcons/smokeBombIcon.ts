import type { Rect } from '../../../ui/core/geom';
import {
  FULL_TURN,
  hairlineWidth,
  litFill,
  MEDIUM_DETAIL,
  outlineWidth,
  paintForm,
  paintIconArt,
  tone,
  withShapeClip,
} from './iconPaint';

/**
 * The Smoke Bomb: a round pot of unglazed fired clay, a stubby cork stopper
 * in its neck and a wisp of grey smoke curling off the cork. The warm clay,
 * the pale cork and the smoke are what tell it from the black iron powder
 * bomb at slot size; the silhouette is otherwise the same round pot with a
 * neck.
 *
 * Clay is matte, so the pot is lit from the upper left with one curved
 * terminator and a broad soft bloom, never a hard specular or a glint. A few
 * darker flecks of grit say "fired clay" rather than "polished orange".
 */

const POT_X = 0.42;
const POT_Y = 0.66;
const POT_RADIUS = 0.28;

const CLAY = '#bf6a3d';
const CLAY_SHADOW = tone(CLAY, -0.42);
/** The line where the form turns from the light: soft, as matte clay is. */
const TERMINATOR_INK = tone(CLAY, -0.55);
const TERMINATOR_WIDTH_SCALE = 2;
/** Floor light bounced onto the underside: warm, faint and confined to a thin rim. */
const REFLECTED_LIGHT = '#c98a62';
const REFLECTED_ALPHA = 0.5;
/** How far the lit lens is pushed toward the light, per unit radius. */
const LIT_SHIFT_X = -0.26;
const LIT_SHIFT_Y = -0.32;
/** How far the reflected rim's cut-out is pushed toward the light, per unit radius; small, so the rim stays thin. */
const RIM_SHIFT_X = -0.07;
const RIM_SHIFT_Y = -0.12;
/** A broad matte bloom high on the lit side, in place of a shine. */
const BLOOM_X = -0.38;
const BLOOM_Y = -0.42;
const BLOOM_RADIUS = 0.36;
const BLOOM_INK = tone(CLAY, 0.42);
const BLOOM_ALPHA = 0.5;

/** Grit fired into the clay: offsets from the pot's centre per unit radius, and a fleck's radius. */
const GRIT_FLECKS: readonly (readonly [number, number])[] = [
  [-0.35, 0.18],
  [0.05, 0.42],
  [0.42, 0.05],
  [-0.05, -0.12],
  [0.28, 0.48],
  [-0.52, -0.08],
  [0.18, -0.38],
];
const GRIT_RADIUS = 0.009;
const GRIT_INK = tone(CLAY, -0.5);

/** The neck leans toward the upper right, the way the smoke drifts. */
const NECK_LEAN = Math.PI / 7;
/** Where the neck leaves the pot, as a share of its radius from the centre; inside the rim so the pot overlaps its foot. */
const NECK_ROOT_SHARE = 0.86;
const NECK_WIDTH = 0.13;
const NECK_LENGTH = 0.09;
const LIP_WIDTH = 0.18;
const LIP_HEIGHT = 0.045;
const NECK_CLAY = '#a85a33';

/** The groove a potter scores round the shoulder, circling the neck's root. */
const GROOVE_TOWARD_NECK = 0.58;
const GROOVE_TILT = 0.3;
const GROOVE_INK = tone(CLAY, -0.5);
const GROOVE_RIDGE = tone(CLAY, 0.3);
/** The groove's lit lip sits this far pot-side of the cut, per unit radius. */
const GROOVE_RIDGE_OFFSET = 0.06;

const CORK_WIDTH = 0.12;
const CORK_HEIGHT = 0.085;
const CORK = '#dcb97f';
/** The cork's top face, seen a little from above. */
const CORK_TOP_INK = tone(CORK, 0.25);
const CORK_TOP_HEIGHT = 0.026;
/** The pores that make cork read as cork: offsets from the cork's centre and their radius. */
const CORK_PORES: readonly (readonly [number, number])[] = [
  [-0.03, 0.012],
  [0.024, 0.028],
  [0.008, -0.004],
];
const CORK_PORE_RADIUS = 0.009;
const CORK_PORE_INK = tone(CORK, -0.45);

/**
 * The wisp: puffs along a curl rising off the cork, in the neck's frame from
 * the cork's top, each swelling as it climbs. Their union is outlined as one
 * form and lit from the upper left like everything else.
 */
const WISP_PUFFS: readonly (readonly [x: number, y: number, radius: number])[] = [
  [0.0, -0.025, 0.026],
  [-0.02, -0.065, 0.032],
  [0.01, -0.105, 0.036],
  [0.06, -0.135, 0.04],
  [0.12, -0.15, 0.042],
];
const SMOKE = '#cfcfcb';
const SMOKE_SHADOW = tone(SMOKE, -0.3);
const SMOKE_LIT = tone(SMOKE, 0.5);
/** The smoke's outline is a soft dark grey, not the solid ink of a hard object. */
const SMOKE_OUTLINE = '#3a3a3c';
/**
 * The smoke's mid and lit tones are each puff shifted toward the light, per
 * unit puff radius, and clipped to the wisp, so every puff keeps a shadowed
 * belly under a lit top.
 */
const SMOKE_MID_SHIFT_X = -0.25;
const SMOKE_MID_SHIFT_Y = -0.3;
const SMOKE_LIT_SHIFT_X = -0.55;
const SMOKE_LIT_SHIFT_Y = -0.65;

function tracePot(ctx: CanvasRenderingContext2D, dx = 0, dy = 0): void {
  ctx.beginPath();
  ctx.arc(POT_X + dx, POT_Y + dy, POT_RADIUS, 0, FULL_TURN);
}

/** Moves into the neck's own frame: origin at its root, -Y up the neck. */
function enterNeckFrame(ctx: CanvasRenderingContext2D): void {
  const rootDistance = POT_RADIUS * NECK_ROOT_SHARE;
  ctx.translate(
    POT_X + Math.sin(NECK_LEAN) * rootDistance,
    POT_Y - Math.cos(NECK_LEAN) * rootDistance,
  );
  ctx.rotate(NECK_LEAN);
}

function traceWisp(ctx: CanvasRenderingContext2D, originY: number, dx = 0, dy = 0): void {
  ctx.beginPath();
  for (const [x, y, radius] of WISP_PUFFS) {
    ctx.moveTo(x + dx * radius + radius, originY + y + dy * radius);
    ctx.arc(x + dx * radius, originY + y + dy * radius, radius, 0, FULL_TURN);
  }
}

/** The neck, lip, cork and smoke, painted in the neck's own frame. */
function paintNeckCorkAndSmoke(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.save();
  enterNeckFrame(ctx);

  const lipTop = -NECK_LENGTH - LIP_HEIGHT;
  const corkTop = lipTop - CORK_HEIGHT;
  const smokeOrigin = corkTop;
  const unrotateSmoke = (): void => {
    ctx.translate(0, smokeOrigin);
    ctx.rotate(-NECK_LEAN);
    ctx.translate(0, -smokeOrigin);
  };

  ctx.save();
  unrotateSmoke();
  traceWisp(ctx, smokeOrigin);
  ctx.strokeStyle = SMOKE_OUTLINE;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = SMOKE_SHADOW;
  ctx.fill();
  withShapeClip(
    ctx,
    () => traceWisp(ctx, smokeOrigin),
    () => {
      traceWisp(ctx, smokeOrigin, SMOKE_MID_SHIFT_X, SMOKE_MID_SHIFT_Y);
      ctx.fillStyle = SMOKE;
      ctx.fill();
      traceWisp(ctx, smokeOrigin, SMOKE_LIT_SHIFT_X, SMOKE_LIT_SHIFT_Y);
      ctx.fillStyle = SMOKE_LIT;
      ctx.fill();
    },
  );
  ctx.restore();

  const corkHalf = CORK_WIDTH / 2;
  const traceCork = (): void => {
    ctx.beginPath();
    ctx.rect(-corkHalf, corkTop, CORK_WIDTH, CORK_HEIGHT);
  };
  paintForm(ctx, px, traceCork, litFill(ctx, CORK, [-corkHalf, 0], [corkHalf, 0]));
  withShapeClip(ctx, traceCork, () => {
    ctx.fillStyle = CORK_TOP_INK;
    ctx.fillRect(-corkHalf, corkTop, CORK_WIDTH, CORK_TOP_HEIGHT);
    const corkMiddle = corkTop + CORK_HEIGHT / 2;
    ctx.fillStyle = CORK_PORE_INK;
    for (const [x, y] of CORK_PORES) {
      ctx.beginPath();
      ctx.arc(x, corkMiddle + y, CORK_PORE_RADIUS, 0, FULL_TURN);
      ctx.fill();
    }
  });

  const neckHalf = NECK_WIDTH / 2;
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.rect(-neckHalf, -NECK_LENGTH, NECK_WIDTH, NECK_LENGTH);
    },
    litFill(ctx, NECK_CLAY, [-neckHalf, 0], [neckHalf, 0]),
  );
  const lipHalf = LIP_WIDTH / 2;
  paintForm(
    ctx,
    px,
    () => {
      ctx.beginPath();
      ctx.rect(-lipHalf, lipTop, LIP_WIDTH, LIP_HEIGHT);
    },
    litFill(ctx, NECK_CLAY, [-lipHalf, 0], [lipHalf, 0]),
  );
  ctx.restore();
}

/** The scored groove round the shoulder, turned with the neck so it collars it. */
function paintGroove(ctx: CanvasRenderingContext2D, px: number): void {
  const halfChord = POT_RADIUS * Math.sqrt(1 - GROOVE_TOWARD_NECK * GROOVE_TOWARD_NECK);
  ctx.save();
  ctx.translate(POT_X, POT_Y);
  ctx.rotate(NECK_LEAN);
  const grooveY = -POT_RADIUS * GROOVE_TOWARD_NECK;
  ctx.lineWidth = hairlineWidth(px) * MEDIUM_DETAIL;
  ctx.strokeStyle = GROOVE_INK;
  ctx.beginPath();
  ctx.ellipse(0, grooveY, halfChord, halfChord * GROOVE_TILT, 0, 0, Math.PI);
  ctx.stroke();
  ctx.lineWidth = hairlineWidth(px);
  ctx.strokeStyle = GROOVE_RIDGE;
  ctx.beginPath();
  ctx.ellipse(
    0,
    grooveY + POT_RADIUS * GROOVE_RIDGE_OFFSET,
    halfChord,
    halfChord * GROOVE_TILT,
    0,
    0,
    Math.PI,
  );
  ctx.stroke();
  ctx.restore();
}

function paintPot(ctx: CanvasRenderingContext2D, px: number): void {
  paintForm(ctx, px, () => tracePot(ctx), CLAY_SHADOW);
  withShapeClip(
    ctx,
    () => tracePot(ctx),
    () => {
      tracePot(ctx, LIT_SHIFT_X * POT_RADIUS, LIT_SHIFT_Y * POT_RADIUS);
      ctx.fillStyle = litFill(
        ctx,
        CLAY,
        [POT_X - POT_RADIUS, POT_Y - POT_RADIUS],
        [POT_X + POT_RADIUS, POT_Y + POT_RADIUS],
      );
      ctx.fill();
      ctx.strokeStyle = TERMINATOR_INK;
      ctx.lineWidth = hairlineWidth(px) * TERMINATOR_WIDTH_SCALE;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(
        POT_X + BLOOM_X * POT_RADIUS,
        POT_Y + BLOOM_Y * POT_RADIUS,
        BLOOM_RADIUS * POT_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.globalAlpha = BLOOM_ALPHA;
      ctx.fillStyle = BLOOM_INK;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(POT_X, POT_Y, POT_RADIUS, 0, FULL_TURN);
      ctx.arc(
        POT_X + RIM_SHIFT_X * POT_RADIUS,
        POT_Y + RIM_SHIFT_Y * POT_RADIUS,
        POT_RADIUS,
        0,
        FULL_TURN,
      );
      ctx.globalAlpha = REFLECTED_ALPHA;
      ctx.fillStyle = REFLECTED_LIGHT;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;

      ctx.fillStyle = GRIT_INK;
      for (const [dx, dy] of GRIT_FLECKS) {
        ctx.beginPath();
        ctx.arc(
          POT_X + dx * POT_RADIUS,
          POT_Y + dy * POT_RADIUS,
          Math.max(GRIT_RADIUS, px / 2),
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
      paintGroove(ctx, px);
    },
  );
}

/** Paints the Smoke Bomb into `rect`'s icon square. */
export function drawSmokeBombIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  paintIconArt(ctx, rect, (art, px) => {
    paintNeckCorkAndSmoke(art, px);
    paintPot(art, px);
  });
}
