/**
 * Paints the wheel screen from a model the host builds each frame: the stage,
 * the wheel with its pointer, clapper and chasing rim bulbs, Donald's bust and
 * patter, the bet stepper, the press-and-hold SPIN, and whatever reveal an
 * outcome is playing. Holds no game state; every animation is a function of
 * the model's clocks, so a frozen model paints the same frame every time.
 */

import type { PrizeItem } from '../../../systems/casino/wheel/wheelPrizes';
import type { Rarity } from '../../../core/items/defs/rarity';
import type { WheelBoard, WheelWedge } from '../../../systems/casino/wheel/wheelBoard';
import {
  wedgeCenterAngle,
  wedgeEndAngle,
  wedgeStartAngle,
} from '../../../systems/casino/wheel/wheelGeometry';
import {
  WHEEL_FACE_RADII,
  cachedWheelFace,
  faceCanvasAngle,
  paintWheelFace,
  paintWheelWedge,
} from '../../../sprites/art/wheelFaceArt';
import { drawAttackCowSprite } from '../../../sprites/attackCowSprite';
import { drawDonaldBust, type DonaldBustPose } from '../../../sprites/donaldSprite';
import type { Rect } from '../../core/geom';
import { inset } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { drawGlyph } from '../../theme/glyphs';
import { ITEM_ICONS } from '../../icons/itemIcons';
import {
  WHEEL_BANNER_TYPE,
  WHEEL_FLAG_TYPE,
  WHEEL_SPIN_TYPE,
  wheelInk,
} from '../../theme/wheelInk';
import type { TypeStyle } from '../../theme/tokens';
import type { TextRole } from '../../theme/skins';
import { button } from '../../widgets/button';
import { keycap, keycapSize } from '../../widgets/keycap';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { roundRectPath } from '../../widgets/roundRect';
import { lineHeightOf, measureText, measureTextHeight, text } from '../../widgets/text';
import { computeWheelLayout, type WheelDisc, type WheelLayout } from './wheelLayout';

/** What kind of show an outcome puts on. */
export type WheelRevealEffect =
  | 'red'
  | 'robbed'
  | 'freeze'
  | 'pet'
  | 'coins'
  | 'coins_big'
  | 'coins_jackpot'
  | 'item'
  | 'handies'
  | 'heal'
  | 'spin_again';

/** An outcome's reveal, as the host hands it over. */
export interface WheelReveal {
  readonly wedge: WheelWedge;
  readonly effect: WheelRevealEffect;
  readonly durationMs: number;
  /** The rarity an item prize is presented at, or null for a prize with no items. */
  readonly itemRarity: Rarity | null;
  /** Items the prize put in the crawler's bag. */
  readonly items: ReadonlyArray<PrizeItem>;
  /** What the prize paid, said in full under the banner's short name. */
  readonly prizeLine: string;
  readonly coinsTaken: number;
  readonly coinsWon: number;
  /** The party's purse before and after the outcome, for the robbery's drain. */
  readonly purseBefore: number;
  readonly purseAfter: number;
}

export interface WedgeFlip {
  readonly wedgeIndex: number;
  readonly from: WheelWedge;
  readonly to: WheelWedge;
  /** 0 as the old face starts to turn, 1 once the new face lies flat. */
  readonly progress: number;
}

export interface WheelViewModel {
  readonly nowMs: number;
  readonly board: WheelBoard;
  readonly flip: WedgeFlip | null;
  /** The wheel's turn, unwrapped, clockwise. */
  readonly rotation: number;
  /** 1 the moment a peg passes the clapper, falling to 0. */
  readonly clapperKick: number;
  /** 1 the moment the wheel lands, falling to 0. */
  readonly landingKick: number;
  readonly bulbPhase: number;
  /** Rim bulbs gone dark, counted from the first. */
  readonly bulbsDark: number;
  /** Every live bulb burns steady, so each one going out is seen. */
  readonly bulbsSteady: boolean;
  readonly bet: number;
  readonly purse: number;
  /** Why each stepper is disabled, or null. */
  readonly betDown: string | null;
  readonly betUp: string | null;
  readonly spin: {
    readonly free: boolean;
    /** Coins a free spin still takes for the upgrades bought above the minimum bet. */
    readonly upgradePrice: number;
    /** 0 to 1 while SPIN is held. */
    readonly hold: number;
    /** The hold is a finger or the mouse rather than the keyboard. */
    readonly heldByPointer: boolean;
    readonly disabled: string | null;
  };
  readonly leaveDisabled: string | null;
  readonly donald: {
    readonly pose: DonaldBustPose;
    readonly progress: number;
    readonly line: string | null;
    readonly lineAgeMs: number;
  };
  readonly reveal: (WheelReveal & { readonly elapsedMs: number }) | null;
  /** The spin is waiting on the save before the wheel may move. */
  readonly committing: boolean;
}

export interface WheelControls {
  betDown(): void;
  betUp(): void;
  leave(): void;
  spinDown(): void;
  spinRelease(): void;
}

export const WHEEL_SPIN_REGION_ID = 'spin';
export const WHEEL_LEAVE_REGION_ID = 'leave';
export const WHEEL_BET_DOWN_REGION_ID = 'bet-down';
export const WHEEL_BET_UP_REGION_ID = 'bet-up';

const TITLES = ["DONALD'S WHEEL OF FORTUNE", 'WHEEL OF FORTUNE', 'THE WHEEL'];

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;

/** The rim bulbs: how many, their size against the rim, and the chase's lit stride. */
const BULB_COUNT = 24;
const BULB_SIZE_SHARE = 0.03;
const BULB_CHASE_STRIDE = 3;
const BULB_DIM_ALPHA = 0.28;
/** The pointer: its length and width against the wheel, and how far a peg kicks it. */
const POINTER_LENGTH_SHARE = 0.17;
/**
 * How far into the face the pointer's tip reaches, as a share of the radius:
 * past the pegs so every one kicks it, and short of the label band so it
 * never hides the end of the wedge it points at.
 */
const POINTER_TIP_RADIUS = (WHEEL_FACE_RADII.pegs + WHEEL_FACE_RADII.labelOuter) * HALF;
const POINTER_WIDTH_SHARE = 0.075;
const CLAPPER_MAX_DEFLECT = 0.42;
const LANDING_WOBBLE_DEFLECT = 0.3;
const LANDING_WOBBLE_CYCLES = 3;
/** The face is painted this many device pixels per screen pixel, for a crisp edge on a dense screen. */
const FACE_OVERSAMPLE = 2;
const WHEEL_SHADOW_OFFSET_SHARE = 0.04;
const WHEEL_SHADOW_ALPHA = 0.5;
const SPOT_RADIUS_SHARE = 1.7;

/**
 * A flagged wedge's flag: its lettering grows with the wheel from the type
 * token's floor up to a ceiling, and it straddles the rim on the bulb ring,
 * clear of the neighbouring wedges' labels, with a notch pointing in at the
 * wedge it names.
 */
const FLAG_TYPE_SHARE = 0.06;
const FLAG_TYPE_MAX = 24;
const FLAG_EDGE_WIDTH = 2;
/** The notch's half-width as a share of the flag's height. */
const FLAG_NOTCH_HALF_WIDTH_SHARE = 0.35;

/** The banner swings in over this long, then holds. */
const BANNER_IN_MS = 260;
const BANNER_OUT_MS = 240;
const BANNER_FROM_SCALE = 0.6;
const BANNER_SUBTITLE_GAP = 4;

/** Coins: how many fall for each size of win, over how long, and the cap on any one shower. */
const MAX_COIN_PARTICLES = 120;
const COIN_COUNT: Readonly<Partial<Record<WheelRevealEffect, number>>> = {
  coins: 36,
  coins_big: 80,
  coins_jackpot: MAX_COIN_PARTICLES,
  heal: 18,
};
const COIN_SPAWN_WINDOW_MS = 1800;
const COIN_GRAVITY = 0.0012;
const COIN_SIZE_SHARE = 0.022;
const COIN_SIZE_MIN = 5;
/** The jackpot's glow beats slowly: well under the three-per-second flash limit. */
const JACKPOT_GLOW_PERIOD_MS = 700;
const JACKPOT_GLOW_ALPHA = 0.16;

/** The robbery: coins drain from the purse to Donald, one after another. */
const DRAIN_COINS = 16;
const DRAIN_WINDOW_MS = 1500;
const DRAIN_FLIGHT_MS = 650;
const DRAIN_ARC_SHARE = 0.35;
/** A drained coin against the header's control height. */
const DRAIN_COIN_SIZE_SHARE = 0.18;

/** The new pet: she drops in from above and bounces, then the MOO pops. */
const PET_DROP_MS = 520;
const PET_BOUNCE_SHARE = 0.12;
const PET_SIZE_SHARE = 0.55;
const PET_MOO_AT_MS = 520;
const PET_MOO_POP_MS = 220;
const PET_HAPPY_LOOP_MS = 900;
const MS_PER_SECOND = 1000;

/** Donald's speech fades in and out at the ends of its life. */
const LINE_FADE_MS = 220;
const LINE_LIFE_MS = 4200;
const SPEECH_TAIL = 10;

/** The hold meter traces the SPIN button's outline. */
const METER_WIDTH = 4;
const SPIN_RIM_WIDTH = 3;

const PRIME_X = 73;
const PRIME_Y = 151;
const PRIME_S = 37;
/** Each scattered quantity of a coin draws from its own stream. */
const SALT_X = 1;
const SALT_DRIFT = 2;
const SALT_FALL = 3;

/** A fixed, scattered fraction in [0, 1) for particle `index`, so every frame agrees on it. */
function scatter(index: number, salt: number): number {
  const value = Math.sin(index * PRIME_X + salt * PRIME_Y) * PRIME_S;
  return value - Math.floor(value);
}

function easeOutBack(t: number): number {
  const overshoot = 1.6;
  const shifted = t - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

function bannerTone(wedge: WheelWedge): { fill: string; edge: string } {
  const ink = wheelInk.banner;
  switch (wedge.tone) {
    case 'red':
      return { fill: ink.red, edge: ink.redEdge };
    case 'green':
      return { fill: ink.good, edge: ink.goodEdge };
    case 'gold':
      return { fill: ink.gold, edge: ink.goldEdge };
    case 'purple':
      return { fill: ink.purple, edge: ink.purpleEdge };
    case 'neutral':
      return { fill: ink.neutral, edge: ink.neutralEdge };
  }
}

function bannerTitle(reveal: WheelReveal): string {
  if (reveal.effect === 'spin_again') return 'SPIN AGAIN!';
  return reveal.wedge.shortLabel.endsWith('!')
    ? reveal.wedge.shortLabel
    : `${reveal.wedge.shortLabel}!`;
}

/** The face's pixel size for a disc at the current UI scale. */
function facePixels(ui: Ui, disc: WheelDisc): number {
  return disc.radius * 2 * ui.uiScale * FACE_OVERSAMPLE;
}

export class WheelView {
  render(ui: Ui, model: WheelViewModel, controls: WheelControls): void {
    const { ctx } = ui;
    const layout = computeWheelLayout({
      width: ui.viewport.w,
      height: ui.viewport.h,
      uiScale: ui.uiScale,
      theme: ui.theme,
    });
    this.paintStage(ui, layout);
    ctx.save();
    ctx.translate(ui.viewport.x, ui.viewport.y);
    this.paintHeader(ui, layout, model, controls);
    this.paintWheel(ui, layout.wheel, model);
    this.paintDonald(ui, layout, model);
    this.paintBet(ui, layout, model, controls);
    this.paintSpin(ui, layout, model, controls);
    if (model.reveal !== null) this.paintReveal(ui, layout, model, model.reveal);
    ctx.restore();
  }

  // ── The stage ──────────────────────────────────────────────────────────

  private paintStage(ui: Ui, layout: WheelLayout): void {
    const { ctx, screen } = ui;
    const ink = wheelInk.stage;
    ctx.save();
    const curtain = ctx.createLinearGradient(0, screen.y, 0, screen.y + screen.h);
    curtain.addColorStop(0, ink.top);
    curtain.addColorStop(1, ink.bottom);
    ctx.fillStyle = curtain;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    const cx = ui.viewport.x + layout.wheel.cx;
    const cy = ui.viewport.y + layout.wheel.cy;
    const spotR = Math.max(1, layout.wheel.radius * SPOT_RADIUS_SHARE);
    const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, spotR);
    spot.addColorStop(0, ink.spot);
    spot.addColorStop(1, ink.spotEdge);
    ctx.fillStyle = spot;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    ctx.restore();
  }

  // ── Header ─────────────────────────────────────────────────────────────

  private paintHeader(
    ui: Ui,
    layout: WheelLayout,
    model: WheelViewModel,
    controls: WheelControls,
  ): void {
    const title =
      TITLES.find((candidate) => measureText(ui, candidate, { role: 'title' }) <= layout.title.w) ??
      '';
    text(ui, layout.title, {
      text: title,
      role: 'title',
      color: wheelInk.gold.light,
      valign: 'middle',
    });
    this.paintPurse(ui, layout.purse, this.shownPurse(model), model.reveal?.effect === 'robbed');
    button(ui, layout.leave, {
      id: WHEEL_LEAVE_REGION_ID,
      label: 'Leave',
      icon: 'logOut',
      variant: 'secondary',
      disabled: model.leaveDisabled ?? false,
      onTap: () => controls.leave(),
    });
  }

  /** During a robbery the purse counts down with the coins flying out of it. */
  private shownPurse(model: WheelViewModel): number {
    const reveal = model.reveal;
    if (reveal?.effect !== 'robbed') return model.purse;
    const drained = Math.max(
      0,
      Math.min(1, reveal.elapsedMs / (DRAIN_WINDOW_MS + DRAIN_FLIGHT_MS)),
    );
    return Math.round(reveal.purseBefore + (reveal.purseAfter - reveal.purseBefore) * drained);
  }

  private paintPurse(ui: Ui, rect: Rect, coins: number, draining: boolean): void {
    const { ctx, theme } = ui;
    const ink = wheelInk.stage;
    fillRounded(ctx, rect, theme.radius.pill, ink.plate);
    strokeRounded(ctx, rect, theme.radius.pill, ink.plateEdge, 1);
    const glyphSize = theme.size.icon;
    const content = inset(rect, { l: theme.space.md, r: theme.space.md });
    drawGlyph(
      ctx,
      'coin',
      { x: content.x, y: rect.y + (rect.h - glyphSize) * HALF, w: glyphSize, h: glyphSize },
      { color: wheelInk.coin.face },
    );
    text(
      ui,
      {
        x: content.x + glyphSize + theme.space.xs,
        y: rect.y,
        w: content.w - glyphSize - theme.space.xs,
        h: rect.h,
      },
      {
        text: coins.toLocaleString(),
        role: 'value',
        color: draining ? ink.purseDrained : ink.purse,
        align: 'right',
        valign: 'middle',
        tabular: true,
      },
    );
  }

  // ── The wheel ──────────────────────────────────────────────────────────

  private paintWheel(ui: Ui, disc: WheelDisc, model: WheelViewModel): void {
    if (disc.radius <= 0) return;
    const { ctx } = ui;
    const r = disc.radius;
    ctx.save();
    ctx.fillStyle = withAlpha(wheelInk.stage.bottom, WHEEL_SHADOW_ALPHA);
    ctx.beginPath();
    ctx.arc(disc.cx, disc.cy + r * WHEEL_SHADOW_OFFSET_SHARE, r, 0, FULL_TURN);
    ctx.fill();

    ctx.translate(disc.cx, disc.cy);
    ctx.save();
    ctx.rotate(model.rotation);
    const face = cachedWheelFace(model.board, facePixels(ui, disc));
    if (face !== null) ctx.drawImage(face, -r, -r, r * 2, r * 2);
    else paintWheelFace(ctx, model.board, r);
    if (model.flip !== null) this.paintFlip(ctx, model.board, model.flip, r);
    ctx.restore();

    this.paintBulbs(ctx, r, model);
    this.paintPointer(ctx, r, model);
    // Over the pointer, so the jackpot still reads in the moment it lands under it.
    this.paintFlags(ui, r, model);
    ctx.restore();
  }

  /** A wedge turning over in place, like a card: the old face narrows to an edge, the new one widens back. */
  private paintFlip(
    ctx: CanvasRenderingContext2D,
    board: WheelBoard,
    flip: WedgeFlip,
    r: number,
  ): void {
    const a0 = faceCanvasAngle(wedgeStartAngle(board, flip.wedgeIndex));
    const a1 = faceCanvasAngle(wedgeEndAngle(board, flip.wedgeIndex));
    const mid = (a0 + a1) * HALF;
    const halfSpan = (a1 - a0) * HALF;
    const faceR = r * WHEEL_FACE_RADII.rimInner;
    ctx.save();
    ctx.fillStyle = wheelInk.flipBacking;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, faceR, a0, a1);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(mid);
    const turn = Math.cos(flip.progress * Math.PI);
    ctx.scale(1, Math.max(Number.EPSILON, Math.abs(turn)));
    paintWheelWedge(ctx, turn > 0 ? flip.from : flip.to, -halfSpan, halfSpan, r);
    ctx.restore();
  }

  private paintBulbs(ctx: CanvasRenderingContext2D, r: number, model: WheelViewModel): void {
    const ink = wheelInk.bulb;
    const ringR = r * WHEEL_FACE_RADII.bulbs;
    const size = Math.max(1, r * BULB_SIZE_SHARE);
    const step = Math.floor(model.bulbPhase);
    for (let index = 0; index < BULB_COUNT; index++) {
      const angle = -QUARTER_TURN + (index / BULB_COUNT) * FULL_TURN;
      const x = Math.cos(angle) * ringR;
      const y = Math.sin(angle) * ringR;
      const dark = index < model.bulbsDark;
      const lit = !dark && (model.bulbsSteady || (index + step) % BULB_CHASE_STRIDE === 0);
      ctx.fillStyle = ink.socket;
      ctx.beginPath();
      ctx.arc(x, y, size * (1 + HALF * HALF), 0, FULL_TURN);
      ctx.fill();
      if (lit) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * BULB_CHASE_STRIDE);
        glow.addColorStop(0, ink.glow);
        glow.addColorStop(1, ink.glowEdge);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, size * BULB_CHASE_STRIDE, 0, FULL_TURN);
        ctx.fill();
      }
      ctx.fillStyle = dark ? ink.socket : lit ? ink.lit : ink.unlit;
      ctx.globalAlpha = dark || lit ? 1 : 1 - BULB_DIM_ALPHA;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, FULL_TURN);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Flags over wedges too narrow to letter. Each turns with the wheel but its
   * lettering stays upright, so it reads at any point of the spin.
   */
  private paintFlags(ui: Ui, r: number, model: WheelViewModel): void {
    model.board.forEach((wedge, index) => {
      if (wedge.flagLabel === null) return;
      const angle = faceCanvasAngle(wedgeCenterAngle(model.board, index)) + model.rotation;
      this.paintFlag(ui, r, wedge.flagLabel, angle);
    });
  }

  private paintFlag(ui: Ui, r: number, label: string, angle: number): void {
    const { ctx, theme } = ui;
    const ink = wheelInk.flag;
    const size = Math.min(FLAG_TYPE_MAX, Math.max(WHEEL_FLAG_TYPE.size, r * FLAG_TYPE_SHARE));
    const growth = size / WHEEL_FLAG_TYPE.size;
    const style: TypeStyle = {
      ...WHEEL_FLAG_TYPE,
      size,
      lineHeight: WHEEL_FLAG_TYPE.lineHeight * growth,
    };
    const w = measureText(ui, label, { style }) + theme.space.sm * 2;
    const h = style.lineHeight + theme.space.xxs * 2;
    const ringR = r * WHEEL_FACE_RADII.bulbs;
    const cx = Math.cos(angle) * ringR;
    const cy = Math.sin(angle) * ringR;
    const flag: Rect = { x: cx - w * HALF, y: cy - h * HALF, w, h };
    const tipR = r * WHEEL_FACE_RADII.labelOuter;
    const notchHalf = h * FLAG_NOTCH_HALF_WIDTH_SHARE;
    const across = angle + QUARTER_TURN;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * tipR, Math.sin(angle) * tipR);
    ctx.lineTo(cx + Math.cos(across) * notchHalf, cy + Math.sin(across) * notchHalf);
    ctx.lineTo(cx - Math.cos(across) * notchHalf, cy - Math.sin(across) * notchHalf);
    ctx.closePath();
    ctx.fillStyle = ink.fill;
    ctx.fill();
    ctx.lineWidth = FLAG_EDGE_WIDTH;
    ctx.strokeStyle = ink.edge;
    ctx.stroke();
    ctx.restore();
    fillRounded(ctx, flag, theme.radius.pill, ink.fill);
    strokeRounded(ctx, flag, theme.radius.pill, ink.edge, FLAG_EDGE_WIDTH);
    text(ui, flag, { text: label, style, color: ink.text, align: 'center', valign: 'middle' });
  }

  /** The flapper at the top: kicked aside by every peg, wobbling when the wheel lands. */
  private paintPointer(ctx: CanvasRenderingContext2D, r: number, model: WheelViewModel): void {
    const ink = wheelInk.pointer;
    const length = r * POINTER_LENGTH_SHARE;
    const width = r * POINTER_WIDTH_SHARE;
    const pivotY = -r - length * HALF * HALF;
    const wobble =
      Math.sin(model.landingKick * LANDING_WOBBLE_CYCLES * FULL_TURN) *
      model.landingKick *
      LANDING_WOBBLE_DEFLECT;
    const deflect = model.clapperKick * CLAPPER_MAX_DEFLECT + wobble;
    ctx.save();
    ctx.translate(0, pivotY);
    ctx.rotate(-deflect);
    ctx.beginPath();
    ctx.moveTo(-width, 0);
    ctx.lineTo(width, 0);
    const tipReach = -r * POINTER_TIP_RADIUS - pivotY;
    ctx.lineTo(0, tipReach);
    ctx.closePath();
    const shade = ctx.createLinearGradient(-width, 0, width, 0);
    shade.addColorStop(0, ink.light);
    shade.addColorStop(HALF, ink.body);
    shade.addColorStop(1, ink.dark);
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.lineWidth = Math.max(1, width * HALF * HALF);
    ctx.strokeStyle = wheelInk.gold.deep;
    ctx.stroke();
    const capR = width * (HALF + HALF * HALF);
    ctx.fillStyle = wheelInk.gold.base;
    ctx.beginPath();
    ctx.arc(0, 0, capR, 0, FULL_TURN);
    ctx.fill();
    ctx.strokeStyle = wheelInk.gold.deep;
    ctx.stroke();
    ctx.restore();
  }

  // ── Donald ───────────────────────────────────────────────────────────────

  private paintDonald(ui: Ui, layout: WheelLayout, model: WheelViewModel): void {
    const { ctx, theme } = ui;
    const bust = layout.bust;
    if (bust.w > 0) {
      fillRounded(ctx, bust, theme.radius.lg, wheelInk.stage.plate);
      ctx.save();
      roundRectPath(ctx, bust, theme.radius.lg);
      ctx.clip();
      drawDonaldBust(
        ctx,
        bust.x,
        bust.y,
        bust.w,
        model.donald.pose,
        model.donald.progress,
        model.nowMs,
      );
      ctx.restore();
      strokeRounded(ctx, bust, theme.radius.lg, wheelInk.stage.plateEdge, 1);
    }
    const line = model.donald.line;
    if (line === null || layout.speech.h <= 0) return;
    const age = model.donald.lineAgeMs;
    const fade = Math.min(1, age / LINE_FADE_MS, Math.max(0, (LINE_LIFE_MS - age) / LINE_FADE_MS));
    if (fade <= 0) return;
    this.paintSpeech(ui, layout, line, fade);
  }

  private paintSpeech(ui: Ui, layout: WheelLayout, line: string, alpha: number): void {
    const { ctx, theme } = ui;
    const ink = wheelInk.stage;
    const area = layout.speech;
    const pad = theme.space.sm;
    const textW = Math.max(0, area.w - pad * 2);
    const nameH = measureTextHeight(ui, textW, { text: 'DONALD', role: 'overline' });
    const bodyH = Math.min(
      area.h - pad * 2 - nameH,
      measureTextHeight(ui, textW, { text: line, role: 'body' }),
    );
    const bubble: Rect = {
      x: area.x,
      y: area.y,
      w: area.w,
      h: Math.min(area.h, nameH + bodyH + pad * 2),
    };
    ctx.save();
    ctx.globalAlpha *= alpha;
    fillRounded(ctx, bubble, theme.radius.md, ink.speech);
    // The tail points at Donald: left on a phone, where he sits beside the bubble; up elsewhere.
    ctx.fillStyle = ink.speech;
    ctx.beginPath();
    if (layout.mode === 'compact') {
      const tailY = bubble.y + Math.min(bubble.h, layout.bust.h) * HALF;
      ctx.moveTo(bubble.x, tailY - SPEECH_TAIL);
      ctx.lineTo(bubble.x - SPEECH_TAIL, tailY);
      ctx.lineTo(bubble.x, tailY + SPEECH_TAIL);
    } else {
      const tailX = bubble.x + bubble.w * HALF;
      ctx.moveTo(tailX - SPEECH_TAIL, bubble.y);
      ctx.lineTo(tailX, bubble.y - SPEECH_TAIL);
      ctx.lineTo(tailX + SPEECH_TAIL, bubble.y);
    }
    ctx.closePath();
    ctx.fill();
    const inner = inset(bubble, pad);
    text(
      ui,
      { x: inner.x, y: inner.y, w: inner.w, h: nameH },
      { text: 'DONALD', role: 'overline', color: ink.speechName },
    );
    text(
      ui,
      { x: inner.x, y: inner.y + nameH, w: inner.w, h: bodyH },
      {
        text: line,
        role: 'body',
        color: ink.speechText,
        wrap: true,
        maxLines: Math.max(1, Math.floor(bodyH / lineHeightOf(ui, 'body'))),
      },
    );
    ctx.restore();
  }

  // ── Bet and SPIN ───────────────────────────────────────────────────────

  private paintBet(
    ui: Ui,
    layout: WheelLayout,
    model: WheelViewModel,
    controls: WheelControls,
  ): void {
    const { ctx, theme } = ui;
    button(ui, layout.betDown, {
      id: WHEEL_BET_DOWN_REGION_ID,
      label: '',
      icon: 'minus',
      variant: 'secondary',
      size: 'lg',
      disabled: model.betDown ?? false,
      sound: null,
      onTap: () => controls.betDown(),
    });
    button(ui, layout.betUp, {
      id: WHEEL_BET_UP_REGION_ID,
      label: '',
      icon: 'plus',
      variant: 'secondary',
      size: 'lg',
      disabled: model.betUp ?? false,
      sound: null,
      onTap: () => controls.betUp(),
    });
    const plate = layout.betValue;
    fillRounded(ctx, plate, theme.radius.md, wheelInk.stage.plate);
    strokeRounded(ctx, plate, theme.radius.md, wheelInk.stage.plateEdge, 1);
    const label = this.betPlateLabel(model.spin);
    const overlineH = measureTextHeight(ui, plate.w, { text: label, role: 'overline' });
    const valueStyle = this.fitStyle(ui, WHEEL_SPIN_TYPE, model.bet.toLocaleString(), plate.w);
    const valueH = valueStyle.lineHeight;
    const top = plate.y + (plate.h - overlineH - valueH) * HALF;
    text(
      ui,
      { x: plate.x, y: top, w: plate.w, h: overlineH },
      { text: label, role: 'overline', color: wheelInk.gold.light, align: 'center' },
    );
    text(
      ui,
      { x: plate.x, y: top + overlineH, w: plate.w, h: valueH },
      {
        text: model.bet.toLocaleString(),
        style: valueStyle,
        color: wheelInk.spin.label,
        align: 'center',
        tabular: true,
      },
    );
  }

  private betPlateLabel(spin: WheelViewModel['spin']): string {
    if (!spin.free) return 'BET';
    if (spin.upgradePrice === 0) return 'FREE SPIN';
    return `FREE SPIN · +${spin.upgradePrice.toLocaleString()}`;
  }

  /** `base` shrunk until `label` fits `width`. */
  private fitStyle(ui: Ui, base: TypeStyle, label: string, width: number): TypeStyle {
    const natural = measureText(ui, label, { style: base });
    if (natural <= width || natural <= 0) return base;
    const scale = width / natural;
    return {
      ...base,
      size: Math.floor(base.size * scale),
      lineHeight: Math.floor(base.lineHeight * scale),
    };
  }

  private paintSpin(
    ui: Ui,
    layout: WheelLayout,
    model: WheelViewModel,
    controls: WheelControls,
  ): void {
    const { ctx, theme } = ui;
    const ink = wheelInk.spin;
    const rect = layout.spin;
    const disabled = model.spin.disabled;
    const state = ui.hit(WHEEL_SPIN_REGION_ID, rect, {
      onDown: () => controls.spinDown(),
      onRelease: () => controls.spinRelease(),
      disabled: disabled !== null,
      focusable: false,
      sound: null,
    });
    // Like any button, sliding off before the hold completes lets it go.
    if (model.spin.heldByPointer && !state.pressed) controls.spinRelease();
    const radius = theme.radius.lg;
    const hold = model.spin.hold;
    const lit = hold > 0 || state.pressed;
    const face = model.spin.free
      ? lit
        ? ink.faceFreeLit
        : ink.faceFree
      : lit
        ? ink.faceLit
        : ink.face;
    fillRounded(ctx, rect, radius, disabled !== null && !model.committing ? ink.disabled : face);
    strokeRounded(ctx, rect, radius, hold > 0 ? ink.rim : ink.rimDim, SPIN_RIM_WIDTH);
    if (hold > 0) this.paintHoldMeter(ctx, rect, radius, hold);

    const label = model.committing
      ? '…'
      : model.spin.free
        ? 'FREE SPIN'
        : disabled !== null
          ? 'SPIN'
          : 'HOLD TO SPIN';
    const labelStyle = this.fitStyle(ui, WHEEL_SPIN_TYPE, label, rect.w - theme.space.lg * 2);
    const hint = ui.density === 'pointer' && disabled === null && !model.committing;
    const keyLabel = 'Space';
    const cap = hint ? keycapSize(ui, { label: keyLabel, small: true }) : null;
    const hintText = 'Hold';
    const subtitle = disabled !== null && !model.committing ? disabled : null;
    const subH =
      subtitle === null ? 0 : measureTextHeight(ui, rect.w, { text: subtitle, role: 'caption' });
    const capH = cap === null ? 0 : cap.h;
    const blockH = labelStyle.lineHeight + Math.max(subH, capH);
    const top = rect.y + (rect.h - blockH) * HALF;
    text(
      ui,
      { x: rect.x, y: top, w: rect.w, h: labelStyle.lineHeight },
      { text: label, style: labelStyle, color: ink.label, align: 'center' },
    );
    if (subtitle !== null) {
      text(
        ui,
        { x: rect.x, y: top + labelStyle.lineHeight, w: rect.w, h: subH },
        { text: subtitle, role: 'caption', color: ink.label, align: 'center' },
      );
    } else if (cap !== null) {
      const hintW = measureText(ui, hintText, { role: 'caption' });
      const rowW = hintW + theme.space.xs + cap.w;
      const left = rect.x + (rect.w - rowW) * HALF;
      const rowY = top + labelStyle.lineHeight;
      text(
        ui,
        { x: left, y: rowY, w: hintW, h: cap.h },
        { text: hintText, role: 'caption', color: ink.label, valign: 'middle' },
      );
      keycap(
        ui,
        { x: left + hintW + theme.space.xs, y: rowY, w: cap.w, h: cap.h },
        { label: keyLabel, small: true, pressed: hold > 0 },
      );
    }
  }

  /** The hold meter: a bright line running clockwise round the button's outline from the top centre. */
  private paintHoldMeter(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    radius: number,
    progress: number,
  ): void {
    const ink = wheelInk.spin;
    const meterRect = inset(rect, METER_WIDTH * HALF);
    const r = Math.min(radius, meterRect.h * HALF, meterRect.w * HALF);
    const straightW = meterRect.w - r * 2;
    const straightH = meterRect.h - r * 2;
    const perimeter = straightW * 2 + straightH * 2 + FULL_TURN * r;
    ctx.save();
    ctx.lineWidth = METER_WIDTH;
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink.meterTrack;
    roundRectPath(ctx, meterRect, r);
    ctx.stroke();
    // Traced from the top centre so the meter starts and ends at the same point.
    const cx = meterRect.x + meterRect.w * HALF;
    ctx.beginPath();
    ctx.moveTo(cx, meterRect.y);
    ctx.lineTo(meterRect.x + meterRect.w - r, meterRect.y);
    ctx.arcTo(
      meterRect.x + meterRect.w,
      meterRect.y,
      meterRect.x + meterRect.w,
      meterRect.y + r,
      r,
    );
    ctx.lineTo(meterRect.x + meterRect.w, meterRect.y + meterRect.h - r);
    ctx.arcTo(
      meterRect.x + meterRect.w,
      meterRect.y + meterRect.h,
      meterRect.x + meterRect.w - r,
      meterRect.y + meterRect.h,
      r,
    );
    ctx.lineTo(meterRect.x + r, meterRect.y + meterRect.h);
    ctx.arcTo(
      meterRect.x,
      meterRect.y + meterRect.h,
      meterRect.x,
      meterRect.y + meterRect.h - r,
      r,
    );
    ctx.lineTo(meterRect.x, meterRect.y + r);
    ctx.arcTo(meterRect.x, meterRect.y, meterRect.x + r, meterRect.y, r);
    ctx.closePath();
    ctx.setLineDash([perimeter * progress, perimeter]);
    ctx.strokeStyle = ink.meter;
    ctx.stroke();
    ctx.restore();
  }

  // ── Reveals ────────────────────────────────────────────────────────────

  private paintReveal(
    ui: Ui,
    layout: WheelLayout,
    model: WheelViewModel,
    reveal: WheelReveal & { readonly elapsedMs: number },
  ): void {
    switch (reveal.effect) {
      case 'coins':
      case 'coins_big':
      case 'coins_jackpot':
      case 'heal':
        this.paintCoinShower(ui, reveal);
        break;
      case 'robbed':
        this.paintDrain(ui, layout, reveal.elapsedMs);
        break;
      case 'pet':
        this.paintPet(ui, layout, model, reveal.elapsedMs);
        break;
      case 'red':
      case 'freeze':
      case 'spin_again':
      case 'item':
      case 'handies':
        break;
    }
    this.paintBanner(ui, layout, reveal);
  }

  private paintBanner(
    ui: Ui,
    layout: WheelLayout,
    reveal: WheelReveal & { readonly elapsedMs: number },
  ): void {
    const { ctx, theme } = ui;
    const slot = layout.banner;
    if (slot.w <= 0 || slot.h <= 0) return;
    const appear = Math.min(1, reveal.elapsedMs / BANNER_IN_MS);
    const leave = Math.max(0, Math.min(1, (reveal.durationMs - reveal.elapsedMs) / BANNER_OUT_MS));
    const scale = BANNER_FROM_SCALE + (1 - BANNER_FROM_SCALE) * easeOutBack(appear);
    const alpha = Math.min(appear, leave);
    if (alpha <= 0) return;

    const pad = theme.space.sm;
    const leadItem = reveal.items.length > 0 ? reveal.items[0] : null;
    const iconSide =
      leadItem === null ? 0 : Math.min(slot.h - pad * 2, (slot.w - pad * 2) * HALF * HALF);
    const iconBlock = iconSide > 0 ? iconSide + pad : 0;
    const textW = slot.w - pad * 2 - iconBlock;
    const title = bannerTitle(reveal);
    const subtitle = reveal.effect === 'spin_again' ? 'Free spin, same board.' : reveal.prizeLine;
    const titleStyle = this.fitStyle(ui, WHEEL_BANNER_TYPE, title, textW);
    // The full prize name always shows whole: it steps down a size, and the
    // banner grows to hold it, rather than ever ending in an ellipsis.
    const room = slot.h - pad * 2 - titleStyle.lineHeight - BANNER_SUBTITLE_GAP;
    const preferred: TextRole = ui.size === 'compact' ? 'label' : 'title';
    const roles: readonly TextRole[] = [preferred, 'label', 'caption'];
    const heightAt = (role: TextRole): number =>
      measureTextHeight(ui, textW, { text: subtitle, role });
    const subtitleRole = roles.find((role) => heightAt(role) <= room) ?? 'caption';
    const subH = heightAt(subtitleRole);
    const neededH = pad * 2 + titleStyle.lineHeight + BANNER_SUBTITLE_GAP + subH;
    const grow = Math.max(0, neededH - slot.h);
    const rect: Rect = { ...slot, y: slot.y - grow * HALF, h: slot.h + grow };

    const tone = bannerTone(reveal.wedge);
    ctx.save();
    ctx.globalAlpha *= alpha;
    const cx = rect.x + rect.w * HALF;
    const cy = rect.y + rect.h * HALF;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    if (reveal.effect === 'coins_jackpot') {
      const beat = (Math.sin((reveal.elapsedMs / JACKPOT_GLOW_PERIOD_MS) * FULL_TURN) + 1) * HALF;
      fillRounded(
        ctx,
        inset(rect, -theme.space.md),
        theme.radius.lg,
        withAlpha(wheelInk.coin.shine, JACKPOT_GLOW_ALPHA * beat),
      );
    }
    fillRounded(ctx, rect, theme.radius.lg, tone.fill);
    strokeRounded(ctx, rect, theme.radius.lg, tone.edge, SPIN_RIM_WIDTH);
    const content = inset(rect, pad);
    // The prize is already in the bag, so the banner shows the item itself
    // rather than a box that suggests something is left to open.
    if (leadItem !== null && iconSide > 0) {
      ITEM_ICONS[leadItem.id](ctx, {
        x: content.x,
        y: content.y + (content.h - iconSide) * HALF,
        w: iconSide,
        h: iconSide,
      });
    }
    const textX = content.x + iconBlock;
    const showSubtitle = subtitle !== title;
    const blockH = titleStyle.lineHeight + (showSubtitle ? BANNER_SUBTITLE_GAP + subH : 0);
    const top = content.y + (content.h - blockH) * HALF;
    text(
      ui,
      { x: textX, y: top, w: textW, h: titleStyle.lineHeight },
      { text: title, style: titleStyle, color: wheelInk.banner.text, align: 'center' },
    );
    if (showSubtitle) {
      text(
        ui,
        { x: textX, y: top + titleStyle.lineHeight + BANNER_SUBTITLE_GAP, w: textW, h: subH },
        {
          text: subtitle,
          role: subtitleRole,
          color: wheelInk.banner.subtext,
          align: 'center',
          wrap: true,
        },
      );
    }
    ctx.restore();
  }

  /** Coins rain from the top of the screen, each on its own arc; nothing is stepped, so any frame can be painted cold. */
  private paintCoinShower(ui: Ui, reveal: WheelReveal & { readonly elapsedMs: number }): void {
    const { ctx } = ui;
    const count = Math.min(MAX_COIN_PARTICLES, COIN_COUNT[reveal.effect] ?? 0);
    const width = ui.viewport.w;
    const height = ui.viewport.h;
    const size = Math.max(COIN_SIZE_MIN, Math.min(width, height) * COIN_SIZE_SHARE);
    for (let index = 0; index < count; index++) {
      const born = (index / count) * COIN_SPAWN_WINDOW_MS;
      const t = reveal.elapsedMs - born;
      if (t < 0) continue;
      const x0 = scatter(index, SALT_X) * width;
      const drift = (scatter(index, SALT_DRIFT) - HALF) * width * COIN_GRAVITY;
      const vy = scatter(index, SALT_FALL) * HALF * HALF;
      const x = x0 + drift * t;
      const y = -size + vy * t + COIN_GRAVITY * HALF * t * t;
      if (y > height + size) continue;
      const spin = Math.cos(t * COIN_GRAVITY * PRIME_S + index);
      this.paintCoin(ctx, x, y, size, spin);
    }
  }

  private paintCoin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    spin: number,
  ): void {
    const ink = wheelInk.coin;
    const w = Math.max(1, Math.abs(spin) * size);
    ctx.save();
    ctx.fillStyle = ink.edge;
    ctx.beginPath();
    ctx.ellipse(x, y + size * HALF * HALF, w, size, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = ink.face;
    ctx.beginPath();
    ctx.ellipse(x, y, w, size, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = ink.shine;
    ctx.beginPath();
    ctx.ellipse(
      x - w * HALF * HALF,
      y - size * HALF * HALF,
      w * HALF * HALF,
      size * HALF * HALF,
      0,
      0,
      FULL_TURN,
    );
    ctx.fill();
    ctx.restore();
  }

  /** Coins lifted out of the purse one after another and dropped in front of Donald. */
  private paintDrain(ui: Ui, layout: WheelLayout, elapsedMs: number): void {
    const { ctx } = ui;
    const from = {
      x: layout.purse.x + layout.purse.w * HALF,
      y: layout.purse.y + layout.purse.h * HALF,
    };
    const to = { x: layout.bust.x + layout.bust.w * HALF, y: layout.bust.y + layout.bust.h * HALF };
    const size = Math.max(COIN_SIZE_MIN, layout.controlHeight * DRAIN_COIN_SIZE_SHARE);
    const lift = Math.hypot(to.x - from.x, to.y - from.y) * DRAIN_ARC_SHARE;
    for (let index = 0; index < DRAIN_COINS; index++) {
      const born = (index / DRAIN_COINS) * DRAIN_WINDOW_MS;
      const t = (elapsedMs - born) / DRAIN_FLIGHT_MS;
      if (t < 0 || t > 1) continue;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * lift;
      this.paintCoin(ctx, x, y, size, Math.cos(t * FULL_TURN + index));
    }
  }

  /** The attack cow drops in over the banner and lets out a MOO. */
  private paintPet(ui: Ui, layout: WheelLayout, model: WheelViewModel, elapsedMs: number): void {
    const { ctx } = ui;
    const disc = layout.wheel;
    const tile = disc.radius * PET_SIZE_SHARE;
    if (tile <= 0) return;
    const restY = layout.banner.y - tile;
    const drop = Math.min(1, elapsedMs / PET_DROP_MS);
    const fall = drop < 1 ? drop * drop : 1;
    const bounce =
      drop >= 1
        ? Math.abs(Math.sin(((elapsedMs - PET_DROP_MS) / PET_DROP_MS) * Math.PI)) *
          Math.max(0, 1 - (elapsedMs - PET_DROP_MS) / PET_DROP_MS)
        : 0;
    const startY = -tile * 2;
    const y = startY + (restY - startY) * fall - bounce * tile * PET_BOUNCE_SHARE;
    drawAttackCowSprite(ctx, disc.cx - tile * HALF, y, tile, {
      action: drop >= 1 ? 'happy' : 'idle',
      facingX: 1,
      facingY: 1,
      gaitPhase: 0,
      progress: drop >= 1 ? ((elapsedMs - PET_DROP_MS) % PET_HAPPY_LOOP_MS) / PET_HAPPY_LOOP_MS : 0,
      clockSeconds: model.nowMs / MS_PER_SECOND,
    });
    const mooAge = elapsedMs - PET_MOO_AT_MS;
    if (mooAge < 0) return;
    const pop = Math.min(1, mooAge / PET_MOO_POP_MS);
    const style = this.fitStyle(ui, WHEEL_BANNER_TYPE, 'MOO!', disc.radius);
    const scaled: TypeStyle = {
      ...style,
      size: Math.max(1, Math.round(style.size * easeOutBack(pop))),
    };
    text(
      ui,
      { x: disc.cx, y: y - scaled.lineHeight, w: disc.radius, h: scaled.lineHeight },
      { text: 'MOO!', style: scaled, color: wheelInk.cowMoo, halo: wheelInk.banner.good },
    );
  }
}
