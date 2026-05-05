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

  const w = bodyDef.img.naturalWidth;
  const h = bodyDef.img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw the base body (feathers, beak, eyes, talons, shadow).
  ctx.drawImage(bodyDef.img, 0, 0);

  // Tint each clothing mask with its palette color using destination-in compositing:
  // fill solid color → clip to mask alpha → draw onto baked canvas.
  const clothingLayers: Array<[HTMLImageElement, string]> = [
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
    tc.drawImage(maskImg, 0, 0);

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
