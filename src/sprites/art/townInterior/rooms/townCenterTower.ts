/**
 * Bespoke furniture for the Town Center Tower, the Warden's seat, from the
 * ground floor's public counter to the room at the top.
 *
 * Every civic piece is built in one joinery — dark walnut, green baize, brass
 * fittings — so the storeys read as one building's furniture: the cabinets and
 * pigeonholes the town's records are filed in, the scriveners' desks they are
 * copied at, and the board the Warden's proclamations are posted to. The
 * third storey's workshop is the exception, and on purpose: copper, glass and
 * a violet charge that does not belong in a records office at all.
 *
 * Every painter keeps its ink inside its own footprint's columns and above
 * its foot, and only rises above the footprint, so a wall piece climbs the
 * wall face rather than spilling sideways.
 */

import {
  footprintBox,
  withFootprintClip,
  forkRng,
  jitter,
  rgb,
  rgba,
  inkOutline,
  drawTownContactShadow,
  type TownPropFrame,
  type FootprintBox,
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, type RGB, type Ramp } from '../../town/townPalette';
import { paintGrandHearth } from './hornedFlagon';

type Ctx = CanvasRenderingContext2D;

// ── Materials no shared ramp covers ─────────────────────────────────────────

/** Oiled walnut: darker than the town's oak, the wood the tower is fitted in. */
export const WALNUT: Ramp = {
  shadow: [40, 26, 18],
  mid: [86, 56, 36],
  light: [130, 90, 58],
  accent: [168, 124, 82],
};
/** Writing baize let into a desk top. */
const BAIZE: Ramp = {
  shadow: [24, 46, 34],
  mid: [42, 78, 56],
  light: [66, 108, 78],
  accent: [98, 138, 102],
};
/** Wound copper, the workshop's coils. */
const COPPER: Ramp = {
  shadow: [92, 42, 24],
  mid: [160, 84, 46],
  light: [208, 132, 82],
  accent: [240, 186, 130],
};
export const BRASS_DIM: RGB = [132, 100, 44];
export const BRASS_BRIGHT: RGB = [226, 192, 110];
const PARCHMENT: RGB = [222, 206, 164];
const PARCHMENT_SHADE: RGB = [176, 156, 112];
const PAPER: RGB = [232, 226, 206];
const PAPER_SHADE: RGB = [190, 182, 158];
const RED_TAPE: RGB = [168, 36, 34];
const WAX_RED: RGB = [150, 28, 30];
const WAX_RED_LIGHT: RGB = [210, 74, 66];
const INK: RGB = [28, 24, 30];
const BOX_CARD: RGB = [150, 122, 82];
const CORK: RGB = [150, 112, 70];
const BOX_CARD_SHADE: RGB = [108, 86, 56];
const GLASS_LIGHT: RGB = [228, 240, 244];
/** The charge the workshop stores — a violet no honest lamp burns. */
const CHARGE_CORE: RGB = [238, 214, 255];
const CHARGE_MID: RGB = [170, 110, 238];
const CHARGE_EDGE: RGB = [96, 48, 168];

export function ironRamp(): Ramp {
  return getTownRamp('iron_black');
}

// ── Shared primitives ───────────────────────────────────────────────────────

/** How far a piece's contact shadow sits up from its foot, in tiles. */
const SHADOW_LIFT_TILES = 0.06;
const SHADOW_RADIUS_X_TILES = 0.62;
const SHADOW_RADIUS_Y_TILES = 0.14;

/** A long piece's shadow is a band along its foot, not one ellipse under its middle. */
export function bandShadow(ctx: Ctx, box: FootprintBox, ts: number, alpha: number): void {
  const segments = Math.max(1, Math.round(box.width / ts));
  for (let i = 0; i < segments; i++) {
    const centreX = box.left + (box.width * (i + 0.5)) / segments;
    drawTownContactShadow(
      ctx,
      centreX,
      box.bottom - ts * SHADOW_LIFT_TILES,
      ts * SHADOW_RADIUS_X_TILES,
      ts * SHADOW_RADIUS_Y_TILES,
      alpha,
    );
  }
}

export function inkRect(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  inkOutline(ctx, ts);
}

/** A filled, outlined rectangle in one ramp stop. */
export function slab(
  ctx: Ctx,
  ramp: Ramp,
  stop: number,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, stop));
  ctx.fillRect(x, y, w, h);
  inkRect(ctx, x, y, w, h, ts);
}

/** Thin lit edge along the top of a surface, the one highlight every slab gets. */
const LIT_EDGE_TILES = 0.03;
export function litEdge(ctx: Ctx, ramp: Ramp, x: number, y: number, w: number, ts: number): void {
  ctx.fillStyle = rgb(sampleRamp(ramp, 0.9));
  ctx.fillRect(x, y, w, ts * LIT_EDGE_TILES);
}

/** A soft round glow, for a flame or a charged orb. */
export function glow(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  colour: RGB,
  alpha: number,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(colour, alpha));
  gradient.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** A tied bundle of papers seen end-on in a cubby: a pale block, a ruled edge and the red tape round it. */
function paperBundle(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
): void {
  ctx.fillStyle = rgb(rng() < 0.5 ? PAPER : PARCHMENT);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(PAPER_SHADE, 0.8);
  const leaves = 3;
  for (let i = 1; i <= leaves; i++) {
    ctx.fillRect(x, y + (h * i) / (leaves + 1), w, Math.max(1, ts * 0.01));
  }
  if (rng() < 0.7) {
    ctx.fillStyle = rgb(RED_TAPE);
    ctx.fillRect(x + w * (0.35 + jitter(rng, 0.1)), y, Math.max(1, ts * 0.03), h);
  }
}

/** A rolled scroll seen end-on: a pale disc with a darker core. */
function scrollEnd(ctx: Ctx, x: number, y: number, radius: number): void {
  ctx.fillStyle = rgb(PARCHMENT);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(PARCHMENT_SHADE);
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/** A wax seal: a red disc with a lighter stamp in it. */
function waxSeal(ctx: Ctx, x: number, y: number, radius: number): void {
  ctx.fillStyle = rgb(WAX_RED);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(WAX_RED_LIGHT);
  ctx.beginPath();
  ctx.arc(x - radius * 0.2, y - radius * 0.2, radius * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

// ── Records cabinet ─────────────────────────────────────────────────────────

/** How tall the cabinet stands, in tiles. */
export const RECORDS_CABINET_HEIGHT_TILES = 1.45;
const RECORDS_CABINET_DRAWERS = 4;
const RECORDS_CABINET_INSET_TILES = 0.1;
/** Which drawer variant 1 leaves pulled half out. */
const RECORDS_CABINET_OPEN_DRAWER = 2;

/**
 * A walnut filing cabinet, four deep drawers each with a brass card-holder and
 * pull. Variant 1 has one drawer left half open, its files standing up in it.
 */
export function paintRecordsCabinet(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.38);
    const inset = ts * RECORDS_CABINET_INSET_TILES;
    const left = box.left + inset;
    const width = box.width - inset * 2;
    const top = box.bottom - ts * RECORDS_CABINET_HEIGHT_TILES;
    const plinthH = ts * 0.08;
    const capH = ts * 0.07;
    slab(ctx, WALNUT, 0.35, left, top, width, box.bottom - top, ts);
    slab(ctx, WALNUT, 0.6, left - ts * 0.02, top, width + ts * 0.04, capH, ts);
    litEdge(ctx, WALNUT, left - ts * 0.02, top, width + ts * 0.04, ts);
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.15));
    ctx.fillRect(left, box.bottom - plinthH, width, plinthH);

    const drawerTop = top + capH + ts * 0.03;
    const drawerBottom = box.bottom - plinthH - ts * 0.02;
    const drawerPitch = (drawerBottom - drawerTop) / RECORDS_CABINET_DRAWERS;
    const drawerInset = ts * 0.05;
    const labelRng = forkRng(rng);
    for (let i = 0; i < RECORDS_CABINET_DRAWERS; i++) {
      const dy = drawerTop + i * drawerPitch;
      const dh = drawerPitch - ts * 0.03;
      const isOpen = variant === 1 && i === RECORDS_CABINET_OPEN_DRAWER;
      const pullOut = isOpen ? ts * 0.12 : 0;
      if (isOpen) {
        ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.05));
        ctx.fillRect(left + drawerInset, dy, width - drawerInset * 2, dh);
        const files = 6;
        for (let f = 0; f < files; f++) {
          const fx =
            left + drawerInset + ts * 0.03 + (f * (width - drawerInset * 2 - ts * 0.06)) / files;
          const fh = ts * (0.1 + labelRng() * 0.08);
          ctx.fillStyle = rgb(f % 2 === 0 ? PARCHMENT : PAPER);
          ctx.fillRect(fx, dy + pullOut - fh, ts * 0.05, fh);
        }
      }
      slab(ctx, WALNUT, 0.5, left + drawerInset, dy + pullOut, width - drawerInset * 2, dh, ts);
      const labelW = ts * 0.22;
      const labelH = ts * 0.08;
      const labelX = left + width / 2 - labelW / 2;
      const labelY = dy + pullOut + dh * 0.22;
      ctx.fillStyle = rgb(BRASS_DIM);
      ctx.fillRect(
        labelX - ts * 0.015,
        labelY - ts * 0.015,
        labelW + ts * 0.03,
        labelH + ts * 0.03,
      );
      ctx.fillStyle = rgb(PAPER);
      ctx.fillRect(labelX, labelY, labelW, labelH);
      ctx.fillStyle = rgba(INK, 0.7);
      ctx.fillRect(
        labelX + ts * 0.03,
        labelY + labelH * 0.45,
        labelW * (0.4 + labelRng() * 0.4),
        Math.max(1, ts * 0.012),
      );
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.fillRect(left + width / 2 - ts * 0.06, labelY + labelH + ts * 0.05, ts * 0.12, ts * 0.03);
    }
  });
}

// ── Pigeonhole wall ─────────────────────────────────────────────────────────

const PIGEONHOLE_HEIGHT_TILES = 1.7;
const PIGEONHOLE_COLUMNS_PER_TILE = 3;
const PIGEONHOLE_ROWS = 5;
/** Share of cubbies that hold a rolled scroll rather than a tied bundle. */
const PIGEONHOLE_SCROLL_CHANCE = 0.4;
/** Share of cubbies left empty — a records wall in use is never full. */
const PIGEONHOLE_EMPTY_CHANCE = 0.12;

/**
 * Floor-to-cornice pigeonholes against the wall, every cubby stuffed with
 * tied bundles or rolled writs, a ladder rail across the front.
 */
export function paintPigeonholeWall(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const left = box.left + ts * 0.04;
    const width = box.width - ts * 0.08;
    const top = box.bottom - ts * PIGEONHOLE_HEIGHT_TILES;
    const baseH = ts * 0.24;
    slab(ctx, WALNUT, 0.3, left, top, width, box.bottom - top, ts);
    slab(ctx, WALNUT, 0.55, left - ts * 0.02, top - ts * 0.06, width + ts * 0.04, ts * 0.1, ts);
    litEdge(ctx, WALNUT, left - ts * 0.02, top - ts * 0.06, width + ts * 0.04, ts);
    slab(ctx, WALNUT, 0.5, left, box.bottom - baseH, width, baseH, ts);
    litEdge(ctx, WALNUT, left, box.bottom - baseH, width, ts);

    const gridTop = top + ts * 0.08;
    const gridBottom = box.bottom - baseH - ts * 0.04;
    const columns = frame.footprintW * PIGEONHOLE_COLUMNS_PER_TILE;
    const cellW = (width - ts * 0.08) / columns;
    const cellH = (gridBottom - gridTop) / PIGEONHOLE_ROWS;
    const fillRng = forkRng(rng);
    for (let r = 0; r < PIGEONHOLE_ROWS; r++) {
      for (let c = 0; c < columns; c++) {
        const cx = left + ts * 0.04 + c * cellW;
        const cy = gridTop + r * cellH;
        const innerW = cellW - ts * 0.03;
        const innerH = cellH - ts * 0.03;
        ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.04));
        ctx.fillRect(cx, cy, innerW, innerH);
        const roll = fillRng();
        if (roll < PIGEONHOLE_EMPTY_CHANCE) continue;
        if (roll < PIGEONHOLE_EMPTY_CHANCE + PIGEONHOLE_SCROLL_CHANCE) {
          const radius = Math.min(innerW, innerH) * 0.28;
          scrollEnd(ctx, cx + innerW * 0.3, cy + innerH - radius - ts * 0.01, radius);
          scrollEnd(ctx, cx + innerW * 0.7, cy + innerH - radius - ts * 0.01, radius);
          scrollEnd(ctx, cx + innerW * 0.5, cy + innerH - radius * 2.6, radius);
        } else {
          const bundleH = innerH * (0.55 + fillRng() * 0.35);
          paperBundle(
            ctx,
            cx + ts * 0.01,
            cy + innerH - bundleH,
            innerW - ts * 0.02,
            bundleH,
            ts,
            fillRng,
          );
        }
      }
    }
    // The library rail a step-ladder hooks onto.
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.fillRect(left, gridTop + cellH * 2 - ts * 0.02, width, ts * 0.03);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.fillRect(left, gridTop + cellH * 2 - ts * 0.02, width, Math.max(1, ts * 0.01));
  });
}

// ── Scrivener's desk ────────────────────────────────────────────────────────

const SCRIVENER_DESK_TOP_RISE_TILES = 0.52;
const SCRIVENER_DESK_TOP_DEPTH_TILES = 0.34;
/** Variant 1 is the clerk who has fallen behind. */
const SCRIVENER_DESK_HEAPED = 1;

/**
 * A clerk's writing desk with a sloped baize top: a copy half made beside its
 * original, an inkwell and quill, and a stack of files waiting. Variant 1 has
 * fallen behind — the waiting stack is twice the height and a second one has
 * started.
 */
export function paintScrivenerDesk(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.32);
    const front = box.bottom - ts * SCRIVENER_DESK_TOP_RISE_TILES;
    const back = front - ts * SCRIVENER_DESK_TOP_DEPTH_TILES;
    const left = box.left + ts * 0.06;
    const width = box.width - ts * 0.12;

    // Pedestal of drawers at one end, a pair of legs at the other.
    const pedestalW = ts * 0.5;
    slab(
      ctx,
      WALNUT,
      0.38,
      box.right - ts * 0.06 - pedestalW,
      front,
      pedestalW,
      box.bottom - front - ts * 0.02,
      ts,
    );
    for (let i = 0; i < 2; i++) {
      const dy = front + ts * 0.05 + i * ts * 0.2;
      ctx.fillStyle = rgb(BRASS_BRIGHT);
      ctx.fillRect(
        box.right - ts * 0.06 - pedestalW / 2 - ts * 0.04,
        dy + ts * 0.07,
        ts * 0.08,
        ts * 0.025,
      );
      ctx.fillStyle = rgba(INK, 0.5);
      ctx.fillRect(
        box.right - ts * 0.06 - pedestalW,
        dy + ts * 0.16,
        pedestalW,
        Math.max(1, ts * 0.01),
      );
    }
    const legW = ts * 0.07;
    slab(ctx, WALNUT, 0.3, left + ts * 0.04, front, legW, box.bottom - front - ts * 0.02, ts);

    // The top: walnut rim round a baize writing surface.
    slab(ctx, WALNUT, 0.6, left, back, width, front - back, ts);
    ctx.fillStyle = rgb(sampleRamp(BAIZE, 0.5));
    ctx.fillRect(left + ts * 0.05, back + ts * 0.04, width - ts * 0.1, front - back - ts * 0.08);
    litEdge(ctx, WALNUT, left, back, width, ts);
    slab(ctx, WALNUT, 0.45, left, front, width, ts * 0.08, ts);

    // The original and its copy, side by side.
    const sheetW = ts * 0.3;
    const sheetH = (front - back) * 0.62;
    const sheetY = back + (front - back) * 0.2;
    const sheetX = left + ts * 0.2;
    for (const [i, colour] of [PARCHMENT, PAPER].entries()) {
      const sx = sheetX + i * (sheetW + ts * 0.05);
      ctx.fillStyle = rgb(colour);
      ctx.fillRect(sx, sheetY, sheetW, sheetH);
      ctx.fillStyle = rgba(INK, 0.5);
      const lines = i === 0 ? 4 : 2;
      for (let l = 0; l < lines; l++) {
        ctx.fillRect(
          sx + ts * 0.03,
          sheetY + sheetH * (0.2 + l * 0.2),
          sheetW - ts * 0.06,
          Math.max(1, ts * 0.01),
        );
      }
    }
    // Inkwell and quill.
    const inkX = sheetX + sheetW * 2 + ts * 0.14;
    ctx.fillStyle = rgb(INK);
    ctx.fillRect(inkX, sheetY + sheetH * 0.3, ts * 0.07, ts * 0.06);
    ctx.strokeStyle = rgb(PAPER);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    ctx.beginPath();
    ctx.moveTo(inkX + ts * 0.035, sheetY + sheetH * 0.3);
    ctx.lineTo(inkX + ts * 0.12, sheetY - ts * 0.12);
    ctx.stroke();

    // The waiting files.
    const stacks = variant === SCRIVENER_DESK_HEAPED ? 2 : 1;
    const stackRng = forkRng(rng);
    for (let s = 0; s < stacks; s++) {
      const stackX = box.right - ts * 0.5 - s * ts * 0.34;
      const files = (variant === SCRIVENER_DESK_HEAPED ? 7 : 3) - s * 2;
      let y = front - ts * 0.04;
      for (let f = 0; f < files; f++) {
        const fh = ts * 0.045;
        y -= fh;
        const fx = stackX + jitter(stackRng, ts * 0.02);
        ctx.fillStyle = rgb(f % 3 === 0 ? BOX_CARD : f % 3 === 1 ? PARCHMENT : PAPER);
        ctx.fillRect(fx, y, ts * 0.3, fh);
        inkRect(ctx, fx, y, ts * 0.3, fh, ts * 0.5);
      }
      ctx.fillStyle = rgb(RED_TAPE);
      ctx.fillRect(stackX + ts * 0.13, y, Math.max(1, ts * 0.03), front - ts * 0.04 - y);
    }
  });
}

// ── Archive boxes ───────────────────────────────────────────────────────────

const ARCHIVE_BOX_HEIGHT_TILES = 0.26;
const ARCHIVE_BOX_STACK_HEIGHTS: readonly number[] = [3, 2];

/**
 * Card document boxes stacked on the floor, each tied with string and labelled
 * by year. Variant 1 is the shorter, untidier stack, the top box's lid off.
 */
export function paintArchiveBoxes(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.34);
    const count = ARCHIVE_BOX_STACK_HEIGHTS[variant % ARCHIVE_BOX_STACK_HEIGHTS.length];
    const boxH = ts * ARCHIVE_BOX_HEIGHT_TILES;
    const stackRng = forkRng(rng);
    let y = box.bottom - ts * 0.04;
    for (let i = 0; i < count; i++) {
      const w = ts * (0.78 - i * 0.04);
      const x = box.centreX - w / 2 + jitter(stackRng, ts * 0.04);
      y -= boxH;
      ctx.fillStyle = rgb(BOX_CARD);
      ctx.fillRect(x, y, w, boxH);
      ctx.fillStyle = rgb(BOX_CARD_SHADE);
      ctx.fillRect(x, y, w, boxH * 0.22);
      inkRect(ctx, x, y, w, boxH, ts);
      ctx.fillStyle = rgb(PAPER);
      ctx.fillRect(x + w * 0.3, y + boxH * 0.38, w * 0.4, boxH * 0.42);
      ctx.fillStyle = rgba(INK, 0.6);
      ctx.fillRect(x + w * 0.36, y + boxH * 0.58, w * 0.26, Math.max(1, ts * 0.012));
      ctx.fillStyle = rgb(PARCHMENT_SHADE);
      ctx.fillRect(x + w * 0.14, y, Math.max(1, ts * 0.02), boxH);
    }
    const lidOff = variant % ARCHIVE_BOX_STACK_HEIGHTS.length === 1;
    if (lidOff) {
      const w = ts * 0.6;
      const x = box.centreX - w / 2;
      for (let f = 0; f < 4; f++) {
        ctx.fillStyle = rgb(f % 2 === 0 ? PAPER : PARCHMENT);
        ctx.fillRect(
          x + ts * 0.06 + f * ts * 0.12,
          y - ts * (0.08 + stackRng() * 0.06),
          ts * 0.08,
          ts * 0.12,
        );
      }
    }
  });
}

// ── Writ board ──────────────────────────────────────────────────────────────

const WRIT_BOARD_TOP_TILES = 1.55;
const WRIT_BOARD_BOTTOM_TILES = 0.45;
const WRIT_BOARD_NOTICES = 7;

/**
 * The public board for the Warden's writs and proclamations: a cork panel
 * in a walnut frame, every notice sealed, one of them a reward bill with a
 * face sketched on it.
 */
export function paintWritBoard(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const left = box.left + ts * 0.12;
    const right = box.right - ts * 0.12;
    const top = box.bottom - ts * WRIT_BOARD_TOP_TILES;
    const bottom = box.bottom - ts * WRIT_BOARD_BOTTOM_TILES;
    slab(
      ctx,
      WALNUT,
      0.45,
      left - ts * 0.06,
      top - ts * 0.06,
      right - left + ts * 0.12,
      bottom - top + ts * 0.12,
      ts,
    );
    litEdge(ctx, WALNUT, left - ts * 0.06, top - ts * 0.06, right - left + ts * 0.12, ts);
    ctx.fillStyle = rgb(CORK);
    ctx.fillRect(left, top, right - left, bottom - top);

    const noticeRng = forkRng(rng);
    for (let i = 0; i < WRIT_BOARD_NOTICES; i++) {
      const nw = ts * (0.26 + noticeRng() * 0.12);
      const nh = ts * (0.3 + noticeRng() * 0.14);
      const nx = left + ts * 0.04 + noticeRng() * (right - left - nw - ts * 0.08);
      const ny = top + ts * 0.04 + noticeRng() * (bottom - top - nh - ts * 0.08);
      ctx.fillStyle = rgb(i % 3 === 0 ? PARCHMENT : PAPER);
      ctx.fillRect(nx, ny, nw, nh);
      inkRect(ctx, nx, ny, nw, nh, ts * 0.5);
      ctx.fillStyle = rgba(INK, 0.55);
      ctx.fillRect(nx + nw * 0.15, ny + nh * 0.14, nw * 0.7, Math.max(1, ts * 0.02));
      for (let l = 0; l < 3; l++) {
        ctx.fillRect(
          nx + nw * 0.12,
          ny + nh * (0.36 + l * 0.15),
          nw * 0.76,
          Math.max(1, ts * 0.01),
        );
      }
      waxSeal(ctx, nx + nw * 0.75, ny + nh * 0.86, ts * 0.03);
    }
    // The reward bill, pinned over the rest.
    const billW = ts * 0.4;
    const billH = ts * 0.5;
    const billX = right - billW - ts * 0.1;
    const billY = top + ts * 0.1;
    ctx.fillStyle = rgb(PARCHMENT);
    ctx.fillRect(billX, billY, billW, billH);
    inkRect(ctx, billX, billY, billW, billH, ts * 0.5);
    ctx.fillStyle = rgb(RED_TAPE);
    ctx.fillRect(billX + billW * 0.12, billY + billH * 0.08, billW * 0.76, ts * 0.04);
    ctx.strokeStyle = rgba(INK, 0.75);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    ctx.beginPath();
    ctx.arc(billX + billW / 2, billY + billH * 0.48, billW * 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(INK, 0.6);
    ctx.fillRect(billX + billW * 0.2, billY + billH * 0.78, billW * 0.6, Math.max(1, ts * 0.015));
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.fillRect(billX + billW / 2 - ts * 0.015, billY - ts * 0.015, ts * 0.03, ts * 0.03);
  });
}

// ── Conduit coil ────────────────────────────────────────────────────────────

/** Height of the coil's column, in tiles; the orb rises above it. */
export const CONDUIT_COIL_HEIGHT_TILES = 1.55;
const CONDUIT_COIL_WINDINGS = 14;
const CONDUIT_COIL_ORB_RADIUS_TILES = 0.15;

/**
 * A copper-wound column on an iron foot, topped with a glass orb holding the
 * violet charge.
 */
export function paintConduitCoil(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  _rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    bandShadow(ctx, box, ts, 0.4);
    const iron = ironRamp();
    const footW = ts * 0.7;
    const footH = ts * 0.14;
    const footTop = box.bottom - ts * 0.08 - footH;
    slab(ctx, iron, 0.45, box.centreX - footW / 2, footTop, footW, footH, ts);
    litEdge(ctx, iron, box.centreX - footW / 2, footTop, footW, ts);

    const columnW = ts * 0.26;
    const columnTop = box.bottom - ts * CONDUIT_COIL_HEIGHT_TILES;
    const columnX = box.centreX - columnW / 2;
    ctx.fillStyle = rgb(sampleRamp(WALNUT, 0.3));
    ctx.fillRect(columnX, columnTop, columnW, footTop - columnTop);
    const windingH = (footTop - columnTop - ts * 0.1) / CONDUIT_COIL_WINDINGS;
    for (let w = 0; w < CONDUIT_COIL_WINDINGS; w++) {
      const wy = columnTop + ts * 0.05 + w * windingH;
      ctx.fillStyle = rgb(sampleRamp(COPPER, w % 2 === 0 ? 0.45 : 0.7));
      ctx.fillRect(columnX - ts * 0.02, wy, columnW + ts * 0.04, windingH * 0.8);
      ctx.fillStyle = rgb(COPPER.accent);
      ctx.fillRect(columnX + columnW * 0.18, wy, columnW * 0.12, windingH * 0.8);
    }
    inkRect(ctx, columnX - ts * 0.02, columnTop, columnW + ts * 0.04, footTop - columnTop, ts);

    // Brass collar and the charged orb.
    ctx.fillStyle = rgb(BRASS_DIM);
    ctx.fillRect(columnX - ts * 0.05, columnTop - ts * 0.05, columnW + ts * 0.1, ts * 0.07);
    ctx.fillStyle = rgb(BRASS_BRIGHT);
    ctx.fillRect(
      columnX - ts * 0.05,
      columnTop - ts * 0.05,
      columnW + ts * 0.1,
      Math.max(1, ts * 0.015),
    );
    const orbRadius = ts * CONDUIT_COIL_ORB_RADIUS_TILES;
    const orbY = columnTop - ts * 0.05 - orbRadius;
    glow(ctx, box.centreX, orbY, ts * 0.42, CHARGE_MID, 0.5);
    ctx.fillStyle = rgba(CHARGE_EDGE, 0.9);
    ctx.beginPath();
    ctx.arc(box.centreX, orbY, orbRadius, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    glow(ctx, box.centreX, orbY, orbRadius * 0.9, CHARGE_CORE, 0.9);
    ctx.fillStyle = rgba(GLASS_LIGHT, 0.85);
    ctx.beginPath();
    ctx.arc(
      box.centreX - orbRadius * 0.35,
      orbY - orbRadius * 0.35,
      orbRadius * 0.22,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // Two thin arcs crawling out of the orb.
    ctx.strokeStyle = rgba(CHARGE_CORE, 0.8);
    ctx.lineWidth = Math.max(1, ts * 0.012);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(box.centreX + side * orbRadius * 0.8, orbY);
      ctx.lineTo(box.centreX + side * orbRadius * 1.5, orbY - ts * 0.06);
      ctx.lineTo(box.centreX + side * orbRadius * 1.9, orbY + ts * 0.02);
      ctx.lineTo(box.centreX + side * orbRadius * 2.3, orbY - ts * 0.08);
      ctx.stroke();
    }
  });
}

// ── The town hearth ─────────────────────────────────────────────────────────

const CREST_FIELD: RGB = [44, 70, 112];
const CREST_FIELD_LIGHT: RGB = [72, 104, 150];
const CREST_WING: RGB = [236, 232, 220];
const CREST_SUN: RGB = [226, 184, 72];
const CREST_SUN_RAYS = 7;

/**
 * The city's arms, as the banners carry them: a white wing spread over a
 * rising sun, on a blue shield rimmed in brass.
 */
function paintCivicCrest(ctx: Ctx, cx: number, cy: number, ts: number): void {
  const halfW = ts * 0.32;
  const top = cy - ts * 0.34;
  const shoulder = cy + ts * 0.06;
  const point = cy + ts * 0.38;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, top);
  ctx.lineTo(cx + halfW, top);
  ctx.lineTo(cx + halfW, shoulder);
  ctx.quadraticCurveTo(cx + halfW, point - ts * 0.1, cx, point);
  ctx.quadraticCurveTo(cx - halfW, point - ts * 0.1, cx - halfW, shoulder);
  ctx.closePath();
  ctx.fillStyle = rgb(CREST_FIELD);
  ctx.fill();
  ctx.strokeStyle = rgb(BRASS_BRIGHT);
  ctx.lineWidth = ts * 0.05;
  ctx.stroke();
  inkOutline(ctx, ts);
  ctx.fillStyle = rgba(CREST_FIELD_LIGHT, 0.6);
  ctx.fillRect(cx - halfW * 0.8, top + ts * 0.04, halfW * 0.5, ts * 0.3);

  // The sun, rising behind the wing.
  const sunY = cy + ts * 0.12;
  const sunR = ts * 0.1;
  ctx.strokeStyle = rgb(CREST_SUN);
  ctx.lineWidth = Math.max(1, ts * 0.025);
  for (let i = 0; i < CREST_SUN_RAYS; i++) {
    const angle = Math.PI + (Math.PI * (i + 0.5)) / CREST_SUN_RAYS;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * sunR * 1.2, sunY + Math.sin(angle) * sunR * 1.2);
    ctx.lineTo(cx + Math.cos(angle) * sunR * 1.9, sunY + Math.sin(angle) * sunR * 1.9);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(CREST_SUN);
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, Math.PI, Math.PI * 2);
  ctx.fill();

  // The wing: three tiers of feathers sweeping out from the shoulder.
  ctx.fillStyle = rgb(CREST_WING);
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const span = halfW * (1.4 - t * 0.3);
    const y = cy - ts * 0.16 + t * ts * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx - span / 2, y);
    ctx.quadraticCurveTo(cx, y - ts * 0.1, cx + span / 2, y);
    ctx.quadraticCurveTo(cx, y + ts * 0.05, cx - span / 2, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** The ground floor's great fireplace, with the city's arms on its chimney breast. */
export function paintTowerHearth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  paintGrandHearth(ctx, frame, rng, (crestX, crestY, crestTs) =>
    paintCivicCrest(ctx, crestX, crestY, crestTs),
  );
}
