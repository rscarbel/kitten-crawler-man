import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import { CLUB_MERC_DESK_TILE } from '../core/clubLayout';
import {
  MERCENARY_TEMPLATES,
  getMercenaryTemplate,
  type MercenaryTemplate,
  type MercenaryTemplateId,
} from '../core/mercenaryTemplates';
import { MERCENARY_ART } from '../sprites/mercenaryArt';
import { drawRosemariePortrait, prewarmRosemarie } from '../sprites/rosemarieSprite';
import { GROUND_OFFSET_IN_TILE as ROSEMARIE_GROUND_IN_TILE } from '../sprites/art/rosemarieFigure';
import { drawText } from '../ui/TextBox';
import {
  drawOverlay,
  drawBox,
  drawProgressBar,
  BOX_PRESETS,
  beginModalFit,
  endModalFit,
  modalFitPoint,
  MODAL_FIT_NONE,
  type ModalFit,
} from '../ui/Box';
import {
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  focusMenuButton,
  type ButtonOptions,
  BUTTON_PRESETS,
  setButtonPointerSpace,
  resetButtonPointerSpace,
} from '../ui/Button';
import { fitPanel } from '../ui/panelFit';
import { pointInRect } from '../utils';
import { activeRunStats } from '../core/GameStats';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { RosemarieDeskIdle } from './RosemarieDeskIdle';

// Panel geometry. Every hire fits on the list at once, so there is nothing to
// scroll and nothing the keyboard can focus that the eye cannot see.
const PANEL_W = 620;
const PANEL_H = 448;
const PANEL_PADDING = 18;
const OVERLAY_ALPHA = 0.6;

const TITLE_SIZE = 17;
const SUBTITLE_SIZE = 11;
const SUBTITLE_Y = 24;
const COINS_SIZE = 12;
/** Level with the title's glyphs, at the panel's right edge where the subtitle cannot reach. */
const COINS_Y = 3;
const BODY_Y = 50;

// The list of hires down the left.
const LIST_W = 214;
const ROW_H = 32;
const ROW_GAP = 4;
const ROW_PAD_X = 10;
const ROW_NAME_SIZE = 12;
const ROW_NAME_Y = 4;
const ROW_SPECIES_SIZE = 9;
const ROW_SPECIES_Y = 18;
const ROW_PRICE_SIZE = 12;
const ROW_PRICE_Y = 10;

// The selected hire's detail pane on the right.
const PANE_GAP = 12;
const PANE_PAD = 12;
const PORTRAIT_W = 104;
const PORTRAIT_H = 128;
/** The largest a portrait tile is drawn: a short hire stops growing before it turns to mush. */
const PORTRAIT_MAX_TILE = 84;
/** Breathing room between the figure and its frame, top and bottom. */
const PORTRAIT_MARGIN = 6;
/** Every figure stands on a line this far down its tile. */
const FIGURE_FEET_IN_TILE = 0.95;
const PORTRAIT_UNKNOWN_SIZE = 44;
const INFO_GAP = 14;
const INFO_NAME_SIZE = 15;
const INFO_TAG_SIZE = 11;
const INFO_TAG_Y = 22;
const INFO_PRICE_SIZE = 12;
const INFO_PRICE_Y = 40;
const STATS_Y = 66;
const STAT_ROW_H = 20;
const STAT_LABEL_W = 52;
const STAT_LABEL_SIZE = 10;
const STAT_VALUE_W = 34;
const STAT_BAR_H = 8;
/** Centres the bar on the label's glyphs rather than on its line box. */
const STAT_BAR_Y = 3;
const PITCH_GAP = 10;
const PITCH_SIZE = 11;
const PITCH_LINE_H = 15;
const PITCH_MAX_LINES = 3;
const NOTE_SIZE = 10;
const NOTE_GAP = 6;
const ACTION_BTN_W = 170;
/**
 * Dismiss sits above the button row, never in the Hire slot: a double click
 * or a second Enter on Hire must land on nothing, not on the contract it just
 * signed.
 */
const DISMISS_BTN_W = 150;
const DISMISS_BTN_H = 26;
const ACTION_BTN_H = 34;
const CLOSE_BTN_W = 120;

// Rosemarie's line, under the list and the pane.
const SPEECH_GAP = 10;
const SPEECH_H = 56;
const SPEECH_PAD = 8;
const SPEECH_PORTRAIT_W = 52;
/** She is short even for a dwarf: a tile this size fills the strip without her hat touching the top. */
const SPEECH_PORTRAIT_TILE = 56;
const SPEECH_NAME_SIZE = 10;
const SPEECH_TEXT_SIZE = 11;
const SPEECH_LINE_H = 15;
const SPEECH_MAX_LINES = 2;
const SPEECH_NAME_Y = 6;
const SPEECH_TEXT_Y = 20;

const HINT_SIZE = 10;
const HINT_GAP = 8;

const ACCENT = '#c8a840';
const GOLD_TEXT = '#f0d870';
const MUTED_TEXT = '#a89a70';
const COINS_TEXT = '#d4c070';
const HINT_TEXT = '#8a7a58';
const HIRED_TEXT = '#86efac';
const UNAVAILABLE_TEXT = '#6b6150';
const NOTE_TEXT = '#f0b040';
const PITCH_TEXT = '#e8dcc0';
const PANE_FILL = 'rgba(30,26,18,0.7)';
const PANE_BORDER = '#5a4a30';
const PORTRAIT_FILL = 'rgba(12,10,8,0.8)';
const SPEECH_FILL = 'rgba(60,40,20,0.55)';
const PANE_RADIUS = 8;
const PANE_BORDER_WIDTH = 1.5;
const HP_BAR_FILL = '#ef4444';
const SPEED_BAR_FILL = '#4ade80';
const DAMAGE_BAR_FILL = '#f59e0b';

// Rosemarie's voice. She is an old dwarf who sells people for a living, and
// she has made her peace with where most of them end up.
const TITLE = 'Meat Shields: Mercenaries for Hire';
const SUBTITLE = 'Rosemarie peers over the desk. Bernie the mole peers too.';
const GREETING = '"Pick one, sweetheart. They all bleed. Some just take longer about it."';
const NOT_ENOUGH_COINS = '"Come back when your purse is heavier than my mole."';
const CONTRACT_ACTIVE =
  '"One at a time, sweetheart. Bring the last one back and I\'ll tear it up."';
const NO_FLOOR = '"Can\'t sign you up for a floor you ain\'t standing on."';
const DAMASCUS_REFUSAL =
  "\"Damascus? He's on my books, but he don't sign for crawlers. Don't ask him twice.\"";
const hireSuccess = (name: string): string =>
  `"${name}'s yours till the floor's done or they are. No refunds on either. They're waiting out front."`;
const dismissed = (name: string): string =>
  `"${name} goes back on the shelf. Only place you can do that is here, mind. Nice doing business."`;
const confirmDismissal = (name: string): string =>
  `"Tear up ${name}'s paper? Fee stays in my apron either way, sweetheart. Your call."`;
const condolences = (name: string): string =>
  `"Heard about ${name}. Contract's paid through the floor all the same. That's the business."`;

/** Damascus Steel is on Meat Shields' books but will not be hired, so his entry is a refusal, not a card. */
const DAMASCUS = {
  name: 'Damascus Steel',
  species: 'Ifrit',
  role: 'Dancer',
} as const;

type DeskEntry = { kind: 'hire'; template: MercenaryTemplate } | { kind: 'refusal' };

/** The hires in price order, and Damascus at the foot of the list where nobody can buy him. */
const DESK_ENTRIES: readonly DeskEntry[] = [
  ...MERCENARY_TEMPLATES.map((template): DeskEntry => ({ kind: 'hire', template })),
  { kind: 'refusal' },
];

const MAX_HP = Math.max(...MERCENARY_TEMPLATES.map((t) => t.hp));
const MAX_SPEED = Math.max(...MERCENARY_TEMPLATES.map((t) => t.speed));
const MAX_DAMAGE = Math.max(...MERCENARY_TEMPLATES.map((t) => t.damage));

/** Speeds are tenths apart; one decimal is all the difference there is. */
const SPEED_DECIMALS = 1;

type GuildAction =
  | { kind: 'select'; index: number }
  | { kind: 'hire'; id: MercenaryTemplateId }
  | { kind: 'askDismiss' }
  | { kind: 'keep' }
  | { kind: 'tearUp' }
  | { kind: 'close' };

const FOCUS_CONTEXT = 'club-guild';
/** The pane's controls follow the list's rows in the ring, so its first control is always here. */
const PANE_RING_START = DESK_ENTRIES.length;

interface GuildButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: GuildAction;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The only part of a crawler the desk reads or writes. */
type Purse = Pick<Player, 'coins'>;

/**
 * Rosemarie's "Meat Shields" desk in the Desperado Club: a list of hires down
 * the left, the selected one's portrait, stats and sales pitch on the right,
 * and Rosemarie herself underneath saying whatever she has to say about it.
 *
 * Signing a contract deducts coins and records it on the persisted
 * {@link MercenaryRoster}, which the overworld `MercenarySystem` reads to spawn
 * the ally. One contract at a time, and the desk is the only place one can be
 * torn up.
 *
 * Keyboard: the ring is the list's rows, then the pane's controls. Focus
 * opens on the selected row, and moving it along the list moves the selection.
 * Enter on a row hands focus to that hire's pane — Hire, or Dismiss for the
 * one under contract — and focus coming back into the list always lands on the
 * selected row, so leaving the list never changes who is selected.
 *
 * A row never spends coins, whoever presses it. Dismissing asks first, with
 * "keep them" where the Dismiss button's focus lands.
 */
export class MercenaryGuildSystem {
  open = false;

  /** Set when a contract is signed; the host clears it after firing the first-hire achievement. */
  hirePending = false;

  private selected = 0;
  /** The list row the keyboard ring sat on last frame, or null when it was elsewhere. */
  private focusedRow: number | null = null;
  /** Where the ring goes on the next render, for a keypress that means "go there". */
  private pendingFocus: number | null = null;
  /** Whether any of the pane's controls held focus last frame. */
  private paneHadFocus = false;
  private confirmingDismiss = false;
  private rosemarieLine = GREETING;
  private buttons: GuildButton[] = [];
  /** Set every render; clicks are mapped back through it before hit-testing. */
  private fit: ModalFit = MODAL_FIT_NONE;
  private readonly desk = new RosemarieDeskIdle(CLUB_MERC_DESK_TILE);

  constructor(
    private readonly roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
  ) {
    prewarmRosemarie();
  }

  openPanel(): void {
    this.open = true;
    this.focusedRow = null;
    prewarmRosemarie({ portrait: true });
    const active = this.roster.active;
    const activeIndex =
      active === null
        ? -1
        : DESK_ENTRIES.findIndex((e) => e.kind === 'hire' && e.template.id === active.id);
    this.selected = Math.max(0, activeIndex);
    this.pendingFocus = this.selected;
    this.paneHadFocus = false;
    this.confirmingDismiss = false;
    // Said once: cleared on the live roster, which every later save and
    // checkpoint captures, so only rewinding to before this visit repeats it.
    const deceased = this.roster.lastDeceased;
    this.roster.lastDeceased = null;
    this.rosemarieLine = deceased === null ? GREETING : condolences(deceased);
    this.audio?.play('typing_click');
  }

  close(): void {
    this.open = false;
  }

  /** Advances Rosemarie's life behind the desk: her hobble, her coins, the dancers' complaints. */
  updateDesk(): void {
    this.desk.update(this.open);
  }

  /** Draws Rosemarie at her desk for the club's Y-sorted pass. */
  renderDesk(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    this.desk.render(ctx, camX, camY, tileSize);
  }

  /** The coin she has in the air and whatever the dancer it hit is shouting about. */
  renderDeskOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.desk.renderOverlay(ctx, camX, camY);
  }

  private say(line: string): void {
    this.rosemarieLine = line;
  }

  /** Rosemarie's reason not to sign `template` right now, or null when she will. */
  private hireRefusal(template: MercenaryTemplate, player: Purse): string | null {
    // Only a harness builds the desk with no floor under it; a contract with
    // no floor to run to would never end.
    if (this.roster.floorLevelId === null) return NO_FLOOR;
    if (this.roster.active !== null) return CONTRACT_ACTIVE;
    if (player.coins < template.price) return NOT_ENOUGH_COINS;
    return null;
  }

  private hire(id: MercenaryTemplateId, player: Purse): void {
    const template = getMercenaryTemplate(id);
    const refusal = this.hireRefusal(template, player);
    const contractLevelId = this.roster.floorLevelId;
    if (refusal !== null || contractLevelId === null) {
      this.say(refusal ?? NO_FLOOR);
      this.audio?.play('error');
      return;
    }
    player.coins -= template.price;
    activeRunStats()?.recordHirelingHired();
    // Warmed on the signature rather than on the first frame the hire is
    // drawn: it walks out of the club already moving.
    MERCENARY_ART[template.art].prewarm();
    this.roster.active = {
      id: template.id,
      name: template.name,
      contractLevelId,
      introduced: false,
    };
    this.hirePending = true;
    this.confirmingDismiss = false;
    // Back to the row, so a second press can only hand focus to the pane again.
    this.pendingFocus = this.selected;
    this.say(hireSuccess(template.name));
    this.audio?.play('purchase_success');
  }

  private dismiss(): void {
    if (this.roster.active === null) return;
    const name = this.roster.active.name;
    this.roster.active = null;
    this.confirmingDismiss = false;
    this.pendingFocus = this.selected;
    this.say(dismissed(name));
    this.audio?.play('menu_click');
  }

  /**
   * Enter on the selected row: move into its pane when there is something to
   * do there, or hear from Rosemarie why there isn't. Never signs anything.
   */
  private activateEntry(index: number, player: Purse): void {
    const entry = DESK_ENTRIES[index];
    if (entry.kind === 'refusal') {
      this.say(DAMASCUS_REFUSAL);
      this.audio?.play('typing_click');
      return;
    }
    const underContract = this.roster.active?.id === entry.template.id;
    const refusal = underContract ? null : this.hireRefusal(entry.template, player);
    if (refusal !== null) {
      this.say(refusal);
      this.audio?.play('error');
      return;
    }
    this.pendingFocus = PANE_RING_START;
  }

  private select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
    this.confirmingDismiss = false;
  }

  handleClick(mx: number, my: number, player: Purse): void {
    const point = modalFitPoint(this.fit, mx, my);
    for (const btn of this.buttons) {
      if (!pointInRect(point.x, point.y, btn)) continue;
      const action = btn.action;
      switch (action.kind) {
        case 'select':
          // A press on the row the ring is on is Enter; any other only selects.
          if (action.index === this.selected && action.index === this.focusedRow) {
            this.activateEntry(action.index, player);
          } else {
            this.select(action.index);
          }
          return;
        case 'hire':
          this.hire(action.id, player);
          return;
        case 'askDismiss':
          if (this.roster.active === null) return;
          this.confirmingDismiss = true;
          this.say(confirmDismissal(this.roster.active.name));
          this.audio?.play('typing_click');
          return;
        case 'keep':
          this.confirmingDismiss = false;
          this.say(GREETING);
          return;
        case 'tearUp':
          this.dismiss();
          return;
        case 'close':
          this.close();
          return;
      }
    }
  }

  renderPanel(ctx: CanvasRenderingContext2D, player: Purse): void {
    if (!this.open) return;
    this.buttons = [];

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });

    this.fit = fitPanel(PANEL_W, PANEL_H);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    // Positioned by hand rather than through `drawModal`, which narrows a panel
    // to the viewport: `fitPanel` has already scaled this one to fit, and a
    // narrowed pane would push its fixed-width buttons into each other.
    const panel = drawBox(ctx, {
      x: Math.round((viewportWidth() - PANEL_W) / 2),
      y: Math.round((viewportHeight() - PANEL_H) / 2),
      width: PANEL_W,
      height: PANEL_H,
      padding: PANEL_PADDING,
      ...BOX_PRESETS.modal,
      border: ACCENT,
    });
    const inner = panel.inner;
    const centerX = inner.x + inner.width / 2;

    drawText(ctx, TITLE, {
      x: centerX,
      y: inner.y,
      size: TITLE_SIZE,
      bold: true,
      color: GOLD_TEXT,
      align: 'center',
    });
    drawText(ctx, SUBTITLE, {
      x: centerX,
      y: inner.y + SUBTITLE_Y,
      size: SUBTITLE_SIZE,
      italic: true,
      color: MUTED_TEXT,
      align: 'center',
    });

    const bodyY = inner.y + BODY_Y;
    const listRect: Rect = { x: inner.x, y: bodyY, w: LIST_W, h: listHeight() };
    const paneX = inner.x + LIST_W + PANE_GAP;
    const paneRect: Rect = { x: paneX, y: bodyY, w: inner.x + inner.width - paneX, h: listRect.h };

    // Opened after the chrome and closed after Close, so the ring is exactly
    // the desk's own controls in reading order: the list, the pane's action,
    // then the way out. The list is drawn first so its rows hold the ring's
    // leading indices whatever the pane below it shows.
    beginMenuFocus(FOCUS_CONTEXT);
    if (this.pendingFocus !== null) {
      focusMenuButton(FOCUS_CONTEXT, this.pendingFocus);
      this.pendingFocus = null;
    }
    this.renderList(ctx, listRect);
    this.renderPane(ctx, paneRect, player);
    endMenuFocus();

    const speechY = bodyY + listRect.h + SPEECH_GAP;
    this.renderSpeech(ctx, { x: inner.x, y: speechY, w: inner.width, h: SPEECH_H });

    drawText(ctx, `Coins: ${player.coins}`, {
      x: inner.x + inner.width,
      y: inner.y + COINS_Y,
      size: COINS_SIZE,
      bold: true,
      color: COINS_TEXT,
      align: 'right',
    });
    drawText(ctx, '[Up/Down] Browse    [Enter] Choose    [Esc] Leave the desk', {
      x: centerX,
      y: speechY + SPEECH_H + HINT_GAP,
      size: HINT_SIZE,
      color: HINT_TEXT,
      align: 'center',
    });

    endModalFit(ctx);
    resetButtonPointerSpace();
  }

  private renderList(ctx: CanvasRenderingContext2D, rect: Rect): void {
    let focusedRow: number | null = null;
    for (const [index, entry] of DESK_ENTRIES.entries()) {
      const y = rect.y + index * (ROW_H + ROW_GAP);
      const isSelected = index === this.selected;
      const unavailable = entry.kind === 'refusal';
      const preset = isSelected
        ? BUTTON_PRESETS.mercRowSelected
        : unavailable
          ? BUTTON_PRESETS.mercRowUnavailable
          : BUTTON_PRESETS.mercRow;
      const result = drawButton(ctx, {
        x: rect.x,
        y,
        width: rect.w,
        height: ROW_H,
        label: '',
        ...preset,
      });
      if (result.focused) focusedRow = index;
      this.buttons.push({ x: rect.x, y, w: rect.w, h: ROW_H, action: { kind: 'select', index } });
      this.renderRowText(ctx, entry, rect.x, y, rect.w);
    }
    // Selection follows the keyboard only when the ring moves, so a pointer
    // click on another row is not dragged back to wherever focus was resting.
    // Coming back from the pane (Up from its first control, Down wrapping
    // round from its last) is not browsing: focus returns to the selected row.
    const ringMoved = focusedRow !== null && focusedRow !== this.focusedRow;
    if (ringMoved && this.paneHadFocus && focusedRow !== this.selected) {
      this.pendingFocus = this.selected;
    } else if (focusedRow !== null && ringMoved) {
      this.select(focusedRow);
    }
    this.focusedRow = focusedRow;
  }

  private renderRowText(
    ctx: CanvasRenderingContext2D,
    entry: DeskEntry,
    x: number,
    y: number,
    w: number,
  ): void {
    const unavailable = entry.kind === 'refusal';
    const name = unavailable ? DAMASCUS.name : entry.template.name;
    const species = unavailable ? DAMASCUS.species : entry.template.species;
    drawText(ctx, name, {
      x: x + ROW_PAD_X,
      y: y + ROW_NAME_Y,
      size: ROW_NAME_SIZE,
      bold: true,
      color: unavailable ? UNAVAILABLE_TEXT : GOLD_TEXT,
    });
    drawText(ctx, species, {
      x: x + ROW_PAD_X,
      y: y + ROW_SPECIES_Y,
      size: ROW_SPECIES_SIZE,
      color: unavailable ? UNAVAILABLE_TEXT : MUTED_TEXT,
    });
    const hired = !unavailable && this.roster.active?.id === entry.template.id;
    const priceLabel = unavailable ? 'Not available' : hired ? 'HIRED' : `${entry.template.price}`;
    const priceColor = unavailable ? UNAVAILABLE_TEXT : hired ? HIRED_TEXT : COINS_TEXT;
    drawText(ctx, priceLabel, {
      x: x + w - ROW_PAD_X,
      y: y + ROW_PRICE_Y,
      size: unavailable ? ROW_SPECIES_SIZE : ROW_PRICE_SIZE,
      bold: !unavailable,
      color: priceColor,
      align: 'right',
    });
  }

  /** Draws a pane control, registers its hit-rect, and notes whether the ring is on it. */
  private paneButton(
    ctx: CanvasRenderingContext2D,
    opts: ButtonOptions,
    action: GuildAction,
  ): void {
    const result = drawButton(ctx, opts);
    if (result.focused) this.paneHadFocus = true;
    this.buttons.push({ x: result.x, y: result.y, w: result.width, h: result.height, action });
  }

  private renderPane(ctx: CanvasRenderingContext2D, rect: Rect, player: Purse): void {
    this.paneHadFocus = false;
    drawBox(ctx, {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      fill: PANE_FILL,
      border: PANE_BORDER,
      borderWidth: PANE_BORDER_WIDTH,
      radius: PANE_RADIUS,
    });
    const entry = DESK_ENTRIES[this.selected];

    const portrait: Rect = {
      x: rect.x + PANE_PAD,
      y: rect.y + PANE_PAD,
      w: PORTRAIT_W,
      h: PORTRAIT_H,
    };
    drawBox(ctx, {
      x: portrait.x,
      y: portrait.y,
      width: portrait.w,
      height: portrait.h,
      fill: PORTRAIT_FILL,
      border: PANE_BORDER,
      borderWidth: 1,
      radius: PANE_RADIUS,
    });
    if (entry.kind === 'hire') this.renderPortrait(ctx, entry.template, portrait);
    else {
      drawText(ctx, '?', {
        x: portrait.x + portrait.w / 2,
        y: portrait.y + (portrait.h - PORTRAIT_UNKNOWN_SIZE) / 2,
        size: PORTRAIT_UNKNOWN_SIZE,
        bold: true,
        color: UNAVAILABLE_TEXT,
        align: 'center',
      });
    }

    const infoX = portrait.x + portrait.w + INFO_GAP;
    const infoW = rect.x + rect.w - PANE_PAD - infoX;
    const name = entry.kind === 'hire' ? entry.template.name : DAMASCUS.name;
    const species = entry.kind === 'hire' ? entry.template.species : DAMASCUS.species;
    const role = entry.kind === 'hire' ? entry.template.role : DAMASCUS.role;
    drawText(ctx, name, {
      x: infoX,
      y: portrait.y,
      size: INFO_NAME_SIZE,
      bold: true,
      color: entry.kind === 'hire' ? GOLD_TEXT : MUTED_TEXT,
    });
    drawText(ctx, `${species} · ${role}`, {
      x: infoX,
      y: portrait.y + INFO_TAG_Y,
      size: INFO_TAG_SIZE,
      color: MUTED_TEXT,
    });

    const pitchY = portrait.y + portrait.h + PITCH_GAP;
    const pitchW = rect.w - PANE_PAD * 2;
    const buttonY = rect.y + rect.h - PANE_PAD - ACTION_BTN_H;
    const closeX = rect.x + rect.w - PANE_PAD - CLOSE_BTN_W;

    if (entry.kind === 'refusal') {
      drawText(ctx, 'Not available', {
        x: infoX,
        y: portrait.y + INFO_PRICE_Y,
        size: INFO_PRICE_SIZE,
        bold: true,
        color: UNAVAILABLE_TEXT,
      });
      this.renderPitch(ctx, DAMASCUS_REFUSAL, rect.x + PANE_PAD, pitchY, pitchW);
      this.renderCloseButton(ctx, closeX, buttonY);
      return;
    }

    const template = entry.template;
    const hiredHere = this.roster.active?.id === template.id;
    drawText(ctx, hiredHere ? 'Under contract' : `${template.price} coins`, {
      x: infoX,
      y: portrait.y + INFO_PRICE_Y,
      size: INFO_PRICE_SIZE,
      bold: true,
      color: hiredHere ? HIRED_TEXT : COINS_TEXT,
    });
    this.renderStats(ctx, template, infoX, portrait.y + STATS_Y, infoW);
    this.renderPitch(ctx, template.pitch, rect.x + PANE_PAD, pitchY, pitchW);

    const actionX = rect.x + PANE_PAD;
    const noteY = buttonY - NOTE_GAP - NOTE_SIZE;
    if (!hiredHere) {
      this.renderNote(ctx, this.hireNote(template, player), actionX, noteY);
      // Drawn disabled, which keeps it off the ring, but still hit-tested: a
      // click on it is how a player hears why they can't sign.
      const disabled = this.hireRefusal(template, player) !== null;
      this.paneButton(
        ctx,
        {
          x: actionX,
          y: buttonY,
          width: ACTION_BTN_W,
          height: ACTION_BTN_H,
          label: `Hire: ${template.price}`,
          ...BUTTON_PRESETS.gold,
          disabled,
        },
        { kind: 'hire', id: template.id },
      );
      this.renderCloseButton(ctx, closeX, buttonY);
      return;
    }

    if (this.confirmingDismiss) {
      this.renderNote(ctx, 'Tear up the contract? The fee is not refunded.', actionX, noteY);
      // "Keep" takes the slot focus is already on, so the press that asked is
      // never the press that answers.
      this.paneButton(
        ctx,
        {
          x: actionX,
          y: buttonY,
          width: ACTION_BTN_W,
          height: ACTION_BTN_H,
          label: 'Keep them',
          ...BUTTON_PRESETS.primary,
          primaryAction: true,
        },
        { kind: 'keep' },
      );
      this.paneButton(
        ctx,
        {
          x: closeX,
          y: buttonY,
          width: CLOSE_BTN_W,
          height: ACTION_BTN_H,
          label: 'Tear it up',
          ...BUTTON_PRESETS.danger,
        },
        { kind: 'tearUp' },
      );
      return;
    }

    this.renderNote(ctx, "Yours till the floor's done.", actionX, noteY);
    this.paneButton(
      ctx,
      {
        x: rect.x + rect.w - PANE_PAD - DISMISS_BTN_W,
        y: buttonY - NOTE_GAP - DISMISS_BTN_H,
        width: DISMISS_BTN_W,
        height: DISMISS_BTN_H,
        label: 'Dismiss Contract',
        ...BUTTON_PRESETS.danger,
      },
      { kind: 'askDismiss' },
    );
    this.renderCloseButton(ctx, closeX, buttonY);
  }

  private renderNote(
    ctx: CanvasRenderingContext2D,
    note: string | null,
    x: number,
    y: number,
  ): void {
    if (note === null) return;
    drawText(ctx, note, { x, y, size: NOTE_SIZE, color: NOTE_TEXT });
  }

  /** Why the Hire button is dimmed, or null when it isn't. */
  private hireNote(template: MercenaryTemplate, player: Purse): string | null {
    const active = this.roster.active;
    if (active !== null && active.id !== template.id) {
      return `${active.name} holds your contract. Dismiss them first.`;
    }
    if (active === null && player.coins < template.price) {
      return `You're ${template.price - player.coins} coins short.`;
    }
    return null;
  }

  /** The hire standing in its frame, playing its idle on the desk's clock. */
  private renderPortrait(
    ctx: CanvasRenderingContext2D,
    template: MercenaryTemplate,
    frame: Rect,
  ): void {
    const art = MERCENARY_ART[template.art];
    // Sized by the figure's own height, so a golem two tiles tall and a
    // crocodilian barely one both stand head-to-foot in the same frame.
    const figureTiles = art.headLiftTiles + FIGURE_FEET_IN_TILE;
    const usableH = frame.h - PORTRAIT_MARGIN * 2;
    const tile = Math.min(PORTRAIT_MAX_TILE, usableH / figureTiles);
    const sx = frame.x + (frame.w - tile) / 2;
    const feetY = frame.y + frame.h - PORTRAIT_MARGIN;
    const sy = feetY - tile * FIGURE_FEET_IN_TILE;
    // Clipped because a figure's ink runs past its tile — a golem's head, a
    // raised lance — and the frame is the edge of the picture.
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    art.draw(ctx, sx, sy, tile, {
      state: { row: 'idle', progress: 0 },
      walkFrame: 0,
      isMoving: false,
      facingX: 0,
      facingY: 1,
      clock: this.desk.ticks,
    });
    ctx.restore();
  }

  private renderStats(
    ctx: CanvasRenderingContext2D,
    template: MercenaryTemplate,
    x: number,
    y: number,
    w: number,
  ): void {
    const rows = [
      {
        label: 'Health',
        value: template.hp,
        max: MAX_HP,
        text: `${template.hp}`,
        fill: HP_BAR_FILL,
      },
      {
        label: 'Speed',
        value: template.speed,
        max: MAX_SPEED,
        text: template.speed.toFixed(SPEED_DECIMALS),
        fill: SPEED_BAR_FILL,
      },
      {
        label: 'Damage',
        value: template.damage,
        max: MAX_DAMAGE,
        text: `${template.damage}`,
        fill: DAMAGE_BAR_FILL,
      },
    ];
    const barX = x + STAT_LABEL_W;
    const barW = w - STAT_LABEL_W - STAT_VALUE_W;
    rows.forEach((row, i) => {
      const rowY = y + i * STAT_ROW_H;
      drawText(ctx, row.label, { x, y: rowY, size: STAT_LABEL_SIZE, color: MUTED_TEXT });
      drawProgressBar(ctx, {
        x: barX,
        y: rowY + STAT_BAR_Y,
        width: barW,
        height: STAT_BAR_H,
        value: row.value / row.max,
        fill: row.fill,
      });
      drawText(ctx, row.text, {
        x: x + w,
        y: rowY,
        size: STAT_LABEL_SIZE,
        bold: true,
        color: PITCH_TEXT,
        align: 'right',
      });
    });
  }

  private renderPitch(
    ctx: CanvasRenderingContext2D,
    pitch: string,
    x: number,
    y: number,
    w: number,
  ): void {
    const quoted = pitch.startsWith('"') ? pitch : `"${pitch}"`;
    drawText(ctx, quoted, {
      x,
      y,
      width: w,
      size: PITCH_SIZE,
      italic: true,
      color: PITCH_TEXT,
      lineHeight: PITCH_LINE_H,
      height: PITCH_LINE_H * PITCH_MAX_LINES,
    });
  }

  /**
   * An always-visible way out. After a hire the Hire button goes dim, so
   * without this the panel reads as stuck to anyone not looking at the hint.
   */
  private renderCloseButton(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    this.paneButton(
      ctx,
      {
        x,
        y,
        width: CLOSE_BTN_W,
        height: ACTION_BTN_H,
        label: 'Close',
        ...BUTTON_PRESETS.primary,
        // Space with nothing focused walks away from the desk rather than
        // spending coins on whichever row happens to lead the ring.
        primaryAction: true,
      },
      { kind: 'close' },
    );
  }

  /** Rosemarie and Bernie in a strip under the desk, with whatever she last said. */
  private renderSpeech(ctx: CanvasRenderingContext2D, rect: Rect): void {
    drawBox(ctx, {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      fill: SPEECH_FILL,
      border: ACCENT,
      borderWidth: 1,
      radius: PANE_RADIUS,
    });
    const portraitSx = rect.x + SPEECH_PAD + (SPEECH_PORTRAIT_W - SPEECH_PORTRAIT_TILE) / 2;
    const groundY = rect.y + rect.h - SPEECH_PAD / 2;
    const portraitSy = groundY - SPEECH_PORTRAIT_TILE * ROSEMARIE_GROUND_IN_TILE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, SPEECH_PAD * 2 + SPEECH_PORTRAIT_W, rect.h);
    ctx.clip();
    drawRosemariePortrait(ctx, portraitSx, portraitSy, SPEECH_PORTRAIT_TILE, {
      row: 'idle',
      timeSeconds: this.desk.timeSeconds,
    });
    ctx.restore();

    const textX = rect.x + SPEECH_PAD * 2 + SPEECH_PORTRAIT_W;
    const textW = rect.x + rect.w - SPEECH_PAD - textX;
    drawText(ctx, 'Rosemarie', {
      x: textX,
      y: rect.y + SPEECH_NAME_Y,
      size: SPEECH_NAME_SIZE,
      bold: true,
      color: GOLD_TEXT,
    });
    drawText(ctx, this.rosemarieLine, {
      x: textX,
      y: rect.y + SPEECH_TEXT_Y,
      width: textW,
      size: SPEECH_TEXT_SIZE,
      color: PITCH_TEXT,
      lineHeight: SPEECH_LINE_H,
      height: SPEECH_LINE_H * SPEECH_MAX_LINES,
    });
  }
}

function listHeight(): number {
  return DESK_ENTRIES.length * ROW_H + (DESK_ENTRIES.length - 1) * ROW_GAP;
}
