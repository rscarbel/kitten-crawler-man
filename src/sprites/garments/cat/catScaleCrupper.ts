/**
 * The Enchanted Fae Scale Quadruped Crupper of the Fleet on Donut: a skirt of
 * small overlapping scales of pale, iridescent fae steel over her rump and
 * haunches, edged with a gold trim, held on by a gold ring round the root of
 * her tail. It is armour for the back end of a quadruped, so it shows most
 * from behind and in profile; head-on only its edges show past her flanks.
 *
 * Painted onto her haunches, the back of her barrel and her tail as each is
 * painted, clipped to each piece's own outline, so it follows her fur's
 * silhouette and everything painted later covers it.
 */

import type { CatBodyFrame, CatEllipse, CatTailFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { GOLD } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

/** Fae steel: a pale teal with a lilac sheen across it. */
const SCALE_BASE = '#9fd3cc';
const SCALE_LIGHT = '#f2fffc';
const SCALE_SHADOW = '#2d5559';
const SHEEN_LILAC = 'rgba(196,160,236,0.35)';
const SHEEN_CLEAR = 'rgba(196,160,236,0)';
const SHADE_INK = 'rgba(8,10,18,0.3)';
const SHADE_CLEAR = 'rgba(8,10,18,0)';

const SCALE_RADIUS = 0.06;
const ROW_STEP = 0.055;
const COLUMN_STEP = 0.09;
const SCALE_EDGE = 0.018;
const TRIM_WIDTH = 0.022;
const RING_WIDTH = 0.026;
/** The ring's bright stud, halfway out on the lit side of the tail. */
const RING_GLINT_ACROSS = 0.5;
const RING_GLINT_SHARE = 0.35;
/** Each scale is lit along its top edge and shadowed toward its tip. */
const SCALE_LIT_UNTIL = 0.35;
/** The lilac sheen is strongest across the middle of the skirt. */
const SHEEN_PEAK = 0.5;
/** Which segment of the tail's spine the ring sits on, counted from the root. */
const RING_SEGMENT = 1;

/**
 * From behind the skirt starts this share of the barrel's half-height above
 * its middle, arching up over the root of her tail, so it drapes over her
 * hips rather than pooling at her feet.
 */
const BACK_SKIRT_TOP = -0.3;
const BACK_SKIRT_ARCH = 0.35;
/** From behind the skirt ends this share of the barrel's half-height below its middle, clear of her feet. */
const BACK_SKIRT_HEM = 0.45;
/** The hem crosses each haunch this share of its half-height below its middle, sagging a little. */
const HAUNCH_HEM = -0.15;
const HEM_SAG = 0.12;
/** Head-on the skirt shows on each haunch down to this share of its half-height above its middle. */
const FRONT_HIP_HEM = -0.1;
/** In profile, the skirt covers the barrel behind this share of its half-length from the middle. */
const PROFILE_SKIRT_FRONT = -0.2;
/** The skirt's edge bows back over her flank in profile. */
const PROFILE_SKIRT_BOW = 0.12;
/** The front edge runs past the barrel's top and bottom by this share of its half-height, so the clip leaves no gap. */
const PROFILE_EDGE_REACH = 1.2;

function clipTo(ctx: Ctx, outline: readonly Pt[]): void {
  ctx.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.clip();
}

/** Overlapping scales filling `area`, each row lapping over the one above it, then the light. */
function paintScales(ctx: Ctx, area: CatEllipse): void {
  const left = area.cx - area.rx;
  const top = area.cy - area.ry;
  const rows = Math.ceil((area.ry * 2) / ROW_STEP) + 1;
  const columns = Math.ceil((area.rx * 2) / COLUMN_STEP) + 2;
  for (let row = 0; row < rows; row++) {
    const y = top + row * ROW_STEP;
    const offset = row % 2 === 0 ? 0 : COLUMN_STEP / 2;
    for (let column = -1; column < columns; column++) {
      const x = left + column * COLUMN_STEP + offset;
      ctx.beginPath();
      ctx.arc(x, y, SCALE_RADIUS, 0, HALF_TURN);
      ctx.closePath();
      const fill = ctx.createLinearGradient(x, y, x, y + SCALE_RADIUS);
      fill.addColorStop(0, SCALE_LIGHT);
      fill.addColorStop(SCALE_LIT_UNTIL, SCALE_BASE);
      fill.addColorStop(1, SCALE_SHADOW);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = SCALE_SHADOW;
      ctx.lineWidth = SCALE_EDGE;
      ctx.stroke();
    }
  }
  const sheen = ctx.createLinearGradient(left, top, area.cx + area.rx, area.cy + area.ry);
  sheen.addColorStop(0, SHEEN_CLEAR);
  sheen.addColorStop(SHEEN_PEAK, SHEEN_LILAC);
  sheen.addColorStop(1, SHEEN_CLEAR);
  ctx.fillStyle = sheen;
  ctx.fillRect(left, top, area.rx * 2, area.ry * 2);
  const shade = ctx.createLinearGradient(left, top, area.cx + area.rx, area.cy + area.ry);
  shade.addColorStop(0, SHADE_CLEAR);
  shade.addColorStop(1, SHADE_INK);
  ctx.fillStyle = shade;
  ctx.fillRect(left, top, area.rx * 2, area.ry * 2);
}

function strokeTrim(ctx: Ctx, from: Pt, control: Pt, to: Pt): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  ctx.strokeStyle = GOLD.base;
  ctx.lineWidth = TRIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** A haunch down to the skirt's hem, so the bottom of her thigh shows fur below it. */
function paintHaunch(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  const hemY = shape.cy + shape.ry * HAUNCH_HEM;
  ctx.save();
  clipTo(ctx, frame.envelope);
  ctx.beginPath();
  ctx.rect(
    shape.cx - shape.rx * 2,
    shape.cy - shape.ry * 2,
    shape.rx * 4,
    shape.ry * 2 + (hemY - shape.cy),
  );
  ctx.clip();
  paintScales(ctx, shape);
  strokeTrim(
    ctx,
    { x: shape.cx - shape.rx, y: hemY },
    { x: shape.cx, y: hemY + shape.ry * HEM_SAG },
    { x: shape.cx + shape.rx, y: hemY },
  );
  ctx.restore();
}

/** From behind: the barrel from above her hips down, and each haunch to its hem. */
function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'haunch') {
    paintHaunch(ctx, frame);
    return;
  }
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  const skirtTop = shape.cy + shape.ry * BACK_SKIRT_TOP;
  ctx.save();
  clipTo(ctx, frame.envelope);
  ctx.beginPath();
  const hemY = shape.cy + shape.ry * BACK_SKIRT_HEM;
  ctx.rect(shape.cx - shape.rx * 2, skirtTop, shape.rx * 4, hemY - skirtTop);
  ctx.clip();
  paintScales(ctx, shape);
  strokeTrim(
    ctx,
    { x: shape.cx - shape.rx, y: hemY },
    { x: shape.cx, y: hemY + shape.ry * HEM_SAG },
    { x: shape.cx + shape.rx, y: hemY },
  );
  strokeTrim(
    ctx,
    { x: shape.cx - shape.rx, y: skirtTop },
    { x: shape.cx, y: skirtTop - shape.ry * BACK_SKIRT_ARCH },
    { x: shape.cx + shape.rx, y: skirtTop },
  );
  ctx.restore();
}

/**
 * Head-on her chest stands in front of her rump, and only the tops of her
 * haunches show past her flanks: the skirt shows there, at her hips, and no
 * lower, where it read as a cushion she sits on.
 */
function paintFront(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece !== 'haunch') return;
  const { shape } = frame;
  ctx.save();
  clipTo(ctx, frame.envelope);
  ctx.beginPath();
  ctx.rect(
    shape.cx - shape.rx * 2,
    shape.cy - shape.ry * 2,
    shape.rx * 4,
    shape.ry * (2 + FRONT_HIP_HEM),
  );
  ctx.clip();
  paintScales(ctx, shape);
  ctx.restore();
}

/** In profile: the near haunch whole, and the barrel behind a bowed front edge. */
function paintProfile(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'haunch') {
    paintHaunch(ctx, frame);
    return;
  }
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  const edgeX = shape.cx + shape.rx * PROFILE_SKIRT_FRONT;
  const top: Pt = { x: edgeX, y: shape.cy - shape.ry * PROFILE_EDGE_REACH };
  const bottom: Pt = { x: edgeX, y: shape.cy + shape.ry * PROFILE_EDGE_REACH };
  const bow: Pt = { x: edgeX - shape.rx * PROFILE_SKIRT_BOW, y: shape.cy };
  ctx.save();
  clipTo(ctx, frame.envelope);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.quadraticCurveTo(bow.x, bow.y, bottom.x, bottom.y);
  ctx.lineTo(shape.cx - shape.rx * 2, bottom.y);
  ctx.lineTo(shape.cx - shape.rx * 2, top.y);
  ctx.closePath();
  ctx.clip();
  paintScales(ctx, shape);
  strokeTrim(ctx, top, bow, bottom);
  ctx.restore();
}

/** The gold ring round the root of her tail that holds the skirt on. */
function paintTailRing(ctx: Ctx, frame: CatTailFrame): void {
  if (frame.spine.length <= RING_SEGMENT + 1) return;
  const at = frame.spine[RING_SEGMENT];
  const next = frame.spine[RING_SEGMENT + 1];
  const width = frame.widths[RING_SEGMENT];
  const angle = Math.atan2(next.y - at.y, next.x - at.x);
  const across = { x: -Math.sin(angle) * width, y: Math.cos(angle) * width };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(at.x - across.x, at.y - across.y);
  ctx.lineTo(at.x + across.x, at.y + across.y);
  ctx.strokeStyle = GOLD.base;
  ctx.lineWidth = RING_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(
    at.x - across.x * RING_GLINT_ACROSS,
    at.y - across.y * RING_GLINT_ACROSS,
    RING_WIDTH * RING_GLINT_SHARE,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = GOLD.light;
  ctx.fill();
  ctx.restore();
}

export const CAT_SCALE_CRUPPER = defineGarment({
  id: 'cat_scale_crupper',
  name: 'Fae Scale Crupper',
  wearer: 'cat',
  material: 'metal',
  layer: 'outer',
  region: ['body', 'tail'],
  paint: {
    body: withViewFallback(
      { front: paintFront, side: paintProfile, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
    tail: withViewFallback(
      { front: paintTailRing, side: paintTailRing, back: paintTailRing },
      CAT_VIEW_FALLBACK,
    ),
  },
});
