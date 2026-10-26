/**
 * One seat plate at the poker table: a round avatar bust, the name and stack,
 * the last thing the seat did, its blind marker, and every state a seat can be
 * in — acting, folded, all-in, winning, tilted, busted or empty.
 *
 * A regular's avatar is painted once per look from the club cast's own figure
 * and kept on an offscreen canvas: a still bust never needs repainting, and
 * figure painting is far too heavy to run six times a frame.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { activeCatFigure, drawCatSprite } from '../../sprites/catSprite';
import { drawClubCastFigure, type ClubFigureRef } from '../../sprites/clubCastFigure';
import { drawHumanSprite, emptyHandedHumanFigure } from '../../sprites/humanSprite';
import { centerIn, inset, splitV, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { withAlpha } from '../theme/color';
import { badge, type BadgeTone } from '../widgets/badge';
import { fillRounded, strokeRounded } from '../widgets/paint';
import { measureText, text } from '../widgets/text';
import { drawPokerChipStack, type PokerChip } from './ChipStack';
import type { PokerTableColors } from './pokerColors';
import type { PokerSeatLayout } from './pokerLayout';
import type { PokerTierId } from '../../systems/casino/poker/pokerStakes';

export type SeatAvatar =
  | { readonly kind: 'regular'; readonly key: string; readonly look: ClubFigureRef }
  | { readonly kind: 'crawler'; readonly crawler: 'human' | 'cat' }
  | { readonly kind: 'empty' };

export interface SeatTag {
  readonly label: string;
  readonly tone: BadgeTone;
  /** Fades towards 0 once the street it was said on is over. */
  readonly alpha: number;
}

/** Everything a plate shows this frame. */
export interface SeatPlateModel {
  readonly name: string;
  /** What the plate says instead when the full name will not fit. */
  readonly shortName?: string;
  /** The stack as the table shows it: chips still flying home are not counted yet. */
  readonly stack: number;
  readonly avatar: SeatAvatar;
  /** The plate's own opacity: a seat changing hands fades out and the newcomer fades in. */
  readonly presence: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** How long one "thinking" pulse takes while this seat is to act; `null` when it isn't. */
  readonly actingPulseMs: number | null;
  readonly winner: boolean;
  readonly tilted: boolean;
  readonly busted: boolean;
  /** Replaces the stack line, e.g. "Leaving" for a regular standing up; "Busted" shows on its own. */
  readonly statusLine?: string;
  readonly tag: SeatTag | null;
  readonly blind: 'SB' | 'BB' | null;
  /** 0→1 through a chip fidget while the seat waits, or `null`. */
  readonly fidget: number | null;
}

/** Folded seats sit back: dimmed, but still legible. */
const FOLDED_ALPHA = 0.45;
const EMPTY_ALPHA = 0.5;
const PLATE_BORDER_WIDTH = 1;
const AVATAR_RING_WIDTH = 2;
const ACTING_RING_WIDTH = 2.5;
/** The thinking pulse grows the ring outward by this share of the avatar's radius. */
const PULSE_GROWTH = 0.45;
/** The crawler's colour washed behind its glyph, as the HUD's portraits are. */
const CRAWLER_AVATAR_TINT_ALPHA = 0.3;
const WINNER_GLOW_BLUR = 18;
const ACTING_GLOW_BLUR = 12;
const DASH_FRACTION = 0.08;
/** The tilted regular's impatient tap: a quick double bob every so often. */
const TILT_TAP_PERIOD_MS = 1400;
const TILT_TAP_SHARE = 0.18;
const TILT_TAP_LIFT = 1.6;
const TILT_TAP_FREQUENCY = 2;
const TILT_FLUSH_PERIOD_MS = 2200;
const TILT_FLUSH_MIN = 0.55;
/** The fidget riffle: a little stack beside the stack readout that lifts and wobbles. */
const FIDGET_CHIP_COUNT = 3;
const FIDGET_WOBBLE_CYCLES = 3;
const FIDGET_LIFT_FRACTION = 0.35;
const FIDGET_RADIUS_FRACTION = 0.2;
export const BLIND_MARKER_FRACTION = 0.3;
/** A plate shorter than this sets the name a step smaller, so a phone shows more of it. */
export const LABEL_NAME_MIN_PLATE_H = 44;
const GLYPH_FRACTION = 0.56;
const TWO_PI = Math.PI * 2;
const HALF = 0.5;

/**
 * Where a bust is cropped from its figure, in tiles of the figure's draw size:
 * the crop's top edge relative to the tile box, and how many tiles it spans.
 */
interface BustCrop {
  readonly top: number;
  readonly span: number;
}

const CAST_BUST: BustCrop = { top: -0.66, span: 0.62 };
/** The human crawler stands taller in his tile than the club cast, so his crop starts higher. */
const HUMAN_BUST: BustCrop = { top: -1, span: 0.72 };
/** The cat crawler sits low in hers, head near the tile's top. */
const CAT_BUST: BustCrop = { top: 0.05, span: 0.62 };
/** Baked at a fixed resolution and scaled down at paint time; big enough for the widest plate. */
const BUST_BAKE_PX = 128;
const MAX_BAKED_BUSTS = 32;
const bustCache = new Map<string, CanvasSurface | null>();
function clearBusts(): void {
  for (const bust of bustCache.values()) if (bust !== null) releaseSurface(bust);
  bustCache.clear();
}
// The busts are baked once and kept; a purged canvas would stay blank for good.
onCanvasRecovery(clearBusts);

type FigurePainter = (ctx: CanvasRenderingContext2D, x: number, y: number, tile: number) => void;

/** A figure's head and shoulders, baked on first use; `null` when the browser refused a canvas. */
function bakedBust(key: string, crop: BustCrop, paint: FigurePainter): CanvasSurface | null {
  const cached = bustCache.get(key);
  if (cached !== undefined) return cached;
  if (bustCache.size >= MAX_BAKED_BUSTS) clearBusts();
  let baked: CanvasSurface | null = null;
  try {
    baked = allocCanvas('casino', BUST_BAKE_PX, BUST_BAKE_PX);
    const tile = BUST_BAKE_PX / crop.span;
    paint(surfaceContext(baked), BUST_BAKE_PX * HALF - tile * HALF, -crop.top * tile, tile);
  } catch {
    if (baked !== null) releaseSurface(baked);
    baked = null;
  }
  bustCache.set(key, baked);
  return baked;
}

function castPainter(look: ClubFigureRef): FigurePainter {
  return (ctx, x, y, tile) =>
    drawClubCastFigure(ctx, look, x, y, tile, {
      action: 'idle',
      walkPhase: 0,
      facingX: 0,
      facingY: 1,
    });
}

function avatarBust(avatar: SeatAvatar): CanvasSurface | null {
  switch (avatar.kind) {
    case 'regular':
      return bakedBust(avatar.key, CAST_BUST, castPainter(avatar.look));
    case 'crawler':
      return avatar.crawler === 'human'
        ? bakedBust(`crawler/human/${emptyHandedHumanFigure().id}`, HUMAN_BUST, (ctx, x, y, tile) =>
            drawHumanSprite(ctx, x, y, tile),
          )
        : bakedBust(`crawler/cat/${activeCatFigure().id}`, CAT_BUST, (ctx, x, y, tile) =>
            drawCatSprite(ctx, x, y, tile),
          );
    case 'empty':
      return null;
  }
}

function circlePath(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.beginPath();
  ctx.arc(r.x + r.w * HALF, r.y + r.h * HALF, r.w * HALF, 0, TWO_PI);
}

function paintAvatar(
  ui: Ui,
  r: Rect,
  avatar: SeatAvatar,
  colors: PokerTableColors,
  tilt: number,
): void {
  const { ctx } = ui;
  ctx.save();
  circlePath(ctx, r);
  ctx.fillStyle = colors.avatarBack;
  ctx.fill();
  ctx.clip();
  if (avatar.kind === 'crawler') {
    ctx.fillStyle = withAlpha(colors.crawler[avatar.crawler], CRAWLER_AVATAR_TINT_ALPHA);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  const bust = avatarBust(avatar);
  if (bust !== null) {
    ctx.drawImage(bust, r.x, r.y, r.w, r.h);
  } else if (avatar.kind !== 'empty') {
    const glyph = avatar.kind === 'crawler' && avatar.crawler === 'cat' ? 'cat' : 'user';
    drawGlyph(ctx, glyph, centerIn(r, r.w * GLYPH_FRACTION, r.h * GLYPH_FRACTION), {
      color: colors.muted,
    });
  }
  if (tilt > 0) {
    ctx.globalAlpha *= tilt;
    ctx.fillStyle = colors.tiltFlush;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

function paintActingRing(
  ui: Ui,
  avatar: Rect,
  pulseMs: number,
  colors: PokerTableColors,
  now: number,
): void {
  const { ctx } = ui;
  const cx = avatar.x + avatar.w * HALF;
  const cy = avatar.y + avatar.h * HALF;
  const radius = avatar.w * HALF;
  const progress = (now % pulseMs) / pulseMs;
  ctx.save();
  ctx.strokeStyle = colors.actingRing;
  ctx.lineWidth = ACTING_RING_WIDTH;
  ctx.shadowColor = colors.actingGlow;
  ctx.shadowBlur = ACTING_GLOW_BLUR;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + ACTING_RING_WIDTH * HALF, 0, TWO_PI);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha *= 1 - progress;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (1 + PULSE_GROWTH * progress), 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

/** The impatient tap's vertical offset and the flush's strength, both off the UI clock. */
function tiltMotion(now: number): { lift: number; flush: number } {
  const tapPhase = (now % TILT_TAP_PERIOD_MS) / TILT_TAP_PERIOD_MS;
  const tapping = tapPhase < TILT_TAP_SHARE;
  const lift = tapping
    ? -Math.abs(Math.sin((tapPhase / TILT_TAP_SHARE) * Math.PI * TILT_TAP_FREQUENCY)) *
      TILT_TAP_LIFT
    : 0;
  const flushPhase = (now % TILT_FLUSH_PERIOD_MS) / TILT_FLUSH_PERIOD_MS;
  const flush =
    TILT_FLUSH_MIN + (1 - TILT_FLUSH_MIN) * (HALF + HALF * Math.sin(flushPhase * TWO_PI));
  return { lift, flush };
}

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

/**
 * Paints one seat's plate. The hole cards, bets and the dealer puck belong to
 * the table and are painted around it. `now` drives the pulses; the table
 * passes its own clock so they pause with it.
 */
export function paintSeatPlate(
  ui: Ui,
  seat: PokerSeatLayout,
  model: SeatPlateModel,
  colors: PokerTableColors,
  tier: PokerTierId,
  now: number = ui.now,
): void {
  const { ctx, theme } = ui;
  if (model.presence <= 0) return;
  const empty = model.avatar.kind === 'empty';
  const dimmed = model.folded ? FOLDED_ALPHA : empty || model.busted ? EMPTY_ALPHA : 1;
  ctx.save();
  ctx.globalAlpha *= model.presence * dimmed;

  const tilt = model.tilted ? tiltMotion(now) : { lift: 0, flush: 0 };
  const plate = seat.plate;
  const radius = plate.h * HALF;

  if (model.winner) {
    ctx.save();
    ctx.shadowColor = colors.winnerGlow;
    ctx.shadowBlur = WINNER_GLOW_BLUR;
    fillRounded(ctx, plate, radius, colors.plate);
    ctx.restore();
  }
  if (empty) {
    ctx.save();
    ctx.setLineDash([plate.h * DASH_FRACTION * 2, plate.h * DASH_FRACTION * 2]);
    strokeRounded(ctx, plate, radius, colors.plateBorder, PLATE_BORDER_WIDTH);
    ctx.restore();
  } else {
    fillRounded(
      ctx,
      plate,
      radius,
      model.actingPulseMs === null ? colors.plate : colors.plateActing,
    );
    strokeRounded(
      ctx,
      plate,
      radius,
      model.winner ? colors.winnerGlow : colors.plateBorder,
      PLATE_BORDER_WIDTH,
    );
  }

  const avatar = { ...seat.avatar, y: seat.avatar.y + tilt.lift };
  paintAvatar(ui, avatar, model.avatar, colors, tilt.flush);
  ctx.save();
  circlePath(ctx, avatar);
  ctx.strokeStyle = model.winner ? colors.winnerGlow : colors.avatarRing;
  ctx.lineWidth = AVATAR_RING_WIDTH;
  ctx.stroke();
  ctx.restore();
  if (model.actingPulseMs !== null) paintActingRing(ui, avatar, model.actingPulseMs, colors, now);

  const nameStyle =
    plate.h < LABEL_NAME_MIN_PLATE_H
      ? { ...theme.type.caption, weight: theme.type.label.weight }
      : theme.type.label;
  const stackStyle = theme.type.caption;
  const lines = centerIn(seat.info, seat.info.w, nameStyle.lineHeight + stackStyle.lineHeight);
  const [nameRow, stackRow] = splitV(lines, [nameStyle.lineHeight, stackStyle.lineHeight], 0);
  const fullFits = measureText(ui, model.name, { style: nameStyle }) <= nameRow.w;
  text(ui, nameRow, {
    text: fullFits ? model.name : (model.shortName ?? model.name),
    style: nameStyle,
    color: empty ? colors.muted : colors.name,
  });
  if (!empty) {
    text(ui, stackRow, {
      text: model.statusLine ?? (model.busted ? 'Busted' : coins(model.stack)),
      style: stackStyle,
      color: model.busted || model.statusLine !== undefined ? colors.muted : colors.stack,
      tabular: true,
    });
  }
  if (model.fidget !== null) paintFidget(ui, seat, model.fidget, tier);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= model.presence;
  if (model.blind !== null) paintBlindMarker(ui, seat, model.blind, colors);
  if (model.allIn) {
    badge(ui, seat.tag, { label: 'All-in', tone: 'danger', kind: 'tag', variant: 'solid' });
  } else if (model.tag !== null && model.tag.alpha > 0) {
    ctx.globalAlpha *= model.tag.alpha * (model.folded ? FOLDED_ALPHA : 1);
    badge(ui, seat.tag, {
      label: model.tag.label,
      tone: model.tag.tone,
      kind: 'tag',
      variant: 'solid',
    });
  }
  ctx.restore();
}

/** A short riffle of three chips at the plate's right end: the chip-fidget tell. */
function paintFidget(ui: Ui, seat: PokerSeatLayout, progress: number, tier: PokerTierId): void {
  const plate = seat.plate;
  const radius = plate.h * FIDGET_RADIUS_FRACTION;
  const cx = plate.x + plate.w - radius * 2;
  const baseY = plate.y + plate.h - radius;
  const wobble = Math.sin(progress * Math.PI * 2 * FIDGET_WOBBLE_CYCLES);
  const lift = Math.abs(wobble) * radius * FIDGET_LIFT_FRACTION;
  const chips: PokerChip[] = Array.from({ length: FIDGET_CHIP_COUNT }, (_, index) => ({
    value: 0,
    colourIndex: index,
  }));
  ui.ctx.save();
  ui.ctx.translate(wobble * radius * FIDGET_LIFT_FRACTION, -lift);
  drawPokerChipStack(ui, cx, baseY, radius, tier, chips, { labelTop: false });
  ui.ctx.restore();
}

function paintBlindMarker(
  ui: Ui,
  seat: PokerSeatLayout,
  blind: 'SB' | 'BB',
  colors: PokerTableColors,
): void {
  const { ctx, theme } = ui;
  const r = seat.plate.h * BLIND_MARKER_FRACTION;
  const disc = { x: seat.blindMarker.x - r, y: seat.blindMarker.y - r, w: r * 2, h: r * 2 };
  ctx.save();
  circlePath(ctx, disc);
  ctx.fillStyle = blind === 'SB' ? colors.smallBlind : colors.bigBlind;
  ctx.fill();
  ctx.restore();
  text(ui, inset(disc, -r), {
    text: blind,
    style: theme.type.overline,
    color: colors.markerText,
    align: 'center',
    valign: 'middle',
  });
}
