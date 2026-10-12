/**
 * The Texas Hold'em table on screen: the felt, the six seats, the board, the
 * pot, the player's cards and "Your hand" line, the action bar with its raise
 * sizing tray, and the footer. It reads the engine for what is true and
 * {@link PokerMotion} for what has been shown so far, and owns no money: every
 * control calls back into the host.
 */

import type { Rect } from '../core/geom';
import { centerIn, inset, overlaps, splitH, splitV } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { QuantityPickerState } from '../QuantityPickerState';
import { skinsFor, type ButtonVariant } from '../theme/skins';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { button, measureButton } from '../widgets/button';
import { iconButton } from '../widgets/iconButton';
import { drawGlass, fillRounded, strokeRounded } from '../widgets/paint';
import { stepper, stepperKey } from '../widgets/stepper';
import { measureText, text } from '../widgets/text';
import { glowText, paintSkinnedControl } from '../screens/dialogs/minigameChrome';
import { drawDeucePortrait, type DealerState } from '../../sprites/casinoDealerSprite';
import type { Card } from '../../systems/casino/Deck';
import type { LegalActions, PokerAction } from '../../systems/casino/poker/bettingRound';
import { evaluateBest } from '../../systems/casino/poker/handEvaluator';
import { buildPots } from '../../systems/casino/poker/pots';
import { smallestChip } from '../../systems/casino/poker/pokerStakes';
import {
  HOLE_CARD_COUNT,
  PLAYER_SEAT,
  POKER_SEAT_COUNT,
  type PokerSeat,
  type PokerTable,
} from '../../systems/casino/poker/PokerTable';
import { CARD_ASPECT, drawCardBack, drawCardFace, drawCardFlip } from './PlayingCard';
import { drawPokerChipStack, pokerChips } from './ChipStack';
import { pokerTableColors, type PokerTableColors } from './pokerColors';
import {
  computePokerLayout,
  PLAYER_CARD_STEP,
  SHOWN_CARD_STEP,
  WIN_LIFT_FRACTION,
  TUCKED_CARD_STEP,
  type Point,
  type PokerLayout,
  type PokerSeatLayout,
} from './pokerLayout';
import {
  BET_POP_MS,
  FIDGET_MS,
  FLIP_MS,
  PUCK_SLIDE_MS,
  RECHECK_MS,
  SEAT_FADE_MS,
  SHUFFLE_MS,
  TAG_FADE_MS,
  TURN_SLIDE_MS,
  WIN_LIFT_MS,
  type Flight,
  type FlightAnchor,
  type PokerMotion,
} from './pokerMotion';
import {
  HAND_NAME_MAX_LINES,
  HAND_NAME_PAD,
  handNameLines,
  handNameShortLine,
} from './pokerHandNames';
import { paintSeatPlate, type SeatAvatar, type SeatPlateModel } from './pokerSeat';

/** Who sits in a seat, as the plate shows them. */
export interface PokerSeatIdentity {
  readonly name: string;
  /** What the plate says when the full name will not fit. */
  readonly shortName?: string;
  readonly avatar: SeatAvatar;
  readonly tilted: boolean;
}

/** Everything the table's controls do; the host owns the money and the rules behind them. */
export interface PokerTableControls {
  act(action: PokerAction): void;
  skip(): void;
  /** The player asked to skip the rest of this hand, and it is playing out at speed. */
  readonly skipping: boolean;
  leave(): void;
  /** Opens the rules sheet; `null` while no sheet is mounted. */
  readonly rules: (() => void) | null;
  /** Opens the hand history; `null` while no history is mounted. */
  readonly history: (() => void) | null;
  readonly fast: boolean;
  toggleFast(): void;
  readonly showCards: boolean;
  toggleShowCards(): void;
  /** A tap on a regular's plate, with the plate in UI units: the seat-info popover's way in. */
  readonly seatTapped: ((seat: number, plate: Rect) => void) | null;
}

export interface PokerPaintResult {
  /** Keyboard focus sits on one of the table's controls. */
  readonly keyboardOnAControl: boolean;
  /** The player's plate centre in canvas CSS pixels, for the cash-out fly. */
  readonly playerAnchor: Point;
}

interface RaiseTray {
  readonly kind: 'bet' | 'raise';
  readonly picker: QuantityPickerState;
  readonly hand: number;
}

interface ActionButton {
  readonly id: string;
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly primary: boolean;
  readonly icon?: GlyphId;
  readonly onTap: () => void;
}

const HALF = 0.5;
const TWO_PI = Math.PI * 2;
/** How long the dealer's last call stays up before it fades. */
const CALL_HOLD_MS = 4200;
const CALL_FADE_MS = 600;
const CALL_MAX_LINES = 2;
export const MAX_BET_CHIPS = 6;
const MAX_POT_CHIPS = 8;
const MAX_FLIGHT_CHIPS = 5;
const CHIP_ARC_FRACTION = 2.2;
/** A splashed bet's chips scatter this many chip radii apart in the air. */
const SPLASH_SPREAD = 2.4;
const SPLASH_ANGLE_STEP = 2.39996;
export const BET_POP_GROWTH = 0.35;
const CARD_FLIGHT_SPIN = 0.35;
const CARD_FLIGHT_LIFT = 0.12;
export const RECHECK_TILT = 0.38;
export const RECHECK_LIFT = 0.45;
const LOSING_DIM = 0.42;
const PILE_CARDS = 3;
const PILE_OFFSET_FRACTION = 0.06;
/** The muck pile's cards lie at scattered angles, each this far off square at most. */
const MUCK_TILT = 0.22;
const MUCK_SCATTER_STEP = 2.4;
const MUCK_PILE_CARDS = 3;
export const PUCK_RADIUS_FRACTION = 1.15;
const PUCK_EDGE_WIDTH = 1.5;
const FELT_LINE_WIDTH = 1.5;
const FELT_LINE_INSET = 0.86;
const SLOT_LINE_WIDTH = 1;
const SHUFFLE_CARD_COUNT = 8;
const SHUFFLE_CARD_FRACTION = 0.8;
const SHUFFLE_SPLIT_SPREAD = 0.42;
const SHUFFLE_TILT_PER_UNIT = 0.0016;
const SHUFFLE_DROP_FRACTION = 0.08;

const DEUCE_LOOK_DOWN = 1;
const THREE_QUARTERS = 0.75;
const SKIP_LABEL = 'Skip to next hand';
const SKIPPING_LABEL = 'Skipping to next hand…';
/** One flip of the skipping hourglass, in slow motion beats: a turn, then a rest. */
const HOURGLASS_PERIOD_BEATS = 7;
/** The share of each flip spent turning; the rest it sits still. */
const HOURGLASS_TURN_SHARE = 0.35;
const WAITING_LINE = 'Waiting on the table…';
const LEAVING_LINE = 'Leaving';
const CANCEL_LABEL = 'Cancel raise';
/** The tray folds to this many rows when the space under the cards is short. */
const TRAY_FOLDED_ROWS = 2;
const RAISE_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  /** What a preset too narrow for its label says instead. */
  readonly short: string;
  readonly potShare: number | 'min' | 'max';
}> = [
  { id: 'preset-min', label: 'Min', short: 'Min', potShare: 'min' },
  { id: 'preset-half', label: '½ Pot', short: '½', potShare: HALF },
  { id: 'preset-three-quarter', label: '¾ Pot', short: '¾', potShare: THREE_QUARTERS },
  { id: 'preset-pot', label: 'Pot', short: 'Pot', potShare: 1 },
  { id: 'preset-all-in', label: 'All-in', short: 'Max', potShare: 'max' },
];

function coins(amount: number): string {
  return amount.toLocaleString('en-US');
}

function easeOutCubic(t: number): number {
  const inverted = 1 - t;
  return 1 - inverted * inverted * inverted;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blindAt(table: PokerTable, seat: number): 'SB' | 'BB' | null {
  if (seat === table.smallBlindSeat) return 'SB';
  if (seat === table.bigBlindSeat) return 'BB';
  return null;
}

/** The whole screen in the coordinates of a table laid out in the safe area. */
function screenInSafeArea(ui: Ui): Rect {
  return {
    x: ui.screen.x - ui.viewport.x,
    y: ui.screen.y - ui.viewport.y,
    w: ui.screen.w,
    h: ui.screen.h,
  };
}

export class PokerTableView {
  private tray: RaiseTray | null = null;
  private lastCall: { readonly line: string; readonly at: number } | null = null;
  private layoutCache: { readonly key: string; readonly layout: PokerLayout } | null = null;
  /** Painted over the felt and seats but under the controls, in the table's coordinates: the speech bubble. */
  paintOverTable: ((ui: Ui, layout: PokerLayout) => void) | null = null;

  constructor(private readonly motion: PokerMotion) {
    motion.hooks.onCall = (line) => this.say(line);
  }

  /** Puts a line on the dealer's strip under Deuce. */
  say(line: string): void {
    this.lastCall = { line, at: this.motion.time };
  }

  get trayOpen(): boolean {
    return this.tray !== null;
  }

  closeTray(): void {
    this.tray = null;
  }

  /** Digits type the raise, Backspace erases, + and − step by one chip. True when the tray took the key. */
  trayKey(key: string, table: PokerTable): boolean {
    const tray = this.tray;
    if (tray === null) return false;
    const unit = smallestChip(table.tier);
    if (key === '+' || key === '=') {
      tray.picker.stepBy(unit);
      return true;
    }
    if (key === '-') {
      tray.picker.stepBy(-unit);
      return true;
    }
    return stepperKey(tray.picker, key);
  }

  private layout(ui: Ui): PokerLayout {
    const key = `${ui.viewport.w}x${ui.viewport.h}@${ui.uiScale}/${ui.density}`;
    if (this.layoutCache?.key === key) return this.layoutCache.layout;
    const layout = computePokerLayout({
      width: ui.viewport.w,
      height: ui.viewport.h,
      uiScale: ui.uiScale,
      theme: ui.theme,
    });
    this.layoutCache = { key, layout };
    return layout;
  }

  paint(
    ui: Ui,
    table: PokerTable,
    identity: (seat: number, occupantId: string | null) => PokerSeatIdentity,
    controls: PokerTableControls,
  ): PokerPaintResult {
    if (this.tray !== null && (!table.awaitingPlayer || this.tray.hand !== table.handNumber)) {
      this.tray = null;
    }
    const layout = this.layout(ui);
    const colors = pokerTableColors(ui.theme);
    const { ctx } = ui;
    let keyboardOnAControl = false;
    const watch = (focused: boolean): void => {
      if (focused) keyboardOnAControl = true;
    };

    ctx.save();
    ctx.translate(ui.viewport.x, ui.viewport.y);
    const scrim = screenInSafeArea(ui);
    ctx.fillStyle = skinsFor(ui.theme).scrim;
    ctx.fillRect(scrim.x, scrim.y, scrim.w, scrim.h);
    drawGlass(ui, layout.panel, skinsFor(ui.theme).panel.card);

    this.paintHeader(ui, layout, table, colors);
    this.paintFelt(ui, layout, colors);
    this.paintPiles(ui, layout, table);
    this.paintBoard(ui, layout, table, colors);
    this.paintPot(ui, layout, table, colors);
    for (let seat = 0; seat < POKER_SEAT_COUNT; seat++) {
      watch(this.paintSeat(ui, layout, table, seat, identity, controls, colors));
    }
    this.paintPuck(ui, layout, colors);
    this.paintFlights(ui, layout, table);
    this.paintShuffle(ui, layout);
    this.paintHandLabel(ui, layout, table, colors);
    this.paintOverTable?.(ui, layout);
    watch(this.paintActionBar(ui, layout, table, controls));
    watch(this.paintFooter(ui, layout, controls));
    if (this.tray !== null) watch(this.paintTray(ui, layout, table, this.tray, controls));
    ctx.restore();

    const plate = layout.seats[PLAYER_SEAT].plate;
    return {
      keyboardOnAControl,
      playerAnchor: {
        x: (ui.viewport.x + plate.x + plate.w * HALF) * ui.uiScale,
        y: (ui.viewport.y + plate.y + plate.h * HALF) * ui.uiScale,
      },
    };
  }

  // ── Header ───────────────────────────────────────────────────────────────

  private dealerState(table: PokerTable): DealerState {
    if (table.awaitingPlayer) return 'waiting_on_player';
    if (this.motion.results[PLAYER_SEAT]?.winner === true) return 'concede';
    switch (table.phase) {
      case 'shuffling':
      case 'posting_blinds':
      case 'dealing_hole':
      case 'dealing_flop':
      case 'dealing_turn':
      case 'dealing_river':
        return 'dealing';
      case 'showdown':
        return 'flipping';
      case 'between_hands':
      case 'preflop':
      case 'flop':
      case 'turn':
      case 'river':
      case 'awarding':
      case 'player_busted':
      case 'left':
      case 'game_over':
        return 'idle';
    }
  }

  private paintHeader(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    colors: PokerTableColors,
  ): void {
    const { ctx, theme } = ui;
    const { header } = layout;
    fillRounded(ctx, header.bust, theme.radius.md, colors.bustBack);
    strokeRounded(ctx, header.bust, theme.radius.md, colors.bustBorder, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(header.bust.x, header.bust.y, header.bust.w, header.bust.h);
    ctx.clip();
    drawDeucePortrait(
      ctx,
      header.bust.x,
      header.bust.y,
      header.bust.w,
      header.bust.h,
      this.dealerState(table),
      this.motion.time,
      { lookY: DEUCE_LOOK_DOWN },
    );
    ctx.restore();

    const stakes = table.stakes;
    const wide = layout.mode === 'wide';
    text(ui, header.title, {
      text: stakes.name,
      style: wide ? theme.type.title : theme.type.label,
      color: colors.title,
      align: wide ? 'right' : 'left',
    });
    const stack = Math.max(0, table.playerStack - this.motion.incoming[PLAYER_SEAT]);
    const blinds = `Blinds ${coins(stakes.smallBlind)}/${coins(stakes.bigBlind)}`;
    const stackPart = `Stack ${coins(stack)}`;
    const titleW = measureText(ui, stakes.name, { style: theme.type.label });
    const infoRect = wide ? header.info : inset(header.info, { l: titleW + theme.space.sm });
    // The stack matters most, then the blinds; the hand number gives way first.
    const choices = [
      `${blinds} · Hand ${table.handNumber} · ${stackPart}`,
      `${blinds} · ${stackPart}`,
      stackPart,
    ];
    const info =
      choices.find(
        (choice) =>
          measureText(ui, choice, { style: theme.type.caption, tabular: true }) <= infoRect.w,
      ) ?? stackPart;
    text(ui, infoRect, {
      text: info,
      style: theme.type.caption,
      color: colors.readout,
      align: 'right',
      tabular: true,
    });

    const call = this.lastCall;
    if (call === null) return;
    const age = this.motion.time - call.at;
    if (age > CALL_HOLD_MS + CALL_FADE_MS) return;
    const alpha = age <= CALL_HOLD_MS ? 1 : 1 - (age - CALL_HOLD_MS) / CALL_FADE_MS;
    glowText(ui, header.banter, {
      text: call.line,
      style: wide ? theme.type.body : theme.type.caption,
      color: colors.banter,
      wrap: true,
      maxLines: CALL_MAX_LINES,
      valign: 'middle',
      alpha,
    });
  }

  // ── Felt, board, pot ─────────────────────────────────────────────────────

  private paintFelt(ui: Ui, layout: PokerLayout, colors: PokerTableColors): void {
    const { ctx } = ui;
    const felt = layout.felt;
    const cx = felt.x + felt.w * HALF;
    const cy = felt.y + felt.h * HALF;
    const rx = felt.w * HALF;
    const ry = felt.h * HALF;
    const rail = layout.railWidth;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + rail, ry + rail, 0, 0, TWO_PI);
    ctx.fillStyle = colors.railShadow;
    ctx.fill();
    const railGradient = ctx.createLinearGradient(0, cy - ry - rail, 0, cy + ry + rail);
    railGradient.addColorStop(0, colors.railHighlight);
    railGradient.addColorStop(HALF, colors.rail);
    railGradient.addColorStop(1, colors.railShadow);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + rail * HALF, ry + rail * HALF, 0, 0, TWO_PI);
    ctx.fillStyle = railGradient;
    ctx.fill();

    const feltGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    feltGradient.addColorStop(0, colors.feltCentre);
    feltGradient.addColorStop(1, colors.feltEdge);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
    ctx.fillStyle = feltGradient;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * FELT_LINE_INSET, ry * FELT_LINE_INSET, 0, 0, TWO_PI);
    ctx.strokeStyle = colors.feltLine;
    ctx.lineWidth = FELT_LINE_WIDTH;
    ctx.stroke();
    ctx.restore();
  }

  private boardCardOpts(
    card: Card,
    colors: PokerTableColors,
  ): { highlight?: string; dim?: number; lift: number } {
    const motion = this.motion;
    if (motion.winnersAt === null || motion.time < motion.winnersAt) return { lift: 0 };
    if (motion.isWinningCard(card)) {
      return {
        highlight: colors.winHighlight,
        lift: easeOutCubic(motion.settled(motion.winnersAt, WIN_LIFT_MS)),
      };
    }
    return { dim: LOSING_DIM, lift: 0 };
  }

  private paintBoard(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    colors: PokerTableColors,
  ): void {
    const { ctx } = ui;
    const motion = this.motion;
    layout.board.forEach((slot, index) => {
      const radius = slot.w * PILE_OFFSET_FRACTION * 2;
      fillRounded(ctx, slot, radius, colors.slot);
      strokeRounded(ctx, slot, radius, colors.slotLine, SLOT_LINE_WIDTH);
      const landedAt = motion.boardLandedAt[index] ?? null;
      if (index >= table.board.length || landedAt === null) return;
      const card = table.board[index];
      const flipAt = motion.boardFlipAt[index] ?? null;
      const opts = this.boardCardOpts(card, colors);
      const pose = { x: slot.x, y: slot.y - opts.lift * slot.h * WIN_LIFT_FRACTION, width: slot.w };
      const drawOpts = { highlight: opts.highlight, dim: opts.dim, liftShadow: opts.lift > 0 };
      if (flipAt === null || motion.time < flipAt) {
        drawCardBack(ctx, pose);
        return;
      }
      const flipping = motion.progress(flipAt, FLIP_MS);
      if (flipping !== null) drawCardFlip(ctx, card, pose, flipping, drawOpts);
      else drawCardFace(ctx, card, pose, drawOpts);
    });
  }

  /** Where the pot's chips stand: left of the "Pot" readout, the pair centred over the board. */
  private potChipPoint(ui: Ui, layout: PokerLayout): Point {
    const label = this.potLabel();
    const textW = measureText(ui, label, { style: ui.theme.type.label, tabular: true });
    const r = layout.chipRadius;
    const groupW = r * 2 + ui.theme.space.xs + textW;
    const cx = layout.pot.x + layout.pot.w * HALF;
    return { x: cx - groupW * HALF + r, y: layout.pot.y + layout.pot.h * HALF };
  }

  private potLabel(): string {
    return `Pot ${coins(this.motion.potShown)}`;
  }

  private paintPot(ui: Ui, layout: PokerLayout, table: PokerTable, colors: PokerTableColors): void {
    const motion = this.motion;
    const { theme } = ui;
    if (motion.potShown === 0) return;
    const chip = this.potChipPoint(ui, layout);
    const r = layout.chipRadius;
    drawPokerChipStack(
      ui,
      chip.x,
      chip.y + r * HALF,
      r,
      table.tier,
      pokerChips(motion.potShown, table.tier, MAX_POT_CHIPS),
      { labelTop: false },
    );
    text(
      ui,
      { x: chip.x + r + theme.space.xs, y: layout.pot.y, w: layout.pot.w, h: layout.pot.h },
      {
        text: this.potLabel(),
        style: theme.type.label,
        color: colors.potText,
        tabular: true,
        valign: 'middle',
        halo: colors.betHalo,
      },
    );

    if (motion.winnersAt !== null) return;
    const collected = table.seats.map((seat) => seat.contributed - seat.streetBet);
    const out = table.seats.map((seat) => !seat.inHand || seat.folded);
    const pots = buildPots(collected, out);
    if (pots.length < 2) return;
    const line = pots
      .map((pot, index) => `${index === 0 ? 'Main' : `Side ${index}`} ${coins(pot.amount)}`)
      .join(' · ');
    text(ui, layout.sidePots, {
      text: line,
      style: theme.type.caption,
      color: colors.readout,
      align: 'center',
      tabular: true,
      halo: colors.betHalo,
    });
  }

  private paintPiles(ui: Ui, layout: PokerLayout, table: PokerTable): void {
    if (!layout.showPiles) return;
    const { ctx } = ui;
    const w = layout.pileCardWidth;
    const h = w * CARD_ASPECT;
    const offset = w * PILE_OFFSET_FRACTION;
    const shuffling = this.motion.progress(this.motion.shuffleAt, SHUFFLE_MS) !== null;
    if (table.handInProgress && !shuffling) {
      for (let index = 0; index < PILE_CARDS; index++) {
        drawCardBack(ctx, {
          x: layout.deck.x - w * HALF - index * offset,
          y: layout.deck.y - h * HALF - index * offset,
          width: w,
        });
      }
    }
    const mucked = Math.min(this.motion.muckCount, MUCK_PILE_CARDS);
    for (let index = 0; index < mucked; index++) {
      drawCardBack(ctx, {
        x: layout.muck.x - w * HALF,
        y: layout.muck.y - h * HALF,
        width: w,
        rotation: -MUCK_TILT * Math.cos(index * MUCK_SCATTER_STEP),
      });
    }
  }

  // ── Seats ────────────────────────────────────────────────────────────────

  private seatModel(
    table: PokerTable,
    seat: Readonly<PokerSeat>,
    who: PokerSeatIdentity,
    presence: number,
  ): SeatPlateModel {
    const motion = this.motion;
    const index = seat.index;
    const live = table.handInProgress && seat.inHand;
    const tag = motion.tags[index];
    const result = motion.results[index];
    const winnerLit =
      result?.winner === true && motion.winnersAt !== null && motion.time >= motion.winnersAt;
    return {
      name: who.name,
      shortName: who.shortName,
      stack: Math.max(0, seat.stack - motion.incoming[index]),
      avatar: who.avatar,
      presence,
      folded: live && seat.folded,
      allIn: live && seat.allIn && !seat.folded && motion.revealAt[index] === null,
      actingPulseMs: table.actingSeat === index ? motion.actingPulseMs(index) : null,
      winner: winnerLit,
      tilted: who.tilted,
      busted: motion.busted[index],
      tag:
        tag === null || motion.revealAt[index] !== null
          ? null
          : {
              label: tag.label,
              tone: tag.tone,
              alpha: 1 - motion.settled(tag.fadeFrom, TAG_FADE_MS),
            },
      blind: live ? blindAt(table, index) : null,
      fidget: motion.progress(motion.fidgetAt[index], FIDGET_MS),
    };
  }

  private paintSeat(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    index: number,
    identity: (seat: number, occupantId: string | null) => PokerSeatIdentity,
    controls: PokerTableControls,
    colors: PokerTableColors,
  ): boolean {
    const motion = this.motion;
    const seatLayout = layout.seats[index];
    const seat = table.seats[index];
    const change = motion.seatChange[index];
    const isPlayer = index === PLAYER_SEAT;

    if (!isPlayer) this.paintTuckedCards(ui, seatLayout, index);

    const leaving = change === null ? 0 : 1 - motion.settled(change.at, SEAT_FADE_MS);
    if (change !== null && leaving > 0) {
      const ghost = identity(index, change.leaving);
      paintSeatPlate(
        ui,
        seatLayout,
        this.ghostModel(ghost, leaving),
        colors,
        table.tier,
        motion.time,
      );
    } else {
      const arriving =
        change === null ? 1 : motion.settled(change.at + motion.scaled(SEAT_FADE_MS), SEAT_FADE_MS);
      const model = this.seatModel(table, seat, identity(index, seat.occupantId), arriving);
      paintSeatPlate(ui, seatLayout, model, colors, table.tier, motion.time);
    }

    if (isPlayer) this.paintPlayerCards(ui, seatLayout, table);
    else this.paintShownCards(ui, layout, seatLayout, table, index, colors);
    this.paintBet(ui, layout, seatLayout, table, index, colors);

    const tapped = controls.seatTapped;
    if (tapped === null || isPlayer || seat.occupantId === null) return false;
    return ui.hit(`seat-${index}`, seatLayout.plate, {
      onTap: () => tapped(index, seatLayout.plate),
      sound: null,
    }).focused;
  }

  private ghostModel(who: PokerSeatIdentity, presence: number): SeatPlateModel {
    return {
      name: who.name,
      shortName: who.shortName,
      stack: 0,
      avatar: who.avatar,
      presence,
      folded: false,
      allIn: false,
      actingPulseMs: null,
      winner: false,
      tilted: false,
      busted: false,
      statusLine: LEAVING_LINE,
      tag: null,
      blind: null,
      fidget: null,
    };
  }

  /** A regular's two backs, tucked behind the plate; a recheck tell lifts and tilts them for a look. */
  private paintTuckedCards(ui: Ui, seat: PokerSeatLayout, index: number): void {
    const motion = this.motion;
    const held = motion.heldCards[index];
    if (held === 0 || motion.cardsGone[index] || motion.revealAt[index] !== null) return;
    const recheck = motion.progress(motion.recheckAt[index], RECHECK_MS);
    const peek = recheck === null ? 0 : Math.sin(recheck * Math.PI);
    for (let card = 0; card < held; card++) {
      const pose = this.tuckedPose(seat, card);
      drawCardBack(ui.ctx, {
        x: pose.x,
        y: pose.y - peek * pose.width * CARD_ASPECT * RECHECK_LIFT,
        width: pose.width,
        rotation: peek * RECHECK_TILT * (card === 0 ? -1 : 1),
      });
    }
  }

  private tuckedPose(seat: PokerSeatLayout, card: number): { x: number; y: number; width: number } {
    const w = seat.holeCards.h / CARD_ASPECT;
    return { x: seat.holeCards.x + card * w * TUCKED_CARD_STEP, y: seat.holeCards.y, width: w };
  }

  private playerCardPose(
    seat: PokerSeatLayout,
    card: number,
  ): { x: number; y: number; width: number } {
    const w = seat.holeCards.h / CARD_ASPECT;
    return { x: seat.holeCards.x + card * w * PLAYER_CARD_STEP, y: seat.holeCards.y, width: w };
  }

  private shownPose(seat: PokerSeatLayout, card: number): { x: number; y: number; width: number } {
    const w = seat.shownCards.h / CARD_ASPECT;
    return { x: seat.shownCards.x + card * w * SHOWN_CARD_STEP, y: seat.shownCards.y, width: w };
  }

  private handCardOpts(
    card: Card,
    colors: PokerTableColors,
  ): { highlight?: string; dim?: number; lift: number } {
    return this.boardCardOpts(card, colors);
  }

  private paintPlayerCards(ui: Ui, seat: PokerSeatLayout, table: PokerTable): void {
    const motion = this.motion;
    const player = table.seats[PLAYER_SEAT];
    if (motion.cardsGone[PLAYER_SEAT]) return;
    const colors = pokerTableColors(ui.theme);
    for (
      let index = 0;
      index < Math.min(motion.heldCards[PLAYER_SEAT], player.holeCards.length);
      index++
    ) {
      const card = player.holeCards[index];
      const base = this.playerCardPose(seat, index);
      const opts = this.handCardOpts(card, colors);
      const pose = {
        ...base,
        y: base.y - opts.lift * base.width * CARD_ASPECT * WIN_LIFT_FRACTION,
      };
      const drawOpts = { highlight: opts.highlight, dim: opts.dim, liftShadow: true };
      const flip = motion.progress(motion.playerFlipAt[index], FLIP_MS);
      if (flip !== null) drawCardFlip(ui.ctx, card, pose, flip, drawOpts);
      else drawCardFace(ui.ctx, card, pose, drawOpts);
    }
  }

  /** A regular's hand turned face up at showdown, with its name under it. */
  private paintShownCards(
    ui: Ui,
    layout: PokerLayout,
    seat: PokerSeatLayout,
    table: PokerTable,
    index: number,
    colors: PokerTableColors,
  ): void {
    const motion = this.motion;
    const revealAt = motion.revealAt[index];
    if (revealAt === null || motion.cardsGone[index]) return;
    const held = table.seats[index].holeCards;
    const shownOnly = motion.shownOnly[index];
    const flip = motion.progress(revealAt, FLIP_MS);
    for (let card = 0; card < Math.min(HOLE_CARD_COUNT, held.length); card++) {
      const face = held[card];
      const base = this.shownPose(seat, card);
      const showsFace = shownOnly === null || shownOnly.some((shown) => shown === card);
      if (!showsFace) {
        drawCardBack(ui.ctx, base, { liftShadow: true });
        continue;
      }
      const opts = this.handCardOpts(face, colors);
      const pose = {
        ...base,
        y: base.y - opts.lift * base.width * CARD_ASPECT * WIN_LIFT_FRACTION,
      };
      const drawOpts = { highlight: opts.highlight, dim: opts.dim, liftShadow: true };
      if (flip !== null) drawCardFlip(ui.ctx, face, pose, flip, drawOpts);
      else drawCardFace(ui.ctx, face, pose, drawOpts);
    }
    const result = motion.results[index];
    if (result === null || result.label === '' || flip !== null) return;
    this.paintHandName(
      ui,
      seat.handName,
      layout.panel,
      result.label,
      result.winner && motion.winnersAt !== null && motion.time >= motion.winnersAt,
      colors,
    );
  }

  private paintHandName(
    ui: Ui,
    under: Rect,
    bounds: Rect,
    label: string,
    winner: boolean,
    colors: PokerTableColors,
  ): void {
    const { theme, ctx } = ui;
    const lineH = theme.type.caption.lineHeight;
    const lines =
      under.h >= lineH * HAND_NAME_MAX_LINES ? handNameLines(label) : [handNameShortLine(label)];
    const styles = [{ ...theme.type.caption, weight: theme.type.label.weight }, theme.type.caption];
    const maxW = Math.min(under.w, bounds.w - theme.space.sm * 2);
    const widest = Math.max(
      ...lines.map((line, index) => measureText(ui, line, { style: styles[index] })),
    );
    const w = Math.min(maxW, widest + HAND_NAME_PAD * 2);
    const h = lineH * lines.length + HAND_NAME_PAD;
    const centred = under.x + under.w * HALF - w * HALF;
    const left = bounds.x + theme.space.sm;
    const right = bounds.x + bounds.w - theme.space.sm - w;
    const plate = {
      x: Math.max(left, Math.min(right, centred)),
      y: under.y + under.h * HALF - h * HALF,
      w,
      h,
    };
    fillRounded(ctx, plate, theme.radius.sm, winner ? colors.winnerGlow : colors.betHalo);
    const rows = splitV(
      inset(plate, { l: HAND_NAME_PAD, r: HAND_NAME_PAD, t: HAND_NAME_PAD * HALF }),
      lines.map(() => lineH),
      0,
    );
    lines.forEach((line, index) => {
      text(ui, rows[index], {
        text: line,
        style: styles[index],
        color: winner ? colors.puckText : colors.name,
        align: 'center',
        valign: 'middle',
      });
    });
  }

  private paintBet(
    ui: Ui,
    layout: PokerLayout,
    seat: PokerSeatLayout,
    table: PokerTable,
    index: number,
    colors: PokerTableColors,
  ): void {
    const motion = this.motion;
    const amount = motion.feltBets[index];
    if (amount <= 0) return;
    const pop = motion.progress(motion.betPopAt[index], BET_POP_MS);
    const scale = pop === null ? 1 : 1 + Math.sin(pop * Math.PI) * BET_POP_GROWTH;
    const r = layout.chipRadius * scale;
    const spot = seat.betSpot;
    drawPokerChipStack(
      ui,
      spot.x,
      spot.y + r * HALF,
      r,
      table.tier,
      pokerChips(amount, table.tier, MAX_BET_CHIPS),
      { labelTop: false },
    );
    const style = ui.theme.type.label;
    const label = coins(amount);
    const w = measureText(ui, label, { style, tabular: true });
    const leftSide = seat.betLabelSide === 'left';
    const x = leftSide ? spot.x - r - ui.theme.space.xs - w : spot.x + r + ui.theme.space.xs;
    text(
      ui,
      { x, y: spot.y - style.lineHeight * HALF, w, h: style.lineHeight },
      {
        text: label,
        style,
        color: colors.betText,
        tabular: true,
        halo: colors.betHalo,
      },
    );
  }

  private paintPuck(ui: Ui, layout: PokerLayout, colors: PokerTableColors): void {
    const motion = this.motion;
    const to = motion.puckTo;
    if (to === null) return;
    const target = layout.seats[to].buttonSpot;
    const from = motion.puckFrom === null ? target : layout.seats[motion.puckFrom].buttonSpot;
    const t = easeOutCubic(motion.settled(motion.puckAt, PUCK_SLIDE_MS));
    const x = lerp(from.x, target.x, t);
    const y = lerp(from.y, target.y, t);
    const r = layout.chipRadius * PUCK_RADIUS_FRACTION;
    const { ctx, theme } = ui;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fillStyle = colors.puckFace;
    ctx.fill();
    ctx.lineWidth = PUCK_EDGE_WIDTH;
    ctx.strokeStyle = colors.puckEdge;
    ctx.stroke();
    ctx.restore();
    text(
      ui,
      { x: x - r, y: y - r, w: r * 2, h: r * 2 },
      {
        text: 'D',
        style: theme.type.overline,
        color: colors.puckText,
        align: 'center',
        valign: 'middle',
      },
    );
  }

  // ── Flights and the shuffle ──────────────────────────────────────────────

  private anchorPoint(
    ui: Ui,
    layout: PokerLayout,
    anchor: FlightAnchor,
  ): { point: Point; cardW: number } {
    const pile = layout.pileCardWidth;
    switch (anchor.kind) {
      case 'deck':
        return { point: layout.deck, cardW: pile };
      case 'muck':
        return { point: layout.muck, cardW: pile };
      case 'pot':
        return { point: this.potChipPoint(ui, layout), cardW: pile };
      case 'plate':
        return { point: layout.seats[anchor.seat].anchor, cardW: pile };
      case 'stack':
        return { point: layout.seats[anchor.seat].betSpot, cardW: pile };
      case 'bet':
        return { point: layout.seats[anchor.seat].betSpot, cardW: pile };
      case 'board': {
        const slot = layout.board[anchor.index];
        return { point: { x: slot.x + slot.w * HALF, y: slot.y + slot.h * HALF }, cardW: slot.w };
      }
      case 'hole': {
        const seat = layout.seats[anchor.seat];
        const pose =
          anchor.seat === PLAYER_SEAT
            ? this.playerCardPose(seat, anchor.index)
            : this.tuckedPose(seat, anchor.index);
        const h = pose.width * CARD_ASPECT;
        return {
          point: { x: pose.x + pose.width * HALF, y: pose.y + h * HALF },
          cardW: pose.width,
        };
      }
    }
  }

  private paintFlights(ui: Ui, layout: PokerLayout, table: PokerTable): void {
    const motion = this.motion;
    for (const flight of motion.flights) {
      if (motion.time < flight.startAt) continue;
      const progress = Math.min(1, (motion.time - flight.startAt) / Math.max(1, flight.duration));
      if (flight.kind === 'card') this.paintCardFlight(ui, layout, flight, progress);
      else this.paintChipFlight(ui, layout, table, flight, progress);
    }
  }

  private paintCardFlight(ui: Ui, layout: PokerLayout, flight: Flight, progress: number): void {
    const from = this.anchorPoint(ui, layout, flight.from);
    const to = this.anchorPoint(ui, layout, flight.to);
    const eased = easeOutCubic(progress);
    const arc = Math.sin(progress * Math.PI);
    const w = lerp(from.cardW, to.cardW, eased) * (1 + arc * CARD_FLIGHT_LIFT);
    const h = w * CARD_ASPECT;
    const x = lerp(from.point.x, to.point.x, eased);
    const y = lerp(from.point.y, to.point.y, eased);
    drawCardBack(
      ui.ctx,
      { x: x - w * HALF, y: y - h * HALF, width: w, rotation: arc * CARD_FLIGHT_SPIN },
      { liftShadow: true },
    );
  }

  private paintChipFlight(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    flight: Flight,
    progress: number,
  ): void {
    if (flight.kind !== 'chips') return;
    const from = this.anchorPoint(ui, layout, flight.from).point;
    const to = this.anchorPoint(ui, layout, flight.to).point;
    const r = layout.chipRadius;
    const eased = easeOutCubic(progress);
    const arc = -Math.sin(progress * Math.PI) * r * CHIP_ARC_FRACTION;
    const x = lerp(from.x, to.x, eased);
    const y = lerp(from.y, to.y, eased) + arc;
    const chips = pokerChips(flight.amount, table.tier, MAX_FLIGHT_CHIPS);
    if (!flight.splash) {
      drawPokerChipStack(ui, x, y + r * HALF, r, table.tier, chips, {
        shadow: true,
        labelTop: false,
      });
      return;
    }
    const spread = Math.sin(progress * Math.PI) * r * SPLASH_SPREAD;
    chips.forEach((chip, index) => {
      const angle = index * SPLASH_ANGLE_STEP;
      drawPokerChipStack(
        ui,
        x + Math.cos(angle) * spread,
        y + Math.sin(angle) * spread * HALF,
        r,
        table.tier,
        [chip],
        { shadow: true, labelTop: false },
      );
    });
  }

  /** The riffle before every deal: two halves of the deck interleaving over the board. */
  private paintShuffle(ui: Ui, layout: PokerLayout): void {
    const progress = this.motion.progress(this.motion.shuffleAt, SHUFFLE_MS);
    if (progress === null) return;
    const first = layout.board[0];
    const last = layout.board[layout.board.length - 1];
    const centre = { x: (first.x + last.x + last.w) * HALF, y: first.y + first.h * HALF };
    const cardW = layout.boardCardWidth * SHUFFLE_CARD_FRACTION;
    const span = last.x + last.w - first.x;
    const spread = Math.sin(progress * Math.PI) * span * SHUFFLE_SPLIT_SPREAD;
    for (let index = 0; index < SHUFFLE_CARD_COUNT; index++) {
      const side = index % 2 === 0 ? -1 : 1;
      const rank = Math.floor(index / 2) / (SHUFFLE_CARD_COUNT / 2);
      drawCardBack(
        ui.ctx,
        {
          x: centre.x - cardW * HALF + side * spread * (1 - rank),
          y: centre.y - cardW * CARD_ASPECT * HALF + rank * cardW * SHUFFLE_DROP_FRACTION,
          width: cardW,
          rotation: side * spread * SHUFFLE_TILT_PER_UNIT,
        },
        { alpha: 1 - progress * HALF, liftShadow: true },
      );
    }
  }

  // ── "Your hand", the action bar, the footer ──────────────────────────────

  private paintHandLabel(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    colors: PokerTableColors,
  ): void {
    const motion = this.motion;
    const player = table.seats[PLAYER_SEAT];
    const flipped = motion.playerFlipAt.filter((at) => at !== null && motion.time >= at).length;
    const cardsUp = Math.min(flipped, motion.heldCards[PLAYER_SEAT], player.holeCards.length);
    const style = ui.theme.type.label;
    if (table.phase === 'player_busted') {
      text(ui, layout.handLabel, {
        text: 'Out of chips',
        style,
        color: colors.muted,
        align: 'center',
      });
      return;
    }
    if (cardsUp === 0 || (!table.handInProgress && motion.winnersAt === null)) {
      text(ui, layout.handLabel, {
        text: table.handInProgress ? 'Your hand: dealing…' : 'Your hand: waiting for the deal',
        style,
        color: colors.handLabel,
        align: 'center',
      });
      return;
    }
    const known = [
      ...player.holeCards.slice(0, cardsUp),
      ...table.board.slice(0, motion.boardShownCount()),
    ];
    const best = evaluateBest(known);
    const folded = player.folded && player.inHand;
    text(ui, layout.handLabel, {
      text: folded ? `Folded · ${best.label}` : `Your hand: ${best.label}`,
      style,
      color: folded ? colors.muted : colors.handLabelEmphasis,
      align: 'center',
    });
  }

  private actionButtons(
    table: PokerTable,
    legal: LegalActions,
    controls: PokerTableControls,
  ): ActionButton[] {
    const buttons: ActionButton[] = [];
    if (legal.canFold && !legal.canCheck) {
      buttons.push({
        id: 'fold',
        label: 'Fold',
        variant: 'danger',
        primary: false,
        onTap: () => controls.act({ kind: 'fold' }),
      });
    }
    if (legal.canCheck) {
      buttons.push({
        id: 'check',
        label: 'Check',
        variant: 'primary',
        primary: true,
        onTap: () => controls.act({ kind: 'check' }),
      });
    }
    const call = legal.call;
    if (call !== null) {
      buttons.push({
        id: 'call',
        label: `Call ${coins(call)}`,
        variant: 'primary',
        primary: true,
        onTap: () => controls.act({ kind: 'call' }),
      });
    }
    const sizing = legal.bet ?? legal.raise;
    const kind = legal.bet !== null ? 'bet' : 'raise';
    if (sizing !== null) {
      const word = kind === 'bet' ? 'Bet' : 'Raise';
      if (sizing.min >= sizing.max) {
        const amount = sizing.min;
        buttons.push({
          id: 'raise',
          label: kind === 'bet' ? `Bet ${coins(amount)}` : `Raise to ${coins(amount)}`,
          variant: 'secondary',
          primary: false,
          onTap: () => controls.act({ kind, amount }),
        });
      } else {
        buttons.push({
          id: 'raise',
          label: word,
          icon: 'chevronUp',
          variant: 'secondary',
          primary: false,
          onTap: () => this.openTray(table, kind, sizing.min, sizing.max),
        });
      }
    }
    const allIn = legal.allIn;
    if (allIn !== null) {
      buttons.push({
        id: 'all-in',
        label: `All-in ${coins(allIn)}`,
        variant: 'secondary',
        primary: false,
        onTap: () => controls.act({ kind: 'all_in' }),
      });
    }
    return buttons;
  }

  /** Opens the tray as the Raise button does; false when the player has no sized bet or raise to make. */
  openTrayFor(table: PokerTable): boolean {
    const legal = table.playerLegalActions();
    const sizing = legal?.bet ?? legal?.raise ?? null;
    if (legal === null || sizing === null || sizing.min >= sizing.max) return false;
    this.openTray(table, legal.bet !== null ? 'bet' : 'raise', sizing.min, sizing.max);
    return true;
  }

  private openTray(table: PokerTable, kind: 'bet' | 'raise', min: number, max: number): void {
    const opening = this.presetAmount(table, kind, HALF, min, max);
    this.tray = {
      kind,
      hand: table.handNumber,
      picker: new QuantityPickerState({ min, max, initial: opening }),
    };
  }

  /** A pot-sized raise is a call plus the pot after calling; `potShare` scales the second half. */
  private presetAmount(
    table: PokerTable,
    kind: 'bet' | 'raise',
    potShare: number,
    min: number,
    max: number,
  ): number {
    const legal = table.playerLegalActions();
    const toCall = legal?.toCall ?? 0;
    const topBet = table.seats.reduce((top, seat) => Math.max(top, seat.streetBet), 0);
    const base = kind === 'bet' ? 0 : topBet;
    const raw = base + potShare * (table.pot + toCall);
    const unit = smallestChip(table.tier);
    const rounded = Math.round(raw / unit) * unit;
    return Math.max(min, Math.min(max, rounded));
  }

  private paintActionBar(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    controls: PokerTableControls,
  ): boolean {
    const bar = layout.actionBar;
    const legal = table.playerLegalActions();
    const { theme } = ui;
    if (legal === null) {
      const player = table.seats[PLAYER_SEAT];
      const folded = table.handInProgress && player.inHand && player.folded;
      if (folded) {
        const widest = Math.max(
          measureButton(ui, { label: SKIP_LABEL, icon: 'play' }),
          measureButton(ui, { label: SKIPPING_LABEL, icon: 'hourglass' }),
        );
        const w = Math.min(bar.w, widest + theme.space.lg * 2);
        const cell = centerIn(bar, w, layout.controlHeight);
        if (controls.skipping) {
          this.paintSkipping(ui, cell);
          return false;
        }
        return button(ui, cell, {
          id: 'skip',
          label: SKIP_LABEL,
          icon: 'play',
          variant: 'secondary',
          onTap: () => controls.skip(),
        }).focused;
      }
      text(ui, bar, {
        text: this.waitingLine(table),
        role: 'muted',
        align: 'center',
        valign: 'middle',
      });
      return false;
    }
    // The raise tray stands in for the bar while it is open.
    if (this.tray !== null) return false;
    const buttons = this.actionButtons(table, legal, controls);
    const slide = 1 - easeOutCubic(this.motion.settled(this.motion.turnAt, TURN_SLIDE_MS));
    let focused = false;
    ui.clip(bar, () => {
      ui.ctx.save();
      const drop = slide * (bar.h + theme.space.sm);
      ui.ctx.translate(0, drop);
      const cells = this.actionCells(bar, layout, buttons.length, theme.space.sm);
      buttons.forEach((action, index) => {
        const state = button(ui, cells[index], {
          id: action.id,
          label: action.label,
          icon: action.icon,
          variant: action.variant,
          primary: action.primary,
          onTap: action.onTap,
        });
        if (state.focused) focused = true;
      });
      ui.ctx.restore();
    });
    return focused;
  }

  /**
   * Skip, once pressed: the toggled-on look with an hourglass that keeps
   * turning, so it reads as working rather than unavailable. It swallows a
   * second press silently and stays out of the focus ring, since there is
   * nothing left for it to do.
   */
  private paintSkipping(ui: Ui, cell: Rect): void {
    const { theme } = ui;
    const skins = skinsFor(theme);
    const sizeSkin = skins.controlSize.md;
    ui.hit('skip', cell, { onTap: () => undefined, focusable: false, sound: null });
    paintSkinnedControl(ui, cell, {
      label: '',
      skin: skins.selected,
      look: { hovered: false, pressed: false, focused: false },
      disabled: false,
      radius: sizeSkin.radius,
      textStyle: sizeSkin.text,
    });
    const ink = skins.selected.rest.text;
    const labelW = measureText(ui, SKIPPING_LABEL, { style: sizeSkin.text });
    const groupW = sizeSkin.icon + sizeSkin.gap + labelW;
    const left = cell.x + cell.w * HALF - groupW * HALF;
    const iconRect = {
      x: left,
      y: cell.y + cell.h * HALF - sizeSkin.icon * HALF,
      w: sizeSkin.icon,
      h: sizeSkin.icon,
    };
    // A half turn, then a rest, the way an hourglass is flipped: calm, and
    // still plainly moving.
    const period = theme.motion.slow * HOURGLASS_PERIOD_BEATS;
    const phase = (ui.now % period) / period;
    const turn = Math.min(1, phase / HOURGLASS_TURN_SHARE);
    const angle = easeOutCubic(turn) * Math.PI;
    const { ctx } = ui;
    ctx.save();
    ctx.translate(iconRect.x + iconRect.w * HALF, iconRect.y + iconRect.h * HALF);
    ctx.rotate(angle);
    ctx.translate(-iconRect.w * HALF, -iconRect.h * HALF);
    drawGlyph(ctx, 'hourglass', { x: 0, y: 0, w: iconRect.w, h: iconRect.h }, { color: ink });
    ctx.restore();
    text(
      ui,
      { x: left + sizeSkin.icon + sizeSkin.gap, y: cell.y, w: labelW, h: cell.h },
      { text: SKIPPING_LABEL, style: sizeSkin.text, color: ink, valign: 'middle' },
    );
  }

  private actionCells(bar: Rect, layout: PokerLayout, count: number, gap: number): Rect[] {
    if (layout.actionRows <= 1 || count <= 2) {
      const row = layout.actionRows <= 1 ? bar : centerIn(bar, bar.w, layout.controlHeight);
      return splitH(
        row,
        Array.from({ length: count }, () => 'fill' as const),
        gap,
      );
    }
    const perRow = Math.ceil(count / layout.actionRows);
    const rows = splitV(
      bar,
      Array.from({ length: layout.actionRows }, () => layout.controlHeight),
      gap,
    );
    const cells: Rect[] = [];
    rows.forEach((row, rowIndex) => {
      const inRow = Math.min(perRow, count - rowIndex * perRow);
      if (inRow <= 0) return;
      cells.push(
        ...splitH(
          row,
          Array.from({ length: inRow }, () => 'fill' as const),
          gap,
        ),
      );
    });
    return cells;
  }

  private waitingLine(table: PokerTable): string {
    const acting = table.actingSeat;
    if (acting !== null && acting !== PLAYER_SEAT) return WAITING_LINE;
    switch (table.phase) {
      case 'shuffling':
        return 'Shuffling up…';
      case 'posting_blinds':
      case 'dealing_hole':
        return 'Dealing…';
      case 'showdown':
        return 'Showdown';
      case 'awarding':
        return 'Pushing the pot…';
      case 'between_hands':
        return 'Next hand coming up…';
      case 'player_busted':
      case 'game_over':
        return '';
      case 'preflop':
      case 'flop':
      case 'turn':
      case 'river':
        return WAITING_LINE;
      case 'dealing_flop':
      case 'dealing_turn':
      case 'dealing_river':
        return 'Dealing…';
      case 'left':
        return '';
    }
  }

  private paintFooter(ui: Ui, layout: PokerLayout, controls: PokerTableControls): boolean {
    const { footer } = layout;
    const states: HitState[] = [];
    const rules = controls.rules;
    const history = controls.history;
    // The open raise tray is a layer over the whole table: anything painted
    // under it could not be pressed, so the footer steps aside while it is up.
    // Leave alone stays, drawn on the tray's layer by paintTray where the tray
    // leaves room for it; elsewhere the tray's ✕ and Escape back out first.
    if (this.tray !== null) return false;
    const entries: ReadonlyArray<{
      readonly cell: Rect;
      readonly id: string;
      readonly icon: GlyphId;
      readonly label: string;
      readonly tooltip: string;
      readonly selected?: boolean;
      readonly disabled?: boolean;
      readonly onTap: () => void;
    }> = [
      {
        cell: footer.rules,
        id: 'rules',
        icon: 'book',
        label: 'Rules',
        tooltip: 'Rules',
        disabled: rules === null,
        onTap: () => rules?.(),
      },
      {
        cell: footer.history,
        id: 'history',
        icon: 'clock',
        label: 'History',
        tooltip: 'Hand history',
        disabled: history === null,
        onTap: () => history?.(),
      },
      {
        cell: footer.fast,
        id: 'fast',
        icon: 'zap',
        label: 'Fast',
        tooltip: controls.fast ? 'Fast dealing: on' : 'Fast dealing: off',
        selected: controls.fast,
        onTap: () => controls.toggleFast(),
      },
      {
        cell: footer.showCards,
        id: 'show-cards',
        icon: 'eye',
        label: 'Show cards',
        tooltip: controls.showCards ? 'Show losing hands: on' : 'Show losing hands: off',
        selected: controls.showCards,
        onTap: () => controls.toggleShowCards(),
      },
    ];
    for (const entry of entries) {
      states.push(
        footer.iconsOnly
          ? iconButton(ui, entry.cell, {
              id: entry.id,
              icon: entry.icon,
              label: entry.tooltip,
              variant: 'ghost',
              selected: entry.selected,
              disabled: entry.disabled,
              onTap: entry.onTap,
            })
          : button(ui, entry.cell, {
              id: entry.id,
              label: entry.label,
              icon: entry.icon,
              variant: 'ghost',
              selected: entry.selected,
              disabled: entry.disabled,
              onTap: entry.onTap,
            }),
      );
    }
    states.push(this.paintLeave(ui, layout, controls));
    return states.some((state) => state.focused);
  }

  private paintLeave(ui: Ui, layout: PokerLayout, controls: PokerTableControls): HitState {
    const { footer } = layout;
    return footer.leaveIconOnly
      ? iconButton(ui, footer.leave, {
          id: 'leave',
          icon: 'logOut',
          label: 'Leave table',
          variant: 'danger',
          onTap: () => controls.leave(),
        })
      : button(ui, footer.leave, {
          id: 'leave',
          label: 'Leave',
          icon: 'logOut',
          variant: 'danger',
          onTap: () => controls.leave(),
        });
  }

  // ── The raise tray ───────────────────────────────────────────────────────

  private paintTray(
    ui: Ui,
    layout: PokerLayout,
    table: PokerTable,
    tray: RaiseTray,
    controls: PokerTableControls,
  ): boolean {
    const { theme } = ui;
    const { space } = theme;
    const close = (): void => this.closeTray();
    ui.layer({ onEscape: close });
    ui.hit('tray-dismiss', screenInSafeArea(ui), { onTap: close, focusable: false, sound: null });
    const body = layout.raiseTray;
    const frame = inset(body, -space.xs);
    // Where the tray leaves Leave showing, Leave joins the tray's layer so a
    // click on it leaves rather than only closing the tray.
    const leaveShows = !overlaps(layout.footer.leave, frame);
    const leave = leaveShows ? this.paintLeave(ui, layout, controls) : null;
    ui.block(frame);
    drawGlass(ui, frame, skinsFor(theme).panel.raised);
    const controlH = layout.controlHeight;
    const gap = space.xs;
    const fullRows = layout.trayRows > TRAY_FOLDED_ROWS;
    const rows = splitV(
      centerIn(body, body.w, controlH * layout.trayRows + gap * (layout.trayRows - 1)),
      Array.from({ length: layout.trayRows }, () => controlH),
      gap,
    );
    const picker = tray.picker;
    const confirmLabel =
      picker.value >= picker.max
        ? `All-in ${coins(picker.value)}`
        : `${tray.kind === 'bet' ? 'Bet' : 'Raise to'} ${coins(picker.value)}`;
    const confirmW = measureButton(ui, { label: confirmLabel });
    const [presetRow, secondRow] = rows;
    const [presetCells, cancelCell] = fullRows
      ? [presetRow, null]
      : splitH(presetRow, ['fill', controlH], gap);
    const [stepCell, confirmCell] = fullRows
      ? [secondRow, null]
      : splitH(secondRow, ['fill', confirmW], gap);

    const cells = splitH(
      presetCells,
      RAISE_PRESETS.map(() => 'fill' as const),
      gap,
    );
    const presetStates = RAISE_PRESETS.map((preset, index) => {
      const cell = cells[index];
      const amount =
        preset.potShare === 'min'
          ? picker.min
          : preset.potShare === 'max'
            ? picker.max
            : this.presetAmount(table, tray.kind, preset.potShare, picker.min, picker.max);
      const roomy = measureButton(ui, { label: preset.label, size: 'sm' }) <= cell.w;
      return button(ui, cell, {
        id: preset.id,
        label: roomy ? preset.label : preset.short,
        size: 'sm',
        variant: 'ghost',
        selected: picker.value === amount,
        onTap: () => {
          picker.stepBy(amount - picker.value);
        },
      });
    });

    stepper(ui, stepCell, {
      id: 'raise-amount',
      state: picker,
      large: false,
      max: false,
      step: smallestChip(table.tier),
      holdStep: table.stakes.bigBlind,
      height: controlH,
      format: coins,
    });

    const lastRow = rows[layout.trayRows - 1];
    const [cancelAt, confirmAt] =
      cancelCell === null || confirmCell === null
        ? splitH(lastRow, [controlH, 'fill'], gap)
        : [cancelCell, confirmCell];
    const cancel = iconButton(ui, cancelAt, {
      id: 'close',
      icon: 'close',
      label: CANCEL_LABEL,
      variant: 'ghost',
      onTap: close,
    });
    const confirm = button(ui, confirmAt, {
      id: 'tray-confirm',
      label: confirmLabel,
      variant: 'primary',
      primary: true,
      onTap: () => {
        this.closeTray();
        controls.act({ kind: tray.kind, amount: picker.value });
      },
    });
    return (
      presetStates.some((state) => state.focused) ||
      cancel.focused ||
      confirm.focused ||
      leave?.focused === true
    );
  }
}
