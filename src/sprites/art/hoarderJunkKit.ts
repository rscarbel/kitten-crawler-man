/**
 * The junk the Hoarder's lair is built from, as a kit of small painters.
 *
 * Every heap in the room — a pile, a teetering tower, the barricade across the
 * door — is a list of these items drawn back to front. Each item knows two
 * things: its silhouette, and how to paint itself. The silhouettes of a whole
 * heap are inked first, fat, in one dark colour, and the items are painted over
 * that; what survives of the ink is an outline around the heap's outer edge
 * only, which is what lets a pile of forty overlapping things read as one
 * object at 32 pixels instead of as noise.
 *
 * Drawn in the game's three-quarter view, lit from the upper left: a box shows
 * its lid and its front, the lid lighter, and anything round carries its
 * highlight on the upper-left shoulder. Coordinates are sheet pixels at
 * {@link JUNK_TILE_PX} per game tile.
 */

import type { Rng } from '../person/rng';

/** Sheet pixels per game tile the lair's art is painted at. */
export const JUNK_TILE_PX = 64;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/** How far the shared ink reaches past each silhouette: one game pixel once shrunk to 32. */
const OUTLINE_WIDTH_PX = 4;
export const JUNK_OUTLINE = '#1a120b';

// ── Colour ───────────────────────────────────────────────────────────────────

const HEX_RADIX = 16;
const HEX_CHANNEL_LENGTH = 2;
const RED_START = 1;
const GREEN_START = RED_START + HEX_CHANNEL_LENGTH;
const BLUE_START = GREEN_START + HEX_CHANNEL_LENGTH;
const CHANNEL_MAX = 255;

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(RED_START, RED_START + HEX_CHANNEL_LENGTH), HEX_RADIX),
    Number.parseInt(hex.slice(GREEN_START, GREEN_START + HEX_CHANNEL_LENGTH), HEX_RADIX),
    Number.parseInt(hex.slice(BLUE_START, BLUE_START + HEX_CHANNEL_LENGTH), HEX_RADIX),
  ];
}

/**
 * `a` moved toward `b` by `t` (0..1), as `#rrggbb` — hex rather than `rgb()`,
 * so a mixed colour can be mixed again.
 */
export function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const blend = (i: number): string =>
    Math.round(Math.min(CHANNEL_MAX, Math.max(0, ca[i] + (cb[i] - ca[i]) * t)))
      .toString(HEX_RADIX)
      .padStart(HEX_CHANNEL_LENGTH, '0');
  return `#${blend(0)}${blend(1)}${blend(2)}`;
}

/** `hex` at `alpha`, as an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

const LIGHT = '#fff4dc';
const SHADOW = '#140c06';

/** A colour lit toward warm lamplight, or dropped toward the room's brown dark. */
export function lit(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, LIGHT, amount) : mix(hex, SHADOW, -amount);
}

// ── Items ────────────────────────────────────────────────────────────────────

/** One thing in a heap. */
export interface JunkItem {
  /** Adds the item's outer edge to the current path, for the shared ink. */
  silhouette(ctx: CanvasRenderingContext2D): void;
  paint(ctx: CanvasRenderingContext2D): void;
}

/**
 * Paints a heap: every silhouette inked fat first, then every item over it in
 * list order (back first).
 */
export function drawJunk(ctx: CanvasRenderingContext2D, items: readonly JunkItem[]): void {
  ctx.save();
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.strokeStyle = JUNK_OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH_PX;
  ctx.lineJoin = 'round';
  for (const item of items) {
    ctx.beginPath();
    item.silhouette(ctx);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  for (const item of items) {
    ctx.save();
    item.paint(ctx);
    ctx.restore();
  }
}

/**
 * An item drawn under a transform — tilted by a wobble, laid down by a fall.
 * The transform is applied around both passes, so the ink follows the item.
 */
export function transformed(
  item: JunkItem,
  apply: (ctx: CanvasRenderingContext2D) => void,
): JunkItem {
  return {
    silhouette: (ctx) => {
      ctx.save();
      apply(ctx);
      item.silhouette(ctx);
      ctx.restore();
    },
    paint: (ctx) => {
      ctx.save();
      apply(ctx);
      item.paint(ctx);
      ctx.restore();
    },
  };
}

/** An item rocked `angle` radians about a point, usually where it rests. */
export function tilted(item: JunkItem, pivotX: number, pivotY: number, angle: number): JunkItem {
  return transformed(item, (ctx) => {
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    ctx.translate(-pivotX, -pivotY);
  });
}

function rectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.rect(x, y, w, h);
}

/** A soft dark ellipse on the floor under something standing on it. */
export function contactShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, withAlpha(SHADOW, alpha));
  shade.addColorStop(CONTACT_SHADOW_CORE, withAlpha(SHADOW, alpha * CONTACT_SHADOW_CORE));
  shade.addColorStop(1, withAlpha(SHADOW, 0));
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}
const CONTACT_SHADOW_CORE = 0.55;

// ── Cardboard box ────────────────────────────────────────────────────────────

const CARDBOARD = '#b08450';
const CARDBOARD_TAPE = '#d8c18c';
const CARDBOARD_PRINT = '#5a3b1c';
/** The lid catches the lamp; the front is in its own shade. */
const LID_LIGHT = 0.28;
const FRONT_SHADE = -0.08;
const RIGHT_EDGE_SHADE = -0.3;
const RIGHT_EDGE_SHARE = 0.18;
const TAPE_WIDTH_SHARE = 0.16;
const FLAP_SEAM_ALPHA = 0.55;
const PRINT_ALPHA = 0.55;
const DENT_ALPHA = 0.35;

export interface BoxSpec {
  /** Left edge of the front face. */
  readonly x: number;
  /** Where the front face meets the floor (or whatever it sits on). */
  readonly baseY: number;
  readonly w: number;
  /** Height of the front face. */
  readonly h: number;
  /** Depth of the lid as the camera sees it. */
  readonly d: number;
  /** -1..1 shift of the cardboard's colour, so no two boxes match. */
  readonly tone: number;
  readonly rng: Rng;
}

export function box(spec: BoxSpec): JunkItem {
  const { x, baseY, w, h, d, tone, rng } = spec;
  const top = baseY - h - d;
  const frontTop = baseY - h;
  const base = lit(CARDBOARD, tone * TONE_SWING);
  const tapeAcross = rng() < HALF;
  const printed = rng() < PRINT_CHANCE;
  const dentX = x + w * (DENT_MIN_SHARE + rng() * DENT_SPAN_SHARE);
  return {
    silhouette: (ctx) => rectPath(ctx, x, top, w, h + d),
    paint: (ctx) => {
      ctx.fillStyle = lit(base, FRONT_SHADE);
      ctx.fillRect(x, frontTop, w, h);
      ctx.fillStyle = lit(base, RIGHT_EDGE_SHADE);
      ctx.fillRect(x + w * (1 - RIGHT_EDGE_SHARE), frontTop, w * RIGHT_EDGE_SHARE, h);
      ctx.fillStyle = lit(base, LID_LIGHT);
      ctx.fillRect(x, top, w, d);
      // The flap seam down the middle of the lid.
      ctx.strokeStyle = withAlpha(CARDBOARD_PRINT, FLAP_SEAM_ALPHA);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top + d * HALF);
      ctx.lineTo(x + w, top + d * HALF);
      ctx.stroke();
      ctx.fillStyle = CARDBOARD_TAPE;
      if (tapeAcross) {
        ctx.fillRect(
          x + w * (HALF - TAPE_WIDTH_SHARE / 2),
          top,
          w * TAPE_WIDTH_SHARE,
          d + h * HALF,
        );
      } else {
        ctx.fillRect(x, top + d * HALF - 1, w, TAPE_THICKNESS_PX);
      }
      if (printed) {
        ctx.fillStyle = withAlpha(CARDBOARD_PRINT, PRINT_ALPHA);
        const markW = w * PRINT_W_SHARE;
        const markH = Math.max(2, h * PRINT_H_SHARE);
        ctx.fillRect(x + w * PRINT_X_SHARE, frontTop + h * PRINT_Y_SHARE, markW, markH);
        ctx.fillRect(
          x + w * PRINT_X_SHARE,
          frontTop + h * PRINT_Y_SHARE + markH + 1,
          markW * HALF,
          1,
        );
      }
      // A crush in the front face, lit on its lower lip.
      ctx.strokeStyle = withAlpha(SHADOW, DENT_ALPHA);
      ctx.beginPath();
      ctx.moveTo(dentX, frontTop + 1);
      ctx.lineTo(dentX + DENT_RUN_PX, frontTop + h * HALF);
      ctx.stroke();
      // The lamp side of the lid's front edge.
      ctx.fillStyle = withAlpha(LIGHT, LID_EDGE_ALPHA);
      ctx.fillRect(x, frontTop - 1, w * (1 - RIGHT_EDGE_SHARE), 1);
    },
  };
}
const TONE_SWING = 0.22;
const PRINT_CHANCE = 0.6;
const DENT_MIN_SHARE = 0.2;
const DENT_SPAN_SHARE = 0.5;
const DENT_RUN_PX = 3;
const TAPE_THICKNESS_PX = 3;
const PRINT_W_SHARE = 0.34;
const PRINT_H_SHARE = 0.22;
const PRINT_X_SHARE = 0.16;
const PRINT_Y_SHARE = 0.28;
const LID_EDGE_ALPHA = 0.35;

// ── Other containers: a storage tub, a suitcase, a dead television ─────────

/** A box-shaped thing that is not cardboard. */
export type ContainerKind = 'bin' | 'suitcase' | 'tv';

export interface ContainerSpec {
  readonly kind: ContainerKind;
  readonly x: number;
  readonly baseY: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly rng: Rng;
}

const BIN_BLUE = '#4a78a6';
const BIN_LID = '#2f5073';
const BIN_CONTENT_COLOURS: readonly string[] = ['#c9a45c', '#b3322b', '#d3cbb2', '#6d8a3a'];
const BIN_CONTENT_ALPHA = 0.45;
const BIN_CONTENTS = 5;
const SUITCASE = '#6e3f22';
const SUITCASE_STRAP = '#3c2212';
const SUITCASE_LATCH = '#d4b04a';
const TV_CASE = '#5d5a55';
const TV_SCREEN = '#1f2a2a';
const TV_GLARE = '#9fb8b0';
const TV_KNOB = '#2a2826';
const TV_SCREEN_SHARE = 0.66;
const TV_BEZEL_PX = 3;
const TV_GLARE_ALPHA = 0.45;
const TV_KNOB_PX = 3;
const SUITCASE_STRAP_SHARE = 0.25;
const SUITCASE_LATCH_PX = 2;
const SUITCASE_HANDLE_SHARE = 0.3;
const SUITCASE_HANDLE_RISE = 4;

/** A storage tub, a suitcase or a television: the same block as a box, dressed differently. */
export function container(spec: ContainerSpec): JunkItem {
  const { kind, x, baseY, w, h, d, rng } = spec;
  const top = baseY - h - d;
  const frontTop = baseY - h;
  const contents: Array<{ x: number; y: number; r: number; colour: string }> = [];
  for (let i = 0; i < BIN_CONTENTS; i++) {
    contents.push({
      x: x + rng() * w,
      y: frontTop + rng() * h,
      r: 2 + rng() * (h * HALF),
      colour: BIN_CONTENT_COLOURS[i % BIN_CONTENT_COLOURS.length],
    });
  }
  const faces = (ctx: CanvasRenderingContext2D, body: string, lid: string): void => {
    ctx.fillStyle = lit(body, FRONT_SHADE);
    ctx.fillRect(x, frontTop, w, h);
    ctx.fillStyle = lit(body, RIGHT_EDGE_SHADE);
    ctx.fillRect(x + w * (1 - RIGHT_EDGE_SHARE), frontTop, w * RIGHT_EDGE_SHARE, h);
    ctx.fillStyle = lit(lid, LID_LIGHT);
    ctx.fillRect(x, top, w, d);
    ctx.fillStyle = withAlpha(LIGHT, LID_EDGE_ALPHA);
    ctx.fillRect(x, frontTop - 1, w * (1 - RIGHT_EDGE_SHARE), 1);
  };
  return {
    silhouette: (ctx) => rectPath(ctx, x, top, w, h + d),
    paint: (ctx) => {
      switch (kind) {
        case 'bin':
          faces(ctx, BIN_BLUE, BIN_LID);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, frontTop, w, h);
          ctx.clip();
          for (const blob of contents) {
            ctx.fillStyle = withAlpha(blob.colour, BIN_CONTENT_ALPHA);
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.r, 0, TWO_PI);
            ctx.fill();
          }
          ctx.restore();
          ctx.fillStyle = lit(BIN_LID, FRONT_SHADE);
          ctx.fillRect(x - 1, frontTop, w + 2, 2);
          return;
        case 'suitcase':
          faces(ctx, SUITCASE, SUITCASE);
          ctx.fillStyle = SUITCASE_STRAP;
          ctx.fillRect(x + w * SUITCASE_STRAP_SHARE, top, 2, h + d);
          ctx.fillRect(x + w * (1 - SUITCASE_STRAP_SHARE), top, 2, h + d);
          ctx.fillStyle = SUITCASE_LATCH;
          ctx.fillRect(
            x + w * SUITCASE_STRAP_SHARE - 1,
            frontTop + 1,
            SUITCASE_LATCH_PX,
            SUITCASE_LATCH_PX,
          );
          ctx.fillRect(
            x + w * (1 - SUITCASE_STRAP_SHARE) - 1,
            frontTop + 1,
            SUITCASE_LATCH_PX,
            SUITCASE_LATCH_PX,
          );
          ctx.strokeStyle = SUITCASE_STRAP;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + w * (HALF - SUITCASE_HANDLE_SHARE * HALF), top + d * HALF);
          ctx.quadraticCurveTo(
            x + w * HALF,
            top + d * HALF - SUITCASE_HANDLE_RISE,
            x + w * (HALF + SUITCASE_HANDLE_SHARE * HALF),
            top + d * HALF,
          );
          ctx.stroke();
          return;
        case 'tv': {
          faces(ctx, TV_CASE, TV_CASE);
          const screenW = w * TV_SCREEN_SHARE;
          const screenH = h - TV_BEZEL_PX * 2;
          ctx.fillStyle = TV_SCREEN;
          ctx.beginPath();
          ctx.roundRect(x + TV_BEZEL_PX, frontTop + TV_BEZEL_PX, screenW, screenH, TV_BEZEL_PX);
          ctx.fill();
          ctx.fillStyle = withAlpha(TV_GLARE, TV_GLARE_ALPHA);
          ctx.beginPath();
          ctx.ellipse(
            x + TV_BEZEL_PX + screenW * QUARTER_SHARE,
            frontTop + TV_BEZEL_PX + screenH * QUARTER_SHARE,
            screenW * QUARTER_SHARE,
            screenH * QUARTER_SHARE * HALF,
            -HALF,
            0,
            TWO_PI,
          );
          ctx.fill();
          ctx.fillStyle = TV_KNOB;
          const knobX = x + TV_BEZEL_PX * 2 + screenW;
          ctx.fillRect(knobX, frontTop + TV_BEZEL_PX, TV_KNOB_PX, TV_KNOB_PX);
          ctx.fillRect(knobX, frontTop + TV_BEZEL_PX * 3, TV_KNOB_PX, TV_KNOB_PX);
          return;
        }
      }
    },
  };
}
const QUARTER_SHARE = 0.25;

// ── Newspaper bundle ─────────────────────────────────────────────────────────

const NEWSPRINT = '#d3cbb2';
const NEWSPRINT_INK = '#4a453c';
const TWINE = '#8f6d3e';
/** Page edges stack in bands this far apart on the bundle's front. */
const PAGE_EDGE_SPACING_PX = 2;
const PAGE_EDGE_ALPHA = 0.4;
const HEADLINE_ALPHA = 0.7;
const COLUMN_ALPHA = 0.3;
const YELLOWED = '#b89b5c';

export interface BundleSpec {
  readonly x: number;
  readonly baseY: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  /** 0..1: how far the paper has gone yellow. */
  readonly age: number;
  readonly rng: Rng;
}

/** A tied stack of newspapers: striped page edges on the front, a front page on top. */
export function bundle(spec: BundleSpec): JunkItem {
  const { x, baseY, w, h, d, age, rng } = spec;
  const top = baseY - h - d;
  const frontTop = baseY - h;
  const paper = mix(NEWSPRINT, YELLOWED, age);
  const headlineShare = HEADLINE_MIN_SHARE + rng() * HEADLINE_SPAN_SHARE;
  const hasPhoto = rng() < PHOTO_CHANCE;
  return {
    silhouette: (ctx) => rectPath(ctx, x, top, w, h + d),
    paint: (ctx) => {
      ctx.fillStyle = lit(paper, FRONT_SHADE * 2);
      ctx.fillRect(x, frontTop, w, h);
      ctx.fillStyle = withAlpha(SHADOW, PAGE_EDGE_ALPHA);
      for (let y = frontTop + 1; y < baseY; y += PAGE_EDGE_SPACING_PX) {
        ctx.fillRect(x, y, w, 1);
      }
      ctx.fillStyle = lit(paper, RIGHT_EDGE_SHADE);
      ctx.fillRect(x + w * (1 - RIGHT_EDGE_SHARE), frontTop, w * RIGHT_EDGE_SHARE, h);
      ctx.fillStyle = lit(paper, LID_LIGHT);
      ctx.fillRect(x, top, w, d);
      // A front page: one headline bar, a photo block, columns of grey type.
      ctx.fillStyle = withAlpha(NEWSPRINT_INK, HEADLINE_ALPHA);
      ctx.fillRect(x + TYPE_INSET_PX, top + TYPE_INSET_PX, w * headlineShare, HEADLINE_PX);
      ctx.fillStyle = withAlpha(NEWSPRINT_INK, COLUMN_ALPHA);
      const typeTop = top + TYPE_INSET_PX + HEADLINE_PX + 1;
      for (let y = typeTop; y < top + d - 1; y += TYPE_LINE_SPACING_PX) {
        ctx.fillRect(x + TYPE_INSET_PX, y, w - TYPE_INSET_PX * 2, 1);
      }
      if (hasPhoto) {
        ctx.fillStyle = withAlpha(NEWSPRINT_INK, PHOTO_ALPHA);
        ctx.fillRect(
          x + w * PHOTO_X_SHARE,
          typeTop,
          w * PHOTO_W_SHARE,
          Math.max(2, d - HEADLINE_PX - 4),
        );
      }
      // Twine: once round the front, once across the lid.
      ctx.strokeStyle = TWINE;
      ctx.lineWidth = TWINE_WIDTH_PX;
      ctx.beginPath();
      const twineX = x + w * (HALF + (rng() - HALF) * TWINE_WANDER_SHARE);
      ctx.moveTo(twineX, top);
      ctx.lineTo(twineX, baseY);
      ctx.moveTo(x, top + d * HALF);
      ctx.lineTo(x + w, top + d * HALF);
      ctx.stroke();
    },
  };
}
const HEADLINE_MIN_SHARE = 0.4;
const HEADLINE_SPAN_SHARE = 0.4;
const PHOTO_CHANCE = 0.5;
const TYPE_INSET_PX = 2;
const HEADLINE_PX = 2;
const TYPE_LINE_SPACING_PX = 2;
const PHOTO_ALPHA = 0.45;
const PHOTO_X_SHARE = 0.55;
const PHOTO_W_SHARE = 0.3;
const TWINE_WIDTH_PX = 1.2;
const TWINE_WANDER_SHARE = 0.3;

// ── Plastic bags ─────────────────────────────────────────────────────────────

export interface BagPalette {
  readonly body: string;
  readonly sheen: string;
}

export const BLACK_BAG: BagPalette = { body: '#26282d', sheen: '#9aa3b4' };
export const WHITE_BAG: BagPalette = { body: '#bfc2b8', sheen: '#f4f5ee' };
export const BLUE_BAG: BagPalette = { body: '#35527a', sheen: '#9fc0e6' };
export const BROWN_SACK: BagPalette = { body: '#8a6a40', sheen: '#d8bf8c' };

const BAG_LOBES = 5;
const BAG_LOBE_WOBBLE = 0.14;
const BAG_BELLY_SHADE = -0.35;
const BAG_SHEEN_ALPHA = 0.55;
const BAG_CREASE_ALPHA = 0.5;
const BAG_KNOT_SHARE = 0.22;

export interface BagSpec {
  readonly cx: number;
  readonly baseY: number;
  readonly rx: number;
  readonly ry: number;
  readonly palette: BagPalette;
  /** Whether the tied neck shows on top. */
  readonly knot: boolean;
  readonly rng: Rng;
}

/** A stuffed plastic bag: a lumpy sack, glossy on its shoulders, creased where it sags. */
export function bag(spec: BagSpec): JunkItem {
  const { cx, baseY, rx, ry, palette, knot, rng } = spec;
  const cy = baseY - ry;
  const wobble: number[] = [];
  for (let i = 0; i < BAG_LOBES; i++) wobble.push(1 + (rng() - HALF) * 2 * BAG_LOBE_WOBBLE);
  const outline = (ctx: CanvasRenderingContext2D): void => {
    const steps = BAG_OUTLINE_STEPS;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * TWO_PI;
      const lobe = wobble[Math.floor((i / steps) * BAG_LOBES) % BAG_LOBES];
      // Flattened underneath: a full sack sags onto whatever it sits on.
      const sag = Math.sin(angle) > 0 ? BAG_SAG_FLATTEN : 1;
      const px = cx + Math.cos(angle) * rx * lobe;
      const py = cy + Math.sin(angle) * ry * lobe * sag;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (knot) {
      const knotW = rx * BAG_KNOT_SHARE;
      ctx.moveTo(cx - knotW, cy - ry * BAG_NECK_SHARE);
      ctx.lineTo(cx - knotW * 2, cy - ry - knotW * 2);
      ctx.lineTo(cx, cy - ry - knotW);
      ctx.lineTo(cx + knotW * 2, cy - ry - knotW * 2);
      ctx.lineTo(cx + knotW, cy - ry * BAG_NECK_SHARE);
      ctx.closePath();
    }
  };
  return {
    silhouette: outline,
    paint: (ctx) => {
      ctx.beginPath();
      outline(ctx);
      const body = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx * HALF, cy + ry);
      body.addColorStop(0, lit(palette.body, BAG_SHOULDER_LIGHT));
      body.addColorStop(BAG_BODY_MID_STOP, palette.body);
      body.addColorStop(1, lit(palette.body, BAG_BELLY_SHADE));
      ctx.fillStyle = body;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Sheen: two short glossy strokes on the lit shoulder.
      ctx.strokeStyle = withAlpha(palette.sheen, BAG_SHEEN_ALPHA);
      ctx.lineWidth = BAG_SHEEN_WIDTH_PX;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(
        cx - rx * BAG_SHEEN_OFFSET,
        cy - ry * BAG_SHEEN_OFFSET,
        rx * BAG_SHEEN_RADIUS,
        Math.PI * BAG_SHEEN_START,
        Math.PI * BAG_SHEEN_END,
      );
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        cx + rx * BAG_SHEEN_SECOND_X,
        cy - ry * BAG_SHEEN_SECOND_Y,
        rx * BAG_SHEEN_RADIUS * HALF,
        Math.PI * BAG_SHEEN_START,
        Math.PI * BAG_SHEEN_END,
      );
      ctx.stroke();
      // Creases where the plastic folds as it sags.
      ctx.strokeStyle = withAlpha(SHADOW, BAG_CREASE_ALPHA);
      for (let i = 0; i < BAG_CREASES; i++) {
        const startX = cx + (rng() - HALF) * rx * BAG_CREASE_SPREAD;
        const startY = cy + (rng() - HALF) * ry;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(
          startX + rx * BAG_CREASE_BEND,
          startY + ry * BAG_CREASE_DROP,
          startX + rx * BAG_CREASE_RUN,
          startY + ry * BAG_CREASE_DROP * 2,
        );
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}
const BAG_OUTLINE_STEPS = 24;
const BAG_SAG_FLATTEN = 0.8;
const BAG_NECK_SHARE = 0.8;
const BAG_SHOULDER_LIGHT = 0.18;
const BAG_BODY_MID_STOP = 0.45;
const BAG_SHEEN_WIDTH_PX = 2;
const BAG_SHEEN_OFFSET = 0.25;
const BAG_SHEEN_RADIUS = 0.55;
const BAG_SHEEN_START = 1.1;
const BAG_SHEEN_END = 1.45;
const BAG_SHEEN_SECOND_X = 0.3;
const BAG_SHEEN_SECOND_Y = 0.35;
const BAG_CREASES = 3;
const BAG_CREASE_SPREAD = 1.4;
const BAG_CREASE_BEND = 0.2;
const BAG_CREASE_DROP = 0.18;
const BAG_CREASE_RUN = 0.35;

// ── Sticks: chair legs, a broom handle, a curtain rod ───────────────────────

export interface StickPalette {
  readonly body: string;
  readonly tip?: string;
}
export const WOOD_LEG: StickPalette = { body: '#7a5230', tip: '#4a2f18' };
export const BROOM_HANDLE: StickPalette = { body: '#a8835a', tip: '#c43a2e' };
export const CURTAIN_ROD: StickPalette = { body: '#b9a36a', tip: '#8a7440' };

export interface StickSpec {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly palette: StickPalette;
}

/** Something long poking out of the heap, lit along its upper edge. */
export function stick(spec: StickSpec): JunkItem {
  const { x0, y0, x1, y1, width, palette } = spec;
  const trace = (ctx: CanvasRenderingContext2D): void => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) return;
    const nx = (-(y1 - y0) / length) * width * HALF;
    const ny = ((x1 - x0) / length) * width * HALF;
    ctx.moveTo(x0 + nx, y0 + ny);
    ctx.lineTo(x1 + nx, y1 + ny);
    ctx.lineTo(x1 - nx, y1 - ny);
    ctx.lineTo(x0 - nx, y0 - ny);
    ctx.closePath();
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = lit(palette.body, STICK_HIGHLIGHT);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - width * STICK_HIGHLIGHT_OFFSET);
      ctx.lineTo(x1, y1 - width * STICK_HIGHLIGHT_OFFSET);
      ctx.stroke();
      if (palette.tip !== undefined) {
        ctx.fillStyle = palette.tip;
        ctx.beginPath();
        ctx.arc(x1, y1, width * STICK_TIP_SHARE, 0, TWO_PI);
        ctx.fill();
      }
    },
  };
}
const STICK_HIGHLIGHT = 0.35;
const STICK_HIGHLIGHT_OFFSET = 0.2;
const STICK_TIP_SHARE = 0.65;

// ── Bottles and cans ─────────────────────────────────────────────────────────

export const GREEN_GLASS = '#3f6e3a';
export const BROWN_GLASS = '#6b3d1a';
export const CLEAR_GLASS = '#9fb7ae';
const GLASS_GLINT = '#e8f6de';
const BOTTLE_NECK_SHARE = 0.35;
const BOTTLE_NECK_WIDTH_SHARE = 0.4;
const BOTTLE_GLINT_ALPHA = 0.8;

export interface BottleSpec {
  readonly x: number;
  readonly baseY: number;
  readonly w: number;
  readonly h: number;
  readonly glass: string;
  /** Radians from upright, positive leaning right. */
  readonly lean: number;
}

/** A bottle, standing or knocked over, with one bright glint on its shoulder. */
export function bottle(spec: BottleSpec): JunkItem {
  const { x, baseY, w, h, glass, lean } = spec;
  const shape = (ctx: CanvasRenderingContext2D): void => {
    const neckW = w * BOTTLE_NECK_WIDTH_SHARE;
    const shoulderY = -h * (1 - BOTTLE_NECK_SHARE);
    ctx.moveTo(-w * HALF, 0);
    ctx.lineTo(-w * HALF, shoulderY);
    ctx.lineTo(-neckW * HALF, shoulderY - w * HALF);
    ctx.lineTo(-neckW * HALF, -h);
    ctx.lineTo(neckW * HALF, -h);
    ctx.lineTo(neckW * HALF, shoulderY - w * HALF);
    ctx.lineTo(w * HALF, shoulderY);
    ctx.lineTo(w * HALF, 0);
    ctx.closePath();
  };
  const place = (ctx: CanvasRenderingContext2D): void => {
    ctx.translate(x + w * HALF, baseY);
    ctx.rotate(lean);
  };
  return transformed(
    {
      silhouette: shape,
      paint: (ctx) => {
        ctx.beginPath();
        shape(ctx);
        ctx.fillStyle = glass;
        ctx.fill();
        ctx.fillStyle = lit(glass, RIGHT_EDGE_SHADE);
        ctx.fillRect(
          w * (HALF - RIGHT_EDGE_SHARE * 2),
          -h * (1 - BOTTLE_NECK_SHARE),
          w * RIGHT_EDGE_SHARE * 2,
          h * (1 - BOTTLE_NECK_SHARE),
        );
        ctx.fillStyle = withAlpha(GLASS_GLINT, BOTTLE_GLINT_ALPHA);
        ctx.fillRect(
          -w * BOTTLE_GLINT_X_SHARE,
          -h * BOTTLE_GLINT_Y_SHARE,
          BOTTLE_GLINT_W_PX,
          h * BOTTLE_GLINT_H_SHARE,
        );
      },
    },
    place,
  );
}
const BOTTLE_GLINT_X_SHARE = 0.3;
const BOTTLE_GLINT_Y_SHARE = 0.6;
const BOTTLE_GLINT_W_PX = 1.5;
const BOTTLE_GLINT_H_SHARE = 0.3;

const CAN_RED = '#b3322b';
const CAN_SILVER = '#cfcfc8';
const CAN_BAND_SHARE = 0.4;

/** A soda can on its side. */
export function can(cx: number, cy: number, length: number, radius: number): JunkItem {
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.rect(cx - length * HALF, cy - radius, length, radius * 2);
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.fillStyle = CAN_RED;
      ctx.fillRect(cx - length * HALF, cy - radius, length, radius * 2);
      ctx.fillStyle = lit(CAN_RED, LID_LIGHT);
      ctx.fillRect(cx - length * HALF, cy - radius, length, radius * CAN_BAND_SHARE);
      ctx.fillStyle = CAN_SILVER;
      ctx.fillRect(cx + length * HALF - CAN_RIM_PX, cy - radius, CAN_RIM_PX, radius * 2);
      ctx.fillStyle = withAlpha(LIGHT, CAN_WORDMARK_ALPHA);
      ctx.fillRect(cx - length * CAN_WORDMARK_SHARE, cy - 1, length * CAN_WORDMARK_SHARE, 1);
    },
  };
}
const CAN_RIM_PX = 2;
const CAN_WORDMARK_ALPHA = 0.7;
const CAN_WORDMARK_SHARE = 0.3;

// ── Keepsakes: lampshade, teddy bear, tyre, picture frame ───────────────────

const LAMPSHADE = '#d6bd72';
const LAMPSHADE_PLEAT_ALPHA = 0.35;
const LAMPSHADE_PLEAT_SPACING_PX = 3;

export function lampshade(
  cx: number,
  baseY: number,
  topW: number,
  bottomW: number,
  h: number,
): JunkItem {
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(cx - topW * HALF, baseY - h);
    ctx.lineTo(cx + topW * HALF, baseY - h);
    ctx.lineTo(cx + bottomW * HALF, baseY);
    ctx.lineTo(cx - bottomW * HALF, baseY);
    ctx.closePath();
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      const glow = ctx.createLinearGradient(cx - bottomW * HALF, 0, cx + bottomW * HALF, 0);
      glow.addColorStop(0, lit(LAMPSHADE, LID_LIGHT));
      glow.addColorStop(1, lit(LAMPSHADE, RIGHT_EDGE_SHADE));
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = withAlpha(SHADOW, LAMPSHADE_PLEAT_ALPHA);
      ctx.lineWidth = 1;
      for (let dx = -bottomW * HALF; dx < bottomW * HALF; dx += LAMPSHADE_PLEAT_SPACING_PX) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * (topW / bottomW), baseY - h);
        ctx.lineTo(cx + dx, baseY);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = lit(LAMPSHADE, FRONT_SHADE * 3);
      ctx.fillRect(cx - bottomW * HALF, baseY - LAMPSHADE_TRIM_PX, bottomW, LAMPSHADE_TRIM_PX);
    },
  };
}
const LAMPSHADE_TRIM_PX = 2;

const TEDDY = '#8a5a34';
const TEDDY_MUZZLE = '#c49a6a';
const TEDDY_EYE = '#120c08';

/** A one-eared teddy bear sitting in the junk, looking at nothing. */
export function teddy(cx: number, baseY: number, size: number): JunkItem {
  const headR = size * TEDDY_HEAD_SHARE;
  const bodyR = size * TEDDY_BODY_SHARE;
  const headY = baseY - bodyR * 2 - headR * TEDDY_NECK_OVERLAP;
  const bodyY = baseY - bodyR;
  const earR = headR * TEDDY_EAR_SHARE;
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(cx + bodyR, bodyY);
    ctx.arc(cx, bodyY, bodyR, 0, TWO_PI);
    ctx.moveTo(cx + headR, headY);
    ctx.arc(cx, headY, headR, 0, TWO_PI);
    ctx.moveTo(cx - headR * TEDDY_EAR_X + earR, headY - headR * TEDDY_EAR_Y);
    ctx.arc(cx - headR * TEDDY_EAR_X, headY - headR * TEDDY_EAR_Y, earR, 0, TWO_PI);
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      ctx.fillStyle = TEDDY;
      ctx.fill();
      ctx.fillStyle = lit(TEDDY, LID_LIGHT);
      ctx.beginPath();
      ctx.arc(
        cx - headR * TEDDY_LIGHT_OFFSET,
        headY - headR * TEDDY_LIGHT_OFFSET,
        headR * HALF,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.fillStyle = TEDDY_MUZZLE;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        headY + headR * TEDDY_MUZZLE_DROP,
        headR * TEDDY_MUZZLE_RX,
        headR * TEDDY_MUZZLE_RY,
        0,
        0,
        TWO_PI,
      );
      ctx.fill();
      ctx.fillStyle = TEDDY_EYE;
      ctx.fillRect(cx - headR * TEDDY_EYE_SPREAD, headY - 1, TEDDY_EYE_PX, TEDDY_EYE_PX);
      ctx.fillRect(
        cx + headR * TEDDY_EYE_SPREAD - TEDDY_EYE_PX,
        headY - 1,
        TEDDY_EYE_PX,
        TEDDY_EYE_PX,
      );
      // Stuffing where the other ear was.
      ctx.fillStyle = LIGHT;
      ctx.fillRect(
        cx + headR * TEDDY_EAR_X - 1,
        headY - headR * TEDDY_EAR_Y,
        TEDDY_EYE_PX,
        TEDDY_EYE_PX,
      );
    },
  };
}
const TEDDY_HEAD_SHARE = 0.32;
const TEDDY_BODY_SHARE = 0.36;
const TEDDY_NECK_OVERLAP = 0.6;
const TEDDY_EAR_SHARE = 0.38;
const TEDDY_EAR_X = 0.72;
const TEDDY_EAR_Y = 0.78;
const TEDDY_LIGHT_OFFSET = 0.3;
const TEDDY_MUZZLE_DROP = 0.35;
const TEDDY_MUZZLE_RX = 0.42;
const TEDDY_MUZZLE_RY = 0.3;
const TEDDY_EYE_SPREAD = 0.4;
const TEDDY_EYE_PX = 2;

const TYRE = '#1f1f22';
const TYRE_TREAD = '#3c3c41';

/** A tyre lying flat, seen from above at the room's angle. */
export function tyre(cx: number, cy: number, rx: number, ry: number): JunkItem {
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.fillStyle = TYRE;
      ctx.beginPath();
      trace(ctx);
      ctx.fill();
      ctx.strokeStyle = TYRE_TREAD;
      ctx.lineWidth = TYRE_TREAD_PX;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * TYRE_TREAD_SHARE, ry * TYRE_TREAD_SHARE, 0, Math.PI, TWO_PI);
      ctx.stroke();
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * TYRE_HOLE_SHARE, ry * TYRE_HOLE_SHARE, 0, 0, TWO_PI);
      ctx.fill();
    },
  };
}
const TYRE_TREAD_PX = 2;
const TYRE_TREAD_SHARE = 0.8;
const TYRE_HOLE_SHARE = 0.45;

const FRAME_GILT = '#b8913d';
const FRAME_CANVAS = '#5b7684';
const FRAME_SKY = '#8fa6a0';

/** A gilt picture frame leaning in the heap, its painting half hidden. */
export function pictureFrame(
  x: number,
  baseY: number,
  w: number,
  h: number,
  lean: number,
): JunkItem {
  const shape = (ctx: CanvasRenderingContext2D): void => ctx.rect(0, -h, w, h);
  return transformed(
    {
      silhouette: shape,
      paint: (ctx) => {
        ctx.fillStyle = FRAME_GILT;
        ctx.fillRect(0, -h, w, h);
        ctx.fillStyle = lit(FRAME_GILT, LID_LIGHT);
        ctx.fillRect(0, -h, w, FRAME_BORDER_PX);
        ctx.fillStyle = FRAME_SKY;
        ctx.fillRect(
          FRAME_BORDER_PX,
          -h + FRAME_BORDER_PX,
          w - FRAME_BORDER_PX * 2,
          (h - FRAME_BORDER_PX * 2) * HALF,
        );
        ctx.fillStyle = FRAME_CANVAS;
        ctx.fillRect(
          FRAME_BORDER_PX,
          -h * HALF,
          w - FRAME_BORDER_PX * 2,
          h * HALF - FRAME_BORDER_PX,
        );
      },
    },
    (ctx) => {
      ctx.translate(x, baseY);
      ctx.rotate(lean);
    },
  );
}
const FRAME_BORDER_PX = 3;

// ── A chair on its back ──────────────────────────────────────────────────────

const CHAIR_WOOD = '#8a5a30';
const CHAIR_SEAT = '#6e4424';
const CHAIR_LEG_WIDTH = 3;
const CHAIR_LEG_SPLAY = 0.35;
const CHAIR_SEAT_DEPTH_SHARE = 0.45;
const CHAIR_BACK_SHARE = 0.9;

/**
 * A kitchen chair thrown on the heap upside down: its seat, and four legs
 * sticking up into the air — the most readable silhouette a heap can have.
 */
export function upturnedChair(cx: number, seatY: number, w: number, legLength: number): JunkItem {
  const legs: JunkItem[] = [];
  const seatDepth = w * CHAIR_SEAT_DEPTH_SHARE;
  const feet: ReadonlyArray<readonly [number, number]> = [
    [-HALF, 0],
    [HALF, 0],
    [-HALF, -1],
    [HALF, -1],
  ];
  for (const [side, back] of feet) {
    const x0 = cx + side * w;
    const y0 = seatY + back * seatDepth;
    legs.push(
      stick({
        x0,
        y0,
        x1: x0 + side * legLength * CHAIR_LEG_SPLAY,
        y1: y0 - legLength,
        width: CHAIR_LEG_WIDTH,
        palette: { body: CHAIR_WOOD },
      }),
    );
  }
  const seatTrace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(cx - w * HALF, seatY);
    ctx.lineTo(cx + w * HALF, seatY);
    ctx.lineTo(cx + w * HALF, seatY - seatDepth);
    ctx.lineTo(cx - w * HALF, seatY - seatDepth);
    ctx.closePath();
    // The back, hanging down behind the seat.
    ctx.rect(cx - w * HALF, seatY, w, seatDepth * CHAIR_BACK_SHARE);
  };
  const seat: JunkItem = {
    silhouette: seatTrace,
    paint: (ctx) => {
      ctx.beginPath();
      seatTrace(ctx);
      ctx.fillStyle = CHAIR_SEAT;
      ctx.fill();
      ctx.fillStyle = lit(CHAIR_WOOD, LID_LIGHT);
      ctx.fillRect(cx - w * HALF, seatY - seatDepth, w, 1);
    },
  };
  // Back legs first: they are further from the camera.
  return composite([legs[2], legs[3], seat, legs[0], legs[1]]);
}

/** Several items drawn as one, in order. */
export function composite(parts: readonly JunkItem[]): JunkItem {
  return {
    silhouette: (ctx) => {
      for (const part of parts) part.silhouette(ctx);
    },
    paint: (ctx) => {
      for (const part of parts) {
        ctx.save();
        part.paint(ctx);
        ctx.restore();
      }
    },
  };
}

// ── The mound under everything ──────────────────────────────────────────────

const MOUND = '#3d3022';
const MOUND_SCRAPS: readonly string[] = [
  '#6d5a3c',
  '#7d6a48',
  '#8c3b2e',
  '#3f6b5a',
  '#b89a4a',
  '#b9b2a0',
  '#5a4a30',
  '#2d5073',
];
const MOUND_SCRAP_COUNT = 70;
const MOUND_SCRAP_MAX_PX = 5;
const MOUND_STEPS = 12;
const MOUND_FOOT_POINTS = 7;
const MOUND_BUMP = 0.24;

export interface MoundSpec {
  readonly left: number;
  readonly right: number;
  readonly baseY: number;
  /** The heap's height above `baseY` at evenly spaced points across it, from {@link moundProfile}. */
  readonly profile: readonly number[];
  /** How far the foot of the heap wanders up off `baseY`, so it does not sit on a ruled line. */
  readonly footRagged?: number;
  readonly rng: Rng;
}

/**
 * A heap's lumpy dome, as heights at evenly spaced points from its left foot
 * to its right. Shared with whatever sits on the heap, so an item's base can
 * be dropped onto the surface it is resting on.
 */
export function moundProfile(peak: number, rng: Rng): number[] {
  const heights: number[] = [];
  for (let i = 0; i <= MOUND_STEPS; i++) {
    const t = i / MOUND_STEPS;
    const dome = Math.pow(Math.sin(t * Math.PI), MOUND_DOME_POWER);
    heights.push(peak * dome * (1 + (rng() - HALF) * 2 * MOUND_BUMP));
  }
  return heights;
}

/** Samples at a joined end held flat at the join height, so both heaps' curves meet level. */
const JOIN_FLAT_SAMPLES = 3;
/** Samples past the flat that ease from the join height into the heap's own dome. */
const JOIN_EASE_SAMPLES = 3;

/**
 * A profile whose ends meet a neighbouring heap: held flat at `joinHeight` at
 * each joined end and eased into the heap's own dome, never below it. Two
 * heaps joined at the same height meet in one continuous ridge.
 */
export function joinedMoundProfile(
  profile: readonly number[],
  joinLeft: boolean,
  joinRight: boolean,
  joinHeight: number,
): number[] {
  const heights = [...profile];
  const last = heights.length - 1;
  const hold = (index: number, distance: number): void => {
    if (distance < JOIN_FLAT_SAMPLES) {
      heights[index] = joinHeight;
      return;
    }
    const ease = (distance - JOIN_FLAT_SAMPLES + 1) / (JOIN_EASE_SAMPLES + 1);
    heights[index] = Math.max(heights[index], joinHeight + (heights[index] - joinHeight) * ease);
  };
  for (let d = 0; d < JOIN_FLAT_SAMPLES + JOIN_EASE_SAMPLES; d++) {
    if (joinLeft) hold(d, d);
    if (joinRight) hold(last - d, d);
  }
  return heights;
}

/** The profile's height at `t` (0 at the left foot, 1 at the right), interpolated. */
export function moundHeightAt(profile: readonly number[], t: number): number {
  const clamped = Math.min(1, Math.max(0, t)) * (profile.length - 1);
  const below = Math.floor(clamped);
  const above = Math.min(profile.length - 1, below + 1);
  return profile[below] + (profile[above] - profile[below]) * (clamped - below);
}

/**
 * The undifferentiated trash every heap sits in: a lumpy dark mass, flecked
 * with torn scraps of every colour the room has.
 */
export function mound(spec: MoundSpec): JunkItem {
  const { left, right, baseY, profile, rng } = spec;
  const heights = profile;
  const foot: number[] = [];
  for (let i = 0; i < MOUND_FOOT_POINTS; i++) foot.push(rng() * (spec.footRagged ?? 0));
  const scraps: Array<{ x: number; y: number; w: number; h: number; colour: string }> = [];
  for (let i = 0; i < MOUND_SCRAP_COUNT; i++) {
    const t = rng();
    const x = left + t * (right - left);
    const y = baseY - rng() * moundHeightAt(heights, t);
    scraps.push({
      x,
      y,
      w: 1 + rng() * MOUND_SCRAP_MAX_PX,
      h: 1 + rng() * MOUND_SCRAP_MAX_PX * HALF,
      colour: MOUND_SCRAPS[Math.floor(rng() * MOUND_SCRAPS.length)],
    });
  }
  const trace = (ctx: CanvasRenderingContext2D): void => {
    ctx.moveTo(left, baseY);
    const step = (right - left) / (heights.length - 1);
    for (let i = 1; i < heights.length; i++) {
      // Through the midpoints, with each sample as the control: a lumpy curve, not a zigzag.
      const controlX = left + (i - 1) * step;
      const midX = controlX + step * HALF;
      const midHeight = (heights[i - 1] + heights[i]) * HALF;
      ctx.quadraticCurveTo(controlX, baseY - heights[i - 1], midX, baseY - midHeight);
    }
    ctx.lineTo(right, baseY);
    // Back along the foot, ragged where the junk spills onto the floor.
    for (let i = foot.length - 1; i >= 0; i--) {
      ctx.lineTo(left + ((i + HALF) / foot.length) * (right - left), baseY - foot[i]);
    }
    ctx.closePath();
  };
  return {
    silhouette: trace,
    paint: (ctx) => {
      ctx.beginPath();
      trace(ctx);
      const body = ctx.createLinearGradient(0, baseY - Math.max(...heights), 0, baseY);
      body.addColorStop(0, lit(MOUND, MOUND_TOP_LIGHT));
      body.addColorStop(1, lit(MOUND, MOUND_FOOT_SHADE));
      ctx.fillStyle = body;
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (const scrap of scraps) {
        ctx.fillStyle = scrap.colour;
        ctx.fillRect(scrap.x, scrap.y, scrap.w, scrap.h);
        ctx.fillStyle = withAlpha(SHADOW, MOUND_SCRAP_SHADOW_ALPHA);
        ctx.fillRect(scrap.x, scrap.y + scrap.h, scrap.w, 1);
      }
      ctx.restore();
    },
  };
}
const MOUND_DOME_POWER = 0.5;
const MOUND_TOP_LIGHT = 0.12;
const MOUND_FOOT_SHADE = -0.45;
const MOUND_SCRAP_SHADOW_ALPHA = 0.5;

// ── Loose paper and dust ─────────────────────────────────────────────────────

/** A loose sheet of paper on the floor or mid-air, at an angle. */
export function looseSheet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  paper: string = NEWSPRINT,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = JUNK_OUTLINE;
  ctx.fillRect(-w * HALF - 1, -h * HALF - 1, w + 2, h + 2);
  ctx.fillStyle = paper;
  ctx.fillRect(-w * HALF, -h * HALF, w, h);
  ctx.fillStyle = withAlpha(NEWSPRINT_INK, COLUMN_ALPHA);
  for (let y = -h * HALF + 1; y < h * HALF - 1; y += TYPE_LINE_SPACING_PX) {
    ctx.fillRect(-w * HALF + 1, y, w - 2, 1);
  }
  ctx.restore();
}

const DUST = '#c9b893';

/** A soft puff of dust, for a wobble's sift and a fall's landing. */
export function dustPuff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const puff = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  puff.addColorStop(0, withAlpha(DUST, alpha));
  puff.addColorStop(1, withAlpha(DUST, 0));
  ctx.fillStyle = puff;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Specks of dust sifting down past something that has just been disturbed. */
export function dustSpecks(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
): void {
  ctx.save();
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = DUST_SPECK_MIN_ALPHA + rng() * DUST_SPECK_ALPHA_SPAN;
    ctx.fillStyle = DUST;
    ctx.fillRect(x + rng() * w, y + rng() * h, DUST_SPECK_PX, DUST_SPECK_PX);
  }
  ctx.restore();
}
const DUST_SPECK_MIN_ALPHA = 0.45;
const DUST_SPECK_ALPHA_SPAN = 0.45;
const DUST_SPECK_PX = 2;
