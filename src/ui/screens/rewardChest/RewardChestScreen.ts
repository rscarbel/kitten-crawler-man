/**
 * The Reward Chest screen: every award, gift and prize the crawlers are paid
 * is shown here as a treasure chest of its rarity that drops in, strains,
 * swings its lid back and throws its rewards into a tray. Everything shown
 * is already in the crawler's bag or purse; the screen grants nothing.
 *
 * It is one `modal` surface that halts the world. It never opens by itself:
 * {@link RewardChestScreen.open} (the HUD's rewards chip) plays every
 * presentation its {@link PresentationSource} holds back to back with
 * "1 of N" pips. {@link RewardChestScreen.present} shows a single reward
 * that was handed over somewhere else, starting at the lid.
 *
 * Space, Enter, the attack key or a tap anywhere skips to the full reveal;
 * the same press then collects, once a short guard has passed, so a held key
 * cannot dismiss a chest nobody saw.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import type { CueSlot } from '../../../audio/cueSlot';
import type { SoundId } from '../../../audio/sounds';
import { ABILITY_DEFS } from '../../../abilities/abilityDefs';
import { crawlerName } from '../../../characters/characters';
import { isAIAchievementDef } from '../../../core/progression/AchievementManager';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import { keybindings } from '../../../core/input/Keybindings';
import { rarityAtLeast, type Rarity } from '../../../core/items/defs/rarity';
import { type GrantedLine, type RewardPresentation } from '../../../loot/rewardChest';
import {
  CHEST_REACH_BELOW,
  chestAnchors,
  chestReachAbove,
  chestSpan,
  paintRewardChest,
} from '../../../sprites/art/rewardChestArt';
import { drawMongoIcon } from '../../../sprites/mongoSprite';
import { centerIn, inset, type Rect } from '../../core/geom';
import { keyLabel, tapVerb } from '../../core/inputMode';
import { ACTIVATE_KEYS, type Surface, type Ui } from '../../core/UiRoot';
import { ITEM_ICONS } from '../../icons/itemIcons';
import { drawCoinRewardIcon } from '../../icons/rewardIcons';
import { withAlpha } from '../../theme/color';
import { REWARD_CHEST_INK } from '../../theme/rewardChestInk';
import { skinsFor } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { itemSlot } from '../../widgets/itemSlot';
import { drawGlass, fillRounded, strokeRounded } from '../../widgets/paint';
import { lineHeightOf, measureText, measureTextHeight, text } from '../../widgets/text';
import { rarityColor } from '../dialogs/canvasChrome';
import {
  paintAmbient,
  paintBackdrop,
  paintColumn,
  paintDust,
  paintFlash,
  paintFountain,
  paintSparkleBurst,
  type EffectScene,
} from './chestEffects';
import { LID_OPEN_ANGLE, chestMotionAt, chestPoseAt } from './chestMotion';
import {
  COLLECT_GUARD_FRAMES,
  DROP_START_FRAME,
  chestTimeline,
  coinShare,
  popScale,
  progress,
  type ChestTimeline,
  type RevealBeat,
} from './chestTimeline';

/** Where the presentations a queued screen plays come from. */
export interface PresentationSource {
  /** The next presentation to show, taken off its queue; null when none may show now. */
  take(): RewardPresentation | null;
  /** How many more are waiting after the one on screen. */
  waiting(): number;
  /** Told as each presentation is collected. */
  closed(presentation: RewardPresentation): void;
}

type Cue = Pick<AudioManager, 'play' | 'playRandom'>;

/**
 * The chest falling, before it lands. Silent until its recording is
 * registered; then `takes` become its ids and `standInFor` goes.
 */
const CHEST_DROP: CueSlot<'reward_chest_drop_whoosh'> = {
  takes: [],
  standInFor: 'reward_chest_drop_whoosh',
};

/** The lid's burst open, by the chest's rarity: richer at each rung. */
const BURST_CUES: Readonly<Record<Rarity, SoundId>> = {
  Common: 'reward_chest_burst_common',
  Uncommon: 'reward_chest_burst_uncommon',
  Rare: 'reward_chest_burst_rare',
  Epic: 'reward_chest_burst_epic',
  Legendary: 'reward_chest_burst_legendary',
  Divine: 'reward_chest_burst_divine',
};
const ITEM_POPS: readonly SoundId[] = [
  'reward_item_pop_1',
  'reward_item_pop_2',
  'reward_item_pop_3',
];
const COIN_SHOWERS: readonly SoundId[] = [
  'reward_coin_shower_1',
  'reward_coin_shower_2',
  'reward_coin_shower_3',
];

interface Showing {
  readonly presentation: RewardPresentation;
  readonly timeline: ChestTimeline;
  frame: number;
  /** Frames since the screen settled on this chest, for Collect's guard. */
  settledFrames: number;
  readonly onClosed: (() => void) | null;
  /** The lid's burst has sounded, so a skip past it does not sound it again. */
  burstSounded: boolean;
}

/** The chest is drawn at about this share of the screen's short side. */
const CHEST_SHORT_SIDE_SHARE = 0.4;
const CHEST_MAX_WIDTH_SHARE = 0.55;
/** Room kept clear above the open lid, in chest widths. */
const RISE_ROOM = 0.05;
/** How far above the mouth a reward rises before it glides to the tray, in chest widths. */
const RISE_HEIGHT = 0.95;
const RISER_SCALE_FROM = 0.3;
const RISER_SCALE_PEAK = 1.6;
const HELD_RISER_SCALE = 2.4;
const RISER_HALO_REACH = 1.4;
const RIBBON_MAX_W = 600;
const TRAY_MAX_W = 640;
const TRAY_ROWS = 2;
/** Below this viewport height, a wide screen puts the chest beside the rest rather than above it. */
const SHORT_SCREEN_H = 420;
const SIDE_BY_SIDE_ASPECT = 1.4;
/** The chest's share of the width when it stands beside the rest. */
const STAGE_SHARE = 0.42;
const MIN_CHEST_WIDTH = 8;
/** A cell's width over its slot's: room for the name under it. */
const CELL_WIDTH_SHARE = 1.55;
const TITLE_MAX_LINES = 2;
const DESCRIPTION_MAX_LINES = 2;
const SASH_LENGTH = 150;
const SASH_OFFSET = 34;
/** An eighth of a turn, so the sash crosses the corner squarely. */
const EIGHTHS_PER_TURN = 8;
const SASH_ANGLE = (Math.PI * 2) / EIGHTHS_PER_TURN;
const EDGE_WIDTH = 1.5;
const EDGE_ALPHA = 0.85;
const RIBBON_GLOW_BLUR = 24;
const RIBBON_GLOW_ALPHA = 0.45;
const PIP_SIZE = 6;
/** Collect is never narrower than this many control heights. */
const COLLECT_MIN_CONTROLS = 4;
const EMPTY_SLOT_ALPHA = 0.45;
const RUMBLE_FROM: Rarity = 'Legendary';
/** The chest whose best reward rises to a choir. */
const CHOIR_FROM: Rarity = 'Divine';
const RUMBLE_VOLUME = 0.4;
const MONGO_REWARD_STAGE = 'juvenile';
const HALF = 0.5;

export class RewardChestScreen {
  private showing: Showing | null = null;
  private source: PresentationSource | null = null;
  /** Presentations shown since the screen last opened, the current one included. */
  private shownInRun = 0;

  constructor(private readonly audio: Cue | null) {}

  get isOpen(): boolean {
    return this.showing !== null;
  }

  /** Where {@link open} takes the presentations it plays; the screen opens only through `open()`. */
  bindSource(source: PresentationSource): void {
    this.source = source;
  }

  /**
   * Shows a reward already handed over, starting as the lid bursts back.
   * `onClosed` runs once it is collected.
   */
  present(presentation: RewardPresentation, onClosed: () => void): void {
    const timeline = chestTimeline(presentation.rarity, presentation.rewards);
    this.shownInRun = 1;
    this.showing = {
      presentation,
      timeline,
      frame: timeline.anticipationEnd,
      settledFrames: 0,
      onClosed,
      burstSounded: false,
    };
  }

  /** Opens the screen on the first waiting presentation; false when none is waiting. */
  open(): boolean {
    if (this.showing !== null) return true;
    return this.openNext();
  }

  /** Advances the reveal one frame. */
  tick(): void {
    const showing = this.showing;
    if (showing === null) return;
    const before = showing.frame;
    if (showing.frame < showing.timeline.settledAt) showing.frame++;
    else showing.settledFrames++;
    this.sound(showing, before, showing.frame);
  }

  /** Jumps to the fully revealed chest. */
  skip(): void {
    const showing = this.showing;
    if (showing === null || showing.frame >= showing.timeline.settledAt) return;
    if (!showing.burstSounded) this.playBurst(showing);
    showing.frame = showing.timeline.settledAt;
    showing.settledFrames = 0;
  }

  /** Puts the revealed chest away and moves on to the next; inert during the guard. */
  collect(): void {
    const showing = this.showing;
    if (showing === null || !this.collectable(showing)) return;
    this.showing = null;
    showing.onClosed?.();
    this.source?.closed(showing.presentation);
    if (!this.openNext()) this.shownInRun = 0;
  }

  /** Closes the screen at once, guard or not, as everything under it is torn down. */
  dismiss(): void {
    const showing = this.showing;
    if (showing === null) return;
    this.showing = null;
    this.shownInRun = 0;
    showing.onClosed?.();
    this.source?.closed(showing.presentation);
  }

  /** Skip while it is still revealing, collect once it has settled. */
  private advance(): void {
    const showing = this.showing;
    if (showing === null) return;
    if (showing.frame < showing.timeline.settledAt) this.skip();
    else this.collect();
  }

  private collectable(showing: Showing): boolean {
    return (
      showing.frame >= showing.timeline.settledAt && showing.settledFrames >= COLLECT_GUARD_FRAMES
    );
  }

  /** Puts the next queued presentation on screen; false when none may show now. */
  private openNext(): boolean {
    const source = this.source;
    if (source === null) return false;
    const next = source.take();
    if (next === null) return false;
    this.shownInRun++;
    this.showing = {
      presentation: next,
      timeline: chestTimeline(next.rarity, next.rewards),
      frame: 0,
      settledFrames: 0,
      onClosed: null,
      burstSounded: false,
    };
    return true;
  }

  private playBurst(showing: Showing): void {
    showing.burstSounded = true;
    this.audio?.play(BURST_CUES[showing.timeline.rarity]);
  }

  private sound(showing: Showing, from: number, to: number): void {
    const crossed = (frame: number): boolean => from < frame && to >= frame;
    const leaves = (frame: number): boolean => from <= frame && to > frame;
    const { timeline } = showing;
    if (leaves(DROP_START_FRAME)) this.audio?.playRandom(CHEST_DROP.takes);
    if (crossed(timeline.dropEnd)) this.audio?.play('reward_chest_land');
    if (crossed(timeline.idleEnd)) this.audio?.play('reward_chest_latch');
    if (rarityAtLeast(timeline.rarity, RUMBLE_FROM) && crossed(timeline.unlockEnd)) {
      this.audio?.play('rumble', { volume: RUMBLE_VOLUME });
    }
    if (!showing.burstSounded && to >= timeline.anticipationEnd) this.playBurst(showing);
    for (const beat of timeline.beats) {
      if (beat.held && rarityAtLeast(timeline.rarity, CHOIR_FROM) && crossed(beat.riseAt)) {
        this.audio?.play('divine_choir_swell');
      }
      if (!crossed(beat.landAt)) continue;
      this.audio?.playRandom(beat.line.kind === 'coins' ? COIN_SHOWERS : ITEM_POPS);
    }
  }

  /** The surface, mounted once on the scene's `UiRoot`. */
  surface(id: string): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: true,
      isOpen: () => this.isOpen,
      close: () => this.advance(),
      render: (ui) => {
        const showing = this.showing;
        if (showing !== null) this.render(ui, showing);
      },
      onKey: (key, mods) => {
        const accepts = ACTIVATE_KEYS.has(key) || keybindings.actionFor(key) === 'attack';
        if (!accepts) return false;
        if (mods.repeat !== true && mods.predatesSurface !== true) this.advance();
        return true;
      },
    };
  }

  // ── Drawing ──

  private render(ui: Ui, showing: Showing): void {
    const { ctx, theme } = ui;
    const { presentation, timeline } = showing;
    const frame = clockOf(showing);
    const settled = frame >= timeline.settledAt;
    ctx.save();
    ctx.fillStyle = skinsFor(theme).scrim;
    ctx.fillRect(ui.screen.x, ui.screen.y, ui.screen.w, ui.screen.h);
    ctx.restore();

    const { ribbon, footer, stage, cells, trayTop, trayArea, sideBySide } = this.layout(
      ui,
      showing,
    );
    const reach =
      chestReachAbove(presentation.rarity, LID_OPEN_ANGLE) + RISE_ROOM + CHEST_REACH_BELOW;
    const shortSide = Math.min(ui.screen.w, ui.screen.h);
    const chestWidth = Math.min(
      shortSide * CHEST_SHORT_SIDE_SHARE,
      stage.h / reach,
      stage.w * CHEST_MAX_WIDTH_SHARE,
      stage.w / chestSpan(presentation.rarity),
    );
    const base = {
      x: stage.x + stage.w * HALF,
      y: stage.y + stage.h - CHEST_REACH_BELOW * chestWidth,
    };
    const anchors = chestAnchors(base.x, base.y, chestWidth);
    const scene: EffectScene = {
      ctx,
      theme,
      timeline,
      frame,
      mouth: anchors.mouth,
      chestWidth,
      screen: ui.screen,
    };

    const slots = layoutSlots(ui, cells, trayArea, trayTop, timeline.beats);
    // A canvas cannot draw through a transform scaled to nothing.
    if (chestWidth >= MIN_CHEST_WIDTH) {
      paintBackdrop(scene);
      this.paintChest(ui, showing, base, chestWidth);
      paintDust(scene, base);
      paintColumn(scene);
      paintFountain(scene);
      paintAmbient(scene);
    }
    this.paintRibbon(ui, presentation, ribbon, !sideBySide);
    this.paintTray(ui, showing, slots, scene);
    this.paintRisers(ui, showing, slots, anchors.mouth, chestWidth, ribbon.y + ribbon.h);
    this.paintFooter(ui, showing, footer);
    paintFlash(scene);
    // Over everything else, so a tap on a tray slot mid-reveal skips like any other tap.
    if (!settled) {
      ui.hit('skip', ui.screen, { onTap: () => this.skip(), focusable: false, sound: null });
    }
  }

  /**
   * Where everything goes: stacked ribbon, chest, tray and footer; or, on a
   * short wide screen (a phone on its side), the chest on the left and the
   * rest stacked beside it.
   */
  private layout(ui: Ui, showing: Showing): ScreenLayout {
    const { space } = ui.theme;
    const view = inset(ui.viewport, space.lg);
    const sideBySide = view.h < SHORT_SCREEN_H && view.w >= view.h * SIDE_BY_SIDE_ASPECT;
    const column: Rect = sideBySide
      ? { x: view.x + view.w * STAGE_SHARE, y: view.y, w: view.w * (1 - STAGE_SHARE), h: view.h }
      : view;
    const ribbon = this.ribbonRect(ui, showing.presentation, column, !sideBySide);
    const footerH = this.footerHeight(ui);
    const footer: Rect = { x: column.x, y: column.y + column.h - footerH, w: column.w, h: footerH };
    const rowsRoom = footer.y - space.md - (ribbon.y + ribbon.h + space.md);
    const cells = trayCells(ui, column, showing.timeline.beats.length, rowsRoom);
    const trayH = cells.rows * cells.cellH + (cells.rows - 1) * space.sm;
    const trayTop = sideBySide
      ? ribbon.y + ribbon.h + Math.max(space.md, (rowsRoom - trayH) * HALF + space.md)
      : footer.y - space.md - trayH;
    const stage: Rect = sideBySide
      ? { x: view.x, y: view.y, w: view.w * STAGE_SHARE - space.md, h: view.h }
      : {
          x: view.x,
          y: ribbon.y + ribbon.h + space.md,
          w: view.w,
          h: Math.max(0, trayTop - space.md - (ribbon.y + ribbon.h + space.md)),
        };
    return { ribbon, footer, stage, cells, trayTop, trayArea: column, sideBySide };
  }

  private paintChest(
    ui: Ui,
    showing: Showing,
    base: { readonly x: number; readonly y: number },
    width: number,
  ): void {
    const { ctx } = ui;
    const motion = chestMotionAt(showing.timeline, clockOf(showing));
    ctx.save();
    ctx.translate(base.x + motion.jitter * width, base.y - motion.lift * width);
    ctx.rotate(motion.tilt);
    ctx.scale(motion.scaleX, motion.scaleY);
    paintRewardChest(
      ctx,
      0,
      0,
      width,
      chestPoseAt(showing.timeline, clockOf(showing)),
      REWARD_CHEST_INK[showing.presentation.rarity],
    );
    ctx.restore();
  }

  private ribbonRect(
    ui: Ui,
    presentation: RewardPresentation,
    view: Rect,
    withDescription: boolean,
  ): Rect {
    const { space } = ui.theme;
    const w = Math.min(RIBBON_MAX_W, view.w);
    const inner = w - space.lg * 2;
    const titleRole = ui.size === 'compact' ? 'heading' : 'display';
    const titleH = Math.min(
      measureTextHeight(ui, inner, { text: presentation.title, role: titleRole }),
      lineHeightOf(ui, titleRole) * TITLE_MAX_LINES,
    );
    const descriptionH =
      presentation.subtitle === '' || !withDescription
        ? 0
        : Math.min(
            measureTextHeight(ui, inner, {
              text: presentation.subtitle,
              role: 'secondary',
            }),
            lineHeightOf(ui, 'secondary') * DESCRIPTION_MAX_LINES,
          ) + space.xs;
    const h =
      space.md * 2 +
      lineHeightOf(ui, 'overline') +
      space.xs +
      titleH +
      descriptionH +
      space.xs +
      lineHeightOf(ui, 'caption');
    return { x: view.x + (view.w - w) * HALF, y: view.y, w, h };
  }

  private paintRibbon(
    ui: Ui,
    presentation: RewardPresentation,
    rect: Rect,
    withDescription: boolean,
  ): void {
    const { ctx, theme } = ui;
    const { space, radius, palette } = theme;
    const tint = rarityColor(theme, presentation.rarity);
    ctx.save();
    ctx.shadowColor = withAlpha(rarityColor(theme, presentation.rarity, 'glow'), RIBBON_GLOW_ALPHA);
    ctx.shadowBlur = RIBBON_GLOW_BLUR;
    fillRounded(ctx, rect, radius.lg, palette.surface.solid);
    ctx.restore();
    drawGlass(ui, rect, skinsFor(theme).panel.card);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius.lg);
    ctx.clip();
    this.paintSash(ui, presentation.rarity, rect);
    ctx.restore();
    strokeRounded(ctx, rect, radius.lg, withAlpha(tint, EDGE_ALPHA), EDGE_WIDTH);

    const inner = inset(rect, { l: space.lg, r: space.lg, t: space.md, b: space.md });
    let y = inner.y;
    const kickerH = lineHeightOf(ui, 'overline');
    text(
      ui,
      { x: inner.x, y, w: inner.w, h: kickerH },
      {
        text: kickerFor(presentation),
        role: 'overline',
        color: tint,
        align: 'center',
      },
    );
    y += kickerH + space.xs;
    const titleRole = ui.size === 'compact' ? 'heading' : 'display';
    const titleH = Math.min(
      measureTextHeight(ui, inner.w, { text: presentation.title, role: titleRole }),
      lineHeightOf(ui, titleRole) * TITLE_MAX_LINES,
    );
    text(
      ui,
      { x: inner.x, y, w: inner.w, h: titleH },
      {
        text: presentation.title,
        role: titleRole,
        wrap: true,
        maxLines: TITLE_MAX_LINES,
        align: 'center',
      },
    );
    y += titleH;
    if (presentation.subtitle !== '' && withDescription) {
      const descH = Math.min(
        measureTextHeight(ui, inner.w, { text: presentation.subtitle, role: 'secondary' }),
        lineHeightOf(ui, 'secondary') * DESCRIPTION_MAX_LINES,
      );
      y += space.xs;
      text(
        ui,
        { x: inner.x, y, w: inner.w, h: descH },
        {
          text: presentation.subtitle,
          role: 'secondary',
          wrap: true,
          maxLines: DESCRIPTION_MAX_LINES,
          align: 'center',
        },
      );
      y += descH;
    }
    y += space.xs;
    text(
      ui,
      { x: inner.x, y, w: inner.w, h: lineHeightOf(ui, 'caption') },
      {
        text: `Awarded to ${crawlerName(presentation.crawler)}`,
        role: 'caption',
        color: palette.crawler[presentation.crawler],
        align: 'center',
      },
    );
  }

  /** The rarity's name on a sash across the ribbon's top-right corner. */
  private paintSash(ui: Ui, rarity: Rarity, rect: Rect): void {
    const { ctx, theme } = ui;
    const h = lineHeightOf(ui, 'overline') + theme.space.sm;
    ctx.save();
    ctx.translate(rect.x + rect.w - SASH_OFFSET, rect.y + SASH_OFFSET);
    ctx.rotate(SASH_ANGLE);
    const band: Rect = { x: -SASH_LENGTH * HALF, y: -h * HALF, w: SASH_LENGTH, h };
    const fill = ctx.createLinearGradient(band.x, 0, band.x + band.w, 0);
    fill.addColorStop(0, rarityColor(theme, rarity, 'deep'));
    fill.addColorStop(HALF, rarityColor(theme, rarity, 'base'));
    fill.addColorStop(1, rarityColor(theme, rarity, 'deep'));
    ctx.fillStyle = fill;
    ctx.fillRect(band.x, band.y, band.w, band.h);
    text(ui, band, {
      text: rarity,
      role: 'overline',
      color: theme.palette.text.inverse,
      align: 'center',
      valign: 'middle',
    });
    ctx.restore();
  }

  private footerHeight(ui: Ui): number {
    const { space } = ui.theme;
    return lineHeightOf(ui, 'caption') + space.sm + buttonHeight(ui, 'lg');
  }

  private paintFooter(ui: Ui, showing: Showing, footer: Rect): void {
    const { theme } = ui;
    const { space } = theme;
    const total = this.shownInRun + (this.source?.waiting() ?? 0);
    const captionH = lineHeightOf(ui, 'caption');
    const pipsRow: Rect = { x: footer.x, y: footer.y, w: footer.w, h: captionH };
    if (total > 1) this.paintPips(ui, pipsRow, this.shownInRun, total);
    const buttonRow: Rect = {
      x: footer.x,
      y: footer.y + captionH + space.sm,
      w: footer.w,
      h: buttonHeight(ui, 'lg'),
    };
    if (showing.frame < showing.timeline.settledAt) {
      text(ui, buttonRow, {
        text: skipHint(ui),
        role: 'muted',
        align: 'center',
        valign: 'middle',
      });
      return;
    }
    const more = (this.source?.waiting() ?? 0) > 0;
    const label = more ? 'Next' : 'Collect';
    const w = Math.max(
      theme.size.control * COLLECT_MIN_CONTROLS,
      measureText(ui, label, { role: 'label' }) + space.xl * 2,
    );
    button(ui, centerIn(buttonRow, Math.min(w, buttonRow.w), buttonRow.h), {
      id: 'collect',
      label,
      variant: 'primary',
      size: 'lg',
      primary: true,
      disabled: !this.collectable(showing),
      onTap: () => this.collect(),
    });
  }

  private paintPips(ui: Ui, row: Rect, current: number, total: number): void {
    const { ctx, theme } = ui;
    const { space, palette } = theme;
    const label = `${current} of ${total}`;
    const labelW = measureText(ui, label, { role: 'caption', tabular: true });
    const pipsW = total * PIP_SIZE + (total - 1) * space.xs;
    const left = row.x + (row.w - pipsW - space.sm - labelW) * HALF;
    for (let i = 0; i < total; i++) {
      const x = left + i * (PIP_SIZE + space.xs);
      fillRounded(
        ctx,
        { x, y: row.y + (row.h - PIP_SIZE) * HALF, w: PIP_SIZE, h: PIP_SIZE },
        theme.radius.pill,
        i < current ? palette.accent.base : palette.border.strong,
      );
    }
    text(
      ui,
      { x: left + pipsW + space.sm, y: row.y, w: labelW, h: row.h },
      {
        text: label,
        role: 'caption',
        tabular: true,
      },
    );
  }

  private paintTray(
    ui: Ui,
    showing: Showing,
    slots: readonly SlotPlace[],
    scene: EffectScene,
  ): void {
    const { ctx, theme } = ui;
    const { timeline } = showing;
    const frame = clockOf(showing);
    const settled = frame >= timeline.settledAt;
    const coins = coinTotal(showing.presentation.rewards);
    slots.forEach((slot, index) => {
      const landed = slot.beats.some((beat) => frame >= beat.landAt);
      const lastBeat = slot.beats.length > 0 ? slot.beats[slot.beats.length - 1] : null;
      const scale = lastBeat === null ? 1 : popScale(lastBeat, frame);
      const cx = slot.slot.x + slot.slot.w * HALF;
      const cy = slot.slot.y + slot.slot.h * HALF;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      if (!landed) ctx.globalAlpha *= EMPTY_SLOT_ALPHA;
      const line = slot.overflow === 0 ? slot.beats[0]?.line : undefined;
      if (!landed || line === undefined) {
        itemSlot(ui, slot.slot, {
          id: `slot-${index}`,
          item: null,
          placeholder: landed ? undefined : 'sparkle',
        });
        if (landed) {
          text(ui, slot.slot, {
            text: `+${slot.overflow}`,
            role: 'title',
            align: 'center',
            valign: 'middle',
          });
        }
      } else {
        paintLineSlot(ui, line, slot.slot, index, settled, timeline.rarity);
      }
      ctx.restore();
      if (landed) {
        const labels = slotLabels(theme, line, slot.overflow, coins, coinShare(timeline, frame));
        text(ui, slot.label, { text: labels.name, role: 'caption', align: 'center' });
        if (labels.detail !== null) {
          text(
            ui,
            { ...slot.label, y: slot.label.y + lineHeightOf(ui, 'caption') },
            {
              text: labels.detail.text,
              role: 'overline',
              color: labels.detail.color,
              align: 'center',
            },
          );
        }
      }
      for (const beat of slot.beats) {
        paintSparkleBurst(
          scene,
          { x: cx, y: cy },
          beat.landAt,
          rarityColor(theme, lineRarity(beat.line) ?? timeline.rarity, 'glow'),
          index,
        );
      }
    });
  }

  /** Rewards on their way: rising out of the chest, then gliding down to their slots. */
  private paintRisers(
    ui: Ui,
    showing: Showing,
    slots: readonly SlotPlace[],
    mouth: { readonly x: number; readonly y: number },
    chestWidth: number,
    ceiling: number,
  ): void {
    const { ctx, theme } = ui;
    const { timeline } = showing;
    const frame = clockOf(showing);
    for (const slot of slots) {
      for (const beat of slot.beats) {
        if (frame < beat.riseAt || frame >= beat.landAt) continue;
        const peakScale = beat.held ? HELD_RISER_SCALE : RISER_SCALE_PEAK;
        const peakClear = ceiling + slot.slot.w * peakScale * HALF;
        const peak = {
          x: mouth.x,
          y: Math.min(mouth.y, Math.max(peakClear, mouth.y - chestWidth * RISE_HEIGHT)),
        };
        const target = {
          x: slot.slot.x + slot.slot.w * HALF,
          y: slot.slot.y + slot.slot.h * HALF,
        };
        const rising = frame < beat.glideAt;
        let x: number;
        let y: number;
        let s: number;
        if (rising) {
          const p = easeOut(progress(frame, beat.riseAt, beat.glideAt));
          x = mouth.x;
          y = mouth.y + (peak.y - mouth.y) * p;
          s = RISER_SCALE_FROM + (peakScale - RISER_SCALE_FROM) * p;
        } else {
          const p = easeInOut(progress(frame, beat.glideAt, beat.landAt));
          x = peak.x + (target.x - peak.x) * p;
          y = peak.y + (target.y - peak.y) * p - Math.sin(p * Math.PI) * chestWidth * HALF * HALF;
          s = peakScale + (1 - peakScale) * p;
        }
        const size = slot.slot.w * s;
        const tint = rarityColor(theme, lineRarity(beat.line) ?? timeline.rarity, 'glow');
        const halo = ctx.createRadialGradient(x, y, 0, x, y, size * RISER_HALO_REACH * HALF);
        halo.addColorStop(0, withAlpha(tint, HALF));
        halo.addColorStop(1, withAlpha(tint, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = halo;
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
        ctx.restore();
        paintLinePicture(ctx, beat.line, {
          x: x - size * HALF,
          y: y - size * HALF,
          w: size,
          h: size,
        });
      }
    }
  }
}

/**
 * The frame the chest's painters run on: the reveal's own frame, then on
 * past it while the settled chest idles, so its motes, rays, halo and runes
 * keep moving and every burst plays out to its end.
 */
function clockOf(showing: Showing): number {
  return showing.frame + showing.settledFrames;
}

// ── Lines ──

function lineRarity(line: GrantedLine): Rarity | null {
  if (line.kind === 'item' || line.kind === 'duplicate') return ITEM_DEF[line.id].rarity ?? null;
  return null;
}

function coinTotal(rewards: readonly GrantedLine[]): number {
  return rewards.reduce((sum, line) => sum + (line.kind === 'coins' ? line.amount : 0), 0);
}

function paintMongo(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const size = Math.min(rect.w, rect.h);
  drawMongoIcon(ctx, MONGO_REWARD_STAGE, rect.x + rect.w * HALF, rect.y + rect.h * HALF, size);
}

function paintLinePicture(ctx: CanvasRenderingContext2D, line: GrantedLine, rect: Rect): void {
  switch (line.kind) {
    case 'item':
    case 'duplicate':
      ITEM_ICONS[line.id](ctx, rect);
      return;
    case 'coins':
      drawCoinRewardIcon(ctx, rect);
      return;
    case 'companion':
      paintMongo(ctx, rect);
      return;
  }
}

function paintLineSlot(
  ui: Ui,
  line: GrantedLine,
  rect: Rect,
  index: number,
  settled: boolean,
  chestRarity: Rarity,
): void {
  const id = `slot-${index}`;
  switch (line.kind) {
    case 'item':
      itemSlot(ui, rect, {
        id,
        item: line.id,
        quantity: line.quantity,
        tooltip: settled,
      });
      return;
    case 'duplicate':
      itemSlot(ui, rect, { id, item: line.id, tooltip: settled });
      return;
    case 'coins':
      itemSlot(ui, rect, { id, item: null, picture: drawCoinRewardIcon });
      return;
    case 'companion':
      itemSlot(ui, rect, { id, item: null, picture: paintMongo, rarity: chestRarity });
      return;
  }
}

/** The two lines under a slot: what it is, and its rarity or what it paid. */
function slotLabels(
  theme: Ui['theme'],
  line: GrantedLine | undefined,
  overflow: number,
  coins: number,
  coinsLanded: number,
): { name: string; detail: { text: string; color: string } | null } {
  if (line === undefined) return { name: `${overflow} more`, detail: null };
  switch (line.kind) {
    case 'item': {
      const rarity = ITEM_DEF[line.id].rarity;
      return {
        name: ITEM_DEF[line.id].name,
        detail: rarity === undefined ? null : { text: rarity, color: rarityColor(theme, rarity) },
      };
    }
    case 'duplicate':
      return {
        name: 'Duplicate',
        detail: { text: `+${line.coins} coins`, color: theme.palette.accent.base },
      };
    case 'coins':
      return { name: `${Math.round(coins * coinsLanded).toLocaleString()} coins`, detail: null };
    case 'companion':
      return {
        name: ABILITY_DEFS.mongo.name,
        detail: { text: 'Companion', color: theme.palette.accent.base },
      };
  }
}

/**
 * The small line over the title. A chest's title already names where it came
 * from, so its kicker names the chest instead.
 */
function kickerFor(presentation: RewardPresentation): string {
  const { origin } = presentation;
  switch (origin.kind) {
    case 'award':
      return isAIAchievementDef(origin.award) ? 'A special award!' : 'Achievement unlocked';
    case 'chest':
      return `${presentation.rarity} chest`;
    default: {
      const unhandled: never = origin;
      return unhandled;
    }
  }
}

function skipHint(ui: Ui): string {
  const verb = tapVerb(ui.density);
  return ui.density === 'touch'
    ? `${verb} to skip`
    : `${verb} or press ${keyLabel('attack')} to skip`;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
  const rest = 1 - t;
  return t < HALF ? 2 * t * t : 1 - 2 * rest * rest;
}

// ── Tray layout ──

interface ScreenLayout {
  readonly ribbon: Rect;
  readonly footer: Rect;
  readonly stage: Rect;
  readonly cells: TrayCells;
  readonly trayTop: number;
  /** The column the tray rows are centred in. */
  readonly trayArea: Rect;
  readonly sideBySide: boolean;
}

interface TrayCells {
  readonly perRow: number;
  readonly rows: number;
  readonly slot: number;
  readonly cellW: number;
  readonly cellH: number;
  /** How many cells are shown; past this the last cell folds the rest into "+N more". */
  readonly shown: number;
}

function trayCells(ui: Ui, view: Rect, lines: number, room: number): TrayCells {
  const { space, size } = ui.theme;
  const slot = size.slot;
  const cellW = slot * CELL_WIDTH_SHARE;
  const trayW = Math.min(TRAY_MAX_W, view.w);
  const perRow = Math.max(1, Math.floor((trayW + space.sm) / (cellW + space.sm)));
  const cellH = slot + space.xs + lineHeightOf(ui, 'caption') + lineHeightOf(ui, 'overline');
  const rowsThatFit = Math.floor((room + space.sm) / (cellH + space.sm));
  const capacity = perRow * Math.max(1, Math.min(TRAY_ROWS, rowsThatFit));
  const shown = Math.min(lines, capacity);
  const rows = Math.max(1, Math.ceil(shown / perRow));
  return { perRow, rows, slot, cellW, cellH, shown };
}

interface SlotPlace {
  readonly slot: Rect;
  readonly label: Rect;
  /** The beats landing in this cell: one, or every folded line for the "+N more" cell. */
  readonly beats: readonly RevealBeat[];
  /** How many lines the folded "+N more" cell stands for; 0 for an ordinary cell. */
  readonly overflow: number;
}

function layoutSlots(
  ui: Ui,
  cells: TrayCells,
  view: Rect,
  top: number,
  beats: readonly RevealBeat[],
): SlotPlace[] {
  const gap = ui.theme.space.sm;
  const under = ui.theme.space.xs;
  const places: SlotPlace[] = [];
  const folds = beats.length > cells.shown;
  for (let i = 0; i < cells.shown; i++) {
    const row = Math.floor(i / cells.perRow);
    const inRow = Math.min(cells.perRow, cells.shown - row * cells.perRow);
    const col = i % cells.perRow;
    const rowW = inRow * cells.cellW + (inRow - 1) * gap;
    const left = view.x + (view.w - rowW) * HALF;
    const cellX = left + col * (cells.cellW + gap);
    const cellY = top + row * (cells.cellH + gap);
    const slot: Rect = {
      x: cellX + (cells.cellW - cells.slot) * HALF,
      y: cellY,
      w: cells.slot,
      h: cells.slot,
    };
    const label: Rect = {
      x: cellX,
      y: cellY + cells.slot + under,
      w: cells.cellW,
      h: cells.cellH - cells.slot,
    };
    const last = folds && i === cells.shown - 1;
    const own = last ? beats.slice(i) : beats.slice(i, i + 1);
    places.push({ slot, label, beats: own, overflow: last ? own.length : 0 });
  }
  return places;
}
