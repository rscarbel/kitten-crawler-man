/**
 * Bespoke furniture for the Barracks, built as a few big pieces that say
 * "garrison" from across the room: the long weapon racks with more empty
 * pegs than spears, the row of issued armour on its plinth, the signed-for
 * counter with the book open on it, the muster board papered four deep, the
 * briefing table under its pinned map, and two-high bunks. The drill hall's
 * sand stays open, so its own pieces — straw dummies, hacked pells, an
 * archery butt, the scoring slate, a water trough and sandbags — are all
 * things that stand at the edge of a floor, not in the middle of it.
 *
 * Garrison colours throughout are the blue-grey `oc_cloth_sky` leather and
 * wool, never the Meat Shields' orange: the two are different employers, and
 * a crawler reading the room should be able to tell which one this is.
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
  type Rng,
} from '../../town/townArt';
import { getTownRamp, sampleRamp, mix, type RGB } from '../../town/townPalette';
import { paintPlankBoard } from '../../town/townMaterials';

type Ctx = CanvasRenderingContext2D;

function woodRamp() {
  return getTownRamp('oc_timber');
}
function ironRamp() {
  return getTownRamp('iron_black');
}
function clothRamp() {
  return getTownRamp('oc_cloth_sky');
}
function slateRamp() {
  return getTownRamp('oc_slate');
}

function contactShadow(ctx: Ctx, frame: TownPropFrame, spread = 0.44, alpha = 0.34): void {
  const box = footprintBox(frame);
  const radiusX = box.width * spread;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, alpha);
}

/** Honed steel — brighter and cooler than the black-iron ramp, which reads as fittings rather than an edge. */
const STEEL_DIM: RGB = [118, 126, 136];
const STEEL_BRIGHT: RGB = [206, 214, 222];
/** Straw and burlap — no shared ramp covers anything this pale and fibrous. */
const STRAW: RGB = [206, 176, 96];
const STRAW_DARK: RGB = [150, 118, 58];
const BURLAP: RGB = [168, 140, 98];
const BURLAP_DARK: RGB = [118, 94, 62];
/** Quilted gambeson linen, the undyed cloth under the leather. */
const GAMBESON: RGB = [196, 186, 160];
const GAMBESON_SHADOW: RGB = [142, 132, 110];
/** Target paint: the rings of a butt and the bull on a dummy's chest. */
const TARGET_RED: RGB = [170, 48, 40];
const TARGET_WHITE: RGB = [226, 218, 196];
const TARGET_BLACK: RGB = [36, 32, 30];
const TARGET_GOLD: RGB = [214, 172, 70];
/** Paper, chalk and wax on the board, the slate and the ledger. */
const PAPER: RGB = [222, 208, 172];
const PAPER_SHADOW: RGB = [178, 160, 124];
const PAPER_INK: RGB = [70, 56, 44];
const CHALK: RGB = [226, 228, 222];
const WAX_RED: RGB = [150, 36, 34];
const PIN_BRASS: RGB = [206, 170, 86];
/** A map's own inks: the wall in umber, water in blue, the watch posts in red. */
const MAP_WALL: RGB = [112, 74, 44];
const MAP_WATER: RGB = [70, 112, 150];
/** Trough water — dark and faintly reflective. */
const WATER_DEEP: RGB = [40, 58, 70];
const WATER_LIGHT: RGB = [120, 156, 176];
/** Lantern and candle flame. */
const FLAME_CORE: RGB = [252, 220, 140];
const FLAME_MID: RGB = [230, 140, 56];
/** Fletching on the arrows in the butt. */
const FLETCH_GREY: RGB = [214, 210, 200];
/** Blanket wool for the bunks — the garrison blue-grey, darker than the leather. */
const BLANKET: RGB = [74, 92, 112];
const BLANKET_LIGHT: RGB = [112, 132, 154];
const TICKING: RGB = [200, 192, 170];

function rectPath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function fillOutlinedRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  ts: number,
): void {
  ctx.fillStyle = rgb(color);
  rectPath(ctx, x, y, w, h);
  ctx.fill();
  inkOutline(ctx, ts);
}

function paintGlow(ctx: Ctx, x: number, y: number, radius: number, alpha: number): void {
  const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
  glow.addColorStop(0, rgba(FLAME_CORE, alpha));
  glow.addColorStop(0.5, rgba(FLAME_MID, alpha * 0.4));
  glow.addColorStop(1, rgba(FLAME_MID, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// ── Weapon racks ───────────────────────────────────────────────────────────

type RackPiece = 'spear' | 'halberd' | 'empty' | 'sword' | 'staff' | 'mallet';

/** Forty pegs' worth of rack between the two walls, and fewer than half of them filled. */
const SPEAR_RACK_PATTERN: readonly RackPiece[] = [
  'spear',
  'spear',
  'empty',
  'halberd',
  'spear',
  'empty',
  'empty',
  'spear',
  'empty',
  'spear',
  'empty',
];
const PRACTICE_RACK_PATTERN: readonly RackPiece[] = [
  'staff',
  'sword',
  'sword',
  'mallet',
  'sword',
  'empty',
  'staff',
  'sword',
  'sword',
  'mallet',
  'staff',
];

function paintSpearHead(ctx: Ctx, x: number, tipY: number, len: number, ts: number): void {
  ctx.fillStyle = rgb(mix(STEEL_DIM, STEEL_BRIGHT, 0.6));
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.quadraticCurveTo(x + len * 0.42, tipY + len * 0.6, x, tipY + len);
  ctx.quadraticCurveTo(x - len * 0.42, tipY + len * 0.6, x, tipY);
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.strokeStyle = rgba(STEEL_BRIGHT, 0.9);
  ctx.lineWidth = Math.max(1, ts * 0.012);
  ctx.beginPath();
  ctx.moveTo(x - len * 0.05, tipY + len * 0.2);
  ctx.lineTo(x - len * 0.05, tipY + len * 0.8);
  ctx.stroke();
}

function paintRackPiece(
  ctx: Ctx,
  piece: RackPiece,
  x: number,
  sillTop: number,
  railY: number,
  ts: number,
  rng: Rng,
): void {
  const wood = woodRamp();
  const shaftW = ts * 0.06;
  if (piece === 'empty') {
    // An empty peg: the hole in the rail and a pale scuff on the sill where a butt used to stand.
    ctx.fillStyle = rgba(TARGET_BLACK, 0.7);
    ctx.beginPath();
    ctx.ellipse(x, railY, shaftW * 0.8, shaftW * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(CHALK, 0.25);
    ctx.fillRect(x - shaftW, sillTop + ts * 0.02, shaftW * 2, ts * 0.03);
    return;
  }
  const lean = jitter(rng, ts * 0.02);
  const tall = piece === 'spear' || piece === 'halberd' || piece === 'staff';
  const topY = tall ? railY - ts * (0.42 + jitter(rng, 0.04)) : railY - ts * 0.24;
  const shaftColor =
    piece === 'sword' ? sampleRamp(wood, 0.85) : sampleRamp(wood, 0.72 + jitter(rng, 0.06));
  if (piece === 'sword') {
    // A practice waster: a flat wooden blade with a crossguard, grip down in the sill.
    const bladeW = ts * 0.07;
    ctx.fillStyle = rgb(shaftColor);
    ctx.beginPath();
    ctx.moveTo(x + lean - bladeW / 2, sillTop - ts * 0.16);
    ctx.lineTo(x + lean - bladeW / 2, topY + bladeW);
    ctx.lineTo(x + lean, topY);
    ctx.lineTo(x + lean + bladeW / 2, topY + bladeW);
    ctx.lineTo(x + lean + bladeW / 2, sillTop - ts * 0.16);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    fillOutlinedRect(
      ctx,
      x + lean - ts * 0.09,
      sillTop - ts * 0.18,
      ts * 0.18,
      ts * 0.035,
      sampleRamp(wood, 0.35),
      ts * 0.6,
    );
    fillOutlinedRect(
      ctx,
      x + lean - ts * 0.02,
      sillTop - ts * 0.15,
      ts * 0.04,
      ts * 0.14,
      sampleRamp(wood, 0.28),
      ts * 0.5,
    );
    return;
  }
  // Ink first, then the shaft over it, so a pale pole reads against the dark backboard.
  ctx.strokeStyle = rgba(TARGET_BLACK, 0.85);
  ctx.lineWidth = shaftW + Math.max(2, ts * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, sillTop + ts * 0.02);
  ctx.lineTo(x + lean, topY);
  ctx.stroke();
  ctx.strokeStyle = rgb(shaftColor);
  ctx.lineWidth = shaftW;
  ctx.stroke();
  if (piece === 'spear') {
    paintSpearHead(ctx, x + lean, topY - ts * 0.3, ts * 0.32, ts);
    // The garrison's blue tie under the head.
    ctx.fillStyle = rgb(sampleRamp(clothRamp(), 0.55));
    ctx.fillRect(x + lean - shaftW, topY + ts * 0.01, shaftW * 2, ts * 0.05);
  } else if (piece === 'halberd') {
    paintSpearHead(ctx, x + lean, topY - ts * 0.2, ts * 0.2, ts);
    ctx.fillStyle = rgb(mix(STEEL_DIM, STEEL_BRIGHT, 0.35));
    ctx.beginPath();
    ctx.moveTo(x + lean, topY + ts * 0.02);
    ctx.quadraticCurveTo(
      x + lean + ts * 0.22,
      topY + ts * 0.02,
      x + lean + ts * 0.2,
      topY + ts * 0.2,
    );
    ctx.lineTo(x + lean, topY + ts * 0.16);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(STEEL_DIM);
    ctx.beginPath();
    ctx.moveTo(x + lean, topY + ts * 0.05);
    ctx.lineTo(x + lean - ts * 0.1, topY + ts * 0.1);
    ctx.lineTo(x + lean, topY + ts * 0.13);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  } else if (piece === 'staff') {
    ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
    ctx.beginPath();
    ctx.arc(x + lean, topY, shaftW * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.55));
    ctx.fillRect(x + lean - shaftW * 0.7, topY + ts * 0.04, shaftW * 1.4, ts * 0.03);
  } else {
    // A padded mallet: a rag-bound head on a short haft.
    const headW = ts * 0.16;
    const headH = ts * 0.12;
    ctx.fillStyle = rgb(BURLAP);
    ctx.beginPath();
    ctx.ellipse(x + lean, topY, headW / 2, headH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.strokeStyle = rgba(BURLAP_DARK, 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.012);
    for (const dx of [-0.3, 0, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(x + lean + headW * dx, topY - headH * 0.45);
      ctx.lineTo(x + lean + headW * dx, topY + headH * 0.45);
      ctx.stroke();
    }
  }
}

/**
 * A three-tile wall rack: a planked backboard, a notched top rail and a sill
 * trough the butts stand in. Variant 0 is the spear rack — more empty pegs
 * than spears, which is the garrison's real strength and not the paper one.
 * Variant 1 is the drill hall's practice rack of wasters, staves and padded
 * mallets.
 */
export function paintGarrisonWeaponRack(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame, 0.46);
    const boardLeft = box.left + ts * 0.08;
    const boardRight = box.right - ts * 0.08;
    const boardTop = box.top - ts * 0.5;
    const sillTop = box.bottom - ts * 0.3;
    const sillBottom = box.bottom - ts * 0.08;
    const railY = box.top - ts * 0.12;

    // Backboard: one dark, even panel, so the pale poles in front of it are
    // the only lines on it — a planked board reads as a slatted fence.
    const backboard = ctx.createLinearGradient(0, boardTop, 0, sillTop);
    backboard.addColorStop(0, rgb(sampleRamp(wood, 0.12)));
    backboard.addColorStop(1, rgb(sampleRamp(wood, 0.04)));
    ctx.fillStyle = backboard;
    rectPath(ctx, boardLeft, boardTop, boardRight - boardLeft, sillTop - boardTop);
    ctx.fill();
    inkOutline(ctx, ts);

    // Uprights at each end, standing proud of the board.
    const postW = ts * 0.12;
    for (const px of [box.left + ts * 0.04, box.right - ts * 0.04 - postW]) {
      fillOutlinedRect(
        ctx,
        px,
        boardTop - ts * 0.08,
        postW,
        sillBottom - boardTop + ts * 0.08,
        sampleRamp(wood, 0.42),
        ts,
      );
      ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.6);
      ctx.fillRect(px, boardTop - ts * 0.08, postW * 0.3, sillBottom - boardTop);
    }

    const pattern = variant === 0 ? SPEAR_RACK_PATTERN : PRACTICE_RACK_PATTERN;
    const innerLeft = boardLeft + ts * 0.18;
    const innerRight = boardRight - ts * 0.18;
    const pitch = (innerRight - innerLeft) / (pattern.length - 1);
    for (let i = 0; i < pattern.length; i++) {
      paintRackPiece(ctx, pattern[i], innerLeft + i * pitch, sillTop, railY, ts, forkRng(rng));
    }

    // Top rail with its peg notches, drawn over the shafts it holds.
    const railH = ts * 0.1;
    fillOutlinedRect(
      ctx,
      boardLeft,
      railY - railH / 2,
      boardRight - boardLeft,
      railH,
      sampleRamp(wood, 0.55),
      ts,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.55);
    ctx.fillRect(boardLeft, railY - railH / 2, boardRight - boardLeft, railH * 0.25);
    ctx.fillStyle = rgba(TARGET_BLACK, 0.55);
    for (let i = 0; i < pattern.length; i++) {
      ctx.fillRect(innerLeft + i * pitch - ts * 0.03, railY - railH / 2, ts * 0.06, railH * 0.45);
    }

    // Sill trough the butts stand in.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.beginPath();
    ctx.moveTo(boardLeft, sillTop);
    ctx.lineTo(boardLeft + ts * 0.06, sillTop - ts * 0.07);
    ctx.lineTo(boardRight - ts * 0.06, sillTop - ts * 0.07);
    ctx.lineTo(boardRight, sillTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    fillOutlinedRect(
      ctx,
      boardLeft,
      sillTop,
      boardRight - boardLeft,
      sillBottom - sillTop,
      sampleRamp(wood, 0.38),
      ts,
    );
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.55));
    for (const t of [0.25, 0.75]) {
      ctx.fillRect(
        boardLeft + (boardRight - boardLeft) * t - ts * 0.03,
        sillTop,
        ts * 0.06,
        sillBottom - sillTop,
      );
    }
  });
}

// ── Armour on stands ──────────────────────────────────────────────────────

type ArmourKind = 'cuirass' | 'gambeson' | 'brigandine';

function paintHelm(ctx: Ctx, cx: number, cy: number, r: number, kettle: boolean, ts: number): void {
  const iron = ironRamp();
  ctx.fillStyle = rgb(mix(sampleRamp(iron, 0.7), STEEL_DIM, 0.5));
  if (kettle) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.35, r * 1.55, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.95, 0, Math.PI, 0);
  ctx.lineTo(cx + r, cy + r * 0.3);
  ctx.lineTo(cx - r, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.8);
  ctx.fillStyle = rgba(STEEL_BRIGHT, 0.75);
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.45, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  if (!kettle) {
    ctx.strokeStyle = rgb(STEEL_DIM);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.1);
    ctx.lineTo(cx, cy + r * 0.75);
    ctx.stroke();
  }
}

function paintArmourOnStand(
  ctx: Ctx,
  cx: number,
  baseY: number,
  kind: ArmourKind,
  ts: number,
  rng: Rng,
): void {
  const wood = woodRamp();
  const leather = clothRamp();
  const postTop = baseY - ts * 1.0;
  ctx.strokeStyle = rgb(sampleRamp(wood, 0.32));
  ctx.lineWidth = ts * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, postTop);
  ctx.stroke();
  // Cross-foot, so the stand stands.
  ctx.lineWidth = ts * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx - ts * 0.2, baseY - ts * 0.01);
  ctx.lineTo(cx + ts * 0.2, baseY - ts * 0.01);
  ctx.stroke();

  const bodyTop = postTop + ts * 0.2;
  const bodyW = ts * 0.52;
  const bodyH = ts * 0.5;
  const fill =
    kind === 'gambeson'
      ? GAMBESON
      : kind === 'brigandine'
        ? sampleRamp(leather, 0.28 + jitter(rng, 0.03))
        : sampleRamp(leather, 0.45 + jitter(rng, 0.03));
  ctx.fillStyle = rgb(fill);
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, bodyTop);
  ctx.quadraticCurveTo(cx, bodyTop + ts * 0.08, cx + bodyW / 2, bodyTop);
  ctx.lineTo(cx + bodyW * 0.36, bodyTop + bodyH);
  ctx.quadraticCurveTo(cx, bodyTop + bodyH + ts * 0.05, cx - bodyW * 0.36, bodyTop + bodyH);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts);
  // Light from the upper left: a lit left flank, a shaded right one.
  ctx.fillStyle = rgba(kind === 'gambeson' ? GAMBESON_SHADOW : sampleRamp(leather, 0.1), 0.45);
  ctx.beginPath();
  ctx.moveTo(cx + bodyW * 0.12, bodyTop + ts * 0.04);
  ctx.lineTo(cx + bodyW / 2, bodyTop);
  ctx.lineTo(cx + bodyW * 0.36, bodyTop + bodyH);
  ctx.lineTo(cx + bodyW * 0.1, bodyTop + bodyH);
  ctx.closePath();
  ctx.fill();

  if (kind === 'gambeson') {
    // Quilting: vertical channels stitched down the front.
    ctx.strokeStyle = rgba(GAMBESON_SHADOW, 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.014);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * bodyW * 0.14, bodyTop + ts * 0.06);
      ctx.lineTo(cx + i * bodyW * 0.11, bodyTop + bodyH - ts * 0.02);
      ctx.stroke();
    }
  } else if (kind === 'brigandine') {
    // Rivet rows over the plates sewn inside.
    ctx.fillStyle = rgb(PIN_BRASS);
    for (let row = 0; row < 4; row++) {
      for (let col = -2; col <= 2; col++) {
        ctx.beginPath();
        ctx.arc(
          cx + col * bodyW * 0.14,
          bodyTop + ts * (0.1 + row * 0.1),
          ts * 0.013,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  } else {
    // Laced side seam and a moulded breast ridge.
    ctx.strokeStyle = rgba(sampleRamp(leather, 0.9), 0.6);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.3, bodyTop + ts * 0.14);
    ctx.quadraticCurveTo(cx, bodyTop + ts * 0.26, cx + bodyW * 0.3, bodyTop + ts * 0.14);
    ctx.stroke();
  }
  // Belt.
  ctx.fillStyle = rgb(sampleRamp(wood, 0.25));
  ctx.fillRect(cx - bodyW * 0.38, bodyTop + bodyH * 0.72, bodyW * 0.76, ts * 0.05);
  ctx.fillStyle = rgb(PIN_BRASS);
  ctx.fillRect(cx - ts * 0.025, bodyTop + bodyH * 0.72, ts * 0.05, ts * 0.05);
  // Pauldrons.
  const pauldron = kind === 'gambeson' ? GAMBESON_SHADOW : sampleRamp(leather, 0.32);
  for (const side of [-1, 1]) {
    ctx.fillStyle = rgb(pauldron);
    ctx.beginPath();
    ctx.ellipse(
      cx + side * bodyW * 0.5,
      bodyTop + ts * 0.04,
      ts * 0.1,
      ts * 0.075,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
  }
  paintHelm(ctx, cx, postTop + ts * 0.02, ts * 0.13, kind === 'brigandine', ts);
}

/**
 * Issued armour on a low plinth against the wall: three T-stands — a moulded
 * leather cuirass, a quilted gambeson, a riveted brigandine under a kettle
 * hat — with two garrison shields hung on the wall behind and a pair of
 * boots waiting on the boards.
 */
export function paintArmourStandRow(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame, 0.47);

    // Shields hung on the wall behind, between the stands.
    for (const t of [1 / 3, 2 / 3]) {
      paintGarrisonShield(ctx, box.left + box.width * t, box.top - ts * 0.5, ts * 0.2, ts);
    }

    const plinthTop = box.bottom - ts * 0.3;
    paintPlankBoard(ctx, box.left + ts * 0.04, plinthTop, box.width - ts * 0.08, ts * 0.24, rng, {
      direction: 'horizontal',
      boardPx: ts * 0.12,
      ramp: wood,
    });
    ctx.fillStyle = rgb(sampleRamp(wood, 0.66));
    ctx.fillRect(box.left + ts * 0.04, plinthTop - ts * 0.06, box.width - ts * 0.08, ts * 0.06);
    rectPath(ctx, box.left + ts * 0.04, plinthTop - ts * 0.06, box.width - ts * 0.08, ts * 0.3);
    inkOutline(ctx, ts);

    const kinds: readonly ArmourKind[] = ['cuirass', 'gambeson', 'brigandine'];
    for (let i = 0; i < kinds.length; i++) {
      paintArmourOnStand(
        ctx,
        box.left + ts * (i + 0.5),
        plinthTop - ts * 0.03,
        kinds[i],
        ts,
        forkRng(rng),
      );
    }

    // Boots on the plinth's front edge.
    for (const dx of [0.04, 0.16]) {
      const bx = box.left + ts * (1.72 + dx);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.18));
      ctx.beginPath();
      ctx.moveTo(bx, plinthTop + ts * 0.2);
      ctx.lineTo(bx, plinthTop + ts * 0.04);
      ctx.lineTo(bx + ts * 0.07, plinthTop + ts * 0.04);
      ctx.lineTo(bx + ts * 0.08, plinthTop + ts * 0.15);
      ctx.lineTo(bx + ts * 0.14, plinthTop + ts * 0.2);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }
  });
}

function paintGarrisonShield(ctx: Ctx, cx: number, cy: number, r: number, ts: number): void {
  const leather = clothRamp();
  ctx.fillStyle = rgb(sampleRamp(leather, 0.4));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(sampleRamp(ironRamp(), 0.6));
  ctx.lineWidth = ts * 0.035;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + ts * 0.018, 0, Math.PI * 2);
  inkOutline(ctx, ts);
  // A pale chevron: the garrison's mark.
  ctx.strokeStyle = rgb(TARGET_WHITE);
  ctx.lineWidth = ts * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.65, cy + r * 0.2);
  ctx.lineTo(cx, cy - r * 0.35);
  ctx.lineTo(cx + r * 0.65, cy + r * 0.2);
  ctx.stroke();
  ctx.fillStyle = rgb(STEEL_DIM);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.3, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.fillStyle = rgba(STEEL_BRIGHT, 0.8);
  ctx.fillRect(cx - r * 0.1, cy + r * 0.2, r * 0.08, r * 0.08);
}

// ── The signed-for counter ────────────────────────────────────────────────

function paintOpenLedger(ctx: Ctx, cx: number, topY: number, ts: number, rng: Rng): void {
  const pageW = ts * 0.3;
  const pageH = ts * 0.22;
  for (const side of [-1, 1]) {
    const x = side < 0 ? cx - pageW : cx;
    ctx.fillStyle = rgb(side < 0 ? PAPER : mix(PAPER, PAPER_SHADOW, 0.25));
    ctx.beginPath();
    ctx.moveTo(x, topY + ts * 0.02);
    ctx.lineTo(x + pageW, topY + (side < 0 ? ts * 0.03 : 0));
    ctx.lineTo(x + pageW, topY + pageH);
    ctx.lineTo(x, topY + pageH);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    // Columns: a name, a piece, a signature — ruled and filled.
    ctx.strokeStyle = rgba(PAPER_INK, 0.7);
    ctx.lineWidth = Math.max(1, ts * 0.01);
    for (let row = 0; row < 5; row++) {
      const y = topY + ts * (0.06 + row * 0.035);
      const len = pageW * (0.55 + jitter(rng, 0.2));
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.03, y);
      ctx.lineTo(x + ts * 0.03 + len * 0.7, y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = rgb(sampleRamp(clothRamp(), 0.3));
  ctx.fillRect(cx - ts * 0.012, topY, ts * 0.024, pageH + ts * 0.02);
}

function paintTallySlate(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  fillOutlinedRect(
    ctx,
    x - ts * 0.025,
    y - ts * 0.025,
    w + ts * 0.05,
    h + ts * 0.05,
    sampleRamp(woodRamp(), 0.5),
    ts,
  );
  fillOutlinedRect(ctx, x, y, w, h, sampleRamp(slateRamp(), 0.2), ts * 0.5);
  ctx.strokeStyle = rgba(CHALK, 0.9);
  ctx.lineWidth = Math.max(1, ts * 0.014);
  const groups = 3;
  for (let g = 0; g < groups; g++) {
    const gx = x + w * 0.1 + g * w * 0.3;
    for (let s = 0; s < 4; s++) {
      ctx.beginPath();
      ctx.moveTo(gx + s * w * 0.05, y + h * 0.2);
      ctx.lineTo(gx + s * w * 0.05, y + h * 0.8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(gx - w * 0.02, y + h * 0.7);
    ctx.lineTo(gx + w * 0.18, y + h * 0.3);
    ctx.stroke();
  }
}

function paintLantern(ctx: Ctx, cx: number, bottomY: number, ts: number): void {
  const iron = ironRamp();
  const w = ts * 0.2;
  const h = ts * 0.3;
  paintGlow(ctx, cx, bottomY - h * 0.5, ts * 0.55, 0.45);
  fillOutlinedRect(
    ctx,
    cx - w / 2,
    bottomY - ts * 0.04,
    w,
    ts * 0.04,
    sampleRamp(iron, 0.4),
    ts * 0.7,
  );
  ctx.fillStyle = rgba(FLAME_CORE, 0.85);
  ctx.fillRect(cx - w * 0.38, bottomY - h, w * 0.76, h - ts * 0.04);
  ctx.fillStyle = rgb(FLAME_MID);
  ctx.beginPath();
  ctx.ellipse(cx, bottomY - h * 0.45, w * 0.12, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.35));
  ctx.lineWidth = ts * 0.025;
  for (const dx of [-0.4, 0, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(cx + w * dx, bottomY - h);
    ctx.lineTo(cx + w * dx, bottomY - ts * 0.04);
    ctx.stroke();
  }
  ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.55, bottomY - h);
  ctx.lineTo(cx, bottomY - h - ts * 0.1);
  ctx.lineTo(cx + w * 0.55, bottomY - h);
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, ts * 0.7);
  ctx.strokeStyle = rgb(sampleRamp(iron, 0.4));
  ctx.lineWidth = ts * 0.02;
  ctx.beginPath();
  ctx.arc(cx, bottomY - h - ts * 0.13, ts * 0.04, 0, Math.PI * 2);
  ctx.stroke();
  rectPath(ctx, cx - w / 2, bottomY - h, w, h);
  inkOutline(ctx, ts * 0.8);
}

function paintFoldedTunics(ctx: Ctx, cx: number, bottomY: number, ts: number): void {
  const leather = clothRamp();
  const w = ts * 0.44;
  const layerH = ts * 0.06;
  for (let i = 0; i < 4; i++) {
    const y = bottomY - (i + 1) * layerH;
    const shade = i % 2 === 0 ? 0.42 : 0.52;
    ctx.fillStyle = rgb(sampleRamp(leather, shade));
    rectPath(ctx, cx - w / 2 + (i % 2) * ts * 0.02, y, w, layerH);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  }
}

/**
 * The quartermaster's counter: five sections of heavy planked front and a
 * thick top, iron-strapped, and on it everything a signing-out needs — the
 * issue book open at today's page with its quill chained to a staple, a
 * tally slate, a stack of folded garrison tunics with a helm on it, a bundle
 * of arrows, a strongbox, and a lantern at the end. Only the north-west tile
 * carries the `counter` anchor: one counter, one quartermaster behind it.
 */
export function paintIssueCounter(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    contactShadow(ctx, frame, 0.48, 0.4);

    const frontTop = box.bottom - ts * 0.62;
    const frontBottom = box.bottom - ts * 0.04;
    const topY = frontTop - ts * 0.3;
    const left = box.left + ts * 0.03;
    const right = box.right - ts * 0.03;

    // Top slab seen from above.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.66));
    rectPath(ctx, left, topY, right - left, frontTop - topY);
    ctx.fill();
    paintPlankBoard(ctx, left, topY, right - left, frontTop - topY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.15,
      ramp: wood,
    });
    ctx.fillStyle = rgba(sampleRamp(wood, 0.95), 0.25);
    ctx.fillRect(left, topY, right - left, frontTop - topY);
    rectPath(ctx, left, topY, right - left, frontTop - topY);
    inkOutline(ctx, ts);

    // Front: vertical boards, a lit lip, sections split by posts, iron straps.
    paintPlankBoard(ctx, left, frontTop, right - left, frontBottom - frontTop, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.2,
      ramp: wood,
    });
    ctx.fillStyle = rgba(TARGET_BLACK, 0.28);
    ctx.fillRect(left, frontTop, right - left, frontBottom - frontTop);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.8));
    ctx.fillRect(left, frontTop, right - left, ts * 0.05);
    const sections = frame.footprintW;
    for (let s = 0; s <= sections; s++) {
      const px = Math.min(right - ts * 0.08, Math.max(left, box.left + s * ts - ts * 0.04));
      fillOutlinedRect(
        ctx,
        px,
        frontTop,
        ts * 0.08,
        frontBottom - frontTop,
        sampleRamp(wood, 0.38),
        ts * 0.6,
      );
    }
    for (const t of [0.3, 0.75]) {
      const y = frontTop + (frontBottom - frontTop) * t;
      ctx.fillStyle = rgb(sampleRamp(iron, 0.45));
      ctx.fillRect(left, y, right - left, ts * 0.04);
      ctx.fillStyle = rgb(sampleRamp(iron, 0.85));
      for (let s = 0; s < sections; s++) {
        for (const dx of [0.25, 0.75]) {
          ctx.beginPath();
          ctx.arc(box.left + (s + dx) * ts, y + ts * 0.02, ts * 0.012, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    rectPath(ctx, left, frontTop, right - left, frontBottom - frontTop);
    inkOutline(ctx, ts);

    // Goods on the top, one group per section, west to east.
    const surfaceY = frontTop - ts * 0.04;
    paintOpenLedger(ctx, box.left + ts * 0.5, topY + ts * 0.04, ts, forkRng(rng));
    // Inkwell and the chained quill.
    const inkX = box.left + ts * 0.92;
    fillOutlinedRect(
      ctx,
      inkX - ts * 0.05,
      surfaceY - ts * 0.1,
      ts * 0.1,
      ts * 0.1,
      TARGET_BLACK,
      ts * 0.6,
    );
    ctx.strokeStyle = rgb(TARGET_WHITE);
    ctx.lineWidth = ts * 0.02;
    ctx.beginPath();
    ctx.moveTo(inkX, surfaceY - ts * 0.08);
    ctx.quadraticCurveTo(
      inkX + ts * 0.08,
      surfaceY - ts * 0.3,
      inkX + ts * 0.02,
      surfaceY - ts * 0.38,
    );
    ctx.stroke();
    ctx.strokeStyle = rgba(sampleRamp(iron, 0.7), 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.012);
    ctx.setLineDash([ts * 0.02, ts * 0.015]);
    ctx.beginPath();
    ctx.moveTo(inkX, surfaceY - ts * 0.05);
    ctx.quadraticCurveTo(
      inkX - ts * 0.15,
      surfaceY + ts * 0.02,
      inkX - ts * 0.25,
      surfaceY - ts * 0.01,
    );
    ctx.stroke();
    ctx.setLineDash([]);

    paintTallySlate(ctx, box.left + ts * 1.2, topY + ts * 0.05, ts * 0.5, ts * 0.2, ts);

    paintFoldedTunics(ctx, box.left + ts * 2.5, surfaceY, ts);
    paintHelm(ctx, box.left + ts * 2.5, surfaceY - ts * 0.34, ts * 0.12, false, ts);

    // A bundle of arrows, tied, lying along the counter.
    const arrowY = surfaceY - ts * 0.08;
    for (let i = 0; i < 6; i++) {
      const y = arrowY - i * ts * 0.028;
      ctx.strokeStyle = rgba(TARGET_BLACK, 0.8);
      ctx.lineWidth = Math.max(2, ts * 0.04);
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 3.08, y);
      ctx.lineTo(box.left + ts * 3.62, y - ts * 0.04);
      ctx.stroke();
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.8 + (i % 2) * 0.1));
      ctx.lineWidth = Math.max(1, ts * 0.022);
      ctx.beginPath();
      ctx.moveTo(box.left + ts * 3.08, y);
      ctx.lineTo(box.left + ts * 3.62, y - ts * 0.04);
      ctx.stroke();
    }
    fillOutlinedRect(
      ctx,
      box.left + ts * 3.02,
      arrowY - ts * 0.16,
      ts * 0.12,
      ts * 0.18,
      FLETCH_GREY,
      ts * 0.5,
    );
    fillOutlinedRect(
      ctx,
      box.left + ts * 3.58,
      arrowY - ts * 0.22,
      ts * 0.08,
      ts * 0.16,
      STEEL_BRIGHT,
      ts * 0.5,
    );
    ctx.fillStyle = rgb(WAX_RED);
    ctx.fillRect(box.left + ts * 3.32, arrowY - ts * 0.19, ts * 0.05, ts * 0.2);

    // Strongbox.
    const boxX = box.left + ts * 3.72;
    fillOutlinedRect(ctx, boxX, surfaceY - ts * 0.2, ts * 0.3, ts * 0.2, sampleRamp(wood, 0.3), ts);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    ctx.fillRect(boxX, surfaceY - ts * 0.2, ts * 0.3, ts * 0.04);
    ctx.fillRect(boxX + ts * 0.13, surfaceY - ts * 0.14, ts * 0.05, ts * 0.06);

    paintLantern(ctx, box.left + ts * 4.55, surfaceY, ts);
  });
}

// ── Drill hall ────────────────────────────────────────────────────────────

/**
 * A straw man on a cross-post: a burlap torso stuffed and roped, a painted
 * bull on the chest, a sack head, straw spilling at the neck and sleeves.
 * Variant 1 has taken a season of it — leaning, one arm hanging, the bull
 * hacked open.
 */
export function paintStrawDummy(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const battered = variant === 1;
    contactShadow(ctx, frame, 0.36);
    const cx = box.centreX;
    const baseY = box.bottom - ts * 0.12;

    // Cross-foot planks.
    fillOutlinedRect(
      ctx,
      cx - ts * 0.34,
      baseY - ts * 0.03,
      ts * 0.68,
      ts * 0.07,
      sampleRamp(wood, 0.4),
      ts,
    );
    const lean = battered ? ts * 0.08 : 0;
    const topY = box.top - ts * 0.72;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.35));
    ctx.lineWidth = ts * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx + lean, topY);
    ctx.stroke();

    // Arms: a crossbar, stuffed sleeves over it.
    const shoulderY = topY + ts * 0.36;
    const armSpan = ts * 0.4;
    for (const side of [-1, 1]) {
      const hangs = battered && side > 0;
      const endX = cx + lean + side * armSpan;
      const endY = hangs ? shoulderY + ts * 0.3 : shoulderY + ts * 0.02;
      ctx.strokeStyle = rgb(BURLAP_DARK);
      ctx.lineWidth = ts * 0.13;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + lean, shoulderY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.strokeStyle = rgb(BURLAP);
      ctx.lineWidth = ts * 0.09;
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = rgb(STRAW);
      ctx.lineWidth = Math.max(1, ts * 0.018);
      for (let s = 0; s < 4; s++) {
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX + side * ts * (0.05 + jitter(rng, 0.02)), endY + ts * (s - 1.5) * 0.035);
        ctx.stroke();
      }
    }

    // Torso: a stuffed sack, roped at the waist.
    const torsoTop = shoulderY - ts * 0.06;
    const torsoW = ts * 0.44;
    const torsoH = ts * 0.58;
    const tx = cx + lean * 0.7;
    ctx.fillStyle = rgb(BURLAP);
    ctx.beginPath();
    ctx.moveTo(tx - torsoW * 0.42, torsoTop);
    ctx.quadraticCurveTo(
      tx - torsoW * 0.62,
      torsoTop + torsoH * 0.5,
      tx - torsoW * 0.4,
      torsoTop + torsoH,
    );
    ctx.lineTo(tx + torsoW * 0.4, torsoTop + torsoH);
    ctx.quadraticCurveTo(tx + torsoW * 0.62, torsoTop + torsoH * 0.5, tx + torsoW * 0.42, torsoTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(BURLAP_DARK, 0.5);
    ctx.beginPath();
    ctx.moveTo(tx + torsoW * 0.1, torsoTop);
    ctx.lineTo(tx + torsoW * 0.42, torsoTop);
    ctx.quadraticCurveTo(
      tx + torsoW * 0.62,
      torsoTop + torsoH * 0.5,
      tx + torsoW * 0.4,
      torsoTop + torsoH,
    );
    ctx.lineTo(tx + torsoW * 0.1, torsoTop + torsoH);
    ctx.closePath();
    ctx.fill();
    // Burlap weave.
    ctx.strokeStyle = rgba(BURLAP_DARK, 0.35);
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(tx - torsoW * 0.45, torsoTop + (torsoH * i) / 6);
      ctx.lineTo(tx + torsoW * 0.45, torsoTop + (torsoH * i) / 6);
      ctx.stroke();
    }
    // The bull.
    const bullY = torsoTop + torsoH * 0.38;
    const rings: readonly RGB[] = [TARGET_WHITE, TARGET_RED, TARGET_WHITE, TARGET_RED];
    for (let i = 0; i < rings.length; i++) {
      ctx.fillStyle = rgb(rings[i]);
      ctx.beginPath();
      ctx.arc(tx, bullY, ts * (0.15 - i * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
    if (battered) {
      ctx.strokeStyle = rgb(STRAW);
      ctx.lineWidth = ts * 0.03;
      ctx.beginPath();
      ctx.moveTo(tx - ts * 0.1, bullY - ts * 0.06);
      ctx.lineTo(tx + ts * 0.08, bullY + ts * 0.08);
      ctx.stroke();
    }
    // Rope belt.
    ctx.strokeStyle = rgb(STRAW_DARK);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(tx - torsoW * 0.44, torsoTop + torsoH * 0.72);
    ctx.lineTo(tx + torsoW * 0.44, torsoTop + torsoH * 0.72);
    ctx.stroke();
    // Straw at the hem.
    ctx.strokeStyle = rgb(STRAW);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (let i = 0; i < 7; i++) {
      const sx = tx - torsoW * 0.36 + (i * torsoW * 0.72) / 6;
      ctx.beginPath();
      ctx.moveTo(sx, torsoTop + torsoH - ts * 0.02);
      ctx.lineTo(sx + jitter(rng, ts * 0.03), torsoTop + torsoH + ts * 0.08);
      ctx.stroke();
    }

    // Sack head, tied at the neck.
    const headY = torsoTop - ts * 0.14;
    const hx = cx + lean;
    ctx.fillStyle = rgb(mix(BURLAP, TARGET_WHITE, 0.15));
    ctx.beginPath();
    ctx.ellipse(hx, headY, ts * 0.14, ts * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgb(TARGET_BLACK);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (const side of [-1, 1]) {
      const ex = hx + side * ts * 0.055;
      const ey = headY - ts * 0.02;
      ctx.beginPath();
      ctx.moveTo(ex - ts * 0.025, ey - ts * 0.025);
      ctx.lineTo(ex + ts * 0.025, ey + ts * 0.025);
      ctx.moveTo(ex + ts * 0.025, ey - ts * 0.025);
      ctx.lineTo(ex - ts * 0.025, ey + ts * 0.025);
      ctx.stroke();
    }
    ctx.strokeStyle = rgb(STRAW_DARK);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(hx - ts * 0.09, headY + ts * 0.13);
    ctx.lineTo(hx + ts * 0.09, headY + ts * 0.13);
    ctx.stroke();
  });
}

/**
 * A pell: a thick oak post sunk in an iron-hooped sand tub, hacked all over
 * its upper half by recruits' blades and bound with rope near the top where
 * it has started to split. Variant 1 has a waster leaning on it.
 */
export function paintPellPost(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    contactShadow(ctx, frame, 0.34);
    const cx = box.centreX;

    // Sand tub.
    const tubTop = box.bottom - ts * 0.42;
    const tubBottom = box.bottom - ts * 0.1;
    const tubW = ts * 0.56;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.36));
    ctx.beginPath();
    ctx.moveTo(cx - tubW / 2, tubTop);
    ctx.lineTo(cx + tubW / 2, tubTop);
    ctx.lineTo(cx + tubW * 0.42, tubBottom);
    ctx.lineTo(cx - tubW * 0.42, tubBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    for (const t of [0.2, 0.75]) {
      ctx.fillRect(
        cx - tubW * (0.49 - t * 0.08),
        tubTop + (tubBottom - tubTop) * t,
        tubW * (0.98 - t * 0.16),
        ts * 0.04,
      );
    }
    ctx.fillStyle = rgb(STRAW);
    ctx.beginPath();
    ctx.ellipse(cx, tubTop, tubW / 2, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);

    // The post itself.
    const postW = ts * 0.24;
    const postTop = box.top - ts * 0.62;
    const postLeft = cx - postW / 2;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.52));
    ctx.beginPath();
    ctx.moveTo(postLeft, tubTop);
    ctx.lineTo(postLeft, postTop + ts * 0.05);
    ctx.lineTo(cx, postTop - ts * 0.02);
    ctx.lineTo(postLeft + postW, postTop + ts * 0.05);
    ctx.lineTo(postLeft + postW, tubTop);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.2), 0.55);
    ctx.fillRect(
      postLeft + postW * 0.62,
      postTop + ts * 0.05,
      postW * 0.38,
      tubTop - postTop - ts * 0.05,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.45);
    ctx.fillRect(
      postLeft + postW * 0.08,
      postTop + ts * 0.06,
      postW * 0.14,
      tubTop - postTop - ts * 0.06,
    );
    // Hack marks: dark cuts with a pale lip.
    for (let i = 0; i < 9; i++) {
      const y = postTop + ts * (0.15 + ((i * 0.53) % 1) * 0.6 + jitter(rng, 0.03));
      const x = postLeft + postW * (0.15 + ((i * 0.37) % 1) * 0.6);
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.12));
      ctx.lineWidth = Math.max(1, ts * 0.018);
      ctx.beginPath();
      ctx.moveTo(x - postW * 0.14, y - dir * ts * 0.03);
      ctx.lineTo(x + postW * 0.14, y + dir * ts * 0.03);
      ctx.stroke();
      ctx.strokeStyle = rgba(sampleRamp(wood, 0.95), 0.7);
      ctx.lineWidth = Math.max(1, ts * 0.008);
      ctx.beginPath();
      ctx.moveTo(x - postW * 0.14, y - dir * ts * 0.03 + ts * 0.012);
      ctx.lineTo(x + postW * 0.14, y + dir * ts * 0.03 + ts * 0.012);
      ctx.stroke();
    }
    // Rope binding where it split.
    ctx.strokeStyle = rgb(STRAW_DARK);
    ctx.lineWidth = ts * 0.025;
    for (let i = 0; i < 3; i++) {
      const y = postTop + ts * (0.12 + i * 0.04);
      ctx.beginPath();
      ctx.moveTo(postLeft - ts * 0.01, y);
      ctx.lineTo(postLeft + postW + ts * 0.01, y + ts * 0.02);
      ctx.stroke();
    }

    if (variant === 1) {
      const bx = cx + postW * 0.9;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.72));
      ctx.beginPath();
      ctx.moveTo(bx, tubTop - ts * 0.02);
      ctx.lineTo(bx - ts * 0.1, postTop + ts * 0.2);
      ctx.lineTo(bx - ts * 0.05, postTop + ts * 0.18);
      ctx.lineTo(bx + ts * 0.05, tubTop - ts * 0.02);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.7);
      fillOutlinedRect(
        ctx,
        bx - ts * 0.06,
        tubTop - ts * 0.14,
        ts * 0.14,
        ts * 0.03,
        sampleRamp(wood, 0.3),
        ts * 0.6,
      );
    }
  });
}

/**
 * An archery butt: a thick coiled-straw boss on an A-frame, its face painted
 * in rings, with a handful of arrows in it — most of them nowhere near the
 * gold.
 */
export function paintArcheryButt(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame, 0.4);
    const cx = box.centreX;
    const bossR = ts * 0.66;
    const cy = box.bottom - ts * 0.3 - bossR;

    // A-frame legs.
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.35));
    ctx.lineWidth = ts * 0.08;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * ts * 0.62, box.bottom - ts * 0.08);
      ctx.lineTo(cx + side * ts * 0.2, cy - bossR * 0.8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.55, box.bottom - ts * 0.3);
    ctx.lineTo(cx + ts * 0.55, box.bottom - ts * 0.3);
    ctx.stroke();

    // Straw boss.
    ctx.fillStyle = rgb(STRAW);
    ctx.beginPath();
    ctx.arc(cx, cy, bossR, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.strokeStyle = rgba(STRAW_DARK, 0.6);
    ctx.lineWidth = Math.max(1, ts * 0.015);
    for (let r = bossR * 0.92; r > bossR * 0.7; r -= ts * 0.05) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Painted face.
    const faces: readonly RGB[] = [
      TARGET_WHITE,
      TARGET_BLACK,
      sampleRamp(clothRamp(), 0.55),
      TARGET_RED,
      TARGET_GOLD,
    ];
    const faceR = bossR * 0.7;
    for (let i = 0; i < faces.length; i++) {
      ctx.fillStyle = rgb(faces[i]);
      ctx.beginPath();
      ctx.arc(cx, cy, faceR * (1 - i * 0.19), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
    inkOutline(ctx, ts * 0.6);
    // Shading on the lower right of the boss.
    ctx.fillStyle = rgba(STRAW_DARK, 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, bossR, -Math.PI * 0.1, Math.PI * 0.75);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();

    // Arrows: shaft stubs and fletching standing out of the face.
    const hits: ReadonlyArray<readonly [number, number]> = [
      [-0.5, -0.35],
      [0.55, 0.1],
      [0.1, 0.5],
      [-0.2, 0.05],
      [0.35, -0.55],
    ];
    for (const [hx, hy] of hits) {
      const x = cx + bossR * hx + jitter(rng, ts * 0.02);
      const y = cy + bossR * hy;
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.62));
      ctx.lineWidth = Math.max(1, ts * 0.022);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - ts * 0.08, y + ts * 0.14);
      ctx.stroke();
      ctx.fillStyle = rgb(FLETCH_GREY);
      ctx.beginPath();
      ctx.moveTo(x - ts * 0.08, y + ts * 0.14);
      ctx.lineTo(x - ts * 0.13, y + ts * 0.12);
      ctx.lineTo(x - ts * 0.11, y + ts * 0.2);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.4);
    }
  });
}

/**
 * The drill sergeant's scoring slate on the wall, chalked in columns of
 * names and tallies with one row rubbed out, over a chalk ledge — and at its
 * foot the sand rake and the bucket, because the sand is raked before
 * anyone hits anything.
 */
export function paintDrillSlate(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const slate = slateRamp();
    contactShadow(ctx, frame, 0.4, 0.26);
    const left = box.left + ts * 0.12;
    const right = box.right - ts * 0.12;
    const top = box.top - ts * 0.82;
    const bottom = box.top + ts * 0.2;
    fillOutlinedRect(
      ctx,
      left - ts * 0.06,
      top - ts * 0.06,
      right - left + ts * 0.12,
      bottom - top + ts * 0.12,
      sampleRamp(wood, 0.45),
      ts,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.5);
    ctx.fillRect(left - ts * 0.06, top - ts * 0.06, right - left + ts * 0.12, ts * 0.025);
    fillOutlinedRect(ctx, left, top, right - left, bottom - top, sampleRamp(slate, 0.15), ts * 0.6);
    // Chalk dust haze.
    ctx.fillStyle = rgba(CHALK, 0.08);
    ctx.fillRect(left, top, right - left, bottom - top);
    // Header rule.
    ctx.strokeStyle = rgba(CHALK, 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.016);
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.08, top + ts * 0.14);
    ctx.lineTo(right - ts * 0.08, top + ts * 0.14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.6, top + ts * 0.06);
    ctx.lineTo(left + ts * 0.6, bottom - ts * 0.06);
    ctx.stroke();
    const rows = 5;
    for (let row = 0; row < rows; row++) {
      const y = top + ts * (0.24 + row * 0.15);
      // A name scribble.
      ctx.lineWidth = Math.max(1, ts * 0.012);
      ctx.beginPath();
      ctx.moveTo(left + ts * 0.08, y);
      for (let k = 1; k <= 6; k++) {
        ctx.lineTo(left + ts * (0.08 + k * 0.07), y + (k % 2 === 0 ? -1 : 1) * ts * 0.018);
      }
      ctx.stroke();
      // Tallies.
      const count = 3 + Math.floor(Math.abs(jitter(rng, 1)) * 9);
      for (let t = 0; t < count; t++) {
        const tx = left + ts * (0.7 + t * 0.07 + Math.floor(t / 5) * 0.05);
        ctx.beginPath();
        ctx.moveTo(tx, y - ts * 0.05);
        ctx.lineTo(tx, y + ts * 0.04);
        ctx.stroke();
      }
      if (row === 3) {
        ctx.strokeStyle = rgba(CHALK, 0.5);
        ctx.lineWidth = ts * 0.05;
        ctx.beginPath();
        ctx.moveTo(left + ts * 0.05, y);
        ctx.lineTo(right - ts * 0.08, y);
        ctx.stroke();
        ctx.strokeStyle = rgba(CHALK, 0.9);
      }
    }
    // Chalk ledge.
    fillOutlinedRect(ctx, left, bottom, right - left, ts * 0.06, sampleRamp(wood, 0.6), ts * 0.7);
    ctx.fillStyle = rgb(CHALK);
    ctx.fillRect(left + ts * 0.3, bottom - ts * 0.03, ts * 0.1, ts * 0.03);

    // Sand rake leaning on the wall.
    const rakeX = box.left + ts * 0.3;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.6));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(rakeX, box.bottom - ts * 0.14);
    ctx.lineTo(rakeX + ts * 0.18, bottom + ts * 0.08);
    ctx.stroke();
    fillOutlinedRect(
      ctx,
      rakeX - ts * 0.2,
      box.bottom - ts * 0.18,
      ts * 0.4,
      ts * 0.06,
      sampleRamp(wood, 0.4),
      ts * 0.7,
    );
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.3));
    ctx.lineWidth = Math.max(1, ts * 0.018);
    for (let i = 0; i < 6; i++) {
      const x = rakeX - ts * 0.18 + i * ts * 0.072;
      ctx.beginPath();
      ctx.moveTo(x, box.bottom - ts * 0.12);
      ctx.lineTo(x, box.bottom - ts * 0.07);
      ctx.stroke();
    }

    // A pail of chalk-water.
    const pailX = box.right - ts * 0.45;
    const pailTop = box.bottom - ts * 0.4;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.beginPath();
    ctx.moveTo(pailX - ts * 0.16, pailTop);
    ctx.lineTo(pailX + ts * 0.16, pailTop);
    ctx.lineTo(pailX + ts * 0.12, box.bottom - ts * 0.08);
    ctx.lineTo(pailX - ts * 0.12, box.bottom - ts * 0.08);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(ironRamp(), 0.5));
    ctx.fillRect(pailX - ts * 0.15, pailTop + ts * 0.08, ts * 0.3, ts * 0.03);
    ctx.fillStyle = rgb(mix(WATER_DEEP, CHALK, 0.4));
    ctx.beginPath();
    ctx.ellipse(pailX, pailTop, ts * 0.15, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  });
}

/** A staved water trough for the sand, iron-hooped, with a tin dipper hung on the rim and the sand darkened where it slops. */
export function paintWaterTrough(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const iron = ironRamp();
    // Wet sand under and around it.
    ctx.fillStyle = rgba(sampleRamp(wood, 0.2), 0.22);
    ctx.beginPath();
    ctx.ellipse(
      box.centreX,
      box.bottom - ts * 0.16,
      box.width * 0.48,
      ts * 0.18,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    contactShadow(ctx, frame, 0.46);
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const rimY = box.bottom - ts * 0.42;
    const bottom = box.bottom - ts * 0.1;
    // Back rim, then the water seen from above, open and catching the light.
    const backY = rimY - ts * 0.42;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    rectPath(ctx, left, backY, right - left, rimY - backY);
    ctx.fill();
    inkOutline(ctx, ts);
    const waterGradient = ctx.createLinearGradient(0, backY, 0, rimY);
    waterGradient.addColorStop(0, rgb(WATER_DEEP));
    waterGradient.addColorStop(1, rgb(mix(WATER_DEEP, WATER_LIGHT, 0.55)));
    ctx.fillStyle = waterGradient;
    ctx.fillRect(
      left + ts * 0.07,
      backY + ts * 0.07,
      right - left - ts * 0.14,
      rimY - backY - ts * 0.07,
    );
    ctx.fillStyle = rgba(WATER_LIGHT, 0.85);
    ctx.fillRect(left + ts * 0.25, backY + ts * 0.14, (right - left) * 0.3, ts * 0.025);
    ctx.fillRect(left + (right - left) * 0.55, backY + ts * 0.24, (right - left) * 0.22, ts * 0.02);
    // Front staves.
    paintPlankBoard(ctx, left, rimY, right - left, bottom - rimY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.16,
      ramp: wood,
    });
    ctx.fillStyle = rgba(sampleRamp(wood, 0.95), 0.4);
    ctx.fillRect(left, rimY, right - left, ts * 0.04);
    rectPath(ctx, left, rimY, right - left, bottom - rimY);
    inkOutline(ctx, ts);
    for (const t of [0.12, 0.88]) {
      fillOutlinedRect(
        ctx,
        left + (right - left) * t - ts * 0.04,
        rimY - ts * 0.02,
        ts * 0.08,
        bottom - rimY + ts * 0.02,
        sampleRamp(iron, 0.45),
        ts * 0.6,
      );
    }
    // Dipper on the rim.
    const dx = right - ts * 0.45;
    ctx.strokeStyle = rgb(STEEL_DIM);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.moveTo(dx, rimY - ts * 0.02);
    ctx.lineTo(dx + ts * 0.14, rimY + ts * 0.16);
    ctx.stroke();
    ctx.fillStyle = rgb(mix(STEEL_DIM, STEEL_BRIGHT, 0.4));
    ctx.beginPath();
    ctx.ellipse(dx + ts * 0.16, rimY + ts * 0.22, ts * 0.08, ts * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  });
}

/** Burlap sandbags stacked against the wall — ballast for the pells and a wall to rest a back on. */
export function paintSandbags(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame, 0.46);
    const bagW = ts * 0.5;
    const bagH = ts * 0.24;
    const rows: ReadonlyArray<number> = variant === 0 ? [3, 3, 2] : [3, 2, 1];
    let y = box.bottom - ts * 0.1 - bagH;
    for (let r = 0; r < rows.length; r++) {
      const count = rows[r];
      const rowW = count * bagW;
      const startX = box.centreX - rowW / 2 + (r % 2) * ts * 0.05;
      for (let i = 0; i < count; i++) {
        const x = startX + i * bagW + jitter(rng, ts * 0.02);
        const tone = mix(BURLAP, BURLAP_DARK, 0.15 + Math.abs(jitter(rng, 0.25)));
        ctx.fillStyle = rgb(tone);
        ctx.beginPath();
        ctx.ellipse(x + bagW / 2, y + bagH / 2, bagW * 0.52, bagH * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.8);
        ctx.fillStyle = rgba(TARGET_WHITE, 0.18);
        ctx.beginPath();
        ctx.ellipse(x + bagW * 0.4, y + bagH * 0.3, bagW * 0.3, bagH * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        // Tie ear.
        ctx.fillStyle = rgb(BURLAP_DARK);
        ctx.beginPath();
        ctx.moveTo(x + bagW * 0.98, y + bagH * 0.4);
        ctx.lineTo(x + bagW * 1.08, y + bagH * 0.2);
        ctx.lineTo(x + bagW * 1.08, y + bagH * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      y -= bagH * 0.78;
    }
  });
}

// ── Muster hall ───────────────────────────────────────────────────────────

/**
 * A two-high bunk seen from the side: post frame, a lower and an upper berth
 * with ticking mattresses and blue-grey blankets, a ladder at the foot and a
 * kit bag stowed on top. Variant 1 is an unclaimed bunk — the upper mattress
 * rolled and tied, the lower one bare.
 */
export function paintBunkBed(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    const unclaimed = variant === 1;
    contactShadow(ctx, frame, 0.48, 0.38);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const floorY = box.bottom - ts * 0.08;
    const lowerY = box.bottom - ts * 0.42;
    const upperY = lowerY - ts * 0.82;
    const postW = ts * 0.09;

    // Back posts (behind everything).
    for (const px of [left + ts * 0.1, right - ts * 0.1 - postW]) {
      fillOutlinedRect(
        ctx,
        px,
        upperY - ts * 0.36,
        postW * 0.8,
        lowerY - upperY + ts * 0.36,
        sampleRamp(wood, 0.25),
        ts * 0.6,
      );
    }

    const paintBerth = (y: number, made: boolean, rolled: boolean): void => {
      // Mattress top surface seen from above-front.
      const mTop = y - ts * 0.26;
      if (rolled) {
        ctx.fillStyle = rgb(TICKING);
        ctx.beginPath();
        ctx.ellipse(left + ts * 0.5, y - ts * 0.12, ts * 0.22, ts * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
        ctx.strokeStyle = rgb(STRAW_DARK);
        ctx.lineWidth = ts * 0.02;
        ctx.beginPath();
        ctx.moveTo(left + ts * 0.42, y - ts * 0.26);
        ctx.lineTo(left + ts * 0.42, y + ts * 0.02);
        ctx.stroke();
        // Bare slats.
        ctx.strokeStyle = rgb(sampleRamp(wood, 0.5));
        ctx.lineWidth = ts * 0.035;
        for (let i = 0; i < 6; i++) {
          const x = left + ts * (0.8 + i * 0.18);
          ctx.beginPath();
          ctx.moveTo(x, mTop + ts * 0.06);
          ctx.lineTo(x, y - ts * 0.02);
          ctx.stroke();
        }
      } else {
        fillOutlinedRect(
          ctx,
          left + ts * 0.08,
          mTop,
          right - left - ts * 0.16,
          ts * 0.24,
          TICKING,
          ts * 0.7,
        );
        ctx.strokeStyle = rgba(PAPER_SHADOW, 0.6);
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(left + ts * 0.08, mTop + i * ts * 0.06);
          ctx.lineTo(right - ts * 0.08, mTop + i * ts * 0.06);
          ctx.stroke();
        }
        if (made) {
          // Pillow at the head, blanket folded square over the rest.
          fillOutlinedRect(
            ctx,
            left + ts * 0.14,
            mTop - ts * 0.04,
            ts * 0.34,
            ts * 0.16,
            mix(TICKING, TARGET_WHITE, 0.4),
            ts * 0.6,
          );
          const blanketLeft = left + ts * 0.56;
          ctx.fillStyle = rgb(BLANKET);
          ctx.beginPath();
          ctx.moveTo(blanketLeft, mTop - ts * 0.02);
          ctx.lineTo(right - ts * 0.1, mTop - ts * 0.02);
          ctx.lineTo(right - ts * 0.1, y + ts * 0.02);
          ctx.lineTo(blanketLeft, y + ts * 0.02);
          ctx.closePath();
          ctx.fill();
          inkOutline(ctx, ts * 0.7);
          ctx.fillStyle = rgb(BLANKET_LIGHT);
          ctx.fillRect(blanketLeft, mTop - ts * 0.02, right - blanketLeft - ts * 0.1, ts * 0.05);
          ctx.strokeStyle = rgba(TARGET_WHITE, 0.55);
          ctx.lineWidth = Math.max(1, ts * 0.015);
          ctx.beginPath();
          ctx.moveTo(blanketLeft + ts * 0.08, mTop + ts * 0.1);
          ctx.lineTo(right - ts * 0.18, mTop + ts * 0.1);
          ctx.stroke();
        }
      }
      // Side rail in front of the mattress.
      fillOutlinedRect(ctx, left, y, right - left, ts * 0.1, sampleRamp(wood, 0.45), ts);
      ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.5);
      ctx.fillRect(left, y, right - left, ts * 0.025);
    };

    paintBerth(lowerY, !unclaimed, false);
    // The upper berth's underside shadows the lower one.
    ctx.fillStyle = rgba(TARGET_BLACK, 0.25);
    ctx.fillRect(left + ts * 0.08, upperY + ts * 0.1, right - left - ts * 0.16, ts * 0.22);
    paintBerth(upperY, !unclaimed, unclaimed);

    // Front posts.
    for (const px of [left, right - postW]) {
      fillOutlinedRect(
        ctx,
        px,
        upperY - ts * 0.3,
        postW,
        floorY - upperY + ts * 0.3,
        sampleRamp(wood, 0.4),
        ts,
      );
      ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.5);
      ctx.fillRect(px, upperY - ts * 0.3, postW * 0.3, floorY - upperY + ts * 0.3);
    }
    // Ladder at the foot.
    const ladderX = right - ts * 0.34;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.55));
    ctx.lineWidth = ts * 0.035;
    for (const dx of [0, ts * 0.18]) {
      ctx.beginPath();
      ctx.moveTo(ladderX + dx, upperY - ts * 0.02);
      ctx.lineTo(ladderX + dx + ts * 0.03, floorY);
      ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const y = upperY + ((floorY - upperY) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(ladderX, y);
      ctx.lineTo(ladderX + ts * 0.2, y);
      ctx.stroke();
    }
    if (!unclaimed) {
      // A kit bag on the top, strap hanging.
      const bagX = left + ts * 0.95;
      const bagY = upperY - ts * 0.34;
      ctx.fillStyle = rgb(mix(BURLAP, sampleRamp(clothRamp(), 0.4), 0.4));
      ctx.beginPath();
      ctx.ellipse(bagX, bagY, ts * 0.22, ts * 0.12, jitter(rng, 0.1), 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgb(sampleRamp(wood, 0.2));
      ctx.lineWidth = ts * 0.025;
      ctx.beginPath();
      ctx.moveTo(bagX + ts * 0.1, bagY);
      ctx.quadraticCurveTo(bagX + ts * 0.2, bagY + ts * 0.3, bagX + ts * 0.26, upperY + ts * 0.12);
      ctx.stroke();
    }
  });
}

function paintPinnedSheet(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  tilt: number,
  ts: number,
  rng: Rng,
  sealed: boolean,
): void {
  ctx.save();
  ctx.translate(x + w / 2, y);
  ctx.rotate(tilt);
  ctx.fillStyle = rgb(mix(PAPER, PAPER_SHADOW, Math.abs(jitter(rng, 0.4))));
  rectPath(ctx, -w / 2, 0, w, h);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.strokeStyle = rgba(PAPER_INK, 0.6);
  ctx.lineWidth = Math.max(1, ts * 0.01);
  const lines = Math.max(2, Math.floor(h / (ts * 0.05)));
  for (let i = 1; i < lines; i++) {
    const len = w * (0.5 + Math.abs(jitter(rng, 0.3)));
    ctx.beginPath();
    ctx.moveTo(-w / 2 + ts * 0.03, i * ts * 0.05);
    ctx.lineTo(-w / 2 + ts * 0.03 + len * 0.8, i * ts * 0.05);
    ctx.stroke();
  }
  if (sealed) {
    ctx.fillStyle = rgb(WAX_RED);
    ctx.beginPath();
    ctx.arc(w * 0.2, h - ts * 0.05, ts * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgb(PIN_BRASS);
  ctx.beginPath();
  ctx.arc(0, ts * 0.02, ts * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The muster board: a planked board four tiles wide under a header beam,
 * its first four columns papered four sheets deep — orders, postings, the
 * longer list with the dates — and the fifth ruled through in chalk with
 * nothing pinned under it. A trestle shelf below holds blank forms and a
 * pot of pins.
 */
export function paintMusterBoard(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame, 0.46, 0.26);
    const left = box.left + ts * 0.1;
    const right = box.right - ts * 0.1;
    const top = box.top - ts * 1.05;
    const bottom = box.top + ts * 0.36;

    // Backing board and header beam.
    paintPlankBoard(ctx, left, top, right - left, bottom - top, forkRng(rng), {
      direction: 'vertical',
      boardPx: ts * 0.3,
      ramp: wood,
    });
    ctx.fillStyle = rgba(sampleRamp(wood, 0.3), 0.35);
    ctx.fillRect(left, top, right - left, bottom - top);
    rectPath(ctx, left, top, right - left, bottom - top);
    inkOutline(ctx, ts);
    const beamH = ts * 0.16;
    fillOutlinedRect(
      ctx,
      left - ts * 0.06,
      top - beamH,
      right - left + ts * 0.12,
      beamH,
      sampleRamp(wood, 0.35),
      ts,
    );
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.5);
    ctx.fillRect(left - ts * 0.06, top - beamH, right - left + ts * 0.12, ts * 0.03);
    // Painted chevron on the beam's centre, the garrison's mark.
    ctx.strokeStyle = rgb(sampleRamp(clothRamp(), 0.6));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(box.centreX - ts * 0.2, top - beamH * 0.25);
    ctx.lineTo(box.centreX, top - beamH * 0.8);
    ctx.lineTo(box.centreX + ts * 0.2, top - beamH * 0.25);
    ctx.stroke();

    const columns = 5;
    const colW = (right - left) / columns;
    const sheetW = colW * 0.8;
    for (let c = 0; c < columns; c++) {
      const cx = left + colW * c + (colW - sheetW) / 2;
      if (c === columns - 1) {
        // The fifth watch: one blank sheet and a chalk line through it.
        paintPinnedSheet(ctx, cx, top + ts * 0.1, sheetW, ts * 0.5, 0, ts, forkRng(rng), false);
        ctx.fillStyle = rgb(PAPER);
        ctx.fillRect(cx + ts * 0.03, top + ts * 0.14, sheetW - ts * 0.06, ts * 0.42);
        ctx.strokeStyle = rgba(CHALK, 0.95);
        ctx.lineWidth = ts * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx - ts * 0.02, top + ts * 0.66);
        ctx.lineTo(cx + sheetW + ts * 0.02, top + ts * 0.06);
        ctx.stroke();
        continue;
      }
      for (let layer = 0; layer < 4; layer++) {
        const sy = top + ts * (0.05 + layer * 0.3);
        const tilt = jitter(forkRng(rng), 0.07);
        const sealed = (c + layer) % 3 === 0;
        paintPinnedSheet(
          ctx,
          cx + jitter(rng, ts * 0.02),
          sy,
          sheetW,
          ts * 0.42,
          tilt,
          ts,
          forkRng(rng),
          sealed,
        );
      }
    }

    // Trestle shelf under the board.
    const shelfY = box.bottom - ts * 0.34;
    fillOutlinedRect(
      ctx,
      left + ts * 0.2,
      shelfY,
      right - left - ts * 0.4,
      ts * 0.07,
      sampleRamp(wood, 0.6),
      ts,
    );
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.3));
    ctx.lineWidth = ts * 0.05;
    for (const x of [left + ts * 0.35, right - ts * 0.35]) {
      ctx.beginPath();
      ctx.moveTo(x, shelfY + ts * 0.07);
      ctx.lineTo(x, box.bottom - ts * 0.1);
      ctx.stroke();
    }
    // Blank forms and a pin pot on the shelf.
    for (let i = 0; i < 4; i++) {
      fillOutlinedRect(
        ctx,
        left + ts * (0.5 + i * 0.015),
        shelfY - ts * (0.03 + i * 0.025),
        ts * 0.5,
        ts * 0.03,
        PAPER,
        ts * 0.4,
      );
    }
    fillOutlinedRect(
      ctx,
      right - ts * 0.9,
      shelfY - ts * 0.12,
      ts * 0.12,
      ts * 0.12,
      sampleRamp(getTownRamp('oc_clay'), 0.4),
      ts * 0.6,
    );
    ctx.fillStyle = rgb(PIN_BRASS);
    ctx.fillRect(right - ts * 0.88, shelfY - ts * 0.14, ts * 0.08, ts * 0.03);
    paintLantern(ctx, box.centreX + ts * 0.2, shelfY, ts * 0.8);
  });
}

/**
 * The briefing table: a long trestle table under a hand-drawn map of the
 * town inside its wall — streets in umber, the river in blue, the watch
 * posts pinned in red and the empty ones pinned in nothing — held flat at
 * the corners by a dagger, a whetstone, a tankard and a candle.
 */
export function paintBriefingTable(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = woodRamp();
    contactShadow(ctx, frame, 0.46, 0.38);
    const left = box.left + ts * 0.05;
    const right = box.right - ts * 0.05;
    const topY = box.bottom - ts * 1.02;
    const edgeY = box.bottom - ts * 0.5;
    const apronH = ts * 0.1;

    // Trestle legs.
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.3));
    ctx.lineWidth = ts * 0.08;
    for (const x of [left + ts * 0.35, right - ts * 0.35]) {
      ctx.beginPath();
      ctx.moveTo(x - ts * 0.18, box.bottom - ts * 0.08);
      ctx.lineTo(x, edgeY + apronH);
      ctx.lineTo(x + ts * 0.18, box.bottom - ts * 0.08);
      ctx.stroke();
    }
    ctx.lineWidth = ts * 0.05;
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.35, box.bottom - ts * 0.26);
    ctx.lineTo(right - ts * 0.35, box.bottom - ts * 0.26);
    ctx.stroke();

    // Top.
    paintPlankBoard(ctx, left, topY, right - left, edgeY - topY, forkRng(rng), {
      direction: 'horizontal',
      boardPx: ts * 0.17,
      ramp: wood,
    });
    rectPath(ctx, left, topY, right - left, edgeY - topY);
    inkOutline(ctx, ts);
    fillOutlinedRect(ctx, left, edgeY, right - left, apronH, sampleRamp(wood, 0.36), ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.9), 0.5);
    ctx.fillRect(left, edgeY, right - left, ts * 0.02);

    // The map.
    const mapLeft = left + ts * 0.35;
    const mapRight = right - ts * 0.35;
    const mapTop = topY + ts * 0.06;
    const mapBottom = edgeY - ts * 0.05;
    ctx.fillStyle = rgb(PAPER);
    ctx.beginPath();
    ctx.moveTo(mapLeft, mapTop + ts * 0.02);
    ctx.lineTo(mapRight, mapTop);
    ctx.lineTo(mapRight - ts * 0.02, mapBottom);
    ctx.lineTo(mapLeft + ts * 0.02, mapBottom - ts * 0.01);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgba(PAPER_SHADOW, 0.5);
    ctx.fillRect(
      mapLeft + (mapRight - mapLeft) * 0.5 - ts * 0.01,
      mapTop,
      ts * 0.02,
      mapBottom - mapTop,
    );
    const mcx = (mapLeft + mapRight) / 2;
    const mcy = (mapTop + mapBottom) / 2;
    const rx = (mapRight - mapLeft) * 0.4;
    const ry = (mapBottom - mapTop) * 0.38;
    // River.
    ctx.strokeStyle = rgb(MAP_WATER);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(mapLeft + ts * 0.05, mapBottom - ts * 0.08);
    ctx.bezierCurveTo(
      mcx - rx * 0.4,
      mcy + ry * 0.2,
      mcx + rx * 0.2,
      mcy + ry * 1.2,
      mapRight - ts * 0.05,
      mcy + ry * 0.4,
    );
    ctx.stroke();
    // The wall.
    ctx.strokeStyle = rgb(MAP_WALL);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.ellipse(mcx, mcy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Streets.
    ctx.lineWidth = Math.max(1, ts * 0.012);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + jitter(rng, 0.2);
      ctx.beginPath();
      ctx.moveTo(mcx, mcy);
      ctx.lineTo(mcx + Math.cos(a) * rx, mcy + Math.sin(a) * ry);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(mcx, mcy, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Watch posts pinned on the wall line.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const px = mcx + Math.cos(a) * rx;
      const py = mcy + Math.sin(a) * ry;
      const staffed = i % 3 !== 2;
      ctx.fillStyle = rgb(staffed ? TARGET_RED : PAPER_SHADOW);
      ctx.beginPath();
      ctx.arc(px, py, ts * 0.028, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.4);
    }

    // Weights on the corners.
    // Dagger, west.
    ctx.fillStyle = rgb(mix(STEEL_DIM, STEEL_BRIGHT, 0.5));
    ctx.beginPath();
    ctx.moveTo(left + ts * 0.08, mapTop + ts * 0.14);
    ctx.lineTo(left + ts * 0.34, mapTop + ts * 0.1);
    ctx.lineTo(left + ts * 0.34, mapTop + ts * 0.16);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    fillOutlinedRect(
      ctx,
      left + ts * 0.34,
      mapTop + ts * 0.06,
      ts * 0.03,
      ts * 0.14,
      sampleRamp(ironRamp(), 0.5),
      ts * 0.5,
    );
    fillOutlinedRect(
      ctx,
      left + ts * 0.37,
      mapTop + ts * 0.1,
      ts * 0.12,
      ts * 0.05,
      sampleRamp(wood, 0.25),
      ts * 0.5,
    );
    // Whetstone, south-west.
    fillOutlinedRect(
      ctx,
      left + ts * 0.1,
      mapBottom - ts * 0.12,
      ts * 0.22,
      ts * 0.08,
      sampleRamp(slateRamp(), 0.5),
      ts * 0.6,
    );
    // Tankard, east.
    const tankX = right - ts * 0.24;
    const tankBottom = mapTop + ts * 0.32;
    fillOutlinedRect(
      ctx,
      tankX - ts * 0.08,
      tankBottom - ts * 0.2,
      ts * 0.16,
      ts * 0.2,
      STEEL_DIM,
      ts * 0.7,
    );
    ctx.fillStyle = rgba(STEEL_BRIGHT, 0.6);
    ctx.fillRect(tankX - ts * 0.06, tankBottom - ts * 0.18, ts * 0.03, ts * 0.16);
    ctx.strokeStyle = rgb(STEEL_DIM);
    ctx.lineWidth = ts * 0.025;
    ctx.beginPath();
    ctx.arc(tankX + ts * 0.1, tankBottom - ts * 0.1, ts * 0.05, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // Candle, south-east, on a saucer, with its glow on the map.
    const candleX = right - ts * 0.22;
    const candleBottom = mapBottom - ts * 0.02;
    paintGlow(ctx, candleX, candleBottom - ts * 0.26, ts * 0.5, 0.4);
    ctx.fillStyle = rgb(sampleRamp(getTownRamp('oc_clay'), 0.45));
    ctx.beginPath();
    ctx.ellipse(candleX, candleBottom, ts * 0.1, ts * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.5);
    fillOutlinedRect(
      ctx,
      candleX - ts * 0.03,
      candleBottom - ts * 0.2,
      ts * 0.06,
      ts * 0.2,
      TARGET_WHITE,
      ts * 0.5,
    );
    ctx.fillStyle = rgb(FLAME_CORE);
    ctx.beginPath();
    ctx.ellipse(candleX, candleBottom - ts * 0.25, ts * 0.022, ts * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * The sparring ring, drawn into the sand rather than laid over it: a
 * trampled, darker oval where the bouts are fought, the rake lines that
 * circle it, a rope laid on the ground and pegged out at intervals to mark
 * the edge, and a chalked scratch-line at each end where the two fighters
 * start. Walkable, so it paints with the floor under anyone standing in it.
 */
export function paintSparringRing(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const cx = box.centreX;
    const cy = (box.top + box.bottom) / 2;
    const rx = box.width * 0.46;
    const ry = box.height * 0.44;

    // Trampled sand: darker and warmer toward the middle.
    const trampled = ctx.createRadialGradient(cx, cy, ts * 0.3, cx, cy, rx);
    trampled.addColorStop(0, rgba(STRAW_DARK, 0.45));
    trampled.addColorStop(0.75, rgba(STRAW_DARK, 0.3));
    trampled.addColorStop(1, rgba(STRAW_DARK, 0.05));
    ctx.fillStyle = trampled;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rake lines circling inside the rope.
    ctx.strokeStyle = rgba(BURLAP_DARK, 0.35);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (0.3 + k * 0.17), ry * (0.3 + k * 0.17), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Scuffs where feet have dug in.
    for (let i = 0; i < 14; i++) {
      const a = Math.abs(jitter(rng, Math.PI));
      const r = Math.abs(jitter(rng, 0.7));
      const sx = cx + Math.cos(a * 2) * rx * r;
      const sy = cy + Math.sin(a * 2) * ry * r;
      ctx.fillStyle = rgba(BURLAP_DARK, 0.3);
      ctx.beginPath();
      ctx.ellipse(sx, sy, ts * 0.12, ts * 0.05, a, 0, Math.PI * 2);
      ctx.fill();
    }

    // The rope, laid on the sand, with its shadow under it.
    ctx.strokeStyle = rgba(TARGET_BLACK, 0.35);
    ctx.lineWidth = ts * 0.07;
    ctx.beginPath();
    ctx.ellipse(cx + ts * 0.02, cy + ts * 0.03, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgb(STRAW_DARK);
    ctx.lineWidth = ts * 0.06;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(STRAW, 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.setLineDash([ts * 0.05, ts * 0.05]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pegs holding the rope down.
    const pegs = 12;
    for (let i = 0; i < pegs; i++) {
      const a = (i / pegs) * Math.PI * 2;
      const px = cx + Math.cos(a) * rx;
      const py = cy + Math.sin(a) * ry;
      ctx.fillStyle = rgb(sampleRamp(woodRamp(), 0.3));
      ctx.beginPath();
      ctx.arc(px, py, ts * 0.05, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
    }

    // Chalked scratch-lines at each end.
    ctx.strokeStyle = rgba(CHALK, 0.85);
    ctx.lineWidth = ts * 0.04;
    for (const side of [-1, 1]) {
      const lx = cx + side * rx * 0.55;
      ctx.beginPath();
      ctx.moveTo(lx, cy - ry * 0.3);
      ctx.lineTo(lx, cy + ry * 0.3);
      ctx.stroke();
    }
  });
}
