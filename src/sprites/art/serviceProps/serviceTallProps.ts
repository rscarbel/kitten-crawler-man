/**
 * The service level's tall one-tile furniture: the locker, the filing
 * cabinet, the vending machine and the gas bottle.
 *
 * Each stands against a wall and rises above its own tile; the locker and the
 * vending machine stand a little taller than Carl. Every painter is handed the
 * anchor tile's top-left corner and the tile size, and a variant seed that
 * only reaches the passes allowed to vary — dents, rust, stickers, what is on
 * the shelves — never the silhouette.
 *
 * Measurements are in source pixels at the sheet's 64 px tile unless a name
 * says it is a fraction of the tile.
 */

import { type Ctx, contactShadow, cylinderRamp, lerp, verticalRamp } from '../propPaint';
import { mulberry32 } from '../../person/rng';
import {
  BARE_STEEL,
  CABINET_STEEL,
  CAVITY,
  CYLINDER_PAINT,
  LOCKER_STEEL,
  RUST,
  VENDING_SHELL,
  type BoxGeometry,
  boxFrontTop,
  dent,
  line,
  paintBox,
  rustStreak,
  wash,
} from './servicePaint';

/** Where every one-tile piece's front face meets the floor, as a fraction of the tile down from its top. */
export const ONE_TILE_BASE_FRACTION = 0.94;

const FULL_TURN = Math.PI * 2;
/** Which variant carries which extra, by `variant % 3`. */
const VARIANT_CYCLE = 3;
/** Offsets a remains painter's stream from the same kind's standing one. */
const REMAINS_SEED_OFFSET = 0x55;

/** A filled ellipse at partial alpha. */
function blot(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colour: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** The dark bed a pile of wreckage lies in, so a flat pile still reads as sitting on the floor. */
const WRECK_BED = { halfWidthFraction: 0.37, rise: 3, h: 12, alpha: 0.22 } as const;

function wreckBed(ctx: Ctx, cx: number, cy: number, ts: number): void {
  const halfWidth = ts * WRECK_BED.halfWidthFraction;
  wash(
    ctx,
    cx - halfWidth,
    cy - WRECK_BED.rise,
    halfWidth * 2,
    WRECK_BED.h,
    '#000',
    WRECK_BED.alpha,
  );
}

// ── Locker ──────────────────────────────────────────────────────────────────

const LOCKER_SEED = 0x10c4;
const LOCKER_VARIANT_STRIDE = 977;
const LOCKER_WIDTH_FRACTION = 0.84;
/** A locker stands a hand above Carl, as a real one stands above a crawler. */
const LOCKER_HEIGHT_FRACTION = 1.56;
const LOCKER_DEPTH_FRACTION = 0.22;
const LOCKER_CONTACT_SHADOW_SCALE = 1.05;
const LOCKER = {
  doorInset: 4,
  kickPlate: 6,
  kickAlpha: 0.35,
  ventSlotsTop: 5,
  ventSlotsBottom: 3,
  ventPitch: 4,
  ventH: 2,
  ventWidthFraction: 0.6,
  ventFromEdge: 5,
  ventAlpha: 0.75,
  ventLipWidth: 0.8,
  handleW: 3,
  handleH: 11,
  handleFromRight: 8,
  plateW: 9,
  plateH: 4,
  plateFromVents: 4,
  digitGap: 3,
  seamWidth: 1.5,
  ajarGap: 4,
  ajarShift: 3,
  rustChance: 0.7,
  rustMin: 10,
  rustSpread: 8,
  dentMargin: 6,
  dentTopMargin: 10,
  dentBottomMargin: 8,
  dentRxMin: 4,
  dentRxSpread: 3,
  dentRyMin: 2.5,
  dentRySpread: 2,
  damagedExtraDents: 2,
  stickerVariant: 2,
  stickerInset: 5,
  stickerDrop: 6,
  stickerW: 8,
  stickerH: 10,
  stickerInkInset: 2,
  stickerInkH: 3,
  stickerAlpha: 0.9,
} as const;
const LOCKER_PLATE = '#c7c9c1';
const LOCKER_DIGIT = '#2a2e30';
const CRAWLER_FLYER = '#cfc8b4';
const CRAWLER_FLYER_INK = '#8a2a22';

/** The locker's box, standing on its tile against the wall behind it. */
function lockerBox(ox: number, oy: number, ts: number): BoxGeometry {
  const width = ts * LOCKER_WIDTH_FRACTION;
  const left = ox + (ts - width) / 2;
  return {
    left,
    right: left + width,
    baseY: oy + ts * ONE_TILE_BASE_FRACTION,
    height: ts * LOCKER_HEIGHT_FRACTION,
    depth: ts * LOCKER_DEPTH_FRACTION,
  };
}

function lockerVents(ctx: Ctx, cx: number, top: number, slots: number, width: number): void {
  for (let i = 0; i < slots; i++) {
    const y = top + i * LOCKER.ventPitch;
    wash(ctx, cx - width / 2, y, width, LOCKER.ventH, CAVITY, LOCKER.ventAlpha);
    const lipY = y + LOCKER.ventH + LOCKER.ventLipWidth / 2;
    line(ctx, cx - width / 2, lipY, cx + width / 2, lipY, LOCKER_STEEL.edge, LOCKER.ventLipWidth);
  }
}

/** A locker standing whole, or with its door sprung when `damaged`. */
export function drawLocker(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(LOCKER_SEED + variant * LOCKER_VARIANT_STRIDE);
  const box = lockerBox(ox, oy, ts);
  const cx = (box.left + box.right) / 2;
  contactShadow(ctx, cx, box.baseY, ts, LOCKER_CONTACT_SHADOW_SCALE);
  paintBox(ctx, box, LOCKER_STEEL);

  const frontTop = boxFrontTop(box);
  const doorLeft = box.left + LOCKER.doorInset;
  const doorRight = box.right - LOCKER.doorInset;
  const doorTop = frontTop + LOCKER.doorInset;
  const doorBottom = box.baseY - LOCKER.kickPlate;
  const shift = damaged ? LOCKER.ajarShift : 0;
  const gap = damaged ? LOCKER.ajarGap : 0;

  if (damaged) {
    // Wrenched off its latch: the dark inside shows down the hinge side, and
    // the door stands proud of the frame.
    wash(ctx, doorLeft, doorTop, gap + shift, doorBottom - doorTop, CAVITY, 1);
  }
  ctx.save();
  ctx.strokeStyle = LOCKER_STEEL.outline;
  ctx.lineWidth = LOCKER.seamWidth;
  ctx.strokeRect(doorLeft + shift + gap, doorTop, doorRight - doorLeft - gap, doorBottom - doorTop);
  ctx.restore();
  wash(
    ctx,
    box.left,
    doorBottom,
    box.right - box.left,
    LOCKER.kickPlate,
    LOCKER_STEEL.outline,
    LOCKER.kickAlpha,
  );

  const ventWidth = (doorRight - doorLeft) * LOCKER.ventWidthFraction;
  const doorCx = (doorLeft + doorRight) / 2 + shift;
  const topVents = doorTop + LOCKER.ventFromEdge;
  lockerVents(ctx, doorCx, topVents, LOCKER.ventSlotsTop, ventWidth);
  const bottomVents = doorBottom - LOCKER.ventFromEdge - LOCKER.ventSlotsBottom * LOCKER.ventPitch;
  lockerVents(ctx, doorCx, bottomVents, LOCKER.ventSlotsBottom, ventWidth);

  const plateY = topVents + LOCKER.ventSlotsTop * LOCKER.ventPitch + LOCKER.plateFromVents;
  wash(ctx, doorCx - LOCKER.plateW / 2, plateY, LOCKER.plateW, LOCKER.plateH, LOCKER_PLATE, 1);
  for (const digitX of [doorCx - 1, doorCx - 1 + LOCKER.digitGap]) {
    line(ctx, digitX, plateY + 1, digitX, plateY + LOCKER.plateH - 1, LOCKER_DIGIT, 1);
  }

  const handleX = doorRight - LOCKER.handleFromRight + shift;
  const handleY = (doorTop + doorBottom) / 2 - LOCKER.handleH / 2;
  wash(ctx, handleX, handleY, LOCKER.handleW, LOCKER.handleH, BARE_STEEL.dark, 1);
  wash(ctx, handleX, handleY, 1, LOCKER.handleH, BARE_STEEL.light, 1);

  // Seeded wear: a rust run from the low vents, a dent or two, and on one
  // locker in three a crawler's flyer stuck to the door.
  if (rng() < LOCKER.rustChance) {
    const runX = doorCx + (rng() - 0.5) * ventWidth;
    rustStreak(
      ctx,
      runX,
      bottomVents + LOCKER.ventPitch,
      LOCKER.rustMin + rng() * LOCKER.rustSpread,
    );
  }
  const dents = Math.floor(rng() * 2) + (damaged ? LOCKER.damagedExtraDents : 0);
  for (let i = 0; i < dents; i++) {
    dent(
      ctx,
      lerp(doorLeft + LOCKER.dentMargin, doorRight - LOCKER.dentMargin, rng()) + shift,
      lerp(doorTop + LOCKER.dentTopMargin, doorBottom - LOCKER.dentBottomMargin, rng()),
      LOCKER.dentRxMin + rng() * LOCKER.dentRxSpread,
      LOCKER.dentRyMin + rng() * LOCKER.dentRySpread,
    );
  }
  if (variant % VARIANT_CYCLE === LOCKER.stickerVariant) {
    const sx = doorLeft + LOCKER.stickerInset + shift;
    const sy = plateY + LOCKER.plateH + LOCKER.stickerDrop;
    wash(ctx, sx, sy, LOCKER.stickerW, LOCKER.stickerH, CRAWLER_FLYER, LOCKER.stickerAlpha);
    wash(
      ctx,
      sx + LOCKER.stickerInkInset,
      sy + LOCKER.stickerInkInset,
      LOCKER.stickerW - LOCKER.stickerInkInset * 2,
      LOCKER.stickerInkH,
      CRAWLER_FLYER_INK,
      LOCKER.stickerAlpha,
    );
  }
}

const LOCKER_REMAINS = {
  centreYFraction: 0.62,
  doorLean: -0.12,
  doorLeanJitter: 0.1,
  doorHalfWidthFraction: 0.32,
  doorH: 10,
  slotCount: 3,
  slotFirstFraction: 0.22,
  slotPitch: 4,
  slotW: 2,
  slotH: 6,
  slotAlpha: 0.7,
  shellA: [0.18, 0.4, 0.36, 0.47] as const,
  shellB: [0.66, 0.42, 0.84, 0.37] as const,
  shellAWidth: 3,
  shellBWidth: 2,
  sockXFraction: 0.7,
  sockYFraction: 0.74,
  sockW: 6,
  sockH: 4,
  tinXFraction: 0.22,
  tinYFraction: 0.76,
  tinW: 8,
  tinH: 5,
} as const;
const SOCK = '#d6d2c6';
const LUNCH_TIN = '#6c7b4a';

/** A locker after a break: the door lying on the floor and the bent shell round it. */
export function drawLockerRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(LOCKER_SEED + REMAINS_SEED_OFFSET + variant);
  const r = LOCKER_REMAINS;
  const cx = ox + ts / 2;
  const cy = oy + ts * r.centreYFraction;
  wreckBed(ctx, cx, cy, ts);
  const halfWidth = ts * r.doorHalfWidthFraction;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(r.doorLean + rng() * r.doorLeanJitter);
  ctx.fillStyle = LOCKER_STEEL.frontHigh;
  ctx.fillRect(-halfWidth, -r.doorH / 2, halfWidth * 2, r.doorH);
  ctx.strokeStyle = LOCKER_STEEL.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(-halfWidth, -r.doorH / 2, halfWidth * 2, r.doorH);
  for (let i = 0; i < r.slotCount; i++) {
    wash(
      ctx,
      -ts * r.slotFirstFraction + i * r.slotPitch,
      -r.slotH / 2,
      r.slotW,
      r.slotH,
      CAVITY,
      r.slotAlpha,
    );
  }
  ctx.restore();
  const [ax0, ay0, ax1, ay1] = r.shellA;
  line(
    ctx,
    ox + ts * ax0,
    oy + ts * ay0,
    ox + ts * ax1,
    oy + ts * ay1,
    LOCKER_STEEL.frontLow,
    r.shellAWidth,
  );
  const [bx0, by0, bx1, by1] = r.shellB;
  line(
    ctx,
    ox + ts * bx0,
    oy + ts * by0,
    ox + ts * bx1,
    oy + ts * by1,
    LOCKER_STEEL.edge,
    r.shellBWidth,
  );
  // What was inside: a balled-up gym sock and a dented lunch tin.
  wash(ctx, ox + ts * r.sockXFraction, oy + ts * r.sockYFraction, r.sockW, r.sockH, SOCK, 1);
  wash(ctx, ox + ts * r.tinXFraction, oy + ts * r.tinYFraction, r.tinW, r.tinH, LUNCH_TIN, 1);
}

// ── Filing cabinet ─────────────────────────────────────────────────────────

const CABINET_SEED = 0xf11e;
const CABINET_VARIANT_STRIDE = 613;
const CABINET_WIDTH_FRACTION = 0.66;
const CABINET_HEIGHT_FRACTION = 1.02;
const CABINET_DEPTH_FRACTION = 0.26;
const CABINET_CONTACT_SHADOW_SCALE = 0.85;
const CABINET = {
  drawers: 4,
  plinth: 4,
  plinthAlpha: 0.5,
  drawerInset: 3,
  drawerGap: 1,
  handleW: 10,
  handleH: 2.5,
  handleDropFraction: 0.48,
  handleShadowAlpha: 0.35,
  labelW: 8,
  labelH: 3.5,
  labelDrop: 3,
  labelAlpha: 0.85,
  pulledDrop: 7,
  ajarDrop: 2,
  ajarOpenH: 3,
  pulledOpenExtra: 2,
  fileCount: 5,
  fileInset: 4,
  ajarVariant: 1,
  ajarDrawer: 2,
  dentChance: 0.6,
  dentMargin: 6,
  dentTopMargin: 8,
  dentBottomMargin: 10,
  dentRx: 3.5,
  dentRy: 2.5,
  damagedDentShift: 4,
  damagedDentDrawers: 2.4,
  damagedDentRx: 6,
  damagedDentRy: 3.5,
  noteVariant: 0,
  noteFromRight: 9,
  noteDrawers: 1.2,
  noteSize: 6,
  noteAlpha: 0.85,
} as const;
const PAPER = '#cfcbbd';
const PAPER_SHADE = '#a8a496';
const STICKY_NOTE = '#c9b45a';

function cabinetBox(ox: number, oy: number, ts: number): BoxGeometry {
  const width = ts * CABINET_WIDTH_FRACTION;
  const left = ox + (ts - width) / 2;
  return {
    left,
    right: left + width,
    baseY: oy + ts * ONE_TILE_BASE_FRACTION,
    height: ts * CABINET_HEIGHT_FRACTION,
    depth: ts * CABINET_DEPTH_FRACTION,
  };
}

/** A filing cabinet, its top drawer yanked open and spilling when `damaged`. */
export function drawFilingCabinet(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const rng = mulberry32(CABINET_SEED + variant * CABINET_VARIANT_STRIDE);
  const box = cabinetBox(ox, oy, ts);
  const cx = (box.left + box.right) / 2;
  const width = box.right - box.left;
  contactShadow(ctx, cx, box.baseY, ts, CABINET_CONTACT_SHADOW_SCALE);
  paintBox(ctx, box, CABINET_STEEL);

  const frontTop = boxFrontTop(box);
  const drawerH = (box.height - CABINET.plinth) / CABINET.drawers;
  wash(
    ctx,
    box.left,
    box.baseY - CABINET.plinth,
    width,
    CABINET.plinth,
    CAVITY,
    CABINET.plinthAlpha,
  );
  // One variant has a drawer standing a finger open, files showing: contents, not shape.
  const ajarDrawer = variant % VARIANT_CYCLE === CABINET.ajarVariant ? CABINET.ajarDrawer : -1;
  const fileW = (width - CABINET.fileInset * 2) / CABINET.fileCount;
  for (let i = 0; i < CABINET.drawers; i++) {
    const pulled = damaged && i === 0;
    const ajar = i === ajarDrawer;
    const drop = pulled ? CABINET.pulledDrop : ajar ? CABINET.ajarDrop : 0;
    const top = frontTop + i * drawerH + drop;
    if (pulled || ajar) {
      const openH = pulled ? CABINET.pulledDrop + CABINET.pulledOpenExtra : CABINET.ajarOpenH;
      wash(ctx, box.left + 2, top - openH, width - 2 * 2, openH, CAVITY, 1);
      for (let f = 0; f < CABINET.fileCount; f++) {
        const fx = box.left + CABINET.fileInset + f * fileW;
        const shade = f % 2 === 0 ? PAPER : PAPER_SHADE;
        wash(ctx, fx, top - openH + 1 + (f % 2), fileW - 1, openH - 1, shade, 1);
      }
    }
    ctx.save();
    ctx.fillStyle = verticalRamp(ctx, box.left, top, top + drawerH, [
      [0, CABINET_STEEL.frontHigh],
      [1, CABINET_STEEL.frontLow],
    ]);
    ctx.fillRect(box.left + 1, top, width - 2, drawerH - CABINET.drawerGap);
    ctx.strokeStyle = CABINET_STEEL.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      box.left + CABINET.drawerInset,
      top + 1,
      width - CABINET.drawerInset * 2,
      drawerH - CABINET.drawerInset,
    );
    ctx.restore();
    line(ctx, box.left + 1, top, box.right - 1, top, CABINET_STEEL.edge, 1);
    const handleY = top + drawerH * CABINET.handleDropFraction;
    wash(
      ctx,
      cx - CABINET.handleW / 2,
      handleY + 1,
      CABINET.handleW,
      CABINET.handleH,
      '#000',
      CABINET.handleShadowAlpha,
    );
    wash(
      ctx,
      cx - CABINET.handleW / 2,
      handleY,
      CABINET.handleW,
      CABINET.handleH,
      BARE_STEEL.light,
      1,
    );
    wash(
      ctx,
      cx - CABINET.labelW / 2,
      top + CABINET.labelDrop,
      CABINET.labelW,
      CABINET.labelH,
      PAPER,
      CABINET.labelAlpha,
    );
  }
  if (rng() < CABINET.dentChance) {
    dent(
      ctx,
      lerp(box.left + CABINET.dentMargin, box.right - CABINET.dentMargin, rng()),
      lerp(frontTop + CABINET.dentTopMargin, box.baseY - CABINET.dentBottomMargin, rng()),
      CABINET.dentRx,
      CABINET.dentRy,
    );
  }
  if (damaged) {
    dent(
      ctx,
      cx + CABINET.damagedDentShift,
      frontTop + drawerH * CABINET.damagedDentDrawers,
      CABINET.damagedDentRx,
      CABINET.damagedDentRy,
    );
  }
  if (variant % VARIANT_CYCLE === CABINET.noteVariant) {
    wash(
      ctx,
      box.right - CABINET.noteFromRight,
      frontTop + drawerH * CABINET.noteDrawers,
      CABINET.noteSize,
      CABINET.noteSize,
      STICKY_NOTE,
      CABINET.noteAlpha,
    );
  }
}

const CABINET_REMAINS = {
  centreYFraction: 0.6,
  spreadFraction: 0.36,
  sheets: 7,
  fronts: 2,
  frontFirstXFraction: 0.32,
  frontStepXFraction: 0.36,
  frontFirstYFraction: 0.5,
  frontStepYFraction: 0.12,
  frontMaxTwist: 0.6,
  frontW: 18,
  frontH: 8,
  pullW: 8,
  pullH: 2,
} as const;

/** A filing cabinet after a break: drawer fronts and a spill of paper. */
export function drawFilingCabinetRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(CABINET_SEED + REMAINS_SEED_OFFSET + variant);
  const r = CABINET_REMAINS;
  drawPaperSheets(
    ctx,
    ox + ts / 2,
    oy + ts * r.centreYFraction,
    ts * r.spreadFraction,
    r.sheets,
    rng,
  );
  for (let i = 0; i < r.fronts; i++) {
    ctx.save();
    ctx.translate(
      ox + ts * (r.frontFirstXFraction + i * r.frontStepXFraction),
      oy + ts * (r.frontFirstYFraction + i * r.frontStepYFraction),
    );
    ctx.rotate((rng() - 0.5) * r.frontMaxTwist * 2);
    ctx.fillStyle = CABINET_STEEL.frontHigh;
    ctx.fillRect(-r.frontW / 2, -r.frontH / 2, r.frontW, r.frontH);
    ctx.strokeStyle = CABINET_STEEL.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(-r.frontW / 2, -r.frontH / 2, r.frontW, r.frontH);
    ctx.fillStyle = BARE_STEEL.light;
    ctx.fillRect(-r.pullW / 2, -r.pullH / 2, r.pullW, r.pullH);
    ctx.restore();
  }
}

const PAPER_SHEET = {
  w: 9,
  h: 7,
  textAlpha: 0.22,
  textLines: 3,
  textInset: 1.5,
  textPitch: 1.8,
  textH: 0.8,
  shadowAlpha: 0.18,
  verticalSquash: 0.5,
  shadedEvery: 3,
} as const;
const PAPER_TEXT = '#2a2a2a';

/** Loose sheets lying flat, each with a soft shadow and a few faint lines of type. */
export function drawPaperSheets(
  ctx: Ctx,
  cx: number,
  cy: number,
  spread: number,
  count: number,
  rng: () => number,
): void {
  const s = PAPER_SHEET;
  for (let i = 0; i < count; i++) {
    const a = rng() * FULL_TURN;
    const r = Math.sqrt(rng()) * spread;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * s.verticalSquash;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    wash(ctx, -s.w / 2 + 1, -s.h / 2 + 1, s.w, s.h, '#000', s.shadowAlpha);
    wash(ctx, -s.w / 2, -s.h / 2, s.w, s.h, i % s.shadedEvery === 0 ? PAPER_SHADE : PAPER, 1);
    for (let l = 0; l < s.textLines; l++) {
      wash(
        ctx,
        -s.w / 2 + s.textInset,
        -s.h / 2 + s.textInset + l * s.textPitch,
        s.w - s.textInset * 2,
        s.textH,
        PAPER_TEXT,
        s.textAlpha,
      );
    }
    ctx.restore();
  }
}

// ── Vending machine ────────────────────────────────────────────────────────

const VENDING_SEED = 0x5ac4;
const VENDING_VARIANT_STRIDE = 389;
const VENDING_WIDTH_FRACTION = 0.86;
/** As tall as a locker and a little more: the biggest box on the floor. */
const VENDING_HEIGHT_FRACTION = 1.6;
const VENDING_DEPTH_FRACTION = 0.24;
const VENDING_CONTACT_SHADOW_SCALE = 1.08;
const VENDING = {
  windowInset: 4,
  windowTop: 9,
  windowBottom: 22,
  windowWidthFraction: 0.66,
  shelves: 5,
  itemsPerShelf: 4,
  emptySlotChance: 0.15,
  itemHeightMin: 0.5,
  itemHeightSpread: 0.25,
  itemGap: 1.5,
  dimItemAlpha: 0.35,
  shelfLineWidth: 1,
  headerInset: 2,
  headerDrop: 1.5,
  headerH: 6,
  headerAlpha: 0.85,
  logoInset: 5,
  logoDrop: 3,
  logoWidthFraction: 0.5,
  logoH: 2,
  sheenAlpha: 0.18,
  sheenNear: 6,
  sheenFar: 12,
  sheenLong: 18,
  sheenShort: 9,
  frameWidth: 1.5,
  crackRays: 7,
  crackRayJitter: 0.5,
  crackRayMin: 6,
  crackRaySpread: 10,
  crackRayWidth: 0.9,
  impactMargin: 5,
  impactFirstFraction: 0.45,
  impactYFirstFraction: 0.35,
  impactSpread: 0.2,
  impactSize: 4,
  panelGap: 3,
  displayH: 4,
  keyRows: 3,
  keyCols: 2,
  keySize: 2.5,
  keyPitch: 4,
  keysDrop: 8,
  slotDrop: 20,
  slotW: 2,
  slotH: 5,
  flapTop: 18,
  flapH: 8,
  dentChance: 0.6,
  dentMargin: 6,
  dentRise: 6,
  dentRx: 4,
  dentRy: 2,
} as const;
/** The window's own glow: the machine's emitter, so the one bright thing in it. */
const VENDING_GLASS_LIT = '#dcebf3';
const VENDING_GLASS_DIM = '#9ab8c8';
const VENDING_HEADER = '#e2d9c0';
const VENDING_DISPLAY = '#7fe0c8';
const VENDING_KEY = '#c9c3b2';
const SHELF_LINE = '#4a5258';
const SNACK_SHADES = ['#b8473a', '#d0a23b', '#3d6fa0', '#5d8a3e', '#8a4c8f', '#d07a2e'] as const;

function vendingBox(ox: number, oy: number, ts: number): BoxGeometry {
  const width = ts * VENDING_WIDTH_FRACTION;
  const left = ox + (ts - width) / 2;
  return {
    left,
    right: left + width,
    baseY: oy + ts * ONE_TILE_BASE_FRACTION,
    height: ts * VENDING_HEIGHT_FRACTION,
    depth: ts * VENDING_DEPTH_FRACTION,
  };
}

function snackShade(rng: () => number): string {
  return SNACK_SHADES[Math.floor(rng() * SNACK_SHADES.length)] ?? SNACK_SHADES[0];
}

/** A vending machine with its window lit, cracked across when `damaged`. */
export function drawVendingMachine(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const v = VENDING;
  const rng = mulberry32(VENDING_SEED + variant * VENDING_VARIANT_STRIDE);
  const box = vendingBox(ox, oy, ts);
  const width = box.right - box.left;
  contactShadow(ctx, (box.left + box.right) / 2, box.baseY, ts, VENDING_CONTACT_SHADOW_SCALE);
  paintBox(ctx, box, VENDING_SHELL);

  const frontTop = boxFrontTop(box);
  const winLeft = box.left + v.windowInset;
  const winRight = box.left + width * v.windowWidthFraction;
  const winTop = frontTop + v.windowTop;
  const winBottom = box.baseY - v.windowBottom;
  const winW = winRight - winLeft;
  const winH = winBottom - winTop;

  wash(
    ctx,
    box.left + v.headerInset,
    frontTop + v.headerDrop,
    width - v.headerInset * 2,
    v.headerH,
    VENDING_HEADER,
    v.headerAlpha,
  );
  wash(
    ctx,
    box.left + v.logoInset,
    frontTop + v.logoDrop,
    width * v.logoWidthFraction,
    v.logoH,
    VENDING_SHELL.frontHigh,
    1,
  );

  ctx.fillStyle = verticalRamp(ctx, winLeft, winTop, winBottom, [
    [0, VENDING_GLASS_LIT],
    [1, VENDING_GLASS_DIM],
  ]);
  ctx.fillRect(winLeft, winTop, winW, winH);
  const shelfH = winH / v.shelves;
  const itemW = (winW - 2) / v.itemsPerShelf;
  const darkRow = damaged ? 1 : -1;
  for (let s = 0; s < v.shelves; s++) {
    const shelfBottom = winTop + (s + 1) * shelfH;
    for (let i = 0; i < v.itemsPerShelf; i++) {
      // What is left in the machine is the variant: an empty slot here and there.
      if (rng() < v.emptySlotChance) continue;
      const shade = snackShade(rng);
      const h = shelfH * (v.itemHeightMin + rng() * v.itemHeightSpread);
      const alpha = s === darkRow ? v.dimItemAlpha : 1;
      wash(
        ctx,
        winLeft + v.itemGap + i * itemW,
        shelfBottom - h - 1,
        itemW - v.itemGap,
        h,
        shade,
        alpha,
      );
    }
    line(ctx, winLeft, shelfBottom, winRight, shelfBottom, SHELF_LINE, v.shelfLineWidth);
  }
  // The glass's sheen: one cool diagonal band across the window.
  ctx.save();
  ctx.beginPath();
  ctx.rect(winLeft, winTop, winW, winH);
  ctx.clip();
  ctx.globalAlpha = v.sheenAlpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(winLeft + v.sheenNear, winTop);
  ctx.lineTo(winLeft + v.sheenFar, winTop);
  ctx.lineTo(winLeft, winTop + v.sheenLong);
  ctx.lineTo(winLeft, winTop + v.sheenShort);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = VENDING_SHELL.outline;
  ctx.lineWidth = v.frameWidth;
  ctx.strokeRect(winLeft, winTop, winW, winH);
  ctx.restore();

  if (damaged) {
    const impactX = lerp(
      winLeft + v.impactMargin,
      winRight - v.impactMargin,
      v.impactFirstFraction + rng() * v.impactSpread,
    );
    const impactY = lerp(
      winTop + v.impactMargin,
      winBottom - v.impactMargin,
      v.impactYFirstFraction + rng() * v.impactSpread,
    );
    for (let i = 0; i < v.crackRays; i++) {
      const a = (i / v.crackRays) * FULL_TURN + rng() * v.crackRayJitter;
      const len = v.crackRayMin + rng() * v.crackRaySpread;
      line(
        ctx,
        impactX,
        impactY,
        impactX + Math.cos(a) * len,
        impactY + Math.sin(a) * len,
        '#ffffff',
        v.crackRayWidth,
      );
    }
    wash(
      ctx,
      impactX - v.impactSize / 2,
      impactY - v.impactSize / 2,
      v.impactSize,
      v.impactSize,
      CAVITY,
      1,
    );
  }

  const panelX = winRight + v.panelGap;
  const panelW = box.right - v.panelGap - panelX;
  wash(ctx, panelX, winTop + 1, panelW, v.displayH, VENDING_DISPLAY, 1);
  for (let r = 0; r < v.keyRows; r++) {
    for (let c = 0; c < v.keyCols; c++) {
      wash(
        ctx,
        panelX + 1 + c * v.keyPitch,
        winTop + v.keysDrop + r * v.keyPitch,
        v.keySize,
        v.keySize,
        VENDING_KEY,
        1,
      );
    }
  }
  wash(ctx, panelX + panelW / 2 - v.slotW / 2, winTop + v.slotDrop, v.slotW, v.slotH, CAVITY, 1);

  const flapTop = box.baseY - v.flapTop;
  wash(ctx, winLeft, flapTop, winW, v.flapH, CAVITY, 1);
  line(ctx, winLeft, flapTop + v.flapH, winRight, flapTop + v.flapH, VENDING_SHELL.edge, 1);
  if (rng() < v.dentChance) {
    dent(
      ctx,
      lerp(box.left + v.dentMargin, box.right - v.dentMargin, rng()),
      box.baseY - v.dentRise,
      v.dentRx,
      v.dentRy,
    );
  }
}

const VENDING_REMAINS = {
  centreYFraction: 0.6,
  shards: 9,
  shardSpreadXFraction: 0.7,
  shardSpreadYFraction: 0.3,
  shardLong: 3,
  shardTip: 1.5,
  shardBack: 1,
  shardWide: 2,
  shardAlpha: 0.75,
  snacks: 5,
  snackSpreadXFraction: 0.6,
  snackSpreadYFraction: 0.25,
  snackW: 5,
  snackH: 3.5,
  panelA: [0.16, 0.44, 0.44, 0.5] as const,
  panelB: [0.58, 0.74, 0.86, 0.68] as const,
  panelWidth: 4,
} as const;
const GLASS_SHARD = '#c8dbe4';

/** A vending machine after a break: glass, the panel's bent steel and the snacks it held. */
export function drawVendingRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(VENDING_SEED + REMAINS_SEED_OFFSET + variant);
  const r = VENDING_REMAINS;
  const cx = ox + ts / 2;
  const cy = oy + ts * r.centreYFraction;
  wreckBed(ctx, cx, cy, ts);
  for (let i = 0; i < r.shards; i++) {
    const x = cx + (rng() - 0.5) * ts * r.shardSpreadXFraction;
    const y = cy + (rng() - 0.5) * ts * r.shardSpreadYFraction;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng() * Math.PI);
    ctx.globalAlpha = r.shardAlpha;
    ctx.fillStyle = GLASS_SHARD;
    ctx.beginPath();
    ctx.moveTo(-r.shardLong, -r.shardTip);
    ctx.lineTo(r.shardLong, 0);
    ctx.lineTo(-r.shardBack, r.shardWide);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < r.snacks; i++) {
    const x = cx + (rng() - 0.5) * ts * r.snackSpreadXFraction;
    const y = cy + (rng() - 0.5) * ts * r.snackSpreadYFraction;
    wash(ctx, x, y, r.snackW, r.snackH, snackShade(rng), 1);
  }
  const [ax0, ay0, ax1, ay1] = r.panelA;
  line(
    ctx,
    ox + ts * ax0,
    oy + ts * ay0,
    ox + ts * ax1,
    oy + ts * ay1,
    VENDING_SHELL.frontHigh,
    r.panelWidth,
  );
  const [bx0, by0, bx1, by1] = r.panelB;
  line(
    ctx,
    ox + ts * bx0,
    oy + ts * by0,
    ox + ts * bx1,
    oy + ts * by1,
    VENDING_SHELL.frontLow,
    r.panelWidth,
  );
}

// ── Gas cylinder ───────────────────────────────────────────────────────────

const CYLINDER_SEED = 0x6a5c;
const CYLINDER_VARIANT_STRIDE = 211;
const CYLINDER_RADIUS_FRACTION = 0.17;
const CYLINDER_BODY_HEIGHT_FRACTION = 0.95;
const CYLINDER_CONTACT_SHADOW_SCALE = 0.62;
/** The shoulder is a flattened dome on top of the body. */
const CYLINDER_DOME_SQUASH = 0.9;
const CYLINDER = {
  shoulderBandH: 5,
  shoulderBandGap: 4,
  bandAlpha: 0.85,
  valveW: 6,
  valveH: 6,
  capW: 11,
  capH: 9,
  capCentreFraction: 0.55,
  footH: 3,
  outlineWidth: 1.2,
  diamond: 4,
  diamondAboveChain: 9,
  diamondWidth: 1.5,
  /** Height of the wall chain up the bottle, as a fraction from its foot. */
  chainFraction: 0.6,
  /** Thick enough to survive the downscale as a line rather than a smear. */
  chainWidth: 3,
  chainSag: 2,
  chainReachFraction: 0.1,
  chipsMin: 2,
  chipsSpread: 3,
  chipSize: 1.5,
  chipMargin: 2,
  chipAlpha: 0.6,
  chipBandClear: 8,
  rustChance: 0.6,
  rustH: 6,
  rustAlpha: 0.3,
} as const;
const CYLINDER_BODY_STOPS = {
  litAt: 0.3,
  midAt: 0.45,
} as const;
/**
 * The damaged bottle has to read as the warning it is: a deep dent caving in
 * one side, the valve furred white with frost, and a jet of gas already
 * streaming out of the cracked valve.
 */
const CYLINDER_DAMAGE = {
  dentHeightFraction: 0.35,
  dentShift: 2,
  dentRx: 7,
  dentRy: 5,
  creaseWidth: 1.5,
  frostPad: 2,
  frostAlpha: 0.85,
  frostCrystalCount: 5,
  frostCrystalReach: 5,
  frostCrystalWidth: 1.2,
  jetPuffs: 3,
  jetReachX: 6,
  jetRise: 4,
  jetRadiusMin: 2.5,
  jetRadiusStep: 1.5,
  jetAlphaStart: 0.75,
  jetAlphaFade: 0.2,
} as const;
const SHOULDER_BAND = '#c8c3b5';
const HAZARD_ORANGE = '#d07a2e';
const FROST = '#e8f0f2';
const GAS_JET = '#f2f6f7';

interface CylinderGeometry {
  readonly cx: number;
  readonly radius: number;
  readonly baseY: number;
  readonly bodyTop: number;
}

function cylinderGeometry(ox: number, oy: number, ts: number): CylinderGeometry {
  const baseY = oy + ts * ONE_TILE_BASE_FRACTION;
  return {
    cx: ox + ts / 2,
    radius: ts * CYLINDER_RADIUS_FRACTION,
    baseY,
    bodyTop: baseY - ts * CYLINDER_BODY_HEIGHT_FRACTION,
  };
}

/** The welded bottle, caved in, frosting and leaking at the valve when `damaged`. */
export function drawGasCylinder(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
  damaged: boolean,
): void {
  const c = CYLINDER;
  const rng = mulberry32(CYLINDER_SEED + variant * CYLINDER_VARIANT_STRIDE);
  const g = cylinderGeometry(ox, oy, ts);
  const left = g.cx - g.radius;
  const right = g.cx + g.radius;
  contactShadow(ctx, g.cx, g.baseY, ts, CYLINDER_CONTACT_SHADOW_SCALE);

  // The chain that holds it to the wall runs from the bottle back to both edges.
  const chainY = lerp(g.baseY, g.bodyTop, c.chainFraction);
  const chainReach = ts * c.chainReachFraction;
  line(ctx, ox + chainReach, chainY - c.chainSag, left, chainY, BARE_STEEL.dark, c.chainWidth);
  line(
    ctx,
    right,
    chainY,
    ox + ts - chainReach,
    chainY - c.chainSag,
    BARE_STEEL.dark,
    c.chainWidth,
  );

  const body = cylinderRamp(ctx, left, right, g.bodyTop, [
    [0, CYLINDER_PAINT.frontLow],
    [CYLINDER_BODY_STOPS.litAt, CYLINDER_PAINT.edge],
    [CYLINDER_BODY_STOPS.midAt, CYLINDER_PAINT.frontHigh],
    [1, CYLINDER_PAINT.outline],
  ]);
  ctx.save();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(left, g.baseY - c.footH);
  ctx.lineTo(left, g.bodyTop);
  ctx.ellipse(g.cx, g.bodyTop, g.radius, g.radius * CYLINDER_DOME_SQUASH, 0, Math.PI, 0);
  ctx.lineTo(right, g.baseY - c.footH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = CYLINDER_PAINT.outline;
  ctx.lineWidth = c.outlineWidth;
  ctx.stroke();
  ctx.restore();
  wash(ctx, left + 1, g.baseY - c.footH, right - left - 2, c.footH, BARE_STEEL.dark, 1);

  const bandTop = g.bodyTop + c.shoulderBandGap;
  wash(ctx, left, bandTop, right - left, c.shoulderBandH, SHOULDER_BAND, c.bandAlpha);
  const diamondY = chainY - c.diamondAboveChain;
  const diamond: ReadonlyArray<readonly [number, number]> = [
    [0, -c.diamond],
    [c.diamond, 0],
    [0, c.diamond],
    [-c.diamond, 0],
  ];
  diamond.forEach(([x0, y0], index) => {
    const [x1, y1] = diamond[(index + 1) % diamond.length] ?? diamond[0];
    line(ctx, g.cx + x0, diamondY + y0, g.cx + x1, diamondY + y1, HAZARD_ORANGE, c.diamondWidth);
  });

  const domeTop = g.bodyTop - g.radius * CYLINDER_DOME_SQUASH;
  const valveTop = domeTop - c.valveH + 1;
  wash(ctx, g.cx - c.valveW / 2, valveTop, c.valveW, c.valveH, BARE_STEEL.mid, 1);
  const capTop = valveTop - c.capH + 1;
  ctx.save();
  ctx.fillStyle = cylinderRamp(ctx, g.cx - c.capW / 2, g.cx + c.capW / 2, capTop, [
    [0, BARE_STEEL.dark],
    [CYLINDER_BODY_STOPS.litAt, BARE_STEEL.light],
    [1, BARE_STEEL.dark],
  ]);
  ctx.beginPath();
  const capCy = capTop + c.capH * c.capCentreFraction;
  ctx.ellipse(g.cx, capCy, c.capW / 2, c.capH * c.capCentreFraction, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = BARE_STEEL.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Chipped paint showing grey steel, and rust where it stands in the wet.
  const chips = c.chipsMin + Math.floor(rng() * c.chipsSpread);
  for (let i = 0; i < chips; i++) {
    wash(
      ctx,
      lerp(left + c.chipMargin, right - c.chipMargin - c.chipSize, rng()),
      lerp(bandTop + c.chipBandClear, g.baseY - c.chipBandClear, rng()),
      c.chipSize,
      c.chipSize,
      BARE_STEEL.light,
      c.chipAlpha,
    );
  }
  if (rng() < c.rustChance) {
    wash(ctx, left + 1, g.baseY - c.footH - c.rustH, right - left - 2, c.rustH, RUST, c.rustAlpha);
  }
  if (damaged) drawCylinderDamage(ctx, g, valveTop, rng);
}

function drawCylinderDamage(
  ctx: Ctx,
  g: CylinderGeometry,
  valveTop: number,
  rng: () => number,
): void {
  const d = CYLINDER_DAMAGE;
  const c = CYLINDER;
  const dentY = lerp(g.baseY, g.bodyTop, d.dentHeightFraction);
  dent(ctx, g.cx + d.dentShift, dentY, d.dentRx, d.dentRy);
  line(
    ctx,
    g.cx + d.dentShift - d.dentRx,
    dentY,
    g.cx + d.dentShift + d.dentRx,
    dentY + 1,
    CYLINDER_PAINT.outline,
    d.creaseWidth,
  );
  wash(
    ctx,
    g.cx - c.valveW / 2 - d.frostPad,
    valveTop - d.frostPad,
    c.valveW + d.frostPad * 2,
    c.valveH + d.frostPad * 2,
    FROST,
    d.frostAlpha,
  );
  const valveCy = valveTop + c.valveH / 2;
  for (let i = 0; i < d.frostCrystalCount; i++) {
    const a = rng() * FULL_TURN;
    line(
      ctx,
      g.cx,
      valveCy,
      g.cx + Math.cos(a) * d.frostCrystalReach,
      valveCy + Math.sin(a) * d.frostCrystalReach,
      FROST,
      d.frostCrystalWidth,
    );
  }
  for (let i = 0; i < d.jetPuffs; i++) {
    blot(
      ctx,
      g.cx + c.valveW / 2 + (i + 1) * d.jetReachX,
      valveCy - i * d.jetRise,
      d.jetRadiusMin + i * d.jetRadiusStep,
      d.jetRadiusMin + i * d.jetRadiusStep,
      GAS_JET,
      d.jetAlphaStart - i * d.jetAlphaFade,
    );
  }
}

const CYLINDER_REMAINS = {
  centreYFraction: 0.62,
  scorchRxFraction: 0.42,
  scorchRyFraction: 0.24,
  petals: 4,
  petalJitter: 0.6,
  petalReachMin: 5,
  petalReachSpread: 6,
  petalSquash: 0.5,
  petalRadius: 5,
  petalArcStart: 0.3,
  petalArcEnd: 2.4,
  petalWidth: 3,
  valveDx: 6,
  valveDy: -6,
  valveW: 5,
  valveH: 4,
} as const;
const SCORCH_CORE = 'rgba(10,8,6,0.55)';
const SCORCH_EDGE = 'rgba(10,8,6,0)';

/** A gas bottle after it went up: a torn shell lying in a scorch. */
export function drawGasCylinderRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  variant: number,
): void {
  const rng = mulberry32(CYLINDER_SEED + REMAINS_SEED_OFFSET + variant);
  const r = CYLINDER_REMAINS;
  const cx = ox + ts / 2;
  const cy = oy + ts * r.centreYFraction;
  const rx = ts * r.scorchRxFraction;
  ctx.save();
  const scorch = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  scorch.addColorStop(0, SCORCH_CORE);
  scorch.addColorStop(1, SCORCH_EDGE);
  ctx.fillStyle = scorch;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ts * r.scorchRyFraction, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < r.petals; i++) {
    const a = (i / r.petals) * FULL_TURN + rng() * r.petalJitter;
    const reach = r.petalReachMin + rng() * r.petalReachSpread;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach * r.petalSquash);
    ctx.rotate(a);
    ctx.strokeStyle = i % 2 === 0 ? CYLINDER_PAINT.frontHigh : CYLINDER_PAINT.frontLow;
    ctx.lineWidth = r.petalWidth;
    ctx.beginPath();
    ctx.arc(0, 0, r.petalRadius, r.petalArcStart, r.petalArcEnd);
    ctx.stroke();
    ctx.restore();
  }
  wash(ctx, cx + r.valveDx, cy + r.valveDy, r.valveW, r.valveH, BARE_STEEL.mid, 1);
}
