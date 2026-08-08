/**
 * Icons for the garrison's four issue-kit armour pieces.
 *
 * One module rather than four inline branches in `InventoryPanel`, and one
 * shared palette rather than four: the pieces are a matched set the player buys
 * over the same counter, so what tells them apart at inventory-slot size has to
 * be the silhouette, not the colour.
 */

import type { ItemId } from '../../core/ItemDefs';

/** The four ids this module can draw. Closed, so a new piece cannot ship iconless. */
export type IssueKitItemId =
  'issue_kettle_helm' | 'padded_gambeson' | 'riveted_bracers' | 'marching_boots';

const ISSUE_KIT_IDS: ReadonlySet<string> = new Set<IssueKitItemId>([
  'issue_kettle_helm',
  'padded_gambeson',
  'riveted_bracers',
  'marching_boots',
]);

/** Whether `id` is a piece of issue kit, and so drawable by {@link drawIssueKitIcon}. */
export function isIssueKitItem(id: ItemId): id is IssueKitItemId {
  return ISSUE_KIT_IDS.has(id);
}

const IRON = '#8a8f98';
const IRON_SHADE = '#5b6068';
const IRON_RIM = '#b9bfc7';
const LEATHER = '#7a5230';
const LEATHER_SHADE = '#4a3020';
const LINEN = '#c8b892';
const LINEN_SHADE = '#8f8161';
const RIVET = '#d9d2b8';
const OUTLINE_WIDTH = 1;
const STITCH_WIDTH = 1;

// Geometry as fractions of the icon square, so every piece scales with the slot.
const ICON_CX = 0.5;
const HELM_DOME_CY = 0.5;
const HELM_DOME_RX = 0.28;
const HELM_DOME_RY = 0.26;
const HELM_BRIM_RX = 0.42;
const HELM_BRIM_RY = 0.09;
const HELM_BRIM_CY = 0.56;
const HELM_DENT_RX = 0.07;
const HELM_DENT_RY = 0.05;
const HELM_DENT_CX = 0.4;
const HELM_DENT_CY = 0.38;

const GAMBESON_TOP = 0.2;
const GAMBESON_BOTTOM = 0.82;
const GAMBESON_SHOULDER_HALF = 0.3;
const GAMBESON_WAIST_HALF = 0.24;
const GAMBESON_COLLAR_HALF = 0.09;
const GAMBESON_QUILT_ROWS = 4;
const GAMBESON_QUILT_TOP = 0.34;
const GAMBESON_QUILT_SPACING = 0.12;
const GAMBESON_QUILT_INSET = 0.24;

const BRACER_TOP = 0.26;
const BRACER_HEIGHT = 0.46;
const BRACER_WIDTH = 0.24;
const BRACER_GAP = 0.06;
const BRACER_RIVET_R = 0.025;
const BRACER_RIVET_ROWS = 2;
const BRACER_RIVET_TOP = 0.36;
const BRACER_RIVET_SPACING = 0.22;
const BRACER_RIVET_INSET = 0.06;

const BOOT_SHAFT_TOP = 0.2;
const BOOT_SHAFT_WIDTH = 0.18;
/** Where the toe box starts, so the boot reads as an L rather than as a post. */
const BOOT_TOE_TOP = 0.48;
const BOOT_TOE_RUN = 0.16;
const BOOT_SOLE_TOP = 0.64;
const BOOT_SOLE_HEIGHT = 0.1;
const BOOT_LEFT_X = 0.16;
const BOOT_RIGHT_X = 0.5;
const BOOT_NAIL_COUNT = 3;
const BOOT_NAIL_R = 0.018;

/** Draws one piece of issue kit into a square icon region at `x`,`y`. */
export function drawIssueKitIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  id: IssueKitItemId,
): void {
  switch (id) {
    case 'issue_kettle_helm':
      drawKettleHelm(ctx, x, y, size);
      return;
    case 'padded_gambeson':
      drawGambeson(ctx, x, y, size);
      return;
    case 'riveted_bracers':
      drawBracers(ctx, x, y, size);
      return;
    case 'marching_boots':
      drawMarchingBoots(ctx, x, y, size);
      return;
  }
}

function drawKettleHelm(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  ctx.fillStyle = IRON_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    y + size * HELM_BRIM_CY,
    size * HELM_BRIM_RX,
    size * HELM_BRIM_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = IRON;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    y + size * HELM_DOME_CY,
    size * HELM_DOME_RX,
    size * HELM_DOME_RY,
    0,
    Math.PI,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.strokeStyle = IRON_RIM;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  // Somebody else's dent — the one detail that says "issued", not "bought".
  ctx.fillStyle = IRON_SHADE;
  ctx.beginPath();
  ctx.ellipse(
    x + size * HELM_DENT_CX,
    y + size * HELM_DENT_CY,
    size * HELM_DENT_RX,
    size * HELM_DENT_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

function drawGambeson(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  const top = y + size * GAMBESON_TOP;
  const bottom = y + size * GAMBESON_BOTTOM;

  ctx.fillStyle = LINEN;
  ctx.beginPath();
  ctx.moveTo(cx - size * GAMBESON_COLLAR_HALF, top);
  ctx.lineTo(cx - size * GAMBESON_SHOULDER_HALF, top + size * GAMBESON_COLLAR_HALF);
  ctx.lineTo(cx - size * GAMBESON_WAIST_HALF, bottom);
  ctx.lineTo(cx + size * GAMBESON_WAIST_HALF, bottom);
  ctx.lineTo(cx + size * GAMBESON_SHOULDER_HALF, top + size * GAMBESON_COLLAR_HALF);
  ctx.lineTo(cx + size * GAMBESON_COLLAR_HALF, top);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINEN_SHADE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  // The quilting is the whole read: without the rows this is a plain tunic.
  ctx.strokeStyle = LINEN_SHADE;
  ctx.lineWidth = STITCH_WIDTH;
  ctx.beginPath();
  for (let row = 0; row < GAMBESON_QUILT_ROWS; row++) {
    const lineY = y + size * (GAMBESON_QUILT_TOP + row * GAMBESON_QUILT_SPACING);
    ctx.moveTo(cx - size * GAMBESON_QUILT_INSET, lineY);
    ctx.lineTo(cx + size * GAMBESON_QUILT_INSET, lineY);
  }
  ctx.stroke();
}

function drawBracers(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ICON_CX;
  const top = y + size * BRACER_TOP;
  const height = size * BRACER_HEIGHT;
  const width = size * BRACER_WIDTH;
  const lefts = [cx - size * BRACER_GAP - width, cx + size * BRACER_GAP];

  for (const left of lefts) {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = LEATHER_SHADE;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.strokeRect(left, top, width, height);

    ctx.fillStyle = RIVET;
    for (let row = 0; row < BRACER_RIVET_ROWS; row++) {
      const rivetY = y + size * (BRACER_RIVET_TOP + row * BRACER_RIVET_SPACING);
      for (const side of [BRACER_RIVET_INSET, BRACER_WIDTH - BRACER_RIVET_INSET]) {
        ctx.beginPath();
        ctx.arc(left + size * side, rivetY, size * BRACER_RIVET_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawMarchingBoots(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  for (const bootX of [BOOT_LEFT_X, BOOT_RIGHT_X]) {
    const left = x + size * bootX;
    const shaftTop = y + size * BOOT_SHAFT_TOP;
    const soleTop = y + size * BOOT_SOLE_TOP;

    ctx.fillStyle = LEATHER;
    ctx.beginPath();
    ctx.moveTo(left, shaftTop);
    ctx.lineTo(left + size * BOOT_SHAFT_WIDTH, shaftTop);
    ctx.lineTo(left + size * BOOT_SHAFT_WIDTH, y + size * BOOT_TOE_TOP);
    ctx.lineTo(left + size * (BOOT_SHAFT_WIDTH + BOOT_TOE_RUN), y + size * BOOT_TOE_TOP);
    ctx.lineTo(left + size * (BOOT_SHAFT_WIDTH + BOOT_TOE_RUN), soleTop);
    ctx.lineTo(left, soleTop);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LEATHER_SHADE;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.stroke();

    const soleWidth = size * (BOOT_SHAFT_WIDTH + BOOT_TOE_RUN);
    ctx.fillStyle = IRON_SHADE;
    ctx.fillRect(left, soleTop, soleWidth, size * BOOT_SOLE_HEIGHT);

    // Hobnails: the reason these are worth coin rather than being a boot.
    ctx.fillStyle = RIVET;
    for (let nail = 0; nail < BOOT_NAIL_COUNT; nail++) {
      const nailX = left + (soleWidth * (nail + 1)) / (BOOT_NAIL_COUNT + 1);
      ctx.beginPath();
      ctx.arc(nailX, soleTop + (size * BOOT_SOLE_HEIGHT) / 2, size * BOOT_NAIL_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
