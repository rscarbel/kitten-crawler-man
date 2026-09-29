/**
 * Bespoke furniture for Old Hilda's Cottage, built as a few big composed
 * pieces rather than a scatter of small ones: the fieldstone hearth with its
 * cauldron, the jar dresser holding the two jars that are still alive, the
 * drying beam over its bench of cut stems, the worktable, the cat's
 * armchair, the book heap, the birdcage stand, her bed — plus the smaller
 * pieces that fill in around them (crocks, a stool with a mean streak, a
 * basket of foraged mushrooms, a broom worn to the nub, a stack of books).
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

function contactShadow(ctx: Ctx, frame: TownPropFrame): void {
  const box = footprintBox(frame);
  const radiusX = box.width * 0.42;
  const radiusY = frame.tileScale * 0.16;
  drawTownContactShadow(ctx, box.centreX, box.bottom - radiusY * 0.4, radiusX, radiusY, 0.32);
}

const CHARM_BONE: RGB = [214, 204, 178];
const CHARM_FEATHER: RGB = [96, 88, 74];
const CAT_BLACK: RGB = [26, 24, 26];
const CAT_EYE: RGB = [214, 186, 64];
const BOOK_COVERS: readonly RGB[] = [
  [96, 46, 42],
  [46, 66, 92],
  [64, 84, 52],
  [110, 92, 48],
];
const CAGE_IRON: RGB = [60, 56, 50];
const CAGE_BIRD: RGB = [206, 170, 88];
const BROOM_STRAW: RGB = [188, 160, 78];
const MUSHROOM_CAP: readonly RGB[] = [
  [156, 62, 48],
  [180, 118, 74],
];
const MUSHROOM_GILL: RGB = [232, 220, 196];
const CANDLE_WAX: RGB = [224, 210, 176];
const CANDLE_FLAME: RGB = [244, 186, 94];
const MORTAR_STONE: RGB = [138, 130, 118];

/** A leaning stack of books, none the same colour or thickness. */
export function paintBookStack(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const bookCount = 4;
    let y = box.bottom;
    for (let i = 0; i < bookCount; i++) {
      const h = frame.tileScale * (0.07 + jitter(forkRng(rng), 0.015));
      const w = box.width * (0.55 - i * 0.02 + jitter(forkRng(rng), 0.04));
      const lean = jitter(forkRng(rng), frame.tileScale * 0.02) * (i % 2 === 0 ? 1 : -1);
      const x0 = box.centreX - w / 2 + lean;
      ctx.fillStyle = rgb(BOOK_COVERS[(i + variant) % BOOK_COVERS.length]);
      ctx.beginPath();
      ctx.rect(x0, y - h, w, h);
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
      y -= h;
    }
  });
}

/**
 * A stool patched one time too many — the same silhouette as the shared
 * `stool`, but with a visible repair band and a lighter, thicker seat: a
 * pale patched-wood tone reads against Hilda's dark earth floor where the
 * shared stool's own darker mid-ramp tone all but disappears into it.
 */
export function paintHedgeStool(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = getTownRamp('oc_timber');
    const seatH = frame.tileScale * 0.16;
    const seatY = box.bottom - frame.tileScale * 0.32;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.72));
    ctx.beginPath();
    ctx.ellipse(box.centreX, seatY, box.width * 0.34, seatH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    const legSpread = box.width * 0.24;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.55));
    ctx.lineWidth = frame.tileScale * 0.055;
    for (const dx of [-legSpread, legSpread]) {
      ctx.beginPath();
      ctx.moveTo(box.centreX + dx, seatY);
      ctx.lineTo(box.centreX + dx * 1.1, box.bottom);
      ctx.stroke();
    }
    const bandY = seatY + frame.tileScale * (0.12 + jitter(forkRng(rng), 0.01));
    ctx.strokeStyle = rgba([196, 40, 40], 0.7);
    ctx.lineWidth = frame.tileScale * 0.025;
    ctx.beginPath();
    ctx.moveTo(box.centreX - legSpread, bandY);
    ctx.lineTo(box.centreX + legSpread, bandY);
    ctx.stroke();
  });
}

/** A worn-down broom left leaning against the wall, straw splayed from years of the same floor. */
export function paintBroom(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = getTownRamp('oc_timber');
    const lean = frame.tileScale * (0.1 + jitter(forkRng(rng), 0.02));
    const handleTopX = box.centreX - lean;
    const handleTopY = box.top + frame.tileScale * 0.1;
    const handleBottomX = box.centreX + lean * 0.3;
    const handleBottomY = box.bottom - frame.tileScale * 0.28;
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.55));
    ctx.lineWidth = frame.tileScale * 0.035;
    ctx.beginPath();
    ctx.moveTo(handleTopX, handleTopY);
    ctx.lineTo(handleBottomX, handleBottomY);
    ctx.stroke();
    inkOutline(ctx, frame.tileScale);
    const strawCount = 7;
    ctx.strokeStyle = rgb(BROOM_STRAW);
    ctx.lineWidth = frame.tileScale * 0.014;
    for (let i = 0; i < strawCount; i++) {
      const t = i / (strawCount - 1);
      const spread = (t - 0.5) * box.width * 0.5;
      ctx.beginPath();
      ctx.moveTo(handleBottomX, handleBottomY);
      ctx.lineTo(handleBottomX + spread, box.bottom);
      ctx.stroke();
    }
  });
}

/** A woven basket with foraged mushrooms piled over the rim instead of the shop's folded cloth. */
export function paintMushroomBasket(
  ctx: Ctx,
  frame: TownPropFrame,
  variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    contactShadow(ctx, frame);
    const wood = getTownRamp('oc_timber');
    const h = frame.tileScale * 0.42;
    const top = box.bottom - h;
    const topW = box.width * 0.78;
    const bottomW = box.width * 0.58;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5 + jitter(rng, 0.05)));
    ctx.beginPath();
    ctx.moveTo(box.centreX - bottomW / 2, box.bottom);
    ctx.lineTo(box.centreX - topW / 2, top);
    ctx.lineTo(box.centreX + topW / 2, top);
    ctx.lineTo(box.centreX + bottomW / 2, box.bottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, frame.tileScale);
    const mushroomCount = 4;
    for (let i = 0; i < mushroomCount; i++) {
      const mx = box.centreX + (i - (mushroomCount - 1) / 2) * (topW / mushroomCount);
      const capR = frame.tileScale * (0.06 + jitter(forkRng(rng), 0.012));
      const stemH = frame.tileScale * 0.05;
      const stemY = top - stemH + capR * 0.3;
      ctx.fillStyle = rgb(MUSHROOM_GILL);
      ctx.fillRect(mx - capR * 0.22, stemY, capR * 0.44, stemH);
      ctx.fillStyle = rgb(MUSHROOM_CAP[(i + variant) % MUSHROOM_CAP.length]);
      ctx.beginPath();
      ctx.ellipse(mx, top - stemH * 0.4, capR, capR * 0.62, 0, Math.PI, 0);
      ctx.fill();
      inkOutline(ctx, frame.tileScale);
    }
  });
}

// ── The cottage's composed centrepieces ─────────────────────────────────────

/** Glass and glaze for the dresser's jars — none of the building ramps covers a dyed bottle. */
const JAR_AMBER: RGB = [176, 116, 46];
const JAR_BOTTLE_GREEN: RGB = [64, 108, 70];
const JAR_COBALT: RGB = [50, 72, 138];
const JAR_PLUM: RGB = [110, 56, 92];
const JAR_MILK: RGB = [204, 196, 172];
const JAR_CLAY: RGB = [138, 84, 58];
const JAR_SLIME: RGB = [120, 138, 58];
const JAR_COLORS: readonly RGB[] = [
  JAR_AMBER,
  JAR_BOTTLE_GREEN,
  JAR_COBALT,
  JAR_PLUM,
  JAR_MILK,
  JAR_CLAY,
  JAR_SLIME,
];
/** The two jars that are "still alive" — a light from inside the glass, one green and one violet. */
const ALIVE_GREEN: RGB = [150, 236, 120];
const ALIVE_VIOLET: RGB = [196, 136, 246];
const BONE: RGB = [224, 214, 188];
const BONE_SHADOW: RGB = [160, 148, 122];
const CORK: RGB = [150, 112, 70];
const JAR_CLOTH_LID: RGB = [186, 164, 120];
const GLASS_SHINE: RGB = [236, 240, 232];
/** The cauldron's brew: a green no stew ever was. */
const BREW_DEEP: RGB = [44, 92, 40];
const BREW_BODY: RGB = [92, 162, 64];
const BREW_BRIGHT: RGB = [196, 240, 136];
const STEAM: RGB = [214, 224, 206];
const FIRE_CORE: RGB = [255, 222, 140];
const FIRE_MID: RGB = [236, 130, 48];
const FIRE_EDGE: RGB = [132, 48, 22];
const SOOT: RGB = [28, 22, 20];
/** Smoke-browned hearth stone — the tint years of a cottage fire leave on grey rock. */
const HEARTH_SMOKE: RGB = [92, 64, 46];
/** Drying herbs: sage, lavender, tansy, rosehip and a garlic plait — each a different silhouette as well as colour. */
const HERB_SAGE: RGB = [108, 140, 90];
const HERB_SAGE_DARK: RGB = [62, 88, 56];
const HERB_LAVENDER: RGB = [140, 112, 176];
const HERB_TANSY: RGB = [214, 176, 56];
const HERB_ROSEHIP: RGB = [178, 56, 40];
const HERB_GARLIC: RGB = [232, 222, 200];
const HERB_TWINE: RGB = [150, 122, 80];
/** Armchair upholstery, a worn bottle-green velvet, and the shawl knitted over its back. */
const UPHOLSTERY_DARK: RGB = [40, 60, 44];
const UPHOLSTERY_BODY: RGB = [66, 98, 70];
const UPHOLSTERY_LIGHT: RGB = [104, 140, 100];
const SHAWL_BODY: RGB = [186, 128, 58];
const SHAWL_STRIPE: RGB = [132, 50, 44];
const PAGE: RGB = [226, 214, 184];
const PAGE_SHADOW: RGB = [178, 162, 128];
const PAGE_INK: RGB = [92, 76, 62];

/** A soft additive bloom — the only way a glow reads as light rather than a paler fill. */
function paintBloom(ctx: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number) {
  const bloom = ctx.createRadialGradient(x, y, 1, x, y, radius);
  bloom.addColorStop(0, rgba(color, alpha));
  bloom.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

type ShelfItemKind = 'round' | 'tall' | 'squat' | 'bottle' | 'skull' | 'bones' | 'alive';

/**
 * One jar or curio standing on a shelf at `(x, baseY)`. Every kind has its
 * own silhouette — a jar is told from a bottle by its neck, not its colour —
 * and every glass kind carries one bright shine stroke on the lit (west)
 * side so a row of them reads as glass at 32 px.
 */
function paintShelfItem(
  ctx: Ctx,
  kind: ShelfItemKind,
  x: number,
  baseY: number,
  size: number,
  color: RGB,
  ts: number,
): void {
  const outline = ts * 0.55;
  if (kind === 'skull') {
    const r = size * 0.42;
    const cy = baseY - r * 1.05;
    ctx.fillStyle = rgb(BONE);
    ctx.beginPath();
    ctx.arc(x, cy, r, Math.PI * 0.9, Math.PI * 2.1);
    ctx.lineTo(x + r * 0.62, baseY);
    ctx.lineTo(x - r * 0.62, baseY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, outline);
    ctx.fillStyle = rgb(SOOT);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + side * r * 0.36, cy + r * 0.12, r * 0.22, r * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x, cy + r * 0.42);
    ctx.lineTo(x - r * 0.1, cy + r * 0.62);
    ctx.lineTo(x + r * 0.1, cy + r * 0.62);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'bones') {
    ctx.strokeStyle = rgb(BONE);
    ctx.lineCap = 'round';
    for (const tilt of [-0.5, 0.35]) {
      const len = size * 1.1;
      const cx = x;
      const cy = baseY - size * 0.18;
      const dx = Math.cos(tilt) * len * 0.5;
      const dy = Math.sin(tilt) * len * 0.18;
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = rgb(BONE_SHADOW);
      ctx.beginPath();
      ctx.moveTo(cx - dx, cy - dy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.stroke();
      ctx.lineWidth = size * 0.13;
      ctx.strokeStyle = rgb(BONE);
      ctx.stroke();
      ctx.fillStyle = rgb(BONE);
      for (const end of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + end * dx, cy + end * dy, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.lineCap = 'butt';
    return;
  }
  const w =
    kind === 'squat'
      ? size * 0.95
      : kind === 'tall' || kind === 'bottle'
        ? size * 0.5
        : size * 0.72;
  const h =
    kind === 'squat'
      ? size * 0.62
      : kind === 'tall'
        ? size * 1.35
        : kind === 'bottle'
          ? size * 1.25
          : size * 0.95;
  const top = baseY - h;
  const glassColor = kind === 'alive' ? color : color;
  if (kind === 'alive') paintBloom(ctx, x, baseY - h * 0.5, size * 1.4, color, 0.55);
  ctx.fillStyle = rgb(kind === 'alive' ? mix(color, [255, 255, 255], 0.15) : glassColor);
  ctx.beginPath();
  if (kind === 'bottle') {
    const neckW = w * 0.3;
    const shoulderY = top + h * 0.45;
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, shoulderY);
    ctx.quadraticCurveTo(x - w / 2, shoulderY - h * 0.15, x - neckW / 2, shoulderY - h * 0.2);
    ctx.lineTo(x - neckW / 2, top);
    ctx.lineTo(x + neckW / 2, top);
    ctx.lineTo(x + neckW / 2, shoulderY - h * 0.2);
    ctx.quadraticCurveTo(x + w / 2, shoulderY - h * 0.15, x + w / 2, shoulderY);
    ctx.lineTo(x + w / 2, baseY);
  } else {
    const r = Math.min(w, h) * 0.3;
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, top + r);
    ctx.quadraticCurveTo(x - w / 2, top, x - w / 2 + r, top);
    ctx.lineTo(x + w / 2 - r, top);
    ctx.quadraticCurveTo(x + w / 2, top, x + w / 2, top + r);
    ctx.lineTo(x + w / 2, baseY);
  }
  ctx.closePath();
  ctx.fill();
  inkOutline(ctx, outline);
  // Shade the unlit east half, then one shine stroke on the lit west side.
  ctx.fillStyle = rgba(SOOT, 0.22);
  ctx.fillRect(x + w * 0.12, top + h * 0.2, w * 0.36, h * 0.78);
  ctx.strokeStyle = rgba(GLASS_SHINE, kind === 'alive' ? 0.9 : 0.6);
  ctx.lineWidth = Math.max(1, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(x - w * 0.28, top + h * 0.3);
  ctx.lineTo(x - w * 0.28, baseY - h * 0.18);
  ctx.stroke();
  // Stoppers: a cork on a bottle, a tied cloth cap on a jar, a wax lid on the rest.
  if (kind === 'bottle') {
    ctx.fillStyle = rgb(CORK);
    ctx.fillRect(x - w * 0.17, top - size * 0.16, w * 0.34, size * 0.18);
  } else if (kind === 'squat' || kind === 'round') {
    ctx.fillStyle = rgb(JAR_CLOTH_LID);
    ctx.beginPath();
    ctx.ellipse(x, top + size * 0.02, w * 0.56, size * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, outline * 0.8);
    ctx.strokeStyle = rgb(HERB_TWINE);
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, top + size * 0.1);
    ctx.lineTo(x + w * 0.5, top + size * 0.1);
    ctx.stroke();
  } else {
    ctx.fillStyle = rgb(mix(glassColor, SOOT, 0.45));
    ctx.fillRect(x - w * 0.4, top - size * 0.08, w * 0.8, size * 0.1);
  }
  if (kind === 'alive') {
    // Something inside — a curled dark shape, not a clean fill.
    ctx.fillStyle = rgba(SOOT, 0.55);
    ctx.beginPath();
    ctx.ellipse(x + w * 0.05, baseY - h * 0.42, w * 0.2, h * 0.16, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Her jar dresser: a cupboard base under an open hutch of three shelves,
 * every shelf crammed with mismatched jars and bottles, a skull on the top
 * shelf, a bundle of bones on the middle one, and the two jars that are
 * still alive glowing from inside — one green, one violet, on different
 * shelves so the eye finds them separately. Three tiles wide and nearly two
 * tall, so the cottage's west corner reads as one crowded piece of
 * furniture rather than a row of jar dots.
 */
export function paintJarDresser(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const wood = getTownRamp('oc_timber');
    const inset = ts * 0.06;
    const left = box.left + inset;
    const right = box.right - inset;
    const width = right - left;
    const bottom = box.bottom - ts * 0.08;
    const baseH = ts * 0.62;
    const baseTop = bottom - baseH;
    const hutchTop = bottom - ts * 1.86;
    const corniceH = ts * 0.12;

    // Hutch carcass: a shadowed back panel between two side posts.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.22));
    ctx.fillRect(left, hutchTop, width, baseTop - hutchTop);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.12));
    ctx.fillRect(
      left + ts * 0.08,
      hutchTop + corniceH,
      width - ts * 0.16,
      baseTop - hutchTop - corniceH,
    );
    ctx.beginPath();
    ctx.rect(left, hutchTop, width, baseTop - hutchTop);
    inkOutline(ctx, ts);

    // Shelves and their contents, top shelf first so each board's lip
    // overlaps the jars standing on the shelf below it.
    const shelfCount = 3;
    const shelfSpan = (baseTop - hutchTop - corniceH) / shelfCount;
    const itemPlans: ReadonlyArray<ReadonlyArray<ShelfItemKind>> = [
      ['bottle', 'round', 'skull', 'tall', 'squat', 'bottle', 'round', 'tall'],
      ['squat', 'alive', 'bottle', 'bones', 'round', 'tall', 'bottle', 'squat'],
      ['tall', 'round', 'bottle', 'squat', 'round', 'alive', 'tall', 'bottle', 'round'],
    ];
    for (let s = 0; s < shelfCount; s++) {
      const shelfY = hutchTop + corniceH + shelfSpan * (s + 1);
      const plan = itemPlans[s];
      const slot = (width - ts * 0.2) / plan.length;
      for (let i = 0; i < plan.length; i++) {
        const kind = plan[i];
        const x = left + ts * 0.1 + slot * (i + 0.5) + jitter(rng, slot * 0.08);
        const size = ts * (0.22 + jitter(rng, 0.03));
        const aliveColor = s === 1 ? ALIVE_GREEN : ALIVE_VIOLET;
        const color =
          kind === 'alive' ? aliveColor : JAR_COLORS[(i * 3 + s * 2) % JAR_COLORS.length];
        paintShelfItem(ctx, kind, x, shelfY - ts * 0.02, size, color, ts);
      }
      ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
      ctx.fillRect(left + ts * 0.04, shelfY - ts * 0.02, width - ts * 0.08, ts * 0.06);
      ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.6);
      ctx.fillRect(left + ts * 0.04, shelfY - ts * 0.02, width - ts * 0.08, ts * 0.015);
    }

    // Side posts over the shelf ends, then the cornice cap.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.fillRect(left, hutchTop, ts * 0.08, baseTop - hutchTop);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(right - ts * 0.08, hutchTop, ts * 0.08, baseTop - hutchTop);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.55));
    ctx.fillRect(left - inset * 0.5, hutchTop - corniceH * 0.4, width + inset, corniceH);
    ctx.beginPath();
    ctx.rect(left - inset * 0.5, hutchTop - corniceH * 0.4, width + inset, corniceH);
    inkOutline(ctx, ts);

    // Cupboard base: a lit worktop edge over three plank doors.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.62));
    ctx.fillRect(left - inset * 0.5, baseTop - ts * 0.04, width + inset, ts * 0.1);
    ctx.beginPath();
    ctx.rect(left - inset * 0.5, baseTop - ts * 0.04, width + inset, ts * 0.1);
    inkOutline(ctx, ts);
    const doorCount = 3;
    const doorW = width / doorCount;
    for (let d = 0; d < doorCount; d++) {
      const dx = left + doorW * d;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.4 + jitter(rng, 0.04) - d * 0.03));
      ctx.fillRect(dx, baseTop + ts * 0.06, doorW, bottom - baseTop - ts * 0.06);
      ctx.beginPath();
      ctx.rect(dx, baseTop + ts * 0.06, doorW, bottom - baseTop - ts * 0.06);
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgba(sampleRamp(wood, 0.2), 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(
        dx + ts * 0.07,
        baseTop + ts * 0.13,
        doorW - ts * 0.14,
        bottom - baseTop - ts * 0.2,
      );
      ctx.fillStyle = rgb(sampleRamp(getTownRamp('iron_black'), 0.7));
      ctx.beginPath();
      ctx.arc(
        dx + (d === 0 ? doorW - ts * 0.1 : ts * 0.1),
        baseTop + baseH * 0.5,
        ts * 0.025,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Overflow on the worktop: a squat crock, a bottle and a candle stub.
    const worktopY = baseTop - ts * 0.04;
    paintShelfItem(ctx, 'squat', left + width * 0.14, worktopY, ts * 0.26, JAR_CLAY, ts);
    paintShelfItem(ctx, 'bottle', left + width * 0.24, worktopY, ts * 0.24, JAR_BOTTLE_GREEN, ts);
    paintCandleStub(ctx, left + width * 0.88, worktopY, ts * 0.2, ts);
  });
}

/** A short tallow candle with a wax run and a flame, glowing onto whatever it stands among. */
function paintCandleStub(ctx: Ctx, x: number, baseY: number, height: number, ts: number): void {
  const w = ts * 0.07;
  paintBloom(ctx, x, baseY - height - ts * 0.04, ts * 0.32, CANDLE_FLAME, 0.4);
  ctx.fillStyle = rgb(CANDLE_WAX);
  ctx.beginPath();
  ctx.rect(x - w / 2, baseY - height, w, height);
  ctx.fill();
  inkOutline(ctx, ts * 0.5);
  ctx.fillStyle = rgb(mix(CANDLE_WAX, [255, 255, 255], 0.3));
  ctx.beginPath();
  ctx.ellipse(x - w * 0.5, baseY - height * 0.55, w * 0.18, height * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(FIRE_CORE);
  ctx.beginPath();
  ctx.moveTo(x, baseY - height - ts * 0.11);
  ctx.quadraticCurveTo(x + w * 0.5, baseY - height - ts * 0.03, x, baseY - height);
  ctx.quadraticCurveTo(x - w * 0.5, baseY - height - ts * 0.03, x, baseY - height - ts * 0.11);
  ctx.fill();
}

/**
 * The hearth she cooks and brews at, built as one piece with its cauldron:
 * a rough stone chimney breast rising into the wall, a timber mantel with
 * its own clutter and herbs hung off its edge, a firebox glowing under a
 * fat iron cauldron that sits out on the hearthstone bubbling green, a
 * ladle left standing in the brew, steam curling up the breast, and split
 * logs stacked at one side with a poker leaning at the other. Three tiles
 * wide and two deep — the room's heart, and the thing a visitor's eye goes
 * to first.
 */
export function paintWitchHearth(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = getTownRamp('oc_timber');
    const iron = getTownRamp('iron_black');
    drawTownContactShadow(
      ctx,
      box.centreX,
      box.bottom - ts * 0.1,
      box.width * 0.46,
      ts * 0.2,
      0.32,
    );

    // Hearthstone: fieldstone flags across the front row, the cauldron's floor.
    const slabTop = box.top + ts * 0.9;
    const slabBottom = box.bottom - ts * 0.08;
    const slabLeft = box.left + ts * 0.08;
    const slabRight = box.right - ts * 0.08;
    paintFieldstone(
      ctx,
      slabLeft,
      slabTop,
      slabRight - slabLeft,
      slabBottom - slabTop,
      ts,
      forkRng(rng),
      0.8,
    );
    ctx.fillStyle = rgba(SOOT, 0.35);
    ctx.fillRect(slabLeft, slabBottom - ts * 0.08, slabRight - slabLeft, ts * 0.08);
    ctx.beginPath();
    ctx.rect(slabLeft, slabTop, slabRight - slabLeft, slabBottom - slabTop);
    inkOutline(ctx, ts);

    // Chimney breast: full width to the mantel, then a narrower stack into the wall.
    const breastLeft = box.left + ts * 0.18;
    const breastRight = box.right - ts * 0.18;
    const breastBottom = slabTop + ts * 0.04;
    const mantelY = box.top - ts * 0.08;
    const stackLeft = box.left + ts * 0.62;
    const stackRight = box.right - ts * 0.62;
    const stackTop = box.top - ts * 1.28;
    paintFieldstone(
      ctx,
      stackLeft,
      stackTop,
      stackRight - stackLeft,
      mantelY - stackTop,
      ts,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.18);
    ctx.fillRect(
      stackLeft + (stackRight - stackLeft) * 0.55,
      stackTop,
      (stackRight - stackLeft) * 0.45,
      mantelY - stackTop,
    );
    ctx.beginPath();
    ctx.rect(stackLeft, stackTop, stackRight - stackLeft, mantelY - stackTop);
    inkOutline(ctx, ts);
    paintFieldstone(
      ctx,
      breastLeft,
      mantelY,
      breastRight - breastLeft,
      breastBottom - mantelY,
      ts,
      forkRng(rng),
    );
    ctx.fillStyle = rgba(SOOT, 0.25);
    ctx.fillRect(
      breastRight - (breastRight - breastLeft) * 0.2,
      mantelY,
      (breastRight - breastLeft) * 0.2,
      breastBottom - mantelY,
    );
    ctx.beginPath();
    ctx.rect(breastLeft, mantelY, breastRight - breastLeft, breastBottom - mantelY);
    inkOutline(ctx, ts);

    // Firebox: a soot-black arch with the fire banked low inside it.
    const archLeft = box.centreX - ts * 0.78;
    const archRight = box.centreX + ts * 0.78;
    const archTop = mantelY + ts * 0.3;
    const sootHalo = ctx.createRadialGradient(
      box.centreX,
      archTop,
      1,
      box.centreX,
      archTop,
      ts * 1.1,
    );
    sootHalo.addColorStop(0, rgba(SOOT, 0.6));
    sootHalo.addColorStop(1, rgba(SOOT, 0));
    ctx.fillStyle = sootHalo;
    ctx.fillRect(breastLeft, mantelY, breastRight - breastLeft, breastBottom - mantelY);
    ctx.fillStyle = rgb(SOOT);
    ctx.beginPath();
    ctx.moveTo(archLeft, breastBottom);
    ctx.lineTo(archLeft, archTop + ts * 0.3);
    ctx.quadraticCurveTo(box.centreX, archTop - ts * 0.18, archRight, archTop + ts * 0.3);
    ctx.lineTo(archRight, breastBottom);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    const fireY = breastBottom - ts * 0.06;
    const fireGlow = ctx.createRadialGradient(box.centreX, fireY, 1, box.centreX, fireY, ts * 0.9);
    fireGlow.addColorStop(0, rgb(FIRE_CORE));
    fireGlow.addColorStop(0.45, rgba(FIRE_MID, 0.9));
    fireGlow.addColorStop(1, rgba(FIRE_EDGE, 0));
    ctx.fillStyle = fireGlow;
    ctx.beginPath();
    ctx.ellipse(box.centreX, fireY, ts * 0.72, ts * 0.5, 0, Math.PI, 0);
    ctx.fill();

    // Firelight spilling out onto the hearthstone.
    paintBloom(ctx, box.centreX, breastBottom + ts * 0.25, ts * 1.2, FIRE_MID, 0.35);

    // Mantel beam, with its clutter and the herbs hung off its front edge.
    const mantelH = ts * 0.14;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.45));
    ctx.fillRect(box.left + ts * 0.1, mantelY - mantelH * 0.5, box.width - ts * 0.2, mantelH);
    ctx.beginPath();
    ctx.rect(box.left + ts * 0.1, mantelY - mantelH * 0.5, box.width - ts * 0.2, mantelH);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.7);
    ctx.fillRect(box.left + ts * 0.1, mantelY - mantelH * 0.5, box.width - ts * 0.2, ts * 0.025);
    const mantelTop = mantelY - mantelH * 0.5;
    paintCandleStub(ctx, box.left + ts * 0.3, mantelTop, ts * 0.22, ts);
    paintShelfItem(ctx, 'skull', box.left + ts * 0.58, mantelTop, ts * 0.26, BONE, ts);
    paintShelfItem(ctx, 'bottle', box.right - ts * 0.62, mantelTop, ts * 0.24, JAR_COBALT, ts);
    paintShelfItem(ctx, 'round', box.right - ts * 0.4, mantelTop, ts * 0.22, JAR_CLAY, ts);
    paintCandleStub(ctx, box.right - ts * 0.22, mantelTop, ts * 0.16, ts);
    const hangColors: readonly RGB[] = [HERB_SAGE, HERB_LAVENDER, HERB_TANSY];
    for (let i = 0; i < hangColors.length; i++) {
      const hx = box.left + ts * (0.95 + i * 0.55);
      paintHerbBunch(ctx, hx, mantelY + mantelH * 0.5, ts * 0.3, hangColors[i], ts, forkRng(rng));
    }

    // The cauldron: squat black iron on stub legs, out on the hearthstone.
    const potW = ts * 1.3;
    const potH = ts * 0.78;
    const potBottom = box.bottom - ts * 0.2;
    const potTop = potBottom - potH;
    const potX = box.centreX;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.2));
    for (const side of [-0.32, 0, 0.32]) {
      ctx.fillRect(potX + side * potW - ts * 0.04, potBottom - ts * 0.06, ts * 0.08, ts * 0.14);
    }
    const potGrad = ctx.createLinearGradient(potX - potW / 2, 0, potX + potW / 2, 0);
    potGrad.addColorStop(0, rgb(sampleRamp(iron, 0.62)));
    potGrad.addColorStop(0.35, rgb(sampleRamp(iron, 0.4)));
    potGrad.addColorStop(1, rgb(sampleRamp(iron, 0.12)));
    ctx.fillStyle = potGrad;
    ctx.beginPath();
    ctx.moveTo(potX - potW * 0.44, potTop + potH * 0.1);
    ctx.bezierCurveTo(
      potX - potW * 0.58,
      potTop + potH * 0.55,
      potX - potW * 0.4,
      potBottom,
      potX,
      potBottom,
    );
    ctx.bezierCurveTo(
      potX + potW * 0.4,
      potBottom,
      potX + potW * 0.58,
      potTop + potH * 0.55,
      potX + potW * 0.44,
      potTop + potH * 0.1,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    // Firelight catching the pot's belly from below.
    ctx.strokeStyle = rgba(FIRE_MID, 0.75);
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.arc(potX, potTop + potH * 0.1, potW * 0.47, Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();
    ctx.strokeStyle = rgba(GLASS_SHINE, 0.35);
    ctx.lineWidth = ts * 0.03;
    ctx.beginPath();
    ctx.arc(potX, potTop + potH * 0.2, potW * 0.36, Math.PI * 0.95, Math.PI * 1.2);
    ctx.stroke();
    // Rim and the brew inside it.
    const rimY = potTop + potH * 0.1;
    ctx.fillStyle = rgb(sampleRamp(iron, 0.5));
    ctx.beginPath();
    ctx.ellipse(potX, rimY, potW * 0.47, ts * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts);
    const brew = ctx.createRadialGradient(potX - ts * 0.1, rimY, 1, potX, rimY, potW * 0.42);
    brew.addColorStop(0, rgb(BREW_BRIGHT));
    brew.addColorStop(0.5, rgb(BREW_BODY));
    brew.addColorStop(1, rgb(BREW_DEEP));
    ctx.fillStyle = brew;
    ctx.beginPath();
    ctx.ellipse(potX, rimY + ts * 0.01, potW * 0.4, ts * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    paintBloom(ctx, potX, rimY, ts * 0.8, BREW_BRIGHT, 0.3);
    const bubbleCount = 5;
    for (let i = 0; i < bubbleCount; i++) {
      const bx = potX + jitter(rng, potW * 0.3);
      const by = rimY + jitter(rng, ts * 0.05);
      const br = ts * (0.025 + Math.abs(jitter(rng, 0.018)));
      ctx.strokeStyle = rgba(BREW_BRIGHT, 0.95);
      ctx.lineWidth = Math.max(1, ts * 0.012);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Ladle left standing in the brew.
    ctx.strokeStyle = rgb(sampleRamp(wood, 0.55));
    ctx.lineWidth = ts * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(potX + ts * 0.18, rimY);
    ctx.lineTo(potX + ts * 0.5, rimY - ts * 0.5);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(TOWN_INK_SOFT, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Steam curling up in front of the breast.
    ctx.strokeStyle = rgba(STEAM, 0.45);
    ctx.lineWidth = ts * 0.05;
    ctx.lineCap = 'round';
    for (const offset of [-0.2, 0.12]) {
      const sx = potX + ts * offset;
      ctx.beginPath();
      ctx.moveTo(sx, rimY - ts * 0.05);
      ctx.bezierCurveTo(
        sx - ts * 0.16,
        rimY - ts * 0.3,
        sx + ts * 0.16,
        rimY - ts * 0.45,
        sx - ts * 0.04,
        rimY - ts * 0.72,
      );
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // Split logs stacked at the west end of the hearthstone, a poker at the east.
    const logR = ts * 0.1;
    const logBaseY = slabBottom - ts * 0.08;
    const logCentres: ReadonlyArray<readonly [number, number]> = [
      [0.26, 0],
      [0.47, 0],
      [0.36, -1.7],
    ];
    for (const [fx, row] of logCentres) {
      const lx = box.left + ts * fx;
      const ly = logBaseY - logR + row * logR;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.35));
      ctx.beginPath();
      ctx.arc(lx, ly, logR, 0, Math.PI * 2);
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.fillStyle = rgb(sampleRamp(wood, 0.78));
      ctx.beginPath();
      ctx.arc(lx - logR * 0.1, ly - logR * 0.1, logR * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(sampleRamp(wood, 0.4), 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(lx - logR * 0.1, ly - logR * 0.1, logR * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.35));
    ctx.lineWidth = ts * 0.035;
    ctx.beginPath();
    ctx.moveTo(box.right - ts * 0.3, slabBottom - ts * 0.04);
    ctx.lineTo(box.right - ts * 0.2, breastBottom - ts * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(box.right - ts * 0.2, breastBottom - ts * 0.6, ts * 0.05, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** A warm near-black for the thin lines inside a shape, softer than the silhouette ink. */
const TOWN_INK_SOFT: RGB = [40, 30, 26];

/** Fieldstone greys, warmed by smoke — no two stones in a cottage chimney are the same colour. */
const FIELDSTONE_TONES: readonly RGB[] = [
  [118, 110, 100],
  [134, 124, 110],
  [104, 98, 92],
  [146, 134, 116],
  [124, 112, 98],
];
const FIELDSTONE_MORTAR: RGB = [70, 58, 48];

/**
 * Rough fieldstone laid in uneven courses: each stone its own rounded
 * lump in its own tone, lit on its west/top edge and shaded on its east
 * and bottom, sunk in dark mortar. `scale` shrinks the stones for a floor
 * slab seen at a steeper angle.
 */
function paintFieldstone(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
  rng: Rng,
  scale = 1,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = rgb(FIELDSTONE_MORTAR);
  ctx.fillRect(x, y, w, h);
  const courseH = ts * 0.2 * scale;
  let row = 0;
  for (let cy = y; cy < y + h; cy += courseH, row++) {
    let cx = x - (row % 2) * ts * 0.12 * scale;
    while (cx < x + w) {
      const sw = ts * (0.24 + Math.abs(jitter(rng, 0.12))) * scale;
      const sh = courseH * (0.8 + jitter(rng, 0.08));
      const tone =
        FIELDSTONE_TONES[
          Math.floor(Math.abs(jitter(rng, 1)) * FIELDSTONE_TONES.length) % FIELDSTONE_TONES.length
        ];
      const sx = cx + ts * 0.015;
      const sy = cy + (courseH - sh) / 2;
      ctx.fillStyle = rgb(tone);
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw - ts * 0.03, sh, sh * 0.4);
      ctx.fill();
      ctx.fillStyle = rgba(GLASS_SHINE, 0.18);
      ctx.fillRect(sx + sh * 0.2, sy + sh * 0.1, (sw - ts * 0.03) * 0.6, sh * 0.2);
      ctx.fillStyle = rgba(SOOT, 0.28);
      ctx.fillRect(sx + sh * 0.2, sy + sh * 0.7, sw - ts * 0.03 - sh * 0.3, sh * 0.22);
      cx += sw;
    }
  }
  ctx.fillStyle = rgba(HEARTH_SMOKE, 0.22);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * One bunch of herbs hung head-down from a nail: a twine tie, then stems
 * fanning out below it, each carrying leaf ticks and a flower head at its
 * tip — a drying bunch reads by its stems, and a filled teardrop reads as
 * a gem or a pine cone instead.
 */
function paintHerbBunch(
  ctx: Ctx,
  x: number,
  hangY: number,
  length: number,
  color: RGB,
  ts: number,
  rng: Rng,
): void {
  ctx.strokeStyle = rgb(HERB_TWINE);
  ctx.lineWidth = Math.max(1, ts * 0.015);
  ctx.beginPath();
  ctx.moveTo(x, hangY);
  ctx.lineTo(x, hangY + length * 0.14);
  ctx.stroke();
  const tieY = hangY + length * 0.14;
  const spread = length * 0.42;
  const stemColor = mix(color, SOOT, 0.35);
  const stemCount = 9;
  for (let i = 0; i < stemCount; i++) {
    const t = i / (stemCount - 1) - 0.5;
    const tipX = x + t * spread + jitter(rng, ts * 0.01);
    const tipY = tieY + length * (0.8 - Math.abs(t) * 0.25 + jitter(rng, 0.04));
    ctx.strokeStyle = rgb(stemColor);
    ctx.lineWidth = Math.max(1, ts * 0.024);
    ctx.beginPath();
    ctx.moveTo(x, tieY);
    ctx.quadraticCurveTo(x + t * spread * 0.2, tieY + length * 0.3, tipX, tipY);
    ctx.stroke();
    // Leaf ticks off the stem's lower half, then its flower head.
    ctx.strokeStyle = rgb(mix(color, SOOT, 0.15));
    ctx.lineWidth = Math.max(1, ts * 0.016);
    for (const along of [0.5, 0.72]) {
      const lx = x + (tipX - x) * along;
      const ly = tieY + (tipY - tieY) * along;
      const side = i % 2 === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + side * ts * 0.04, ly - ts * 0.02);
      ctx.stroke();
    }
    const lit = t < 0 ? 0.3 : 0.08;
    ctx.fillStyle = rgb(mix(color, [255, 255, 255], lit));
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, ts * 0.036, ts * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgb(HERB_TWINE);
  ctx.fillRect(x - ts * 0.035, tieY - ts * 0.015, ts * 0.07, ts * 0.035);
  ctx.strokeStyle = rgba(TOWN_INK_SOFT, 0.8);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - ts * 0.035, tieY - ts * 0.015, ts * 0.07, ts * 0.035);
}

/** A garlic plait: bulbs knotted down a braid, the one hanging thing that is white. */
function paintGarlicPlait(ctx: Ctx, x: number, hangY: number, length: number, ts: number): void {
  ctx.strokeStyle = rgb(HERB_TWINE);
  ctx.lineWidth = Math.max(1, ts * 0.02);
  ctx.beginPath();
  ctx.moveTo(x, hangY);
  ctx.lineTo(x, hangY + length);
  ctx.stroke();
  const bulbCount = 4;
  for (let i = 0; i < bulbCount; i++) {
    const by = hangY + length * (0.3 + (i * 0.7) / bulbCount);
    const bx = x + (i % 2 === 0 ? -1 : 1) * ts * 0.035;
    ctx.fillStyle = rgb(HERB_GARLIC);
    ctx.beginPath();
    ctx.ellipse(bx, by, ts * 0.055, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
  }
}

/** A string of rosehips, red beads on a thread, drying for tea. */
function paintRosehipString(ctx: Ctx, x: number, hangY: number, length: number, ts: number): void {
  const beadCount = 6;
  for (let i = 0; i < beadCount; i++) {
    const by = hangY + (length * (i + 0.5)) / beadCount;
    ctx.fillStyle = rgb(mix(HERB_ROSEHIP, SOOT, (i % 2) * 0.2));
    ctx.beginPath();
    ctx.ellipse(x, by, ts * 0.035, ts * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.45);
  }
}

/**
 * The drying beam: a timber pole pegged across the wall at head height,
 * hung end to end with herbs in bunches — sage, lavender, tansy — a garlic
 * plait, a rosehip string and one bone-and-feather charm; under it on the
 * floor, a long low slatted bench with trays of cut stems still waiting to
 * be tied. Every bunch is a separate teardrop on its own nail, so the wall
 * reads as a harvest hung to dry rather than a patterned frieze.
 */
export function paintDryingBeam(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = getTownRamp('oc_timber');
    contactShadow(ctx, frame);

    // The bench: a heavy top seen from just above with cut stems heaped on
    // it, and a low shelf underneath carrying baskets and a crock.
    const benchLeft = box.left + ts * 0.06;
    const benchRight = box.right - ts * 0.06;
    const benchWidth = benchRight - benchLeft;
    const topFront = box.bottom - ts * 0.46;
    const topBack = topFront - ts * 0.3;
    const edgeH = ts * 0.08;
    const shelfY = box.bottom - ts * 0.14;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.26));
    for (const lx of [benchLeft, benchRight - ts * 0.09]) {
      ctx.fillRect(lx, topFront, ts * 0.09, box.bottom - ts * 0.06 - topFront);
    }
    ctx.fillStyle = rgb(sampleRamp(wood, 0.18));
    ctx.fillRect(benchLeft, topFront + edgeH, benchWidth, shelfY - topFront - edgeH);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.42));
    ctx.fillRect(benchLeft, shelfY, benchWidth, ts * 0.06);
    ctx.beginPath();
    ctx.rect(benchLeft, topFront, benchWidth, shelfY + ts * 0.06 - topFront);
    inkOutline(ctx, ts);
    // Under-shelf stock: two round baskets and a lidded crock.
    const underItems = frame.footprintW + 1;
    for (let i = 0; i < underItems; i++) {
      const ux = benchLeft + (benchWidth * (i + 0.5)) / underItems;
      if (i % 3 === 1) {
        paintShelfItem(ctx, 'squat', ux, shelfY, ts * 0.3, JAR_CLAY, ts);
        continue;
      }
      const bw = ts * 0.44;
      const bh = ts * 0.2;
      ctx.fillStyle = rgb(sampleRamp(wood, 0.6));
      ctx.beginPath();
      ctx.moveTo(ux - bw / 2, shelfY - bh);
      ctx.lineTo(ux + bw / 2, shelfY - bh);
      ctx.lineTo(ux + bw * 0.4, shelfY);
      ctx.lineTo(ux - bw * 0.4, shelfY);
      ctx.closePath();
      ctx.fill();
      inkOutline(ctx, ts * 0.8);
      ctx.strokeStyle = rgba(sampleRamp(wood, 0.3), 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ux - bw * 0.46, shelfY - bh * 0.5);
      ctx.lineTo(ux + bw * 0.46, shelfY - bh * 0.5);
      ctx.stroke();
      ctx.fillStyle = rgb(i % 2 === 0 ? HERB_TANSY : HERB_SAGE);
      ctx.beginPath();
      ctx.ellipse(ux, shelfY - bh, bw * 0.4, bh * 0.35, 0, Math.PI, 0);
      ctx.fill();
    }
    paintPlankBoard(ctx, benchLeft, topBack, benchWidth, topFront - topBack, forkRng(rng), {
      direction: 'horizontal',
      boardPx: (topFront - topBack) / 2,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(benchLeft, topBack, benchWidth, topFront - topBack + edgeH);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.38));
    ctx.fillRect(benchLeft, topFront, benchWidth, edgeH);
    // Heaps of cut stems on the top, each a fan of strokes in one herb's colour.
    const heapColors: readonly RGB[] = [HERB_SAGE, HERB_LAVENDER, HERB_TANSY, HERB_SAGE_DARK];
    const heapCount = frame.footprintW * 2 - 1;
    for (let i = 0; i < heapCount; i++) {
      const hx = benchLeft + (benchWidth * (i + 0.5)) / heapCount;
      const hy = topBack + (topFront - topBack) * 0.72;
      const color = heapColors[i % heapColors.length];
      ctx.fillStyle = rgb(mix(color, SOOT, 0.4));
      ctx.beginPath();
      ctx.ellipse(hx, hy, ts * 0.2, ts * 0.08, 0, Math.PI, 0);
      ctx.fill();
      inkOutline(ctx, ts * 0.6);
      ctx.strokeStyle = rgb(mix(color, [255, 255, 255], 0.18));
      ctx.lineWidth = Math.max(1, ts * 0.022);
      const strokeCount = 6;
      for (let k = 0; k < strokeCount; k++) {
        const sx = hx - ts * 0.16 + (ts * 0.32 * k) / (strokeCount - 1);
        ctx.beginPath();
        ctx.moveTo(sx, hy);
        ctx.lineTo(sx + jitter(rng, ts * 0.06), hy - ts * (0.07 + Math.abs(jitter(rng, 0.03))));
        ctx.stroke();
      }
    }

    // The beam, pegged into the wall above, and everything hung from it.
    const beamY = box.top - ts * 0.78;
    const beamH = ts * 0.1;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.fillRect(box.left, beamY, box.width, beamH);
    ctx.beginPath();
    ctx.rect(box.left, beamY, box.width, beamH);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.8), 0.6);
    ctx.fillRect(box.left, beamY, box.width, ts * 0.02);
    const bunchPitch = ts * 0.5;
    const bunchCount = Math.floor(box.width / bunchPitch);
    const hangCycle: readonly RGB[] = [HERB_SAGE, HERB_LAVENDER, HERB_TANSY, HERB_SAGE_DARK];
    for (let i = 0; i < bunchCount; i++) {
      const hx = box.left + bunchPitch * (i + 0.5);
      const hangY = beamY + beamH;
      const length = ts * (0.64 + jitter(rng, 0.06));
      if (i % 5 === 2) paintGarlicPlait(ctx, hx, hangY, length * 0.9, ts);
      else if (i % 5 === 4) paintRosehipString(ctx, hx, hangY, length * 0.8, ts);
      else if (i === bunchCount - 2) paintBoneCharm(ctx, hx, hangY, length * 0.7, ts);
      else
        paintHerbBunch(ctx, hx, hangY, length, hangCycle[i % hangCycle.length], ts, forkRng(rng));
    }
  });
}

/** A bone and a black feather on a cord — the one charm on the beam that is not for eating. */
function paintBoneCharm(ctx: Ctx, x: number, hangY: number, length: number, ts: number): void {
  ctx.strokeStyle = rgb(HERB_TWINE);
  ctx.lineWidth = Math.max(1, ts * 0.015);
  ctx.beginPath();
  ctx.moveTo(x, hangY);
  ctx.lineTo(x, hangY + length * 0.5);
  ctx.stroke();
  ctx.fillStyle = rgb(CHARM_BONE);
  ctx.beginPath();
  ctx.ellipse(x, hangY + length * 0.62, ts * 0.03, length * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
  ctx.fillStyle = rgb(CHARM_FEATHER);
  ctx.beginPath();
  ctx.moveTo(x + ts * 0.04, hangY + length * 0.45);
  ctx.quadraticCurveTo(x + ts * 0.14, hangY + length * 0.7, x + ts * 0.06, hangY + length);
  ctx.quadraticCurveTo(x + ts * 0.02, hangY + length * 0.7, x + ts * 0.04, hangY + length * 0.45);
  ctx.fill();
  inkOutline(ctx, ts * 0.6);
}

/**
 * Her worktable: a heavy trestle top seen from just above, so the work on it
 * reads — a grimoire lying open, a stone mortar with its pestle, three
 * candles burned to different heights and dripping, a knife, a cut sprig or
 * two, a stoppered jar and a bundle of stems waiting to be tied. Wide enough
 * (three tiles) that the clutter spreads the way a working surface does.
 */
export function paintWitchWorktable(
  ctx: Ctx,
  frame: TownPropFrame,
  _variant: number,
  rng: Rng,
): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = getTownRamp('oc_timber');
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const legTop = box.bottom - ts * 0.4;
    const topFront = legTop;
    const topBack = legTop - ts * 0.52;
    const edgeH = ts * 0.1;

    // Trestle legs, a stretcher between them.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.28));
    for (const lx of [left + ts * 0.14, right - ts * 0.26]) {
      ctx.fillRect(lx, topFront, ts * 0.12, box.bottom - ts * 0.06 - topFront);
    }
    ctx.fillRect(left + ts * 0.2, box.bottom - ts * 0.2, right - left - ts * 0.4, ts * 0.05);
    // Top plane, then its lit front edge.
    paintPlankBoard(ctx, left, topBack, right - left, topFront - topBack, forkRng(rng), {
      direction: 'horizontal',
      boardPx: (topFront - topBack) / 3,
      ramp: wood,
    });
    ctx.beginPath();
    ctx.rect(left, topBack, right - left, topFront - topBack + edgeH);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.36));
    ctx.fillRect(left, topFront, right - left, edgeH);
    ctx.strokeStyle = rgba(TOWN_INK_SOFT, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, topFront);
    ctx.lineTo(right, topFront);
    ctx.stroke();

    const surfaceY = (fraction: number) => topBack + (topFront - topBack) * fraction;

    // The open grimoire, a little skewed, text lines and a red ribbon.
    const bookX = left + ts * 0.62;
    const bookY = surfaceY(0.55);
    ctx.save();
    ctx.translate(bookX, bookY);
    ctx.rotate(-0.08);
    const pageW = ts * 0.34;
    const pageH = ts * 0.3;
    ctx.fillStyle = rgb([70, 36, 30]);
    ctx.fillRect(
      -pageW - ts * 0.03,
      -pageH / 2 - ts * 0.03,
      pageW * 2 + ts * 0.06,
      pageH + ts * 0.06,
    );
    for (const side of [-1, 1]) {
      ctx.fillStyle = rgb(side < 0 ? PAGE : mix(PAGE, PAGE_SHADOW, 0.35));
      ctx.beginPath();
      ctx.rect(side < 0 ? -pageW : 0, -pageH / 2, pageW, pageH);
      ctx.fill();
      inkOutline(ctx, ts * 0.55);
      ctx.strokeStyle = rgba(PAGE_INK, 0.75);
      ctx.lineWidth = 1;
      const lineCount = 4;
      for (let l = 0; l < lineCount; l++) {
        const ly = -pageH / 2 + pageH * (0.2 + l * 0.18);
        const x0 = side < 0 ? -pageW + ts * 0.04 : ts * 0.04;
        ctx.beginPath();
        ctx.moveTo(x0, ly);
        ctx.lineTo(x0 + pageW * (0.7 + jitter(rng, 0.12)), ly);
        ctx.stroke();
      }
    }
    ctx.fillStyle = rgb(HERB_ROSEHIP);
    ctx.fillRect(-ts * 0.015, pageH / 2 - ts * 0.02, ts * 0.03, ts * 0.12);
    ctx.restore();

    // A sprig laid across the page edge, and loose leaves scattered.
    ctx.strokeStyle = rgb(HERB_SAGE);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(bookX + ts * 0.18, surfaceY(0.9));
    ctx.lineTo(bookX + ts * 0.52, surfaceY(0.62));
    ctx.stroke();
    const leafCount = 6;
    for (let i = 0; i < leafCount; i++) {
      const lx = left + (right - left) * (0.42 + Math.abs(jitter(rng, 0.3)));
      const ly = surfaceY(0.35 + Math.abs(jitter(rng, 0.5)));
      ctx.fillStyle = rgb(i % 2 === 0 ? HERB_SAGE : HERB_LAVENDER);
      ctx.beginPath();
      ctx.ellipse(lx, ly, ts * 0.04, ts * 0.02, jitter(rng, 1.2), 0, Math.PI * 2);
      ctx.fill();
    }

    // Mortar and pestle.
    const mortarX = left + (right - left) * 0.6;
    const mortarY = surfaceY(0.78);
    const mortarR = ts * 0.17;
    ctx.fillStyle = rgb(MORTAR_STONE);
    ctx.beginPath();
    ctx.moveTo(mortarX - mortarR, mortarY - mortarR * 0.5);
    ctx.quadraticCurveTo(
      mortarX - mortarR,
      mortarY + mortarR * 0.55,
      mortarX,
      mortarY + mortarR * 0.55,
    );
    ctx.quadraticCurveTo(
      mortarX + mortarR,
      mortarY + mortarR * 0.55,
      mortarX + mortarR,
      mortarY - mortarR * 0.5,
    );
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(mix(MORTAR_STONE, SOOT, 0.45));
    ctx.beginPath();
    ctx.ellipse(mortarX, mortarY - mortarR * 0.5, mortarR, mortarR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(HERB_SAGE_DARK);
    ctx.beginPath();
    ctx.ellipse(
      mortarX,
      mortarY - mortarR * 0.45,
      mortarR * 0.7,
      mortarR * 0.18,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.strokeStyle = rgb(mix(MORTAR_STONE, [255, 255, 255], 0.25));
    ctx.lineWidth = ts * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mortarX - mortarR * 0.2, mortarY - mortarR * 0.5);
    ctx.lineTo(mortarX + mortarR * 1.0, mortarY - mortarR * 1.6);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Knife, a stoppered jar and a tied bundle at the east end.
    ctx.strokeStyle = rgb(sampleRamp(getTownRamp('iron_black'), 0.85));
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.beginPath();
    ctx.moveTo(left + (right - left) * 0.7, surfaceY(0.9));
    ctx.lineTo(left + (right - left) * 0.8, surfaceY(0.78));
    ctx.stroke();
    paintShelfItem(
      ctx,
      'round',
      left + (right - left) * 0.9,
      surfaceY(0.55),
      ts * 0.24,
      JAR_AMBER,
      ts,
    );
    paintShelfItem(
      ctx,
      'bottle',
      left + (right - left) * 0.82,
      surfaceY(0.35),
      ts * 0.22,
      JAR_PLUM,
      ts,
    );

    // Three candles at the west end, burned to different heights.
    paintCandleStub(ctx, left + ts * 0.14, surfaceY(0.45), ts * 0.28, ts);
    paintCandleStub(ctx, left + ts * 0.25, surfaceY(0.7), ts * 0.18, ts);
    paintCandleStub(ctx, left + ts * 0.09, surfaceY(0.85), ts * 0.1, ts);
  });
}

/**
 * The chair nobody but the cat sits in: a stuffed wingback in worn green
 * velvet, a striped knitted shawl slung over its back and one arm, and the
 * black cat curled on the seat cushion with one yellow eye open. One piece,
 * so the cat reads as having claimed the chair rather than as a second prop
 * set down beside it.
 */
export function paintCatArmchair(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const cx = box.centreX;
    const bottom = box.bottom - ts * 0.08;
    const chairW = box.width * 0.9;
    const backTop = bottom - ts * 1.28;
    const seatY = bottom - ts * 0.42;

    // Stub legs.
    ctx.fillStyle = rgb(sampleRamp(getTownRamp('oc_timber'), 0.25));
    for (const side of [-1, 1])
      ctx.fillRect(cx + side * chairW * 0.36 - ts * 0.04, bottom - ts * 0.1, ts * 0.08, ts * 0.1);

    // Back with its two wings, one rounded silhouette.
    ctx.fillStyle = rgb(UPHOLSTERY_BODY);
    ctx.beginPath();
    ctx.moveTo(cx - chairW * 0.4, seatY);
    ctx.lineTo(cx - chairW * 0.46, backTop + ts * 0.3);
    ctx.quadraticCurveTo(cx - chairW * 0.48, backTop, cx - chairW * 0.26, backTop + ts * 0.02);
    ctx.quadraticCurveTo(cx, backTop - ts * 0.1, cx + chairW * 0.26, backTop + ts * 0.02);
    ctx.quadraticCurveTo(cx + chairW * 0.48, backTop, cx + chairW * 0.46, backTop + ts * 0.3);
    ctx.lineTo(cx + chairW * 0.4, seatY);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts);
    // Button-tufting and the shade on the unlit east wing.
    ctx.fillStyle = rgba(SOOT, 0.25);
    ctx.fillRect(cx + chairW * 0.18, backTop + ts * 0.1, chairW * 0.26, seatY - backTop - ts * 0.1);
    ctx.fillStyle = rgb(UPHOLSTERY_DARK);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        ctx.beginPath();
        ctx.arc(
          cx + (c - 1) * chairW * 0.18,
          backTop + ts * (0.3 + r * 0.26),
          ts * 0.022,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

    // The shawl: slung across the top of the back and trailing down the west arm.
    ctx.fillStyle = rgb(SHAWL_BODY);
    ctx.beginPath();
    ctx.moveTo(cx - chairW * 0.3, backTop + ts * 0.04);
    ctx.quadraticCurveTo(cx, backTop - ts * 0.04, cx + chairW * 0.2, backTop + ts * 0.06);
    ctx.lineTo(cx + chairW * 0.1, backTop + ts * 0.26);
    ctx.quadraticCurveTo(
      cx - chairW * 0.2,
      backTop + ts * 0.3,
      cx - chairW * 0.36,
      backTop + ts * 0.2,
    );
    ctx.lineTo(cx - chairW * 0.52, seatY + ts * 0.12);
    ctx.lineTo(cx - chairW * 0.36, seatY + ts * 0.16);
    ctx.lineTo(cx - chairW * 0.3, backTop + ts * 0.3);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.strokeStyle = rgb(SHAWL_STRIPE);
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.beginPath();
    ctx.moveTo(cx - chairW * 0.28, backTop + ts * 0.12);
    ctx.quadraticCurveTo(
      cx - chairW * 0.05,
      backTop + ts * 0.1,
      cx + chairW * 0.14,
      backTop + ts * 0.14,
    );
    ctx.moveTo(cx - chairW * 0.44, seatY - ts * 0.1);
    ctx.lineTo(cx - chairW * 0.36, seatY - ts * 0.02);
    ctx.stroke();
    ctx.strokeStyle = rgb(SHAWL_BODY);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const fx = cx - chairW * 0.5 + i * ts * 0.035;
      ctx.beginPath();
      ctx.moveTo(fx, seatY + ts * 0.13);
      ctx.lineTo(fx - ts * 0.01, seatY + ts * 0.22);
      ctx.stroke();
    }

    // Seat cushion and the two rolled arms over it.
    ctx.fillStyle = rgb(UPHOLSTERY_LIGHT);
    ctx.beginPath();
    ctx.ellipse(cx, seatY, chairW * 0.34, ts * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(UPHOLSTERY_BODY);
    ctx.fillRect(cx - chairW * 0.4, seatY, chairW * 0.8, bottom - ts * 0.1 - seatY);
    ctx.beginPath();
    ctx.rect(cx - chairW * 0.4, seatY, chairW * 0.8, bottom - ts * 0.1 - seatY);
    inkOutline(ctx, ts);
    for (const side of [-1, 1]) {
      ctx.fillStyle = rgb(side < 0 ? UPHOLSTERY_LIGHT : UPHOLSTERY_BODY);
      ctx.beginPath();
      ctx.roundRect(
        cx + side * chairW * 0.36 - ts * 0.1,
        seatY - ts * 0.18,
        ts * 0.2,
        bottom - ts * 0.08 - seatY + ts * 0.18,
        ts * 0.08,
      );
      ctx.fill();
      inkOutline(ctx, ts * 0.9);
    }

    // The cat, curled on the cushion, one eye open.
    const catY = seatY - ts * 0.05;
    ctx.fillStyle = rgb(CAT_BLACK);
    ctx.beginPath();
    ctx.ellipse(cx - ts * 0.02, catY, chairW * 0.24, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    const headX = cx + chairW * 0.14;
    const headY = catY - ts * 0.06;
    const headR = ts * 0.08;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.moveTo(headX - headR * 0.8, headY - headR * 0.5);
    ctx.lineTo(headX - headR * 0.7, headY - headR * 1.6);
    ctx.lineTo(headX - headR * 0.1, headY - headR * 0.9);
    ctx.moveTo(headX + headR * 0.2, headY - headR * 0.9);
    ctx.lineTo(headX + headR * 0.7, headY - headR * 1.6);
    ctx.lineTo(headX + headR * 0.9, headY - headR * 0.4);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(CAT_EYE);
    ctx.beginPath();
    ctx.ellipse(headX + headR * 0.35, headY, headR * 0.22, headR * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgb(CAT_EYE);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.5, headY + headR * 0.05);
    ctx.lineTo(headX - headR * 0.15, headY + headR * 0.05);
    ctx.stroke();
    ctx.strokeStyle = rgb(CAT_BLACK);
    ctx.lineWidth = ts * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - chairW * 0.22, catY + ts * 0.04);
    ctx.quadraticCurveTo(
      cx - chairW * 0.05,
      catY + ts * 0.16 + jitter(rng, ts * 0.01),
      cx + chairW * 0.12,
      catY + ts * 0.08,
    );
    ctx.stroke();
    ctx.lineCap = 'butt';
  });
}

/**
 * Books with nowhere left to go: four piles of different heights against the
 * wall, spines in every colour, one pile topped by a book left open face
 * down, another by a candle stub that has dripped down its covers, and a
 * rolled scroll leaning against the end.
 */
export function paintBookHeap(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const pileCount = 4;
    const pileHeights = [9, 5, 11, 7];
    const pitch = (box.width - ts * 0.2) / pileCount;
    const tops: Array<{ x: number; y: number; w: number }> = [];
    for (let p = 0; p < pileCount; p++) {
      const px = box.left + ts * 0.1 + pitch * (p + 0.5);
      let y = box.bottom - ts * 0.08;
      let lastW = 0;
      for (let b = 0; b < pileHeights[p]; b++) {
        const h = ts * (0.07 + Math.abs(jitter(rng, 0.02)));
        const w = pitch * (0.78 + jitter(rng, 0.1));
        const lean = jitter(rng, ts * 0.025);
        const x0 = px - w / 2 + lean;
        const cover = BOOK_COVERS[(b * 3 + p) % BOOK_COVERS.length];
        ctx.fillStyle = rgb(cover);
        ctx.beginPath();
        ctx.rect(x0, y - h, w, h);
        ctx.fill();
        inkOutline(ctx, ts * 0.7);
        ctx.fillStyle = rgb(mix(PAGE, PAGE_SHADOW, 0.3));
        ctx.fillRect(x0 + w * 0.08, y - h * 0.7, w * 0.84, h * 0.4);
        ctx.fillStyle = rgba(GLASS_SHINE, 0.25);
        ctx.fillRect(x0, y - h, w * 0.3, h * 0.3);
        y -= h;
        lastW = w;
      }
      tops.push({ x: px, y, w: lastW });
    }
    // Open book face down, tented over the second pile.
    const tent = tops[1];
    ctx.fillStyle = rgb(BOOK_COVERS[2]);
    ctx.beginPath();
    ctx.moveTo(tent.x - tent.w * 0.62, tent.y);
    ctx.lineTo(tent.x, tent.y - ts * 0.12);
    ctx.lineTo(tent.x + tent.w * 0.62, tent.y);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    paintCandleStub(ctx, tops[3].x, tops[3].y, ts * 0.14, ts);
    ctx.strokeStyle = rgba(CANDLE_WAX, 0.9);
    ctx.lineWidth = Math.max(1, ts * 0.02);
    ctx.beginPath();
    ctx.moveTo(tops[3].x + ts * 0.03, tops[3].y);
    ctx.lineTo(tops[3].x + ts * 0.04, tops[3].y + ts * 0.14);
    ctx.stroke();
    // A scroll leaning on the tallest pile.
    ctx.fillStyle = rgb(PAGE);
    ctx.save();
    ctx.translate(tops[2].x + pitch * 0.48, box.bottom - ts * 0.1);
    ctx.rotate(-0.25);
    ctx.beginPath();
    ctx.roundRect(-ts * 0.05, -ts * 0.55, ts * 0.1, ts * 0.55, ts * 0.04);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(HERB_ROSEHIP);
    ctx.fillRect(-ts * 0.05, -ts * 0.3, ts * 0.1, ts * 0.03);
    ctx.restore();
  });
}

/**
 * A birdcage on its own tall iron stand: a hook-topped pole, a domed cage of
 * bars, a finch on its perch, and a cloth half-drawn over one side the way
 * you'd quiet a bird at night.
 */
export function paintBirdcageStand(ctx: Ctx, frame: TownPropFrame): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const iron = getTownRamp('iron_black');
    const cx = box.centreX;
    const baseY = box.bottom - ts * 0.1;
    // Tripod foot and pole.
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.45));
    ctx.lineWidth = ts * 0.04;
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.24, baseY);
    ctx.lineTo(cx, baseY - ts * 0.2);
    ctx.lineTo(cx + ts * 0.24, baseY);
    ctx.moveTo(cx, baseY - ts * 0.2);
    ctx.lineTo(cx, baseY);
    ctx.stroke();
    const poleTop = baseY - ts * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, baseY - ts * 0.2);
    ctx.lineTo(cx, poleTop);
    ctx.quadraticCurveTo(cx + ts * 0.2, poleTop - ts * 0.05, cx + ts * 0.16, poleTop + ts * 0.12);
    ctx.stroke();
    // The cage hung from the hook.
    const cageCx = cx + ts * 0.16;
    const cageTop = poleTop + ts * 0.2;
    const cageBottom = cageTop + ts * 0.62;
    const cageW = ts * 0.52;
    const domeH = ts * 0.2;
    ctx.fillStyle = rgba(SOOT, 0.35);
    ctx.fillRect(cageCx - cageW / 2, cageTop + domeH, cageW, cageBottom - cageTop - domeH);
    ctx.fillStyle = rgb(CAGE_BIRD);
    ctx.beginPath();
    ctx.ellipse(
      cageCx - ts * 0.02,
      cageBottom - ts * 0.2,
      ts * 0.09,
      ts * 0.07,
      -0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.beginPath();
    ctx.arc(cageCx + ts * 0.06, cageBottom - ts * 0.27, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    ctx.fillStyle = rgb(CANDLE_FLAME);
    ctx.beginPath();
    ctx.moveTo(cageCx + ts * 0.1, cageBottom - ts * 0.28);
    ctx.lineTo(cageCx + ts * 0.16, cageBottom - ts * 0.26);
    ctx.lineTo(cageCx + ts * 0.1, cageBottom - ts * 0.24);
    ctx.fill();
    ctx.strokeStyle = rgb(sampleRamp(iron, 0.7));
    ctx.lineWidth = Math.max(1, ts * 0.018);
    ctx.beginPath();
    ctx.moveTo(cageCx - cageW * 0.4, cageBottom - ts * 0.13);
    ctx.lineTo(cageCx + cageW * 0.4, cageBottom - ts * 0.13);
    ctx.stroke();
    ctx.strokeStyle = rgb(CAGE_IRON);
    ctx.beginPath();
    ctx.arc(cageCx, cageTop + domeH, cageW / 2, Math.PI, 0);
    ctx.stroke();
    const barCount = 6;
    for (let i = 0; i <= barCount; i++) {
      const bx = cageCx - cageW / 2 + (cageW * i) / barCount;
      ctx.beginPath();
      ctx.moveTo(bx, cageTop + domeH);
      ctx.lineTo(bx, cageBottom);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(sampleRamp(iron, 0.55));
    ctx.fillRect(
      cageCx - cageW / 2 - ts * 0.02,
      cageBottom - ts * 0.03,
      cageW + ts * 0.04,
      ts * 0.05,
    );
    // A cloth half over the east side.
    ctx.fillStyle = rgb(SHAWL_STRIPE);
    ctx.beginPath();
    ctx.moveTo(cageCx, cageTop - ts * 0.02);
    ctx.quadraticCurveTo(cageCx + cageW * 0.5, cageTop, cageCx + cageW * 0.56, cageTop + domeH);
    ctx.lineTo(cageCx + cageW * 0.6, cageBottom + ts * 0.06);
    ctx.lineTo(cageCx + cageW * 0.18, cageBottom - ts * 0.1);
    ctx.quadraticCurveTo(cageCx + cageW * 0.1, cageTop + domeH, cageCx, cageTop - ts * 0.02);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
  });
}

/**
 * Three fat crocks and a jug crowded onto one tile — stoppered, lidded and
 * tied — the overflow of a dresser that ran out of shelf. Sized to fill the
 * tile, so a run of them along a wall reads as a heap of stores, not as a
 * row of tiny bottles.
 */
export function paintCrockCluster(ctx: Ctx, frame: TownPropFrame, variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    contactShadow(ctx, frame);
    const baseY = box.bottom - ts * 0.08;
    const backRow: ReadonlyArray<readonly [number, ShelfItemKind, number]> = [
      [0.3, 'tall', 0.5],
      [0.68, 'round', 0.52],
    ];
    const frontRow: ReadonlyArray<readonly [number, ShelfItemKind, number]> = [
      [0.2, 'squat', 0.46],
      [0.52, 'bottle', 0.42],
      [0.8, 'squat', 0.36],
    ];
    const colorOffset = variant * 2;
    backRow.forEach(([fx, kind, size], i) =>
      paintShelfItem(
        ctx,
        kind,
        box.left + box.width * fx,
        baseY - ts * 0.14,
        ts * (size + jitter(rng, 0.03)),
        JAR_COLORS[(i + colorOffset + 3) % JAR_COLORS.length],
        ts,
      ),
    );
    frontRow.forEach(([fx, kind, size], i) =>
      paintShelfItem(
        ctx,
        kind,
        box.left + box.width * fx,
        baseY,
        ts * (size + jitter(rng, 0.03)),
        [JAR_CLAY, JAR_BOTTLE_GREEN, JAR_MILK, JAR_AMBER][(i + colorOffset) % 4],
        ts,
      ),
    );
  });
}

/** Her own bed, a narrow box bed under a patchwork quilt of a dozen different scraps. */
const QUILT_PATCHES: readonly RGB[] = [
  [150, 70, 58],
  [70, 98, 72],
  [188, 150, 84],
  [84, 82, 120],
  [168, 120, 86],
  [120, 60, 84],
];

/**
 * A narrow box bed seen side-on along the wall, headboard to the west: a
 * plank frame, a straw mattress, a patchwork quilt of mismatched squares
 * turned down at the pillow, a nightcap left on it, and a chamber-stick on
 * the headboard post.
 */
export function paintCottageBed(ctx: Ctx, frame: TownPropFrame, _variant: number, rng: Rng): void {
  withFootprintClip(ctx, frame, () => {
    const box = footprintBox(frame);
    const ts = frame.tileScale;
    const wood = getTownRamp('oc_timber');
    contactShadow(ctx, frame);
    const left = box.left + ts * 0.06;
    const right = box.right - ts * 0.06;
    const frameBottom = box.bottom - ts * 0.08;
    const railTop = frameBottom - ts * 0.3;
    const mattressTop = railTop - ts * 0.34;
    // Headboard and footboard posts.
    const headW = ts * 0.14;
    ctx.fillStyle = rgb(sampleRamp(wood, 0.4));
    ctx.fillRect(left, mattressTop - ts * 0.42, headW, frameBottom - mattressTop + ts * 0.42);
    ctx.beginPath();
    ctx.rect(left, mattressTop - ts * 0.42, headW, frameBottom - mattressTop + ts * 0.42);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgb(sampleRamp(wood, 0.3));
    ctx.fillRect(
      right - headW,
      mattressTop - ts * 0.12,
      headW,
      frameBottom - mattressTop + ts * 0.12,
    );
    ctx.beginPath();
    ctx.rect(right - headW, mattressTop - ts * 0.12, headW, frameBottom - mattressTop + ts * 0.12);
    inkOutline(ctx, ts);
    // Mattress, pillow and the quilt.
    const bedLeft = left + headW;
    const bedRight = right - headW;
    ctx.fillStyle = rgb(PAGE);
    ctx.beginPath();
    ctx.roundRect(bedLeft, mattressTop, bedRight - bedLeft, railTop - mattressTop, ts * 0.06);
    ctx.fill();
    inkOutline(ctx, ts * 0.8);
    ctx.fillStyle = rgb(mix(PAGE, [255, 255, 255], 0.3));
    ctx.beginPath();
    ctx.ellipse(
      bedLeft + ts * 0.26,
      mattressTop + ts * 0.08,
      ts * 0.2,
      ts * 0.12,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    inkOutline(ctx, ts * 0.7);
    const quiltLeft = bedLeft + ts * 0.5;
    const quiltTop = mattressTop - ts * 0.04;
    const quiltH = railTop - quiltTop + ts * 0.06;
    const cols = 5;
    const rows = 2;
    const patchW = (bedRight - quiltLeft) / cols;
    const patchH = quiltH / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = rgb(
          QUILT_PATCHES[
            (r * 3 + c * 2 + Math.floor(Math.abs(jitter(rng, 2)))) % QUILT_PATCHES.length
          ],
        );
        ctx.fillRect(quiltLeft + patchW * c, quiltTop + patchH * r, patchW, patchH);
      }
    ctx.fillStyle = rgba(SOOT, 0.2);
    ctx.fillRect(quiltLeft, quiltTop + patchH, bedRight - quiltLeft, patchH);
    ctx.strokeStyle = rgba(PAGE, 0.6);
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    for (let c = 1; c < cols; c++) {
      ctx.beginPath();
      ctx.moveTo(quiltLeft + patchW * c, quiltTop);
      ctx.lineTo(quiltLeft + patchW * c, quiltTop + quiltH);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(quiltLeft, quiltTop, bedRight - quiltLeft, quiltH);
    inkOutline(ctx, ts * 0.8);
    // Turned-down fold at the quilt's pillow end.
    ctx.fillStyle = rgb(mix(PAGE, PAGE_SHADOW, 0.3));
    ctx.fillRect(quiltLeft - ts * 0.08, quiltTop, ts * 0.1, quiltH);
    ctx.beginPath();
    ctx.rect(quiltLeft - ts * 0.08, quiltTop, ts * 0.1, quiltH);
    inkOutline(ctx, ts * 0.6);
    // Side rail in front of it all.
    ctx.fillStyle = rgb(sampleRamp(wood, 0.5));
    ctx.fillRect(left, railTop, right - left, frameBottom - railTop);
    ctx.beginPath();
    ctx.rect(left, railTop, right - left, frameBottom - railTop);
    inkOutline(ctx, ts);
    ctx.fillStyle = rgba(sampleRamp(wood, 0.85), 0.6);
    ctx.fillRect(left, railTop, right - left, ts * 0.025);
    // A nightcap on the pillow and a candle on the headboard post.
    ctx.fillStyle = rgb(SHAWL_STRIPE);
    ctx.beginPath();
    ctx.moveTo(bedLeft + ts * 0.14, mattressTop + ts * 0.02);
    ctx.quadraticCurveTo(
      bedLeft + ts * 0.3,
      mattressTop - ts * 0.16,
      bedLeft + ts * 0.44,
      mattressTop - ts * 0.02,
    );
    ctx.lineTo(bedLeft + ts * 0.3, mattressTop + ts * 0.06);
    ctx.closePath();
    ctx.fill();
    inkOutline(ctx, ts * 0.6);
    paintCandleStub(ctx, left + headW / 2, mattressTop - ts * 0.42, ts * 0.14, ts);
  });
}
