/**
 * Paints the slot machine and registers its controls. It owns no game state:
 * the host hands it a {@link SlotsViewModel} each frame, the reels' and
 * celebration's motion, and the actions its controls fire.
 *
 * The still parts of the cabinet, the glass's curve and sheen, the marquee
 * bulbs and the coin frames are baked once per size; every frame only blits
 * them and paints what moves.
 */

import { listAt } from '../../../systems/casino/poker/npc/listAt';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import {
  paintSlotBulb,
  paintSlotCabinet,
  paintSlotCoin,
  paintSlotGlass,
  paintSlotLever,
  paintSlotMeterPlate,
} from '../../../sprites/art/slotCabinetArt';
import type { WinTier } from '../../../systems/casino/slots/slotBets';
import { PAYLINES } from '../../../systems/casino/slots/slotPaylines';
import { ROW_COUNT, wrapStop, type ReelStrips } from '../../../systems/casino/slots/slotReels';
import type { Rect } from '../../core/geom';
import { centerIn, inset } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { slotsInk, slotsSkins } from '../../theme/slotsInk';
import type { ButtonSkin } from '../../theme/skins';
import type { TypeStyle } from '../../theme/tokens';
import { glowText, paintSkinnedControl, scaledStyle } from '../../screens/dialogs/minigameChrome';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { measureText, text } from '../../widgets/text';
import { popover } from '../../widgets/popover';
import { button } from '../../widgets/button';
import { bakedSymbol, paintSlotSymbol } from './slotSymbols';
import type { SlotsLayout } from './slotsLayout';
import {
  ANTICIPATION_PULSE_MS,
  ATTRACT_WINK_MS,
  BANNER_SLAM_MS,
  NEAR_MISS_MS,
  REEL_BLUR_SPEED,
  SCATTER_POP_MS,
  type SlotsMotion,
  type WinTrace,
} from './slotsMotion';

/** Everything the machine shows that the host decides. */
export interface SlotsViewModel {
  readonly strips: ReelStrips;
  readonly credits: number;
  readonly betPerLine: number;
  readonly totalBet: number;
  /** The WIN readout: the rollup during a celebration, the last win after it, or null. */
  readonly win: number | null;
  readonly jackpotCoins: number;
  /** The jackpot is being won: the meter burns in the jackpot's colours. */
  readonly jackpotHot: boolean;
  readonly freeSpins: {
    readonly remaining: number;
    readonly played: number;
    readonly totalWon: number;
  } | null;
  readonly autoRemaining: number | null;
  readonly autoMenuOpen: boolean;
  readonly turbo: boolean;
  /** Each control's state: true is live, a string is why it is not. */
  readonly canSpin: true | string;
  readonly canBetDown: boolean;
  readonly canBetUp: boolean;
  readonly canMaxBet: boolean;
  readonly betLocked: boolean;
  readonly spinLabel: string;
  readonly leaving: boolean;
  readonly keyHints: boolean;
}

export type SpinSource = 'button' | 'lever' | 'key';

/** What the machine's controls do; the host implements each. */
export interface SlotsViewActions {
  spinPressed(source: SpinSource): void;
  betDown(): void;
  betUp(): void;
  maxBet(): void;
  toggleTurbo(): void;
  autoPressed(): void;
  chooseAuto(spins: number): void;
  closeAutoMenu(): void;
  rules(): void;
  leave(): void;
  /** A tap anywhere on the machine while something is playing: skip the rollup, or slam the reels. */
  tapMachine(): void;
}

const AUTOSPIN_SHORT = 10;
const AUTOSPIN_MEDIUM = 25;
const AUTOSPIN_LONG = 50;
/** The autospin counts on offer. */
export const AUTOSPIN_CHOICES = [AUTOSPIN_SHORT, AUTOSPIN_MEDIUM, AUTOSPIN_LONG] as const;

const HALF = 0.5;
const TWO_PI = Math.PI * 2;

/** The marquee's bulbs: how many run along its top and bottom edges, and its sides. */
const MARQUEE_BULBS_ACROSS = 14;
const MARQUEE_BULBS_DOWN = 2;
/** The bulb sprite's side, as a fraction of the marquee's height. */
const BULB_SIZE_FRACTION = 0.3;
const MAX_BULB_SIZE = 26;
/** Every third bulb is lit at once in the chase. */
const BULB_CHASE_STRIDE = 3;
/**
 * The biggest wins run a denser chase, half of every four bulbs lit. It still
 * travels: the marquee's overall brightness holds steady as the lit run moves,
 * so it never flashes as a whole, which is what matters to a photosensitive
 * player. Under reduced motion the bulbs hold still.
 */
const BIG_CHASE_STRIDE = 4;
const BIG_CHASE_LIT = 2;
/** Idle bulbs breathe in a slow wave of this many bulbs. */
const ATTRACT_WAVE_LENGTH = 8;
/** Coin frames baked for the edge-on spin. */
const COIN_FRAMES = 8;
const COIN_RADIUS_FRACTION = 0.028;
const SPARK_RADIUS_FRACTION = 0.012;

const REEL_DIVIDER_WIDTH = 1.5;
/** How much a winning symbol grows at the peak of its pop. */
const WIN_POP_SCALE = 0.14;
const WIN_POP_MS = 420;
const GLINT_WIDTH_FRACTION = 0.18;
const GLINT_ALPHA = 0.55;
const SCATTER_POP_SCALE = 0.22;

/** The share of a trace's turn spent drawing its line on. */
const TRACE_DRAW_SHARE = 0.45;
const TRACE_GLOW_WIDTH_FRACTION = 0.16;
const TRACE_CORE_WIDTH_FRACTION = 0.04;
const TRACE_GLOW_ALPHA = 0.5;
const TRACE_RING_FRACTION = 0.42;

const ANTICIPATION_FRAME_WIDTH = 4;
const ANTICIPATION_GLOW_WIDTH = 12;
const ANTICIPATION_GLOW_ALPHA = 0.4;
const SHIMMER_BAND_FRACTION = 0.35;
const SHIMMER_ALPHA = 0.55;

/** The banner slams in from this scale. */
const BANNER_SLAM_FROM = 2.2;
const BANNER_TITLE_FRACTION = 0.4;
const BANNER_AMOUNT_FRACTION = 0.24;
const BANNER_RAY_COUNT = 16;
const BANNER_RAY_SPEED = 0.0006;
const BANNER_RAY_REACH = 0.8;
/** The rays' two lengths, as shares of their reach. */
const BANNER_RAY_SHORT_REACH = 0.6;
const BANNER_RAY_STEPS = [1, BANNER_RAY_SHORT_REACH] as const;
const BANNER_PULSE_MS = 340;
const BANNER_PULSE_SCALE = 0.04;
/** The banner title is measured at this size and scaled to fit. */
const BANNER_PROBE_SIZE = 100;
/** The title fills this share of the banner's width, leaving room for its halo. */
const BANNER_TITLE_WIDTH_SHARE = 0.86;

const SPIN_PULSE_MS = 900;
const SPIN_RING_WIDTH = 3;
const SPIN_RING_ALPHA = 0.55;
const SPIN_LABEL_FRACTION = 0.42;
/** The label fills at most this share of the button's width, clear of its rounded ends. */
const SPIN_LABEL_WIDTH_SHARE = 0.78;

const LEVER_TAP_MS = 420;
/** A drag past this share of the lever's travel spins on release. */
const LEVER_PULL_THRESHOLD = 0.55;
const LEVER_TRAVEL_FRACTION = 0.45;

const READOUT_LABEL_FRACTION = 0.3;
const READOUT_VALUE_FRACTION = 0.42;
const METER_PAD_FRACTION = 0.12;
const METER_LABEL_FRACTION = 0.32;
const METER_DIGITS_FRACTION = 0.78;
const METER_LETTER_SPACING = 0.25;
/** Narrower than this many label heights and the meter's label drops the club's name. */
const METER_LONG_LABEL_WIDTH = 20;
const FREE_PLATE_HEIGHT_FRACTION = 0.13;
const FREE_PLATE_WIDTH_FRACTION = 0.72;
/** The free-spin plate names the feature's winnings too once it is this many heights wide. */
const FREE_PLATE_ROOMY_WIDTH = 13;
const LINE_AMOUNT_FRACTION = 0.2;
/** The BET readout spells out its sum only where it has this many value heights of room. */
const BET_SUM_WIDTH = 7;

const BANNER_TEXT: Readonly<Record<Exclude<WinTier, 'none'>, string>> = {
  big: 'BIG WIN!',
  mega: 'MEGA WIN!',
  epic: 'EPIC WIN!',
  jackpot: 'JACKPOT!',
};

function coins(amount: number): string {
  return Math.floor(amount).toLocaleString('en-US');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** The canvas's device pixels per unit of the current transform, for baking at full resolution. */
function pixelScale(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  return Math.max(1, Math.hypot(transform.a, transform.b));
}

interface Bake {
  readonly key: string;
  readonly surface: CanvasSurface;
}

const bakes = new Map<string, Bake>();
/**
 * A refused canvas is usually the browser's canvas memory running out for a
 * moment, so a failed bake is retried after a short rest instead of being
 * remembered, which would leave its art painted live every frame for good.
 */
const bakeFailures = new Map<string, { readonly key: string; readonly at: number }>();
const BAKE_RETRY_MS = 1000;
onCanvasRecovery(() => {
  for (const bake of bakes.values()) releaseSurface(bake.surface);
  bakes.clear();
  bakeFailures.clear();
});

function baked(
  slot: string,
  key: string,
  w: number,
  h: number,
  scale: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): CanvasSurface | null {
  const held = bakes.get(slot);
  if (held?.key === key) return held.surface;
  const now = performance.now();
  const failure = bakeFailures.get(slot);
  if (failure?.key === key && now - failure.at < BAKE_RETRY_MS) return null;
  let surface: CanvasSurface | null = null;
  try {
    surface = allocCanvas(
      'casino',
      Math.max(1, Math.ceil(w * scale)),
      Math.max(1, Math.ceil(h * scale)),
    );
    const ctx = surfaceContext(surface);
    ctx.scale(scale, scale);
    paint(ctx);
  } catch {
    if (surface !== null) releaseSurface(surface);
    bakeFailures.set(slot, { key, at: now });
    return null;
  }
  if (held !== undefined) releaseSurface(held.surface);
  bakes.set(slot, { key, surface });
  bakeFailures.delete(slot);
  return surface;
}

function rectKey(r: Rect): string {
  return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
}

function bulbSpots(marquee: Rect, size: number): Array<{ x: number; y: number }> {
  const spots: Array<{ x: number; y: number }> = [];
  const edge = inset(marquee, size * HALF);
  for (let i = 0; i < MARQUEE_BULBS_ACROSS; i++) {
    spots.push({ x: edge.x + (edge.w * i) / (MARQUEE_BULBS_ACROSS - 1), y: edge.y });
  }
  for (let i = 1; i <= MARQUEE_BULBS_DOWN; i++) {
    spots.push({ x: edge.x + edge.w, y: edge.y + (edge.h * i) / (MARQUEE_BULBS_DOWN + 1) });
  }
  for (let i = MARQUEE_BULBS_ACROSS - 1; i >= 0; i--) {
    spots.push({ x: edge.x + (edge.w * i) / (MARQUEE_BULBS_ACROSS - 1), y: edge.y + edge.h });
  }
  for (let i = MARQUEE_BULBS_DOWN; i >= 1; i--) {
    spots.push({ x: edge.x, y: edge.y + (edge.h * i) / (MARQUEE_BULBS_DOWN + 1) });
  }
  return spots;
}

/**
 * Wedges of flat light in two lengths, the shorter laid over the longer so
 * they fade towards their tips. Flat fills, not a gradient or a rotated
 * bake: either costs more each frame than the rest of the banner together.
 */
function paintBannerRays(ctx: CanvasRenderingContext2D, rayLength: number): void {
  ctx.fillStyle = slotsInk.tier.rays;
  for (const reach of BANNER_RAY_STEPS) {
    ctx.beginPath();
    for (let i = 0; i < BANNER_RAY_COUNT; i += 2) {
      const a0 = (i / BANNER_RAY_COUNT) * TWO_PI;
      const a1 = ((i + 1) / BANNER_RAY_COUNT) * TWO_PI;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * rayLength * reach, Math.sin(a0) * rayLength * reach);
      ctx.lineTo(Math.cos(a1) * rayLength * reach, Math.sin(a1) * rayLength * reach);
      ctx.closePath();
    }
    ctx.fill();
  }
}

export class SlotsView {
  /** The lever's pull while it is being dragged, 0 to 1, else null. */
  private leverDrag: number | null = null;
  private leverTappedAt: number | null = null;

  /** Where the credits readout sat when last drawn, in UI units: where winnings fly from. */
  creditsAnchor: { x: number; y: number } | null = null;
  private focusSeen = false;

  /** Paints the machine; returns whether the keyboard has walked focus onto one of its controls. */
  paint(
    ui: Ui,
    layout: SlotsLayout,
    model: SlotsViewModel,
    motion: SlotsMotion,
    actions: SlotsViewActions,
  ): boolean {
    const { ctx } = ui;
    this.focusSeen = false;
    const scale = pixelScale(ctx);
    const { screen } = layout;
    const backdrop = baked(
      'backdrop',
      `${rectKey(screen)}|${scale}`,
      screen.w,
      screen.h,
      scale,
      (b) => this.paintBackdrop(b, { x: 0, y: 0, w: screen.w, h: screen.h }),
    );
    if (backdrop !== null) ctx.drawImage(backdrop, screen.x, screen.y, screen.w, screen.h);
    else this.paintBackdrop(ctx, screen);

    const playing = motion.reelsMoving || motion.celebration !== null;
    if (playing) {
      ui.hit('machine', layout.screen, {
        onTap: () => actions.tapMachine(),
        focusable: false,
        sound: null,
      });
    }

    const shake = motion.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.paintCabinet(ctx, layout, scale);
    this.paintBulbs(ctx, layout, motion, scale);
    this.paintMeter(ui, layout, model, motion);
    this.paintReels(ctx, layout, model, motion, scale);
    this.paintGlass(ctx, layout, scale);
    this.paintReelEffects(ctx, layout, motion);
    this.paintTrace(ui, layout, motion);
    this.paintFreeSpinPlate(ui, layout, model);
    this.paintReadouts(ui, layout, model);
    if (layout.lever !== null) this.paintLever(ui, layout.lever, motion, actions, model);
    this.paintControls(ui, layout, model, actions);
    ctx.restore();

    this.paintCoins(ctx, layout, motion, scale);
    this.paintBanner(ui, layout, motion);
    const flash = motion.flashAlpha();
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash;
      ctx.fillStyle = slotsInk.flash;
      ctx.fillRect(layout.screen.x, layout.screen.y, layout.screen.w, layout.screen.h);
      ctx.restore();
    }
    return this.focusSeen;
  }

  // ── Backdrop and cabinet ─────────────────────────────────────────────────

  private paintBackdrop(ctx: CanvasRenderingContext2D, screen: Rect): void {
    const ink = slotsInk.backdrop;
    const wall = ctx.createLinearGradient(0, screen.y, 0, screen.y + screen.h);
    wall.addColorStop(0, ink.top);
    wall.addColorStop(1, ink.bottom);
    ctx.fillStyle = wall;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    const cx = screen.x + screen.w * HALF;
    const cy = screen.y + screen.h * HALF;
    const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(screen.w, screen.h) * HALF);
    spot.addColorStop(0, ink.spot);
    spot.addColorStop(1, ink.spotFade);
    ctx.fillStyle = spot;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  }

  private paintCabinet(ctx: CanvasRenderingContext2D, layout: SlotsLayout, scale: number): void {
    const { cabinet } = layout;
    const pad = Math.min(cabinet.w, cabinet.h) * HALF * HALF;
    const area: Rect = {
      x: cabinet.x - pad,
      y: cabinet.y - pad,
      w: cabinet.w + pad * 2,
      h: cabinet.h + pad * 2,
    };
    const key = `${layout.mode}|${rectKey(cabinet)}|${rectKey(layout.glass)}|${scale}`;
    const surface = baked('cabinet', key, area.w, area.h, scale, (bake) => {
      bake.translate(-area.x, -area.y);
      paintSlotCabinet(bake, {
        cabinet,
        marquee: layout.marquee,
        glass: layout.glass,
        bezel: layout.bezel,
        deck: layout.deck,
        meter: layout.meterInHeader ? null : layout.meter,
      });
    });
    if (surface !== null) {
      ctx.drawImage(surface, area.x, area.y, area.w, area.h);
      return;
    }
    paintSlotCabinet(ctx, {
      cabinet,
      marquee: layout.marquee,
      glass: layout.glass,
      bezel: layout.bezel,
      deck: layout.deck,
      meter: layout.meterInHeader ? null : layout.meter,
    });
  }

  private paintBulbs(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    motion: SlotsMotion,
    scale: number,
  ): void {
    const size = Math.min(MAX_BULB_SIZE, layout.marquee.h * BULB_SIZE_FRACTION);
    const spots = bulbSpots(layout.marquee, size);
    const on = baked('bulb-on', `${size}|${scale}`, size, size, scale, (b) =>
      paintSlotBulb(b, size, true),
    );
    const off = baked('bulb-off', `${size}|${scale}`, size, size, scale, (b) =>
      paintSlotBulb(b, size, false),
    );
    const step = Math.floor(motion.bulbPhase);
    const attracting = motion.attracting;
    const tier = motion.showingTier;
    spots.forEach((spot, index) => {
      let lit: boolean;
      if (motion.reducedMotion) lit = tier !== null || index % 2 === 0;
      else if (tier === 'jackpot' || tier === 'epic') {
        lit = (index + step) % BIG_CHASE_STRIDE < BIG_CHASE_LIT;
      } else if (attracting) {
        lit = (index + step) % ATTRACT_WAVE_LENGTH < ATTRACT_WAVE_LENGTH * HALF;
      } else lit = (index + step) % BULB_CHASE_STRIDE === 0;
      const sprite = lit ? on : off;
      const x = spot.x - size * HALF;
      const y = spot.y - size * HALF;
      if (sprite !== null) ctx.drawImage(sprite, x, y, size, size);
      else {
        ctx.save();
        ctx.translate(x, y);
        paintSlotBulb(ctx, size, lit);
        ctx.restore();
      }
    });
  }

  private paintMeter(
    ui: Ui,
    layout: SlotsLayout,
    model: SlotsViewModel,
    motion: SlotsMotion,
  ): void {
    const { meter } = layout;
    const ink = slotsInk.meter;
    if (layout.meterInHeader) paintSlotMeterPlate(ui.ctx, meter);
    const pad = meter.h * METER_PAD_FRACTION;
    const body = inset(meter, pad);
    const labelH = body.h * METER_LABEL_FRACTION;
    const label = body.w < labelH * METER_LONG_LABEL_WIDTH ? 'JACKPOT' : 'CLOAK & DAGGER JACKPOT';
    text(
      ui,
      { ...body, h: labelH },
      {
        text: label,
        style: {
          ...scaledStyle(ui.theme.type.label, labelH),
          letterSpacing: labelH * METER_LETTER_SPACING,
        },
        color: ink.label,
        align: 'center',
        valign: 'middle',
      },
    );
    const digitsRect: Rect = { ...body, y: body.y + labelH, h: body.h - labelH };
    const digitsSize = digitsRect.h * METER_DIGITS_FRACTION;
    const hot = model.jackpotHot && Math.floor(motion.time / BANNER_PULSE_MS) % 2 === 0;
    const digits = coins(model.jackpotCoins);
    const pixels = pixelScale(ui.ctx);
    const local: Rect = { x: 0, y: 0, w: digitsRect.w, h: digitsRect.h };
    // The digits' glow is a blur, which is costly every frame and changes only with the pool.
    const bake = baked(
      'meter-digits',
      `${digits}|${hot}|${rectKey(digitsRect)}|${pixels}`,
      digitsRect.w,
      digitsRect.h,
      pixels,
      (b) =>
        glowText({ ctx: b, theme: ui.theme }, local, {
          text: digits,
          style: scaledStyle(ui.theme.type.display, digitsSize),
          color: hot ? ink.hot : ink.digits,
          glow: ink.digitsGlow,
          glowBlur: digitsSize * HALF,
          align: 'center',
          valign: 'middle',
          tabular: true,
        }),
    );
    if (bake !== null)
      ui.ctx.drawImage(bake, digitsRect.x, digitsRect.y, digitsRect.w, digitsRect.h);
  }

  // ── Reels ────────────────────────────────────────────────────────────────

  private paintReels(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    model: SlotsViewModel,
    motion: SlotsMotion,
    scale: number,
  ): void {
    const ink = slotsInk.reel;
    const free = model.freeSpins !== null;
    const { cellH } = layout;
    const winning = motion.winningCells();
    const backing = ctx.createLinearGradient(0, layout.glass.y, 0, layout.glass.y + layout.glass.h);
    backing.addColorStop(0, free ? ink.freeFaceShade : ink.faceShade);
    backing.addColorStop(HALF, free ? ink.freeFace : ink.face);
    backing.addColorStop(1, free ? ink.freeFaceShade : ink.faceShade);
    layout.reels.forEach((reelRect, reelIndex) => {
      const strip = listAt(model.strips, reelIndex);
      const reel = listAt(motion.reels, reelIndex);
      if (strip === undefined || reel === undefined) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(reelRect.x, reelRect.y, reelRect.w, reelRect.h);
      ctx.clip();
      ctx.fillStyle = backing;
      ctx.fillRect(reelRect.x, reelRect.y, reelRect.w, reelRect.h);
      const base = Math.floor(reel.position);
      const fraction = reel.position - base;
      const variant = reel.speed >= REEL_BLUR_SPEED ? 'blur' : 'sharp';
      for (let row = 0; row <= ROW_COUNT; row++) {
        const symbol = listAt(strip, wrapStop(base + row, strip.length));
        if (symbol === undefined) continue;
        const atRest = reel.phase === 'rest' && fraction === 0;
        if (atRest && winning.has(`${reelIndex}:${row}`)) continue;
        if (atRest && motion.scatterPops.has(`${reelIndex}:${row}`) && symbol === 'scatter')
          continue;
        const y = reelRect.y + (row - fraction) * cellH;
        const art = bakedSymbol(symbol, variant, reelRect.w * scale, cellH * scale);
        if (art !== null) ctx.drawImage(art, reelRect.x, y, reelRect.w, cellH);
        else paintSlotSymbol(ctx, symbol, reelRect.x, y, reelRect.w, cellH);
      }
      ctx.restore();
      if (reelIndex > 0) {
        ctx.fillStyle = free ? ink.freeDivider : ink.divider;
        ctx.fillRect(
          reelRect.x - REEL_DIVIDER_WIDTH * HALF,
          reelRect.y,
          REEL_DIVIDER_WIDTH,
          reelRect.h,
        );
      }
    });
    if (motion.celebration !== null && winning.size > 0) {
      this.paintWinningCells(ctx, layout, model, motion, winning, scale);
    }
    this.paintScatterPops(ctx, layout, motion, scale);
    if (motion.attracting) this.paintAttractWink(ctx, layout, motion);
  }

  private paintWinningCells(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    model: SlotsViewModel,
    motion: SlotsMotion,
    winning: ReadonlySet<string>,
    scale: number,
  ): void {
    const { glass, cellH } = layout;
    ctx.save();
    ctx.fillStyle = slotsInk.reel.dim;
    layout.reels.forEach((reelRect, reel) => {
      for (let row = 0; row < ROW_COUNT; row++) {
        if (winning.has(`${reel}:${row}`)) continue;
        ctx.fillRect(reelRect.x, glass.y + row * cellH, reelRect.w, cellH);
      }
    });
    ctx.restore();
    const active = motion.activeTrace();
    const activeCells = new Set(active?.trace.cells.map((c) => `${c.reel}:${c.row}`) ?? []);
    for (const key of winning) {
      const [reelText, rowText] = key.split(':');
      const reel = Number(reelText);
      const row = Number(rowText);
      const reelRect = listAt(layout.reels, reel);
      const strip = listAt(model.strips, reel) ?? [];
      const position = listAt(motion.reels, reel)?.position ?? 0;
      const symbol = listAt(strip, wrapStop(position + row, Math.max(1, strip.length)));
      if (reelRect === undefined || symbol === undefined) continue;
      const lit = activeCells.has(key) && active !== null;
      const age = lit ? motion.time - active.startedAt : WIN_POP_MS;
      const pop = lit ? Math.sin(Math.PI * clamp01(age / WIN_POP_MS)) * WIN_POP_SCALE : 0;
      const w = reelRect.w * (1 + pop);
      const h = cellH * (1 + pop);
      const x = reelRect.x - (w - reelRect.w) * HALF;
      const y = glass.y + row * cellH - (h - cellH) * HALF;
      const cell: Rect = { x: reelRect.x, y: glass.y + row * cellH, w: reelRect.w, h: cellH };
      if (lit) {
        ctx.save();
        ctx.globalAlpha = HALF;
        fillRounded(
          ctx,
          inset(cell, cellH * HALF * HALF * HALF),
          cellH * HALF * HALF,
          slotsInk.frame.winCellGlow,
        );
        ctx.restore();
      }
      const art = bakedSymbol(symbol, 'sharp', reelRect.w * scale, cellH * scale);
      if (art !== null) ctx.drawImage(art, x, y, w, h);
      else paintSlotSymbol(ctx, symbol, x, y, w, h);
      if (lit) this.paintGlint(ctx, cell, clamp01(age / WIN_POP_MS));
    }
  }

  private paintGlint(ctx: CanvasRenderingContext2D, cell: Rect, progress: number): void {
    if (progress <= 0 || progress >= 1) return;
    const bandW = cell.w * GLINT_WIDTH_FRACTION;
    const x = cell.x - bandW + (cell.w + bandW * 2) * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cell.x, cell.y, cell.w, cell.h);
    ctx.clip();
    const g = ctx.createLinearGradient(x - bandW, 0, x + bandW, 0);
    g.addColorStop(0, slotsInk.reel.glassSheenFade);
    g.addColorStop(HALF, withAlpha(slotsInk.coin.spark, GLINT_ALPHA));
    g.addColorStop(1, slotsInk.reel.glassSheenFade);
    ctx.fillStyle = g;
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    ctx.restore();
  }

  private paintScatterPops(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    motion: SlotsMotion,
    scale: number,
  ): void {
    for (const [key, at] of motion.scatterPops) {
      const [reelText, rowText] = key.split(':');
      const reel = Number(reelText);
      const row = Number(rowText);
      const reelRect = listAt(layout.reels, reel);
      const reelMotion = listAt(motion.reels, reel);
      if (reelRect === undefined || reelMotion?.phase !== 'rest') continue;
      const age = motion.time - at;
      const pulse = age < SCATTER_POP_MS ? Math.sin(Math.PI * (age / SCATTER_POP_MS)) : 0;
      const grow = 1 + pulse * SCATTER_POP_SCALE;
      const w = reelRect.w * grow;
      const h = layout.cellH * grow;
      const x = reelRect.x - (w - reelRect.w) * HALF;
      const y = layout.glass.y + row * layout.cellH - (h - layout.cellH) * HALF;
      const art = bakedSymbol('scatter', 'sharp', reelRect.w * scale, layout.cellH * scale);
      if (art !== null) ctx.drawImage(art, x, y, w, h);
      else paintSlotSymbol(ctx, 'scatter', x, y, w, h);
    }
  }

  /** The attract pattern's wink: a sparkle that hops from cell to cell on the resting glass. */
  private paintAttractWink(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    motion: SlotsMotion,
  ): void {
    const cells = layout.reels.length * ROW_COUNT;
    const beat = Math.floor(motion.time / ATTRACT_WINK_MS);
    const index = (beat * BULB_CHASE_STRIDE + beat) % cells;
    const reel = Math.floor(index / ROW_COUNT);
    const row = index % ROW_COUNT;
    const reelRect = listAt(layout.reels, reel);
    if (reelRect === undefined) return;
    const progress = (motion.time % ATTRACT_WINK_MS) / ATTRACT_WINK_MS;
    const cell: Rect = {
      x: reelRect.x,
      y: layout.glass.y + row * layout.cellH,
      w: reelRect.w,
      h: layout.cellH,
    };
    this.paintGlint(ctx, cell, progress);
    const sparkle = Math.sin(Math.PI * progress);
    const cx = cell.x + cell.w * (1 - HALF * HALF);
    const cy = cell.y + cell.h * HALF * HALF;
    const arm = cell.h * HALF * HALF * sparkle;
    ctx.save();
    ctx.strokeStyle = slotsInk.coin.spark;
    ctx.globalAlpha = sparkle;
    ctx.lineWidth = Math.max(1, arm * HALF * HALF);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.restore();
  }

  private paintGlass(ctx: CanvasRenderingContext2D, layout: SlotsLayout, scale: number): void {
    const { glass } = layout;
    const surface = baked('glass', `${rectKey(glass)}|${scale}`, glass.w, glass.h, scale, (b) =>
      paintSlotGlass(b, { x: 0, y: 0, w: glass.w, h: glass.h }),
    );
    if (surface !== null) ctx.drawImage(surface, glass.x, glass.y, glass.w, glass.h);
    else paintSlotGlass(ctx, glass);
  }

  private paintReelEffects(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    motion: SlotsMotion,
  ): void {
    const ink = slotsInk.frame;
    layout.reels.forEach((reelRect, index) => {
      const reel = listAt(motion.reels, index);
      if (reel === undefined) return;
      if (reel.anticipating) {
        const pulse =
          HALF +
          HALF * Math.sin(((motion.time - reel.anticipationAt) / ANTICIPATION_PULSE_MS) * Math.PI);
        ctx.save();
        ctx.globalAlpha = ANTICIPATION_GLOW_ALPHA * pulse;
        strokeRounded(
          ctx,
          inset(reelRect, -ANTICIPATION_GLOW_WIDTH * HALF),
          ANTICIPATION_GLOW_WIDTH,
          ink.anticipationGlow,
          ANTICIPATION_GLOW_WIDTH,
        );
        ctx.globalAlpha = HALF + HALF * pulse;
        strokeRounded(
          ctx,
          reelRect,
          ANTICIPATION_FRAME_WIDTH,
          ink.anticipation,
          ANTICIPATION_FRAME_WIDTH,
        );
        ctx.restore();
      }
      if (reel.nearMissAt !== null && reel.phase === 'rest') {
        const age = motion.time - reel.nearMissAt;
        if (age < NEAR_MISS_MS) this.paintShimmer(ctx, reelRect, age / NEAR_MISS_MS);
      }
    });
  }

  private paintShimmer(ctx: CanvasRenderingContext2D, reel: Rect, progress: number): void {
    const ink = slotsInk.frame;
    const band = reel.h * SHIMMER_BAND_FRACTION;
    const y = reel.y - band + (reel.h + band * 2) * progress;
    ctx.save();
    ctx.beginPath();
    ctx.rect(reel.x, reel.y, reel.w, reel.h);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y - band, 0, y + band);
    g.addColorStop(0, ink.shimmerFade);
    g.addColorStop(HALF, withAlpha(ink.shimmer, SHIMMER_ALPHA));
    g.addColorStop(1, ink.shimmerFade);
    ctx.fillStyle = g;
    ctx.fillRect(reel.x, reel.y, reel.w, reel.h);
    ctx.restore();
  }

  // ── Wins ─────────────────────────────────────────────────────────────────

  private cellCentre(layout: SlotsLayout, reel: number, row: number): { x: number; y: number } {
    const reelRect = layout.reels[reel] ?? layout.glass;
    return { x: reelRect.x + reelRect.w * HALF, y: layout.glass.y + (row + HALF) * layout.cellH };
  }

  private paintTrace(ui: Ui, layout: SlotsLayout, motion: SlotsMotion): void {
    const active = motion.activeTrace();
    if (active === null) return;
    const { ctx } = ui;
    const { trace } = active;
    const traceMs = motion.celebration?.traceMs ?? ATTRACT_WINK_MS;
    const progress = clamp01((motion.time - active.startedAt) / (traceMs * TRACE_DRAW_SHARE));
    if (trace.lineIndex === null) {
      this.paintScatterRings(ctx, layout, trace, progress);
      return;
    }
    const line = listAt(PAYLINES, trace.lineIndex);
    if (line === undefined) return;
    const color =
      slotsInk.paylines[trace.lineIndex % slotsInk.paylines.length] ?? slotsInk.frame.winCell;
    const points = line.map((row, reel) => this.cellCentre(layout, reel, row));
    const first = listAt(points, 0);
    const last = listAt(points, points.length - 1);
    if (first === undefined || last === undefined) return;
    const start = { x: layout.glass.x, y: first.y };
    const end = { x: layout.glass.x + layout.glass.w, y: last.y };
    const path = [start, ...points, end];
    const segments = path.length - 1;
    const reach = progress * segments;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const stroke = (width: number, style: string, alpha: number): void => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
          return;
        }
        const previous = listAt(path, index - 1);
        if (previous === undefined || index - 1 >= reach) return;
        const share = Math.min(1, reach - (index - 1));
        ctx.lineTo(
          previous.x + (point.x - previous.x) * share,
          previous.y + (point.y - previous.y) * share,
        );
      });
      ctx.stroke();
    };
    stroke(layout.cellH * TRACE_GLOW_WIDTH_FRACTION, color, TRACE_GLOW_ALPHA);
    stroke(layout.cellH * TRACE_CORE_WIDTH_FRACTION, slotsInk.coin.spark, 1);
    stroke(layout.cellH * TRACE_CORE_WIDTH_FRACTION * HALF, color, 1);
    ctx.restore();
    for (const cell of trace.cells) {
      const centre = this.cellCentre(layout, cell.reel, cell.row);
      const box = centerIn(
        { x: centre.x, y: centre.y, w: 0, h: 0 },
        (layout.reels[0]?.w ?? 0) * (1 - HALF * HALF * HALF),
        layout.cellH * (1 - HALF * HALF * HALF),
      );
      ctx.save();
      ctx.globalAlpha = progress;
      strokeRounded(
        ctx,
        box,
        layout.cellH * HALF * HALF * HALF,
        color,
        layout.cellH * TRACE_CORE_WIDTH_FRACTION,
      );
      ctx.restore();
    }
    const lastCell = listAt(trace.cells, trace.cells.length - 1);
    if (trace.amount > 0 && lastCell !== undefined && progress >= 1) {
      const centre = this.cellCentre(layout, lastCell.reel, lastCell.row);
      const size = layout.cellH * LINE_AMOUNT_FRACTION;
      const plate: Rect = {
        x: centre.x - size * 2,
        y: centre.y - size * (1 - HALF * HALF),
        w: size * (2 + 2),
        h: size * (1 + HALF),
      };
      fillRounded(ctx, plate, plate.h * HALF, slotsInk.tier.plate);
      strokeRounded(ctx, plate, plate.h * HALF, color, REEL_DIVIDER_WIDTH);
      text(ui, plate, {
        text: coins(trace.amount),
        style: scaledStyle(ui.theme.type.title, size),
        color: slotsInk.tier.text,
        align: 'center',
        valign: 'middle',
        tabular: true,
      });
    }
  }

  private paintScatterRings(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    trace: WinTrace,
    progress: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = slotsInk.tier.freeSpins;
    ctx.lineWidth = layout.cellH * TRACE_CORE_WIDTH_FRACTION * 2;
    ctx.globalAlpha = progress;
    for (const cell of trace.cells) {
      const centre = this.cellCentre(layout, cell.reel, cell.row);
      ctx.beginPath();
      ctx.arc(
        centre.x,
        centre.y,
        layout.cellH * TRACE_RING_FRACTION * (HALF + HALF * progress),
        0,
        TWO_PI,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintFreeSpinPlate(ui: Ui, layout: SlotsLayout, model: SlotsViewModel): void {
    const free = model.freeSpins;
    if (free === null) return;
    const { glass } = layout;
    const h = Math.max(layout.minTarget * HALF, glass.h * FREE_PLATE_HEIGHT_FRACTION);
    const w = glass.w * FREE_PLATE_WIDTH_FRACTION;
    const plate: Rect = { x: glass.x + (glass.w - w) * HALF, y: glass.y - h * HALF, w, h };
    fillRounded(ui.ctx, plate, h * HALF, slotsInk.reel.freeFace);
    strokeRounded(ui.ctx, plate, h * HALF, slotsInk.tier.freeSpins, REEL_DIVIDER_WIDTH * 2);
    const total = free.played + free.remaining;
    const roomy = w >= h * FREE_PLATE_ROOMY_WIDTH;
    const counter = `FREE SPINS ${free.played} / ${total}`;
    text(ui, plate, {
      text: roomy ? `${counter}  ·  WON ${coins(free.totalWon)}` : counter,
      style: scaledStyle(ui.theme.type.label, h * HALF),
      color: slotsInk.readout.free,
      align: 'center',
      valign: 'middle',
      tabular: true,
    });
  }

  private paintReadouts(ui: Ui, layout: SlotsLayout, model: SlotsViewModel): void {
    const ink = slotsInk.readout;
    const cells: ReadonlyArray<readonly [Rect, string, string, string]> = [
      [layout.readouts.credits, 'CREDITS', coins(model.credits), ink.value],
      [
        layout.readouts.bet,
        'BET',
        `${model.betPerLine} × 20 = ${coins(model.totalBet)}`,
        ink.value,
      ],
      [layout.readouts.win, 'WIN', model.win === null ? '—' : coins(model.win), ink.win],
    ];
    const credits = layout.readouts.credits;
    this.creditsAnchor = { x: credits.x + credits.w * HALF, y: credits.y + credits.h * HALF };
    for (const [rect, label, value, color] of cells) {
      fillRounded(ui.ctx, rect, rect.h * HALF * HALF, ink.face);
      strokeRounded(ui.ctx, rect, rect.h * HALF * HALF, ink.border, REEL_DIVIDER_WIDTH);
      const labelSize = rect.h * READOUT_LABEL_FRACTION;
      const valueSize = rect.h * READOUT_VALUE_FRACTION;
      const labelRect: Rect = {
        ...rect,
        h: rect.h * (READOUT_LABEL_FRACTION + HALF * HALF * HALF),
      };
      text(ui, labelRect, {
        text: label,
        style: scaledStyle(ui.theme.type.overline, labelSize),
        color: ink.label,
        align: 'center',
        valign: 'bottom',
      });
      const valueRect: Rect = { ...rect, y: labelRect.y + labelRect.h, h: rect.h - labelRect.h };
      text(ui, valueRect, {
        text:
          label === 'BET' && valueRect.w < valueSize * BET_SUM_WIDTH
            ? coins(model.totalBet)
            : value,
        style: scaledStyle(ui.theme.type.title, valueSize),
        color,
        align: 'center',
        valign: 'middle',
        tabular: true,
      });
    }
  }

  // ── Controls ─────────────────────────────────────────────────────────────

  private control(
    ui: Ui,
    id: string,
    rect: Rect,
    opts: {
      readonly label: string;
      readonly skin: ButtonSkin;
      readonly disabled: boolean;
      readonly onTap: () => void;
      readonly primary?: boolean;
      readonly sound?: Parameters<Ui['hit']>[2]['sound'];
      readonly textStyle?: TypeStyle;
    },
  ): void {
    const look = ui.hit(id, rect, {
      onTap: opts.onTap,
      disabled: opts.disabled,
      primary: opts.primary,
      sound: opts.sound,
    });
    if (look.focused) this.focusSeen = true;
    paintSkinnedControl(ui, rect, {
      label: opts.label,
      skin: opts.skin,
      look,
      disabled: opts.disabled,
      radius: Math.min(rect.h * HALF, ui.theme.radius.md),
      textStyle: opts.textStyle ?? ui.theme.type.label,
    });
  }

  private paintControls(
    ui: Ui,
    layout: SlotsLayout,
    model: SlotsViewModel,
    actions: SlotsViewActions,
  ): void {
    const skins = slotsSkins(ui.theme);
    const { controls } = layout;
    const wide = layout.mode === 'wide';
    const labelStyle = scaledStyle(
      ui.theme.type.label,
      Math.min(ui.theme.type.title.size, layout.minTarget * (HALF - HALF * HALF * HALF)),
    );
    this.control(ui, 'leave', controls.leave, {
      label: model.keyHints ? 'Leave [Esc]' : 'Leave',
      skin: skins.leave,
      disabled: false,
      onTap: () => actions.leave(),
      textStyle: labelStyle,
    });
    this.control(ui, 'rules', controls.rules, {
      label: wide ? 'Paytable' : '?',
      skin: skins.deck,
      disabled: false,
      onTap: () => actions.rules(),
      textStyle: labelStyle,
    });
    this.control(ui, 'bet-down', controls.betDown, {
      label: wide || layout.mode === 'landscape' ? 'BET −' : '−',
      skin: skins.deck,
      disabled: !model.canBetDown,
      onTap: () => actions.betDown(),
      sound: 'slots_bet_down',
      textStyle: labelStyle,
    });
    this.control(ui, 'bet-up', controls.betUp, {
      label: wide || layout.mode === 'landscape' ? 'BET +' : '+',
      skin: skins.deck,
      disabled: !model.canBetUp,
      onTap: () => actions.betUp(),
      sound: 'slots_bet_up',
      textStyle: labelStyle,
    });
    this.control(ui, 'max-bet', controls.maxBet, {
      label: 'MAX BET',
      skin: skins.maxBet,
      disabled: !model.canMaxBet,
      onTap: () => actions.maxBet(),
      sound: 'slots_max_bet',
      textStyle: labelStyle,
    });
    const autoRunning = model.autoRemaining !== null;
    this.control(ui, 'auto', controls.auto, {
      label: autoRunning ? `STOP ${model.autoRemaining}` : 'AUTO',
      skin: autoRunning ? skins.toggleOn : skins.deck,
      disabled: model.freeSpins !== null || model.leaving,
      onTap: () => actions.autoPressed(),
      textStyle: labelStyle,
    });
    this.control(ui, 'turbo', controls.turbo, {
      label: 'TURBO',
      skin: model.turbo ? skins.toggleOn : skins.deck,
      disabled: false,
      onTap: () => actions.toggleTurbo(),
      textStyle: labelStyle,
    });
    this.paintSpin(ui, layout, model, actions);
    if (model.autoMenuOpen) this.paintAutoMenu(ui, layout, actions);
  }

  private paintSpin(
    ui: Ui,
    layout: SlotsLayout,
    model: SlotsViewModel,
    actions: SlotsViewActions,
  ): void {
    const skins = slotsSkins(ui.theme);
    const rect = layout.controls.spin;
    const disabled = model.canSpin !== true;
    const driven = model.autoRemaining !== null || model.freeSpins !== null;
    const skin = driven ? skins.spinAuto : skins.spin;
    const look = ui.hit('spin', rect, {
      onTap: () => actions.spinPressed('button'),
      disabled,
      primary: true,
      sound: 'slots_spin_button',
    });
    if (look.focused) this.focusSeen = true;
    const radius = Math.min(rect.h * HALF, ui.theme.radius.lg);
    if (!disabled) {
      const pulse = HALF + HALF * Math.sin((ui.now / SPIN_PULSE_MS) * TWO_PI);
      ui.ctx.save();
      ui.ctx.globalAlpha = SPIN_RING_ALPHA * pulse;
      strokeRounded(
        ui.ctx,
        inset(rect, -SPIN_RING_WIDTH * 2),
        radius + SPIN_RING_WIDTH * 2,
        driven ? slotsInk.spin.autoGlow : slotsInk.spin.glow,
        SPIN_RING_WIDTH,
      );
      ui.ctx.restore();
    }
    const label = disabled && typeof model.canSpin === 'string' ? model.canSpin : model.spinLabel;
    // The width fit measures the label actually painted: a refusal reason is
    // several times longer than SPIN and would otherwise overflow the face.
    const probeStyle = scaledStyle(ui.theme.type.display, BANNER_PROBE_SIZE);
    const probeWidth = Math.max(1, measureText(ui, label, { style: probeStyle }));
    const widthFitSize = (rect.w * SPIN_LABEL_WIDTH_SHARE * BANNER_PROBE_SIZE) / probeWidth;
    paintSkinnedControl(ui, rect, {
      label,
      skin,
      look,
      disabled,
      radius,
      textStyle: scaledStyle(
        ui.theme.type.display,
        Math.min(rect.h * SPIN_LABEL_FRACTION, widthFitSize),
      ),
    });
  }

  private paintAutoMenu(ui: Ui, layout: SlotsLayout, actions: SlotsViewActions): void {
    const gap = layout.gap;
    const buttonW = layout.minTarget * (1 + HALF);
    const w = buttonW * AUTOSPIN_CHOICES.length + gap * (AUTOSPIN_CHOICES.length + 1);
    const h = layout.minTarget + gap * 2;
    popover(ui, {
      id: 'auto-menu',
      anchor: layout.controls.auto,
      w,
      h,
      placement: 'above',
      onDismiss: () => actions.closeAutoMenu(),
      draw: (body) => {
        AUTOSPIN_CHOICES.forEach((count, index) => {
          const cell: Rect = {
            x:
              body.x +
              index *
                ((body.w - gap * (AUTOSPIN_CHOICES.length - 1)) / AUTOSPIN_CHOICES.length + gap),
            y: body.y,
            w: (body.w - gap * (AUTOSPIN_CHOICES.length - 1)) / AUTOSPIN_CHOICES.length,
            h: body.h,
          };
          button(ui, cell, {
            id: `auto-${count}`,
            label: `${count}`,
            variant: 'primary',
            onTap: () => actions.chooseAuto(count),
          });
        });
      },
    });
  }

  private paintLever(
    ui: Ui,
    lever: Rect,
    motion: SlotsMotion,
    actions: SlotsViewActions,
    model: SlotsViewModel,
  ): void {
    const travel = lever.h * LEVER_TRAVEL_FRACTION;
    const disabled = model.canSpin !== true || motion.reelsMoving;
    ui.hit('lever', lever, {
      onTap: () => {
        if (disabled) return;
        this.leverTappedAt = motion.time;
        actions.spinPressed('lever');
      },
      onDrag: {
        onMove: (point) => {
          this.leverDrag = clamp01(point.dy / travel);
        },
        onEnd: (_point, cancelled) => {
          const pulled = this.leverDrag ?? 0;
          this.leverDrag = null;
          if (cancelled || disabled || pulled < LEVER_PULL_THRESHOLD) return;
          this.leverTappedAt = motion.time;
          actions.spinPressed('lever');
        },
      },
      focusable: false,
      sound: disabled ? null : 'slots_lever_pull',
    });
    let pull = this.leverDrag ?? 0;
    if (this.leverDrag === null && this.leverTappedAt !== null) {
      const age = motion.time - this.leverTappedAt;
      pull = age < LEVER_TAP_MS ? Math.sin(Math.PI * (age / LEVER_TAP_MS)) : 0;
    }
    paintSlotLever(ui.ctx, lever, pull);
  }

  // ── Celebration overlays ─────────────────────────────────────────────────

  private paintCoins(
    ctx: CanvasRenderingContext2D,
    layout: SlotsLayout,
    motion: SlotsMotion,
    scale: number,
  ): void {
    if (motion.particles.length === 0) return;
    const { cabinet } = layout;
    const radius = Math.max(2, cabinet.w * COIN_RADIUS_FRACTION);
    const size = radius * 2 + 2;
    const frames: Array<CanvasSurface | null> = [];
    for (let frame = 0; frame < COIN_FRAMES; frame++) {
      frames.push(
        baked(`coin-${frame}`, `${radius}|${scale}`, size, size, scale, (b) => {
          b.translate(size * HALF, size * HALF);
          paintSlotCoin(b, radius, (frame / COIN_FRAMES) * Math.PI);
        }),
      );
    }
    const sparkRadius = Math.max(1, cabinet.w * SPARK_RADIUS_FRACTION);
    for (const p of motion.particles) {
      const x = cabinet.x + p.x * cabinet.w;
      const y = cabinet.y + p.y * cabinet.h;
      const age = (motion.time - p.bornAt) / p.life;
      if (p.spark) {
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = slotsInk.coin.spark;
        ctx.fillRect(
          x - sparkRadius,
          y - sparkRadius * HALF * HALF,
          sparkRadius * 2,
          sparkRadius * HALF,
        );
        ctx.fillRect(
          x - sparkRadius * HALF * HALF,
          y - sparkRadius,
          sparkRadius * HALF,
          sparkRadius * 2,
        );
        ctx.restore();
        continue;
      }
      const frameIndex = Math.floor(((p.spin % Math.PI) / Math.PI) * COIN_FRAMES) % COIN_FRAMES;
      const sprite = listAt(frames, frameIndex);
      if (sprite !== null && sprite !== undefined)
        ctx.drawImage(sprite, x - size * HALF, y - size * HALF, size, size);
    }
  }

  private paintBanner(ui: Ui, layout: SlotsLayout, motion: SlotsMotion): void {
    const c = motion.celebration;
    if (c === null) return;
    const { ctx } = ui;
    const freeShowing = c.freeSpinsAt !== null && motion.time >= c.freeSpinsAt;
    const tier = motion.showingTier;
    if (tier === null && !freeShowing) return;
    const title = freeShowing
      ? `${c.outcome.scatter.freeSpinsAwarded} FREE SPINS!`
      : BANNER_TEXT[tier === null || tier === 'none' ? 'big' : tier];
    const color = freeShowing
      ? slotsInk.tier.freeSpins
      : slotsInk.tier[tier === null || tier === 'none' ? 'big' : tier];
    const since = freeShowing
      ? motion.time - c.freeSpinsAt
      : motion.time - (c.bannerAt ?? motion.time);
    const slam = clamp01(since / BANNER_SLAM_MS);
    const settle = 1 - (1 - slam) * (1 - slam);
    const pulse =
      slam >= 1 ? Math.sin((since / BANNER_PULSE_MS) * Math.PI) * BANNER_PULSE_SCALE : 0;
    const scale = BANNER_SLAM_FROM + (1 - BANNER_SLAM_FROM) * settle + pulse;
    const area = layout.banner;
    const cx = area.x + area.w * HALF;
    const cy = area.y + area.h * HALF;

    const pixels = pixelScale(ctx);
    const rayLength = Math.max(area.w, area.h) * BANNER_RAY_REACH;
    const plate: Rect = { x: -area.w * HALF, y: -area.h * HALF, w: area.w, h: area.h };
    const titleRect: Rect = {
      x: plate.x,
      y: plate.y,
      w: plate.w,
      h: plate.h * (HALF + HALF * HALF * HALF),
    };
    const probeStyle = scaledStyle(ui.theme.type.display, BANNER_PROBE_SIZE);
    const probeWidth = Math.max(1, measureText(ui, title, { style: probeStyle }));
    const titleSize = Math.min(
      area.h * BANNER_TITLE_FRACTION,
      (area.w * BANNER_TITLE_WIDTH_SHARE * BANNER_PROBE_SIZE) / probeWidth,
    );
    // The glowing title is the costliest thing on screen, so the plate and
    // title are baked once per banner and only the rolling amount is live.
    const glowPad = titleSize;
    const card = baked(
      'banner-card',
      `${title}|${rectKey(area)}|${pixels}`,
      area.w + glowPad * 2,
      area.h + glowPad * 2,
      pixels,
      (b) => {
        b.translate(area.w * HALF + glowPad, area.h * HALF + glowPad);
        fillRounded(b, plate, area.h * HALF * HALF, slotsInk.tier.plate);
        strokeRounded(b, plate, area.h * HALF * HALF, color, REEL_DIVIDER_WIDTH * 2);
        glowText({ ctx: b, theme: ui.theme }, titleRect, {
          text: title,
          style: scaledStyle(ui.theme.type.display, titleSize),
          color,
          glow: color,
          glowBlur: titleSize * HALF,
          halo: slotsInk.tier.outline,
          align: 'center',
          valign: 'middle',
        });
      },
    );

    ctx.save();
    ctx.globalAlpha = clamp01(slam * 2);
    ctx.translate(cx, cy);
    ctx.save();
    ctx.rotate(motion.time * BANNER_RAY_SPEED);
    paintBannerRays(ctx, rayLength);
    ctx.restore();
    ctx.scale(scale, scale);
    if (card !== null) {
      ctx.drawImage(
        card,
        plate.x - glowPad,
        plate.y - glowPad,
        area.w + glowPad * 2,
        area.h + glowPad * 2,
      );
    }
    if (!freeShowing) {
      const amountSize = area.h * BANNER_AMOUNT_FRACTION;
      text(
        ui,
        { x: plate.x, y: titleRect.y + titleRect.h, w: plate.w, h: plate.h - titleRect.h },
        {
          text: coins(motion.rollupValue),
          style: scaledStyle(ui.theme.type.display, amountSize),
          color: slotsInk.tier.text,
          halo: slotsInk.tier.outline,
          align: 'center',
          valign: 'top',
          tabular: true,
        },
      );
    }
    ctx.restore();
  }
}
