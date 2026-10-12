/**
 * The speech bubble beside a regular's seat: one at a time, held for a few
 * seconds, pointing at the plate of whoever said it.
 *
 * The regulars' brain already paces what is worth saying across the table;
 * this only shows it. Chatter is a tell, so a chatter line takes the bubble
 * over from ordinary banter rather than waiting behind it: a tell the player
 * never saw would be no tell at all.
 *
 * A bubble never covers what the player reads — a plate's name and stack, a
 * shown hand, the board, the pot, their own cards. It tries each side of the
 * speaker's plate first. A cramped table (a phone) may have no clear spot
 * beside the plate; the bubble then takes the nearest clear patch of felt and
 * names its speaker, since its tail can no longer point at them. With no
 * clear felt either, the line is handed to {@link PokerBanter.onUnplaced}
 * rather than hiding a hand or a stack.
 */

import { inset, intersect, overlaps, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';
import { measureText, measureTextHeight, text } from '../widgets/text';
import { CHIP_STACK_STEP } from './ChipStack';
import { WIN_LIFT_FRACTION, type Point, type PokerLayout } from './pokerLayout';
import { BLIND_MARKER_FRACTION } from './pokerSeat';
import {
  BET_POP_GROWTH,
  MAX_BET_CHIPS,
  PUCK_RADIUS_FRACTION,
  RECHECK_LIFT,
  RECHECK_TILT,
} from './PokerTableView';
import { PLAYER_SEAT, POKER_SEAT_COUNT } from '../../systems/casino/poker/PokerTable';
import { listAt } from '../../systems/casino/poker/npc/listAt';

/** How long a line stays up before it fades. */
export const BUBBLE_HOLD_MS = 3000;
/** Every bubble fits two rendered lines; the scripts are written to that. */
const BUBBLE_MAX_LINES = 2;
/** The widest a bubble grows, as a share of the small panel width. */
const BUBBLE_MAX_PANEL_SHARE = 0.7;
/** Nor wider than this share of the felt, so it never spans the table. */
const BUBBLE_MAX_FELT_SHARE = 0.6;
/** The tail's half-width and length, as multiples of the bubble's padding. */
const TAIL_HALF_WIDTH_PADDINGS = 0.8;
const TAIL_LENGTH_PADDINGS = 1;
/** How far along the bubble the tail sits from the edge nearest its seat, in paddings. */
const TAIL_INSET_PADDINGS = 2;
/** A two-line bubble is tried at this many widths between its narrowest and widest. */
const WIDTH_STEPS = 4;

export type BubbleKind = 'banter' | 'chatter';

interface Bubble {
  readonly seat: number;
  /** Who is speaking, for a bubble set too far from their plate for its tail to say. */
  readonly speaker: string;
  readonly line: string;
  readonly kind: BubbleKind;
  readonly at: number;
}

/** Which side of the speaker's plate the bubble sits on; `apart` has no tail. */
type BubbleSide = 'above' | 'below' | 'left' | 'right' | 'apart';

interface PlacedBubble {
  readonly rect: Rect;
  readonly side: BubbleSide;
  readonly words: string;
  /** The plate the tail points at. */
  readonly plate: Rect;
}

interface TailSize {
  readonly length: number;
  readonly half: number;
  readonly inset: number;
}

interface BubbleSize {
  readonly w: number;
  readonly h: number;
}

/** A placement worked out once for one bubble on one layout with one set of hands showing. */
interface PlacementCache {
  readonly bubble: Bubble;
  readonly layout: PokerLayout;
  readonly shownMask: number;
  readonly placed: PlacedBubble | null;
}

export class PokerBanter {
  private bubble: Bubble | null = null;
  private lastLineValue: string | null = null;
  private cache: PlacementCache | null = null;
  private unplacedReported: Bubble | null = null;

  /**
   * Told once per line that found no clear spot on the table, with the
   * speaker's name and the words, so the host can still show it somewhere.
   */
  onUnplaced: ((speaker: string, line: string) => void) | null = null;

  /** The words of the most recent bubble, so the next pick can avoid them. */
  get lastLine(): string | null {
    return this.lastLineValue;
  }

  /** Whether a bubble is still being shown at `now`. */
  busy(now: number): boolean {
    const bubble = this.bubble;
    return bubble !== null && now - bubble.at < BUBBLE_HOLD_MS;
  }

  /** The seat, words and age in milliseconds of the bubble up at `now`, or `null`: for tests and the gallery. */
  showing(
    now: number,
  ): { readonly seat: number; readonly line: string; readonly ageMs: number } | null {
    const bubble = this.bubble;
    if (bubble === null || !this.busy(now)) return null;
    return { seat: bubble.seat, line: bubble.line, ageMs: now - bubble.at };
  }

  /**
   * Puts `line` up beside `seat`. Banter waits its turn and is dropped when a
   * bubble is already showing; chatter always takes the bubble. True when shown.
   */
  speak(seat: number, speaker: string, line: string, kind: BubbleKind, now: number): boolean {
    if (kind === 'banter' && this.busy(now)) return false;
    this.bubble = { seat, speaker, line, kind, at: now };
    this.lastLineValue = line;
    return true;
  }

  /** Takes the bubble down at once: a new sitting, or a seat whose speaker has gone. */
  clear(): void {
    this.bubble = null;
  }

  /**
   * Paints the bubble in the table's own coordinates.
   *
   * @param handShown Whether a seat's cards are face up right now.
   */
  paint(ui: Ui, layout: PokerLayout, now: number, handShown: (seat: number) => boolean): void {
    const bubble = this.bubble;
    if (bubble === null) return;
    const age = now - bubble.at;
    const fadeMs = ui.theme.motion.slow;
    if (age < 0 || age >= BUBBLE_HOLD_MS) return;
    const placed = this.placement(ui, layout, bubble, handShown);
    if (placed === null) {
      if (this.unplacedReported !== bubble) {
        this.unplacedReported = bubble;
        this.onUnplaced?.(bubble.speaker, bubble.line);
      }
      return;
    }

    const skin = skinsFor(ui.theme).panel.tooltip;
    const { ctx } = ui;
    ctx.save();
    ctx.globalAlpha *= Math.min(1, age / fadeMs, (BUBBLE_HOLD_MS - age) / fadeMs);
    drawGlass(ui, placed.rect, skin);
    const tail = tailPoints(placed, tailSize(ui), skin.radius);
    if (tail !== null) {
      const [baseA, tip, baseB] = tail;
      ctx.beginPath();
      ctx.moveTo(baseA.x, baseA.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(baseB.x, baseB.y);
      ctx.closePath();
      ctx.fillStyle = skin.fill;
      ctx.fill();
      ctx.strokeStyle = skin.border;
      ctx.lineWidth = skin.borderWidth;
      ctx.beginPath();
      ctx.moveTo(baseA.x, baseA.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(baseB.x, baseB.y);
      ctx.stroke();
    }
    text(ui, inset(placed.rect, skin.padding), {
      text: placed.words,
      style: ui.theme.type.caption,
      color: ui.theme.palette.text.primary,
      wrap: true,
      maxLines: BUBBLE_MAX_LINES,
    });
    ctx.restore();
  }

  /** The search is a few thousand rect tests, so it runs once per bubble, not once per frame. */
  private placement(
    ui: Ui,
    layout: PokerLayout,
    bubble: Bubble,
    handShown: (seat: number) => boolean,
  ): PlacedBubble | null {
    let shownMask = 0;
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      if (handShown(seat)) shownMask |= 1 << seat;
    }
    const cached = this.cache;
    if (cached?.bubble === bubble && cached.layout === layout && cached.shownMask === shownMask) {
      return cached.placed;
    }
    const placed = placeBubble(ui, layout, bubble, handShown);
    this.cache = { bubble, layout, shownMask, placed };
    return placed;
  }
}

function tailSize(ui: Ui): TailSize {
  const pad = skinsFor(ui.theme).panel.tooltip.padding;
  return {
    length: pad * TAIL_LENGTH_PADDINGS,
    half: pad * TAIL_HALF_WIDTH_PADDINGS,
    inset: pad * TAIL_INSET_PADDINGS,
  };
}

/**
 * The sizes `words` can be set at in two lines or fewer, widest first: one
 * line where it fits, then narrower boxes down to an even two-line split,
 * so a cramped table can still find a gap the bubble fits.
 */
function bubbleSizes(ui: Ui, layout: PokerLayout, words: string): readonly BubbleSize[] {
  const pad = skinsFor(ui.theme).panel.tooltip.padding;
  const style = ui.theme.type.caption;
  const maxText =
    Math.min(
      ui.theme.panelWidth.sm * BUBBLE_MAX_PANEL_SHARE,
      layout.felt.w * BUBBLE_MAX_FELT_SHARE,
    ) -
    pad * 2;
  const widest = Math.min(maxText, measureText(ui, words, { style }));
  const linesAt = (width: number): number =>
    Math.round(measureTextHeight(ui, width, { text: words, style }) / style.lineHeight);
  const narrowest = widest / BUBBLE_MAX_LINES;
  const sizes: BubbleSize[] = [];
  for (let step = 0; step <= WIDTH_STEPS; step++) {
    const width = widest - ((widest - narrowest) * step) / WIDTH_STEPS;
    const lines = linesAt(width);
    if (lines > BUBBLE_MAX_LINES) continue;
    sizes.push({ w: width + pad * 2, h: lines * style.lineHeight + pad * 2 });
  }
  if (sizes.length === 0) {
    sizes.push({ w: widest + pad * 2, h: BUBBLE_MAX_LINES * style.lineHeight + pad * 2 });
  }
  return sizes;
}

/**
 * The widest bet label a seat is likely to print, measured to reserve its
 * room beside the chips whatever the bet turns out to be.
 */
const BET_LABEL_SAMPLE = '88,888';

/** `rect` grown upward by `lift`: a card that rises when it wins or is peeked at. */
function liftedBy(rect: Rect, lift: number): Rect {
  return { x: rect.x, y: rect.y - lift, w: rect.w, h: rect.h + lift };
}

function disc(centre: Point, radius: number): Rect {
  return { x: centre.x - radius, y: centre.y - radius, w: radius * 2, h: radius * 2 };
}

/** Everything on the table a bubble must never cover, at the furthest any of it moves. */
function bubbleObstacles(
  ui: Ui,
  layout: PokerLayout,
  handShown: (seat: number) => boolean,
): readonly Rect[] {
  const obstacles: Rect[] = [layout.pot, layout.sidePots, layout.handLabel, layout.actionBar];
  for (const slot of layout.board) obstacles.push(liftedBy(slot, slot.h * WIN_LIFT_FRACTION));
  const chipRadius = layout.chipRadius * (1 + BET_POP_GROWTH);
  const stackHeight = chipRadius * CHIP_STACK_STEP * (MAX_BET_CHIPS - 1);
  const labelW = measureText(ui, BET_LABEL_SAMPLE, { style: ui.theme.type.label, tabular: true });
  const labelGap = ui.theme.space.xs;
  layout.seats.forEach((seat, index) => {
    obstacles.push(seat.plate, seat.avatar, seat.tag);
    const cards = seat.holeCards;
    if (index === PLAYER_SEAT) {
      obstacles.push(liftedBy(cards, cards.h * WIN_LIFT_FRACTION));
    } else {
      // A regular's backs lift and tilt on a recheck: that tell must stay in view.
      const tilt = cards.h * RECHECK_TILT;
      obstacles.push(inset(liftedBy(cards, cards.h * RECHECK_LIFT), { l: -tilt, r: -tilt }));
    }
    if (handShown(index)) {
      const shown = seat.shownCards;
      obstacles.push(liftedBy(shown, shown.h * WIN_LIFT_FRACTION), seat.handName);
    }
    const spot = seat.betSpot;
    const chips: Rect = {
      x: spot.x - chipRadius,
      y: spot.y - stackHeight - chipRadius,
      w: chipRadius * 2,
      h: stackHeight + chipRadius * 2,
    };
    const labelX =
      seat.betLabelSide === 'left' ? chips.x - labelGap - labelW : chips.x + chips.w + labelGap;
    const labelH = ui.theme.type.label.lineHeight;
    obstacles.push(chips, { x: labelX, y: spot.y - labelH / 2, w: labelW, h: labelH });
    obstacles.push(disc(seat.buttonSpot, layout.chipRadius * PUCK_RADIUS_FRACTION));
    obstacles.push(disc(seat.blindMarker, seat.plate.h * BLIND_MARKER_FRACTION));
  });
  const { header } = layout;
  obstacles.push(header.bust, header.banter, header.title, header.info);
  return obstacles;
}

function besidePlate(
  plate: Rect,
  bubbleAnchor: Point,
  bubbleSide: 'left' | 'right',
  size: BubbleSize,
  tail: TailSize,
): PlacedBubble[] {
  const { w, h } = size;
  const towardSide =
    bubbleSide === 'right' ? bubbleAnchor.x - tail.inset : bubbleAnchor.x + tail.inset - w;
  const xs = [towardSide, plate.x + plate.w / 2 - w / 2, plate.x, plate.x + plate.w - w];
  const aboveY = plate.y - tail.length - h;
  const belowY = plate.y + plate.h + tail.length;
  const besideY = plate.y + plate.h / 2 - h / 2;
  const at = (x: number, y: number, side: BubbleSide): PlacedBubble => ({
    rect: { x, y, w, h },
    side,
    words: '',
    plate,
  });
  return [
    ...xs.map((x) => at(x, aboveY, 'above')),
    ...xs.map((x) => at(x, belowY, 'below')),
    at(plate.x + plate.w + tail.length, besideY, 'right'),
    at(plate.x - tail.length - w, besideY, 'left'),
  ];
}

function placeBubble(
  ui: Ui,
  layout: PokerLayout,
  bubble: Bubble,
  handShown: (seat: number) => boolean,
): PlacedBubble | null {
  const seat = listAt(layout.seats, bubble.seat);
  if (seat === undefined) return null;
  const tail = tailSize(ui);
  const room = ui.theme.space.sm;
  // The bubble keeps to the table and its rail, so it never covers Deuce's
  // strip or the readouts beside the felt.
  const table = inset(layout.felt, -layout.railWidth);
  const bounds: Rect = intersect(table, inset(layout.panel, room)) ?? table;
  const obstacles = bubbleObstacles(ui, layout, handShown).map((rect) =>
    inset(rect, -ui.theme.space.xs),
  );
  const clear = (rect: Rect): boolean =>
    contains(bounds, rect) && !obstacles.some((obstacle) => overlaps(rect, obstacle));

  for (const size of bubbleSizes(ui, layout, bubble.line)) {
    const beside = besidePlate(seat.plate, seat.bubbleAnchor, seat.bubbleSide, size, tail);
    const found = beside.find((candidate) => clear(candidate.rect));
    if (found !== undefined) return { ...found, words: bubble.line };
  }

  const named = `${bubble.speaker}: ${bubble.line}`;
  for (const size of bubbleSizes(ui, layout, named)) {
    const rect = nearestClearSpot(bounds, size, seat.bubbleAnchor, room, clear);
    if (rect !== null) return { rect, side: 'apart', words: named, plate: seat.plate };
  }
  return null;
}

/** The clear spot of `size` inside `bounds` nearest `anchor`, searched on a `step` grid. */
function nearestClearSpot(
  bounds: Rect,
  size: BubbleSize,
  anchor: Point,
  step: number,
  clear: (rect: Rect) => boolean,
): Rect | null {
  const spots: Rect[] = [];
  for (let y = bounds.y; y + size.h <= bounds.y + bounds.h; y += step) {
    for (let x = bounds.x; x + size.w <= bounds.x + bounds.w; x += step) {
      const rect = { x, y, w: size.w, h: size.h };
      if (clear(rect)) spots.push(rect);
    }
  }
  const distance = (rect: Rect): number =>
    Math.hypot(rect.x + rect.w / 2 - anchor.x, rect.y + rect.h / 2 - anchor.y);
  return spots.reduce<Rect | null>(
    (best, rect) => (best === null || distance(rect) < distance(best) ? rect : best),
    null,
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** The tail's two base corners on the bubble's edge and its tip at the plate; none for a bubble set apart. */
function tailPoints(
  placed: PlacedBubble,
  tail: TailSize,
  radius: number,
): readonly [Point, Point, Point] | null {
  const { rect, plate, side } = placed;
  if (side === 'apart') return null;
  if (side === 'above' || side === 'below') {
    const x = clamp(
      plate.x + plate.w / 2,
      rect.x + radius + tail.half,
      rect.x + rect.w - radius - tail.half,
    );
    const baseY = side === 'above' ? rect.y + rect.h : rect.y;
    const tipY = side === 'above' ? baseY + tail.length : baseY - tail.length;
    return [
      { x: x - tail.half, y: baseY },
      { x, y: tipY },
      { x: x + tail.half, y: baseY },
    ];
  }
  const y = rect.y + rect.h / 2;
  const baseX = side === 'right' ? rect.x : rect.x + rect.w;
  const tipX = side === 'right' ? baseX - tail.length : baseX + tail.length;
  return [
    { x: baseX, y: y - tail.half },
    { x: tipX, y },
    { x: baseX, y: y + tail.half },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
