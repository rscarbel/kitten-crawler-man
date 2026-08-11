import { getSpriteDef } from '../core/SpriteLoader';
import { walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export interface SkyFowlClothColors {
  vest: string;
  pants: string;
  trim: string;
  hat: string | null;
}

/** Eight distinct clothing palettes — picked randomly per-instance. */
export const SKY_FOWL_PALETTES: SkyFowlClothColors[] = [
  { vest: '#2e5c8a', pants: '#1a2a3a', trim: '#f0c060', hat: '#1a4050' }, // blue + gold
  { vest: '#6b2d2d', pants: '#3a1a1a', trim: '#c8a060', hat: '#8a3020' }, // burgundy + bronze
  { vest: '#2d6b3a', pants: '#1a3a1a', trim: '#e8d090', hat: null }, // forest green
  { vest: '#7a6020', pants: '#4a3a1a', trim: '#a8d080', hat: '#6a5010' }, // mustard + olive
  { vest: '#5a2d7a', pants: '#2a1a3a', trim: '#f0a0d0', hat: '#6a3090' }, // purple + pink
  { vest: '#1a4a4a', pants: '#0a2a2a', trim: '#80d0d0', hat: null }, // teal
  { vest: '#8a4020', pants: '#3a2010', trim: '#e0c060', hat: '#6a3010' }, // burnt orange + gold
  { vest: '#4a4a2a', pants: '#2a2a10', trim: '#a0c050', hat: null }, // olive drab
];

/**
 * The magistrate's own colours — blue and gold, the only palette in the set that
 * reads as an office rather than a market stall.
 */
const MAGISTRATE_PALETTE_INDEX = 0;

/** How far the corpse's colours are pulled toward their own grey. */
const CORPSE_DESATURATION = 0.72;
/** How far they are then pulled toward black, for weeks of dust and no blood. */
const CORPSE_DARKENING = 0.34;

const STATE_ROWS = {
  walk: { row: 0, frameCount: 8 },
  idle: { row: 1, frameCount: 1 },
  peck: { row: 2, frameCount: 6 },
  aggressive: { row: 3, frameCount: 1 },
} as const;

type SkyFowlState = keyof typeof STATE_ROWS;

/**
 * Pre-bake one sprite sheet canvas for a given clothing palette.
 * Composites the body PNG with each clothing mask PNG tinted to the palette colors.
 * Call once per SkyFowl instance after loadSprites() has resolved.
 * Returns null if any required sprite has not yet loaded.
 */
export function bakeSkyFowlCanvas(cloth: SkyFowlClothColors): HTMLCanvasElement | null {
  const bodyDef = getSpriteDef('sky_fowl_body');
  const pantsDef = getSpriteDef('sky_fowl_pants_mask');
  const vestDef = getSpriteDef('sky_fowl_vest_mask');
  const trimDef = getSpriteDef('sky_fowl_trim_mask');
  const hatDef = getSpriteDef('sky_fowl_hat_mask');

  if (!bodyDef || !pantsDef || !vestDef || !trimDef || !hatDef) return null;

  // `.width`/`.height` rather than `.naturalWidth`/`.naturalHeight`: `img` may
  // be a `downscaleSheet`-produced `<canvas>` (the low-end-device downscale)
  // instead of an `<img>`, and the two agree anyway for a plain `Image()`
  // with no explicit width/height attribute.
  const w = bodyDef.img.width;
  const h = bodyDef.img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw the base body (feathers, beak, eyes, talons, shadow).
  ctx.drawImage(bodyDef.img, 0, 0);

  // Tint each clothing mask with its palette color using destination-in compositing:
  // fill solid color → clip to mask alpha → draw onto baked canvas.
  const clothingLayers: Array<[HTMLImageElement | HTMLCanvasElement, string]> = [
    [pantsDef.img, cloth.pants],
    [vestDef.img, cloth.vest],
    [trimDef.img, cloth.trim],
  ];
  if (cloth.hat !== null) {
    clothingLayers.push([hatDef.img, cloth.hat]);
  }

  for (const [maskImg, color] of clothingLayers) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tc = tmp.getContext('2d');
    if (!tc) continue;

    tc.fillStyle = color;
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    // Stretched to the body's own (w, h) rather than drawn at the mask's
    // natural size: the low-end-device downscale (`downscaleSheet`) resizes
    // each sheet independently, and while today's source PNGs happen to share
    // identical dimensions so the rounding agrees, nothing enforces that — an
    // explicit stretch keeps the mask aligned to the body even if a future
    // asset edit makes them differ.
    tc.drawImage(maskImg, 0, 0, maskImg.width, maskImg.height, 0, 0, w, h);

    ctx.drawImage(tmp, 0, 0);
  }

  return canvas;
}

/**
 * Draw the Sky Fowl using a pre-baked palette canvas produced by bakeSkyFowlCanvas.
 * Selects the correct animation state and frame, and mirrors for left-facing.
 */
export function drawSkyFowlSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  isAggressive = false,
  facingX = 0,
  _facingY = 1,
  bakedCanvas: HTMLCanvasElement | null,
  peckAmt = 0,
): void {
  if (!bakedCanvas) return;

  const bodyDef = getSpriteDef('sky_fowl_body');
  if (!bodyDef) return;

  const { frameWidth, frameHeight, tileX, tileY, tileScale } = bodyDef;
  const scale = s / tileScale;

  let state: SkyFowlState;
  let frame: number;

  if (peckAmt > 0) {
    state = 'peck';
    frame = progressFrameIndex(peckAmt, STATE_ROWS.peck.frameCount);
  } else if (isMoving) {
    state = 'walk';
    frame = walkFrameIndex(walkFrame * 0.5, STATE_ROWS.walk.frameCount);
  } else if (isAggressive) {
    state = 'aggressive';
    frame = 0;
  } else {
    state = 'idle';
    frame = 0;
  }

  const stateDef = STATE_ROWS[state];
  const clampedFrame = Math.max(0, Math.min(frame, stateDef.frameCount - 1));

  const srcX = clampedFrame * frameWidth;
  const srcY = stateDef.row * frameHeight;
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;
  const dx = sx - tileX * scale;
  const dy = sy - tileY * scale;

  ctx.save();

  if (facingX < -0.3) {
    const flipCx = sx + s * 0.5;
    ctx.translate(flipCx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-flipCx, 0);
  }

  ctx.drawImage(bakedCanvas, srcX, srcY, frameWidth, frameHeight, dx, dy, dw, dh);

  ctx.restore();
}

// ── Magistrate Featherfall's corpse ──────────────────────────────────────────

const HEX_RADIX = 16;
const CHANNEL_MASK = 0xff;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

/**
 * Pulls a living palette colour toward its own grey and then toward black.
 *
 * The corpse has to be recognisable as the same office the living skyfowl of
 * this town wear — the sash is the whole point — while reading as weeks dead at
 * a glance, and a separate hand-picked palette would drift away from the one it
 * is supposed to be quoting.
 */
function dullColor(hex: string): string {
  const packed = Number.parseInt(hex.slice(1), HEX_RADIX);
  const red = (packed >> RED_SHIFT) & CHANNEL_MASK;
  const green = (packed >> GREEN_SHIFT) & CHANNEL_MASK;
  const blue = packed & CHANNEL_MASK;
  const grey = red * LUMA_RED + green * LUMA_GREEN + blue * LUMA_BLUE;
  const fade = (channel: number): number => {
    const desaturated = channel + (grey - channel) * CORPSE_DESATURATION;
    return Math.round(desaturated * (1 - CORPSE_DARKENING));
  };
  return `rgb(${fade(red)}, ${fade(green)}, ${fade(blue)})`;
}

const MAGISTRATE_CLOTH = SKY_FOWL_PALETTES[MAGISTRATE_PALETTE_INDEX];
const CORPSE_VEST_COLOR = dullColor(MAGISTRATE_CLOTH.vest);
const CORPSE_SASH_COLOR = dullColor(MAGISTRATE_CLOTH.trim);
/** The magistracy's wax seal, still hanging where he last wore it. */
const CORPSE_SEAL_COLOR = dullColor('#8a2b20');

/** Feathers with the oil gone out of them. */
const CORPSE_FEATHER_COLOR = '#6a6355';
const CORPSE_FEATHER_SHADE = '#443f36';
const CORPSE_FEATHER_LIGHT = '#8a8271';
const CORPSE_BEAK_COLOR = '#8a7a4e';
const CORPSE_EYE_COLOR = '#8d8879';
const CORPSE_SOCKET_COLOR = '#2a2620';

const DESK_TOP_COLOR = '#5c4530';
const DESK_FACE_COLOR = '#3d2d1e';
const DESK_EDGE_COLOR = '#241a11';
const CHAIR_COLOR = '#33261a';
const PAPER_COLOR = '#b8ac90';
const PAPER_INK_COLOR = '#3a3226';
const INKWELL_COLOR = '#191a20';
const DUST_COLOR = 'rgba(180, 172, 150, 0.16)';

/** Everything below is a fraction of one tile, measured from the tile's centre. */
const DESK_HALF_WIDTH = 1;
const DESK_TOP_Y = -0.28;
const DESK_SURFACE_DEPTH = 0.07;
const DESK_BOTTOM_Y = 0.3;
const CHAIR_HALF_WIDTH = 0.4;
const CHAIR_TOP_Y = -1.08;
const CHAIR_BOTTOM_Y = -0.18;
const CHAIR_SLAT_COUNT = 3;

const TORSO_CENTRE_Y = -0.47;
const TORSO_RX = 0.3;
const TORSO_RY = 0.43;
/**
 * The chest has fallen in on itself — a shadowed pit under the sash rather than
 * a patch of a second colour, which at this size just reads as a bib.
 */
const CHEST_HOLLOW_CENTRE_Y = -0.58;
const CHEST_HOLLOW_RX = 0.13;
const CHEST_HOLLOW_RY = 0.18;
const CHEST_HOLLOW_COLOR = '#241f1a';
/** The one lit edge above the pit, which is what makes it read as depth. */
const CHEST_RIM_COLOR = '#7d766a';
const CHEST_RIM_THICKNESS = 0.022;

const SASH_WIDTH = 0.11;
const SASH_TOP = { x: -0.27, y: -0.78 };
const SASH_BOTTOM = { x: 0.27, y: -0.33 };
const SEAL_CENTRE = { x: 0.26, y: -0.44 };
const SEAL_RADIUS = 0.075;

const SHOULDER_HALF_WIDTH = 0.29;
const SHOULDER_Y = -0.74;
const WING_TIP = { x: 0.52, y: -0.12 };
const WING_WIDTH = 0.09;

const NECK_WIDTH = 0.1;
const NECK_ROOT = { x: 0.03, y: -0.82 };
/**
 * The neck has given up: it sags out of the collar and the head has tipped
 * back over it. A skyfowl holding its head level reads as asleep at worst.
 */
const NECK_SAG = { x: 0.16, y: -0.76 };
const HEAD_CENTRE = { x: 0.27, y: -0.94 };
const HEAD_RX = 0.16;
const HEAD_RY = 0.13;
const HEAD_TILT = -0.55;
/** The upper mandible points at the ceiling; the lower one hangs slack under it. */
const UPPER_BEAK_TIP = { x: 0.64, y: -1.12 };
const LOWER_BEAK_TIP = { x: 0.57, y: -0.88 };
const BEAK_ROOT_HALF_HEIGHT = 0.05;
const EYE_CENTRE = { x: 0.27, y: -0.99 };
const EYE_RADIUS = 0.032;
/** How far the sunken socket is drawn past the clouded eye sitting in it. */
const SOCKET_RX_RATIO = 1.7;
const SOCKET_RY_RATIO = 1.4;

const CHAIR_SLAT_THICKNESS = 0.02;
const DESK_INK_LINE_THICKNESS = 0.012;
const QUILL_THICKNESS = 0.03;

const PAPER_WIDTH = 0.22;
const PAPER_HEIGHT = 0.1;
const PAPER_LINE_INSET = 0.03;
const PAPER_SLOTS: ReadonlyArray<{ x: number; y: number; tilt: number }> = [
  { x: -0.52, y: -0.26, tilt: -0.12 },
  { x: -0.2, y: -0.24, tilt: 0.08 },
  { x: 0.42, y: -0.25, tilt: -0.05 },
];
const INKWELL = { x: 0.76, y: -0.26, rx: 0.075, ry: 0.05, height: 0.09 };
const QUILL_TIP = { x: 0.92, y: -0.62 };

/** Moulted feathers on the floor in front of the desk. */
const FLOOR_FEATHERS: ReadonlyArray<{ x: number; y: number; angle: number }> = [
  { x: -0.72, y: 0.42, angle: 0.35 },
  { x: -0.24, y: 0.5, angle: -0.6 },
  { x: 0.58, y: 0.45, angle: 1.05 },
];
const FLOOR_FEATHER_LENGTH = 0.24;
const FLOOR_FEATHER_WIDTH = 0.055;

const DUST_HALF_WIDTH = 0.9;
const DUST_Y = -0.31;
const DUST_HEIGHT = 0.035;

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw Magistrate Featherfall as he has been for weeks: slumped back in his
 * chair behind his own desk, sash and seal still on, letters still stacked in
 * front of him waiting for a signature somebody else has been providing.
 *
 * A pure draw function like GumGum's corpse rather than a `Mob` or a baked
 * palette canvas — nothing here is per-instance, so none of the live SkyFowl's
 * clothing-canvas disposal contract applies.
 */
export function drawSkyFowlCorpse(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
): void {
  const cx = sx + s / 2;
  const cy = sy + s / 2;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = CORPSE_FEATHER_LIGHT;
  for (const feather of FLOOR_FEATHERS) {
    fillEllipse(
      ctx,
      feather.x * s,
      feather.y * s,
      FLOOR_FEATHER_LENGTH * s,
      FLOOR_FEATHER_WIDTH * s,
      feather.angle,
    );
  }

  ctx.fillStyle = CHAIR_COLOR;
  ctx.fillRect(
    -CHAIR_HALF_WIDTH * s,
    CHAIR_TOP_Y * s,
    CHAIR_HALF_WIDTH * 2 * s,
    (CHAIR_BOTTOM_Y - CHAIR_TOP_Y) * s,
  );
  ctx.fillStyle = DESK_EDGE_COLOR;
  for (let slat = 1; slat < CHAIR_SLAT_COUNT; slat++) {
    const y = CHAIR_TOP_Y + ((CHAIR_BOTTOM_Y - CHAIR_TOP_Y) * slat) / CHAIR_SLAT_COUNT;
    ctx.fillRect(-CHAIR_HALF_WIDTH * s, y * s, CHAIR_HALF_WIDTH * 2 * s, CHAIR_SLAT_THICKNESS * s);
  }

  // Wings hang where they fell, not where a living bird would hold them.
  ctx.strokeStyle = CORPSE_FEATHER_SHADE;
  ctx.lineWidth = WING_WIDTH * s;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * SHOULDER_HALF_WIDTH * s, SHOULDER_Y * s);
    ctx.lineTo(side * WING_TIP.x * s, WING_TIP.y * s);
    ctx.stroke();
  }

  ctx.fillStyle = CORPSE_VEST_COLOR;
  fillEllipse(ctx, 0, TORSO_CENTRE_Y * s, TORSO_RX * s, TORSO_RY * s);
  ctx.fillStyle = CHEST_HOLLOW_COLOR;
  fillEllipse(ctx, 0, CHEST_HOLLOW_CENTRE_Y * s, CHEST_HOLLOW_RX * s, CHEST_HOLLOW_RY * s);
  ctx.strokeStyle = CHEST_RIM_COLOR;
  ctx.lineWidth = CHEST_RIM_THICKNESS * s;
  ctx.beginPath();
  ctx.ellipse(
    0,
    CHEST_HOLLOW_CENTRE_Y * s,
    CHEST_HOLLOW_RX * s,
    CHEST_HOLLOW_RY * s,
    0,
    Math.PI,
    Math.PI * 2,
  );
  ctx.stroke();

  ctx.strokeStyle = CORPSE_SASH_COLOR;
  ctx.lineWidth = SASH_WIDTH * s;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(SASH_TOP.x * s, SASH_TOP.y * s);
  ctx.lineTo(SASH_BOTTOM.x * s, SASH_BOTTOM.y * s);
  ctx.stroke();
  ctx.fillStyle = CORPSE_SEAL_COLOR;
  ctx.beginPath();
  ctx.arc(SEAL_CENTRE.x * s, SEAL_CENTRE.y * s, SEAL_RADIUS * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = CORPSE_FEATHER_COLOR;
  ctx.lineWidth = NECK_WIDTH * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(NECK_ROOT.x * s, NECK_ROOT.y * s);
  ctx.quadraticCurveTo(NECK_SAG.x * s, NECK_SAG.y * s, HEAD_CENTRE.x * s, HEAD_CENTRE.y * s);
  ctx.stroke();

  ctx.fillStyle = CORPSE_BEAK_COLOR;
  for (const tip of [UPPER_BEAK_TIP, LOWER_BEAK_TIP]) {
    ctx.beginPath();
    ctx.moveTo(HEAD_CENTRE.x * s, (HEAD_CENTRE.y - BEAK_ROOT_HALF_HEIGHT) * s);
    ctx.lineTo(tip.x * s, tip.y * s);
    ctx.lineTo(HEAD_CENTRE.x * s, (HEAD_CENTRE.y + BEAK_ROOT_HALF_HEIGHT) * s);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = CORPSE_FEATHER_COLOR;
  fillEllipse(ctx, HEAD_CENTRE.x * s, HEAD_CENTRE.y * s, HEAD_RX * s, HEAD_RY * s, HEAD_TILT);

  // A sunken socket with a clouded eye still in it, rather than an empty hole:
  // the player has to read him as a body, not as a skull.
  ctx.fillStyle = CORPSE_SOCKET_COLOR;
  fillEllipse(
    ctx,
    EYE_CENTRE.x * s,
    EYE_CENTRE.y * s,
    EYE_RADIUS * SOCKET_RX_RATIO * s,
    EYE_RADIUS * SOCKET_RY_RATIO * s,
  );
  ctx.fillStyle = CORPSE_EYE_COLOR;
  ctx.beginPath();
  ctx.arc(EYE_CENTRE.x * s, EYE_CENTRE.y * s, EYE_RADIUS * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = DESK_FACE_COLOR;
  ctx.fillRect(
    -DESK_HALF_WIDTH * s,
    DESK_TOP_Y * s,
    DESK_HALF_WIDTH * 2 * s,
    (DESK_BOTTOM_Y - DESK_TOP_Y) * s,
  );
  ctx.fillStyle = DESK_TOP_COLOR;
  ctx.fillRect(
    -DESK_HALF_WIDTH * s,
    DESK_TOP_Y * s,
    DESK_HALF_WIDTH * 2 * s,
    DESK_SURFACE_DEPTH * s,
  );
  ctx.fillStyle = DESK_EDGE_COLOR;
  ctx.fillRect(
    -DESK_HALF_WIDTH * s,
    (DESK_BOTTOM_Y - DESK_SURFACE_DEPTH) * s,
    DESK_HALF_WIDTH * 2 * s,
    DESK_SURFACE_DEPTH * s,
  );

  for (const slot of PAPER_SLOTS) {
    ctx.save();
    ctx.translate(slot.x * s, slot.y * s);
    ctx.rotate(slot.tilt);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, -PAPER_HEIGHT * s, PAPER_WIDTH * s, PAPER_HEIGHT * s);
    ctx.fillStyle = PAPER_INK_COLOR;
    ctx.fillRect(
      PAPER_LINE_INSET * s,
      (-PAPER_HEIGHT + PAPER_LINE_INSET) * s,
      (PAPER_WIDTH - PAPER_LINE_INSET * 2) * s,
      DESK_INK_LINE_THICKNESS * s,
    );
    ctx.restore();
  }

  ctx.fillStyle = INKWELL_COLOR;
  ctx.fillRect(
    (INKWELL.x - INKWELL.rx) * s,
    (INKWELL.y - INKWELL.height) * s,
    INKWELL.rx * 2 * s,
    INKWELL.height * s,
  );
  fillEllipse(ctx, INKWELL.x * s, (INKWELL.y - INKWELL.height) * s, INKWELL.rx * s, INKWELL.ry * s);
  ctx.strokeStyle = CORPSE_FEATHER_LIGHT;
  ctx.lineWidth = QUILL_THICKNESS * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(INKWELL.x * s, (INKWELL.y - INKWELL.height) * s);
  ctx.lineTo(QUILL_TIP.x * s, QUILL_TIP.y * s);
  ctx.stroke();

  ctx.fillStyle = DUST_COLOR;
  ctx.fillRect(-DUST_HALF_WIDTH * s, DUST_Y * s, DUST_HALF_WIDTH * 2 * s, DUST_HEIGHT * s);

  ctx.restore();
}
