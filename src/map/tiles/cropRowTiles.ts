/**
 * The crop growing on a Briar Hollow field, drawn flat over the `crop_rows`
 * furrows in the chunk bake.
 *
 * Planted along the furrow crests the ground painter lays down, so the rows of
 * plants and the rows of soil are one set of lines. Each plant is kept inside
 * its own tile — a mark that overhangs is clipped at a chunk's edge and painted
 * over by the next tile's base pass, so it would appear whole or cut in half
 * depending on where the tile falls in the bake order.
 */

import type { TileContent } from '../tileTypes';
import type { CropKind } from '../overworld/briarHollowSite';
import { rectContains } from '../overworld/briarHollowSite';
import { briarHollowSiteFor } from './hollowSiteRegistry';
import { tileHash, tileHash01 } from './hollowTileHash';
import { CROP_FURROWS_PER_TILE, CROP_RIDGE_CREST_OFFSET } from '../tilegen/materials';

/** Used only when a field tile lies outside every recorded field. */
const FALLBACK_CROP_KINDS: readonly CropKind[] = ['grain', 'cabbage', 'roots'];
const FALLBACK_KIND_SALT = 0xc409;
const PLANT_JITTER_SALT = 0xc40a;
const PLANT_LEAN_SALT = 0xc40b;
const PLANT_SIZE_SALT = 0xc40c;
const FULL_TURN = Math.PI * 2;

/** A plant's cast shadow, falling south-east of it as the ground's light does. */
const PLANT_SHADOW_COLOR = 'rgba(38, 26, 16, 0.22)';
const PLANT_SHADOW_OFFSET_SHARE = 0.025;

/** How far a plant may drift along its row, as a share of its slot. */
const PLANT_JITTER_SHARE = 0.3;
/** Size varies around nominal by up to this share either way. */
const PLANT_SIZE_VARIATION = 0.2;

const GRAIN_STALKS_PER_ROW = 7;
const GRAIN_STALK_HEIGHT_SHARE = 0.17;
const GRAIN_STALK_WIDTH_SHARE = 0.03;
const GRAIN_MAX_LEAN_SHARE = 0.04;
const GRAIN_HEAD_HALF_WIDTH_SHARE = 0.022;
const GRAIN_HEAD_HALF_HEIGHT_SHARE = 0.045;
const GRAIN_STALK_COLOR = '#9a8040';
const GRAIN_HEAD_COLOR = '#bfa156';

const CABBAGES_PER_ROW = 3;
const CABBAGE_RADIUS_SHARE = 0.11;
/** The head sits a little above the crest so its base reads as bedded in. */
const CABBAGE_LIFT_SHARE = 0.4;
const CABBAGE_HEART_SHARE = 0.62;
const CABBAGE_GLINT_SHARE = 0.28;
const CABBAGE_GLINT_OFFSET_SHARE = 0.3;
const CABBAGE_OUTER_COLOR = '#61794a';
const CABBAGE_HEART_COLOR = '#8aa066';
const CABBAGE_GLINT_COLOR = '#a3b67e';

const ROOT_TOPS_PER_ROW = 4;
const ROOT_LEAVES = 3;
const ROOT_LEAF_LENGTH_SHARE = 0.13;
const ROOT_LEAF_HALF_WIDTH_SHARE = 0.028;
/** Angle between the outer leaves of a top's fan. */
const ROOT_FAN_SPREAD = Math.PI * 0.5;
const ROOT_CROWN_RADIUS_SHARE = 0.025;
const ROOT_LEAF_COLORS: readonly string[] = ['#4c6a34', '#5c7c3c', '#52713a'];
const ROOT_CROWN_COLOR = '#8a5a3a';

/** The crop sown on the field holding `(tx, ty)`, or a hashed stand-in outside every field. */
function cropKindAt(structure: TileContent[][], tx: number, ty: number): CropKind {
  const site = briarHollowSiteFor(structure);
  const fieldIndex = site?.cropFields.findIndex((field) => rectContains(field, tx, ty)) ?? -1;
  const recorded = fieldIndex >= 0 ? site?.dressing.cropKinds[fieldIndex] : undefined;
  if (recorded !== undefined) return recorded;
  const fallbackIndex = tileHash(tx, ty, FALLBACK_KIND_SALT) % FALLBACK_CROP_KINDS.length;
  return FALLBACK_CROP_KINDS[fallbackIndex] ?? 'grain';
}

/** A plant's place on its row: where it stands and how big it grew. */
interface PlantSlot {
  readonly x: number;
  readonly y: number;
  /** Multiplier around nominal size. */
  readonly scale: number;
  /** Signed, in [-1, 1]. */
  readonly lean: number;
}

/** Every plant slot in the tile, row by row along the furrow crests. */
function plantSlots(
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  perRow: number,
): PlantSlot[] {
  const slots: PlantSlot[] = [];
  const pitch = ts / CROP_FURROWS_PER_TILE;
  const slotWidth = ts / perRow;
  for (let row = 0; row < CROP_FURROWS_PER_TILE; row++) {
    const crestY = sy + (row + CROP_RIDGE_CREST_OFFSET) * pitch;
    for (let i = 0; i < perRow; i++) {
      const salt = row * perRow + i;
      const jitter = (tileHash01(tx, ty, PLANT_JITTER_SALT + salt) - 0.5) * PLANT_JITTER_SHARE;
      const sizeRoll = (tileHash01(tx, ty, PLANT_SIZE_SALT + salt) - 0.5) * 2;
      slots.push({
        x: sx + (i + 0.5 + jitter) * slotWidth,
        y: crestY,
        scale: 1 + sizeRoll * PLANT_SIZE_VARIATION,
        lean: (tileHash01(tx, ty, PLANT_LEAN_SALT + salt) - 0.5) * 2,
      });
    }
  }
  return slots;
}

function drawGrain(ctx: CanvasRenderingContext2D, slot: PlantSlot, ts: number): void {
  const height = ts * GRAIN_STALK_HEIGHT_SHARE * slot.scale;
  const topX = slot.x + slot.lean * ts * GRAIN_MAX_LEAN_SHARE;
  const topY = slot.y - height;
  const shadowOffset = ts * PLANT_SHADOW_OFFSET_SHARE;

  ctx.lineWidth = Math.max(1, ts * GRAIN_STALK_WIDTH_SHARE);
  ctx.lineCap = 'round';
  ctx.strokeStyle = PLANT_SHADOW_COLOR;
  ctx.beginPath();
  ctx.moveTo(slot.x + shadowOffset, slot.y);
  ctx.lineTo(topX + shadowOffset * 2, topY + shadowOffset * 2);
  ctx.stroke();

  ctx.strokeStyle = GRAIN_STALK_COLOR;
  ctx.beginPath();
  ctx.moveTo(slot.x, slot.y);
  ctx.lineTo(topX, topY);
  ctx.stroke();

  ctx.fillStyle = GRAIN_HEAD_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    topX,
    topY,
    ts * GRAIN_HEAD_HALF_WIDTH_SHARE,
    ts * GRAIN_HEAD_HALF_HEIGHT_SHARE * slot.scale,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
}

function drawCabbage(ctx: CanvasRenderingContext2D, slot: PlantSlot, ts: number): void {
  const radius = ts * CABBAGE_RADIUS_SHARE * slot.scale;
  const centreY = slot.y - radius * CABBAGE_LIFT_SHARE;
  const shadowOffset = ts * PLANT_SHADOW_OFFSET_SHARE;

  ctx.fillStyle = PLANT_SHADOW_COLOR;
  ctx.beginPath();
  ctx.arc(slot.x + shadowOffset, centreY + shadowOffset * 2, radius, 0, FULL_TURN);
  ctx.fill();

  ctx.fillStyle = CABBAGE_OUTER_COLOR;
  ctx.beginPath();
  ctx.arc(slot.x, centreY, radius, 0, FULL_TURN);
  ctx.fill();

  ctx.fillStyle = CABBAGE_HEART_COLOR;
  ctx.beginPath();
  ctx.arc(slot.x, centreY, radius * CABBAGE_HEART_SHARE, 0, FULL_TURN);
  ctx.fill();

  const glintOffset = radius * CABBAGE_GLINT_OFFSET_SHARE;
  ctx.fillStyle = CABBAGE_GLINT_COLOR;
  ctx.beginPath();
  ctx.arc(slot.x - glintOffset, centreY - glintOffset, radius * CABBAGE_GLINT_SHARE, 0, FULL_TURN);
  ctx.fill();
}

function drawRootTop(ctx: CanvasRenderingContext2D, slot: PlantSlot, ts: number): void {
  const length = ts * ROOT_LEAF_LENGTH_SHARE * slot.scale;
  const halfWidth = ts * ROOT_LEAF_HALF_WIDTH_SHARE;
  const shadowOffset = ts * PLANT_SHADOW_OFFSET_SHARE;
  const leafAngles = Array.from({ length: ROOT_LEAVES }, (_, leaf) => {
    const spreadShare = leaf / (ROOT_LEAVES - 1) - 0.5;
    return spreadShare * ROOT_FAN_SPREAD + slot.lean * (ROOT_FAN_SPREAD / ROOT_LEAVES);
  });

  const drawLeaf = (angle: number, offset: number, color: string): void => {
    // An ellipse centred half a leaf out from the crown, pointing along `angle`
    // measured from straight up.
    const centreX = slot.x + Math.sin(angle) * (length / 2) + offset;
    const centreY = slot.y - Math.cos(angle) * (length / 2) + offset;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(centreX, centreY, halfWidth, length / 2, angle, 0, FULL_TURN);
    ctx.fill();
  };

  for (const angle of leafAngles) drawLeaf(angle, shadowOffset, PLANT_SHADOW_COLOR);
  leafAngles.forEach((angle, leaf) => {
    drawLeaf(angle, 0, ROOT_LEAF_COLORS[leaf % ROOT_LEAF_COLORS.length] ?? PLANT_SHADOW_COLOR);
  });

  ctx.fillStyle = ROOT_CROWN_COLOR;
  ctx.beginPath();
  ctx.arc(slot.x, slot.y, ts * ROOT_CROWN_RADIUS_SHARE, 0, FULL_TURN);
  ctx.fill();
}

const PLANTS_PER_ROW: Record<CropKind, number> = {
  grain: GRAIN_STALKS_PER_ROW,
  cabbage: CABBAGES_PER_ROW,
  roots: ROOT_TOPS_PER_ROW,
};

const PLANT_PAINTERS: Record<
  CropKind,
  (ctx: CanvasRenderingContext2D, slot: PlantSlot, ts: number) => void
> = {
  grain: drawGrain,
  cabbage: drawCabbage,
  roots: drawRootTop,
};

/** Draws the crop standing on one `CROP_FIELD` tile, over its already-drawn furrows. */
export function drawCropRowOverlay(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const kind = cropKindAt(structure, tx, ty);
  const paintPlant = PLANT_PAINTERS[kind];
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  for (const slot of plantSlots(sx, sy, ts, tx, ty, PLANTS_PER_ROW[kind])) {
    paintPlant(ctx, slot, ts);
  }
  ctx.restore();
}
