/**
 * The hall of mirrors' two readers' aids: the dotted ghost of where the light
 * will go after the next blow on a mirror, and the "BRAVO" marquee the encore
 * star lights.
 *
 * Both are drawn live and never cached. The ghost moves every frame and the
 * marquee is a handful of dots and one word, cheaper to paint than to hold in
 * the prop cache, which is already close to its budget.
 */

import type { BeamDirection } from '../../../map/bigTopMazeLayout';
import { drawText } from '../../../ui/TextBox';
import {
  BLOOD,
  BONE,
  BRASS,
  FULL_TURN,
  GILT_GLINT,
  IRON,
  inkCurrentPath,
  outlineWidth,
  rgba,
} from './stagePropKit';

type Ctx = CanvasRenderingContext2D;

// ── The turn preview ────────────────────────────────────────────────────────

/** Dots per tile along the ghost path. */
const PREVIEW_DOTS_PER_TILE = 3;
/** A dot's radius, as a share of the tile. */
const PREVIEW_DOT_RADIUS = 0.055;
/** How far the dots march along the path each frame, in tiles: slow enough to read as a line. */
const PREVIEW_MARCH_TILES_PER_FRAME = 0.012;
/**
 * The ghost's strength. Faint on purpose: it is a question — "if I knock this
 * mirror" — and must never be mistaken for the live beam or for the hot span.
 */
const PREVIEW_DOT_ALPHA = 0.55;
/** A ring round the star the ghost would land on, as a share of the tile. */
const PREVIEW_STAR_RING_RADIUS = 0.42;
const PREVIEW_STAR_RING_ALPHA = 0.5;
/** Dash and gap of the star ring, as shares of the tile. */
const PREVIEW_RING_DASH = 0.08;
const PREVIEW_RING_GAP = 0.07;

/** One tile of the ghost path the light would take after the next blow. */
export function drawTurnPreviewTile(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  heading: BeamDirection,
  phase: number,
): void {
  const vertical = heading === 'north' || heading === 'south';
  const forward = heading === 'south' || heading === 'east' ? 1 : -1;
  const spacing = 1 / PREVIEW_DOTS_PER_TILE;
  const march = (((phase * PREVIEW_MARCH_TILES_PER_FRAME * forward) % spacing) + spacing) % spacing;
  const radius = Math.max(1, PREVIEW_DOT_RADIUS * size);
  ctx.save();
  try {
    ctx.fillStyle = rgba(GILT_GLINT, PREVIEW_DOT_ALPHA);
    ctx.strokeStyle = rgba(IRON.shadow, PREVIEW_DOT_ALPHA);
    ctx.lineWidth = outlineWidth(size);
    for (let dot = 0; dot < PREVIEW_DOTS_PER_TILE; dot++) {
      const along = (dot * spacing + march) * size;
      const centreX = vertical ? x + size / 2 : x + along;
      const centreY = vertical ? y + along : y + size / 2;
      ctx.beginPath();
      ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
      ctx.fill();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/** A dashed ring on the star the ghost path would land on. */
export function drawTurnPreviewStarRing(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  phase: number,
): void {
  ctx.save();
  try {
    ctx.strokeStyle = rgba(GILT_GLINT, PREVIEW_STAR_RING_ALPHA);
    ctx.lineWidth = outlineWidth(size);
    ctx.setLineDash([PREVIEW_RING_DASH * size, PREVIEW_RING_GAP * size]);
    ctx.lineDashOffset = -phase * PREVIEW_MARCH_TILES_PER_FRAME * size;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, PREVIEW_STAR_RING_RADIUS * size, 0, FULL_TURN);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

// ── The bravo rig ───────────────────────────────────────────────────────────

/** How the marquee looks: dark until the encore latches, then chasing. */
export interface BravoRigArt {
  /** 0 dark, 1 fully lit; eases up as the encore latches. */
  readonly lit: number;
  readonly phase: number;
}

/** The board's width and height in tiles; it hangs on the wall face, clear of the floor. */
export const BRAVO_RIG_WIDTH_TILES = 3;
const BRAVO_RIG_HEIGHT = 0.62;
/** Where the board's top sits below the wall tile's top, as a share of the tile. */
const BRAVO_RIG_TOP = 0.14;
const BRAVO_RIG_CORNER = 0.08;
/** Bulbs along the top and bottom rails. */
const BRAVO_BULBS_PER_RAIL = 11;
const BRAVO_BULB_RADIUS = 0.045;
/** A bulb's inset from the board's edge, as a share of the tile. */
const BRAVO_BULB_INSET = 0.09;
/** Every third bulb is on at once while the chase runs. */
const BRAVO_CHASE_STRIDE = 3;
const BRAVO_CHASE_PERIOD_FRAMES = 8;
/** The unlit board's bulbs still catch a little of the hall's light. */
const BRAVO_DEAD_BULB_ALPHA = 0.35;
/** A chasing bulb that is between flashes is still dimly on. */
const BRAVO_OFF_BEAT_ALPHA = 0.35;
const BRAVO_LETTER_SIZE = 0.34;
/** The letters' top, below the board's top, as a share of the tile. */
const BRAVO_LETTER_TOP = 0.15;
const BRAVO_DARK_LETTER_ALPHA = 0.45;
const BRAVO_LETTER_GLOW_BLUR = 6;
const BRAVO_TEXT = 'BRAVO';

/**
 * The encore's reward made visible: a small marquee board on the hall's north
 * wall, dark with dead bulbs until the encore star latches, then lettered in
 * lit gold with a chase running round it. `x` is the left of the first wall
 * tile it spans.
 */
export function drawBravoRig(ctx: Ctx, x: number, y: number, size: number, art: BravoRigArt): void {
  const width = BRAVO_RIG_WIDTH_TILES * size;
  const top = y + BRAVO_RIG_TOP * size;
  const height = BRAVO_RIG_HEIGHT * size;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.roundRect(x, top, width, height, BRAVO_RIG_CORNER * size);
    ctx.fillStyle = rgba(BLOOD.shadow, 1);
    ctx.fill();
    inkCurrentPath(ctx, size);
    ctx.strokeStyle = rgba(BRASS.mid, 1);
    ctx.lineWidth = outlineWidth(size);
    ctx.beginPath();
    ctx.roundRect(
      x + outlineWidth(size),
      top + outlineWidth(size),
      width - 2 * outlineWidth(size),
      height - 2 * outlineWidth(size),
      BRAVO_RIG_CORNER * size,
    );
    ctx.stroke();

    const chaseStep = Math.floor(art.phase / BRAVO_CHASE_PERIOD_FRAMES);
    const radius = Math.max(1, BRAVO_BULB_RADIUS * size);
    const inset = BRAVO_BULB_INSET * size;
    const span = width - 2 * inset;
    for (const railY of [top + inset, top + height - inset]) {
      for (let bulb = 0; bulb < BRAVO_BULBS_PER_RAIL; bulb++) {
        const bulbX = x + inset + (span * bulb) / (BRAVO_BULBS_PER_RAIL - 1);
        const onBeat = (bulb + chaseStep) % BRAVO_CHASE_STRIDE === 0;
        const litAlpha = onBeat ? 1 : BRAVO_OFF_BEAT_ALPHA;
        const deadAlpha = BRAVO_DEAD_BULB_ALPHA * (1 - art.lit);
        ctx.fillStyle = rgba(BONE.shadow, deadAlpha);
        ctx.beginPath();
        ctx.arc(bulbX, railY, radius, 0, FULL_TURN);
        ctx.fill();
        if (art.lit <= 0) continue;
        ctx.fillStyle = rgba(GILT_GLINT, litAlpha * art.lit);
        ctx.fill();
      }
    }
  } finally {
    ctx.restore();
  }

  const lit = art.lit > 0;
  drawText(ctx, BRAVO_TEXT, {
    x,
    y: top + BRAVO_LETTER_TOP * size,
    width,
    align: 'center',
    size: Math.max(1, Math.round(BRAVO_LETTER_SIZE * size)),
    bold: true,
    color: lit ? rgba(GILT_GLINT, 1) : rgba(BRASS.shadow, 1),
    alpha: lit ? Math.max(BRAVO_DARK_LETTER_ALPHA, art.lit) : BRAVO_DARK_LETTER_ALPHA,
    glow: lit ? rgba(BRASS.accent, art.lit) : false,
    glowBlur: BRAVO_LETTER_GLOW_BLUR,
  });
}
